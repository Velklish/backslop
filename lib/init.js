// Раскладка в проект: конфиг, скелет docs, скиллы, блок в AGENTS.md. Идемпотентно: конфиг
// и файлы docs создаются один раз, скиллы и блок обновляются на версию из шаблонов, штамп
// версии в конфиге переставляется на версию инструмента, который делал раскладку.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  CONFIG_FILE, LANGS, PREFIX_RE, STATUSES, TOOLS, defaultCli, defaults, findRoot, layout, loadConfig, parseCli, saveConfig,
} from './config.js';
import { cleanupAdapters, ensureClaudeStub, renderAdapters } from './adapters.js';
import { srcFiles } from './mdwalk.js';
import { TEMPLATES_DIR, renderProjectTemplate, templateRel } from './templates.js';
import { formatAdrNumber, scanAdrs } from './adr.js';
import { CliError, info, ok, parseCommandArgs, today, toPosix, warn } from './util.js';
import { TOOL_VERSION, compareVersions } from './version.js';
import { tr } from './i18n.js';

const BLOCK_START = '<!-- backslop:start -->';
const BLOCK_END = '<!-- backslop:end -->';

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
  const created = [];
  const skipped = [];
  const notes = [];
  const requestedLang = values.lang;
  if (requestedLang !== undefined && !LANGS.includes(requestedLang)) {
    throw new CliError(`--lang «${requestedLang}»: нужен ru или en / must be ru or en`);
  }
  const requestedTools = values.tools === undefined ? undefined : parseTools(values.tools);
  const configFile = path.join(root, CONFIG_FILE);
  if (existsSync(configFile)) {
    cfg = loadConfig(root);
    // Раскладка старой версией затёрла бы скиллы и штамп более новой: понижение — не init.
    if (cfg.version && compareVersions(cfg.version, TOOL_VERSION) > 0) {
      throw new CliError(tr(cfg.lang, `штамп v${cfg.version} новее инструмента v${TOOL_VERSION}: обнови установку или пин в cli, старой версией раскладку не делаю`, `version stamp v${cfg.version} is newer than tool v${TOOL_VERSION}: update the installation or cli pin; an older tool cannot generate this layout`));
    }
    for (const [flag, key] of [['dir', 'docs'], ['prefix', 'prefix'], ['cli', 'cli']]) {
      if (values[flag] !== undefined && values[flag] !== cfg[key]) {
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
    const docs = toPosix(path.normalize(values.dir ?? base.docs)).replace(/\/+$/, '');
    if (!docs || docs === '.' || path.isAbsolute(docs) || docs.split('/').includes('..')) {
      throw new CliError(`--dir “${values.dir}”: expected a relative path inside the project / нужен относительный путь внутри проекта`);
    }
    const cli = values.cli ?? defaultCli();
    cfg = {
      prefix, docs, cli, gates: [`${cli} lint`], version: TOOL_VERSION,
      lang: requestedLang ?? base.lang,
      tools: requestedTools ?? base.tools,
    };
    saveConfig(root, cfg);
    created.push(CONFIG_FILE);
  }

  const dirs = layout(root, cfg);
  // ADR процесса: в пустом `adr/` — 001; в проекте со своими ADR — следующий свободный номер,
  // иначе он лёг бы вторым `adr-001-*` и упёрся в гейт номеров. Уже лежащий ADR процесса
  // (любой номер) повторный init не трогает, как и остальные файлы docs.
  const existingAdrs = scanAdrs(dirs.adr);
  const processAdr = existingAdrs.find((a) => a.slug === 'process');
  const adrNumber = processAdr ? formatAdrNumber(processAdr.number) : formatAdrNumber((existingAdrs.at(-1)?.number ?? 0) + 1);
  const adrRel = `adr/adr-${adrNumber}-process.md`;
  const vars = {
    prefix: cfg.prefix,
    docs: cfg.docs,
    cli: cfg.cli,
    project: projectName(root),
    date: today(),
    adrNumber,
  };

  // Скелет docs: каждый файл шаблона — один раз; существующий не трогается.
  const docsTemplates = path.join(TEMPLATES_DIR, ...templateRel(cfg.lang, 'docs').split('/'));
  for (const [tplRel] of srcFiles(docsTemplates, '', ['.md'])) {
    const rel = tplRel === 'adr/adr-001-process.md' ? adrRel : tplRel;
    const target = path.join(dirs.docs, ...rel.split('/'));
    if (existsSync(target)) {
      skipped.push(toPosix(path.relative(root, target)));
      continue;
    }
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, renderProjectTemplate(cfg, `docs/${tplRel}`, vars));
    created.push(toPosix(path.relative(root, target)));
  }
  // Каталоги статусов пустыми в git не живут — .gitkeep держит их в клоне.
  for (const status of STATUSES) {
    const keep = path.join(dirs.statusDir[status], '.gitkeep');
    if (existsSync(keep)) continue;
    mkdirSync(path.dirname(keep), { recursive: true });
    writeFileSync(keep, '');
    created.push(toPosix(path.relative(root, keep)));
  }

  // Adapter outputs — генерируемое: выбранные переписываются, снятые чистятся только по
  // точному списку owned-файлов. Пользовательские соседи в harness-каталогах остаются.
  cleanupAdapters(root, cfg);
  const adapterCounts = renderAdapters(root, cfg, vars);

  // Блок в AGENTS.md между маркерами: есть — заменяется, нет — дописывается в конец.
  const agentsFile = path.join(root, 'AGENTS.md');
  const block = renderProjectTemplate(cfg, 'agents-section.md', vars).trimEnd();
  const agentsState = upsertBlock(agentsFile, block, cfg.lang);
  const claude = ensureClaudeStub(root, cfg.tools, cfg.lang);

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
  // Повторный init материализует legacy defaults lang/tools и сохраняет mutable flags.
  saveConfig(root, cfg);
  const form = parseCli(cfg.cli);
  const pin = form?.pin ?? null;
  const pinMismatch = pin !== null && pin !== TOOL_VERSION;
  const unpinned = form !== null && pin === null;

  ok(tr(cfg.lang,
    `backslop init: ${cfg.docs}/ (префикс ${cfg.prefix}), создано файлов ${created.length}, оставлено как есть ${skipped.length}`,
    `backslop init: ${cfg.docs}/ (prefix ${cfg.prefix}), files created ${created.length}, left unchanged ${skipped.length}`));
  info(`adapter outputs: ${cfg.tools.length ? cfg.tools.map((tool) => `${tool} ${adapterCounts[tool]}`).join(', ') : 'none'}`);
  info(tr(cfg.lang, `AGENTS.md: блок backslop ${agentsState}; CLAUDE.md: ${claude.state}`, `AGENTS.md: backslop block ${agentsState}; CLAUDE.md: ${claude.state}`));
  if (claude.warning) warn(claude.warning);
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
  const unknown = tools.filter((tool) => !TOOLS.includes(tool));
  if (!tools.length || unknown.length || new Set(tools).size !== tools.length) {
    throw new CliError(`--tools «${raw}»: comma-separated claude,cursor,codex или none / or none`);
  }
  return TOOLS.filter((tool) => tools.includes(tool));
}

