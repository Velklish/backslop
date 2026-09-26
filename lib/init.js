// Раскладка в проект: конфиг, скелет docs, скиллы, блок в AGENTS.md — идемпотентно, правила
// повтора — docs/reference/01-layout.md, «Что кладёт init».
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  BLOCK_END, BLOCK_MARKERS, BLOCK_START, CONFIG_FILE, LANGS, PREFIX_RE, STATUSES, defaults, expectDirectory, findRoot, isProjectPath, layout, loadConfig, parseCli, saveConfig, validateConfig,
} from './config.js';
import { CLAUDE_STUB, checkAdapterRoots, cleanupAdapters, ensureClaudeStub, renderAdapters } from './adapters.js';
import { TOOLS, adapterRootRel, validTools } from './adapters-registry.js';
import { srcFiles } from './mdwalk.js';
import { TEMPLATES_DIR, renderProjectTemplate, templateRel } from './templates.js';
import { formatAdrNumber, scanAdrs } from './adr.js';
import { sameDir } from './lint.js';
import { CliError, info, ok, parseCommandArgs, readJsonOrNull, today, toPosix, warn, writeText } from './util.js';
import { TOOL_VERSION, compareVersions, stampNewerHead } from './version.js';
import { tr } from './i18n.js';
import { eolOf } from './text.js';

