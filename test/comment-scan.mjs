// Где комментарий начинается и кончается — лексером с состоянием между строками, а не
// догадкой по одной строке. Что гейт над ним ловит, а что нет — ADR-028.
import { execFileSync } from 'node:child_process';

const REGEX_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw',
  'case', 'do', 'else', 'yield', 'await',
]);

// Токены, после которых `/` — деление. `!` в их число не входит: `!/\s/.test(v)` — префиксное
// отрицание, и дерево его пишет; постфиксного `x!` в нём нет.
const ENDS_A_VALUE = new Set([')', ']', '}', '++', '--']);

/** `/` открывает регэксп, если предыдущий токен не закончил значение. */
function regexAllowed(prev) {
  if (prev === null) return true;
  if (prev === 'value') return false;
  if (prev.startsWith('w:')) return REGEX_KEYWORDS.has(prev.slice(2));
  return !ENDS_A_VALUE.has(prev);
}

/** Строка в кавычках; перевод строки её закрывает, поэтому висячая кавычка не съест файл. */
function skipString(text, i, quote) {
  for (let j = i + 1; j < text.length; j++) {
    const c = text[j];
    if (c === '\\') { j++; continue; }
    if (c === quote) return j + 1;
    if (c === '\n') return j;
  }
  return text.length;
}

/** Литерал регэкспа с классами символов и флагами; перевод строки его закрывает. */
function skipRegex(text, i) {
  let klass = false;
  for (let j = i + 1; j < text.length; j++) {
    const c = text[j];
    if (c === '\\') { j++; continue; }
    if (c === '\n') return j;
    if (klass) { if (c === ']') klass = false; continue; }
    if (c === '[') { klass = true; continue; }
    if (c === '/') {
      let k = j + 1;
      while (k < text.length && /[A-Za-z]/.test(text[k])) k++;
      return k;
    }
  }
  return text.length;
}

/** Каждый комментарий как `{ from, to, kind }` в смещениях символов, состояние — между строками. */
export function commentSpans(text) {
  const out = [];
  const frames = [{ template: false, depth: 0 }];
  let prev = null;
  let i = 0;
  while (i < text.length) {
    const frame = frames[frames.length - 1];
    const c = text[i];
    if (frame.template) {
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { frames.pop(); prev = 'value'; i++; continue; }
      // `${` открывает свой кадр кода, поэтому шаблон внутри него вкладывается, а не закрывает.
      if (c === '$' && text[i + 1] === '{') { frames.push({ template: false, depth: 0 }); prev = null; i += 2; continue; }
      i++;
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
    if (c === '`') { frames.push({ template: true, depth: 0 }); i++; continue; }
    if (c === '/' && regexAllowed(prev)) { i = skipRegex(text, i); prev = 'value'; continue; }
    if (c === '{') { frame.depth++; prev = '{'; i++; continue; }
    if (c === '}') {
      // Глубина 0 во вложенном кадре закрывает `${…}`; в базовом кадре это просто скобка.
      if (frame.depth === 0 && frames.length > 1) { frames.pop(); i++; continue; }
      if (frame.depth > 0) frame.depth--;
      prev = '}';
      i++;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if (/[A-Za-z0-9_$]/.test(c)) {
      let k = i;
      while (k < text.length && /[A-Za-z0-9_$]/.test(text[k])) k++;
      prev = `w:${text.slice(i, k)}`;
      i = k;
      continue;
    }
    // `++` и `--` — один токен: после них `/` это деление, после одиночного `+` — нет.
    if ((c === '+' || c === '-') && text[i + 1] === c) { prev = c + c; i += 2; continue; }
    prev = c;
    i++;
  }
  return out;
}

function lineStartsOf(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
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

/** По строке: колонки комментария на ней и стоит ли код до или после них. */
export function lineFacts(text) {
  const lines = text.split('\n');
  const starts = lineStartsOf(text);
  const facts = lines.map((l) => ({ text: l, spans: [], codeBefore: false, codeAfter: false }));
  for (const span of commentSpans(text)) {
    const first = lineOf(starts, span.from);
    const last = lineOf(starts, Math.max(span.from, span.to - 1));
    for (let n = first; n <= last; n++) {
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

/** Каждая строка, где всё вне комментария затёрто, с сохранением колонок. */
export function maskedLines(text) {
  return lineFacts(text).map((fact) => {
    if (!fact.spans.length) return '';
    const chars = ' '.repeat(fact.text.length).split('');
    for (const [from, to] of fact.spans) for (let i = from; i < to; i++) chars[i] = fact.text[i];
    return chars.join('').replace(/\s+$/, '');
  });
}

/** Блоки комментария как `{ start, end, lines }`, с единицы и включительно. */
export function commentBlocks(text) {
  const blocks = [];
  let current = null;
  const facts = lineFacts(text);
  for (let n = 0; n < facts.length; n++) {
    const fact = facts[n];
    // Код перед комментарием делает строку строкой кода; код после него обрывает блок здесь.
    if (!fact.spans.length || fact.codeBefore || fact.codeAfter) { current = null; continue; }
    if (current) { current.lines.push(fact.text); current.end = n + 1; continue; }
    current = { start: n + 1, end: n + 1, lines: [fact.text] };
    blocks.push(current);
  }
  return blocks;
}

/** Код деревьев, который git не игнорирует: индекс и ещё не он. Гейт идёт раньше `git add`. */
export function scannedCode(root, trees) {
  const ls = (args) => execFileSync('git', ['ls-files', ...args, ...trees], { cwd: root, encoding: 'utf8' })
    .split('\n').filter((f) => f && /\.(js|mjs)$/.test(f));
  // Новый файл судится с рождения: `--others` без `--exclude-standard` тащил бы игнорируемое.
  const files = [...new Set([...ls([]), ...ls(['--others', '--exclude-standard'])])].sort();
  // Дерево, разрешающееся в пустоту, — тихая дыра: обход по нему читает ноль файлов молча
  // и даёт ту же зелень, что обход по всему.
  const empty = trees.filter((t) => !files.some((f) => f === t || f.startsWith(`${t}/`)));
  return { files, empty };
}

/** Блоки длиннее `limit` строк — то, что судит гейт. */
export function longBlocks(text, limit = 2) {
  return commentBlocks(text)
    .filter((r) => r.end - r.start + 1 > limit)
    .map((r) => ({ line: r.start, length: r.end - r.start + 1, lines: r.lines }));
}
