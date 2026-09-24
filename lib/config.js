import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ADAPTER_ROOTS, CANONICAL_SKILL, TOOLS } from './adapters-registry.js';
import { CliError } from './util.js';
import { TOOL_VERSION, normalizeVersion } from './version.js';
import { tr } from './i18n.js';

export const CONFIG_FILE = 'backslop.json';

// Каталоги статусов внутри docs/backlog: файл задачи лежит ровно в одном из них.
export const STATUSES = ['triage', 'queue', 'active', 'deferred', 'minor'];

// Откуда берутся релизы: спека npm для git-репозитория на GitHub.
export const SOURCE = 'github:Velklish/backslop';
export const LANGS = ['ru', 'en'];

export { TOOLS };
const LINE_BREAK_RE = /[\r\n\u2028\u2029]/;
// Метки managed-блока — одно написание на инструмент. Обёртка у них разная (html-комментарий
// в markdown, `#` в .gitignore), поэтому запрет ловит саму метку и собирается из них же.
export const BLOCK_MARKERS = ['backslop:start', 'backslop:end'];
export const [BLOCK_START, BLOCK_END] = BLOCK_MARKERS.map((marker) => `<!-- ${marker} -->`);
export const BLOCK_MARKER_RE = new RegExp(BLOCK_MARKERS.join('|'));

// Как позвать backslop без установки: npx с пином на тег версии, делавшей раскладку. Без пина
// каждый запуск тянул бы HEAD ветки (ADR-004).
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

// `cli`: `npx [флаги] github:owner/repo[#vX.Y.Z]` или `npx [флаги] backslop[@X.Y.Z|@latest]`;
// без точного пина — `pin: null`, глобальная команда пина не несёт (ADR-007, 02-cli.md).
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

// Пин в прозе — одним шаблоном для переписи в `upgrade` и ошибки в `lint`. Номер берётся целиком:
// `#v0.1.09` — один номер, а не `0.1.0` и хвост, иначе замена собрала бы мусорную версию.
export function pinSep(form) {
  return form.repoUrl ? '#v' : '@';
}

export function pinRe(form) {
  const spec = form.spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${spec}${pinSep(form)}(\\d+\\.\\d+\\.\\d+)`, 'g');
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
  // Нет поля `tools`, а Claude-скилл на диске — это выбор Claude до появления поля, а не `[]`;
  // явное `tools: []` сильнее улики на диске (ADR-008).
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
  validateBlockValue(cfg.docs, 'docs', lang);
  if (typeof cfg.cli !== 'string' || !cfg.cli.trim()) throw new CliError(tr(lang, `${CONFIG_FILE}: cli — непустая строка команды`, `${CONFIG_FILE}: cli must be a non-empty command string`));
  validateBlockValue(cfg.cli, 'cli', lang);
  validateGates(cfg, lang);
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
  validateProbe(cfg, lang);
  validateAgentsConfig(cfg, lang);
  return cfg;
}

// Одна проверка формы на все поля, уезжающие в managed-блок; `prefix` сюда не идёт — его держит
// PREFIX_RE (docs/reference/01-layout.md, «Значения, которые уезжают в блок»; ADR-021).
export function validateBlockValue(value, field, lang) {
  if (LINE_BREAK_RE.test(value)) {
    throw new CliError(tr(lang, `${CONFIG_FILE}: ${field} — однострочное значение без переводов строк: вторая строка встаёт в блоке отдельным абзацем`, `${CONFIG_FILE}: ${field} must be a single-line value without line breaks: a second line becomes a separate paragraph inside the block`));
  }
  if (value.includes('`')) {
    throw new CliError(tr(lang, `${CONFIG_FILE}: ${field} — значение без обратной кавычки: шаблон ставит его в код-спан, и кавычка внутри его закрывает`, `${CONFIG_FILE}: ${field} must not contain a backtick: the template puts it in a code span, and a backtick inside closes it`));
  }
  if (BLOCK_MARKER_RE.test(value)) {
    throw new CliError(tr(lang, `${CONFIG_FILE}: ${field} — значение без меток backslop:start и backslop:end: оно стоит внутри блока, а границы блока ищутся по сырому тексту`, `${CONFIG_FILE}: ${field} must not contain the backslop:start or backslop:end markers: it sits inside the block, and the block bounds are found in raw text`));
  }
}

// Запись `gates` — строка или `{ command, when }`; один вид у обеих форм, чтобы раннер и бриф не
// разбирали тип у себя (ADR-023).
export function gateEntry(gate) {
  if (typeof gate === 'string') return { command: gate, when: null };
  return { command: gate.command, when: gate.when ?? null };
}

