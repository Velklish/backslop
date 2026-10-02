// Where a comment starts and ends — by a lexer that keeps state between lines, not by guessing
// from one line. What the gate over it catches and what it does not — ADR-046.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { lsFiles } from '../lib/util.js';

// The gate's limits: lines in one comment block and code points in one comment line.
export const LIMIT = 2;
export const WIDTH = 100;

const REGEX_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw',
  'case', 'do', 'else', 'yield', 'await',
]);

// Tokens after which `/` is a division. `!` is not among them: `!/\s/.test(v)` is a prefix
// negation, and the tree writes it; there is no postfix `x!` in it.
const ENDS_A_VALUE = new Set([')', ']', '}', '++', '--']);

// `/` opens a regexp when the previous token did not end a value.
function regexAllowed(prev) {
  if (prev === null) return true;
  if (prev === 'value') return false;
  if (prev.startsWith('w:')) return REGEX_KEYWORDS.has(prev.slice(2));
  return !ENDS_A_VALUE.has(prev);
}

// A quoted string; a newline closes it, so a dangling quote does not swallow the file.
function skipString(text, i, quote) {
  for (let j = i + 1; j < text.length; j += 1) {
    const c = text[j];
    if (c === '\\') { j += 1; continue; }
    if (c === quote) return j + 1;
    if (c === '\n') return j;
  }
  return text.length;
}

// A regexp literal with character classes and flags; a newline closes it.
function skipRegex(text, i) {
  let klass = false;
  for (let j = i + 1; j < text.length; j += 1) {
    const c = text[j];
    if (c === '\\') { j += 1; continue; }
    if (c === '\n') return j;
    if (klass) { if (c === ']') klass = false; continue; }
    if (c === '[') { klass = true; continue; }
    if (c === '/') {
      let k = j + 1;
      while (k < text.length && /[A-Za-z]/.test(text[k])) k += 1;
      return k;
    }
  }
  return text.length;
}

// Every comment as `{ from, to, kind }` in character offsets, with state kept between lines.
function commentSpans(text) {
  const out = [];
  const frames = [{ template: false, depth: 0 }];
  let prev = null;
  let i = 0;
  while (i < text.length) {
    const frame = frames[frames.length - 1];
    const c = text[i];
    if (frame.template) {
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { frames.pop(); prev = 'value'; i += 1; continue; }
      // `${` opens its own code frame, so a template inside it nests rather than closes.
      if (c === '$' && text[i + 1] === '{') { frames.push({ template: false, depth: 0 }); prev = null; i += 2; continue; }
      i += 1;
      continue;
    }
    if (c === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i);
      const to = nl === -1 ? text.length : nl;
      out.push({ from: i, to, kind: 'line' });
      i = to;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      const to = close === -1 ? text.length : close + 2;
      out.push({ from: i, to, kind: 'block' });
      i = to;
      continue;
    }
    if (c === '"' || c === "'") { i = skipString(text, i, c); prev = 'value'; continue; }
    if (c === '`') { frames.push({ template: true, depth: 0 }); i += 1; continue; }
    if (c === '/' && regexAllowed(prev)) { i = skipRegex(text, i); prev = 'value'; continue; }
    if (c === '{') { frame.depth += 1; prev = '{'; i += 1; continue; }
    if (c === '}') {
      // Depth 0 in a nested frame closes `${…}`; in the base frame it is just a bracket.
      if (frame.depth === 0 && frames.length > 1) { frames.pop(); i += 1; continue; }
      if (frame.depth > 0) frame.depth -= 1;
      prev = '}';
      i += 1;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i += 1; continue; }
    if (/[A-Za-z0-9_$]/.test(c)) {
      let k = i;
      while (k < text.length && /[A-Za-z0-9_$]/.test(text[k])) k += 1;
      prev = `w:${text.slice(i, k)}`;
      i = k;
      continue;
    }
    // `++` and `--` are one token: `/` after them is a division, after a single `+` it is not.
    if ((c === '+' || c === '-') && text[i + 1] === c) { prev = c + c; i += 2; continue; }
    prev = c;
    i += 1;
  }
  return out;
}

