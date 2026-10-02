// Tasks: scanning the status and archive directories, parsing names and headers, issuing numbers
// and order. State is files, no index or counter: numbers are counted from what is on disk.
import { existsSync, lstatSync, readdirSync, readlinkSync, renameSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { STATUSES, expectDirectory, expectNameFits } from './config.js';
import { SLUG_SRC, formatId, matchId, taskStemSrc } from './ids.js';
import { blankCode, blankFences, repoPrefix, rewriteIncomingLinks, rewriteMovedLinks } from './links.js';
import { LOG_FILE, batchOf, logFile, readLogText } from './log.js';
import { UnreadableDir, insideProject, linkBase, readDirEntries, repoMarkdown, wordUnreadable } from './mdwalk.js';
import { renderProjectTemplate } from './templates.js';
import {
  CliError, git, gitCause, gitOrFail, insideRepo, isSameTree, isTracked, localBranches, readText, realpathOrNull, statOrNull, toPosix, today, warn, worktrees, writeText,
} from './util.js';
import { RU, msg } from './i18n.js';
import { eolOf, splitLines } from './text.js';

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

// The English names; the Russian ones are RU.fieldNames and RU.sectionNames under the same keys.
const FIELD_NAMES = {
  order: 'Order',
  previousOrder: 'Previous order',
  area: 'Scope',
  created: 'Created',
  taken: 'Taken',
  dependencies: 'Dependencies',
  parent: 'Parent',
  cost: 'Cost',
};
const SECTION_NAMES = {
  deferred: 'Deferred',
  work: 'Work to do',
  outOfScope: 'Out of scope',
  verification: 'Verification',
  context: 'Context',
  evidence: 'Evidence',
};

function named(names, ruNames, name, lang) {
  if (!Object.hasOwn(names, name)) return name;
  return (lang === 'en' ? names[name] : lang === 'ru' ? ruNames[name] : undefined) ?? name;
}

export function fieldName(name, lang = 'ru') {
  return named(FIELD_NAMES, RU.fieldNames, name, lang);
}

export function sectionName(name, lang = 'ru') {
  return named(SECTION_NAMES, RU.sectionNames, name, lang);
}

function aliases(names, ruNames, name) {
  return Object.hasOwn(names, name) ? new Set([ruNames[name], names[name]]) : new Set([name]);
}

function fieldAliases(name) {
  return aliases(FIELD_NAMES, RU.fieldNames, name);
}

function sectionAliases(name) {
  return aliases(SECTION_NAMES, RU.sectionNames, name);
}

export const SLUG_RE = new RegExp(`^${SLUG_SRC}$`);
const RANK_STEP = 10;

// The "cost" of a finding: a level on the reviewer's scale and a hypothesis mark,
// `major (hypothesis)`.
export const COST_LEVELS = ['critical', 'major', 'minor'];
const COST_RE = new RegExp(`^(critical|major|minor)(?:\\s*\\((${msg('ru', 'hypothesis')}|hypothesis)\\))?$`, 'i');

export function parseCost(value) {
  const m = String(value ?? '').trim().match(COST_RE);
  return m ? { level: m[1].toLowerCase(), hypothesis: m[2] !== undefined } : null;
}

export function formatCost(level, hypothesis, lang = 'ru') {
  return hypothesis ? `${level} (${msg(lang, 'hypothesis')})` : level;
}

// A header field line: `- **Name:** value`.
export const FIELD_RE = /^- \*\*([^*:\n]+):\*\*[ \t]*(.*)$/;
const TITLE_RE = /^# (\S+) · (.+)$/;

export function taskFileRe(prefix) {
  return new RegExp(`^${taskStemSrc(prefix)}\\.md$`);
}

export function taskDirRe(prefix) {
  return new RegExp(`^${taskStemSrc(prefix)}$`);
}

// A mention `BS-12` or `BS-12.3`: on the right neither a digit nor a dot with a digit, or `BS-12.3`
// would read as `BS-12` plus a tail.
export function idMentionRe(prefix) {
  return new RegExp(`\\b${prefix}-(\\d+)(?:\\.(\\d+))?(?![\\d.]*\\d)`, 'g');
}

// "12", "BS-12", "12.3", "bs-12.3" → { num, sub }. Anything else is a refusal.
export function parseId(raw, prefix, lang = 'ru') {
  const id = matchId(raw, prefix);
  if (!id) throw new CliError(msg(lang,
    'task number “{raw}” is invalid: expected N or N.k, optionally prefixed with {prefix}-', { raw, prefix }));
  return id;
}

export function sameId(a, b) {
  return a.num === b.num && (a.sub ?? null) === (b.sub ?? null);
}

// `BS-007` and `BS-7` are one task: equality rests on the numbers, not on the spelling. A string
// that does not parse gives `null`: whether it is an error or foreign text, the caller decides.
export function canonicalId(raw, prefix) {
  const id = matchId(raw, prefix);
  return id ? formatId(prefix, id.num, id.sub) : null;
}

// A directory by its stat. A path that cannot be searched is not an absent one: the directory
// that denies it is named, else a locked `docs/backlog` would read as an empty backlog.
export function isDirectory(root, dir) {
  try {
    return statSync(dir).isDirectory();
  } catch (e) {
    if (e.code !== 'EACCES' && e.code !== 'EPERM') return false;
    throw new UnreadableDir(denyingDir(root, dir), e.code);
  }
}

// The last directory on the way to `dir` that can be stat-ed: the one that denies the search
// below it. A symlink on the way is followed to its target, which may lie elsewhere.
function denyingDir(root, dir) {
  let denying = root;
  let parts = path.relative(root, dir).split(path.sep);
  for (let hops = 0; parts.length > 0;) {
    const next = path.join(denying, parts[0]);
    if (statOrNull(next) !== null) {
      denying = next;
      parts = parts.slice(1);
      continue;
    }
    let target = null;
    try {
      if (lstatSync(next).isSymbolicLink()) target = path.resolve(denying, readlinkSync(next));
    } catch {
      // not a link: the walk stops here
    }
    if (target === null || (hops += 1) > 40) break;
    denying = path.parse(target).root;
    parts = [...path.relative(denying, target).split(path.sep), ...parts.slice(1)];
  }
  return denying;
}

// The real path of one that may not exist: the deepest existing ancestor resolves, the rest stays.
function realpathLoose(target) {
  const tail = [];
  for (let at = target; at !== path.dirname(at); at = path.dirname(at)) {
    const real = realpathOrNull(at);
    if (real !== null) return path.join(real, ...tail);
    tail.unshift(path.basename(at));
  }
  return target;
}

// A status directory that is a symlink leading out of the project is not followed (gate 3). When
// its target cannot be resolved, the link text decides: a missing path inside the project is in.
export function leadsOut(root, dir) {
  try {
    if (!lstatSync(dir).isSymbolicLink()) return false;
    if (realpathOrNull(dir) !== null) return !insideProject(root, dir);
    const parent = path.dirname(dir);
    const target = realpathLoose(path.resolve(realpathOrNull(parent) ?? parent, readlinkSync(dir)));
    const rel = path.relative(realpathOrNull(root) ?? root, target);
    return rel === '' || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
  } catch {
    return false;
  }
}

// The status directories and archive task directories the scan skips as outside links, as paths
// from the project root. The scan prints nothing; a command that reads tasks calls `warnLinkedOut`.
export function linkedOutDirs({ root, cfg, dirs }) {
  const dirRe = taskDirRe(cfg.prefix);
  let archived = [];
  try {
    archived = readdirSync(dirs.archive).filter((name) => dirRe.test(name)).map((name) => path.join(dirs.archive, name));
  } catch {
    // an archive that is absent or unreadable is worded by the scan
  }
  return [...STATUSES.map((status) => dirs.statusDir[status]), ...archived]
    .filter((dir) => leadsOut(root, dir)).map((dir) => toPosix(path.relative(root, dir)));
}

export function warnLinkedOut(project) {
  for (const rel of linkedOutDirs(project)) {
    warn(msg(project.cfg.lang, '{rel}: a symlink leading out of the project — the tasks in it are not read; point the link inside the project or replace it with a directory', { rel }));
  }
}

// Numbers come from the scan, so a skipped directory could hold a number given out again.
function expectNoLinkedOut(project) {
  const [rel] = linkedOutDirs(project);
  if (rel === undefined) return;
  throw new CliError(msg(project.cfg.lang, '{rel}: a symlink leading out of the project — the tasks in it are not read, so a new task number cannot be chosen; point the link inside the project or replace it with a directory', { rel }));
}

export function expectLinkInside(root, dir, lang) {
  if (!leadsOut(root, dir)) return;
  throw new CliError(msg(lang, '{rel}: a symlink leading out of the project — a task cannot be written into it; point the link inside the project or replace it with a directory', { rel: toPosix(path.relative(root, dir)) }));
}

// All tasks by number: a directory per status, unfolded archive directories and journal lines —
// both archive sources (ADR-044). A file off the name template is no task: `lint` catches it.
export function scanTasks({ root, cfg, dirs }) {
  const what = msg(cfg.lang, 'tasks cannot be read from it');
  const list = (dir, options) => wordUnreadable(root, cfg.lang, what, () => readDirEntries(dir, options));
  const isDir = (dir) => wordUnreadable(root, cfg.lang, what, () => isDirectory(root, dir));
  const out = [];
  const fileRe = taskFileRe(cfg.prefix);
  for (const status of STATUSES) {
    const dir = dirs.statusDir[status];
    if (leadsOut(root, dir) || !isDir(dir)) continue;
    for (const e of list(dir, { withFileTypes: true })) {
      const m = e.name.match(fileRe);
      if (!m || !isFileEntry(dir, e)) continue;
      out.push(record(root, cfg.prefix, status, path.join(dir, e.name), m));
    }
  }
  const dirRe = taskDirRe(cfg.prefix);
  if (isDir(dirs.archive)) {
    for (const name of list(dirs.archive)) {
      const m = name.match(dirRe);
      if (!m || leadsOut(root, path.join(dirs.archive, name))) continue;
      const file = path.join(dirs.archive, name, 'task.md');
      const rec = record(root, cfg.prefix, 'archive', file, m);
      rec.dir = path.join(dirs.archive, name);
      rec.hasTask = existsSync(file);
      out.push(rec);
      // Minor entries closed by a batch (`archive N.k --into M`) lie in its minor/ subdirectory.
      const minorDir = path.join(dirs.archive, name, 'minor');
      if (!isDir(minorDir)) continue;
      for (const e of list(minorDir, { withFileTypes: true })) {
        const mm = e.name.match(fileRe);
        if (!mm || !isFileEntry(minorDir, e)) continue;
        const sub = record(root, cfg.prefix, 'archive', path.join(minorDir, e.name), mm);
        sub.dir = rec.dir;
        sub.hasTask = true;
        sub.into = rec.id;
        out.push(sub);
      }
    }
  }
  for (const rec of logTasks({ root, cfg, dirs })) out.push(rec);
  return out.sort((a, b) => a.num - b.num || (a.sub ?? -1) - (b.sub ?? -1) || a.rel.localeCompare(b.rel));
}

// A folded task is a journal entry in status archive without a body: `file` and `rel` point at the
// journal itself, and `hasTask: false` is read by those who need the definition (`brief`).
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
      log: e,
    };
    // An entry closed by a batch stays an entry after folding: `status` counts closed tasks as the
    // archive, not batch items, and the outcome carries the membership.
    const into = batchOf(e.outcome);
    if (into !== null) rec.into = into;
    return rec;
  });
}

