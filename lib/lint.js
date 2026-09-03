// Гейты трекера. Каждый ловит то, что руками разъезжается молча: битую ссылку, два файла с
// одним номером, задачу в очереди без порядка, архив без результата, упоминание номера,
// за которым нет файла. Отказ перечисляет всё найденное; код возврата — 1 при ошибках.
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { STATUSES, loadProject } from './config.js';
import { blankFences, brokenLinks, relativeLinks } from './links.js';
import { mdFiles } from './mdwalk.js';
import { ADR_FILE_RE, scanAdrs } from './adr.js';
import {
  FIELD_ORDER, FIELD_TAKEN, SECTION_DEFERRED, getField, idMentionRe, orderOf, readText, readTitle, scanTasks,
  sectionBody, taskDirRe, taskFileRe,
} from './tasks.js';
import { bad, ok, toPosix } from './util.js';

const TODO = /\[TODO/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CHANGELOG_ENTRY = /^- \*\*(.+?)\*\*/;

export function lintProject(project) {
  const { root, cfg, dirs } = project;
  const problems = [];
  const err = (file, msg) => problems.push({ file: toPosix(path.relative(root, file)), msg });
  const tasks = scanTasks(project);

  lintLinks(project, err);
  lintTaskFiles(project, tasks, err);
  lintBacklogLayout(project, err);
  lintStatusFields(tasks, err);
  lintArchive(project, err);
  lintMentions(project, tasks, err);
  lintChangelog(root, err);
  lintAdrIndex(project, err);
  return problems;
}

// 1. Ссылки: docs/**, корневые *.md и скиллы backslop.
function lintLinks({ root, dirs }, err) {
  const files = [...mdFiles(dirs.docs, '')];
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (e.isFile() && e.name.endsWith('.md')) files.push([e.name, path.join(root, e.name)]);
  }
  const skills = path.join(root, '.claude', 'skills');
  if (existsSync(skills)) {
    for (const e of readdirSync(skills, { withFileTypes: true })) {
      if (e.isDirectory() && e.name.startsWith('backslop-')) files.push(...mdFiles(path.join(skills, e.name), ''));
    }
  }
  for (const [, abs] of files) {
    for (const href of brokenLinks(abs, root)) err(abs, `битая ссылка ${href}`);
  }
}

// 2. Номера: уникальны, совпадают с заголовком, у sub-ID есть родитель; чужие файлы в каталогах статусов.
function lintTaskFiles({ cfg, dirs }, tasks, err) {
  const seen = new Map();
  for (const t of tasks) {
    const prev = seen.get(t.id);
    if (prev) err(t.file, `номер ${t.id} уже занят: ${prev.rel}`);
    else seen.set(t.id, t);
    if (t.status === 'archive' && !t.hasTask) continue;
    const title = readTitle(readText(t.file));
    if (!title) err(t.file, `первая строка не «# ${t.id} · Заголовок»`);
    else if (title.id !== t.id) err(t.file, `заголовок называет ${title.id}, имя файла — ${t.id}`);
  }
  for (const t of tasks) {
    if (t.sub !== null && !tasks.some((p) => p.num === t.num && p.sub === null)) {
      err(t.file, `находка ${t.id} без родителя ${cfg.prefix}-${t.num}`);
    }
  }
  const fileRe = taskFileRe(cfg.prefix);
  for (const status of STATUSES) {
    const dir = dirs.statusDir[status];
    if (!existsSync(dir)) continue;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      if (e.isDirectory()) err(path.join(dir, e.name), 'каталог внутри каталога статуса: задача — один файл');
      else if (!fileRe.test(e.name)) err(path.join(dir, e.name), `имя не по шаблону ${cfg.prefix}-N[.k]-<slug>.md`);
    }
  }
}