function validateGates(cfg, lang) {
  if (!Array.isArray(cfg.gates)) {
    throw new CliError(tr(lang, `${CONFIG_FILE}: gates — список команд: строка или { command, when }`, `${CONFIG_FILE}: gates must be an array of commands: a string or { command, when }`));
  }
  cfg.gates.forEach((gate, i) => {
    const at = `${CONFIG_FILE}: gates[${i}]`;
    if (typeof gate === 'string') return;
    if (gate === null || typeof gate !== 'object' || Array.isArray(gate)) {
      throw new CliError(tr(lang, `${at} — строка-команда или объект { command, when }`, `${at} — expected a command string or a { command, when } object`));
    }
    if (typeof gate.command !== 'string' || !gate.command.trim()) {
      throw new CliError(tr(lang, `${at}.command — непустая строка команды`, `${at}.command must be a non-empty command string`));
    }
    // Пустой список отвергается: область без образцов не сошлась бы ни с одним набором путей, и
    // команда не запускалась бы никогда — молчаливый ноль покрытия вместо объявленной проверки.
    if (gate.when !== undefined && (!Array.isArray(gate.when) || !gate.when.length || gate.when.some((g) => typeof g !== 'string' || !g.trim()))) {
      throw new CliError(tr(lang, `${at}.when — непустой список непустых glob-образцов; область без образцов не запустила бы команду никогда`, `${at}.when must be a non-empty array of non-empty glob patterns; a scope with no patterns would never run the command`));
    }
  });
}

function validateProbe(cfg, lang) {
  if (cfg.probe === undefined) return;
  if (typeof cfg.probe !== 'string' || !cfg.probe.trim()) {
    throw new CliError(tr(lang, `${CONFIG_FILE}: probe — строка: команда мутационной пробы проекта`, `${CONFIG_FILE}: probe must be a command string that runs the project's mutation probe`));
  }
  validateBlockValue(cfg.probe, 'probe', lang);
}

function validateAgentsConfig(cfg, lang) {
  if (cfg.agents === undefined) return;
  if (cfg.agents === null || typeof cfg.agents !== 'object' || Array.isArray(cfg.agents)) {
    throw new CliError(tr(lang,
      `${CONFIG_FILE}: agents — объект настройки блока AGENTS.md`,
      `${CONFIG_FILE}: agents must be an AGENTS.md block configuration object`));
  }
  const overrides = cfg.agents.stepOverrides;
  if (overrides === undefined) return;
  if (overrides === null || typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw new CliError(tr(lang,
      `${CONFIG_FILE}: agents.stepOverrides — объект с ключами номеров шагов`,
      `${CONFIG_FILE}: agents.stepOverrides must be an object keyed by step numbers`));
  }
  for (const [step, text] of Object.entries(overrides)) {
    if (!/^[1-7]$/.test(step)) {
      throw new CliError(tr(lang,
        `${CONFIG_FILE}: agents.stepOverrides[${JSON.stringify(step)}] — номер шага от 1 до 7`,
        `${CONFIG_FILE}: agents.stepOverrides[${JSON.stringify(step)}] — expected a step number from 1 to 7`));
    }
    if (typeof text !== 'string' || !text.trim()) {
      throw new CliError(tr(lang,
        `${CONFIG_FILE}: agents.stepOverrides[${JSON.stringify(step)}] — непустой текст`,
        `${CONFIG_FILE}: agents.stepOverrides[${JSON.stringify(step)}] — expected non-empty text`));
    }
    if (LINE_BREAK_RE.test(text)) {
      throw new CliError(tr(lang,
        `${CONFIG_FILE}: agents.stepOverrides[${JSON.stringify(step)}] — однострочный текст без переводов строк`,
        `${CONFIG_FILE}: agents.stepOverrides[${JSON.stringify(step)}] — expected single-line text without line breaks`));
    }
    if (text.includes('<')) {
      throw new CliError(tr(lang,
        `${CONFIG_FILE}: agents.stepOverrides[${JSON.stringify(step)}] — inline-текст без разметки: символ «<» запрещён`,
        `${CONFIG_FILE}: agents.stepOverrides[${JSON.stringify(step)}] — inline text without markup: the “<” character is not allowed`));
    }
  }
}

// Запись конфига: известные ключи в постоянном порядке, чужие — следом как были.
export function saveConfig(root, cfg) {
  const order = ['prefix', 'docs', 'cli', 'gates', 'probe', 'version', 'source', 'lang', 'tools', 'agents'];
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
