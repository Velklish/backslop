// Журнал закрытых задач `<docs>/archive/LOG.md`: строка на задачу, тело — в git (ADR-026). Модуль
// не импортирует lib/tasks.js: тот читает журнал, и обратный импорт замкнул бы цикл.
import path from 'node:path';
import { tr } from './i18n.js';
import { escapeRe } from './util.js';

export const LOG_FILE = 'LOG.md';

// Поля слева, заголовок последним: только он может нести разделитель. Якорь — номер в нижнем
// регистре; неузнанные коммит и исход — длинное тире: выдуманный исход хуже пробела.
const UNKNOWN = '—';

const SEP = ' · ';

export function logAnchor(id) {
  return id.toLowerCase();
}

function logLineRe(prefix) {
  return new RegExp([
    '^- <a id="([^"]*)"></a>`',
    `${escapeRe(prefix)}-(\\d+)(?:\\.(\\d+))?-([a-z0-9]+(?:-[a-z0-9]+)*)`,
    '` · (\\d{4}-\\d{2}-\\d{2}) · ([^·]*) · (?:`([0-9a-f]{7,40})`|',
    escapeRe(UNKNOWN),
    ') · (.*)$',
  ].join(''));
}

// Строка, которая претендует быть записью журнала: по ней гейт отличает опечатку в записи от
// обычного пункта списка. Без этого битая запись читалась бы прозой и пропадала молча.
export const LOG_ENTRY_HINT = /^- <a id=/;

