import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { CliError } from './util.js';

export const CONFIG_FILE = 'backslop.json';

// Каталоги статусов внутри docs/backlog: файл задачи лежит ровно в одном из них.
export const STATUSES = ['triage', 'queue', 'active', 'deferred'];

// Как позвать сам backslop из проекта: без установки это npx по адресу репозитория.
export const DEFAULT_CLI = 'npx github:Velklish/backslop';

export const DEFAULTS = Object.freeze({
  prefix: 'BS',
  docs: 'docs',
  cli: DEFAULT_CLI,
  gates: [`${DEFAULT_CLI} lint`],
});

// Префикс — заглавные латинские буквы и цифры, 2–6 знаков: он попадает в имена файлов,
// заголовки и коммиты, и регекс гейтов рассчитан именно на такую форму.
export const PREFIX_RE = /^[A-Z][A-Z0-9]{1,5}$/;

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
  const cfg = { ...DEFAULTS, ...raw };
  if (!PREFIX_RE.test(cfg.prefix)) {
    throw new CliError(`${CONFIG_FILE}: prefix «${cfg.prefix}» — нужны 2–6 заглавных латинских букв или цифр, первая буква`);
  }
  if (typeof cfg.docs !== 'string' || !cfg.docs || path.isAbsolute(cfg.docs) || cfg.docs.includes('..')) {
    throw new CliError(`${CONFIG_FILE}: docs «${cfg.docs}» — нужен относительный путь внутри проекта`);
  }
  if (!Array.isArray(cfg.gates) || cfg.gates.some((g) => typeof g !== 'string')) {
    throw new CliError(`${CONFIG_FILE}: gates — список строк-команд`);
  }
  return cfg;
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
