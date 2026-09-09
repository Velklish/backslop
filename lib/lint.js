// Гейты трекера. Каждый ловит то, что руками разъезжается молча: битую ссылку, два файла с
// одним номером, задачу в очереди без порядка, архив без результата, упоминание номера,
// за которым нет файла. Отказ перечисляет всё найденное; код возврата — 1 при ошибках.
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { CONFIG_FILE, SOURCE, STATUSES, loadProject, parseCli } from './config.js';
import { blankFences, brokenLinks, relativeLinks } from './links.js';
import { mdFiles } from './mdwalk.js';
import { ADR_FILE_RE, scanAdrs } from './adr.js';
import {
  FIELD_AREA, FIELD_CREATED, FIELD_DEPS, FIELD_ORDER, FIELD_TAKEN, SECTION_DEFERRED, canonicalId, fieldName, fieldOccurrences, getField, idMentionRe, orderOf, readText, readTitle, scanTasks,
  sectionBody, sectionName, splitLines, taskDirRe, taskFileRe,
} from './tasks.js';
import { bad, ok, toPosix, warn } from './util.js';
import { TOOL_VERSION, compareVersions } from './version.js';
import { generatedAdapterFiles, ownedAdapterFiles } from './adapters.js';
import { tr } from './i18n.js';
import { templateParity } from './templates.js';

