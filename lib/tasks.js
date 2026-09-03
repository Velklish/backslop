// Задачи: скан каталогов статусов и архива, разбор имени и шапки, выдача номеров и порядка.
// Состояние — файлы; никакого индекса и счётчика: номер считается по тому, что лежит на диске.
import { existsSync, readdirSync, readFileSync, renameSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { STATUSES } from './config.js';
import { CliError, git, gitOrFail, toPosix } from './util.js';

export const FIELD_ORDER = 'Порядок';
export const FIELD_AREA = 'Область';
export const FIELD_CREATED = 'Создана';
export const FIELD_TAKEN = 'Взята';
export const FIELD_DEPS = 'Зависимости';
export const SECTION_DEFERRED = 'Отложено';

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const RANK_STEP = 10;

// Строка поля шапки: `- **Имя:** значение`.
const FIELD_RE = /^- \*\*([^*:\n]+):\*\*[ \t]*(.*)$/;
const TITLE_RE = /^# (\S+) · (.+)$/;

export function taskFileRe(prefix) {
  return new RegExp(`^${prefix}-(\\d+)(?:\\.(\\d+))?-([a-z0-9]+(?:-[a-z0-9]+)*)\\.md$`);
}

export function taskDirRe(prefix) {
  return new RegExp(`^${prefix}-(\\d+)(?:\\.(\\d+))?-([a-z0-9]+(?:-[a-z0-9]+)*)$`);
}

// Упоминание задачи в тексте: `BS-12`, `BS-12.3`. Граница — не буква, не цифра и не точка
// с цифрой, чтобы `BS-12.3` не читался как `BS-12` плюс хвост. Префикс, совпадающий с
// обычным словом (`API`, `RFC`), даст ложные срабатывания на строках вида `API-2.0`.
export function idMentionRe(prefix) {
  return new RegExp(`\\b${prefix}-(\\d+)(?:\\.(\\d+))?(?![\\d.]*\\d)`, 'g');
}

export function formatId(prefix, num, sub = null) {
  return sub === null || sub === undefined ? `${prefix}-${num}` : `${prefix}-${num}.${sub}`;
}

// «12», «BS-12», «12.3», «bs-12.3» → { num, sub }. Иное — отказ.
export function parseId(raw, prefix) {
  const m = String(raw ?? '').trim().match(new RegExp(`^(?:${prefix}-)?(\\d+)(?:\\.(\\d+))?$`, 'i'));
  if (!m) throw new CliError(`номер задачи «${raw}» не разбирается: нужен N или N.k, можно с префиксом ${prefix}-`);
  return { num: Number(m[1]), sub: m[2] === undefined ? null : Number(m[2]) };
}

export function sameId(a, b) {
  return a.num === b.num && (a.sub ?? null) === (b.sub ?? null);
}

// Все задачи проекта по номеру: каталог на статус плюс архив. Файл, не подходящий под шаблон
// имени, здесь не задача — его ловит гейт `lint`, а не команды.
export function scanTasks({ root, cfg, dirs }) {
  const out = [];
  const fileRe = taskFileRe(cfg.prefix);
  for (const status of STATUSES) {
    const dir = dirs.statusDir[status];
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const m = name.match(fileRe);
      if (!m) continue;
      out.push(record(root, cfg.prefix, status, path.join(dir, name), m));
    }
  }
  const dirRe = taskDirRe(cfg.prefix);
  if (existsSync(dirs.archive)) {
    for (const name of readdirSync(dirs.archive)) {
      const m = name.match(dirRe);
      if (!m) continue;
      const file = path.join(dirs.archive, name, 'task.md');
      const rec = record(root, cfg.prefix, 'archive', file, m);
      rec.dir = path.join(dirs.archive, name);
      rec.hasTask = existsSync(file);
      rec.hasResult = existsSync(path.join(dirs.archive, name, 'result.md'));
      out.push(rec);
    }
  }
  return out.sort((a, b) => a.num - b.num || (a.sub ?? -1) - (b.sub ?? -1) || a.rel.localeCompare(b.rel));
}

