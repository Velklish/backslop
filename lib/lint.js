// Гейты трекера. Каждый ловит то, что руками разъезжается молча: битую ссылку, два файла с
// одним номером, задачу в очереди без порядка, архив без результата, упоминание номера,
// за которым нет файла. Отказ перечисляет всё найденное; код возврата — 1 при ошибках.
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { CONFIG_FILE, STATUSES, loadProject, parseCli } from './config.js';
import { blankFences, brokenLinks, relativeLinks } from './links.js';
import { mdFiles } from './mdwalk.js';
import { ADR_FILE_RE, scanAdrs } from './adr.js';
import {
  FIELD_ORDER, FIELD_TAKEN, SECTION_DEFERRED, canonicalId, fieldName, getField, idMentionRe, orderOf, readText, readTitle, scanTasks,
  sectionBody, sectionName, taskDirRe, taskFileRe,
} from './tasks.js';
import { bad, ok, toPosix, warn } from './util.js';
import { TOOL_VERSION, compareVersions } from './version.js';
import { generatedAdapterFiles, ownedAdapterFiles } from './adapters.js';
import { tr } from './i18n.js';
import { templateParity } from './templates.js';

const TODO = /\[TODO/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CHANGELOG_ENTRY = /^- \*\*(.+?)\*\*/;

// Ошибки красят гейт; предупреждения — про версию раскладки — только печатаются: устаревший
// скелет работает, но проект должен знать, что отстал.
export function lintProject(project) {
  const { root, cfg, dirs } = project;
  const errors = [];
  const warnings = [];
  const err = (file, msg) => errors.push({ file: toPosix(path.relative(root, file)), msg });
  const note = (file, msg) => warnings.push({ file: toPosix(path.relative(root, file)), msg });
  const tasks = scanTasks(project);

  lintLinks(project, err);
  lintAdapters(project, err);
  lintTaskFiles(project, tasks, err);
  lintBacklogLayout(project, err);
  lintStatusFields(project, tasks, err);
  lintArchive(project, err);
  lintMentions(project, tasks, err);
  lintChangelog(root, err, cfg.lang);
  lintAdrIndex(project, err);
  lintVersion(project, note);
  lintTemplateParity(project, err);
  return { errors, warnings };
}

function lintTemplateParity({ root }, err) {
  const marker = path.join(root, 'templates', 'skills', 'backslop-task', 'SKILL.md');
  if (!existsSync(marker)) return;
  for (const msg of templateParity(path.join(root, 'templates'))) err(path.join(root, 'templates'), msg);
}

// Штамп версии раскладки против версии инструмента и пина в cli.
function lintVersion({ root, cfg }, note) {
  const file = path.join(root, CONFIG_FILE);
  const form = parseCli(cfg.cli);
  const pin = form?.pin ?? null;
  if (form && pin === null) note(file, tr(cfg.lang, `cli без пина тянет свежую версию при каждом запуске — запусти ${cfg.cli} upgrade`, `an unpinned cli fetches a fresh version on every run — run ${cfg.cli} upgrade`));
  if (!cfg.version) {
    note(file, tr(cfg.lang, `нет штампа версии — запусти ${cfg.cli} upgrade или init`, `version stamp is missing — run ${cfg.cli} upgrade or init`));
  } else {
    const cmp = compareVersions(cfg.version, TOOL_VERSION);
    if (cmp < 0) note(file, tr(cfg.lang, `скелет старее инструмента: v${cfg.version} < v${TOOL_VERSION} — запусти ${cfg.cli} upgrade`, `layout is older than the tool: v${cfg.version} < v${TOOL_VERSION} — run ${cfg.cli} upgrade`));
    if (cmp > 0) note(file, tr(cfg.lang, `штамп новее инструмента: v${cfg.version} > v${TOOL_VERSION} — обнови установку или пин в cli`, `version stamp is newer than the tool: v${cfg.version} > v${TOOL_VERSION} — update the installation or cli pin`));
    if (pin !== null && pin !== cfg.version) note(file, tr(cfg.lang, `пин в cli v${pin} расходится со штампом v${cfg.version} — запусти upgrade`, `cli pin v${pin} differs from version stamp v${cfg.version} — run upgrade`));
  }
}

// 1. Ссылки: docs/**, корневые *.md и скиллы backslop.
function lintLinks({ root, cfg, dirs }, err) {
  const files = [...mdFiles(dirs.docs, '')];
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (e.isFile() && e.name.endsWith('.md')) files.push([e.name, path.join(root, e.name)]);
  }
  for (const [, abs] of files) {
    for (const href of brokenLinks(abs, root)) err(abs, tr(cfg.lang, `битая ссылка ${href}`, `broken link ${href}`));
  }
}

