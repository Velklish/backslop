// The journal of closed tasks `<docs>/archive/LOG.md`: a line per task, the body in git (ADR-044).
// It does not import lib/tasks.js: that reads the journal, and a reverse import would be a cycle.
import path from 'node:path';
import { formatId, taskStemSrc } from './ids.js';
import { RU, msg } from './i18n.js';
import { escapeRe } from './util.js';
import { splitLines } from './text.js';

export const LOG_FILE = 'LOG.md';

// Fields on the left, the title last: only it can carry the separator. The anchor is the lower-case
// number; an unknown commit or outcome is an em dash: an invented outcome is worse than none.
const UNKNOWN = '—';

const SEP = ' · ';

export function logAnchor(id) {
  return id.toLowerCase();
}

function logLineRe(prefix) {
  return new RegExp([
    '^- <a id="([^"]*)"></a>`',
    taskStemSrc(prefix),
    '` · (\\d{4}-\\d{2}-\\d{2}) · ([^·]*) · (?:`([0-9a-f]{7,40})`|',
    escapeRe(UNKNOWN),
    ') · (.*)$',
  ].join(''));
}

// A line that claims to be a journal entry: the gate tells a typo in an entry from an ordinary list
// item by it. Without it a broken entry would read as prose and vanish silently.
export const LOG_ENTRY_HINT = /^- <a id=/;

// The journal header is the text above the first entry line; an entry is data and stays as it is.
export function redrawLogHeader(text, header) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const head = header.trimEnd().replace(/\r?\n/g, eol);
  const at = text.search(new RegExp(LOG_ENTRY_HINT.source, 'm'));
  return at === -1 ? head + eol : `${head}${eol}${eol}${text.slice(at)}`;
}

export function parseLogLine(line, prefix) {
  const m = line.match(logLineRe(prefix));
  if (!m) return null;
  const num = Number(m[2]);
  const sub = m[3] === undefined ? null : Number(m[3]);
  const id = formatId(prefix, m[2], m[3] ?? null);
  return {
    anchor: m[1],
    id,
    num,
    sub,
    slug: m[4],
    date: m[5],
    outcome: m[6],
    commit: m[7] ?? null,
    title: m[8],
  };
}

export function formatLogLine({ id, slug, date, outcome, commit, title }) {
  const fields = [
    `\`${id}-${slug}\``,
    date,
    outcome,
    commit ? `\`${commit}\`` : UNKNOWN,
    title || UNKNOWN,
  ];
  return `- <a id="${logAnchor(id)}"></a>${fields.join(SEP)}`;
}

// --- outcome -------------------------------------------------------------------------------

// The outcome dictionary: the word first by position decides, dictionary order only on a tie.
// Boundaries are by letter, not `\b`: in JS it is ASCII-only and fails next to Cyrillic.
const W = RU.parserWords;
const OUTCOME_FORMS = [
  ['merged', new RegExp(`(?<!(?<!\\p{L})(?:${W.not}|not)[\\s*_]+)(?<!\\p{L})(?:${W.merged}|merged)[*_]*(?:\\s+\\d{4}-\\d{2}-\\d{2}[*_]*)?\\s+(?:${W.into}|into)(?!\\p{L})`, 'giu')],
  ['rejected', new RegExp(`(?<!\\p{L})(?:${W.rejected}|rejected)(?!\\p{L})|^[\\s*_]*${W.withdrawn}(?!\\p{L})`, 'giu')],
  ['completed', new RegExp(`(?<!\\p{L})(?:${W.completed}|completed)(?!\\p{L})`, 'giu')],
];

// A bare "closed"/"done" (or its Russian form) and the "Outcome:" marker mean "completed" only when
// the first paragraph and heading hold no other outcome. Letter boundaries: "abandoned" has "done".
const CLOSED_FORM = new RegExp(`(?<!\\p{L})(?:(?:${W.closed}|closed|done)(?!\\p{L})|(?:${W.outcome}|outcome):)`, 'iu');

// The "batched" outcome is built by the command itself (`renderOutcome('batched', …)`), so it is
// read back in both forms; a hand-edited line counts as a task: a counting error, not a lost entry.
const BATCHED_RE = new RegExp(`^(?:${W.batch}|batch)\\s+(\\S+)$`);

export function batchOf(outcome) {
  return String(outcome ?? '').trim().match(BATCHED_RE)?.[1] ?? null;
}

export function renderOutcome(kind, target, lang = 'ru') {
  if (kind === 'merged') return msg(lang, 'merged into {target}', { target });
  if (kind === 'rejected') return msg(lang, 'rejected');
  if (kind === 'completed') return msg(lang, 'completed');
  if (kind === 'batched') return msg(lang, 'batch {target}', { target });
  throw new Error(`unknown outcome kind: ${kind}`);
}

// The outcome comes from the first paragraph of `result.md`, then from the heading; the whole file
// is not read: "rejected" in the middle of "Verification" tells about the work, not the outcome.
export function outcomeFromResult(text, prefix, lang = 'ru') {
  return namedOutcomeText(text, prefix, lang)
    ?? ([firstParagraph(text), headingNote(text).words].some((b) => CLOSED_FORM.test(b)) ? renderOutcome('completed', null, lang) : UNKNOWN);
}

// An outcome named by a dictionary word in the first paragraph or heading, with no fallback to a
// bare "closed": lint gate 5 and `fold N` require it, and their refusal text is shared.
export function hasNamedOutcome(text, prefix) {
  return namedOutcomeText(text, prefix) !== null;
}