const TODO = /\[TODO/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CHANGELOG_ENTRY = /^- \*\*(.+?)\*\*/;
const QUOTE_OPEN = /^\s*<!--\s*quote:(\S+?)\s*-->\s*$/;
const QUOTE_CLOSE = /^\s*<!--\s*\/quote\s*-->\s*$/;
const FENCE_LINE = /^\s*(?:`{3,}|~{3,})/;

// Файлы, где пин в прозе — живая инструкция по установке, а не запись истории: CHANGELOG и
// ADR описывают момент, их номера версий дрейфом не считаются.
const RELEASE_PIN_FILES = ['README.md', 'README.ru.md', 'AGENTS.md'];
// Обе формы установки с настоящим номером: github-спека с тегом и npm-версия. Обобщённая
// запись примера (`#v<версия>`, `backslop@X.Y.Z`) под шаблон не подпадает — дрейфовать нечему.
const PIN_IN_PROSE = new RegExp(`(?:${SOURCE.replace(/[.\\]/g, '\\$&')}#v|backslop@)(\\d+\\.\\d+\\.\\d+)`, 'g');

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
  lintAreaField(project, tasks, err);
  lintArchive(project, err);
  lintMentions(project, tasks, err);
  lintChangelog(root, err, cfg.lang);
  lintAdrIndex(project, err);
  lintClosedParent(project, tasks, err);
  lintQuotes(project, err);
  lintVersion(project, note);
  lintReleaseVersions(project, err);
  lintTemplateParity(project, err);
  return { errors, warnings };
}

// 11. Релиз инструмента: версия пакета, штамп раскладки, секция CHANGELOG и пины в прозе
// называют одно число. Гейт только в репозитории самого backslop — тем же маркером, что
// равенство шаблонов: у чужого проекта своей версии инструмента нет, и сверять нечего.
function lintReleaseVersions({ root, cfg }, err) {
  if (!existsSync(path.join(root, 'templates', 'skills', 'backslop-task', 'SKILL.md'))) return;
  const pkgFile = path.join(root, 'package.json');
  if (!existsSync(pkgFile)) return;
  const version = JSON.parse(readText(pkgFile)).version;
  if (version !== cfg.version) {
    err(pkgFile, tr(cfg.lang,
      `версия package.json v${version} расходится со штампом ${CONFIG_FILE} v${cfg.version} — бампит оба npm run release -- X.Y.Z --bump`,
      `package.json version v${version} differs from the ${CONFIG_FILE} stamp v${cfg.version} — npm run release -- X.Y.Z --bump updates both`));
  }
  const changelog = path.join(root, 'CHANGELOG.md');
  if (existsSync(changelog) && !new RegExp(`^## v${version.replace(/\./g, '\\.')}\\b`, 'm').test(readText(changelog))) {
    err(changelog, tr(cfg.lang,
      `нет секции «## v${version}» — выпускаемая версия без записи`,
      `no “## v${version}” section — the released version has no entry`));
  }
  for (const name of RELEASE_PIN_FILES) {
    const file = path.join(root, name);
    if (!existsSync(file)) continue;
    readText(file).split('\n').forEach((line, i) => {
      for (const m of line.matchAll(PIN_IN_PROSE)) {
        if (m[1] !== version) {
          err(file, tr(cfg.lang,
            `строка ${i + 1}: пин ${m[0]} — инструмент на v${version}`,
            `line ${i + 1}: pin ${m[0]} — the tool is on v${version}`));
        }
      }
    });
  }
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
function lintStatusFields({ root, cfg }, tasks, err) {
  // Один «Порядок» у двух файлов очереди — место каждой из них неопределено: команды при
  // равенстве берут номер, но это не решение, а совпадение.
  const ranked = new Map();
  for (const t of tasks) {
    if (t.status === 'archive') continue;
    const text = readText(t.file);
    for (const name of [FIELD_ORDER, FIELD_AREA, FIELD_CREATED, FIELD_TAKEN, FIELD_DEPS]) {
      const occurrences = fieldOccurrences(text, name);
      if (occurrences.length > 1) {
        const lines = occurrences.map(([line]) => line + 1).join(', ');
        err(t.file, tr(cfg.lang,
          'поле «' + fieldName(name, cfg.lang) + '» повторяется в строках ' + lines,
          'field “' + fieldName(name, cfg.lang) + '” occurs more than once on lines ' + lines));
      }
    }
    if (t.status === 'queue') {
      const rank = orderOf(text);
      if (rank === null) err(t.file, tr(cfg.lang, `в очереди без поля «${fieldName(FIELD_ORDER, cfg.lang)}» — место в очереди не задано`, `queue task has no “${fieldName(FIELD_ORDER, cfg.lang)}” field — queue position is not set`));
      else if (!Number.isInteger(rank)) err(t.file, tr(cfg.lang, `«${fieldName(FIELD_ORDER, cfg.lang)}» не целое число`, `“${fieldName(FIELD_ORDER, cfg.lang)}” is not an integer`));
      else if (ranked.has(rank)) {
        const first = toPosix(path.relative(root, ranked.get(rank)));
        err(t.file, tr(cfg.lang, `«${fieldName(FIELD_ORDER, cfg.lang)}» ${rank} уже у ${first} — переставь: mv N queue --top | --after M`, `“${fieldName(FIELD_ORDER, cfg.lang)}” ${rank} is already used by ${first} — reorder with mv N queue --top | --after M`));
      } else ranked.set(rank, t.file);
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

// 4. «Область» разобранной задачи: раздел справочника выбран и вписан. `triage/` не
// проверяется — запись там по определению лежит без разбора, а выбор раздела и есть разбор;
// архив — снимок момента. Заглушка `[TODO]` от `new` считается незаполненным полем.
function lintAreaField({ cfg }, tasks, err) {
  const label = fieldName(FIELD_AREA, cfg.lang);
  for (const t of tasks) {
    if (t.status === 'archive' || t.status === 'triage') continue;
    const value = getField(readText(t.file), FIELD_AREA);
    if (value === null) {
      err(t.file, tr(cfg.lang, `без поля «${label}»: раздел справочника, к которому относится задача`, `has no “${label}” field naming the reference section this task belongs to`));
    } else if (!value) {
      err(t.file, tr(cfg.lang, `«${label}» пуста: назови раздел справочника`, `“${label}” is empty: name the reference section`));
    } else if (TODO.test(value)) {
      err(t.file, tr(cfg.lang, `«${label}» не заполнена: осталась заглушка [TODO] от new`, `“${label}” is incomplete: the [TODO] placeholder from new remains`));
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

// 9. Находка в triage/, чья задача уже закрыта: разбор triage отстал от архива. Гейт 2 такую
// находку пропускает — родитель у неё есть, просто он в archive/. Каталоги кроме triage/ не
// считаются: находка в queue/ или active/ уже разобрана, у неё есть ход.
function lintClosedParent({ cfg }, tasks, err) {
  for (const t of tasks) {
    if (t.sub === null || t.status !== 'triage') continue;
    const parent = tasks.find((p) => p.num === t.num && p.sub === null);
    if (!parent || parent.status !== 'archive') continue;
    err(t.file, tr(cfg.lang,
      `находка ${t.id} лежит в triage/, а задача ${parent.id} закрыта — разбери её`,
      `finding ${t.id} sits in triage/ while task ${parent.id} is closed — triage it`));
  }
}

// 10. Цитата живого файла: содержимое блока `<!-- quote:<путь> -->…<!-- /quote -->` обязано
// найтись в названном файле. Гейт ссылок сторожит только существование цели, а текст под
// ссылкой уезжает молча, и постановка живёт с цитатой, которой в файле уже нет.
// `docs/archive/` не проверяется: цитата в закрытой задаче — снимок момента.
function lintQuotes({ root, cfg, dirs }, err) {
  const files = mdFiles(dirs.docs, '').filter(([rel]) => !rel.startsWith('archive/'));
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (e.isFile() && e.name.endsWith('.md')) files.push([e.name, path.join(root, e.name)]);
  }
  for (const [, abs] of files) {
    const text = readText(abs);
    for (const block of quoteBlocks(text)) {
      if (block.body === null) {
        err(abs, tr(cfg.lang, `блок цитаты «quote:${block.href}» не закрыт «/quote»`, `quote block “quote:${block.href}” is not closed by “/quote”`));
        continue;
      }
      const target = block.href.startsWith('/')
        ? path.join(root, block.href)
        : path.resolve(path.dirname(abs), block.href);
      if (!statOrNull(target)?.isFile()) {
        err(abs, tr(cfg.lang, `цитата ведёт на несуществующий файл ${block.href}`, `quote points at a missing file ${block.href}`));
      } else if (!quoted(block.body, readText(target))) {
        const first = block.body.find((l) => l.trim()) ?? '';
        err(abs, tr(cfg.lang, `цитата разошлась с ${block.href}: «${first.trim()}»`, `quote no longer matches ${block.href}: “${first.trim()}”`));
      }
    }
  }
}

function statOrNull(file) {
  try {
    return statSync(file);
  } catch {
    return null;
  }
}

// Блоки цитат текста. Маркеры ищутся по тексту с погашенными фенсами — форма, показанная
// внутри блока кода, остаётся примером; тело берётся из сырых строк, потому что цитата кода
// как раз и обёрнута фенсом. Незакрытый блок отдаётся с body === null.
function quoteBlocks(text) {
  const raw = splitLines(text);
  const clean = splitLines(blankFences(text));
  const out = [];
  let open = null;
  for (let i = 0; i < clean.length; i += 1) {
    const m = clean[i].match(QUOTE_OPEN);
    if (m) {
      // Второй открывающий маркер закрывает предыдущий ошибкой, а не молча его затирает.
      if (open) out.push({ href: open.href, body: null });
      open = { href: m[1], at: i };
      continue;
    }
    if (open && QUOTE_CLOSE.test(clean[i])) {
      out.push({ href: open.href, body: raw.slice(open.at + 1, i) });
      open = null;
    }
  }
  if (open) out.push({ href: open.href, body: null });
  return out;
}

// Цитата — непрерывный кусок файла. Пробелы по краям строк снимаются с обеих сторон:
// переотступ кода смысла не меняет. Отбрасывается только обёртка-фенс, в которую цитату кода
// заворачивает markdown; фенсы внутри цитаты остаются — иначе кусок документации с блоком
// кода не совпал бы никогда.
function quoted(body, fileText) {
  const needle = body.map((l) => l.trim());
  while (needle.length && !needle[0]) needle.shift();
  while (needle.length && !needle[needle.length - 1]) needle.pop();
  if (needle.length >= 2 && FENCE_LINE.test(needle[0]) && FENCE_LINE.test(needle[needle.length - 1])) {
    needle.shift();
    needle.pop();
  }
  if (!needle.length) return true;
  const hay = splitLines(fileText).map((l) => l.trim());
  for (let i = 0; i + needle.length <= hay.length; i += 1) {
    if (needle.every((line, k) => hay[i + k] === line)) return true;
  }
  return false;
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