// В .gitignore html-комментарий был бы не комментарием, а шаблоном имени файла с пробелами.
const IGNORE_MARKERS = BLOCK_MARKERS.map((marker) => `# ${marker}`);
const STEP_RE = /^([1-7])\. /;
// Весь класс ASCII-пунктуации CommonMark — 32 символа, от `!` до `~`. Почему список полон и
// почему оговорки спеки до дела не доходят — ADR-020.
const MD_PUNCT = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/g;
const WORKER_BOUNDARY_RE = /^(?:Границы worker'а|Worker boundaries):/;

export async function run(argv, { cwd }) {
  const { values } = parseCommandArgs(argv, {
    dir: { type: 'string' },
    prefix: { type: 'string' },
    cli: { type: 'string' },
    lang: { type: 'string' },
    tools: { type: 'string' },
  });
  const root = path.resolve(cwd);
  const existingRoot = findRoot(root);
  if (existingRoot && existingRoot !== root) {
    throw new CliError(`project is already initialized above at ${existingRoot}; run init there or create a separate ${CONFIG_FILE} / проект уже инициализирован выше: ${existingRoot} — запускай init там или заводи отдельный ${CONFIG_FILE}`);
  }

  let cfg;
  let freshConfig = false;
  const created = [];
  const skipped = [];
  const notes = [];
  const requestedLang = values.lang;
  if (requestedLang !== undefined && !LANGS.includes(requestedLang)) {
    throw new CliError(`--lang «${requestedLang}»: нужен ru или en / must be ru or en`);
  }
  const requestedTools = values.tools === undefined ? undefined : parseTools(values.tools);
  const normDir = (p) => toPosix(path.normalize(p)).replace(/\/+$/, '');
  if (values.dir !== undefined && !isProjectPath(values.dir)) {
    throw new CliError(`--dir “${values.dir}”: expected a relative path inside the project / нужен относительный путь внутри проекта`);
  }
  const dir = values.dir === undefined ? undefined : normDir(values.dir);
  const configFile = path.join(root, CONFIG_FILE);
  if (existsSync(configFile)) {
    cfg = loadConfig(root);
    // Раскладка старой версией затёрла бы скиллы и штамп более новой: понижение — не init.
    if (cfg.version && compareVersions(cfg.version, TOOL_VERSION) > 0) {
      const head = stampNewerHead(cfg.version);
      throw new CliError(tr(cfg.lang, `${head.ru}, старой версией раскладку не делаю`, `${head.en}; an older tool cannot generate this layout`));
    }
    const given = { ...values, dir };
    const stored = { ...cfg, docs: normDir(cfg.docs) };
    for (const [flag, key] of [['dir', 'docs'], ['prefix', 'prefix'], ['cli', 'cli']]) {
      if (given[flag] !== undefined && given[flag] !== stored[key]) {
        throw new CliError(tr(cfg.lang, `${CONFIG_FILE} уже есть, и там ${key} = «${cfg[key]}»; менять — правкой конфига, не флагом`, `${CONFIG_FILE} already sets ${key} = “${cfg[key]}”; change it in the config, not with this flag`));
      }
    }
    if (requestedLang !== undefined) cfg.lang = requestedLang;
    if (requestedTools !== undefined) cfg.tools = requestedTools;
    skipped.push(CONFIG_FILE);
  } else {
    const base = defaults();
    const prefix = values.prefix ?? base.prefix;
    if (!PREFIX_RE.test(prefix)) throw new CliError(`--prefix “${prefix}”: expected 2–6 uppercase Latin letters or digits, starting with a letter / нужны 2–6 заглавных латинских букв или цифр, первая буква`);
    const docs = dir ?? base.docs;
    const cli = values.cli ?? base.cli;
    cfg = {
      prefix, docs, cli, gates: [`${cli} lint`], version: TOOL_VERSION,
      lang: requestedLang ?? base.lang,
      tools: requestedTools ?? base.tools,
    };
    // The rules every later command applies to this file: a value they refuse is never written.
    validateConfig(cfg, cfg.lang);
    freshConfig = true;
  }

  // Self-host держит tools: [] (AGENTS.md): стенд с adapter'ом, поднятый из корня инструмента,
  // правил бы сам репозиторий.
  if (requestedTools?.length && sameDir(path.join(root, 'templates'), TEMPLATES_DIR)) {
    throw new CliError(tr(cfg.lang,
      `--tools ${values.tools}: ${root} — репозиторий самого backslop (templates/ — каталог запущенного инструмента), adapter outputs здесь не раскладываются; стенд поднимай в своём каталоге: init --tools ${values.tools} оттуда`,
      `--tools ${values.tools}: ${root} is the backslop repository itself (templates/ is the running tool's directory), adapter outputs are not laid out here; set up a stand in a directory of its own and run init --tools ${values.tools} there`));
  }

  // Pre-write phase: every read and check that can refuse runs here, before saveConfig — a refusal
  // after the first write left a config and a docs skeleton that the same init could not repair.
  checkAdapterRoots(root, cfg.tools, cfg.lang);
  const dirs = layout(root, cfg);
  for (const dir of [dirs.adr, dirs.archive, dirs.reference, ...Object.values(dirs.statusDir)]) expectDirectory(root, dir, cfg.lang);
  if (existsSync(dirs.docsReadme) && !statSync(dirs.docsReadme).isFile()) {
    const rel = toPosix(path.relative(root, dirs.docsReadme));
    throw new CliError(tr(cfg.lang, `${rel} — не файл: init читает его как индекс документации`, `${rel} is not a file: init reads it as the documentation index`));
  }
  const agentsFile = path.join(root, 'AGENTS.md');
  const agents = readManaged(agentsFile, [BLOCK_START, BLOCK_END], cfg.lang);
  const ignore = readManaged(path.join(root, '.gitignore'), IGNORE_MARKERS, cfg.lang, cfg.tools.length > 0);
  if (freshConfig) {
    saveConfig(root, cfg);
    created.push(CONFIG_FILE);
  }

  // ADR процесса — 001 или следующий свободный номер, иначе второй `adr-001-*` упёрся бы в гейт;
  // уже лежащий ADR процесса (любой номер) повторный init не трогает.
  const existingAdrs = scanAdrs(dirs.adr);
  const processAdr = existingAdrs.find((a) => a.slug === 'process');
  const adrNumber = processAdr ? formatAdrNumber(processAdr.number) : formatAdrNumber((existingAdrs.at(-1)?.number ?? 0) + 1);
  const adrRel = `adr/adr-${adrNumber}-process.md`;
  // Команду пробы знает только проект: нет поля — нет и требования в тексте, и пропажа
  // называется вслух (note ниже). ADR-021.
  const probeRule = cfg.probe
    ? ` ${renderProjectTemplate(cfg, 'agents-probe.md', { probe: cfg.probe.trim() }).trim()}`
    : '';
  const vars = {
    prefix: cfg.prefix,
    docs: cfg.docs,
    cli: cfg.cli,
    project: projectName(root),
    date: today(),
    adrNumber,
    probeRule,
  };

  const block = applyStepOverrides(renderProjectTemplate(cfg, 'agents-section.md', vars).trimEnd(), cfg);
  if (!cfg.probe) {
    notes.push(tr(cfg.lang,
      `probe в ${CONFIG_FILE} не объявлен: требования мутационной пробы нет ни в блоке, ни в скилле — объяви команду полем probe или опиши пробу своим разделом вне блока`,
      `probe is not declared in ${CONFIG_FILE}: neither the block nor the skill carries a mutation-probe requirement — declare the command in probe or describe the probe in a section of your own outside the block`));
  }

  // Скелет docs: каждый файл шаблона — один раз; существующий не трогается.
  const docsTemplates = path.join(TEMPLATES_DIR, ...templateRel(cfg.lang, 'docs').split('/'));
  for (const [tplRel] of srcFiles(docsTemplates, '', ['.md'])) {
    const rel = tplRel === 'adr/adr-001-process.md' ? adrRel : tplRel;
    const target = path.join(dirs.docs, ...rel.split('/'));
    if (existsSync(target)) {
      skipped.push(toPosix(path.relative(root, target)));
      continue;
    }
    writeText(target, renderProjectTemplate(cfg, `docs/${tplRel}`, vars));
    created.push(toPosix(path.relative(root, target)));
  }
  // Каталоги статусов пустыми в git не живут — .gitkeep держит их в клоне.
  for (const status of STATUSES) {
    const keep = path.join(dirs.statusDir[status], '.gitkeep');
    if (existsSync(keep)) continue;
    writeText(keep, '');
    created.push(toPosix(path.relative(root, keep)));
  }

  // Выбранные adapter outputs переписываются, снятые чистятся — только по предикату владения;
  // чужой файл на owned-пути остаётся и называется предупреждением (ADR-015).
  const adapterWarning = cleanupAdapters(root, cfg);
  const rendered = renderAdapters(root, cfg, vars);

  // Блок в AGENTS.md между маркерами: есть — заменяется, нет — дописывается в конец.
  const agentsState = upsertBlock(agentsFile, agents, block, cfg.lang);
  const claude = ensureClaudeStub(root, cfg.tools, cfg.lang);
  const ignoreState = upsertIgnore(root, cfg, ignore);

  // Индекс документации был свой, а первый ADR только что создан: строку в таблицу кладёт
  // человек, иначе lint покраснеет сразу после init, не объяснив почему.
  const adrCreated = created.includes(toPosix(path.relative(root, path.join(dirs.docs, ...adrRel.split('/')))));
  if (adrCreated && existsSync(dirs.docsReadme) && !readFileSync(dirs.docsReadme, 'utf8').includes(adrRel)) {
    notes.push(tr(cfg.lang,
      `${cfg.docs}/README.md уже был: добавь в таблицу строку «| [${adrRel}](${adrRel}) | Задачи и решения ведутся по backslop | Accepted |», иначе lint красный`,
      `${cfg.docs}/README.md already existed: add “| [${adrRel}](${adrRel}) | Tasks and decisions are managed with backslop | Accepted |” to its table or lint will fail`));
  }

  // Штамп версии: раскладку сделала эта версия инструмента. Пин в cli при этом не трогается —
  // его переставляет upgrade; расхождение называется вслух.
  if (cfg.version !== TOOL_VERSION) {
    notes.push(tr(cfg.lang, `штамп версии: ${cfg.version ? `v${cfg.version}` : 'не было'} → v${TOOL_VERSION}`, `version stamp: ${cfg.version ? `v${cfg.version}` : 'missing'} → v${TOOL_VERSION}`));
    cfg.version = TOOL_VERSION;
  }
  // A repeated init saves the new stamp and the --lang and --tools values it was given.
  saveConfig(root, cfg);
  const form = parseCli(cfg.cli);
  const pin = form?.pin ?? null;
  const pinMismatch = pin !== null && pin !== TOOL_VERSION;
  const unpinned = form !== null && pin === null;

  ok(tr(cfg.lang,
    `backslop init: ${cfg.docs}/ (префикс ${cfg.prefix}), создано файлов ${created.length}, оставлено как есть ${skipped.length}`,
    `backslop init: ${cfg.docs}/ (prefix ${cfg.prefix}), files created ${created.length}, left unchanged ${skipped.length}`));
  info(`adapter outputs: ${cfg.tools.length ? cfg.tools.map((tool) => `${tool} ${rendered.counts[tool]}`).join(', ') : 'none'}`);
  info(tr(cfg.lang, `AGENTS.md: блок backslop ${agentsState}; CLAUDE.md: ${claude.state}; .gitignore: ${ignoreState}`, `AGENTS.md: backslop block ${agentsState}; CLAUDE.md: ${claude.state}; .gitignore: ${ignoreState}`));
  if (claude.warning) warn(claude.warning);
  if (adapterWarning) warn(adapterWarning);
  if (rendered.warning) warn(rendered.warning);
  for (const note of notes) info(note);
  if (pinMismatch) warn(tr(cfg.lang, `пин в cli — v${pin}, а раскладку сделала v${TOOL_VERSION}: запусти ${cfg.cli} upgrade или поправь cli в ${CONFIG_FILE}`, `cli is pinned to v${pin}, but layout was generated by v${TOOL_VERSION}: run ${cfg.cli} upgrade or update cli in ${CONFIG_FILE}`));
  if (unpinned) warn(tr(cfg.lang, `cli без пина тянет свежую версию при каждом запуске: запусти ${cfg.cli} upgrade, он поставит пин v${TOOL_VERSION}`, `an unpinned cli fetches a fresh version on every run: run ${cfg.cli} upgrade to pin v${TOOL_VERSION}`));
  info(tr(cfg.lang,
    `дальше: ${cfg.cli} lint — проверка скелета; наполнение — скилл backslop-seed («заполни docs по backslop»); обновление — ${cfg.cli} upgrade`,
    `next: ${cfg.cli} lint validates the layout; use the backslop-seed skill to populate docs; update with ${cfg.cli} upgrade`));
  return 0;
}

function parseTools(raw) {
  if (raw === 'none') return [];
  const tools = raw.split(',').map((tool) => tool.trim()).filter(Boolean);
  if (!tools.length || !validTools(tools)) {
    throw new CliError(`--tools «${raw}»: comma-separated claude,cursor,codex или none / or none`);
  }
  return TOOLS.filter((tool) => tools.includes(tool));
}

// Значение переопределения остаётся встроенным текстом, а не разметкой: экранирование при
// сборке. Что именно экранируется и почему не перечень запретов — ADR-020.
function escapeInline(text) {
  return text.replace(MD_PUNCT, '\\$&');
}

// Проект может заменить текст одного шага, не забирая у init владение всем блоком.
// Номер и соседние шаги остаются шаблонными; после шага 7 сохраняем границу ролей.
function applyStepOverrides(block, cfg) {
  const overrides = cfg.agents?.stepOverrides;
  if (!overrides || !Object.keys(overrides).length) return block;
  const lines = block.split('\n');
  const result = [];
  let i = 0;
  while (i < lines.length) {
    const match = lines[i].match(STEP_RE);
    if (!match) {
      result.push(lines[i]);
      i += 1;
      continue;
    }
    const step = match[1];
    let end = i + 1;
    while (end < lines.length && !STEP_RE.test(lines[end]) && !WORKER_BOUNDARY_RE.test(lines[end])) end += 1;
    if (Object.hasOwn(overrides, step)) {
      result.push(`${step}. ${escapeInline(overrides[step].trim())}`);
      if (lines[end - 1] === '' && WORKER_BOUNDARY_RE.test(lines[end] ?? '')) result.push('');
    } else {
      result.push(...lines.slice(i, end));
    }
    i = end;
  }
  return result.join('\n');
}

// Owned outputs в git не коммитятся (ADR-012): строки — по выбранным adapters, `/CLAUDE.md` —
// только при нашем stub на диске, иначе блок спрятал бы от git пользовательский файл.
function ignoreLines(root, cfg) {
  const lines = cfg.tools.map((tool) => `${adapterRootRel(tool)}/backslop-*`);
  const claudeFile = path.join(root, 'CLAUDE.md');
  if (cfg.tools.includes('claude') && existsSync(claudeFile) && readFileSync(claudeFile, 'utf8') === CLAUDE_STUB) {
    lines.push('/CLAUDE.md');
  }
  return lines;
}

// Блок заводится только тогда, когда есть что игнорировать или блок уже был: self-host с
// `tools: []` не должен получать `.gitignore` там, где его не было, и пачкать tracked tree.
function upsertIgnore(root, cfg, current) {
  const file = path.join(root, '.gitignore');
  const lines = ignoreLines(root, cfg);
  if (!lines.length && !current?.span) return tr(cfg.lang, 'не нужен', 'not needed');
  const body = lines.length
    ? lines.join('\n')
    : tr(cfg.lang, '# adapters не выбраны — generated outputs не создаются', '# no adapters selected — nothing is generated');
  const block = `${IGNORE_MARKERS[0]}\n${body}\n${IGNORE_MARKERS[1]}`;
  return upsertBlock(file, current, block, cfg.lang);
}

export function projectName(root) {
  const name = readJsonOrNull(path.join(root, 'package.json'))?.name;
  if (typeof name === 'string' && name) return name.replace(/^@[^/]+\//, '');
  return path.basename(root);
}

// A file with a managed block, read before the first write: UTF-8 only, each marker once and alone
// on its line. `null` is no file; an undecodable file init will not rewrite passes as `text: null`.
export function readManaged(file, [open, close], lang = 'ru', rewritten = true) {
  if (!existsSync(file)) return null;
  const name = path.basename(file);
  if (statSync(file).isDirectory()) throw new CliError(tr(lang, `${name} — каталог, а нужен файл`, `${name} is a directory, expected a file`));
  const bytes = readFileSync(file);
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    if (!rewritten && !bytes.includes(open)) return { text: null, span: null };
    throw new CliError(tr(lang, `${name}: не UTF-8 — перекодируй файл, затем повтори`, `${name}: not valid UTF-8 — convert it, then retry`));
  }
  const starts = [];
  const ends = [];
  let at = 0;
  for (const line of text.split('\n')) {
    if (line.trim() === open) starts.push(at + line.length - line.trimStart().length);
    if (line.trim() === close) ends.push(at + line.trimEnd().length);
    at += line.length + 1;
  }
  if (!starts.length && !ends.length) return { text, span: null };
  if (starts.length > 1 || ends.length > 1) {
    throw new CliError(tr(lang, `${name}: маркер блока backslop стоит отдельной строкой больше одного раза — поправь руками`, `${name}: a backslop block marker stands on its own line more than once — fix it manually`));
  }
  if (starts.length !== ends.length || ends[0] < starts[0]) {
    throw new CliError(tr(lang, `${name}: маркер блока backslop без пары — поправь руками`, `${name}: unmatched backslop block marker — fix it manually`));
  }
  return { text, span: { start: starts[0], end: ends[0] } };
}

function upsertBlock(file, current, block, lang) {
  if (current === null) {
    writeFileSync(file, `${block}\n`);
    return tr(lang, 'записан в новый файл', 'written to a new file');
  }
  const { text, span } = current;
  const eol = eolOf(text);
  const eolBlock = block.replace(/\r?\n/g, eol);
  if (span !== null) {
    const next = text.slice(0, span.start) + eolBlock + text.slice(span.end);
    if (next !== text) writeFileSync(file, next);
    return next === text ? tr(lang, 'без изменений', 'unchanged') : tr(lang, 'обновлён', 'updated');
  }
  const base = text.endsWith('\n') ? text : `${text}${eol}`;
  writeFileSync(file, `${base}${eol}${eolBlock}${eol}`);
  return tr(lang, 'дописан в конец', 'appended');
}