export function parseLogLine(line, prefix) {
  const m = line.match(logLineRe(prefix));
  if (!m) return null;
  const num = Number(m[2]);
  const sub = m[3] === undefined ? null : Number(m[3]);
  const id = sub === null ? `${prefix}-${m[2]}` : `${prefix}-${m[2]}.${m[3]}`;
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

// --- исход ---------------------------------------------------------------------------------

// Словарь исходов: решает первое по позиции слово, порядок словаря — только при равной позиции.
// Границы — по букве, а не `\b`: в JS она считается по ASCII и после кириллицы не существует.
const OUTCOME_FORMS = [
  ['merged', /(?<!(?<!\p{L})(?:не|not)[\s*_]+)(?<!\p{L})(?:слит[аоы]|слиянием|merged)[*_]*(?:\s+\d{4}-\d{2}-\d{2}[*_]*)?\s+(?:в|into)(?!\p{L})/giu],
  ['rejected', /(?<!\p{L})(?:отклонен[аоы]|(?<!(?<!\p{L})с\s+)отклонением|снят[аоы]\s+с\s+плана|rejected)(?!\p{L})|^[\s*_]*снят[аоы](?!\p{L})/giu],
  ['completed', /(?<!\p{L})(?:выполнен[аоы]|completed)(?!\p{L})/giu],
];

// Голое «закрыта»/«closed»/«done» и маркер «Исход:»/«Outcome:» значат «выполнена», только когда
// иного исхода нет ни в первом абзаце, ни в заголовке. Границы по букве: «abandoned» несёт «done».
const CLOSED_FORM = /(?<!\p{L})(?:(?:закрыт[аоы]|closed|done)(?!\p{L})|(?:исход|outcome):)/iu;

// Исход «пачкой» строит сама команда (`renderOutcome('batched', …)`), поэтому он и читается обратно
// по обеим формам; правленная руками строка посчитается задачей — ошибка счёта, не потеря записи.
const BATCHED_RE = /^(?:пачкой|batch)\s+(\S+)$/;

export function batchOf(outcome) {
  return String(outcome ?? '').trim().match(BATCHED_RE)?.[1] ?? null;
}

export function renderOutcome(kind, target, lang = 'ru') {
  if (kind === 'merged') return tr(lang, `слита в ${target}`, `merged into ${target}`);
  if (kind === 'rejected') return tr(lang, 'отклонена', 'rejected');
  if (kind === 'completed') return tr(lang, 'выполнена', 'completed');
  if (kind === 'batched') return tr(lang, `пачкой ${target}`, `batch ${target}`);
  throw new Error(`unknown outcome kind: ${kind}`);
}

// Исход — из первого абзаца `result.md`, затем из заголовка; весь файл не читается:
// «отклонена» посреди раздела «Проверки» — рассказ о ходе работы, а не исход.
export function outcomeFromResult(text, prefix, lang = 'ru') {
  return namedOutcomeText(text, prefix, lang)
    ?? ([firstParagraph(text), headingNote(text).words].some((b) => CLOSED_FORM.test(b)) ? renderOutcome('completed', null, lang) : UNKNOWN);
}

// Исход, названный словом словаря в первом абзаце или заголовке, — без фолбэка на голое «закрыта»:
// его требуют гейт 5 lint и `fold N`, текст отказа у них общий.
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
  return tr(lang,
    `result.md не называет исход словом словаря — выполнена, отклонена, снята с плана или слита в ${prefix}-N — ни в первом абзаце, ни в заголовке: голое «Закрыта» или маркер «Исход:» исходом не считаются, свёртка прочла бы их «выполнена», а без слова поставила бы «—»`,
    `result.md names no outcome word — completed, rejected, or merged into ${prefix}-N — in its first paragraph or heading: a bare “Closed” or an “Outcome:” marker is not an outcome, folding would read either as “completed”, and with no word at all it would write “—”`);
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

// Слияние — только с номером проекта сразу после формы: «слито в main» и «merged into it» не оно.
function mergeTarget(tail, prefix) {
  return tail.match(new RegExp(`^[\\s*_\`[]*(${escapeRe(prefix)}-\\d+(?:\\.\\d+)?)`))?.[1] ?? null;
}

// Дата закрытия: первая дата первого абзаца, иначе дата в скобках заголовка. Не нашлась —
// решает вызывающий (обычно сегодняшним числом).
export function dateFromResult(text) {
  return firstParagraph(text).match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? headingNote(text).date;
}

// Заголовок `result.md` старых архивов несёт исход в скобках с датой — `# BL-5 — результат (снята
// с плана 2026-08-13)` — или после двоеточия: `# BL-355 — результат: отклонена`.
function headingNote(text) {
  const first = String(text ?? '').split(/\r?\n/).find((l) => l.trim()) ?? '';
  if (!/^\s*#/.test(first)) return { words: '', date: null };
  const paren = first.match(/\(([^()]*?)\s*(\d{4}-\d{2}-\d{2})\s*\)/);
  const colon = first.match(/\s[—–-]\s*(?:результат|result)\s*:\s*(.+)$/iu);
  return { words: [paren?.[1], colon?.[1]].filter(Boolean).join(' '), date: paren?.[2] ?? null };
}

function firstParagraph(text) {
  const lines = String(text ?? '').split(/\r?\n/).filter((l) => !/^\s*#/.test(l));
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

// --- файл журнала --------------------------------------------------------------------------

export function logFile(dirs) {
  return path.join(dirs.archive, LOG_FILE);
}

// Записи журнала из его текста, в порядке строк. Номер строки нужен гейту: он называет место.
export function readLogText(text, prefix) {
  const out = [];
  String(text ?? '').split(/\r?\n/).forEach((line, i) => {
    const entry = parseLogLine(line, prefix);
    if (entry) out.push({ ...entry, line: i + 1 });
  });
  return out;
}

// Строки, которые выглядят записью, но не разбираются: гейт журнала называет их поимённо.
export function brokenLogLines(text, prefix) {
  const out = [];
  String(text ?? '').split(/\r?\n/).forEach((line, i) => {
    if (LOG_ENTRY_HINT.test(line) && !parseLogLine(line, prefix)) out.push({ line: i + 1, text: line });
  });
  return out;
}

// Дописывание в конец. Файл без перевода строки в конце дополняется им, иначе запись приклеилась
// бы к прозе; пустая строка — один раз, между прозой и первой записью.
export function appendLogLines(text, lines, eol = '\n') {
  let base = text;
  if (base.length && !base.endsWith('\n')) base += eol;
  const tail = base.split(/\r?\n/).filter((l) => l.trim()).at(-1) ?? '';
  const gap = tail && !LOG_ENTRY_HINT.test(tail) && !/\n[ \t]*\r?\n$/.test(base) ? eol : '';
  return `${base}${gap}${lines.join(eol)}${eol}`;
}

// A body line in a commit message carries this mark, so `commit.cleanup=strip` keeps its `#`
// headings; `show` strips it back (docs/reference/02-cli.md, `fold`).
export const BODY_MARK = '> ';

const SECTION_RE = /^--- (.+) ---$/;
const isMarked = (line) => line === BODY_MARK.trimEnd() || line.startsWith(BODY_MARK);

export function bodySection(rel, text) {
  const lines = text.trimEnd().split(/\r?\n/).map((l) => (l ? `${BODY_MARK}${l}` : BODY_MARK.trimEnd()));
  return [`--- ${rel} ---`, '', ...lines, ''];
}

// Sections of a commit message, mark stripped. A marked body ends at its first unmarked line;
// an unmarked one, written before the mark, runs to the next header and is kept as it is.
export function messageSections(message) {
  const lines = String(message ?? '').split(/\r?\n/);
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