// Generated adapter outputs не входят в общий repository-wide обход: archive/mv не должны
// переписывать производные файлы. Их наличие и ссылки проверяются отдельным гейтом.
function lintAdapters({ root, cfg }, err) {
  const owned = ownedAdapterFiles(root, cfg.lang);
  for (const tool of cfg.tools) {
    for (const file of owned[tool]) if (!existsSync(file)) err(file, tr(cfg.lang, `нет generated output для adapter ${tool} — запусти ${cfg.cli} init`, `generated output for adapter ${tool} is missing — run ${cfg.cli} init`));
  }
  if (cfg.tools.includes('claude') && !existsSync(path.join(root, 'CLAUDE.md'))) {
    err(path.join(root, 'CLAUDE.md'), tr(cfg.lang, `нет Claude stub — запусти ${cfg.cli} init`, `Claude stub is missing — run ${cfg.cli} init`));
  }
  for (const [, file] of generatedAdapterFiles(root, cfg)) {
    for (const href of brokenLinks(file, root)) err(file, tr(cfg.lang, `битая ссылка ${href}`, `broken link ${href}`));
  }
}

// 2. Номера: уникальны, совпадают с заголовком, у sub-ID есть родитель; чужие файлы в каталогах статусов.
function lintTaskFiles({ cfg, dirs }, tasks, err) {
  const seen = new Map();
  for (const t of tasks) {
    const key = canonicalId(t.id, cfg.prefix);
    const prev = seen.get(key);
    if (prev) err(t.file, tr(cfg.lang, `номер ${t.id} уже занят: ${prev.rel}`, `number ${t.id} is already used by ${prev.rel}`));
    else seen.set(key, t);
    if (t.status === 'archive' && !t.hasTask) continue;
    const title = readTitle(readText(t.file));
    if (!title) err(t.file, tr(cfg.lang, `первая строка не «# ${t.id} · Заголовок»`, `first line is not “# ${t.id} · Title”`));
    else if (canonicalId(title.id, cfg.prefix) !== key) err(t.file, tr(cfg.lang, `заголовок называет ${title.id}, имя файла — ${t.id}`, `heading names ${title.id}, but filename names ${t.id}`));
  }
  for (const t of tasks) {
    if (t.sub !== null && !tasks.some((p) => p.num === t.num && p.sub === null)) {
      err(t.file, tr(cfg.lang, `находка ${t.id} без родителя ${cfg.prefix}-${t.num}`, `finding ${t.id} has no parent ${cfg.prefix}-${t.num}`));
    }
  }
  const fileRe = taskFileRe(cfg.prefix);
  for (const status of STATUSES) {
    const dir = dirs.statusDir[status];
    if (!existsSync(dir)) continue;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      if (e.isDirectory()) err(path.join(dir, e.name), tr(cfg.lang, 'каталог внутри каталога статуса: задача — один файл', 'directory inside a status directory: each task must be one file'));
      else if (!fileRe.test(e.name)) err(path.join(dir, e.name), tr(cfg.lang, `имя не по шаблону ${cfg.prefix}-N[.k]-<slug>.md`, `name does not match ${cfg.prefix}-N[.k]-<slug>.md`));
    }
  }
}