// A directory and a symlink to a directory are no task (`lint` gate 2 names them), and reading one
// as a file would crash with EISDIR. The rest is resolved by stat: a broken link is no task.
function isFileEntry(dir, e) {
  if (e.isDirectory()) return false;
  if (e.isFile()) return true;
  try {
    return statSync(path.join(dir, e.name)).isFile();
  } catch {
    return false;
  }
}

// `id` keeps the form from the file name (`BS-007`): the archive directory and links are built from
// it. The numbers are in `num` and `sub`; compare numbers through them or `canonicalId`.
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

// A task by number. Two files with one number are a refusal naming both paths: quietly taking the
// first would move the wrong task.
export function findTask(tasks, id, lang = 'ru') {
  const hits = tasks.filter((t) => sameId(t, id));
  if (hits.length > 1) {
    throw new CliError(msg(lang,
      'number {id} is used twice: {files} — assign distinct numbers; lint reports this too', { id: hits[0].id, files: hits.map((t) => t.rel).join(', ') }));
  }
  return hits[0] ?? null;
}

// A task file directly in docs/backlog/ (migration from another tracker): `scanTasks` does not see
// it, `lint` reddens it with gate 3, and `mv` picks it up: else the migration is by hand.
export function findFlatTask({ root, cfg, dirs }, id) {
  if (!existsSync(dirs.backlog)) return null;
  const fileRe = taskFileRe(cfg.prefix);
  const entries = wordUnreadable(root, cfg.lang, msg(cfg.lang, 'tasks cannot be read from it'), () => readDirEntries(dirs.backlog, { withFileTypes: true }));
  for (const e of entries) {
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

// Numbers taken in other worktrees (on disk) and local branches, as `[{ num, sub, source }]`;
// empty without git; clones and remote branches are unseen (docs/reference/01-layout.md § Numbers).
export function foreignTaskIds({ root, cfg }, lang = 'ru') {
  if (!insideRepo(root, lang)) return [];
  const must = (args) => {
    const r = git(root, args);
    if (r.status !== 0) throw new CliError(`git ${args.join(' ')}: ${gitCause(r, lang)}`);
    return r.stdout;
  };
  const top = must(['rev-parse', '--show-toplevel']);
  // Both paths go through realpath: `/var` and `/private/var` on macOS would otherwise give a
  // garbage relative.
  const toplevel = realpathOrNull(top.trim());
  const here = realpathOrNull(root);
  const inner = toPosix(path.relative(toplevel, here));
  // git prints paths without `./` or a trailing slash, whatever the spelling in backslop.json.
  const docsDir = path.posix.normalize(toPosix(cfg.docs)).replace(/\/+$/, '');
  const docsRel = inner ? `${inner}/${docsDir}` : docsDir;
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
  // A file path relative to docs: backlog/<status>/<file>.md or archive/<directory>/…
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

  const list = (dir) => wordUnreadable(root, lang, msg(lang, 'task numbers cannot be read from it'), () => readDirEntries(dir));
  for (const wt of worktrees(root, lang)) {
    const wtRoot = inner ? path.join(wt.path, ...inner.split('/')) : wt.path;
    if (isSameTree(wtRoot, root)) continue;
    const source = `worktree ${wt.path} (${wt.branch ?? 'detached'})`;
    const docs = path.join(wtRoot, cfg.docs);
    for (const status of STATUSES) {
      const dir = path.join(docs, 'backlog', status);
      if (!statOrNull(dir)?.isDirectory()) continue;
      for (const name of list(dir)) fromDocsPath(`backlog/${status}/${name}`, source);
    }
    const archive = path.join(docs, 'archive');
    if (statOrNull(archive)?.isDirectory()) {
      for (const name of list(archive)) {
        fromDocsPath(`archive/${name}/task.md`, source);
        const minorDir = path.join(archive, name, 'minor');
        if (statOrNull(minorDir)?.isDirectory()) for (const file of list(minorDir)) fromDocsPath(`archive/${name}/minor/${file}`, source);
      }
      const log = path.join(archive, LOG_FILE);
      if (existsSync(log)) fromLog(readText(log), source);
    }
  }

  for (const branch of localBranches(root, lang)) {
    // Pathspec and output are relative to the project root, as in `fold.bodyRev`; `-z` leaves
    // non-ASCII paths unquoted.
    const tree = must(['ls-tree', '-r', '-z', '--name-only', branch, '--', `${docsDir}/backlog`, `${docsDir}/archive`]);
    const source = msg(lang, 'branch {branch}', { branch });
    const files = tree.split('\0').filter((file) => file.startsWith(`${docsDir}/`)).map((file) => file.slice(docsDir.length + 1));
    for (const file of files) fromDocsPath(file, source);
    // The number of a folded task is held by a journal line, not a file name: one journal read per
    // branch, or a closed neighbour-branch task's number would be issued again.
    if (files.includes(`archive/${LOG_FILE}`)) fromLog(must(['show', `${branch}:${docsRel}/archive/${LOG_FILE}`]), source);
  }
  return out;
}

// --- file text ----------------------------------------------------------------------------

// A `result.md` stub is `[TODO` outside code: in a span or fence it is a story about it. One check
// for `lint` gate 5 and the `fold` refusal, parse in [03](../docs/reference/03-lint.md).
export function hasResultTodo(text) {
  return /\[TODO/.test(blankCode(text));
}

const TODO_VALUE = /^\[TODO(?:[^\]\n]*)\](?:\s*\([^\)\n]*\))?$/;
// The list marker is stripped before the field is parsed.
const TODO_FIELD = /^(?:\*\*[^*\n]+:\*\*|\*\*[^*\n]+\*\*:|[^:\n]+:)[ \t]*(.*)$/;

export function hasTodoPlaceholder(text) {
  return splitLines(blankFences(text)).some((line) => isPlaceholderLine(line));
}

export function isTodoPlaceholder(line) {
  return isTodoValue(line.trim().replace(/^>\s*/, '').replace(/^[-*+]\s+/, ''));
}

// Gate 4 also reads a numbered item, a task box and each table cell;
// so does `mv` when it shapes a minor/ card.
export function isPlaceholderLine(line) {
  const value = line.trim().replace(/^>\s*/, '');
  if (value.startsWith('|')) return value.split(/(?<!\\)\|/).some((cell) => isTodoValue(cell));
  return isTodoValue(value.replace(/^(?:[-*+]|\d+[.)])\s+/, '').replace(/^\[[ xX]\]\s+/, ''));
}

