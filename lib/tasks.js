// Задачи: скан каталогов статусов и архива, разбор имени и шапки, выдача номеров и порядка.
// Состояние — файлы; никакого индекса и счётчика: номер считается по тому, что лежит на диске.
import { existsSync, readdirSync, readFileSync, realpathSync, renameSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { STATUSES } from './config.js';
import { blankCode, blankFences, repoPrefix, rewriteIncomingLinks, rewriteMovedLinks } from './links.js';
import { LOG_FILE, batchOf, logFile, readLogText } from './log.js';
import { repoMarkdown } from './mdwalk.js';
import { CliError, git, gitCause, gitOrFail, insideRepo, toPosix, warn, worktrees } from './util.js';
import { tr } from './i18n.js';

export const FIELD_ORDER = 'order';
export const FIELD_AREA = 'area';
export const FIELD_CREATED = 'created';
export const FIELD_TAKEN = 'taken';
export const FIELD_DEPS = 'dependencies';
export const FIELD_PARENT = 'parent';
export const FIELD_COST = 'cost';
export const FIELD_PREV_ORDER = 'previousOrder';
export const SECTION_DEFERRED = 'deferred';
export const SECTION_WORK = 'work';
export const SECTION_OUT = 'outOfScope';
export const SECTION_CHECKS = 'verification';
export const SECTION_CONTEXT = 'context';
export const SECTION_EVIDENCE = 'evidence';

const FIELD_NAMES = {
  order: { ru: 'Порядок', en: 'Order' },
  previousOrder: { ru: 'Прежний порядок', en: 'Previous order' },
  area: { ru: 'Область', en: 'Scope', compatibility: 'Area' },
  created: { ru: 'Создана', en: 'Created' },
  taken: { ru: 'Взята', en: 'Taken' },
  dependencies: { ru: 'Зависимости', en: 'Dependencies' },
  parent: { ru: 'Родитель', en: 'Parent' },
  cost: { ru: 'Цена', en: 'Cost' },
};
const SECTION_NAMES = {
  deferred: { ru: 'Отложено', en: 'Deferred' },
  work: { ru: 'Что сделать', en: 'Work to do' },
  outOfScope: { ru: 'Не входит', en: 'Out of scope' },
  verification: { ru: 'Проверки', en: 'Verification' },
  context: { ru: 'Контекст', en: 'Context' },
  evidence: { ru: 'Улика', en: 'Evidence' },
};

export function fieldName(name, lang = 'ru') {
  return FIELD_NAMES[name]?.[lang] ?? name;
}

export function sectionName(name, lang = 'ru') {
  return SECTION_NAMES[name]?.[lang] ?? name;
}

function fieldAliases(name) {
  const names = FIELD_NAMES[name];
  return names ? new Set(Object.values(names)) : new Set([name]);
}

function sectionAliases(name) {
  const names = SECTION_NAMES[name];
  return names ? new Set(Object.values(names)) : new Set([name]);
}

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RANK_STEP = 10;

// «Цена» находки: уровень по шкале reviewer'а и пометка гипотезы — `major (гипотеза)`.
export const COST_LEVELS = ['critical', 'major', 'minor'];
const COST_RE = /^(critical|major|minor)(?:\s*\((гипотеза|hypothesis)\))?$/i;

export function parseCost(value) {
  const m = String(value ?? '').trim().match(COST_RE);
  return m ? { level: m[1].toLowerCase(), hypothesis: m[2] !== undefined } : null;
}

export function formatCost(level, hypothesis, lang = 'ru') {
  return hypothesis ? `${level} (${lang === 'en' ? 'hypothesis' : 'гипотеза'})` : level;
}

// Строка поля шапки: `- **Имя:** значение`.
const FIELD_RE = /^- \*\*([^*:\n]+):\*\*[ \t]*(.*)$/;
const TITLE_RE = /^# (\S+) · (.+)$/;

export function taskFileRe(prefix) {
  return new RegExp(`^${prefix}-(\\d+)(?:\\.(\\d+))?-([a-z0-9]+(?:-[a-z0-9]+)*)\\.md$`);
}

export function taskDirRe(prefix) {
  return new RegExp(`^${prefix}-(\\d+)(?:\\.(\\d+))?-([a-z0-9]+(?:-[a-z0-9]+)*)$`);
}

// Упоминание `BS-12` или `BS-12.3`: справа не цифра и не точка с цифрой, иначе `BS-12.3`
// читался бы как `BS-12` плюс хвост.
export function idMentionRe(prefix) {
  return new RegExp(`\\b${prefix}-(\\d+)(?:\\.(\\d+))?(?![\\d.]*\\d)`, 'g');
}

export function formatId(prefix, num, sub = null) {
  return sub === null || sub === undefined ? `${prefix}-${num}` : `${prefix}-${num}.${sub}`;
}

// «12», «BS-12», «12.3», «bs-12.3» → { num, sub }. Иное — отказ.
export function parseId(raw, prefix, lang = 'ru') {
  const m = String(raw ?? '').trim().match(new RegExp(`^(?:${prefix}-)?(\\d+)(?:\\.(\\d+))?$`, 'i'));
  if (!m) throw new CliError(tr(lang,
    `номер задачи «${raw}» не разбирается: нужен N или N.k, можно с префиксом ${prefix}-`,
    `task number “${raw}” is invalid: expected N or N.k, optionally prefixed with ${prefix}-`));
  return { num: Number(m[1]), sub: m[2] === undefined ? null : Number(m[2]) };
}

export function sameId(a, b) {
  return a.num === b.num && (a.sub ?? null) === (b.sub ?? null);
}

// `BS-007` и `BS-7` — одна задача: равенство держится на числах, а не на форме записи.
// Строка не разбирается — `null`: ошибка это или чужой текст, решает вызывающий.
export function canonicalId(raw, prefix) {
  const m = String(raw ?? '').trim().match(new RegExp(`^(?:${prefix}-)?(\\d+)(?:\\.(\\d+))?$`, 'i'));
  return m ? formatId(prefix, Number(m[1]), m[2] === undefined ? null : Number(m[2])) : null;
}

// Все задачи по номеру: каталог на статус, несвёрнутые каталоги архива и строки журнала — оба
// источника архива живут рядом (ADR-026). Файл не по шаблону имени — не задача, его ловит `lint`.
export function scanTasks({ root, cfg, dirs }) {
  const out = [];
  const fileRe = taskFileRe(cfg.prefix);
  for (const status of STATUSES) {
    const dir = dirs.statusDir[status];
    if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const m = e.name.match(fileRe);
      if (!m || !isFileEntry(dir, e)) continue;
      out.push(record(root, cfg.prefix, status, path.join(dir, e.name), m));
    }
  }
  const dirRe = taskDirRe(cfg.prefix);
  if (existsSync(dirs.archive) && statSync(dirs.archive).isDirectory()) {
    for (const name of readdirSync(dirs.archive)) {
      const m = name.match(dirRe);
      if (!m) continue;
      const file = path.join(dirs.archive, name, 'task.md');
      const rec = record(root, cfg.prefix, 'archive', file, m);
      rec.dir = path.join(dirs.archive, name);
      rec.hasTask = existsSync(file);
      rec.hasResult = existsSync(path.join(dirs.archive, name, 'result.md'));
      out.push(rec);
      // Записи minor, закрытые пачкой (`archive N.k --into M`), лежат в её подкаталоге minor/.
      const minorDir = path.join(dirs.archive, name, 'minor');
      if (!existsSync(minorDir) || !statSync(minorDir).isDirectory()) continue;
      for (const e of readdirSync(minorDir, { withFileTypes: true })) {
        const mm = e.name.match(fileRe);
        if (!mm || !isFileEntry(minorDir, e)) continue;
        const sub = record(root, cfg.prefix, 'archive', path.join(minorDir, e.name), mm);
        sub.dir = rec.dir;
        sub.hasTask = true;
        sub.hasResult = true;
        sub.into = rec.id;
        out.push(sub);
      }
    }
  }
  for (const rec of logTasks({ root, cfg, dirs })) out.push(rec);
  return out.sort((a, b) => a.num - b.num || (a.sub ?? -1) - (b.sub ?? -1) || a.rel.localeCompare(b.rel));
}

