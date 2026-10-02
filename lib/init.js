// Layout into a project: config, docs skeleton, skills, the AGENTS.md block — idempotent; the
// re-run rules are in docs/reference/01-layout.md § Re-run init.
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  BLOCK_END, BLOCK_MARKERS, BLOCK_START, CONFIG_FILE, LANGS, PREFIX_RE, STATUSES, defaults, expectDirectory, findRoot, isProjectPath, layout, loadConfig, parseCli, projectName, saveConfig, validateBlockValue, validateConfig,
} from './config.js';
import { CLAUDE_STUB, checkAdapterOutputs, checkAdapterRoots, cleanupAdapters, ensureClaudeStub, renderAdapters } from './adapters.js';
import { TOOLS, adapterRootRel, validTools } from './adapters-registry.js';
import { readDirEntries, srcFiles, wordUnreadable } from './mdwalk.js';
import { TEMPLATES_DIR, isOwnRoles, isToolRepo, probeSlots, renderProjectTemplate, templateRel } from './templates.js';
import { formatAdrNumber, scanAdrs } from './adr-scan.js';
import { isDirectory } from './tasks.js';
import { applyHooks, planHooks } from './hooks-install.js';
import { CliError, info, ok, parseCommandArgs, readText, today, toPosix, warn, writeText } from './util.js';
import { TOOL_VERSION, compareVersions, stampNewerHead } from './version.js';
import { RU, msg, msgBoth } from './i18n.js';
import { eolOf } from './text.js';

// In .gitignore an html comment would not be a comment but a file-name pattern with spaces.
const IGNORE_MARKERS = BLOCK_MARKERS.map((marker) => `# ${marker}`);
const STEP_RE = /^([1-7])\. /;
// All ASCII punctuation of CommonMark: 32 characters, from `!` to `~`. Why the list is complete
// and why the caveats of the spec do not reach practice — ADR-052.
const MD_PUNCT = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/g;
const WORKER_BOUNDARY_RE = new RegExp(`^(?:${RU.parserWords.workerBoundaries}|Worker boundaries):`);