// A table row with a placeholder cell and a written one: the row with the placeholder cells
// emptied; null for any other line.
export function blankPlaceholderCells(line) {
  const [, lead, body] = line.match(/^(\s*(?:>\s*)?)(\|.*)$/) ?? [];
  if (body === undefined) return null;
  const cells = body.split(/(?<!\\)\|/);
  const stub = cells.map((cell) => isTodoValue(cell));
  if (!stub.includes(true) || !cells.some((cell, i) => !stub[i] && cell.trim())) return null;
  return lead + cells.map((cell, i) => (stub[i] ? ' ' : cell)).join('|');
}

function isTodoValue(raw) {
  const value = raw.trim();
  if (TODO_VALUE.test(value)) return true;
  const field = value.match(TODO_FIELD);
  return TODO_VALUE.test(field ? field[1].trim() : value);
}

// The closing line of the evidence refusals of `new --minor` and `mv … minor`.
export function evidenceAssumption(lang) {
  return msg(lang,
    'Unverified does not excuse missing evidence — it makes it an assumption: --evidence "presumably …".');
}

// --- file header --------------------------------------------------------------------------

export function readTitle(text) {
  const m = splitLines(text)[0]?.match(TITLE_RE);
  return m ? { id: m[1], title: m[2].trim() } : null;
}

