// Гейты трекера. Каждый ловит то, что руками разъезжается молча: битую ссылку, два файла с
// одним номером, задачу в очереди без порядка, архив без результата, упоминание номера,
// за которым нет файла. Отказ перечисляет всё найденное; код возврата — 1 при ошибках.
import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { CONFIG_FILE, SOURCE, STATUSES, loadProject, parseCli, pinRe, pinSep } from './config.js';
import { blankFences, brokenLinks, directoryLinks, relativeLinks } from './links.js';
import { LOG_FILE, brokenLogLines, logAnchor, logFile, readLogText } from './log.js';
import { liveMarkdown, livePinFiles, mdFiles } from './mdwalk.js';
import { ADR_FILE_RE, scanAdrs } from './adr.js';
import {
  FIELD_AREA, FIELD_COST, FIELD_CREATED, FIELD_DEPS, FIELD_ORDER, FIELD_PARENT, FIELD_PREV_ORDER, FIELD_TAKEN, SECTION_DEFERRED, canonicalId, fieldName, fieldOccurrences, getField, hasResultTodo, idMentionRe, orderOf, parseCost, readText, readTitle, scanTasks,
  sectionBody, sectionName, sectionOccurrences, splitLines, taskDirRe, taskFileRe,
} from './tasks.js';
import { bad, git, ok, toPosix, warn } from './util.js';
import { TOOL_VERSION, compareVersions } from './version.js';
import { generatedAdapterFiles, ownedAdapterFiles } from './adapters.js';
import { GENERATED_MARKER, isOwnedAdapterFile } from './adapter-ownership.js';
import { tr } from './i18n.js';
import { TEMPLATES_DIR, templateParity, templateSlots } from './templates.js';