function record(root, prefix, status, file, m) {
  const num = Number(m[1]);
  const sub = m[2] === undefined ? null : Number(m[2]);
  return {
    id: formatId(prefix, num, sub),
    num,
    sub,
    slug: m[3],
    status,
    file,
    rel: toPosix(path.relative(root, file)),
  };
}

// Задача по номеру. Два файла с одним номером — отказ с обоими путями: молча взять первый
// значило бы двигать не ту задачу.
export function findTask(tasks, id) {
  const hits = tasks.filter((t) => sameId(t, id));
  if (hits.length > 1) {
    throw new CliError(`номер ${hits[0].id} занят дважды: ${hits.map((t) => t.rel).join(', ')} — разведи номера, lint это тоже покажет`);
  }
  return hits[0] ?? null;
}

export function nextNumber(tasks) {
  return tasks.reduce((max, t) => Math.max(max, t.num), 0) + 1;
}

export function nextSub(tasks, parentNum) {
  return tasks.filter((t) => t.num === parentNum && t.sub !== null).reduce((max, t) => Math.max(max, t.sub), 0) + 1;
}

// --- текст файла --------------------------------------------------------------------------

// Файл читается без BOM; переводы строк сохраняются какими были — CRLF-файл после правки
// остаётся CRLF-файлом.
export function readText(file) {
  const text = readFileSync(file, 'utf8');
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function writeText(file, text) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

export function eolOf(text) {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

export function splitLines(text) {
  return text.split(/\r?\n/);
}

// --- шапка файла --------------------------------------------------------------------------

export function readTitle(text) {
  const m = splitLines(text)[0]?.match(TITLE_RE);
  return m ? { id: m[1], title: m[2].trim() } : null;
}

// Индексы строк полей шапки — до первого раздела `## `.
function fieldLines(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].startsWith('## ')) break;
    const m = lines[i].match(FIELD_RE);
    if (m) out.push([i, m[1].trim(), m[2].trim()]);
  }
  return out;
}

export function readFields(text) {
  const map = new Map();
  for (const [, name, value] of fieldLines(splitLines(text))) map.set(name, value);
  return map;
}

export function getField(text, name) {
  return readFields(text).get(name) ?? null;
}

export function setField(text, name, value) {
  const eol = eolOf(text);
  const lines = splitLines(text);
  const fields = fieldLines(lines);
  const line = `- **${name}:** ${value}`;
  const own = fields.find(([, n]) => n === name);
  if (own) {
    lines[own[0]] = line;
    return lines.join(eol);
  }
  if (fields.length) {
    // «Порядок» стоит первым: он меняется чаще всего и должен быть виден сразу.
    const at = name === FIELD_ORDER ? fields[0][0] : fields[fields.length - 1][0] + 1;
    lines.splice(at, 0, line);
    return lines.join(eol);
  }
  // Полей ещё нет: список идёт после заголовка через пустую строку и отделяется пустой строкой.
  const h1 = lines.findIndex((l) => l.startsWith('# '));
  let at = h1 === -1 ? 0 : h1 + 1;
  const insert = [];
  if (lines[at] === '') at += 1;
  else insert.push('');
  insert.push(line);
  if (lines[at] !== '') insert.push('');
  lines.splice(at, 0, ...insert);
  return lines.join(eol);
}

export function removeField(text, name) {
  const eol = eolOf(text);
  const lines = splitLines(text);
  const own = fieldLines(lines).find(([, n]) => n === name);
  if (!own) return text;
  lines.splice(own[0], 1);
  return lines.join(eol);
}

export function orderOf(text) {
  const raw = getField(text, FIELD_ORDER);
  if (raw === null) return null;
  return /^-?\d+$/.test(raw) ? Number(raw) : Number.NaN;
}

// --- разделы ------------------------------------------------------------------------------

