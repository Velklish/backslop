import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CliError } from './util.js';
import { TOOL_VERSION, normalizeVersion } from './version.js';

export const CONFIG_FILE = 'backslop.json';

// Каталоги статусов внутри docs/backlog: файл задачи лежит ровно в одном из них.
export const STATUSES = ['triage', 'queue', 'active', 'deferred'];

// Откуда берутся релизы: спека npm для git-репозитория на GitHub.
export const SOURCE = 'github:Velklish/backslop';

// Как позвать backslop из проекта без установки: npx по спеке с пином на тег версии, которая
// делала раскладку. Без пина каждый запуск тянул бы HEAD ветки и менял поведение проекта
// без его ведома.
export function defaultCli(version = TOOL_VERSION) {
  return `npx ${SOURCE}#v${version}`;
}

export function defaults() {
  const cli = defaultCli();
  return { prefix: 'BS', docs: 'docs', cli, gates: [`${cli} lint`], version: TOOL_VERSION };
}

// Префикс — заглавные латинские буквы и цифры, 2–6 знаков: он попадает в имена файлов,
// заголовки и коммиты, и регекс гейтов рассчитан именно на такую форму.
export const PREFIX_RE = /^[A-Z][A-Z0-9]{1,5}$/;

// Форма установки в поле cli: `npx [флаги] github:owner/repo[#vX.Y.Z]`. Из неё выводятся
// источник релизов и пин; флаги npx (`--yes`, `-q`) сохраняются при перестановке пина.
// Другая форма (`backslop` глобально, `node bin/backslop.js` в самом репозитории) пина не несёт.
const NPX_GITHUB = /^npx((?:\s+-{1,2}[\w-]+(?:=\S+)?)*)\s+(github:([\w.-]+)\/([\w.-]+?))(?:\.git)?(?:#v?(\d+\.\d+\.\d+))?\s*$/;

export function parseCli(cli) {
  const m = String(cli ?? '').match(NPX_GITHUB);
  if (!m) return null;
  const flags = m[1].trim();
  const spec = m[2];
  return {
    spec,
    repoUrl: `https://github.com/${m[3]}/${m[4]}.git`,
    pin: m[5] === undefined ? null : normalizeVersion(m[5]),
    withPin: (version) => `npx ${flags ? `${flags} ` : ''}${spec}#v${normalizeVersion(version)}`,
  };
}

// Корень проекта — ближайший каталог с backslop.json вверх от стартового.
export function findRoot(start) {
  let dir = path.resolve(start);
  for (;;) {
    if (existsSync(path.join(dir, CONFIG_FILE))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function requireRoot(cwd) {
  const root = findRoot(cwd);
  if (!root) throw new CliError(`${CONFIG_FILE} не найден ни в ${cwd}, ни выше — сначала backslop init`);
  return root;
}

export function loadConfig(root) {
  const file = path.join(root, CONFIG_FILE);
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new CliError(`${CONFIG_FILE}: не разбирается — ${e.message}`);
  }
  const base = defaults();
  // Штамп версии не подставляется: его отсутствие — сигнал для lint и upgrade. Умолчание
  // gates строится от cli проекта, а не от cli по умолчанию: чужая команда в гейтах — дефект.
  const cfg = { prefix: base.prefix, docs: base.docs, cli: base.cli, ...raw };
  if (cfg.gates === undefined) cfg.gates = [`${cfg.cli} lint`];
  if (!PREFIX_RE.test(cfg.prefix)) {
    throw new CliError(`${CONFIG_FILE}: prefix «${cfg.prefix}» — нужны 2–6 заглавных латинских букв или цифр, первая буква`);
  }
  if (typeof cfg.docs !== 'string' || !cfg.docs || path.isAbsolute(cfg.docs) || cfg.docs.includes('..')) {
    throw new CliError(`${CONFIG_FILE}: docs «${cfg.docs}» — нужен относительный путь внутри проекта`);
  }
  if (typeof cfg.cli !== 'string' || !cfg.cli.trim()) throw new CliError(`${CONFIG_FILE}: cli — непустая строка команды`);
  if (!Array.isArray(cfg.gates) || cfg.gates.some((g) => typeof g !== 'string')) {
    throw new CliError(`${CONFIG_FILE}: gates — список строк-команд`);
  }
  if (cfg.version !== undefined) {
    const v = normalizeVersion(cfg.version);
    if (v === null) throw new CliError(`${CONFIG_FILE}: version «${cfg.version}» — нужна форма X.Y.Z`);
    cfg.version = v;
  }
  if (cfg.source !== undefined && (typeof cfg.source !== 'string' || !cfg.source.trim())) {
    throw new CliError(`${CONFIG_FILE}: source — строка: git-адрес или путь репозитория с тегами релизов`);
  }
  return cfg;
}

// Запись конфига: известные ключи в постоянном порядке, чужие — следом как были.
export function saveConfig(root, cfg) {
  const order = ['prefix', 'docs', 'cli', 'gates', 'version', 'source'];
  const out = {};
  for (const key of order) if (cfg[key] !== undefined) out[key] = cfg[key];
  for (const key of Object.keys(cfg)) if (!(key in out)) out[key] = cfg[key];
  writeFileSync(path.join(root, CONFIG_FILE), `${JSON.stringify(out, null, 2)}\n`);
}

// Пути раскладки от корня: один источник для всех команд и гейтов.
export function layout(root, cfg) {
  const docs = path.join(root, cfg.docs);
  const backlog = path.join(docs, 'backlog');
  return {
    docs,
    backlog,
    statusDir: Object.fromEntries(STATUSES.map((s) => [s, path.join(backlog, s)])),
    archive: path.join(docs, 'archive'),
    adr: path.join(docs, 'adr'),
    reference: path.join(docs, 'reference'),
    docsReadme: path.join(docs, 'README.md'),
  };
}

export function loadProject(cwd) {
  const root = requireRoot(cwd);
  const cfg = loadConfig(root);
  return { root, cfg, dirs: layout(root, cfg) };
}