const TODO_VALUE = /^\[TODO(?:[^\]\n]*)\](?:\s*\([^\)\n]*\))?$/;
// Маркер списка снимается до разбора поля, а имя поля не начинается с `[TODO`: иначе
// `- [TODO: текст]` читалось полем «[TODO» со значением «текст]», и заглушка списка
// проходила гейт молча.
const TODO_FIELD = /^(?:\*\*[^*\n]+:\*\*|\*\*[^*\n]+\*\*:|(?!\[TODO)[^:\n]+:)[ \t]*(.*)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// Заголовок записи CHANGELOG. Гейт 7 ловит им дубли внутри секции, `merge-changelog` —
// опознаёт запись при слиянии двух редакций: разойдясь, они склеили бы разные множества.
export const CHANGELOG_ENTRY = /^- \*\*(.+?)\*\*/;
const QUOTE_OPEN = /^\s*<!--\s*quote:(?:(before):)?(\S+?)\s*-->\s*$/;
const QUOTE_CLOSE = /^\s*<!--\s*\/quote\s*-->\s*$/;
const FENCE_LINE = /^\s*(?:`{3,}|~{3,})/;

// Файлы, где пин в прозе — живая инструкция по установке, а не запись истории: CHANGELOG и
// ADR описывают момент, их номера версий дрейфом не считаются.
const RELEASE_PIN_FILES = ['README.md', 'README.ru.md', 'AGENTS.md'];
// Обе формы установки с настоящим номером: github-спека с тегом и npm-версия. Обобщённая
// запись примера (`#v<версия>`, `backslop@X.Y.Z`) под шаблон не подпадает — дрейфовать нечему.
const PIN_IN_PROSE = new RegExp(`(?:${SOURCE.replace(/[.\\]/g, '\\$&')}#v|backslop@)(\\d+\\.\\d+\\.\\d+)`, 'g');

// Ошибки красят гейт; предупреждения только печатаются: версия раскладки, находка под закрытым
// родителем и пустая «Область» в minor/ требуют хода, но не блокируют проект.
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
  lintBacklogTodos(project, err);
  lintStatusFields(project, tasks, err);
  lintAreaField(project, tasks, err, note);
  lintArchive(project, err);
  lintLog(project, tasks, err, note);
  lintMentions(project, tasks, err);
  lintChangelog(root, err, cfg.lang);
  lintAdrIndex(project, err);
  lintClosedParent(project, tasks, note);
  lintQuotes(project, err);
  lintVersion(project, note);
  lintProsePin(project, err);
  lintReleaseVersions(project, err);
  lintTemplateParity(project, err);
  lintTemplateSlots(project, err);
  return { errors, warnings };
}

// Репозиторий инструмента узнаётся тождеством каталогов: `templates/` проекта и есть тот,
// из которого рендерит запущенный CLI. Признак по файлу-маркеру гас от переименования
// скилла, признак по наличию каталогов — от удаления целого слоя; тождество не гаснет ни
// от чего и не задевает чужой проект со своим `templates/skills/`. Сравнение по realpath:
// checkout по пути с symlink иначе выключил бы гейт молча.
function sameDir(a, b) {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
}

// 11. Релиз инструмента: версия пакета, штамп раскладки, секция CHANGELOG и пины в прозе
// называют одно число. Гейт только в репозитории самого backslop — тем же признаком, что
// равенство шаблонов: у чужого проекта своей версии инструмента нет, и сверять нечего.
function lintReleaseVersions({ root, cfg }, err) {
  if (!sameDir(path.join(root, 'templates'), TEMPLATES_DIR)) return;
  const pkgFile = path.join(root, 'package.json');
  if (!existsSync(pkgFile)) return;
  const version = JSON.parse(readText(pkgFile)).version;
  if (typeof version !== 'string') {
    err(pkgFile, tr(cfg.lang, 'нет поля version — сверять штамп, секцию CHANGELOG и пины не с чем', 'no version field — there is nothing to check the stamp, CHANGELOG section, and pins against'));
    return;
  }
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
  const templates = path.join(root, 'templates');
  if (!sameDir(templates, TEMPLATES_DIR)) return;
  for (const msg of templateParity(templates)) err(templates, msg);
}

// 12. Слоты шаблонов: у чужого проекта своего `templates/` в этом смысле нет — контракт
// связывает шаблон инструмента с кодом инструмента, и сверять его есть чем только здесь.
function lintTemplateSlots({ root }, err) {
  const templates = path.join(root, 'templates');
  if (!sameDir(templates, TEMPLATES_DIR)) return;
  for (const msg of templateSlots(templates)) err(templates, msg);
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

// Пин живёт в живой прозе и в конфигурации запуска. Расхождение — ошибка: команда со старым
// пином может звать снятую версию. Проверка охватывает markdown, `package.json` и известные CI-файлы.
// CHANGELOG, ADR, архивные карточки и карточки задач описывают историю и остаются зелёными.
// Голый `vX.Y.Z` в прозе не считается: он законно называет историю.
function lintProsePin({ root, cfg }, err) {
  const form = parseCli(cfg.cli);
  // Без пина в cli (self-host, глобальная установка) сверять не с чем: версия того backslop,
  // который сейчас запустил lint, решением этого проекта не является.
  if (!form || form.pin === null) return;
  const expected = `${form.spec}${pinSep(form)}${form.pin}`;
  const re = pinRe(form);
  for (const [, abs] of livePinFiles(root, cfg.docs, cfg.prefix)) {
    readText(abs).split('\n').forEach((line, i) => {
      for (const m of line.matchAll(re)) {
        if (m[1] === form.pin) continue;
        err(abs, tr(cfg.lang,
          `строка ${i + 1}: пин ${m[0]} расходится с cli — ожидается ${expected}; переставит ${cfg.cli} upgrade`,
          `line ${i + 1}: pin ${m[0]} differs from cli — expected ${expected}; ${cfg.cli} upgrade rewrites it`));
      }
    });
  }
}

// 1. Ссылки: docs/**, корневые *.md и скиллы backslop.
function lintLinks({ root, cfg, dirs }, err) {
  const files = [...mdFiles(dirs.docs, '')];
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (e.isFile() && e.name.endsWith('.md')) files.push([e.name, path.join(root, e.name)]);
  }
  // Каталог — законная цель, но ссылка, чей текст называет задачу, обещает её карточку.
  const names = new RegExp(idMentionRe(cfg.prefix).source);
  for (const [, abs] of files) {
    for (const href of brokenLinks(abs, root)) err(abs, tr(cfg.lang, `битая ссылка ${href}`, `broken link ${href}`));
    for (const { text, href } of directoryLinks(abs, root)) {
      if (names.test(text)) err(abs, tr(cfg.lang, `ссылка [${text}](${href}) ведёт на каталог, а её текст называет задачу — веди на файл задачи или строку журнала`, `link [${text}](${href}) points to a directory while its text names a task — point it at the task file or its journal line`));
    }
  }
}

// Generated adapter outputs не входят в общий repository-wide обход: archive/mv не должны
// переписывать производные файлы. Их наличие и ссылки проверяются отдельным гейтом.
function lintAdapters({ root, cfg }, err) {
  const owned = ownedAdapterFiles(root, cfg.lang);
  for (const tool of cfg.tools) {
    for (const file of owned[tool]) {
      if (!existsSync(file)) {
        err(file, tr(cfg.lang, `нет generated output для adapter ${tool} — запусти ${cfg.cli} init`, `generated output for adapter ${tool} is missing — run ${cfg.cli} init`));
        continue;
      }
      // Каталог на owned-пути: init на нём отказывает, а предикат владения на legacy-пути
      // истинен без взгляда на тип записи — без этой ветви гейт был бы зелёным там, где init
      // не работает.
      if (!statOrNull(file)?.isFile()) {
        err(file, tr(cfg.lang, 'owned adapter output не является файлом — init на нём отказывает', 'owned adapter output is not a file — init refuses on it'));
        continue;
      }
      // Чужой файл без маркера на owned-пути init не переписывает (ADR-015): скилл backslop на
      // этом пути не установлен, и зелёный lint прятал бы это.
      const rel = toPosix(path.relative(root, file));
      if (!isOwnedAdapterFile(rel, file)) {
        err(file, tr(cfg.lang,
          `на пути adapter output ${tool} чужой файл без маркера ${GENERATED_MARKER} — init его не переписывает: убери или переименуй файл и запусти ${cfg.cli} init, либо сними adapter`,
          `a foreign file without the ${GENERATED_MARKER} marker sits at the ${tool} adapter output path — init does not overwrite it: remove or rename the file and run ${cfg.cli} init, or deselect the adapter`));
      }
    }
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
      // Symlink на каталог — тот же каталог: scanTasks его задачей не считает, и без stat
      // ветвь молчала бы, потому что у Dirent ссылки isDirectory() — false.
      const st = e.isSymbolicLink() ? statOrNull(path.join(dir, e.name)) : e;
      if (st?.isDirectory()) err(path.join(dir, e.name), tr(cfg.lang, 'каталог внутри каталога статуса: задача — один файл', 'directory inside a status directory: each task must be one file'));
      else if (st === null) err(path.join(dir, e.name), tr(cfg.lang, 'битая ссылка в каталоге статуса: задача — файл, а по ссылке ничего нет', 'dangling symlink in a status directory: a task is a file, and the link points to nothing'));
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
      err(abs, tr(cfg.lang, `файл вне каталога статуса: задача лежит в одном из ${STATUSES.map((s) => `${s}/`).join(', ')}`, `file is outside a status directory: tasks belong in one of ${STATUSES.map((s) => `${s}/`).join(', ')}`));
    }
  }
  for (const status of STATUSES) {
    if (!existsSync(dirs.statusDir[status])) err(dirs.statusDir[status], tr(cfg.lang, 'каталога статуса нет — создай пустым', 'status directory is missing — create it empty'));
  }
}