export function sectionBody(text, heading) {
  const lines = splitLines(text);
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith('## ')) { end = i; break; }
  }
  return lines.slice(start + 1, end).join('\n').trim();
}

export function appendSection(text, heading, body) {
  const eol = eolOf(text);
  const base = text.endsWith('\n') ? text : `${text}${eol}`;
  return `${base}${eol}## ${heading}${eol}${eol}${body.trim().split('\n').join(eol)}${eol}`;
}

// --- порядок очереди ----------------------------------------------------------------------

// Очередь по возрастанию «Порядка», при равенстве — по номеру. Файл без порядка или с
// нечисловым идёт в конец: команды его не роняют, краснеет на нём `lint`.
export function queueOrder(tasks) {
  const rows = tasks
    .filter((t) => t.status === 'queue')
    .map((t) => ({ task: t, rank: orderOf(readText(t.file)) }));
  const key = (r) => (r.rank === null || Number.isNaN(r.rank) ? Number.POSITIVE_INFINITY : r.rank);
  return rows.sort((a, b) => key(a) - key(b) || a.task.num - b.task.num || (a.task.sub ?? 0) - (b.task.sub ?? 0));
}

export function nextRank(rows) {
  const ranks = rows.map((r) => r.rank).filter((r) => Number.isInteger(r));
  return ranks.length ? Math.max(...ranks) + RANK_STEP : RANK_STEP;
}

// Место в очереди: сверху, после задачи M или в конец. Между соседями берётся середина;
// когда целого места нет — очередь перенумеровывается шагом RANK_STEP, порядок сохраняется.
// Возвращает { rank, renumbered: [[file, rank], …] }.
export function placeInQueue(rows, { top = false, after = null } = {}) {
  const ordered = rows.filter((r) => Number.isInteger(r.rank));
  if (!top && after === null) return { rank: nextRank(rows), renumbered: [] };
  let lower;
  let upper;
  if (top) {
    lower = 0;
    upper = ordered.length ? ordered[0].rank : null;
  } else {
    const idx = ordered.findIndex((r) => sameId(r.task, after));
    if (idx === -1) {
      const label = `${after.num}${after.sub === null ? '' : `.${after.sub}`}`;
      const unranked = rows.find((r) => sameId(r.task, after));
      if (unranked) throw new CliError(`у задачи ${label} в очереди нет целого «${FIELD_ORDER}» — сначала поправь его`);
      throw new CliError(`задачи ${label} в очереди нет — --after ждёт задачу из queue/`);
    }
    lower = ordered[idx].rank;
    upper = idx + 1 < ordered.length ? ordered[idx + 1].rank : null;
  }
  if (upper === null) return { rank: lower + RANK_STEP, renumbered: [] };
  if (upper - lower >= 2) return { rank: Math.floor((lower + upper) / 2), renumbered: [] };
  // Места нет: всем по новому рангу с шагом, новичок встаёт между.
  const renumbered = [];
  let rank = 0;
  let mine = null;
  const insertBefore = top ? 0 : ordered.findIndex((r) => sameId(r.task, after)) + 1;
  ordered.forEach((r, i) => {
    if (i === insertBefore) {
      rank += RANK_STEP;
      mine = rank;
    }
    rank += RANK_STEP;
    renumbered.push([r.task.file, rank]);
  });
  if (mine === null) {
    rank += RANK_STEP;
    mine = rank;
  }
  return { rank: mine, renumbered };
}

// --- перенос файла ------------------------------------------------------------------------

// Переезд — `git mv`, чтобы история файла не оборвалась; файл вне индекса git (не добавлен
// или репозитория нет) переезжает обычным rename.
export function moveFile(root, from, to) {
  mkdirSync(path.dirname(to), { recursive: true });
  const tracked = git(root, ['ls-files', '--error-unmatch', '--', from]);
  if (tracked.status === 0) {
    gitOrFail(root, ['mv', '--', from, to]);
    return 'git';
  }
  renameSync(from, to);
  return 'fs';
}