// 3. В docs/backlog кроме README.md и каталогов статусов ничего нет.
function lintBacklogLayout({ dirs }, err) {
  if (!existsSync(dirs.backlog)) {
    err(dirs.backlog, 'каталога бэклога нет — backslop init');
    return;
  }
  for (const e of readdirSync(dirs.backlog, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const abs = path.join(dirs.backlog, e.name);
    if (e.isDirectory()) {
      if (!STATUSES.includes(e.name)) err(abs, `каталог не статус; статусы — ${STATUSES.join(', ')}`);
    } else if (e.name !== 'README.md') {
      err(abs, 'файл вне каталога статуса: задача лежит в triage/, queue/, active/ или deferred/');
    }
  }
  for (const status of STATUSES) {
    if (!existsSync(dirs.statusDir[status])) err(dirs.statusDir[status], 'каталога статуса нет — создай пустым');
  }
}

// 4. Поля, которые статус ведёт за собой.
function lintStatusFields(tasks, err) {
  for (const t of tasks) {
    if (t.status === 'archive') continue;
    const text = readText(t.file);
    if (t.status === 'queue') {
      const rank = orderOf(text);
      if (rank === null) err(t.file, `в очереди без поля «${FIELD_ORDER}» — место в очереди не задано`);
      else if (!Number.isInteger(rank)) err(t.file, `«${FIELD_ORDER}» не целое число`);
    }
    if (t.status === 'active') {
      const taken = getField(text, FIELD_TAKEN);
      if (!taken || !DATE.test(taken)) err(t.file, `в работе без даты «${FIELD_TAKEN}: ГГГГ-ММ-ДД»`);
    }
    if (t.status === 'deferred') {
      const body = sectionBody(text, SECTION_DEFERRED);
      if (body === null || !body) err(t.file, `отложена без раздела «## ${SECTION_DEFERRED}»: причина и условие возврата`);
      else if (TODO.test(body)) err(t.file, `раздел «${SECTION_DEFERRED}» не заполнен: остался [TODO]`);
    }
  }
}

// 5. Архив: каталог на задачу с task.md и result.md, результат дописан.
function lintArchive({ cfg, dirs }, err) {
  if (!existsSync(dirs.archive)) return;
  const dirRe = taskDirRe(cfg.prefix);
  for (const e of readdirSync(dirs.archive, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const abs = path.join(dirs.archive, e.name);
    if (!e.isDirectory()) {
      if (e.name !== 'README.md') err(abs, 'в архиве только каталоги задач и README.md');
      continue;
    }
    if (!dirRe.test(e.name)) {
      err(abs, `имя не по шаблону ${cfg.prefix}-N[.k]-<slug>`);
      continue;
    }
    const task = path.join(abs, 'task.md');
    const result = path.join(abs, 'result.md');
    if (!existsSync(task)) err(abs, 'нет task.md — постановки');
    if (!existsSync(result)) err(abs, 'нет result.md — результата с датой закрытия');
    else if (TODO.test(readText(result))) err(result, 'результат не дописан: остался [TODO]');
  }
}

// 6. Упоминание номера в docs/** и CHANGELOG.md ведёт к файлу задачи. Блоки кода — примеры
// вывода и форматов, не ссылки; спаны считаются: «см. `BS-12`» — обычная ссылка в прозе.
function lintMentions({ root, cfg, dirs }, tasks, err) {
  const known = new Set(tasks.map((t) => t.id));
  const files = [...mdFiles(dirs.docs, '')];
  const changelog = path.join(root, 'CHANGELOG.md');
  if (existsSync(changelog)) files.push(['CHANGELOG.md', changelog]);
  const re = idMentionRe(cfg.prefix);
  for (const [, abs] of files) {
    const missing = new Set();
    for (const m of blankFences(readText(abs)).matchAll(re)) if (!known.has(m[0])) missing.add(m[0]);
    for (const id of missing) err(abs, `упоминает ${id}, а файла задачи нет ни в статусах, ни в архиве`);
  }
}

// 7. CHANGELOG: совпавший заголовок записи внутри секции — правка одной записи, не две.
export function lintChangelog(root, err) {
  const file = path.join(root, 'CHANGELOG.md');
  if (!existsSync(file)) return;
  const seen = new Map();
  let section = '(до первой секции)';
  readText(file).split('\n').forEach((raw, i) => {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (/^## /.test(line)) {
      seen.clear();
      section = line.slice(3).trim() || '(без названия)';
      return;
    }
    const m = line.match(CHANGELOG_ENTRY);
    if (!m) return;
    const prev = seen.get(m[1]);
    if (prev !== undefined) {
      err(file, `строка ${i + 1}: заголовок записи «${m[1]}» уже есть в секции «${section}» (строка ${prev}) — оставь одну редакцию`);
    } else {
      seen.set(m[1], i + 1);
    }
  });
}

// 8. Каждый ADR назван строкой таблицы docs/README.md; номера уникальны.
function lintAdrIndex({ dirs }, err) {
  const adrs = scanAdrs(dirs.adr);
  const byNumber = new Map();
  for (const a of adrs) {
    const prev = byNumber.get(a.number);
    if (prev) err(a.file, `номер ADR ${a.number} уже занят: ${prev.name}`);
    else byNumber.set(a.number, a);
  }
  if (!adrs.length) return;
  if (!existsSync(dirs.docsReadme)) {
    err(dirs.docsReadme, 'нет индекса документации, а ADR есть');
    return;
  }
  const readmeDir = path.dirname(dirs.docsReadme);
  const linked = new Set(relativeLinks(readText(dirs.docsReadme))
    .map((href) => path.resolve(readmeDir, href.split('#')[0])));
  for (const a of adrs) {
    if (!linked.has(path.resolve(a.file))) err(a.file, `нет строки в ${path.basename(dirs.docsReadme)} — таблица ADR ведётся вручную`);
  }
  // Файлы adr/ не по шаблону имени: номер не считается, гейт молчал бы.
  for (const e of readdirSync(dirs.adr, { withFileTypes: true })) {
    if (e.isFile() && e.name.endsWith('.md') && e.name !== 'README.md' && !ADR_FILE_RE.test(e.name)) {
      err(path.join(dirs.adr, e.name), 'имя не по шаблону adr-NNN-<slug>.md');
    }
  }
}

export async function run(argv, { cwd }) {
  const project = loadProject(cwd);
  const problems = lintProject(project);
  for (const p of problems) bad(`${p.file}: ${p.msg}`);
  if (problems.length) {
    bad(`lint: ошибок ${problems.length}`);
    return 1;
  }
  ok('lint: ошибок нет');
  return 0;
}