export async function run(argv, { cwd, lang }) {
  const { values } = parseCommandArgs(argv, {
    dir: { type: 'string' },
    prefix: { type: 'string' },
    cli: { type: 'string' },
    lang: { type: 'string' },
    tools: { type: 'string' },
    hooks: { type: 'string' },
  }, { positionals: 0, lang });
  const root = path.resolve(cwd);
  const existingRoot = findRoot(root);
  if (existingRoot && existingRoot !== root) {
    throw new CliError(msgBoth(null, 'project is already initialized above at {existingRoot}; run init there or create a separate {config}', { existingRoot, config: CONFIG_FILE }));
  }

  let cfg;
  let freshConfig = false;
  const created = [];
  const skipped = [];
  const notes = [];
  const requestedLang = values.lang;
  if (requestedLang !== undefined && !LANGS.includes(requestedLang)) {
    throw new CliError(`--lang «${requestedLang}»: ${msg('ru', 'must be ru or en')} / ${msg('en', 'must be ru or en')}`);
  }
  // The flag errors below speak --lang or the existing config's language; unknown means both.
  const knownLang = requestedLang ?? lang;
  const requestedTools = values.tools === undefined ? undefined : parseTools(values.tools, knownLang);
  const requestedHooks = values.hooks === undefined ? undefined : parseHooks(values.hooks, knownLang);
  const normDir = (p) => toPosix(path.normalize(p)).replace(/\/+$/, '');
  if (values.dir !== undefined && !isProjectPath(values.dir)) {
    throw new CliError(msgBoth(knownLang, '--dir “{dir}”: expected a relative path inside the project', { dir: values.dir }));
  }
  const dir = values.dir === undefined ? undefined : normDir(values.dir);
  const configFile = path.join(root, CONFIG_FILE);
  if (existsSync(configFile)) {
    cfg = loadConfig(root);
    // A layout made by an older version would overwrite the skills and the stamp of a newer one:
    // a downgrade is not init.
    if (cfg.version && compareVersions(cfg.version, TOOL_VERSION, cfg.lang) > 0) {
      throw new CliError(msg(cfg.lang, '{head}; an older tool cannot generate this layout', { head: stampNewerHead(cfg.version, cfg.lang) }));
    }
    const given = { ...values, dir };
    const stored = { ...cfg, docs: normDir(cfg.docs) };
    for (const [flag, key] of [['dir', 'docs'], ['prefix', 'prefix'], ['cli', 'cli']]) {
      if (given[flag] !== undefined && given[flag] !== stored[key]) {
        throw new CliError(msg(cfg.lang, '{config} already sets {key} = “{value}”; change it in the config, not with this flag', { config: CONFIG_FILE, key, value: cfg[key] }));
      }
    }
    if (requestedLang !== undefined) cfg.lang = requestedLang;
    if (requestedTools !== undefined) cfg.tools = requestedTools;
    if (requestedHooks !== undefined) cfg.hooks = requestedHooks;
    skipped.push(CONFIG_FILE);
  } else {
    const base = defaults();
    const prefix = values.prefix ?? base.prefix;
    if (!PREFIX_RE.test(prefix)) throw new CliError(msgBoth(knownLang, '--prefix “{prefix}”: expected 2–6 uppercase Latin letters or digits, starting with a letter', { prefix }));
    const docs = dir ?? base.docs;
    const cli = values.cli ?? base.cli;
    if (values.cli !== undefined && !values.cli.trim()) throw new CliError(msgBoth(knownLang, '--cli must be a non-empty command string'));
    if (values.cli !== undefined) validateBlockValue(values.cli, '--cli', knownLang);
    if (dir !== undefined) validateBlockValue(dir, '--dir', knownLang);
    cfg = {
      prefix, docs, cli, gates: [`${cli} lint`], version: TOOL_VERSION,
      lang: requestedLang ?? base.lang,
      tools: requestedTools ?? base.tools,
      ...(requestedHooks !== undefined && { hooks: requestedHooks }),
    };
    // The rules every later command applies to this file: a value they refuse is never written.
    validateConfig(cfg, cfg.lang);
    freshConfig = true;
  }

  // Self-host keeps tools: [] (AGENTS.md): a stand with an adapter, raised from the tool's root,
  // would rewrite the repository itself.
  if (requestedTools?.length && isToolRepo(root)) {
    throw new CliError(msg(cfg.lang,
      '--tools {tools}: {root} is the backslop repository itself (templates/ is the running tool\'s directory), adapter outputs are not laid out here; set up a stand in a directory of its own and run init --tools {tools} there', { tools: values.tools, root }));
  }

  // Pre-write phase: the checks of adapter roots and outputs, hooks, docs paths and managed files
  // run before saveConfig.
  checkAdapterRoots(root, cfg.tools, cfg.lang);
  checkAdapterOutputs(root, cfg.tools, cfg.lang);
  const hookPlan = planHooks(root, cfg);
  const dirs = layout(root, cfg);
  for (const dir of [dirs.adr, dirs.archive, dirs.reference, ...Object.values(dirs.statusDir)]) expectDirectory(root, dir, cfg.lang);
  const unreadable = msg(cfg.lang, 'init cannot lay out the skeleton in it');
  for (const dir of [dirs.docs, dirs.backlog, dirs.adr, dirs.archive, dirs.reference, ...Object.values(dirs.statusDir)]) {
    wordUnreadable(root, cfg.lang, unreadable, () => isDirectory(root, dir) && readDirEntries(dir));
  }
  if (existsSync(dirs.docsReadme) && !statSync(dirs.docsReadme).isFile()) {
    const rel = toPosix(path.relative(root, dirs.docsReadme));
    throw new CliError(msg(cfg.lang, '{rel} is not a file: init reads it as the documentation index', { rel }));
  }
  const agentsFile = path.join(root, 'AGENTS.md');
  const agents = readManaged(agentsFile, [BLOCK_START, BLOCK_END], cfg.lang);
  const ignore = readManaged(path.join(root, '.gitignore'), IGNORE_MARKERS, cfg.lang, cfg.tools.length > 0);
  if (freshConfig) {
    saveConfig(root, cfg);
    created.push(CONFIG_FILE);
  }

  // The process ADR is 001 or the next free number, or a second `adr-001-*` would hit the gate; a
  // process ADR already there (any number) is not touched by a repeated init.
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
    ...probeSlots(cfg),
    hooksRule: cfg.hooks?.length ? `\n\n${renderProjectTemplate(cfg, 'agents-hooks.md', {}).trim()}` : '',
  };

  const block = applyStepOverrides(renderProjectTemplate(cfg, 'agents-section.md', vars).trimEnd(), cfg);
  if (!cfg.probe) {
    notes.push(msg(cfg.lang,
      'probe is not declared in {config}: the block carries no mutation-probe requirement and the skill asks for a hand-made check without a command — declare the command in probe or describe the probe in a section of your own outside the block', { config: CONFIG_FILE }));
  }

  // The docs skeleton: each template file once; an existing one is not touched.
  let foreignRoles = null;
  const docsTemplates = path.join(TEMPLATES_DIR, ...templateRel(cfg.lang, 'docs').split('/'));
  for (const [tplRel] of srcFiles(docsTemplates, '', ['.md'])) {
    const rel = tplRel === 'adr/adr-001-process.md' ? adrRel : tplRel;
    const target = path.join(dirs.docs, ...rel.split('/'));
    if (existsSync(target)) {
      skipped.push(toPosix(path.relative(root, target)));
      if (tplRel === 'ROLES.md' && statSync(target).isFile() && !isOwnRoles(readText(target), vars)) foreignRoles = skipped.at(-1);
      continue;
    }
    writeText(target, renderProjectTemplate(cfg, `docs/${tplRel}`, vars));
    created.push(toPosix(path.relative(root, target)));
  }
  // Status directories do not live empty in git: .gitkeep holds them in a clone.
  for (const status of STATUSES) {
    const keep = path.join(dirs.statusDir[status], '.gitkeep');
    if (existsSync(keep)) continue;
    writeText(keep, '');
    created.push(toPosix(path.relative(root, keep)));
  }

  // Selected adapter outputs are rewritten, deselected ones cleaned: by the ownership predicate;
  // a foreign file on an owned path stays and is named by a warning (ADR-040).
  const adapterWarning = cleanupAdapters(root, cfg);
  const rendered = renderAdapters(root, cfg, vars);

  // The block in AGENTS.md between the markers: replaced if present, appended at the end if not.
  const agentsState = upsertBlock(agentsFile, agents, block, cfg.lang);
  const claude = ensureClaudeStub(root, cfg.tools, cfg.lang);
  const ignoreState = upsertIgnore(root, cfg, ignore);
  const hookStates = applyHooks(hookPlan, cfg.lang);

  // The docs index was there already, and the first ADR was just created: a person adds the table
  // row, or lint turns red right after init without saying why.
  const adrCreated = created.includes(toPosix(path.relative(root, path.join(dirs.docs, ...adrRel.split('/')))));
  if (adrCreated && existsSync(dirs.docsReadme) && !readFileSync(dirs.docsReadme, 'utf8').includes(adrRel)) {
    notes.push(msg(cfg.lang,
      '{docs}/README.md already existed: add a row linking {adrRel} to its table, otherwise lint fails', { docs: cfg.docs, adrRel }));
  }

  // The version stamp: this version of the tool made the layout. The pin in cli is not touched:
  // upgrade moves it; a mismatch is named aloud.
  if (cfg.version !== TOOL_VERSION) {
    notes.push(cfg.version
      ? msg(cfg.lang, 'version stamp: v{from} → v{version}', { from: cfg.version, version: TOOL_VERSION })
      : msg(cfg.lang, 'version stamp: missing → v{version}', { version: TOOL_VERSION }));
    cfg.version = TOOL_VERSION;
  }
  // A repeated init saves the new stamp and the --lang and --tools values it was given.
  saveConfig(root, cfg);
  const form = parseCli(cfg.cli);
  const pin = form?.pin ?? null;
  const pinMismatch = pin !== null && pin !== TOOL_VERSION;
  const unpinned = form !== null && pin === null;

  ok(msg(cfg.lang,
    'init: {docs}/ (prefix {prefix}), files created {created}, left unchanged {skipped}', { docs: cfg.docs, prefix: cfg.prefix, created: created.length, skipped: skipped.length }));
  const outputs = cfg.tools.map((tool) => `${tool} ${rendered.counts[tool]}`).join(', ');
  info(outputs ? msg(cfg.lang, 'adapter outputs: {outputs}', { outputs }) : msg(cfg.lang, 'adapter outputs: none'));
  info(msg(cfg.lang, 'AGENTS.md: backslop block {agentsState}; CLAUDE.md: {state}; .gitignore: {ignoreState}', { agentsState, state: claude.state, ignoreState }));
  if (hookStates.length) info(msg(cfg.lang, 'agent hooks: {states}', { states: hookStates.join(', ') }));
  if (claude.warning) warn(claude.warning);
  if (adapterWarning) warn(adapterWarning);
  if (rendered.warning) warn(rendered.warning);
  if (foreignRoles) warn(msg(cfg.lang, '{foreign}: a file of your own sits where backslop lays its roles document, and the block and the backlog README point to it — rename it, fix the links to it and run {cli} init', { foreign: foreignRoles, cli: cfg.cli }));
  for (const note of notes) info(note);
  if (pinMismatch) warn(msg(cfg.lang, 'cli is pinned to v{pin}, but layout was generated by v{version}: run {cli} upgrade or update cli in {config}', { pin, version: TOOL_VERSION, cli: cfg.cli, config: CONFIG_FILE }));
  if (unpinned) warn(msg(cfg.lang, 'an unpinned cli fetches a fresh version on every run: run {cli} upgrade to pin v{version}', { cli: cfg.cli, version: TOOL_VERSION }));
  info(cfg.tools.length
    ? msg(cfg.lang,
      'next: {cli} lint validates the layout; use the backslop-seed skill to populate docs; update with {cli} upgrade', { cli: cfg.cli })
    : isToolRepo(root) ? msg(cfg.lang,
      'next: {cli} lint validates the layout; update with {cli} upgrade', { cli: cfg.cli })
    : msg(cfg.lang,
      'next: {cli} lint validates the layout; an adapter installs the skills, including the one that populates docs: {cli} init --tools claude|cursor|codex; update with {cli} upgrade', { cli: cfg.cli }));
  return 0;
}