// 3. В docs/backlog кроме README.md и каталогов статусов ничего нет.
function lintBacklogLayout({ cfg, dirs }, err) {
  if (!existsSync(dirs.backlog)) {
    err(dirs.backlog, tr(cfg.lang, 'каталога бэклога нет — backslop init', 'backlog directory is missing — run backslop init'));
    return;
  }
  for (const e of readdirSync(dirs.backlog, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const abs = path.join(dirs.backlog, e.name);
    if (e.isDirectory()) {
      if (!STATUSES.includes(e.name)) err(abs, tr(cfg.lang, `каталог не статус; статусы — ${STATUSES.join(', ')}`, `directory is not a status; statuses are ${STATUSES.join(', ')}`));
    } else if (e.name !== 'README.md') {
      err(abs, tr(cfg.lang, 'файл вне каталога статуса: задача лежит в triage/, queue/, active/ или deferred/', 'file is outside a status directory: tasks belong in triage/, queue/, active/, or deferred/'));
    }
  }
  for (const status of STATUSES) {
    if (!existsSync(dirs.statusDir[status])) err(dirs.statusDir[status], tr(cfg.lang, 'каталога статуса нет — создай пустым', 'status directory is missing — create it empty'));
  }
}

// 4. Поля, которые статус ведёт за собой.
function lintStatusFields({ cfg }, tasks, err) {
  for (const t of tasks) {
    if (t.status === 'archive') continue;
    const text = readText(t.file);
    if (t.status === 'queue') {
      const rank = orderOf(text);
      if (rank === null) err(t.file, tr(cfg.lang, `в очереди без поля «${fieldName(FIELD_ORDER, cfg.lang)}» — место в очереди не задано`, `queue task has no “${fieldName(FIELD_ORDER, cfg.lang)}” field — queue position is not set`));
      else if (!Number.isInteger(rank)) err(t.file, tr(cfg.lang, `«${fieldName(FIELD_ORDER, cfg.lang)}» не целое число`, `“${fieldName(FIELD_ORDER, cfg.lang)}” is not an integer`));
    }
    if (t.status === 'active') {
      const taken = getField(text, FIELD_TAKEN);
      if (!taken || !DATE.test(taken)) err(t.file, tr(cfg.lang, `в работе без даты «${fieldName(FIELD_TAKEN, cfg.lang)}: ГГГГ-ММ-ДД»`, `active task has no “${fieldName(FIELD_TAKEN, cfg.lang)}: YYYY-MM-DD” date`));
    }
    if (t.status === 'deferred') {
      const body = sectionBody(text, SECTION_DEFERRED);
      if (body === null || !body) err(t.file, tr(cfg.lang, `отложена без раздела «## ${sectionName(SECTION_DEFERRED, cfg.lang)}»: причина и условие возврата`, `deferred task has no “## ${sectionName(SECTION_DEFERRED, cfg.lang)}” section with a reason and return condition`));
      else if (TODO.test(body)) err(t.file, tr(cfg.lang, `раздел «${sectionName(SECTION_DEFERRED, cfg.lang)}» не заполнен: остался [TODO]`, `“${sectionName(SECTION_DEFERRED, cfg.lang)}” section is incomplete: [TODO] remains`));
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
      if (e.name !== 'README.md') err(abs, tr(cfg.lang, 'в архиве только каталоги задач и README.md', 'archive may contain only task directories and README.md'));
      continue;
    }
    if (!dirRe.test(e.name)) {
      err(abs, tr(cfg.lang, `имя не по шаблону ${cfg.prefix}-N[.k]-<slug>`, `name does not match ${cfg.prefix}-N[.k]-<slug>`));
      continue;
    }
    const task = path.join(abs, 'task.md');
    const result = path.join(abs, 'result.md');
    if (!existsSync(task)) err(abs, tr(cfg.lang, 'нет task.md — постановки', 'task.md specification is missing'));
    if (!existsSync(result)) err(abs, tr(cfg.lang, 'нет result.md — результата с датой закрытия', 'result.md with the closing date is missing'));
    else if (TODO.test(readText(result))) err(result, tr(cfg.lang, 'результат не дописан: остался [TODO]', 'result is incomplete: [TODO] remains'));
  }
}

// 6. Упоминание номера в docs/** и CHANGELOG.md ведёт к файлу задачи. Блоки кода — примеры
// вывода и форматов, не ссылки; спаны считаются: «см. `BS-12`» — обычная ссылка в прозе.
function lintMentions({ root, cfg, dirs }, tasks, err) {
  const known = new Set(tasks.map((t) => canonicalId(t.id, cfg.prefix)));
  const files = [...mdFiles(dirs.docs, '')];
  const changelog = path.join(root, 'CHANGELOG.md');
  if (existsSync(changelog)) files.push(['CHANGELOG.md', changelog]);
  const re = idMentionRe(cfg.prefix);
  for (const [, abs] of files) {
    const missing = new Set();
    for (const m of blankFences(readText(abs)).matchAll(re)) if (!known.has(canonicalId(m[0], cfg.prefix))) missing.add(m[0]);
    for (const id of missing) err(abs, tr(cfg.lang, `упоминает ${id}, а файла задачи нет ни в статусах, ни в архиве`, `mentions ${id}, but no task file exists in statuses or archive`));
  }
}

// 7. CHANGELOG: совпавший заголовок записи внутри секции — правка одной записи, не две.
export function lintChangelog(root, err, lang = 'ru') {
  const file = path.join(root, 'CHANGELOG.md');
  if (!existsSync(file)) return;
  const seen = new Map();
  let section = tr(lang, '(до первой секции)', '(before the first section)');
  readText(file).split('\n').forEach((raw, i) => {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (/^## /.test(line)) {
      seen.clear();
      section = line.slice(3).trim() || tr(lang, '(без названия)', '(untitled)');
      return;
    }
    const m = line.match(CHANGELOG_ENTRY);
    if (!m) return;
    const prev = seen.get(m[1]);
    if (prev !== undefined) {
      err(file, tr(lang, `строка ${i + 1}: заголовок записи «${m[1]}» уже есть в секции «${section}» (строка ${prev}) — оставь одну редакцию`, `line ${i + 1}: entry title “${m[1]}” already exists in section “${section}” (line ${prev}) — keep one revision`));
    } else {
      seen.set(m[1], i + 1);
    }
  });
}

// 8. Каждый ADR назван строкой таблицы docs/README.md; номера уникальны.
function lintAdrIndex({ cfg, dirs }, err) {
  const adrs = scanAdrs(dirs.adr);
  const byNumber = new Map();
  for (const a of adrs) {
    const prev = byNumber.get(a.number);
    if (prev) err(a.file, tr(cfg.lang, `номер ADR ${a.number} уже занят: ${prev.name}`, `ADR number ${a.number} is already used by ${prev.name}`));
    else byNumber.set(a.number, a);
  }
  if (!adrs.length) return;
  if (!existsSync(dirs.docsReadme)) {
    err(dirs.docsReadme, tr(cfg.lang, 'нет индекса документации, а ADR есть', 'documentation index is missing while ADRs exist'));
    return;
  }
  const readmeDir = path.dirname(dirs.docsReadme);
  const linked = new Set(relativeLinks(readText(dirs.docsReadme))
    .map((href) => path.resolve(readmeDir, href.split('#')[0])));
  for (const a of adrs) {
    if (!linked.has(path.resolve(a.file))) err(a.file, tr(cfg.lang, `нет строки в ${path.basename(dirs.docsReadme)} — таблица ADR ведётся вручную`, `no row in ${path.basename(dirs.docsReadme)} — the ADR table is maintained manually`));
  }
  // Файлы adr/ не по шаблону имени: номер не считается, гейт молчал бы.
  for (const e of readdirSync(dirs.adr, { withFileTypes: true })) {
    if (e.isFile() && e.name.endsWith('.md') && e.name !== 'README.md' && !ADR_FILE_RE.test(e.name)) {
      err(path.join(dirs.adr, e.name), tr(cfg.lang, 'имя не по шаблону adr-NNN-<slug>.md', 'name does not match adr-NNN-<slug>.md'));
    }
  }
}

export async function run(argv, { cwd }) {
  const project = loadProject(cwd);
  const { errors, warnings } = lintProject(project);
  for (const p of errors) bad(`${p.file}: ${p.msg}`);
  for (const w of warnings) warn(`${w.file}: ${w.msg}`);
  const tail = warnings.length ? tr(project.cfg.lang, `, предупреждений ${warnings.length}`, `, warnings ${warnings.length}`) : '';
  if (errors.length) {
    bad(tr(project.cfg.lang, `lint: ошибок ${errors.length}${tail}`, `lint: errors ${errors.length}${tail}`));
    return 1;
  }
  ok(tr(project.cfg.lang, `lint: ошибок нет${tail}`, `lint: no errors${tail}`));
  return 0;
}