function lineStartsOf(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) if (text[i] === '\n') starts.push(i + 1);
  return starts;
}

function lineOf(starts, idx) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= idx) lo = mid; else hi = mid - 1;
  }
  return lo;
}

// Per line: the columns of a comment on it, and whether code stands before or after them.
function lineFacts(text) {
  const lines = text.split('\n');
  const starts = lineStartsOf(text);
  const facts = lines.map((l) => ({ text: l, spans: [], codeBefore: false, codeAfter: false }));
  for (const span of commentSpans(text)) {
    const first = lineOf(starts, span.from);
    const last = lineOf(starts, Math.max(span.from, span.to - 1));
    for (let n = first; n <= last; n += 1) {
      const from = n === first ? span.from - starts[n] : 0;
      const to = n === last ? span.to - starts[n] : lines[n].length;
      facts[n].spans.push([from, Math.min(to, lines[n].length)]);
    }
  }
  for (const fact of facts) {
    if (!fact.spans.length) { fact.codeBefore = /\S/.test(fact.text); continue; }
    const head = fact.spans[0][0];
    fact.codeBefore = /\S/.test(fact.text.slice(0, head));
    let cursor = head;
    for (const [from, to] of fact.spans) {
      if (/\S/.test(fact.text.slice(cursor, from))) fact.codeAfter = true;
      cursor = Math.max(cursor, to);
    }
    if (/\S/.test(fact.text.slice(cursor))) fact.codeAfter = true;
  }
  return facts;
}

// Every line with all that lies outside a comment blanked out, columns kept.
export function maskedLines(text) {
  return lineFacts(text).map((fact) => {
    if (!fact.spans.length) return '';
    const chars = ' '.repeat(fact.text.length).split('');
    for (const [from, to] of fact.spans) for (let i = from; i < to; i += 1) chars[i] = fact.text[i];
    return chars.join('').replace(/\s+$/, '');
  });
}

// Comment blocks as `{ start, end, lines }`, one-based and inclusive.
function commentBlocks(text) {
  const blocks = [];
  let current = null;
  const facts = lineFacts(text);
  for (let n = 0; n < facts.length; n += 1) {
    const fact = facts[n];
    // Code before a comment makes the line a code line; code after it ends the block here.
    if (!fact.spans.length || fact.codeBefore || fact.codeAfter) { current = null; continue; }
    if (current) { current.lines.push(fact.text); current.end = n + 1; continue; }
    current = { start: n + 1, end: n + 1, lines: [fact.text] };
    blocks.push(current);
  }
  return blocks;
}

// The tree code git does not ignore: the index, and what is not in it yet.
// The gate runs before `git add`.
export function scannedCode(root, trees) {
  // A deleted file is not judged: the index still lists it until `git add`.
  const ls = (flags) => lsFiles(root, trees, flags).filter((f) => /\.(js|mjs)$/.test(f) && existsSync(path.join(root, f)));
  // A new file is judged from birth; `--others` without `--exclude-standard` pulls in ignored ones.
  const files = [...new Set([...ls([]), ...ls(['--others', '--exclude-standard'])])].sort();
  // A tree that resolves to nothing is a quiet hole: a walk over it reads zero files silently
  // and gives the same green as a walk over everything.
  const empty = trees.filter((t) => !files.some((f) => f === t || f.startsWith(`${t}/`)));
  return { files, empty };
}

// Blocks longer than `limit` lines — what the gate judges.
export function longBlocks(text, limit = LIMIT) {
  return commentBlocks(text)
    .filter((r) => r.end - r.start + 1 > limit)
    .map((r) => ({ line: r.start, length: r.end - r.start + 1, lines: r.lines }));
}

// Lines of blocks wider than `limit` characters: code points of the whole line with its indent,
// without `\r` (ADR-046).
export function wideLines(text, limit = WIDTH) {
  const out = [];
  for (const block of commentBlocks(text)) {
    block.lines.forEach((l, k) => {
      const width = [...l.replace(/\r$/, '')].length;
      if (width > limit) out.push({ line: block.start + k, width });
    });
  }
  return out;
}