function parseTools(raw, lang) {
  if (raw === 'none') return [];
  const tools = raw.split(',').map((tool) => tool.trim()).filter(Boolean);
  if (!tools.length || !validTools(tools)) {
    throw new CliError(msgBoth(lang, '--tools “{raw}”: a comma-separated list of claude, cursor, codex, or none', { raw }));
  }
  return TOOLS.filter((tool) => tools.includes(tool));
}

function parseHooks(raw, lang) {
  if (raw === 'none') return [];
  const hooks = raw.split(',').map((id) => id.trim()).filter(Boolean);
  if (!hooks.length || !validTools(hooks)) {
    throw new CliError(msgBoth(lang, '--hooks “{raw}”: a comma-separated list of claude, cursor, codex, or none', { raw }));
  }
  return TOOLS.filter((id) => hooks.includes(id));
}

// An override value stays inline text, not markup: it is escaped at assembly. What exactly is
// escaped, and why not a list of forbidden forms — ADR-052.
function escapeInline(text) {
  return text.replace(MD_PUNCT, '\\$&');
}

// A project can replace the text of one step without taking from init the ownership of the whole
// block. The number and neighbouring steps stay templated; the role boundary after step 7 holds.
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

// Owned outputs are not committed to git (ADR-040): lines by selected adapters, `/CLAUDE.md` only
// with our stub on disk, or the block would hide a user's own file from git.
function ignoreLines(root, cfg) {
  const lines = cfg.tools.map((tool) => `${adapterRootRel(tool)}/backslop-*`);
  const claudeFile = path.join(root, 'CLAUDE.md');
  if (cfg.tools.includes('claude') && existsSync(claudeFile) && readFileSync(claudeFile, 'utf8') === CLAUDE_STUB) {
    lines.push('/CLAUDE.md');
  }
  return lines;
}