function namedOutcomeText(text, prefix, lang) {
  for (const body of [firstParagraph(text), headingNote(text).words]) {
    const named = namedOutcome(body, prefix, lang);
    if (named) return named;
  }
  return null;
}

export function outcomeWordMissing(prefix, lang = 'ru') {
  return msg(lang,
    'result.md names no outcome word — completed, rejected, or merged into {prefix}-N — in its first paragraph or heading: a bare “Closed” or an “Outcome:” marker is not an outcome, folding would read either as “completed”, and with no word at all it would write “—”', { prefix });
}

function namedOutcome(body, prefix, lang) {
  let first = null;
  for (const [kind, re] of OUTCOME_FORMS) {
    for (const m of body.matchAll(re)) {
      const target = kind === 'merged' ? mergeTarget(body.slice(m.index + m[0].length), prefix) : null;
      if (kind === 'merged' && !target) continue;
      if (!first || m.index < first.at) first = { at: m.index, kind, target };
      break;
    }
  }
  return first ? renderOutcome(first.kind, first.target, lang) : null;
}

// A merge only with the project's number right after the form: "merged into main" is not it.
function mergeTarget(tail, prefix) {
  return tail.match(new RegExp(`^[\\s*_\`[]*(${escapeRe(prefix)}-\\d+(?:\\.\\d+)?)`))?.[1] ?? null;
}

// The closing date: the first date of the first paragraph, else the date in the parentheses of the
// heading. If none is found the caller decides (usually today's date).
export function dateFromResult(text) {
  return firstParagraph(text).match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? headingNote(text).date;
}

// The heading of `result.md` in old archives carries the outcome in parentheses with a date,
// `# FX-1 — result (rejected 2026-01-01)`, or after a colon: `# FX-2 — result: rejected`.
function headingNote(text) {
  const first = splitLines(String(text ?? '')).find((l) => l.trim()) ?? '';
  if (!/^\s*#/.test(first)) return { words: '', date: null };
  const paren = first.match(/\(([^()]*?)\s*(\d{4}-\d{2}-\d{2})\s*\)/);
  const colon = first.match(new RegExp(`\\s[—–-]\\s*(?:${W.result}|result)\\s*:\\s*(.+)$`, 'iu'));
  return { words: [paren?.[1], colon?.[1]].filter(Boolean).join(' '), date: paren?.[2] ?? null };
}

function firstParagraph(text) {
  const lines = splitLines(String(text ?? '')).filter((l) => !/^\s*#/.test(l));
  const out = [];
  for (const line of lines) {
    if (!line.trim()) {
      if (out.length) break;
      continue;
    }
    out.push(line);
  }
  return out.join(' ');
}

// --- journal file --------------------------------------------------------------------------

export function logFile(dirs) {
  return path.join(dirs.archive, LOG_FILE);
}

// The journal entries from its text, in line order. The gate needs the line number: it names the
// place.
export function readLogText(text, prefix) {
  const out = [];
  splitLines(String(text ?? '')).forEach((line, i) => {
    const entry = parseLogLine(line, prefix);
    if (entry) out.push({ ...entry, line: i + 1 });
  });
  return out;
}

// Lines that look like an entry but do not parse: the journal gate names them one by one.
export function brokenLogLines(text, prefix) {
  const out = [];
  splitLines(String(text ?? '')).forEach((line, i) => {
    if (LOG_ENTRY_HINT.test(line) && !parseLogLine(line, prefix)) out.push({ line: i + 1, text: line });
  });
  return out;
}

// Appending at the end. A file without a trailing line break gets one, or the entry would stick to
// the prose; the empty line comes once, between the prose and the first entry.
export function appendLogLines(text, lines, eol = '\n') {
  let base = text;
  if (base.length && !base.endsWith('\n')) base += eol;
  const tail = splitLines(base).filter((l) => l.trim()).at(-1) ?? '';
  const gap = tail && !LOG_ENTRY_HINT.test(tail) && !/\n[ \t]*\r?\n$/.test(base) ? eol : '';
  return `${base}${gap}${lines.join(eol)}${eol}`;
}

// A body line in a commit message carries this mark, so `commit.cleanup=strip` keeps its `#`
// headings; `show` strips it back (docs/reference/02-cli.md, `fold`).
export const BODY_MARK = '> ';

const SECTION_RE = /^--- (.+) ---$/;
const isMarked = (line) => line === BODY_MARK.trimEnd() || line.startsWith(BODY_MARK);

export function bodySection(rel, text) {
  const lines = splitLines(text.trimEnd()).map((l) => (l ? `${BODY_MARK}${l}` : BODY_MARK.trimEnd()));
  return [`--- ${rel} ---`, '', ...lines, ''];
}

// Sections of a commit message, mark stripped. A marked body ends at its first unmarked line;
// an unmarked one, written before the mark, runs to the next header and is kept as it is.
export function messageSections(message) {
  const lines = splitLines(String(message ?? ''));
  const out = [];
  lines.forEach((line, i) => {
    const m = line.match(SECTION_RE);
    if (!m) return;
    let j = i + 1;
    while (j < lines.length && !lines[j].trim()) j += 1;
    const marked = j < lines.length && isMarked(lines[j]);
    const body = [];
    for (; j < lines.length && !SECTION_RE.test(lines[j]) && (!marked || isMarked(lines[j])); j += 1) {
      body.push(marked ? lines[j].slice(BODY_MARK.length) : lines[j]);
    }
    out.push({ rel: m[1], text: body.join('\n').trimEnd() });
  });
  return out;
}