function projectName(root) {
  const pkg = path.join(root, 'package.json');
  if (existsSync(pkg)) {
    try {
      const name = JSON.parse(readFileSync(pkg, 'utf8')).name;
      if (typeof name === 'string' && name) return name.replace(/^@[^/]+\//, '');
    } catch {
      // манифест не разбирается — имя возьмём из каталога
    }
  }
  return path.basename(root);
}

export function upsertBlock(file, block, lang = 'ru') {
  if (!existsSync(file)) {
    writeFileSync(file, `${block}\n`);
    return tr(lang, 'записан в новый файл', 'written to a new file');
  }
  const text = readFileSync(file, 'utf8');
  const start = text.indexOf(BLOCK_START);
  const end = text.indexOf(BLOCK_END);
  if (start !== -1 && end !== -1 && end > start) {
    const next = text.slice(0, start) + block + text.slice(end + BLOCK_END.length);
    if (next !== text) writeFileSync(file, next);
    return next === text ? tr(lang, 'без изменений', 'unchanged') : tr(lang, 'обновлён', 'updated');
  }
  if (start !== -1 || end !== -1) throw new CliError(tr(lang, 'AGENTS.md: маркер блока backslop без пары — поправь руками', 'AGENTS.md: unmatched backslop block marker — fix it manually'));
  const base = text.endsWith('\n') ? text : `${text}\n`;
  writeFileSync(file, `${base}\n${block}\n`);
  return tr(lang, 'дописан в конец', 'appended');
}