// The block is created only when there is something to ignore or the block already existed:
// self-host with `tools: []` must not get a `.gitignore` it lacked and dirty the tracked tree.
function upsertIgnore(root, cfg, current) {
  const file = path.join(root, '.gitignore');
  const lines = ignoreLines(root, cfg);
  if (!lines.length && !current?.span) return msg(cfg.lang, 'not needed');
  const body = lines.length
    ? lines.join('\n')
    : msg(cfg.lang, '# no adapters selected — nothing is generated');
  const block = `${IGNORE_MARKERS[0]}\n${body}\n${IGNORE_MARKERS[1]}`;
  return upsertBlock(file, current, block, cfg.lang);
}

// A file with a managed block, read before the first write: UTF-8 only, each marker once and alone
// on its line. `null` is no file; an undecodable file init will not rewrite passes as `text: null`.
export function readManaged(file, [open, close], lang = 'ru', rewritten = true) {
  if (!existsSync(file)) return null;
  const name = path.basename(file);
  if (statSync(file).isDirectory()) throw new CliError(msg(lang, '{name} is a directory, expected a file', { name }));
  const bytes = readFileSync(file);
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    if (!rewritten && !bytes.includes(open)) return { text: null, span: null };
    throw new CliError(msg(lang, '{name}: not valid UTF-8 — convert it, then retry', { name }));
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
    throw new CliError(msg(lang, '{name}: a backslop block marker stands on its own line more than once — fix it manually', { name }));
  }
  if (starts.length !== ends.length || ends[0] < starts[0]) {
    throw new CliError(msg(lang, '{name}: unmatched backslop block marker — fix it manually', { name }));
  }
  return { text, span: { start: starts[0], end: ends[0] } };
}

function upsertBlock(file, current, block, lang) {
  if (current === null) {
    writeFileSync(file, `${block}\n`);
    return msg(lang, 'written to a new file');
  }
  const { text, span } = current;
  const eol = eolOf(text);
  const eolBlock = block.replace(/\r?\n/g, eol);
  if (span !== null) {
    const next = text.slice(0, span.start) + eolBlock + text.slice(span.end);
    if (next !== text) writeFileSync(file, next);
    return next === text ? msg(lang, 'unchanged') : msg(lang, 'updated');
  }
  const base = text.endsWith('\n') ? text : `${text}${eol}`;
  writeFileSync(file, `${base}${eol}${eolBlock}${eol}`);
  return msg(lang, 'appended');
}