// An ATX section heading: up to 3 spaces of indent is valid markdown.
function headingText(line) {
  const m = line.match(/^ {0,3}## (.*)$/);
  return m ? m[1].trim() : null;
}

// Indexes of the header's field lines: up to the first `## ` section.
function fieldLines(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (headingText(lines[i]) !== null) break;
    const m = lines[i].match(FIELD_RE);
    if (m) out.push([i, m[1].trim(), m[2].trim()]);
  }
  return out;
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
    // "Order" goes first: it changes most often and must be visible at once.
    const at = name === FIELD_ORDER ? fields[0][0] : fields[fields.length - 1][0] + 1;
    lines.splice(at, 0, line);
    return lines.join(eol);
  }
  // No fields yet: the list goes after the heading through a blank line and is set off by a blank
  // line.
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

// --- sections -----------------------------------------------------------------------------

// `## ` sections of a card over its fence-blanked lines `clean`: each runs from its heading to the
// next heading or the end of the text.
export function sections(text) {
  const clean = splitLines(blankFences(text));
  const list = [];
  clean.forEach((line, i) => {
    const name = headingText(line);
    if (name === null) return;
    if (list.length) list.at(-1).end = i;
    list.push({ name, start: i, end: clean.length });
  });
  return { clean, list };
}

