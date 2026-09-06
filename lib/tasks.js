// Задачи: скан каталогов статусов и архива, разбор имени и шапки, выдача номеров и порядка.
// Состояние — файлы; никакого индекса и счётчика: номер считается по тому, что лежит на диске.
import { existsSync, readdirSync, readFileSync, realpathSync, renameSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { STATUSES } from './config.js';
import { rewriteIncomingLinks, rewriteMovedLinks } from './links.js';
import { repoMarkdown } from './mdwalk.js';
import { CliError, git, gitOrFail, toPosix, warn } from './util.js';
import { tr } from './i18n.js';

export const FIELD_ORDER = 'order';
export const FIELD_AREA = 'area';
export const FIELD_CREATED = 'created';
export const FIELD_TAKEN = 'taken';
export const FIELD_DEPS = 'dependencies';
export const SECTION_DEFERRED = 'deferred';

const FIELD_NAMES = {
  order: { ru: 'Порядок', en: 'Order' },
  area: { ru: 'Область', en: 'Scope', compatibility: 'Area' },
  created: { ru: 'Создана', en: 'Created' },
  taken: { ru: 'Взята', en: 'Taken' },
  dependencies: { ru: 'Зависимости', en: 'Dependencies' },
};
const SECTION_NAMES = { deferred: { ru: 'Отложено', en: 'Deferred' } };

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

// Каноническая форма номера для сравнения: `BS-007` и `BS-7` — одна задача. Форма записи
// (ведущие нули из имени файла) — не часть номера; равенство держится на числах.
// Строка не разбирается — null: вызывающий сам решает, ошибка это или чужой текст.
export function canonicalId(raw, prefix) {
  const m = String(raw ?? '').trim().match(new RegExp(`^(?:${prefix}-)?(\\d+)(?:\\.(\\d+))?$`, 'i'));
  return m ? formatId(prefix, Number(m[1]), m[2] === undefined ? null : Number(m[2])) : null;
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

// `id` хранит форму из имени файла (`BS-007`, если так назван): по ней строятся имена
// каталога архива и ссылки, и переименовывать задачу ради нулей никто не обязан. Числа —
// в `num` и `sub`; сравнивать номера — через них или `canonicalId`.
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

// Файл задачи прямо в docs/backlog/ — плоский бэклог до раскладки по статусам. `scanTasks` его
// не видит и `lint` красит (гейт 3), но `mv` обязан его подобрать: иначе миграция чужого
// трекера — ровно тот случай, где инструмент нужен больше всего, — идёт руками.
export function findFlatTask({ root, cfg, dirs }, id) {
  if (!existsSync(dirs.backlog)) return null;
  const fileRe = taskFileRe(cfg.prefix);
  for (const name of readdirSync(dirs.backlog)) {
    const m = name.match(fileRe);
    if (!m) continue;
    const rec = record(root, cfg.prefix, 'backlog', path.join(dirs.backlog, name), m);
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

// Номера, занятые вне текущего дерева: файлами других worktree репозитория (на диске, включая
// незакоммиченные) и деревьями всех локальных веток. Worker в своём worktree и оркестратор в
// основном дереве иначе выдают один номер и находят это только `lint` при слиянии. Клоны и
// удалённые ветки локально не видны — их столкновение по-прежнему ловит `lint`.
// Возвращает [{ num, sub, source }], source — «worktree <путь> (<ветка>)» или «ветка <имя>»;
// без git или вне репозитория — пусто.
export function foreignTaskIds({ root, cfg }, lang = 'ru') {
  const top = git(root, ['rev-parse', '--show-toplevel']);
  if (top.status !== 0) return [];
  // Оба пути — через realpath: `/var` и `/private/var` на macOS иначе дают мусорный relative.
  const toplevel = safeRealpath(top.stdout.trim());
  const here = safeRealpath(root);
  if (!toplevel || !here) return [];
  const inner = toPosix(path.relative(toplevel, here));
  const docsRel = inner ? `${inner}/${cfg.docs}` : cfg.docs;
  const fileRe = taskFileRe(cfg.prefix);
  const dirRe = taskDirRe(cfg.prefix);
  const out = [];
  const seen = new Set();
  const add = (m, source) => {
    const key = `${Number(m[1])}.${m[2] ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ num: Number(m[1]), sub: m[2] === undefined ? null : Number(m[2]), source });
  };
  // Путь файла относительно docs: backlog/<статус>/<файл>.md или archive/<каталог>/…
  const fromDocsPath = (rel, source) => {
    const parts = rel.split('/');
    if (parts[0] === 'backlog' && parts.length === 3 && STATUSES.includes(parts[1])) {
      const m = parts[2].match(fileRe);
      if (m) add(m, source);
    } else if (parts[0] === 'archive' && parts.length >= 2) {
      const m = parts[1].match(dirRe);
      if (m) add(m, source);
    }
  };

  const list = git(root, ['worktree', 'list', '--porcelain']);
  if (list.status === 0) {
    for (const block of list.stdout.split(/\n\n+/)) {
      const wtPath = block.match(/^worktree (.+)$/m)?.[1];
      if (!wtPath) continue;
      const wtRoot = inner ? path.join(wtPath, ...inner.split('/')) : wtPath;
      if (safeRealpath(wtRoot) === here) continue;
      const branch = block.match(/^branch refs\/heads\/(.+)$/m)?.[1] ?? 'detached';
      const source = `worktree ${wtPath} (${branch})`;
      const docs = path.join(wtRoot, cfg.docs);
      for (const status of STATUSES) {
        const dir = path.join(docs, 'backlog', status);
        if (!existsSync(dir)) continue;
        for (const name of readdirSync(dir)) fromDocsPath(`backlog/${status}/${name}`, source);
      }
      const archive = path.join(docs, 'archive');
      if (existsSync(archive)) for (const name of readdirSync(archive)) fromDocsPath(`archive/${name}/task.md`, source);
    }
  }

  const branches = git(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/']);
  if (branches.status === 0) {
    for (const branch of branches.stdout.split('\n').map((b) => b.trim()).filter(Boolean)) {
      const tree = git(root, ['ls-tree', '-r', '--name-only', branch, '--', `${docsRel}/backlog`, `${docsRel}/archive`]);
      if (tree.status !== 0) continue;
      const source = tr(lang, `ветка ${branch}`, `branch ${branch}`);
      for (const file of tree.stdout.split('\n')) {
        if (file.startsWith(`${docsRel}/`)) fromDocsPath(file.slice(docsRel.length + 1), source);
      }
    }
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

export function orderOf(text) {
  const raw = getField(text, FIELD_ORDER);
  if (raw === null) return null;
  return /^-?\d+$/.test(raw) ? Number(raw) : Number.NaN;
}

// --- разделы ------------------------------------------------------------------------------

export function sectionBody(text, heading) {
  const lines = splitLines(text);
  const aliases = sectionAliases(heading);
  const start = lines.findIndex((l) => aliases.has(headingText(l)));
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (headingText(lines[i]) !== null) { end = i; break; }
  }
  return lines.slice(start + 1, end).join('\n').trim();
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

export function nextRank(rows) {
  const ranks = rows.map((r) => r.rank).filter((r) => Number.isInteger(r));
  return ranks.length ? Math.max(...ranks) + RANK_STEP : RANK_STEP;
}

// Место в очереди: сверху, после задачи M или в конец. Между соседями берётся середина;
// когда целого места нет — очередь перенумеровывается шагом RANK_STEP, порядок сохраняется.
// Возвращает { rank, renumbered: [[file, rank], …] }.
export function placeInQueue(rows, { top = false, after = null } = {}, lang = 'ru') {
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
      if (unranked) throw new CliError(tr(lang,
        `у задачи ${label} в очереди нет целого «${fieldName(FIELD_ORDER, lang)}» — сначала поправь его`,
        `queue task ${label} has no integer “${fieldName(FIELD_ORDER, lang)}” — fix it first`));
      throw new CliError(tr(lang,
        `задачи ${label} в очереди нет — --after ждёт задачу из queue/`,
        `task ${label} is not in the queue — --after expects a task from queue/`));
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

// Перенос задачи и перепись ссылок обеих сторон. В dry-run файл остаётся на месте, но
// список изменившихся путей считается так же, как при настоящем переезде.
export function relocateTask(project, task, newRel, { dry = false } = {}) {
  const { root, cfg } = project;
  const newFile = path.join(root, ...newRel.split('/'));
  if (!dry) {
    const how = moveFile(root, task.file, newFile);
    if (how === 'fs') warn(tr(cfg.lang, 'файл не в индексе git — перенесён без git mv', 'file is not tracked by git — moved without git mv'));
  }

  const changed = [];
  const source = dry ? task.file : newFile;
  const before = readText(source);
  const after = rewriteMovedLinks(before, path.posix.dirname(task.rel), path.posix.dirname(newRel));
  if (after !== before) {
    changed.push(newRel);
    if (!dry) writeText(source, after);
  }

  for (const [rel, abs] of repoMarkdown(root)) {
    if (rel === newRel || rel === task.rel) continue;
    const text = readText(abs);
    const next = rewriteIncomingLinks(text, path.posix.dirname(rel), task.rel, newRel);
    if (next === text) continue;
    changed.push(rel);
    if (!dry) writeText(abs, next);
  }
  return changed;
}
