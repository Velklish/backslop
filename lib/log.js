// Журнал закрытых задач — `<docs>/archive/LOG.md`. Строка на задачу; тело задачи в дереве не
// остаётся, оно живёт в git ([ADR-026](../docs/adr/adr-026-archive-folds-to-log.md)). Разбор
// строки держится здесь и ни от чего не зависит: `lib/tasks.js` читает журнал наравне с
// каталогами архива, и импорт в обратную сторону замкнул бы модули в цикл.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { tr } from './i18n.js';

export const LOG_FILE = 'LOG.md';

// Форма строки: фиксированные поля слева, свободный текст справа. Заголовок задачи поставлен
// последним потому, что он единственный может содержать разделитель — разбор иначе пришлось бы
// вести с обратным ходом. Якорь — нижний регистр номера: на него ведут входящие ссылки соседей.
// Коммит и исход, которых свёртка не узнала, пишутся длинным тире: выдуманный исход хуже пробела.
export const UNKNOWN = '—';

const SEP = ' · ';

export function logAnchor(id) {
  return id.toLowerCase();
}

function esc(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function logLineRe(prefix) {
  return new RegExp([
    '^- <a id="([^"]*)"></a>`',
    `${esc(prefix)}-(\\d+)(?:\\.(\\d+))?-([a-z0-9]+(?:-[a-z0-9]+)*)`,
    '` · (\\d{4}-\\d{2}-\\d{2}) · ([^·]*) · (?:`([0-9a-f]{7,40})`|',
    esc(UNKNOWN),
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
    outcome || UNKNOWN,
    commit ? `\`${commit}\`` : UNKNOWN,
    title || UNKNOWN,
  ];
  return `- <a id="${logAnchor(id)}"></a>${fields.join(SEP)}`;
}

// --- исход ---------------------------------------------------------------------------------

// Словарь исходов. Обе языковые формы читаются всегда — смешанный RU/EN бэклог законен, — а
// пишется форма языка проекта. Порядок проверки от частного к общему: «слита в BS-14. Выполнена
// …» — слияние, и первым должен сработать он. Границы слова `\b` в шаблонах нет: в JS она
// считается по ASCII, и после кириллической буквы её не существует — «Выполнена.» не совпала бы.
const OUTCOME_FORMS = [
  ['merged', /(?:слит[аоы]\s+в|merged\s+into)/iu],
  ['rejected', /(?:отклонен[аоы]|rejected)/iu],
  ['completed', /(?:выполнен[аоы]|completed)/iu],
];

// Пачка, которой закрыта запись, — единственный исход, который не вычитан из `result.md`, а
// построен командой: `renderOutcome('batched', …)`. Поэтому он же читается обратно — по обеим
// своим формам. Правка строки руками собьёт чтение, и запись посчитается закрытой задачей:
// цена ошибки — единица в счёте архива, а не потеря записи.
const BATCHED_RE = /^(?:пачкой|batch)\s+(\S+)$/;

export function batchOf(outcome) {
  return String(outcome ?? '').trim().match(BATCHED_RE)?.[1] ?? null;
}

export function renderOutcome(kind, target, lang = 'ru') {
  if (kind === 'merged') return tr(lang, `слита в ${target}`, `merged into ${target}`);
  if (kind === 'rejected') return tr(lang, 'отклонена', 'rejected');
  if (kind === 'completed') return tr(lang, 'выполнена', 'completed');
  if (kind === 'batched') return tr(lang, `пачкой ${target}`, `batch ${target}`);
  return UNKNOWN;
}

// Исход берётся из первого абзаца `result.md` — того, куда его кладёт шаблон. Весь файл не
// читается: «отклонена» посреди раздела «Проверки» — рассказ о ходе работы, а не исход.
export function outcomeFromResult(text, prefix, lang = 'ru') {
  const body = firstParagraph(text);
  if (!body) return UNKNOWN;
  for (const [kind, re] of OUTCOME_FORMS) {
    const m = body.match(re);
    if (!m) continue;
    if (kind !== 'merged') return renderOutcome(kind, null, lang);
    const tail = body.slice(m.index + m[0].length);
    const id = tail.match(new RegExp(`${esc(prefix)}-\\d+(?:\\.\\d+)?`));
    return renderOutcome('merged', id ? id[0] : UNKNOWN, lang);
  }
  return UNKNOWN;
}

// Дата закрытия из `result.md`: `**Закрыта 2026-09-03.**` шаблона или любая первая дата первого
// абзаца. Не нашлась — решает вызывающий (обычно сегодняшним числом).
export function dateFromResult(text) {
  return firstParagraph(text).match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
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

export function hasLog(dirs) {
  return existsSync(logFile(dirs));
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

// Дописывание в конец: порядок журнала — порядок закрытия, и перестановка строк ничего не
// значит. Файл без завершающего перевода строки дополняется им, иначе новая запись приклеилась
// бы к последней строке прозы; пустая строка ставится один раз — между прозой и первой записью,
// а не между записями.
export function appendLogLines(text, lines, eol = '\n') {
  let base = text;
  if (base.length && !base.endsWith('\n')) base += eol;
  const tail = base.split(/\r?\n/).filter((l) => l.trim()).at(-1) ?? '';
  const gap = tail && !LOG_ENTRY_HINT.test(tail) && !/\n[ \t]*\r?\n$/.test(base) ? eol : '';
  return `${base}${gap}${lines.join(eol)}${eol}`;
}

// Ссылка на строку журнала от каталога файла, который на неё ссылается.
export function logHref(fromDir, logRel, id) {
  return `${path.posix.relative(fromDir, logRel)}#${logAnchor(id)}`;
}