// Заглушка должна занимать всё значение строки, а не встречаться внутри объяснения.
// Фенсы — примеры, а не живое поле бэклога.
// `triage/` не проверяется вовсе: `new` кладёт туда полную карточку с заготовками, и до
// разбора их некому заполнить — гейт красил бы запись, заведённую штатной командой.
// Заглушка «Области» в minor/ — не ошибка: область там необязательна, её ведёт гейт 4 предупреждением.
function lintBacklogTodos({ root, cfg, dirs }, err) {
  const relBacklog = toPosix(path.relative(root, dirs.backlog));
  for (const [, file] of mdFiles(dirs.backlog, relBacklog)) {
    if (path.dirname(file) === dirs.statusDir.triage) continue;
    const text = readText(file);
    const inMinor = path.dirname(file) === dirs.statusDir.minor;
    const areaLine = inMinor ? (fieldOccurrences(text, FIELD_AREA)[0]?.[0] ?? -1) : -1;
    splitLines(blankFences(text)).forEach((line, i) => {
      if (i === areaLine) return;
      if (isTodoPlaceholder(line)) {
        err(file, tr(cfg.lang, `строка ${i + 1}: осталась заглушка [TODO]`, `line ${i + 1}: the [TODO] placeholder remains`));
      }
    });
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
    for (const name of [FIELD_ORDER, FIELD_PREV_ORDER, FIELD_AREA, FIELD_CREATED, FIELD_TAKEN, FIELD_DEPS, FIELD_PARENT, FIELD_COST]) {
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
    if (t.status === 'minor') {
      const label = fieldName(FIELD_COST, cfg.lang);
      const cost = getField(text, FIELD_COST);
      const parsed = cost ? parseCost(cost) : null;
      if (!cost) err(t.file, tr(cfg.lang, `в minor/ без поля «${label}»: critical, major или minor; гипотеза — с пометкой «(гипотеза)»`, `minor entry has no “${label}” field: critical, major or minor; a hypothesis carries “(hypothesis)”`));
      else if (!parsed) err(t.file, tr(cfg.lang, `«${label}» не разбирается: critical, major или minor; гипотеза — «major (гипотеза)»`, `“${label}” is unreadable: critical, major or minor; a hypothesis is “major (hypothesis)”`));
      else if (parsed.level !== 'minor' && !parsed.hypothesis) err(t.file, tr(cfg.lang, `«${label}» ${parsed.level} без пометки «гипотеза»: с уликой такая находка чинится сейчас, а не ждёт пачки — чини или mv N.k triage`, `“${label}” ${parsed.level} without the “hypothesis” mark: with evidence such a finding is fixed now, not queued for a batch — fix it or mv N.k triage`));
    }
    if (t.status === 'deferred') {
      const body = sectionBody(text, SECTION_DEFERRED);
      const sections = sectionOccurrences(text, SECTION_DEFERRED);
      if (sections > 1) {
        err(t.file, tr(cfg.lang, `раздел «${sectionName(SECTION_DEFERRED, cfg.lang)}» повторяется ${sections} раза — оставь один`, `“${sectionName(SECTION_DEFERRED, cfg.lang)}” section occurs ${sections} times — keep one`));
      }
      if (body === null || !body) err(t.file, tr(cfg.lang, `отложена без раздела «## ${sectionName(SECTION_DEFERRED, cfg.lang)}»: причина и условие возврата`, `deferred task has no “## ${sectionName(SECTION_DEFERRED, cfg.lang)}” section with a reason and return condition`));
      else if (hasTodoPlaceholder(body)) err(t.file, tr(cfg.lang, `раздел «${sectionName(SECTION_DEFERRED, cfg.lang)}» не заполнен: остался [TODO]`, `“${sectionName(SECTION_DEFERRED, cfg.lang)}” section is incomplete: [TODO] remains`));
    }
  }
}

function hasTodoPlaceholder(text) {
  return splitLines(blankFences(text)).some((line) => isTodoPlaceholder(line));
}

function isTodoPlaceholder(line) {
  const value = line.trim().replace(/^>\s*/, '').replace(/^[-*+]\s+/, '').trim();
  if (TODO_VALUE.test(value)) return true;
  const field = value.match(TODO_FIELD);
  return TODO_VALUE.test(field ? field[1].trim() : value);
}

// 4. «Область» разобранной задачи: раздел справочника выбран и вписан. `triage/` не
// проверяется — запись там по определению лежит без разбора, а выбор раздела и есть разбор;
// архив — снимок момента. Заглушка `[TODO]` от `new` считается незаполненным полем.
// В `minor/` область заполняет approver при резке пачек — там это предупреждение.
function lintAreaField({ cfg }, tasks, err, note) {
  const label = fieldName(FIELD_AREA, cfg.lang);
  for (const t of tasks) {
    if (t.status === 'archive' || t.status === 'triage') continue;
    const report = t.status === 'minor' ? note : err;
    const value = getField(readText(t.file), FIELD_AREA);
    if (value === null) {
      report(t.file, tr(cfg.lang, `без поля «${label}»: раздел справочника, к которому относится задача`, `has no “${label}” field naming the reference section this task belongs to`));
    } else if (!value) {
      report(t.file, tr(cfg.lang, `«${label}» пуста: назови раздел справочника`, `“${label}” is empty: name the reference section`));
    } else if (isTodoPlaceholder(value)) {
      report(t.file, tr(cfg.lang, `«${label}» не заполнена: осталась заглушка [TODO] от new`, `“${label}” is incomplete: the [TODO] placeholder from new remains`));
    }
  }
}

// 5. Архив: каталог на задачу с task.md и result.md, результат дописан. Каталог остаётся
// законной формой сколько угодно долго — свёртка не обязательна, — но свёрнутая задача живёт
// строкой журнала, и её сторожит гейт 13.
function lintArchive({ cfg, dirs }, err) {
  if (!existsSync(dirs.archive)) return;
  const dirRe = taskDirRe(cfg.prefix);
  for (const e of readdirSync(dirs.archive, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const abs = path.join(dirs.archive, e.name);
    if (!e.isDirectory()) {
      if (e.name !== 'README.md' && e.name !== LOG_FILE) err(abs, tr(cfg.lang, `в архиве только каталоги задач, README.md и ${LOG_FILE}`, `archive may contain only task directories, README.md, and ${LOG_FILE}`));
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
    else if (hasResultTodo(readText(result))) err(result, tr(cfg.lang, 'результат не дописан: остался [TODO]', 'result is incomplete: [TODO] remains'));
    // Подкаталог minor/ — записи, закрытые этой пачкой; иного содержимого в нём нет.
    const minorDir = path.join(abs, 'minor');
    if (!existsSync(minorDir)) continue;
    const fileRe = taskFileRe(cfg.prefix);
    for (const m of readdirSync(minorDir, { withFileTypes: true })) {
      if (m.name.startsWith('.')) continue;
      if (!m.isFile() || !fileRe.test(m.name)) err(path.join(minorDir, m.name), tr(cfg.lang, `в minor/ пачки только файлы записей ${cfg.prefix}-N[.k]-<slug>.md`, `minor/ of a batch holds only entry files ${cfg.prefix}-N[.k]-<slug>.md`));
    }
  }
}

// 13. Журнал закрытых: запись разбирается, якорь строки совпадает с номером, и ссылка на
// `LOG.md#<якорь>` ведёт на существующую строку. Последнее — единственная проверка якоря во всём
// lint: гейт ссылок резолвит только путь, и после свёртки промах якоря был бы невидим, а ведут
// на журнал теперь все входящие ссылки закрытых задач.
function lintLog({ root, cfg, dirs }, tasks, err, note) {
  const file = logFile(dirs);
  if (existsSync(file)) {
    const text = readText(file);
    for (const { line, text: raw } of brokenLogLines(text, cfg.prefix)) {
      err(file, tr(cfg.lang,
        `строка ${line} выглядит записью журнала, но не разбирается: «${raw.trim().slice(0, 80)}»`,
        `line ${line} looks like a journal entry but does not parse: “${raw.trim().slice(0, 80)}”`));
    }
    const entries = readLogText(text, cfg.prefix);
    for (const e of entries) {
      if (e.anchor !== logAnchor(e.id)) {
        err(file, tr(cfg.lang,
          `строка ${e.line}: якорь «${e.anchor}» не совпадает с номером — входящие ссылки ведут на «${logAnchor(e.id)}»`,
          `line ${e.line}: anchor “${e.anchor}” does not match the number — incoming links point at “${logAnchor(e.id)}”`));
      }
    }
    lintLogRevisions(root, cfg, file, entries, err, note);
  }
  const anchors = new Set(tasks.filter((t) => t.folded).map((t) => logAnchor(t.id)));
  const logRel = toPosix(path.relative(root, file));
  // Пути от корня проекта, а не от `docs/`: цель ссылки резолвится каталогом файла, и обход с
  // пустым префиксом дал бы `ROADMAP.md` вместо `docs/ROADMAP.md` — промах якоря стал бы невидим.
  const files = [...mdFiles(dirs.docs, toPosix(path.relative(root, dirs.docs)))];
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (e.isFile() && e.name.endsWith('.md')) files.push([e.name, path.join(root, e.name)]);
  }
  for (const [rel, abs] of files) {
    const dir = path.posix.dirname(rel);
    for (const href of relativeLinks(readText(abs))) {
      const [target, anchor] = href.split('#');
      if (anchor === undefined || !target) continue;
      const resolved = target.startsWith('/') ? target.slice(1) : path.posix.normalize(path.posix.join(dir, target));
      if (resolved !== logRel || anchors.has(anchor)) continue;
      err(abs, tr(cfg.lang,
        `ссылка ${href} ведёт на строку журнала, которой нет — якорь «${anchor}» ни за одной записью`,
        `link ${href} points at a journal line that does not exist — anchor “${anchor}” belongs to no entry`));
    }
  }
}

// Ревизия строки журнала обязана лежать в истории `HEAD`, иначе `show N` тела по ней не достанет.
// Неполный клон и проект без git ответить не могут: это предупреждение, а не зелёный и не красный.
function lintLogRevisions(root, cfg, file, entries, err, note) {
  const named = entries.filter((e) => e.commit);
  if (!named.length) return;
  const shallow = git(root, ['rev-parse', '--is-shallow-repository']);
  const history = shallow.status === 0 && shallow.stdout.trim() === 'false' ? git(root, ['rev-list', 'HEAD'], { maxBuffer: 1 << 28 }) : null;
  if (history?.status !== 0) {
    const failed = history ?? shallow;
    const why = shallow.stdout?.trim() === 'true'
      ? tr(cfg.lang, 'клон неполный (shallow), старых коммитов в нём нет', 'the clone is shallow and lacks older commits')
      : (failed.stderr ?? '').trim().split('\n')[0] || failed.error?.message || `git ${failed.status}`;
    note(file, tr(cfg.lang, `достижимость ревизий журнала из HEAD не проверена: ${why}`, `reachability of journal revisions from HEAD was not checked: ${why}`));
    return;
  }
  const revs = history.stdout.split('\n');
  const prefixes = new Map();
  for (const e of named) {
    if (!prefixes.has(e.commit.length)) prefixes.set(e.commit.length, new Set(revs.map((r) => r.slice(0, e.commit.length))));
    if (prefixes.get(e.commit.length).has(e.commit)) continue;
    err(file, tr(cfg.lang,
      `строка ${e.line}: ревизия ${e.commit} не достижима из HEAD — show тела по ней не достанет; такую ревизию оставляет коммит, выброшенный squash или rebase после свёртки`,
      `line ${e.line}: revision ${e.commit} is not reachable from HEAD — show will not find the body through it; such a revision is left by a commit that a squash or rebase dropped after folding`));
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

// 9. Находка в triage/, чья задача уже закрыта: lint пишет предупреждение для approver'а, но
// не красит гейт. Каталоги кроме triage/ не считаются: находка в queue/ или active/ уже разобрана.
function lintClosedParent({ cfg }, tasks, note) {
  for (const t of tasks) {
    if (t.sub === null || t.status !== 'triage') continue;
    const parent = tasks.find((p) => p.num === t.num && p.sub === null);
    if (!parent || parent.status !== 'archive') continue;
    note(t.file, tr(cfg.lang,
      `находка ${t.id} лежит в triage/, а задача ${parent.id} закрыта — разбери её (approver)`,
      `finding ${t.id} sits in triage/ while task ${parent.id} is closed — triage it (approver)`));
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
      } else if (!block.before && !quoted(block.body, readText(target))) {
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
      if (open) out.push({ href: open.href, before: open.before, body: null });
      open = { href: m[2], before: m[1] === 'before', at: i };
      continue;
    }
    if (open && QUOTE_CLOSE.test(clean[i])) {
      out.push({ href: open.href, before: open.before, body: raw.slice(open.at + 1, i) });
      open = null;
    }
  }
  if (open) out.push({ href: open.href, before: open.before, body: null });
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
