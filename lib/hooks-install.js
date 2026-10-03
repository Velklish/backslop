// Agent hook records in the project hook files of the harnesses: planned before the first write of
// `init`, checked by `lint` (docs/reference/01-layout.md § Agent hook records).
import { existsSync, readdirSync, rmdirSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { TOOLS } from './adapters-registry.js';
import { CONFIG_FILE, expectDirectory } from './config.js';
import { symlinkComponent } from './mdwalk.js';
import { CliError, readJsonOrNull, readText, writeText } from './util.js';
import { eolOf } from './text.js';
import { msg } from './i18n.js';

// `grouped`: the Claude shape, records inside `{ "hooks": [ … ] }` groups; Cursor lists them flat.
const HOOK_FILES = {
  claude: { rel: '.claude/settings.json', events: { 'session-start': 'SessionStart', stop: 'Stop' }, grouped: true },
  cursor: { rel: '.cursor/hooks.json', events: { 'session-start': 'sessionStart', stop: 'stop' }, grouped: false, base: { version: 1 } },
  codex: { rel: '.codex/hooks.json', events: { 'session-start': 'SessionStart', stop: 'Stop' }, grouped: true },
};

const OWNED_RE = /^(.*\S)\s+hook\s+(session-start|stop)\s+--harness\s+(\S+)\s*$/;
export const LOCAL_HOOK_CLI = 'npx --no-install backslop';
export const isLocalCli = (cli) => cli.trim() === LOCAL_HOOK_CLI;

export function hasProjectBackslop(root) {
  const pkg = readJsonOrNull(path.join(root, 'package.json'));
  return pkg?.devDependencies !== null && typeof pkg?.devDependencies === 'object'
    && Object.hasOwn(pkg.devDependencies, 'backslop');
}

export function hasLocalBackslop(root, platform = process.platform) {
  return existsSync(path.join(root, 'node_modules', '.bin', platform === 'win32' ? 'backslop.cmd' : 'backslop'));
}

export function installedBackslopVersion(root) {
  const version = readJsonOrNull(path.join(root, 'node_modules', 'backslop', 'package.json'))?.version;
  return typeof version === 'string' ? version : null;
}

export function hookFileRel(id) {
  return HOOK_FILES[id].rel;
}

export function hookCommand(cli, event, id) {
  return `${cli.trim()} hook ${event} --harness ${id}`;
}

// A record is ours by its command alone: the hook of this harness after a cli that names backslop
// or is the project's own `cli`.
function ownedCommand(command, id, projectCli) {
  const m = typeof command === 'string' ? command.match(OWNED_RE) : null;
  if (!m || m[3] !== id || !(m[1].includes('backslop') || m[1] === projectCli.trim())) return null;
  return { cli: m[1], event: m[2] };
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Every record of an event array as [entry, holder group or null]; foreign shapes are skipped.
function records(list, grouped) {
  if (!Array.isArray(list)) return [];
  if (!grouped) return list.filter(isObject).map((entry) => [entry, null]);
  return list.filter((g) => isObject(g) && Array.isArray(g.hooks))
    .flatMap((group) => group.hooks.filter(isObject).map((entry) => [entry, group]));
}

// The file as read: `data` null when it is absent. `strict` (a selected harness) refuses a link, a
// non-file and a file init cannot merge into; otherwise it is `skip`, or read via a `followLink`.
function readHookFile(root, id, lang, strict, followLink = false) {
  const rel = hookFileRel(id);
  const file = path.join(root, ...rel.split('/'));
  const refuse = (text) => {
    if (strict) throw new CliError(text);
    return { file, rel, skip: true };
  };
  const link = symlinkComponent(path.resolve(root), path.resolve(file));
  if (link !== null && (strict || !followLink)) {
    return refuse(msg(lang, 'agent hook file path contains a symlink: {link} — backslop does not write through a foreign link; replace it with a plain directory or file, or drop {harness} from --hooks', { link, harness: id }));
  }
  if (strict) expectDirectory(root, path.dirname(file), lang);
  if (!existsSync(file)) return { file, rel, data: null, text: null };
  if (!statSync(file).isFile()) return refuse(msg(lang, '{rel} is not a file', { rel }));
  const text = readText(file);
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return refuse(msg(lang, '{rel} is not valid JSON ({cause}): init merges its hook records into the file and does not overwrite it — fix the file, or drop {harness} from --hooks', { rel, cause: e.message, harness: id }));
  }
  if (!isObject(data)) return refuse(msg(lang, '{rel}: the top level is not an object — init merges its hook records into it and does not overwrite it', { rel }));
  if (data.hooks !== undefined && !isObject(data.hooks)) {
    return refuse(msg(lang, '{rel}: hooks is not an object — init merges its hook records into it and does not overwrite it', { rel }));
  }
  if (strict) {
    for (const key of Object.values(HOOK_FILES[id].events)) {
      if (data.hooks?.[key] !== undefined && !Array.isArray(data.hooks[key])) {
        throw new CliError(msg(lang, '{rel}: hooks.{key} is not an array — init merges its hook records into it and does not overwrite it', { rel, key }));
      }
    }
  }
  return { file, rel, data, text, link };
}

// The next content: owned records removed, or with `selected` rewritten in place and appended where
// none was; only what this removal empties goes. `null` — nothing is left, the file goes.
function nextData(data, id, projectCli, selected) {
  const cli = selected ? projectCli : null;
  const spec = HOOK_FILES[id];
  const next = data === null ? structuredClone(spec.base ?? {}) : structuredClone(data);
  const hooks = isObject(next.hooks) ? next.hooks : {};
  const placed = new Set();
  let removed = false;
  for (const [key, list] of Object.entries(hooks)) {
    const event = cli === null ? undefined : Object.keys(spec.events).find((e) => spec.events[e] === key);
    const drop = new Set();
    for (const [entry, group] of records(list, spec.grouped)) {
      if (!ownedCommand(entry.command, id, projectCli)) continue;
      if (event && !placed.has(event)) {
        entry.command = hookCommand(cli, event, id);
        placed.add(event);
      } else {
        drop.add(entry);
      }
    }
    if (!drop.size) continue;
    removed = true;
    for (const group of spec.grouped ? list : []) {
      if (!isObject(group) || !Array.isArray(group.hooks) || !group.hooks.some((e) => drop.has(e))) continue;
      group.hooks = group.hooks.filter((e) => !drop.has(e));
      if (!group.hooks.length) drop.add(group);
    }
    hooks[key] = list.filter((item) => !drop.has(item));
    if (!hooks[key].length) delete hooks[key];
  }
  for (const event of cli === null ? [] : Object.keys(spec.events)) {
    if (placed.has(event)) continue;
    const command = hookCommand(cli, event, id);
    const key = spec.events[event];
    hooks[key] = [...(hooks[key] ?? []), spec.grouped ? { hooks: [{ type: 'command', command }] } : { command }];
  }
  if (removed && !Object.keys(hooks).length) delete next.hooks;
  else if (Object.keys(hooks).length) next.hooks = hooks;
  const rest = Object.keys(next).filter((key) => !(key in (spec.base ?? {}) && next[key] === spec.base[key]));
  return removed && !rest.length ? null : next;
}

// The written form follows the file: its indent and line endings; a new file gets two spaces.
function serialize(data, text) {
  const indent = text?.match(/\n([ \t]+)\S/)?.[1] ?? 2;
  const eol = text === null ? '\n' : eolOf(text);
  const body = JSON.stringify(data, null, indent).replace(/\n/g, eol);
  return text === null || /\r?\n$/.test(text) ? `${body}${eol}` : body;
}

// Every hook file of the three harnesses, read and decided before the first write of `init`:
// `write` holds the new text, `remove` the file to delete; an unchanged file is not in the plan.
export function planHooks(root, cfg) {
  const selected = cfg.hooks ?? [];
  const plan = [];
  for (const id of TOOLS) {
    const on = selected.includes(id);
    const read = readHookFile(root, id, cfg.lang, on);
    if (read.skip || (!on && read.data === null)) continue;
    const next = nextData(read.data, id, cfg.cli, on);
    if (next === null) plan.push({ ...read, remove: true });
    else if (JSON.stringify(next) !== JSON.stringify(read.data)) plan.push({ ...read, write: serialize(next, read.text) });
  }
  return plan;
}

// Applies the plan; the directory a removed file leaves empty goes with it.
export function applyHooks(plan, lang) {
  return plan.map((item) => {
    if (item.write !== undefined) {
      writeText(item.file, item.write);
      return msg(lang, '{rel} written', { rel: item.rel });
    }
    unlinkSync(item.file);
    const dir = path.dirname(item.file);
    if (!readdirSync(dir).length) rmdirSync(dir);
    return msg(lang, '{rel} removed', { rel: item.rel });
  });
}

// `lint`: a selected harness needs both records with this project's cli; an unselected one none.
export function hookErrors(root, cfg) {
  const selected = cfg.hooks ?? [];
  const errors = [];
  for (const id of TOOLS) {
    const on = selected.includes(id);
    let read;
    try {
      read = readHookFile(root, id, cfg.lang, on, true);
    } catch (e) {
      if (!(e instanceof CliError)) throw e;
      errors.push({ file: path.join(root, ...hookFileRel(id).split('/')), msg: msg(cfg.lang, '{cause} — init refuses on it', { cause: e.message }) });
      continue;
    }
    if (read.skip) continue;
    const spec = HOOK_FILES[id];
    const owned = Object.entries(read.data?.hooks ?? {}).flatMap(([key, list]) => records(list, spec.grouped)
      .map(([entry]) => ({ key, command: entry.command, ...ownedCommand(entry.command, id, cfg.cli) }))
      .filter((r) => r.cli !== undefined));
    const err = (text) => errors.push({ file: read.file, msg: text });
    if (!on) {
      if (owned.length && read.link) {
        err(msg(cfg.lang, 'backslop agent hook records for {harness} sit here, behind the symlink {link}, and the hooks field of {config} does not select {harness} — init does not remove records through a link: remove them by hand', { harness: id, link: read.link, config: CONFIG_FILE }));
      } else if (owned.length) {
        err(msg(cfg.lang, 'backslop agent hook records for {harness} sit here, but the hooks field of {config} does not select {harness} — run {cli} init', { harness: id, config: CONFIG_FILE, cli: cfg.cli }));
      }
      continue;
    }
    const before = errors.length;
    for (const r of owned.filter((o) => o.cli !== cfg.cli.trim())) {
      err(msg(cfg.lang, 'the agent hook record “{command}” runs another cli than this project’s {cli} — run {cli} init', { command: r.command, cli: cfg.cli }));
    }
    for (const [event, key] of Object.entries(spec.events)) {
      const command = hookCommand(cfg.cli, event, id);
      if (owned.some((o) => o.key === key && o.command === command)) continue;
      err(msg(cfg.lang, 'the {key} agent hook record of {harness} is missing: expected “{command}” — run {cli} init', { key, harness: id, command, cli: cfg.cli }));
    }
    // A duplicate or a misplaced owned record: init would rewrite the file, so lint is red too.
    if (errors.length === before && JSON.stringify(nextData(read.data, id, cfg.cli, true)) !== JSON.stringify(read.data)) {
      err(msg(cfg.lang, 'the agent hook records of {harness} differ from what init writes: a duplicate or a record under another event — run {cli} init', { harness: id, cli: cfg.cli }));
    }
  }
  return errors;
}