function sectionRanges(text, heading) {
  const sourceLines = splitLines(text);
  const aliases = sectionAliases(heading);
  return sections(text).list.filter((sec) => aliases.has(sec.name)).map(({ start, end }) => ({
    start,
    end,
    body: sourceLines.slice(start + 1, end).join('\n').trim(),
  }));
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

// --- queue order --------------------------------------------------------------------------

// The queue ascending by "Order", ties by number. A file without an order, or with a non-numeric
// one, goes to the end: commands do not fall over it, `lint` turns red on it.
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

// A queue place: top, after M, a saved rank no later than `before`, or the end; the middle and
// renumbering are in docs/reference/02-cli.md. The answer { rank, renumbered, bounded? } — ADR-049.
export function placeInQueue(rows, { top = false, after = null, rank = null, before = null } = {}, prefix, lang = 'ru') {
  const ordered = rows.filter((r) => Number.isInteger(r.rank));
  if (!top && after === null && rank === null) return { rank: nextRank(rows), renumbered: [] };
  let lower;
  let upper;
  let insertBefore;
  let bounded = false;
  if (rank !== null) {
    // A saved rank is free: the task takes exactly it; taken: it goes before the holder: by ADR-049
    // the rank is absolute, and what can be returned is the place, not an identical number.
    const taken = ordered.findIndex((r) => r.rank === rank);
    // `before` is the batch neighbour of `--restore`: a place later than it yields to the place
    // right before it, and the answer carries `bounded` (ADR-049).
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
      const label = formatId(prefix, after.num, after.sub);
      const unranked = rows.find((r) => sameId(r.task, after));
      if (unranked) throw new CliError(msg(lang,
        'queue task {label} has no integer “{field}” — fix it first', { label, field: fieldName(FIELD_ORDER, lang) }));
      throw new CliError(msg(lang,
        'task {label} is not in the queue — --after expects a task from queue/', { label }));
    }
    insertBefore = idx + 1;
    lower = ordered[idx].rank;
    upper = idx + 1 < ordered.length ? ordered[idx + 1].rank : null;
  }
  if (upper === null) return { rank: lower + RANK_STEP, renumbered: [] };
  if (upper - lower >= 2) return { rank: Math.floor((lower + upper) / 2), renumbered: [], ...(bounded && { bounded }) };
  // No room: everyone gets a new rank at a step, the newcomer stands between.
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

// --- moving a file ------------------------------------------------------------------------

// A move is `git mv`, so the file's history does not break; a file outside the git index (not
// added, or no repository) moves by a plain rename. Any other git failure refuses before the move.
function moveFile(root, from, to, lang) {
  const tracked = insideRepo(root, lang) && isTracked(root, from, lang);
  mkdirSync(path.dirname(to), { recursive: true });
  if (tracked) {
    gitOrFail(root, ['mv', '--', from, to], lang);
    return 'git';
  }
  renameSync(from, to);
  return 'fs';
}

// Moving a task and rewriting the links of both sides. In dry-run the file stays in place, but the
// list of changed paths is counted as for a real move.
export function relocateTask(project, task, newRel, { dry = false } = {}) {
  const { root, cfg } = project;
  const newFile = path.join(root, ...newRel.split('/'));
  const prefix = repoPrefix(root, cfg.lang);
  // The walk comes first: a directory it cannot list refuses before the card has moved.
  const markdown = repoMarkdown(root);
  if (!dry) {
    const how = moveFile(root, task.file, newFile, cfg.lang);
    if (how === 'fs') warn(msg(cfg.lang, 'file is not tracked by git — moved without git mv'));
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

  for (const [rel, abs] of markdown) {
    // The list predates the move: a symlinked alias of a status directory still names the old path.
    if (rel === newRel || rel === task.rel || !existsSync(abs)) continue;
    const text = readText(abs);
    const next = rewriteIncomingLinks(text, linkBase(root, rel, abs), task.rel, newRel, prefix);
    if (next === text) continue;
    changed.push(rel);
    if (!dry) writeText(abs, next);
  }
  return changed;
}

// --- creating a task --------------------------------------------------------------------------

// A stub for "Scope": a link to the reference when it exists, otherwise text. In both cases the
// section is completed by the one who creates the task.
function areaPlaceholder(lang, reference) {
  if (reference === null) return msg(lang, '[TODO: reference/ section]');
  return msg(lang, '[TODO: section]({reference})', { reference });
}

// A task or finding from its template, numbered past the tree, other worktrees and local branches.
// `notes` are the lines a caller prints after its own `✔ <id>: <path>` line.
export function createTask(project, { slug, title, queue, top, parent: parentRef, minor, cost = 'minor', hypothesis, evidence = '' }) {
  const { cfg, dirs } = project;
  expectNoLinkedOut(project);
  const tasks = scanTasks(project);
  const foreign = foreignTaskIds(project, cfg.lang);
  const all = [...tasks, ...foreign];
  // A number the working tree holds did not shift anything, even when another branch has it too.
  const local = new Set(tasks.map((t) => `${t.num}.${t.sub ?? ''}`));
  const foreignOnly = (n, s) => (local.has(`${n}.${s ?? ''}`) ? null : foreign.find((f) => f.num === n && f.sub === s) ?? null);

  let num;
  let sub = null;
  let parentTask = null;
  let blocker = null; // a foreign number that shifted ours
  let context = msg(cfg.lang, '[TODO: where the task came from and what motivates it.]');
  if (parentRef !== undefined) {
    const parent = parseId(parentRef, cfg.prefix, cfg.lang);
    parentTask = findTask(tasks, parent, cfg.lang);
    if (!parentTask) {
      throw new CliError(msg(cfg.lang,
        'task {parentId} was not found in any status directory or archive', { parentId: formatId(cfg.prefix, parent.num, parent.sub) }));
    }
    num = parent.num;
    sub = nextSub(all, num);
    blocker = foreignOnly(num, sub - 1);
    // In minor/ the evidence comes from the flag, so a stub has no source; in triage/ it stays a
    // task for the one who files the entry: it is completed at triage review.
    context = minor
      ? msg(cfg.lang,
        'Finding discovered while working on {id}.\n\nEvidence: {evidence}', { id: parentTask.id, evidence })
      : [
        msg(cfg.lang, 'Finding discovered while working on {id}.', { id: parentTask.id }),
        msg(cfg.lang, 'Evidence: [TODO: file path or command output]'),
        msg(cfg.lang, 'Quote a file inside a “<!-- quote:path --> … <!-- /quote -->” block rather than by line number: numbers drift silently, the block is guarded by lint. If unverified, state it as an assumption.'),
      ].join('\n');
  } else {
    num = nextNumber(all);
    blocker = foreignOnly(num - 1, null);
  }

  // A finding's number takes its parent's form (`BS-007` → `BS-007.1`). Under a finding the child
  // is the next `N.k` of the same root (`BS-007.1` → `BS-007.2`); the exact edge is in "Parent".
  const parentRoot = parentTask?.id.split('.')[0];
  const parentIsFinding = parentTask !== null && parentTask.sub !== null;
  const id = parentTask
    ? parentIsFinding ? `${parentRoot}.${sub}` : `${parentTask.id}.${sub}`
    : formatId(cfg.prefix, num);
  const status = minor ? 'minor' : queue ? 'queue' : 'triage';
  const file = path.join(dirs.statusDir[status], `${id}-${slug}.md`);
  expectNameFits(path.basename(file), cfg.lang);
  expectDirectory(project.root, dirs.statusDir[status], cfg.lang);
  // The command computes the depth of the path to the reference, the one who creates the task picks
  // the section. Without a reference the stub stays text: a broken link would turn gate 1 red.
  const reference = existsSync(path.join(dirs.reference, 'README.md'))
    ? `${toPosix(path.relative(dirs.statusDir[status], dirs.reference))}/README.md`
    : null;
  // In minor/ the approver fills the scope when cutting batches: empty is a lint warning, a [TODO]
  // stub would be an error and demand a section from someone who does not choose it.
  const vars = { id, title: (title ?? '').trim() || slug, date: today(), area: minor ? '' : areaPlaceholder(cfg.lang, reference), context };
  let text = minor
    ? renderProjectTemplate(cfg, 'minor.md', { ...vars, parent: parentTask.id, cost: formatCost(cost, Boolean(hypothesis), cfg.lang) })
    : renderProjectTemplate(cfg, 'task.md', vars);
  if (parentIsFinding && !minor) text = setField(text, FIELD_PARENT, parentTask.id, cfg.lang);
  const renumbered = [];
  if (status === 'queue') {
    const placed = placeInQueue(queueOrder(tasks), { top: Boolean(top) }, cfg.prefix, cfg.lang);
    text = setField(text, FIELD_ORDER, String(placed.rank), cfg.lang);
    renumbered.push(...placed.renumbered);
  }
  for (const [otherFile, rank] of renumbered) {
    writeText(otherFile, setField(readText(otherFile), FIELD_ORDER, String(rank), cfg.lang));
  }
  writeText(file, text);
  const notes = [];
  if (blocker) notes.push(msg(cfg.lang, '{blockerId} is taken: {source}', { blockerId: formatId(cfg.prefix, blocker.num, blocker.sub), source: blocker.source }));
  if (renumbered.length) notes.push(msg(cfg.lang, 'queue renumbered in steps of 10: {renumbered} files', { renumbered: renumbered.length }));
  return { id, file, notes };
}