// Свёрнутая задача — запись журнала в статусе archive без тела: `file` и `rel` указывают на сам
// журнал, где запись лежит, а `hasTask: false` читают те, кому нужна постановка (`brief`).
function logTasks({ root, cfg, dirs }) {
  const file = logFile(dirs);
  if (!existsSync(file)) return [];
  const rel = toPosix(path.relative(root, file));
  return readLogText(readText(file), cfg.prefix).map((e) => {
    const rec = {
      id: e.id,
      num: e.num,
      sub: e.sub,
      slug: e.slug,
      status: 'archive',
      file,
      rel,
      folded: true,
      hasTask: false,
      hasResult: false,
      log: e,
    };
    // Запись, закрытая пачкой, остаётся записью и после свёртки: `status` считает архивом
    // закрытые задачи, а не пункты пачек, и признак принадлежности несёт исход.
    const into = batchOf(e.outcome);
    if (into !== null) rec.into = into;
    return rec;
  });
}

// Каталог и symlink на каталог — не задача (их называет гейт 2 `lint`), а чтение их как файла
// роняло бы команду на EISDIR. Прочее доразрешается stat: битая ссылка — тоже не задача.
function isFileEntry(dir, e) {
  if (e.isDirectory()) return false;
  if (e.isFile()) return true;
  try {
    return statSync(path.join(dir, e.name)).isFile();
  } catch {
    return false;
  }
}

