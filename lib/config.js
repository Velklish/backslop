import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ADAPTER_ROOTS, CANONICAL_SKILL, TOOLS } from './adapters-registry.js';
import { CliError } from './util.js';
import { TOOL_VERSION, normalizeVersion } from './version.js';
import { tr } from './i18n.js';

export const CONFIG_FILE = 'backslop.json';

// Каталоги статусов внутри docs/backlog: файл задачи лежит ровно в одном из них.
export const STATUSES = ['triage', 'queue', 'active', 'deferred'];

// Откуда берутся релизы: спека npm для git-репозитория на GitHub.
export const SOURCE = 'github:Velklish/backslop';
export const LANGS = ['ru', 'en'];
export { TOOLS };

// Как позвать backslop из проекта без установки: npx по спеке с пином на тег версии, которая
// делала раскладку. Без пина каждый запуск тянул бы HEAD ветки и менял поведение проекта
// без его ведома.
export function defaultCli(version = TOOL_VERSION) {
  return `npx ${SOURCE}#v${version}`;
}

export function defaults() {
  const cli = defaultCli();
  return { prefix: 'BS', docs: 'docs', cli, gates: [`${cli} lint`], version: TOOL_VERSION, lang: 'ru', tools: [] };
}

// Префикс — заглавные латинские буквы и цифры, 2–6 знаков: он попадает в имена файлов,
// заголовки и коммиты, и регекс гейтов рассчитан именно на такую форму.
export const PREFIX_RE = /^[A-Z][A-Z0-9]{1,5}$/;

// Форма установки в поле cli: `npx [флаги] github:owner/repo[#vX.Y.Z]`
// или npm `npx [флаги] backslop[@X.Y.Z|@latest]`. Точный пин — только `@X.Y.Z`.
// `npx backslop` и `@latest` — та же форма с `pin: null`, чтобы lint предупредил.
// Флаги npx (`--yes`, `-q`) сохраняются при перестановке пина. Источник тегов
// из npm-формы не выводится: его явно задаёт поле source (ADR-007). Глобальная команда
// и `node bin/backslop.js` пина не несут.
const NPX_GITHUB = /^npx((?:\s+-{1,2}[\w-]+(?:=\S+)?)*)\s+(github:([\w.-]+)\/([\w.-]+?))(?:\.git)?(?:#v?(\d+\.\d+\.\d+))?\s*$/;
const NPX_NPM = /^npx((?:\s+-{1,2}[\w-]+(?:=\S+)?)*)\s+(backslop)(?:@(latest|\d+\.\d+\.\d+))?\s*$/;

export function parseCli(cli) {
  const value = String(cli ?? '');
  const github = value.match(NPX_GITHUB);
  const npm = value.match(NPX_NPM);
  if (!github && !npm) return null;
  const flags = (github ?? npm)[1].trim();
  const spec = (github ?? npm)[2];
  const rawPin = github ? github[5] : npm[3];
  const pin = rawPin && rawPin !== 'latest' ? normalizeVersion(rawPin) : null;
  return {
    spec,
    repoUrl: github ? `https://github.com/${github[3]}/${github[4]}.git` : null,
    pin,
    withPin: (version) => `npx ${flags ? `${flags} ` : ''}${spec}${github ? '#v' : '@'}${normalizeVersion(version)}`,
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
  if (!root) throw new CliError(`${CONFIG_FILE} was not found in ${cwd} or its parents — run backslop init first / ${CONFIG_FILE} не найден ни в ${cwd}, ни выше — сначала backslop init`);
  return root;
}

export function loadConfig(root) {
  const file = path.join(root, CONFIG_FILE);
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new CliError(`${CONFIG_FILE}: cannot be parsed / не разбирается — ${e.message}`);
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new CliError(`${CONFIG_FILE}: top level must be an object / верхний уровень должен быть объектом`);
  }
  const lang = raw.lang === 'en' ? 'en' : 'ru';
  const base = defaults();
  // До появления `tools` backslop всегда материализовал Claude-скиллы. Отсутствующее
  // поле в таком проекте означает фактический выбор Claude, а не новый default `[]`.
  // Явное `tools: []` сильнее улики на диске и сохраняет harness-neutral режим.
  const legacyTools = raw.tools === undefined
    && existsSync(path.join(root, ...ADAPTER_ROOTS.claude, ...CANONICAL_SKILL.split('/')))
    ? ['claude']
    : base.tools;
  // Штамп версии не подставляется: его отсутствие — сигнал для lint и upgrade. Умолчание
  // gates строится от cli проекта, а не от cli по умолчанию: чужая команда в гейтах — дефект.
  const cfg = { prefix: base.prefix, docs: base.docs, cli: base.cli, lang: base.lang, tools: legacyTools, ...raw };
  if (cfg.gates === undefined) cfg.gates = [`${cfg.cli} lint`];
  if (!PREFIX_RE.test(cfg.prefix)) {
    throw new CliError(tr(lang, `${CONFIG_FILE}: prefix «${cfg.prefix}» — нужны 2–6 заглавных латинских букв или цифр, первая буква`, `${CONFIG_FILE}: prefix “${cfg.prefix}” — expected 2–6 uppercase Latin letters or digits, starting with a letter`));
  }
  if (typeof cfg.docs !== 'string' || !cfg.docs || path.isAbsolute(cfg.docs) || cfg.docs.includes('..')) {
    throw new CliError(tr(lang, `${CONFIG_FILE}: docs «${cfg.docs}» — нужен относительный путь внутри проекта`, `${CONFIG_FILE}: docs “${cfg.docs}” — expected a relative path inside the project`));
  }
  if (typeof cfg.cli !== 'string' || !cfg.cli.trim()) throw new CliError(tr(lang, `${CONFIG_FILE}: cli — непустая строка команды`, `${CONFIG_FILE}: cli must be a non-empty command string`));
  if (!Array.isArray(cfg.gates) || cfg.gates.some((g) => typeof g !== 'string')) {
    throw new CliError(tr(lang, `${CONFIG_FILE}: gates — список строк-команд`, `${CONFIG_FILE}: gates must be an array of command strings`));
  }
  if (!LANGS.includes(cfg.lang)) {
    throw new CliError(`${CONFIG_FILE}: lang «${cfg.lang}» — нужен ru или en / must be ru or en`);
  }
  if (!Array.isArray(cfg.tools) || cfg.tools.some((tool) => !TOOLS.includes(tool)) || new Set(cfg.tools).size !== cfg.tools.length) {
    throw new CliError(`${CONFIG_FILE}: tools — список без повторов из claude, cursor, codex / unique array of claude, cursor, codex`);
  }
  if (cfg.version !== undefined) {
    const v = normalizeVersion(cfg.version);
    if (v === null) throw new CliError(tr(lang, `${CONFIG_FILE}: version «${cfg.version}» — нужна форма X.Y.Z`, `${CONFIG_FILE}: version “${cfg.version}” — expected X.Y.Z`));
    cfg.version = v;
  }
  if (cfg.source !== undefined && (typeof cfg.source !== 'string' || !cfg.source.trim())) {
    throw new CliError(tr(lang, `${CONFIG_FILE}: source — строка: git-адрес или путь репозитория с тегами релизов`, `${CONFIG_FILE}: source must be a git URL or repository path containing release tags`));
  }
  return cfg;
}

// Запись конфига: известные ключи в постоянном порядке, чужие — следом как были.
export function saveConfig(root, cfg) {
  const order = ['prefix', 'docs', 'cli', 'gates', 'version', 'source', 'lang', 'tools'];
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
