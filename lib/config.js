import { existsSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { validTools } from './adapters-registry.js';
import { CliError, escapeRe, readJson, readJsonOrNull, toPosix } from './util.js';
import { TOOL_VERSION, normalizeVersion } from './version.js';
import { msg, msgBoth } from './i18n.js';

export const CONFIG_FILE = 'backslop.json';

// Status directories inside docs/backlog: a task file lies in exactly one of them.
export const STATUSES = ['triage', 'queue', 'active', 'deferred', 'minor'];

// Where releases come from: an npm spec for a git repository on GitHub.
export const SOURCE = 'github:Velklish/backslop';
export const LANGS = ['ru', 'en'];

const LINE_BREAK_RE = /[\r\n\u2028\u2029]/;
// The marks of the managed block: one spelling per tool. Their wrappers differ (an html comment in
// markdown, `#` in .gitignore), so the ban catches the mark itself and is built from them.
export const BLOCK_MARKERS = ['backslop:start', 'backslop:end'];
export const [BLOCK_START, BLOCK_END] = BLOCK_MARKERS.map((marker) => `<!-- ${marker} -->`);
const BLOCK_MARKER_RE = new RegExp(BLOCK_MARKERS.join('|'));

// How to call backslop without an installation: npx pinned to the tag of the version that made the
// layout. Without a pin every run would pull the branch HEAD (ADR-048).
function defaultCli() {
  return `npx ${SOURCE}#v${TOOL_VERSION}`;
}

export function defaults() {
  const cli = defaultCli();
  return { prefix: 'BS', docs: 'docs', cli, lang: 'ru', tools: [] };
}

// A prefix is capital Latin letters and digits, 2–6 characters: it goes into file names, headings
// and commits, and the gates' regex is built for exactly that form.
export const PREFIX_RE = /^[A-Z][A-Z0-9]{1,5}$/;

// `cli`: `npx [flags] github:owner/repo[#vX.Y.Z]` or `npx [flags] backslop[@X.Y.Z|@latest]`;
// without an exact pin it is `pin: null`: a global command carries no pin (ADR-039, 02-cli.md).
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

// The separator between a spec and its pin: `#v` for a github spec, `@` for an npm one.
export function pinSep(form) {
  return form.repoUrl ? '#v' : '@';
}

// A pin with a tail (`#v0.1.0x`, `#v0.1.0-rc.1`, `#v0.1.0.1`) is another pin and does not match.
export function pinRe(form) {
  const spec = escapeRe(form.spec);
  const sep = form.repoUrl ? '(?:\\.git)?#v?' : '@';
  return new RegExp(`${spec}${sep}(\\d+\\.\\d+\\.\\d+)(?![\\w-]|\\.\\d)`, 'g');
}

// A pin with a tail, which `pinRe` leaves alone: `lint` reports it, `upgrade` does not move it.
export function pinTailRe(form) {
  const spec = escapeRe(form.spec);
  const sep = form.repoUrl ? '(?:\\.git)?#v?' : '@';
  return new RegExp(`${spec}${sep}(\\d+\\.\\d+\\.\\d+)(?!\\d)((?:[\\w-]|\\.\\d)(?:[\\w-]|\\.(?=[\\w-]))*)`, 'g');
}

// The project root is the nearest directory with backslop.json, going up from the start one.
export function findRoot(start) {
  let dir = path.resolve(start);
  for (;;) {
    if (existsSync(path.join(dir, CONFIG_FILE))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// Message language and cli without validating the config: a broken one gives `ru` and the default
// cli, no project gives `null`.
export function projectHintsOrNull(cwd) {
  const root = findRoot(cwd);
  if (!root) return null;
  const raw = readJsonOrNull(path.join(root, CONFIG_FILE));
  const cli = typeof raw?.cli === 'string' && raw.cli.trim() ? raw.cli : defaultCli();
  return { lang: raw?.lang === 'en' ? 'en' : 'ru', cli };
}

// The project name for templates: package.json `name` without its npm scope, else the directory.
export function projectName(root) {
  const name = readJsonOrNull(path.join(root, 'package.json'))?.name;
  if (typeof name === 'string' && name) return name.replace(/^@[^/]+\//, '');
  return path.basename(root);
}

function requireRoot(cwd) {
  const root = findRoot(cwd);
  if (!root) throw new CliError(msgBoth(null, '{config} was not found in {cwd} or its parents — run backslop init first', { config: CONFIG_FILE, cwd }));
  return root;
}

export function loadConfig(root) {
  const raw = readJson(path.join(root, CONFIG_FILE));
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new CliError(`${CONFIG_FILE}: ${msgBoth(null, 'top level must be an object')}`);
  }
  const lang = raw.lang === 'en' ? 'en' : 'ru';
  const base = defaults();
  // The version stamp is not filled in: its absence is a signal for lint and upgrade. The default
  // gates come from the project's cli, not the default one: a foreign command in gates is a defect.
  const cfg = { prefix: base.prefix, docs: base.docs, cli: base.cli, ...raw };
  if (cfg.gates === undefined) cfg.gates = [`${cfg.cli} lint`];
  validateConfig(cfg, lang);
  return cfg;
}

// One rule set for a loaded config and for the one a first init is about to write.
export function validateConfig(cfg, lang) {
  if (typeof cfg.prefix !== 'string' || !PREFIX_RE.test(cfg.prefix)) {
    const shown = typeof cfg.prefix === 'string' ? cfg.prefix : JSON.stringify(cfg.prefix);
    throw new CliError(msg(lang, '{config}: prefix “{shown}” — expected 2–6 uppercase Latin letters or digits, starting with a letter', { config: CONFIG_FILE, shown }));
  }
  if (!isProjectPath(cfg.docs)) {
    throw new CliError(msg(lang, '{config}: docs “{docs}” — expected a relative path inside the project', { config: CONFIG_FILE, docs: cfg.docs }));
  }
  validateBlockValue(cfg.docs, `${CONFIG_FILE}: docs`, lang);
  if (typeof cfg.cli !== 'string' || !cfg.cli.trim()) throw new CliError(msg(lang, '{config}: cli must be a non-empty command string', { config: CONFIG_FILE }));
  validateBlockValue(cfg.cli, `${CONFIG_FILE}: cli`, lang);
  validateGates(cfg, lang);
  if (cfg.lang === undefined) throw missingField('lang', (l) => msg(l, 'must be ru or en'), null);
  if (!LANGS.includes(cfg.lang)) {
    throw new CliError(`${CONFIG_FILE}: lang «${cfg.lang}» — ${msg('ru', 'must be ru or en')} / ${msg('en', 'must be ru or en')}`);
  }
  if (cfg.tools === undefined) {
    throw missingField('tools', (l) => msg(l, 'expected a unique array of claude, cursor, codex, [] for no adapters'), lang);
  }
  if (!Array.isArray(cfg.tools) || !validTools(cfg.tools)) {
    throw new CliError(msg(lang, '{config}: tools must be a unique array of claude, cursor, codex', { config: CONFIG_FILE }));
  }
  if (cfg.hooks !== undefined && (!Array.isArray(cfg.hooks) || !validTools(cfg.hooks))) {
    throw new CliError(msg(lang, '{config}: hooks must be a unique array of claude, cursor, codex', { config: CONFIG_FILE }));
  }
  if (cfg.version !== undefined) {
    const v = normalizeVersion(cfg.version);
    if (v === null) throw new CliError(msg(lang, '{config}: version “{version}” — expected X.Y.Z', { config: CONFIG_FILE, version: cfg.version }));
    cfg.version = v;
  }
  if (cfg.source !== undefined && (typeof cfg.source !== 'string' || !cfg.source.trim())) {
    throw new CliError(msg(lang, '{config}: source must be a git URL or repository path containing release tags', { config: CONFIG_FILE }));
  }
  validateProbe(cfg, lang);
  validateWriterConfig(cfg, lang);
  validateAgentsConfig(cfg, lang);
}

// init reads the config before it writes one, so it cannot add a missing field. `lang: null` —
// the language is unknown, and the refusal carries both texts, like the other early config errors.
function missingField(field, reason, lang) {
  const text = (l) => msg(l, '{field} is missing — {reason}; add it to {config} by hand: init reads the config first and cannot add the field', { field, reason: reason(l), config: CONFIG_FILE });
  return new CliError(`${CONFIG_FILE}: ${lang ? text(lang) : `${text('ru')} / ${text('en')}`}`);
}

// Inside the project on every OS: `\` splits like `/`; drive and UNC forms are absolute.
export function isProjectPath(p) {
  if (typeof p !== 'string' || /^[\\/]|^[A-Za-z]:/.test(p)) return false;
  const parts = p.split(/[\\/]/);
  return !parts.includes('..') && parts.some((part) => part && part !== '.');
}

// One shape check for every field that lands in the managed block; `prefix` is held by PREFIX_RE
// (docs/reference/01-layout.md § Values that land in the block).
export function validateBlockValue(value, label, lang) {
  assertSingleLine(value, label, lang);
  if (value.includes('`')) {
    throw new CliError(msgBoth(lang, '{label} must not contain a backtick: the template puts it in a code span, and a backtick inside closes it', { label }));
  }
  if (BLOCK_MARKER_RE.test(value)) {
    throw new CliError(msgBoth(lang, '{label} must not contain the backslop:start or backslop:end markers: it sits inside the block, and a marker there would copy a block boundary into the block text', { label }));
  }
}

// Every value that lands in the managed block: `label` names the field in the refusal; a null
// `lang` (init before any language is known) gives both texts.
function assertSingleLine(value, label, lang) {
  if (!LINE_BREAK_RE.test(value)) return;
  throw new CliError(msgBoth(lang, '{label} must be a single-line value without line breaks: a second line becomes a separate paragraph inside the block', { label }));
}

// A `gates` entry is a string or `{ command, when }`; both forms read as one, so the runner and
// the brief do not parse the type themselves (ADR-045).
export function gateEntry(gate) {
  if (typeof gate === 'string') return { command: gate, when: null };
  return { command: gate.command, when: gate.when ?? null };
}

function validateGates(cfg, lang) {
  if (!Array.isArray(cfg.gates)) {
    throw new CliError(msg(lang, '{config}: gates must be an array of commands: a string or { command, when }', { config: CONFIG_FILE }));
  }
  cfg.gates.forEach((gate, i) => {
    const at = `${CONFIG_FILE}: gates[${i}]`;
    if (typeof gate === 'string') {
      if (!gate.trim()) throw new CliError(msg(lang, '{at} must be a non-empty command string', { at }));
      return;
    }
    if (gate === null || typeof gate !== 'object' || Array.isArray(gate)) {
      throw new CliError(msg(lang, '{at} — expected a command string or a { command, when } object', { at }));
    }
    if (typeof gate.command !== 'string' || !gate.command.trim()) {
      throw new CliError(msg(lang, '{at}.command must be a non-empty command string', { at }));
    }
    // An empty list is rejected: a scope without patterns matches no paths, so the command would
    // never run: a silent zero coverage instead of a declared check.
    if (gate.when !== undefined && (!Array.isArray(gate.when) || !gate.when.length || gate.when.some((g) => typeof g !== 'string' || !g.trim()))) {
      throw new CliError(msg(lang, '{at}.when must be a non-empty array of non-empty glob patterns; a scope with no patterns would never run the command', { at }));
    }
  });
}

function validateProbe(cfg, lang) {
  if (cfg.probe === undefined) return;
  if (typeof cfg.probe !== 'string' || !cfg.probe.trim()) {
    throw new CliError(msg(lang, '{config}: probe must be a command string that runs the project\'s mutation probe', { config: CONFIG_FILE }));
  }
  validateBlockValue(cfg.probe, `${CONFIG_FILE}: probe`, lang);
}

function validateWriterConfig(cfg, lang) {
  if (cfg.writer === undefined) return;
  if (cfg.writer === null || typeof cfg.writer !== 'object' || Array.isArray(cfg.writer)) {
    throw new CliError(msg(lang,
      '{config}: writer must be an object with optional style and currency arrays', { config: CONFIG_FILE }));
  }
  const allowed = new Set(['style', 'currency']);
  for (const key of Object.keys(cfg.writer)) {
    if (!allowed.has(key)) {
      throw new CliError(msg(lang,
        '{config}: writer.{field} is unknown; expected style or currency', { config: CONFIG_FILE, field: key }));
    }
  }
  for (const field of allowed) {
    const globs = cfg.writer[field];
    if (globs === undefined) continue;
    if (!Array.isArray(globs)) {
      throw new CliError(msg(lang,
        '{config}: writer.{field} must be an array of glob strings', { config: CONFIG_FILE, field }));
    }
    globs.forEach((glob, i) => {
      if (typeof glob !== 'string' || !glob.trim()) {
        throw new CliError(msg(lang,
          '{config}: writer.{field}[{i}] must be a non-empty glob string', { config: CONFIG_FILE, field, i }));
      }
    });
  }
}

function validateAgentsConfig(cfg, lang) {
  if (cfg.agents === undefined) return;
  if (cfg.agents === null || typeof cfg.agents !== 'object' || Array.isArray(cfg.agents)) {
    throw new CliError(msg(lang,
      '{config}: agents must be an AGENTS.md block configuration object', { config: CONFIG_FILE }));
  }
  const overrides = cfg.agents.stepOverrides;
  if (overrides === undefined) return;
  if (overrides === null || typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw new CliError(msg(lang,
      '{config}: agents.stepOverrides must be an object keyed by step numbers', { config: CONFIG_FILE }));
  }
  for (const [step, text] of Object.entries(overrides)) {
    if (!/^[1-7]$/.test(step)) {
      throw new CliError(msg(lang,
        '{config}: agents.stepOverrides[{step}] — expected a step number from 1 to 7', { config: CONFIG_FILE, step: JSON.stringify(step) }));
    }
    if (typeof text !== 'string' || !text.trim()) {
      throw new CliError(msg(lang,
        '{config}: agents.stepOverrides[{step}] — expected non-empty text', { config: CONFIG_FILE, step: JSON.stringify(step) }));
    }
    assertSingleLine(text, `${CONFIG_FILE}: agents.stepOverrides[${JSON.stringify(step)}]`, lang);
    if (text.includes('<')) {
      throw new CliError(msg(lang,
        '{config}: agents.stepOverrides[{step}] — inline text without markup: the “<” character is not allowed', { config: CONFIG_FILE, step: JSON.stringify(step) }));
    }
  }
}

// Writing the config: known keys in a fixed order, foreign ones follow as they were.
export function saveConfig(root, cfg) {
  const order = ['prefix', 'docs', 'cli', 'gates', 'probe', 'writer', 'version', 'source', 'lang', 'tools', 'hooks', 'agents'];
  const out = {};
  for (const key of order) if (cfg[key] !== undefined) out[key] = cfg[key];
  for (const key of Object.keys(cfg)) if (!(key in out)) out[key] = cfg[key];
  writeFileSync(path.join(root, CONFIG_FILE), `${JSON.stringify(out, null, 2)}\n`);
}

// Layout paths from the root: one source for all commands and gates.
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

// Every existing component from the root down to `dir` is a directory; a missing tail is fine.
export function expectDirectory(root, dir, lang) {
  let at = root;
  for (const part of path.relative(root, dir).split(path.sep).filter(Boolean)) {
    at = path.join(at, part);
    let stat;
    try { stat = statSync(at); } catch { return; }
    if (stat.isDirectory()) continue;
    const rel = toPosix(path.relative(root, at));
    throw new CliError(msg(lang, '{rel} is a file, expected a directory', { rel }));
  }
}

// Over the 255-byte file system limit the write fails after `new --queue` renumbered the queue.
export function expectNameFits(name, lang) {
  const bytes = Buffer.byteLength(name);
  if (bytes <= 255) return;
  throw new CliError(msg(lang, 'slug is too long: the file name is {bytes} bytes, the file system limit is 255', { bytes }));
}

export function loadProject(cwd) {
  const root = requireRoot(cwd);
  const cfg = loadConfig(root);
  return { root, cfg, dirs: layout(root, cfg) };
}
