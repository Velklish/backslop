// Раскладка в проект: конфиг, скелет docs, скиллы, блок в AGENTS.md. Идемпотентно: конфиг
// и файлы docs создаются один раз, скиллы и блок обновляются на версию из шаблонов, штамп
// версии в конфиге переставляется на версию инструмента, который делал раскладку.
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  CONFIG_FILE, PREFIX_RE, STATUSES, defaultCli, defaults, findRoot, layout, loadConfig, parseCli, saveConfig,
} from './config.js';
import { srcFiles } from './mdwalk.js';
import { TEMPLATES_DIR, renderTemplate } from './templates.js';
import { CliError, info, ok, parseCommandArgs, today, toPosix, warn } from './util.js';
import { TOOL_VERSION, compareVersions } from './version.js';

const BLOCK_START = '<!-- backslop:start -->';
const BLOCK_END = '<!-- backslop:end -->';

export async function run(argv, { cwd }) {
  const { values } = parseCommandArgs(argv, {
    dir: { type: 'string' },
    prefix: { type: 'string' },
    cli: { type: 'string' },
  });
  const root = path.resolve(cwd);
  const existingRoot = findRoot(root);
  if (existingRoot && existingRoot !== root) {
    throw new CliError(`проект уже инициализирован выше: ${existingRoot} — запускай init там или заводи отдельный ${CONFIG_FILE}`);
  }

  let cfg;
  const created = [];
  const skipped = [];
  const notes = [];
  const configFile = path.join(root, CONFIG_FILE);
  if (existsSync(configFile)) {
    cfg = loadConfig(root);
    // Раскладка старой версией затёрла бы скиллы и штамп более новой: понижение — не init.
    if (cfg.version && compareVersions(cfg.version, TOOL_VERSION) > 0) {
      throw new CliError(`штамп v${cfg.version} новее инструмента v${TOOL_VERSION}: обнови установку или пин в cli, старой версией раскладку не делаю`);
    }
    for (const [flag, key] of [['dir', 'docs'], ['prefix', 'prefix'], ['cli', 'cli']]) {
      if (values[flag] !== undefined && values[flag] !== cfg[key]) {
        throw new CliError(`${CONFIG_FILE} уже есть, и там ${key} = «${cfg[key]}»; менять — правкой конфига, не флагом`);
      }
    }
    skipped.push(CONFIG_FILE);
  } else {
    const base = defaults();
    const prefix = values.prefix ?? base.prefix;
    if (!PREFIX_RE.test(prefix)) throw new CliError(`--prefix «${prefix}»: 2–6 заглавных латинских букв или цифр, первая буква`);
    const docs = toPosix(path.normalize(values.dir ?? base.docs)).replace(/\/+$/, '');
    if (!docs || docs === '.' || path.isAbsolute(docs) || docs.split('/').includes('..')) {
      throw new CliError(`--dir «${values.dir}»: относительный путь внутри проекта`);
    }
    const cli = values.cli ?? defaultCli();
    cfg = { prefix, docs, cli, gates: [`${cli} lint`], version: TOOL_VERSION };
    saveConfig(root, cfg);
    created.push(CONFIG_FILE);
  }

  const dirs = layout(root, cfg);
  const vars = {
    prefix: cfg.prefix,
    docs: cfg.docs,
    cli: cfg.cli,
    project: projectName(root),
    date: today(),
  };

  // Скелет docs: каждый файл шаблона — один раз; существующий не трогается.
  for (const [rel] of srcFiles(path.join(TEMPLATES_DIR, 'docs'), '', ['.md'])) {
    const target = path.join(dirs.docs, ...rel.split('/'));
    if (existsSync(target)) {
      skipped.push(toPosix(path.relative(root, target)));
      continue;
    }
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, renderTemplate(`docs/${rel}`, vars));
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

  // Скиллы — генерируемое: переписываются на версию шаблонов при каждом init.
  const skillsRoot = path.join(root, '.claude', 'skills');
  let skills = 0;
  for (const [rel] of srcFiles(path.join(TEMPLATES_DIR, 'skills'), '', ['.md'])) {
    const target = path.join(skillsRoot, ...rel.split('/'));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, renderTemplate(`skills/${rel}`, vars));
    skills += 1;
  }

  // Блок в AGENTS.md между маркерами: есть — заменяется, нет — дописывается в конец.
  const agentsFile = path.join(root, 'AGENTS.md');
  const block = renderTemplate('agents-section.md', vars).trimEnd();
  const agentsState = upsertBlock(agentsFile, block);
  const claudeFile = path.join(root, 'CLAUDE.md');
  let claudeState = 'есть';
  if (!existsSync(claudeFile)) {
    writeFileSync(claudeFile, '@AGENTS.md\n');
    claudeState = 'создан с @AGENTS.md';
  } else if (sameFile(claudeFile, agentsFile)) {
    claudeState = 'симлинк на AGENTS.md';
  } else if (!readFileSync(claudeFile, 'utf8').includes('@AGENTS.md')) {
    claudeState = 'есть, но не импортирует AGENTS.md — добавь строку «@AGENTS.md», иначе Claude Code блок не увидит';
  }

  // Индекс документации был свой, а первый ADR только что создан: строку в таблицу кладёт
  // человек, иначе lint покраснеет сразу после init, не объяснив почему.
  const adrRel = 'adr/adr-001-process.md';
  const adrCreated = created.includes(toPosix(path.relative(root, path.join(dirs.docs, 'adr', 'adr-001-process.md'))));
  if (adrCreated && existsSync(dirs.docsReadme) && !readFileSync(dirs.docsReadme, 'utf8').includes(adrRel)) {
    notes.push(`${cfg.docs}/README.md уже был: добавь в таблицу строку «| [${adrRel}](${adrRel}) | Задачи и решения ведутся по backslop | Accepted |», иначе lint красный`);
  }

  // Штамп версии: раскладку сделала эта версия инструмента. Пин в cli при этом не трогается —
  // его переставляет upgrade; расхождение называется вслух.
  if (cfg.version !== TOOL_VERSION) {
    notes.push(`штамп версии: ${cfg.version ? `v${cfg.version}` : 'не было'} → v${TOOL_VERSION}`);
    cfg.version = TOOL_VERSION;
    saveConfig(root, cfg);
  }
  const form = parseCli(cfg.cli);
  const pin = form?.pin ?? null;
  const pinMismatch = pin !== null && pin !== TOOL_VERSION;
  const unpinned = form !== null && pin === null;

  ok(`backslop init: ${cfg.docs}/ (префикс ${cfg.prefix}), создано файлов ${created.length}, оставлено как есть ${skipped.length}`);
  info(`скиллы обновлены: ${skills} файлов в .claude/skills/backslop-*`);
  info(`AGENTS.md: блок backslop ${agentsState}; CLAUDE.md: ${claudeState}`);
  for (const note of notes) info(note);
  if (claudeState.startsWith('есть, но')) warn(claudeState);
  if (pinMismatch) warn(`пин в cli — v${pin}, а раскладку сделала v${TOOL_VERSION}: запусти ${cfg.cli} upgrade или поправь cli в ${CONFIG_FILE}`);
  if (unpinned) warn(`cli без пина тянет HEAD ветки при каждом запуске: запусти ${cfg.cli} upgrade, он поставит пин v${TOOL_VERSION}`);
  info(`дальше: ${cfg.cli} lint — проверка скелета; наполнение — скилл backslop-seed («заполни docs по backslop»); обновление — ${cfg.cli} upgrade`);
  return 0;
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

// CLAUDE.md часто симлинк на AGENTS.md — тогда импорт не нужен.
function sameFile(a, b) {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
}

export function upsertBlock(file, block) {
  if (!existsSync(file)) {
    writeFileSync(file, `${block}\n`);
    return 'записан в новый файл';
  }
  const text = readFileSync(file, 'utf8');
  const start = text.indexOf(BLOCK_START);
  const end = text.indexOf(BLOCK_END);
  if (start !== -1 && end !== -1 && end > start) {
    const next = text.slice(0, start) + block + text.slice(end + BLOCK_END.length);
    if (next !== text) writeFileSync(file, next);
    return next === text ? 'без изменений' : 'обновлён';
  }
  if (start !== -1 || end !== -1) throw new CliError('AGENTS.md: маркер блока backslop без пары — поправь руками');
  const base = text.endsWith('\n') ? text : `${text}\n`;
  writeFileSync(file, `${base}\n${block}\n`);
  return 'дописан в конец';
}