// `id` хранит форму из имени файла (`BS-007`): по ней строятся каталог архива и ссылки. Числа —
// в `num` и `sub`; номера сравниваются через них или `canonicalId`.
function record(root, prefix, status, file, m) {
  const num = Number(m[1]);
  const sub = m[2] === undefined ? null : Number(m[2]);
  return {
    id: formatId(prefix, m[1], m[2] ?? null),
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
export function findTask(tasks, id, lang = 'ru') {
  const hits = tasks.filter((t) => sameId(t, id));
  if (hits.length > 1) {
    throw new CliError(tr(lang,
      `номер ${hits[0].id} занят дважды: ${hits.map((t) => t.rel).join(', ')} — разведи номера, lint это тоже покажет`,
      `number ${hits[0].id} is used twice: ${hits.map((t) => t.rel).join(', ')} — assign distinct numbers; lint reports this too`));
  }
  return hits[0] ?? null;
}

// Файл задачи прямо в docs/backlog/ (миграция чужого трекера): `scanTasks` его не видит, `lint`
// красит гейтом 3, а `mv` подбирает — иначе миграция шла бы руками.
export function findFlatTask({ root, cfg, dirs }, id) {
  if (!existsSync(dirs.backlog)) return null;
  const fileRe = taskFileRe(cfg.prefix);
  for (const e of readdirSync(dirs.backlog, { withFileTypes: true })) {
    const m = e.name.match(fileRe);
    if (!m || !isFileEntry(dirs.backlog, e)) continue;
    const rec = record(root, cfg.prefix, 'backlog', path.join(dirs.backlog, e.name), m);
    if (sameId(rec, id)) return rec;
  }
  return null;
}

export function nextNumber(tasks) {
  return tasks.reduce((max, t) => Math.max(max, t.num), 0) + 1;
}

export function nextSub(tasks, parentNum) {
  return tasks.filter((t) => t.num === parentNum && t.sub !== null).reduce((max, t) => Math.max(max, t.sub), 0) + 1;
}

// Номера, занятые другими worktree (по диску) и локальными ветками, как `[{ num, sub, source }]`;
// без git — пусто. Клоны и удалённые ветки не видны (docs/reference/01-layout.md, «Файл задачи»).
export function foreignTaskIds({ root, cfg }, lang = 'ru') {
  if (!insideRepo(root, lang)) return [];
  const must = (args) => {
    const r = git(root, args);
    if (r.status !== 0) throw new CliError(`git ${args.join(' ')}: ${gitCause(r, lang)}`);
    return r.stdout;
  };
  const top = must(['rev-parse', '--show-toplevel']);
  // Оба пути — через realpath: `/var` и `/private/var` на macOS иначе дают мусорный relative.
  const toplevel = safeRealpath(top.trim());
  const here = safeRealpath(root);
  if (!toplevel || !here) return [];
  const inner = toPosix(path.relative(toplevel, here));
  const docsRel = inner ? `${inner}/${cfg.docs}` : cfg.docs;
  const fileRe = taskFileRe(cfg.prefix);
  const dirRe = taskDirRe(cfg.prefix);
  const out = [];
  const seen = new Set();
  const add = (num, sub, source) => {
    const key = `${num}.${sub ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ num, sub: sub ?? null, source });
  };
  const addMatch = (m, source) => add(Number(m[1]), m[2] === undefined ? null : Number(m[2]), source);
  const fromLog = (text, source) => {
    for (const e of readLogText(text, cfg.prefix)) add(e.num, e.sub, source);
  };
  // Путь файла относительно docs: backlog/<статус>/<файл>.md или archive/<каталог>/…
  const fromDocsPath = (rel, source) => {
    const parts = rel.split('/');
    if (parts[0] === 'backlog' && parts.length === 3 && STATUSES.includes(parts[1])) {
      const m = parts[2].match(fileRe);
      if (m) addMatch(m, source);
    } else if (parts[0] === 'archive' && parts.length === 4 && parts[2] === 'minor') {
      const m = parts[3].match(fileRe);
      if (m) addMatch(m, source);
    } else if (parts[0] === 'archive' && parts.length >= 2) {
      const m = parts[1].match(dirRe);
      if (m) addMatch(m, source);
    }
  };

  for (const wt of worktrees(root, lang)) {
    const wtRoot = inner ? path.join(wt.path, ...inner.split('/')) : wt.path;
    if (safeRealpath(wtRoot) === here) continue;
    const source = `worktree ${wt.path} (${wt.branch ?? 'detached'})`;
    const docs = path.join(wtRoot, cfg.docs);
    for (const status of STATUSES) {
      const dir = path.join(docs, 'backlog', status);
      if (!existsSync(dir)) continue;
      for (const name of readdirSync(dir)) fromDocsPath(`backlog/${status}/${name}`, source);
    }
    const archive = path.join(docs, 'archive');
    if (existsSync(archive)) {
      for (const name of readdirSync(archive)) {
        fromDocsPath(`archive/${name}/task.md`, source);
        const minorDir = path.join(archive, name, 'minor');
        if (existsSync(minorDir)) for (const file of readdirSync(minorDir)) fromDocsPath(`archive/${name}/minor/${file}`, source);
      }
      const log = path.join(archive, LOG_FILE);
      if (existsSync(log)) fromLog(readText(log), source);
    }
  }

  const branches = must(['for-each-ref', '--format=%(refname:short)', 'refs/heads/']);
  for (const branch of branches.split('\n').map((b) => b.trim()).filter(Boolean)) {
    // Pathspec and output are relative to the project root, as in `fold.bodyRev`; `-z` leaves
    // non-ASCII paths unquoted.
    const tree = must(['ls-tree', '-r', '-z', '--name-only', branch, '--', `${cfg.docs}/backlog`, `${cfg.docs}/archive`]);
    const source = tr(lang, `ветка ${branch}`, `branch ${branch}`);
    const files = tree.split('\0').filter((file) => file.startsWith(`${cfg.docs}/`)).map((file) => file.slice(cfg.docs.length + 1));
    for (const file of files) fromDocsPath(file, source);
    // Номер свёрнутой задачи занят строкой журнала, а не именем файла: одно чтение журнала на
    // ветку, иначе номер закрытой задачи соседней ветки выдался бы повторно.
    if (files.includes(`archive/${LOG_FILE}`)) fromLog(must(['show', `${branch}:${docsRel}/archive/${LOG_FILE}`]), source);
  }
  return out;
}

function safeRealpath(p) {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
}

// --- текст файла --------------------------------------------------------------------------

// Файл читается без BOM; переводы строк сохраняются какими были — CRLF-файл после правки
// остаётся CRLF-файлом.
export function readText(file) {
  const text = readFileSync(file, 'utf8');
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

// A rewrite keeps the UTF-8 BOM the file had on disk; `readText` hands the text out without it.
export function writeText(file, text) {
  mkdirSync(path.dirname(file), { recursive: true });
  const keep = !text.startsWith('\uFEFF') && existsSync(file) && readFileSync(file).subarray(0, 3).equals(UTF8_BOM);
  const bom = keep ? '\uFEFF' : '';
  writeFileSync(file, bom + text);
}

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

export function eolOf(text) {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

export function splitLines(text) {
  return text.split(/\r?\n/);
}

// Заглушка `result.md` — `[TODO` вне кода: показанное в код-спане или фенсе — рассказ о ней.
// Одна проверка на гейт 5 `lint` и отказ `fold`, разбор — [03](../docs/reference/03-lint.md).
export function hasResultTodo(text) {
  return /\[TODO/.test(blankCode(text));
}

// --- шапка файла --------------------------------------------------------------------------

export function readTitle(text) {
  const m = splitLines(text)[0]?.match(TITLE_RE);
  return m ? { id: m[1], title: m[2].trim() } : null;
}

// ATX-заголовок раздела: до 3 пробелов отступа — валидный markdown.
function headingText(line) {
  const m = line.match(/^ {0,3}## (.*)$/);
  return m ? m[1].trim() : null;
}

// Индексы строк полей шапки — до первого раздела `## `.
function fieldLines(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (headingText(lines[i]) !== null) break;
    const m = lines[i].match(FIELD_RE);
    if (m) out.push([i, m[1].trim(), m[2].trim()]);
  }
  return out;
}

export function readFields(text) {
  const map = new Map();
  for (const [, name, value] of fieldLines(splitLines(text))) {
    if (!map.has(name)) map.set(name, value);
  }
  return map;
}

export function fieldOccurrences(text, name) {
  const aliases = fieldAliases(name);
  return fieldLines(splitLines(text)).filter(([, label]) => aliases.has(label));
}

export function getField(text, name) {
  return fieldOccurrences(text, name)[0]?.[2] ?? null;
}

export function setField(text, name, value, lang = 'ru') {
  const eol = eolOf(text);
  const lines = splitLines(text);
  const fields = fieldLines(lines);
  const label = fieldName(name, lang);
  const line = `- **${label}:** ${value}`;
  const own = fields.filter(([, n]) => fieldAliases(name).has(n));
  if (own.length) {
    lines[own[0][0]] = line;
    for (const [index] of own.slice(1).reverse()) lines.splice(index, 1);
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
  const own = fieldLines(lines).filter(([, n]) => fieldAliases(name).has(n));
  for (const [index] of own.reverse()) lines.splice(index, 1);
  return lines.join(eol);
}

export function orderOf(text, name = FIELD_ORDER) {
  const raw = getField(text, name);
  if (raw === null) return null;
  return /^-?\d+$/.test(raw) ? Number(raw) : Number.NaN;
}

// --- разделы ------------------------------------------------------------------------------

function sectionRanges(text, heading) {
  const sourceLines = splitLines(text);
  const cleanLines = splitLines(blankFences(text));
  const aliases = sectionAliases(heading);
  const starts = cleanLines.flatMap((line, index) => (aliases.has(headingText(line)) ? [index] : []));
  return starts.map((start) => {
    let end = cleanLines.length;
    for (let i = start + 1; i < cleanLines.length; i += 1) {
      if (headingText(cleanLines[i]) !== null) { end = i; break; }
    }
    return {
      start,
      end,
      body: sourceLines.slice(start + 1, end).join('\n').trim(),
    };
  });
}

export function sectionBody(text, heading) {
  return sectionRanges(text, heading)[0]?.body ?? null;
}

export function sectionOccurrences(text, heading) {
  return sectionRanges(text, heading).length;
}

export function appendSection(text, heading, body, lang = 'ru') {
  const eol = eolOf(text);
  const base = text.endsWith('\n') ? text : `${text}${eol}`;
  return `${base}${eol}## ${sectionName(heading, lang)}${eol}${eol}${body.trim().split('\n').join(eol)}${eol}`;
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

function nextRank(rows) {
  const ranks = rows.map((r) => r.rank).filter((r) => Number.isInteger(r));
  return ranks.length ? Math.max(...ranks) + RANK_STEP : RANK_STEP;
}

// Место в очереди: сверху, после M, на сохранённый ранг не позже `before` или в конец; середина и
// перенумерация — docs/reference/02-cli.md. Ответ { rank, renumbered, bounded? } — ADR-031.
export function placeInQueue(rows, { top = false, after = null, rank = null, before = null } = {}, lang = 'ru') {
  const ordered = rows.filter((r) => Number.isInteger(r.rank));
  if (!top && after === null && rank === null) return { rank: nextRank(rows), renumbered: [] };
  let lower;
  let upper;
  let insertBefore;
  let bounded = false;
  if (rank !== null) {
    // Сохранённый ранг свободен — задача встаёт ровно на него; занят — перед тем, кто его
    // занял: ранг по ADR-002 абсолютный, и вернуть можно место, а не тождественное число.
    const taken = ordered.findIndex((r) => r.rank === rank);
    // `before` — сосед по пакету --restore: место позже него уступает месту прямо перед ним,
    // и ответ несёт `bounded` (ADR-031).
    const limit = before === null ? -1 : ordered.findIndex((r) => sameId(r.task, before));
    bounded = limit !== -1 && (taken === -1 ? rank > ordered[limit].rank : taken > limit);
    insertBefore = bounded ? limit : taken;
    if (insertBefore === -1) return { rank, renumbered: [] };
    lower = insertBefore === 0 ? 0 : ordered[insertBefore - 1].rank;
    upper = ordered[insertBefore].rank;
  } else if (top) {
    insertBefore = 0;
    lower = 0;
    upper = ordered.length ? ordered[0].rank : null;
  } else {
    const idx = ordered.findIndex((r) => sameId(r.task, after));
    if (idx === -1) {
      const label = `${after.num}${after.sub === null ? '' : `.${after.sub}`}`;
      const unranked = rows.find((r) => sameId(r.task, after));
      if (unranked) throw new CliError(tr(lang,
        `у задачи ${label} в очереди нет целого «${fieldName(FIELD_ORDER, lang)}» — сначала поправь его`,
        `queue task ${label} has no integer “${fieldName(FIELD_ORDER, lang)}” — fix it first`));
      throw new CliError(tr(lang,
        `задачи ${label} в очереди нет — --after ждёт задачу из queue/`,
        `task ${label} is not in the queue — --after expects a task from queue/`));
    }
    insertBefore = idx + 1;
    lower = ordered[idx].rank;
    upper = idx + 1 < ordered.length ? ordered[idx + 1].rank : null;
  }
  if (upper === null) return { rank: lower + RANK_STEP, renumbered: [] };
  if (upper - lower >= 2) return { rank: Math.floor((lower + upper) / 2), renumbered: [], ...(bounded && { bounded }) };
  // Места нет: всем по новому рангу с шагом, новичок встаёт между.
  const renumbered = [];
  let next = 0;
  let mine = null;
  ordered.forEach((r, i) => {
    if (i === insertBefore) {
      next += RANK_STEP;
      mine = next;
    }
    next += RANK_STEP;
    renumbered.push([r.task.file, next]);
  });
  if (mine === null) {
    next += RANK_STEP;
    mine = next;
  }
  return { rank: mine, renumbered, ...(bounded && { bounded }) };
}

// --- перенос файла ------------------------------------------------------------------------

// Переезд — `git mv`, чтобы история файла не оборвалась; файл вне индекса git (не добавлен
// или репозитория нет) переезжает обычным rename. Any other git failure refuses before the move.
function moveFile(root, from, to, lang) {
  const tracked = insideRepo(root, lang) ? git(root, ['ls-files', '--error-unmatch', '--', from]) : null;
  if (tracked !== null && tracked.status !== 0 && tracked.status !== 1) {
    throw new CliError(`git ls-files --error-unmatch: ${gitCause(tracked, lang)}`);
  }
  mkdirSync(path.dirname(to), { recursive: true });
  if (tracked?.status === 0) {
    gitOrFail(root, ['mv', '--', from, to]);
    return 'git';
  }
  renameSync(from, to);
  return 'fs';
}

// Перенос задачи и перепись ссылок обеих сторон. В dry-run файл остаётся на месте, но
// список изменившихся путей считается так же, как при настоящем переезде.
export function relocateTask(project, task, newRel, { dry = false } = {}) {
  const { root, cfg } = project;
  const newFile = path.join(root, ...newRel.split('/'));
  const prefix = repoPrefix(root, cfg.lang);
  if (!dry) {
    const how = moveFile(root, task.file, newFile, cfg.lang);
    if (how === 'fs') warn(tr(cfg.lang, 'файл не в индексе git — перенесён без git mv', 'file is not tracked by git — moved without git mv'));
  }

  const changed = [];
  const source = dry ? task.file : newFile;
  const before = readText(source);
  // A link to the file itself first names its new path from the old directory; the re-base
  // below then shortens it to the new basename.
  const self = rewriteIncomingLinks(before, path.posix.dirname(task.rel), task.rel, newRel, prefix);
  const after = rewriteMovedLinks(self, path.posix.dirname(task.rel), path.posix.dirname(newRel));
  if (after !== before) {
    changed.push(newRel);
    if (!dry) writeText(source, after);
  }

  for (const [rel, abs] of repoMarkdown(root)) {
    if (rel === newRel || rel === task.rel) continue;
    const text = readText(abs);
    const next = rewriteIncomingLinks(text, path.posix.dirname(rel), task.rel, newRel, prefix);
    if (next === text) continue;
    changed.push(rel);
    if (!dry) writeText(abs, next);
  }
  return changed;
}
