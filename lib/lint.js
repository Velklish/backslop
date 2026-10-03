// Tracker gates: what drifts apart silently by hand — a broken link, a duplicate number, an archive
// without a result… A failure lists everything found; the exit code is 1 on errors (03-lint.md).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { CONFIG_FILE, SOURCE, STATUSES, gateEntry, loadProject, parseCli, pinRe, pinSep, pinTailRe } from './config.js';
import {
  anchorReader, blankCode, blankFences, checkLinks, directoryLinks, localLinks, normalizeHrefTarget, relativeLinks, repoPrefix,
  splitHref,
} from './links.js';
import { LOG_FILE, brokenLogLines, hasNamedOutcome, logAnchor, logFile, outcomeWordMissing, readLogText } from './log.js';
import { linkGateFiles, livePinText, mdFiles, resolvedEntry, rootMarkdown, stalePins, wordUnreadable } from './mdwalk.js';
import { ADR_FILE_RE, scanAdrs } from './adr-scan.js';
import { formatId, matchId } from './ids.js';
import {
  FIELD_AREA, FIELD_COST, FIELD_CREATED, FIELD_DEPS, FIELD_ORDER, FIELD_PARENT, FIELD_PREV_ORDER, FIELD_TAKEN, SECTION_DEFERRED, SECTION_EVIDENCE, canonicalId, fieldName, fieldOccurrences, getField, hasResultTodo, hasTodoPlaceholder, idMentionRe, isPlaceholderLine, isTodoPlaceholder, leadsOut, linkedOutDirs, orderOf, parseCost, readTitle, scanTasks,
  sectionBody, sectionName, sectionOccurrences, taskDirRe, taskFileRe,
} from './tasks.js';
import { splitLines } from './text.js';
import { entryTitle, splitSections, unreleasedIndex } from './changelog-format.js';
import {
  CliError, DATE_RE, bad, escapeRe, git, gitCause, info, lsFiles, ok, parseCommandArgs, readJson, readText, statOrNull, toPosix, warn,
} from './util.js';
import { TOOL_VERSION, compareVersions } from './version.js';
import { generatedAdapterFiles, ownedAdapterFiles, skippedVendoredOutputs } from './adapters.js';
import { GENERATED_MARKER, isOwnedAdapterFile } from './adapter-ownership.js';
import { hookErrors } from './hooks-install.js';
import { msg } from './i18n.js';
import { isToolRepo, templateParity, templateSlots } from './templates.js';

const QUOTE_OPEN = /^\s*<!--\s*quote:\s*(?:(before):\s*)?(\S+?)\s*-->\s*$/;
const QUOTE_MARKER = /^\s*<!--\s*\/?quote\b.*-->\s*$/;
const QUOTE_CLOSE = /^\s*<!--\s*\/quote\s*-->\s*$/;
const FENCE_LINE = /^\s*(?:`{3,}|~{3,})/;

// Files where a pin in prose is a live installation instruction, not a history record: CHANGELOG
// and the ADRs describe a moment, so their version numbers are not drift.
const RELEASE_PIN_FILES = ['README.md', 'AGENTS.md'];
// Both install forms with a real number: a github spec with a tag and an npm version. A pre-release
// tail (`-rc.1`) is part of the pin; `#v<version>`, `x` and `.1` do not match.
const PIN_IN_PROSE = new RegExp(`(?:${escapeRe(SOURCE)}(?:\\.git)?#v?|backslop@)(\\d+\\.\\d+\\.\\d+)(-[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?(?![\\w-]|\\.\\d)`, 'g');

// Errors fail the gate; warnings are only printed: the layout version, a finding under a closed
// parent and an empty “Scope” in minor/ call for a move but do not block the project.
export function lintProject(project) {
  const { root, cfg } = project;
  const errors = [];
  const warnings = [];
  const notes = [];
  const err = (file, msg) => errors.push({ file: toPosix(path.relative(root, file)), msg });
  const note = (file, msg) => warnings.push({ file: toPosix(path.relative(root, file)), msg });
  const tasks = scanTasks(project);
  const prefix = repoPrefix(root, cfg.lang);
  const links = linkChecker(project, err, prefix);

  const read = lintLinks(project, err, links);
  lintAdapters(project, err, links);
  for (const e of hookErrors(root, cfg)) err(e.file, e.msg);
  lintTaskFiles(project, tasks, err);
  lintBacklogLayout(project, err);
  lintBacklogTodos(project, err);
  lintStatusFields(project, tasks, err, note);
  lintAreaField(project, tasks, err, note);
  lintArchive(project, err);
  lintLog(project, tasks, err, note, prefix);
  const docSet = trackerFreeSet(project);
  lintMentions(project, tasks, err, docSet);
  lintTrackerFreeDocs(project, err, (text) => notes.push(text), prefix, docSet);
  lintChangelog(root, err, cfg.lang);
  lintAdrIndex(project, err, prefix);
  lintClosedParent(project, tasks, note);
  lintQuotes(project, err);
  lintVersion(project, note);
  lintProsePin(project, err);
  lintReleaseVersions(project, err);
  lintTemplateParity(project, err);
  lintTemplateSlots(project, err);
  lintControlBytes(project, err, note);
  return { errors, warnings, read, notes };
}

// 11. Tool release: the package version, the stamp, the CHANGELOG section and the pins in prose are
// one number. Only in the backslop repository itself: a foreign project has no tool version.
function lintReleaseVersions({ root, cfg }, err) {
  if (!isToolRepo(root)) return;
  const pkgFile = path.join(root, 'package.json');
  if (!existsSync(pkgFile)) return;
  let version;
  try {
    version = readJson(pkgFile)?.version;
  } catch (e) {
    if (!(e instanceof CliError)) throw e;
    err(pkgFile, msg(cfg.lang, 'cannot be parsed: {message}', { message: e.cause.message }));
    return;
  }
  if (typeof version !== 'string') {
    err(pkgFile, msg(cfg.lang, 'no version field — there is nothing to check the stamp, CHANGELOG section, and pins against'));
    return;
  }
  if (version !== cfg.version) {
    err(pkgFile, msg(cfg.lang,
      'package.json version v{version} differs from the {config} stamp v{stamp} — npm run release -- X.Y.Z --bump updates both', { version, config: CONFIG_FILE, stamp: cfg.version }));
  }
  const changelog = path.join(root, 'CHANGELOG.md');
  const released = new RegExp(`^v${escapeRe(version)}\\b`);
  if (existsSync(changelog) && !splitSections(readText(changelog)).sections.some((s) => released.test(s.title))) {
    err(changelog, msg(cfg.lang,
      'no “## v{version}” section — the released version has no entry', { version }));
  }
  for (const name of RELEASE_PIN_FILES) {
    const file = path.join(root, name);
    if (!existsSync(file)) continue;
    splitLines(readText(file)).forEach((line, i) => {
      for (const m of line.matchAll(PIN_IN_PROSE)) {
        if (m[1] !== version || m[2]) {
          err(file, msg(cfg.lang,
            'line {line}: pin {pin} — the tool is on v{version}', { line: i + 1, pin: m[0], version }));
        }
      }
    });
  }
}

function lintTemplateParity({ root, cfg }, err) {
  const templates = path.join(root, 'templates');
  if (!isToolRepo(root)) return;
  for (const msg of templateParity(templates, cfg.lang)) err(templates, msg);
}

// 12. Template placeholders: a foreign project has no `templates/` in this sense — the contract
// ties the tool's template to the tool's code, and only here is there code to check it against.
function lintTemplateSlots({ root, cfg }, err) {
  const templates = path.join(root, 'templates');
  if (!isToolRepo(root)) return;
  for (const msg of templateSlots(templates, cfg.lang)) err(templates, msg);
}

// 14. A byte below 0x09 in a source: NUL hides the file from git and grep, the rest are invisible.
// Only in the tool repository: a consumer's docs/** and test/** may legitimately hold binaries.
const SOURCE_TREES = ['lib', 'bin', 'test', 'templates', 'scripts', 'docs'];

function lintControlBytes({ root, cfg }, err, note) {
  if (!isToolRepo(root)) return;
  let files;
  try {
    files = lsFiles(root, SOURCE_TREES, [], cfg.lang);
  } catch (e) {
    if (!(e instanceof CliError)) throw e;
    note(path.join(root, 'templates'), msg(cfg.lang, 'non-printable bytes were not checked: {message}', { message: e.message }));
    return;
  }
  for (const rel of files) {
    const file = path.join(root, rel);
    if (!statOrNull(file)?.isFile()) continue;
    const bytes = readFileSync(file);
    const at = bytes.findIndex((b) => b < 0x09);
    if (at === -1) continue;
    const code = `0x${bytes[at].toString(16).padStart(2, '0')}`;
    const line = bytes.subarray(0, at).filter((b) => b === 0x0a).length + 1;
    const why = bytes[at] === 0
      ? msg(cfg.lang, 'NUL makes the file binary to git and grep, and searching it finds nothing')
      : msg(cfg.lang, 'an invisible control byte: neither an editor nor the output shows it');
    err(file, msg(cfg.lang,
      'byte {code} at offset {at} (line {line}): {why} — write it as an escape sequence (\\u00{hex})', { code, at, line, why, hex: code.slice(2) }));
  }
}

// The layout version stamp against the tool version and the cli pin.
function lintVersion({ root, cfg }, note) {
  const file = path.join(root, CONFIG_FILE);
  const form = parseCli(cfg.cli);
  const pin = form?.pin ?? null;
  if (form && pin === null) note(file, msg(cfg.lang, 'an unpinned cli fetches a fresh version on every run — run {cli} upgrade', { cli: cfg.cli }));
  if (!cfg.version) {
    note(file, msg(cfg.lang, 'version stamp is missing — run {cli} upgrade or init', { cli: cfg.cli }));
  } else {
    const cmp = compareVersions(cfg.version, TOOL_VERSION, cfg.lang);
    if (cmp < 0) note(file, msg(cfg.lang, 'layout is older than the tool: v{stamp} < v{version} — run {cli} upgrade', { stamp: cfg.version, version: TOOL_VERSION, cli: cfg.cli }));
    if (cmp > 0) note(file, msg(cfg.lang, 'version stamp is newer than the tool: v{stamp} > v{version} — update the installation or cli pin', { stamp: cfg.version, version: TOOL_VERSION }));
    if (pin !== null && pin !== cfg.version) note(file, msg(cfg.lang, 'cli pin v{pin} differs from version stamp v{stamp} — run {cli} upgrade', { pin, stamp: cfg.version, cli: cfg.cli }));
  }
}

// A stale pin in a live file is an error: a command with it may call a withdrawn version. What is
// live and what is history: docs/reference/03-lint.md § Live-pin files.
function lintProsePin({ root, cfg }, err) {
  const form = parseCli(cfg.cli);
  // Without a pin in cli (self-host, global install) there is nothing to compare: the version of
  // the backslop that runs lint now is not a decision of this project.
  if (!form || form.pin === null) return;
  const expected = `${form.spec}${pinSep(form)}${form.pin}`;
  const re = pinRe(form);
  const tailed = pinTailRe(form);
  const suffixedMessage = (at, m) => msg(cfg.lang,
    '{at}: pin {pin} has a suffix — it is not the cli pin {expected}; upgrade leaves it, fix it by hand', { at, pin: m[0], expected });
  for (const { abs, lineNo, match, suffixed } of stalePins(root, cfg.docs, cfg.prefix, form)) {
    if (suffixed) {
      err(abs, suffixedMessage(msg(cfg.lang, 'line {lineNo}', { lineNo }), match));
      continue;
    }
    const { text, link } = livePinText(root, abs);
    const why = link !== null ? msg(cfg.lang, 'the path goes through the symlink {link}', { link }) : msg(cfg.lang, 'the file is not UTF-8');
    const fix = text !== null
      ? msg(cfg.lang, '{cli} upgrade rewrites it', { cli: cfg.cli })
      : msg(cfg.lang, 'upgrade does not rewrite it ({why}) — edit it by hand', { why });
    err(abs, msg(cfg.lang,
      'line {lineNo}: pin {pin} differs from cli — expected {expected}; {fix}', { lineNo, pin: match[0], expected, fix }));
  }
  const commands = cfg.gates.map((gate, i) => [`gates[${i}]`, gateEntry(gate).command]);
  if (cfg.probe) commands.push(['probe', cfg.probe]);
  for (const [at, command] of commands) {
    for (const m of command.matchAll(re)) {
      if (m[1] === form.pin) continue;
      err(path.join(root, CONFIG_FILE), msg(cfg.lang,
        '{at}: pin {pin} differs from cli — expected {expected}; {cli} upgrade rewrites it', { at, pin: m[0], expected, cli: cfg.cli }));
    }
    for (const m of command.matchAll(tailed)) err(path.join(root, CONFIG_FILE), suffixedMessage(at, m));
  }
}

// The files that do not lie behind a status or archive directory leading out of the project:
// the gates that read tasks leave that directory to gate 3, whose message names the link.
function notLinkedOut(files, project) {
  const dirs = linkedOutDirs(project).map((rel) => path.join(project.root, ...rel.split('/')) + path.sep);
  return files.filter(([, abs]) => !dirs.some((dir) => abs.startsWith(dir)));
}

// 1. Links in docs/** and root *.md: target, case, anchor and reference label; the counts read go
// to stdout, and a set with Markdown files and no link at all is an error (03-lint.md, gate 1).
function lintLinks({ root, cfg, dirs }, err, check) {
  const files = notLinkedOut(linkGateFiles(root, dirs), { root, cfg, dirs });
  const read = { files: files.length, links: 0, local: 0, anchors: 0 };
  for (const [, abs] of files) {
    const counts = check(abs, true);
    read.links += counts.links;
    read.local += counts.local;
    read.anchors += counts.anchors;
  }
  if (read.files && !read.links) {
    err(dirs.docs, msg(cfg.lang,
      'gate 1 read nothing: {files} Markdown files and not one link — a walk that reads no link does not prove a clean tree; check the docs field in {config} and link the documents from the index', { files: read.files, config: CONFIG_FILE }));
  }
  return read;
}

// One file's links by the gate 1 rule, for the gate and the adapter pass; returns the counts read.
// In gate 1's own set, anchors into the journal are gate 13's: its message names the missing entry.
function linkChecker({ root, cfg, dirs }, err, prefix) {
  const anchorsAt = anchorReader(root);
  const logRel = toPosix(path.relative(root, logFile(dirs)));
  const names = new RegExp(idMentionRe(cfg.prefix).source);
  return (file, journalToGate13 = false) => {
    const skip = (rel) => journalToGate13 && rel === logRel;
    const { counts, problems } = checkLinks(file, root, prefix, anchorsAt, skip);
    for (const p of problems) err(file, linkProblem(p, cfg.lang, p.target ?? toPosix(path.relative(root, file))));
    // A directory is a legal target, but a link whose text names a task promises its card.
    for (const { text, href, line } of directoryLinks(file, root, prefix)) {
      if (names.test(text)) err(file, msg(cfg.lang, 'link [{text}]({href}) points to a directory while its text names a task — point it at the task file or its journal line (line {line})', { text, href, line }));
    }
    return counts;
  };
}

function linkProblem(p, lang, where) {
  if (p.kind === 'label') {
    return msg(lang,
      'link [{text}] uses the label “{label}”, and there is no declaration “[{label}]: …” (line {line})', { text: p.text, label: p.label, line: p.line });
  }
  if (p.kind === 'case') return msg(lang, 'link target differs in case: {real} (link {href}, line {line})', { real: p.real, href: p.href, line: p.line });
  if (p.kind === 'normalization') return msg(lang, 'link target differs in Unicode normalization: {real} (link {href}, line {line})', { real: p.real, href: p.href, line: p.line });
  if (p.kind === 'anchor') {
    return msg(lang,
      'link {href}: {where} has no anchor “{fragment}” — no heading or id by that name (line {line})', { href: p.href, where, fragment: p.fragment, line: p.line });
  }
  return msg(lang, 'broken link {href} (line {line})', { href: p.href, line: p.line });
}

// The absent files among `files` that git ignores in this working tree, in one call.
// Outside a git repository the set is empty: nothing there decides an absence.
function ignoredAbsent(root, files) {
  const absent = new Map(files.filter((file) => !existsSync(file)).map((file) => [toPosix(path.relative(root, file)), file]));
  if (absent.size === 0) return new Set();
  const r = git(root, ['check-ignore', '-z', '--stdin'], { input: [...absent.keys()].map((rel) => `${rel}\0`).join('') });
  if (r.status !== 0) return new Set();
  return new Set(r.stdout.split('\0').filter(Boolean).map((rel) => absent.get(rel)));
}

// Generated adapter outputs stay out of the repository-wide walk: archive and mv must not rewrite
// derived files. This gate checks their presence, ownership and links; git-ignored absences pass.
function lintAdapters({ root, cfg }, err, check) {
  const owned = ownedAdapterFiles(root, cfg.lang);
  const stub = path.join(root, 'CLAUDE.md');
  const expected = cfg.tools.flatMap((tool) => owned[tool]);
  if (cfg.tools.includes('claude')) expected.push(stub);
  const ignored = ignoredAbsent(root, expected);
  for (const tool of cfg.tools) {
    const notLaidOut = skippedVendoredOutputs(root, tool, cfg.lang);
    for (const file of owned[tool]) {
      if (!existsSync(file)) {
        if (!ignored.has(file) && !notLaidOut.has(file)) err(file, msg(cfg.lang, 'generated output for adapter {tool} is missing — run {cli} init', { tool, cli: cfg.cli }));
        continue;
      }
      // A directory on an owned path: init refuses on it, so the gate names that refusal
      // rather than calling the directory a foreign file.
      if (!statOrNull(file)?.isFile()) {
        err(file, msg(cfg.lang, 'owned adapter output is not a file — init refuses on it'));
        continue;
      }
      // init does not overwrite a foreign file without the marker on an owned path (ADR-040): the
      // backslop skill is not installed there, and a green lint would hide that.
      const rel = toPosix(path.relative(root, file));
      if (!isOwnedAdapterFile(rel, file)) {
        err(file, msg(cfg.lang,
          'a foreign file without the {marker} marker sits at the {tool} adapter output path — init does not overwrite it: remove or rename the file and run {cli} init, or deselect the adapter', { marker: GENERATED_MARKER, tool, cli: cfg.cli }));
      }
    }
  }
  if (cfg.tools.includes('claude') && !existsSync(stub) && !ignored.has(stub)) {
    err(stub, msg(cfg.lang, 'Claude stub is missing — run {cli} init', { cli: cfg.cli }));
  }
  for (const [, file] of generatedAdapterFiles(root, cfg)) check(file);
}

// 2. Numbers: unique, equal to the heading, a sub-ID has a parent; foreign files in status
// directories.
function lintTaskFiles({ root, cfg, dirs }, tasks, err) {
  const seen = new Map();
  for (const t of tasks) {
    const key = canonicalId(t.id, cfg.prefix);
    const prev = seen.get(key);
    if (prev) err(t.file, msg(cfg.lang, 'number {id} is already used by {rel}', { id: t.id, rel: prev.rel }));
    else seen.set(key, t);
    if (t.status === 'archive' && !t.hasTask) continue;
    const title = readTitle(readText(t.file));
    if (!title) err(t.file, msg(cfg.lang, 'first line is not “# {id} · Title”', { id: t.id }));
    else if (canonicalId(title.id, cfg.prefix) !== key) err(t.file, msg(cfg.lang, 'heading names {heading}, but filename names {id}', { heading: title.id, id: t.id }));
  }
  for (const t of tasks) {
    if (t.sub !== null && !tasks.some((p) => p.num === t.num && p.sub === null)) {
      err(t.file, msg(cfg.lang, 'finding {id} has no parent {parent}', { id: t.id, parent: formatId(cfg.prefix, t.num) }));
    }
  }
  const fileRe = taskFileRe(cfg.prefix);
  for (const status of STATUSES) {
    const dir = dirs.statusDir[status];
    if (!statOrNull(dir)?.isDirectory() || leadsOut(root, dir)) continue;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      // A symlink to a directory is still a directory: scanTasks does not count it as a task, and
      // without stat the branch would stay silent: isDirectory() is false on a link's Dirent.
      const st = e.isSymbolicLink() ? statOrNull(path.join(dir, e.name)) : e;
      if (st?.isDirectory()) err(path.join(dir, e.name), msg(cfg.lang, 'directory inside a status directory: each task must be one file'));
      else if (st === null) err(path.join(dir, e.name), msg(cfg.lang, 'dangling symlink in a status directory: a task is a file, and the link points to nothing'));
      else if (!fileRe.test(e.name)) err(path.join(dir, e.name), msg(cfg.lang, 'name does not match {prefix}-N[.k]-<slug>.md', { prefix: cfg.prefix }));
    }
  }
}

// 3. docs/backlog holds only README.md and the status directories, and each of those exists.
function lintBacklogLayout({ root, cfg, dirs }, err) {
  if (!existsSync(dirs.backlog)) {
    err(dirs.backlog, msg(cfg.lang, 'backlog directory is missing — run {cli} init', { cli: cfg.cli }));
    return;
  }
  if (!statOrNull(dirs.backlog)?.isDirectory()) {
    err(dirs.backlog, msg(cfg.lang, 'a file, expected a directory'));
    return;
  }
  for (const e of readdirSync(dirs.backlog, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const abs = path.join(dirs.backlog, e.name);
    if (resolvedEntry(root, dirs.backlog, e).isDirectory()) {
      if (!STATUSES.includes(e.name)) err(abs, msg(cfg.lang, 'directory is not a status; statuses are {statuses}', { statuses: STATUSES.join(', ') }));
    } else if (STATUSES.includes(e.name) && !e.isSymbolicLink()) {
      err(abs, msg(cfg.lang, 'a file, expected a directory'));
    } else if (STATUSES.includes(e.name) && leadsOut(root, abs)) {
      err(abs, msg(cfg.lang, 'a symlink leading out of the project — the tasks in it are not read; point the link inside the project or replace it with a directory'));
    } else if (e.name !== 'README.md') {
      err(abs, msg(cfg.lang, 'file is outside a status directory: tasks belong in one of {dirs}', { dirs: STATUSES.map((s) => `${s}/`).join(', ') }));
    }
  }
  for (const status of STATUSES) {
    if (!existsSync(dirs.statusDir[status])) err(dirs.statusDir[status], msg(cfg.lang, 'status directory is missing — create it empty'));
  }
}

// A placeholder is a whole line, not a substring of an explanation; fences are examples. `triage/`
// is not checked; an empty “Scope” in `minor/` is a warning of gate 4 (03-lint.md, gate 4).
function lintBacklogTodos({ root, cfg, dirs }, err) {
  const relBacklog = toPosix(path.relative(root, dirs.backlog));
  const linked = linkedOutDirs({ root, cfg, dirs }).map((rel) => path.join(root, ...rel.split('/')));
  for (const [, file] of mdFiles(dirs.backlog, relBacklog)) {
    if (path.dirname(file) === dirs.statusDir.triage || linked.some((dir) => file.startsWith(dir + path.sep))) continue;
    const text = readText(file);
    const inMinor = path.dirname(file) === dirs.statusDir.minor;
    const areaLine = inMinor ? (fieldOccurrences(text, FIELD_AREA)[0]?.[0] ?? -1) : -1;
    splitLines(blankFences(text)).forEach((line, i) => {
      if (i === areaLine) return;
      if (isPlaceholderLine(line)) {
        err(file, msg(cfg.lang, 'line {line}: the [TODO] placeholder remains', { line: i + 1 }));
      }
    });
  }
}

// 4. Fields that a status carries with it.
function lintStatusFields({ root, cfg }, tasks, err, note) {
  // The same “Order” on two queue files leaves the place of each undefined: on a tie the
  // commands fall back to the task number, which is a coincidence, not a decision.
  const ranked = new Map();
  for (const t of tasks) {
    if (t.status === 'archive') continue;
    const text = readText(t.file);
    for (const name of [FIELD_ORDER, FIELD_PREV_ORDER, FIELD_AREA, FIELD_CREATED, FIELD_TAKEN, FIELD_DEPS, FIELD_PARENT, FIELD_COST]) {
      const occurrences = fieldOccurrences(text, name);
      if (occurrences.length > 1) {
        const lines = occurrences.map(([line]) => line + 1).join(', ');
        err(t.file, msg(cfg.lang, 'field “{field}” occurs more than once on lines {lines}', { field: fieldName(name, cfg.lang), lines }));
      }
    }
    if (t.status !== 'queue' && getField(text, FIELD_ORDER) !== null) {
      note(t.file, msg(cfg.lang, 'card in {status}/ has “{field}” — only a queue/ card has it; delete the line', { status: t.status, field: fieldName(FIELD_ORDER, cfg.lang) }));
    }
    if (t.status === 'queue' && getField(text, FIELD_PREV_ORDER) !== null) {
      note(t.file, msg(cfg.lang, 'queue/ card has “{field}” — the place it left queue/ with, dropped on entering; delete the line', { field: fieldName(FIELD_PREV_ORDER, cfg.lang) }));
    }
    if (t.status === 'queue') {
      const rank = orderOf(text);
      if (rank === null) err(t.file, msg(cfg.lang, 'queue task has no “{field}” field — queue position is not set', { field: fieldName(FIELD_ORDER, cfg.lang) }));
      else if (!Number.isInteger(rank)) err(t.file, msg(cfg.lang, '“{field}” is not an integer', { field: fieldName(FIELD_ORDER, cfg.lang) }));
      else if (ranked.has(rank)) {
        const first = toPosix(path.relative(root, ranked.get(rank)));
        err(t.file, msg(cfg.lang, '“{field}” {rank} is already used by {first} — reorder with {cli} mv N queue --top | --after M', { field: fieldName(FIELD_ORDER, cfg.lang), rank, first, cli: cfg.cli }));
      } else ranked.set(rank, t.file);
    }
    if (t.status === 'active') {
      const taken = getField(text, FIELD_TAKEN);
      if (!taken || !DATE_RE.test(taken)) err(t.file, msg(cfg.lang, 'active task has no “{field}: YYYY-MM-DD” date', { field: fieldName(FIELD_TAKEN, cfg.lang) }));
    }
    if (t.status === 'minor') {
      const label = fieldName(FIELD_COST, cfg.lang);
      const cost = getField(text, FIELD_COST);
      const parsed = cost ? parseCost(cost) : null;
      if (!cost) err(t.file, msg(cfg.lang, 'minor entry has no “{label}” field: critical, major or minor; a hypothesis carries “(hypothesis)”', { label }));
      else if (!parsed) err(t.file, msg(cfg.lang, '“{label}” is unreadable: critical, major or minor; a hypothesis is “major (hypothesis)”', { label }));
      else if (parsed.level !== 'minor' && !parsed.hypothesis) err(t.file, msg(cfg.lang, '“{label}” {level} without the “hypothesis” mark: with evidence such a finding is fixed now, not queued for a batch — fix it or {cli} mv N.k triage', { label, level: parsed.level, cli: cfg.cli }));
      const evidence = sectionBody(text, SECTION_EVIDENCE);
      const heading = sectionName(SECTION_EVIDENCE, cfg.lang);
      if (!evidence) err(t.file, msg(cfg.lang, 'minor entry has no “## {heading}” section or it is empty: the entry goes to a batch without review — write the evidence: a path with a line, a command with its output and exit code, or a measurement with a number', { heading }));
      else if (hasTodoPlaceholder(evidence)) err(t.file, msg(cfg.lang, '“{section}” section is incomplete: [TODO] remains', { section: heading, of: 'evidence' }));
    }
    if (t.status === 'deferred') {
      const body = sectionBody(text, SECTION_DEFERRED);
      const sections = sectionOccurrences(text, SECTION_DEFERRED);
      if (sections > 1) {
        err(t.file, msg(cfg.lang, '“{section}” section occurs {sections} times — keep one', { section: sectionName(SECTION_DEFERRED, cfg.lang), sections }));
      }
      if (body === null || !body) err(t.file, msg(cfg.lang, 'deferred task has no “## {section}” section with a reason and return condition', { section: sectionName(SECTION_DEFERRED, cfg.lang) }));
      else if (hasTodoPlaceholder(body)) err(t.file, msg(cfg.lang, '“{section}” section is incomplete: [TODO] remains', { section: sectionName(SECTION_DEFERRED, cfg.lang) }));
    }
  }
}

// 4. The “Scope” of a triaged task is filled in; the `[TODO]` stub from `new` is an unfilled field.
// `triage/` and the archive are not checked; in `minor/` it is a warning: the approver sets it.
function lintAreaField({ cfg }, tasks, err, note) {
  const label = fieldName(FIELD_AREA, cfg.lang);
  for (const t of tasks) {
    if (t.status === 'archive' || t.status === 'triage') continue;
    const report = t.status === 'minor' ? note : err;
    const value = getField(readText(t.file), FIELD_AREA);
    if (value === null) {
      report(t.file, msg(cfg.lang, 'has no “{label}” field naming the reference section this task belongs to', { label }));
    } else if (!value) {
      report(t.file, msg(cfg.lang, '“{label}” is empty: name the reference section', { label }));
    } else if (isTodoPlaceholder(value)) {
      report(t.file, msg(cfg.lang, '“{label}” is incomplete: the [TODO] placeholder from new remains', { label }));
    }
  }
}

// 5. Archive: a directory per task with task.md and a completed result.md. A directory stays
// legal for any length of time; a folded task is guarded by gate 13 (ADR-044).
function lintArchive({ root, cfg, dirs }, err) {
  if (!existsSync(dirs.archive)) return;
  if (!statOrNull(dirs.archive)?.isDirectory()) {
    err(dirs.archive, msg(cfg.lang, 'a file, expected a directory'));
    return;
  }
  const dirRe = taskDirRe(cfg.prefix);
  for (const e of readdirSync(dirs.archive, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const abs = path.join(dirs.archive, e.name);
    if (!resolvedEntry(root, dirs.archive, e).isDirectory()) {
      if (e.name !== 'README.md' && e.name !== LOG_FILE) err(abs, msg(cfg.lang, 'archive may contain only task directories, README.md, and {log}', { log: LOG_FILE }));
      continue;
    }
    if (!dirRe.test(e.name)) {
      err(abs, msg(cfg.lang, 'name does not match {prefix}-N[.k]-<slug>', { prefix: cfg.prefix }));
      continue;
    }
    const task = path.join(abs, 'task.md');
    const result = path.join(abs, 'result.md');
    if (!existsSync(task)) err(abs, msg(cfg.lang, 'task.md specification is missing'));
    if (!existsSync(result)) err(abs, msg(cfg.lang, 'result.md with the closing date is missing'));
    else if (hasResultTodo(readText(result))) err(result, msg(cfg.lang, 'result is incomplete: [TODO] remains'));
    else if (!hasNamedOutcome(readText(result), cfg.prefix)) err(abs, outcomeWordMissing(cfg.prefix, cfg.lang));
    // A minor/ subdirectory holds the entries closed by this batch and nothing else.
    const minorDir = path.join(abs, 'minor');
    if (!existsSync(minorDir)) continue;
    if (!statOrNull(minorDir)?.isDirectory()) {
      err(minorDir, msg(cfg.lang, 'a file, expected a directory'));
      continue;
    }
    const fileRe = taskFileRe(cfg.prefix);
    for (const m of readdirSync(minorDir, { withFileTypes: true })) {
      if (m.name.startsWith('.')) continue;
      if (!m.isFile() || !fileRe.test(m.name)) err(path.join(minorDir, m.name), msg(cfg.lang, 'minor/ of a batch holds only entry files {prefix}-N[.k]-<slug>.md', { prefix: cfg.prefix }));
    }
  }
}

// 13. Journal of closed tasks: an entry parses, the anchor equals the number, the revision is
// reachable from HEAD, a link `LOG.md#<anchor>` leads to a line (03-lint.md, gate 13).
function lintLog({ root, cfg, dirs }, tasks, err, note, prefix) {
  const file = logFile(dirs);
  if (existsSync(file)) {
    const text = readText(file);
    for (const { line, text: raw } of brokenLogLines(text, cfg.prefix)) {
      err(file, msg(cfg.lang,
        'line {line} looks like a journal entry but does not parse: “{raw}”', { line, raw: raw.trim().slice(0, 80) }));
    }
    const entries = readLogText(text, cfg.prefix);
    for (const e of entries) {
      if (e.anchor !== logAnchor(e.id)) {
        err(file, msg(cfg.lang,
          'line {line}: anchor “{anchor}” does not match the number — incoming links point at “{expected}”', { line: e.line, anchor: e.anchor, expected: logAnchor(e.id) }));
      }
    }
    lintLogRevisions(root, cfg, file, entries, err, note);
  }
  const anchors = new Set(tasks.filter((t) => t.folded).map((t) => logAnchor(t.id)));
  const logRel = toPosix(path.relative(root, file));
  // Paths from the project root, not from `docs/`: a link resolves from the file's directory, and
  // an empty prefix would give `GLOSSARY.md` for `docs/GLOSSARY.md`, hiding a missed anchor.
  const walked = [...mdFiles(dirs.docs, toPosix(path.relative(root, dirs.docs)))];
  walked.push(...rootMarkdown(root, walked));
  for (const [rel, abs] of notLinkedOut(walked, { root, cfg, dirs })) {
    const dir = path.posix.dirname(rel);
    for (const { href, line } of localLinks(readText(abs))) {
      const { target, rest } = splitHref(href);
      const hash = rest.indexOf('#');
      if (hash === -1 || !target) continue;
      const anchor = rest.slice(hash + 1);
      if (normalizeHrefTarget(dir, target, prefix) !== logRel || anchors.has(anchor)) continue;
      err(abs, msg(cfg.lang,
        'link {href} points at a journal line that does not exist — anchor “{anchor}” belongs to no entry (line {line})', { href, anchor, line }));
    }
  }
}

// A journal line's revision must lie in the history of `HEAD`, or `show N` cannot fetch the body
// by it. A shallow clone or a project without git cannot answer: a warning, neither green nor red.
function lintLogRevisions(root, cfg, file, entries, err, note) {
  const named = entries.filter((e) => e.commit);
  if (!named.length) return;
  const shallow = git(root, ['rev-parse', '--is-shallow-repository']);
  const history = shallow.status === 0 && shallow.stdout.trim() === 'false' ? git(root, ['rev-list', 'HEAD']) : null;
  if (history?.status !== 0) {
    const failed = history ?? shallow;
    const why = shallow.stdout?.trim() === 'true'
      ? msg(cfg.lang, 'the clone is shallow and lacks older commits')
      : gitCause(failed, cfg.lang).split('\n')[0];
    note(file, msg(cfg.lang, 'reachability of journal revisions from HEAD was not checked: {why}', { why }));
    return;
  }
  const revs = history.stdout.split('\n');
  const prefixes = new Map();
  for (const e of named) {
    if (!prefixes.has(e.commit.length)) prefixes.set(e.commit.length, new Set(revs.map((r) => r.slice(0, e.commit.length))));
    if (prefixes.get(e.commit.length).has(e.commit)) continue;
    err(file, msg(cfg.lang,
      'line {line}: revision {commit} is not reachable from HEAD — show will not find the body through it; such a revision is left by a commit that a squash or rebase dropped after folding', { line: e.line, commit: e.commit }));
  }
}

// 6. A mention outside the gate 15 set — backlog, archive, released CHANGELOG — names a task file.
// Code blocks are examples; spans count: “see `BS-12`” is a mention in prose.
function lintMentions({ root, cfg, dirs }, tasks, err, docSet) {
  // A directory the scan skips as a link out of the project may hold the number.
  if (linkedOutDirs({ root, cfg, dirs }).length > 0) return;
  const known = new Set(tasks.map((t) => canonicalId(t.id, cfg.prefix)));
  const inSet = new Set(docSet.files.map((f) => f.abs));
  const files = mdFiles(dirs.docs, '').filter(([, abs]) => !inSet.has(abs)).map(([, abs]) => [abs, readText(abs)]);
  const changelog = path.join(root, 'CHANGELOG.md');
  if (docSet.changelogRest !== null) files.push([changelog, docSet.changelogRest]);
  const re = idMentionRe(cfg.prefix);
  for (const [abs, text] of files) {
    const missing = new Set();
    for (const m of blankFences(text).matchAll(re)) if (!known.has(canonicalId(m[0], cfg.prefix))) missing.add(m[0]);
    for (const id of missing) err(abs, msg(cfg.lang, 'mentions {id}, but no task file exists in statuses or archive', { id }));
  }
}

// Project documentation: root README*.md, <docs>/** outside backlog/ and archive/, and the
// unreleased CHANGELOG section, the other lines blanked so line numbers stay (03-lint.md, gate 15).
function trackerFreeSet({ root, dirs }) {
  const outside = (abs) => ![dirs.backlog, dirs.archive].some((d) => abs === d || abs.startsWith(d + path.sep));
  const docs = mdFiles(dirs.docs, '').filter(([, abs]) => outside(abs));
  const readmes = rootMarkdown(root, docs).filter(([name]) => /^readme[^/]*\.md$/i.test(name));
  const files = [...docs, ...readmes].map(([, abs]) => ({ abs, text: readText(abs) }));
  const changelog = path.join(root, 'CHANGELOG.md');
  if (!existsSync(changelog)) return { files, changelogRest: null };
  const lines = splitLines(readText(changelog));
  const span = unreleasedSpan(lines);
  const keep = (inside) => lines.map((l, i) => ((i >= span.from && i < span.to) === inside ? l : '')).join('\n');
  files.push({ abs: changelog, text: keep(true) });
  return { files, changelogRest: keep(false) };
}

// The unreleased section as a [from, to) line range with its heading; empty for none. Every version
// counts as released, so a versioned top section is never unreleased; no tag is read (03-lint.md).
function unreleasedSpan(lines) {
  const { head, sections } = splitSections(lines.join('\n'));
  const at = unreleasedIndex(sections, () => true);
  if (at === -1) return { from: 0, to: 0 };
  let from = head.length;
  for (const s of sections.slice(0, at)) from += 1 + s.lines.length;
  return { from, to: from + 1 + sections[at].lines.length };
}

const URL_IN_TEXT = /\bhttps?:\/\/[^\s<>()[\]"'`]+/gi;

// 15. Project documentation stands without the tracker: no task id, no link or same-repository URL
// into backlog/ or archive/, the rules pair aside (03-lint.md, gate 15).
function lintTrackerFreeDocs({ root, cfg, dirs }, err, inform, prefix, docSet) {
  const lang = cfg.lang;
  const tracker = trackerPath(root, dirs);
  const origin = originRepo(root);
  if (!origin) inform(msg(lang, 'gate 15: no origin remote — tracker URLs into this repository were not checked'));
  const refs = origin ? refNames(root) : null;
  const ids = idMentionRe(cfg.prefix);
  for (const { abs, text } of docSet.files) {
    const fromDir = toPosix(path.relative(root, path.dirname(abs)));
    const seen = new Set();
    const report = (message) => {
      if (!seen.has(message)) err(abs, message);
      seen.add(message);
    };
    splitLines(text).forEach((l, i) => {
      for (const m of l.matchAll(ids)) {
        report(msg(lang, 'line {line}: task id {token} — documentation outlives the task record; write the contract, the rationale, or the measurement itself with its version and date', { line: i + 1, token: m[0] }));
      }
      if (!origin) return;
      for (const m of l.matchAll(URL_IN_TEXT)) {
        if (!urlTargets(m[0], origin, prefix, refs).some(tracker)) continue;
        report(msg(lang, 'line {line}: tracker URL {token} into this repository — documentation outlives the task record; write the contract, the rationale, or the measurement itself with its version and date', { line: i + 1, token: m[0] }));
      }
    });
    const links = localLinks(text);
    for (const { href, line } of links) {
      if (!tracker(normalizeHrefTarget(fromDir, splitHref(href).target, prefix))) continue;
      report(msg(lang, 'line {line}: tracker link {token} — documentation outlives the task record; write the contract, the rationale, or the measurement itself with its version and date', { line, token: href }));
    }
  }
}

// The rendered operating rules of backlog/ and archive/ stay in the tree: a link to them is fine.
const TRACKER_RULES = 'README.md';

// A predicate on a project-relative path: inside backlog/ or archive/, the rules pair excepted.
function trackerPath(root, dirs) {
  const trees = [dirs.backlog, dirs.archive].map((d) => toPosix(path.relative(root, d)));
  const rules = new Set(trees.map((t) => `${t}/${TRACKER_RULES}`));
  return (target) => target !== null && !rules.has(target) && trees.some((t) => target === t || target.startsWith(`${t}/`));
}

// The origin remote as { host, repo } (lowercase, no `.git`), from the https or the scp form.
function originRepo(root) {
  const r = git(root, ['remote', 'get-url', 'origin']);
  const url = r.status === 0 ? r.stdout.trim() : '';
  let m = url.match(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?([^/:]+)(?::\d+)?\/(.+)$/i);
  if (!m) m = url.match(/^(?:[^@/]+@)?([^:/]+):(?!\/)(.+)$/);
  if (!m) return null;
  return { host: m[1].toLowerCase(), repo: m[2].replace(/\/+$/, '').replace(/\.git$/i, '').toLowerCase() };
}

// Project-relative paths a same-repository blob or tree URL may name: the split after a local ref
// or a sha, else every split. GitHub /<owner>/<repo>/(blob|tree)/<ref>/…, GitLab with `/-/`.
function urlTargets(raw, origin, prefix, refs) {
  let rest;
  try {
    const url = new URL(raw);
    if (url.hostname.toLowerCase() !== origin.host) return [];
    rest = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  } catch {
    return [];
  }
  if (!rest.toLowerCase().startsWith(`${origin.repo}/`)) return [];
  const m = rest.slice(origin.repo.length + 1).match(/^(?:-\/)?(?:blob|tree)\/(.+)$/);
  if (!m) return [];
  const parts = m[1].split('/');
  const splits = parts.slice(1).map((_, i) => ({ ref: parts.slice(0, i + 1).join('/'), repoRel: parts.slice(i + 1).join('/') }));
  const known = splits.filter(({ ref }) => refs.has(ref) || /^[0-9a-f]{7,40}$/i.test(ref));
  return (known.length ? known : splits).map(({ repoRel }) => repoRel)
    .filter((repoRel) => repoRel.startsWith(prefix)).map((repoRel) => repoRel.slice(prefix.length));
}

// Branch, remote-branch and tag names as a URL spells them; empty when git cannot list them.
function refNames(root) {
  const r = git(root, ['for-each-ref', '--format=%(refname)']);
  if (r.status !== 0) return new Set();
  return new Set(r.stdout.split('\n').filter(Boolean).map((n) => n.replace(/^refs\/(?:heads|tags|remotes\/[^/]+)\//, '')));
}

// 7. CHANGELOG: an entry title repeated within a section is a revision of one entry, not two.
function lintChangelog(root, err, lang) {
  const file = path.join(root, 'CHANGELOG.md');
  if (!existsSync(file)) return;
  const seen = new Map();
  let section = msg(lang, '(before the first section)');
  splitLines(blankFences(readText(file))).forEach((line, i) => {
    if (/^## /.test(line)) {
      seen.clear();
      section = line.slice(3).trim() || msg(lang, '(untitled)', { of: 'entry' });
      return;
    }
    const title = entryTitle(line);
    if (title === null) return;
    const prev = seen.get(title);
    if (prev !== undefined) {
      err(file, msg(lang, 'line {line}: entry title “{title}” already exists in section “{section}” (line {prev}) — keep one revision', { line: i + 1, title, section, prev }));
    } else {
      seen.set(title, i + 1);
    }
  });
}

// 8. Each ADR has a unique number, a link from docs/README.md, at most one table row there, a
// current status and no [TODO] line (docs/reference/03-lint.md, gate 8).
function lintAdrIndex({ root, cfg, dirs }, err, prefix) {
  const adrs = scanAdrs(dirs.adr);
  const byNumber = new Map();
  for (const a of adrs) {
    const prev = byNumber.get(a.number);
    if (prev) err(a.file, msg(cfg.lang, 'ADR number {number} is already used by {name}', { number: a.number, name: prev.name }));
    else byNumber.set(a.number, a);
  }
  if (existsSync(dirs.adr) && !statOrNull(dirs.adr)?.isDirectory()) err(dirs.adr, msg(cfg.lang, 'a file, expected a directory'));
  // adr/ files with a name off the pattern get no number, and the gate would stay silent.
  if (statOrNull(dirs.adr)?.isDirectory()) {
    for (const e of readdirSync(dirs.adr, { withFileTypes: true })) {
      if (e.isFile() && e.name.toLowerCase().endsWith('.md') && e.name !== 'README.md' && !ADR_FILE_RE.test(e.name)) {
        err(path.join(dirs.adr, e.name), msg(cfg.lang, 'name does not match adr-NNN-<slug>.md'));
      }
    }
  }
  for (const a of adrs) {
    splitLines(blankFences(readText(a.file))).forEach((line, i) => {
      if (isPlaceholderLine(line)) err(a.file, msg(cfg.lang, 'line {line}: the [TODO] placeholder remains', { line: i + 1 }));
    });
  }
  if (!adrs.length) return;
  const statuses = new Map(adrs.map((a) => [toPosix(path.relative(root, a.file)), adrStatus(a, cfg.lang, err)]));
  if (!existsSync(dirs.docsReadme)) {
    err(dirs.docsReadme, msg(cfg.lang, 'documentation index is missing while ADRs exist'));
    return;
  }
  const readmeDir = toPosix(path.relative(root, path.dirname(dirs.docsReadme)));
  const linked = new Set(relativeLinks(readText(dirs.docsReadme))
    .map((href) => normalizeHrefTarget(readmeDir, splitHref(href).target, prefix)));
  for (const a of adrs) {
    if (!linked.has(toPosix(path.relative(root, a.file)))) err(a.file, msg(cfg.lang, 'not linked from {readme} — the ADR index is maintained manually', { readme: path.basename(dirs.docsReadme) }));
  }
  lintAdrRows(root, dirs.docsReadme, statuses, cfg.lang, err, prefix);
}

// Both layers write the English label; a Russian project may write the label of its index column.
const ADR_STATUS_LABELS = ['Status', msg('ru', 'Status')];
const ADR_STATUSES = ['Proposed', 'Accepted'];
const ADR_STATUS_LINE = new RegExp(`^\\s*(?:[-*+]\\s+)?\\*\\*(?:${ADR_STATUS_LABELS.join('|')}):\\*\\*\\s*(.*)$`);
const NAMES_ADR = /\badr-(\d+)/gi;

// The status word of an ADR, or null after an error: no status line, a replaced status, a chain.
function adrStatus(adr, lang, err) {
  const lines = splitLines(blankFences(readText(adr.file)));
  const i = lines.findIndex((l) => ADR_STATUS_LINE.test(l));
  if (i === -1) {
    err(adr.file, msg(lang, 'no status line — an ADR states “**Status:** Proposed” or “**Status:** Accepted”'));
    return null;
  }
  const text = lines[i].trim();
  const word = lines[i].match(ADR_STATUS_LINE)[1].match(/^\p{L}+/u)?.[0] ?? '';
  const fold = msg(lang, 'fold the decision into the ADR that governs the question now, then delete the replaced file');
  if (!ADR_STATUSES.includes(word)) {
    err(adr.file, msg(lang, 'line {line}: “{text}” — an ADR holds a current decision, Proposed or Accepted; {fold}', { line: i + 1, text, fold }));
    return null;
  }
  if ([...text.matchAll(NAMES_ADR)].some((m) => Number(m[1]) !== adr.number)) {
    err(adr.file, msg(lang, 'line {line}: “{text}” names another ADR, which marks a chain; {fold}', { line: i + 1, text, fold }));
    return null;
  }
  return word;
}

// Table rows of the index that link an ADR: one row per ADR, and a Status cell equal to its file.
function lintAdrRows(root, readme, statuses, lang, err, prefix) {
  const lines = splitLines(readText(readme));
  const readmeDir = toPosix(path.relative(root, path.dirname(readme)));
  const isRow = (n) => (lines[n - 1] ?? '').trimStart().startsWith('|');
  const rowOf = new Map();
  for (const { href, line } of localLinks(readText(readme))) {
    const adr = normalizeHrefTarget(readmeDir, splitHref(href).target, prefix);
    if (!statuses.has(adr) || !isRow(line)) continue;
    const prev = rowOf.get(adr);
    if (prev === undefined) {
      rowOf.set(adr, line);
      const status = statuses.get(adr);
      let header = line;
      while (isRow(header - 1)) header -= 1;
      const column = tableCells(lines[header - 1]).findIndex((c) => ADR_STATUS_LABELS.includes(c.replaceAll('*', '')));
      const cell = column === -1 ? undefined : tableCells(lines[line - 1])[column];
      if (status && cell !== undefined && cell !== status) {
        err(readme, msg(lang, 'line {line}: the Status cell “{cell}” of {adr} differs from its status line “{status}” — write the word of the file', { line, cell, adr, status }));
      }
    } else if (prev !== line) {
      err(readme, msg(lang, 'line {line}: {adr} is listed again (first at line {prev}) — keep one row per ADR', { line, adr, prev }));
    }
  }
}

// GFM cells: an unescaped pipe separates them, the outer pipes are optional.
function tableCells(line) {
  return line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim());
}

// 9. A finding in triage/ whose task is closed, and a Parent that names another number than the
// file name: warnings, not failures. A finding in queue/ or active/ is already triaged.
function lintClosedParent({ cfg }, tasks, note) {
  for (const t of tasks) {
    if (t.status === 'archive') continue;
    const named = getField(readText(t.file), FIELD_PARENT)?.match(idMentionRe(cfg.prefix))?.[0];
    if (named === undefined || matchId(named, cfg.prefix).num === t.num) continue;
    note(t.file, msg(cfg.lang,
      '“{field}” names {named}, but the file name has the number {number} — fix the field or the file name', { field: fieldName(FIELD_PARENT, cfg.lang), named, number: formatId(cfg.prefix, t.num) }));
  }
  for (const t of tasks) {
    if (t.sub === null || t.status !== 'triage') continue;
    const parent = tasks.find((p) => p.num === t.num && p.sub === null);
    if (!parent || parent.status !== 'archive') continue;
    note(t.file, msg(cfg.lang,
      'finding {id} sits in triage/ while task {parentId} is closed — triage it (approver)', { id: t.id, parentId: parent.id }));
  }
}

// 10. A quote of a live file: a block `<!-- quote:<path> -->…<!-- /quote -->` must be found in the
// named file; `docs/archive/` is a snapshot and is not checked (03-lint.md, gate 10).
function lintQuotes({ root, cfg, dirs }, err) {
  const docs = mdFiles(dirs.docs, '');
  const files = [...docs.filter(([rel]) => !rel.startsWith('archive/')), ...rootMarkdown(root, docs)];
  for (const [, abs] of notLinkedOut(files, { root, cfg, dirs })) {
    const text = readText(abs);
    for (const block of quoteBlocks(text)) {
      if (block.stray !== undefined) {
        err(abs, msg(cfg.lang, 'line {line}: “/quote” closes no quote block', { line: block.stray + 1 }));
        continue;
      }
      if (block.malformed !== undefined) {
        err(abs, msg(cfg.lang, 'line {line}: the quote marker does not parse', { line: block.malformed + 1 }));
        continue;
      }
      if (block.body === null) {
        err(abs, msg(cfg.lang, 'quote block “quote:{href}” is not closed by “/quote”', { href: block.href }));
        continue;
      }
      const target = block.href.startsWith('/')
        ? path.join(root, block.href)
        : path.resolve(path.dirname(abs), block.href);
      if (!statOrNull(target)?.isFile()) {
        err(abs, msg(cfg.lang, 'quote points at a missing file {href}', { href: block.href }));
      } else if (!block.before && !quoted(block.body, readText(target))) {
        err(abs, msg(cfg.lang, 'quote no longer matches {href}: “{first}”', { href: block.href, first: quoteLines(block.body)[0] ?? '' }));
      }
    }
  }
}

// Quote markers are read with code blanked, bodies from raw lines. An unclosed block has body null;
// a marker line alone that does not parse, or a closer with no block, is `malformed` or `stray`.
function quoteBlocks(text) {
  const raw = splitLines(text);
  const clean = splitLines(blankCode(text));
  const out = [];
  let open = null;
  for (let i = 0; i < clean.length; i += 1) {
    const m = clean[i].match(QUOTE_OPEN);
    if (m) {
      // A second opening marker ends the previous block with an error, not a silent overwrite.
      if (open) out.push({ href: open.href, before: open.before, body: null });
      open = { href: m[2], before: m[1] === 'before', at: i };
      continue;
    }
    if (QUOTE_CLOSE.test(clean[i])) {
      if (open) out.push({ href: open.href, before: open.before, body: raw.slice(open.at + 1, i) });
      else out.push({ stray: i });
      open = null;
      continue;
    }
    if (QUOTE_MARKER.test(clean[i])) out.push({ malformed: i });
  }
  if (open) out.push({ href: open.href, before: open.before, body: null });
  return out;
}

// The lines of a quote: whitespace at the line edges is trimmed, blank edges and a fence wrapping
// the quote are dropped, fences inside stay (03-lint.md, gate 10).
function quoteLines(body) {
  const needle = body.map((l) => l.trim());
  while (needle.length && !needle[0]) needle.shift();
  while (needle.length && !needle[needle.length - 1]) needle.pop();
  if (needle.length >= 2 && FENCE_LINE.test(needle[0]) && FENCE_LINE.test(needle[needle.length - 1])) {
    needle.shift();
    needle.pop();
  }
  return needle;
}

// A quote is a contiguous piece of the file.
function quoted(body, fileText) {
  const needle = quoteLines(body);
  if (!needle.length) return true;
  const hay = splitLines(fileText).map((l) => l.trim());
  for (let i = 0; i + needle.length <= hay.length; i += 1) {
    if (needle.every((line, k) => hay[i + k] === line)) return true;
  }
  return false;
}

export async function run(argv, { cwd, lang }) {
  parseCommandArgs(argv, {}, { positionals: 0, lang });
  const project = loadProject(cwd);
  const report = wordUnreadable(project.root, project.cfg.lang, msg(project.cfg.lang, 'lint cannot walk it'), () => lintProject(project));
  const { errors, warnings, read, notes } = report;
  for (const p of errors) bad(`${p.file}: ${p.msg}`);
  for (const w of warnings) warn(`${w.file}: ${w.msg}`);
  for (const n of notes) info(n);
  info(msg(project.cfg.lang,
    'gate 1: files {files}, links {links}, local {local}, anchors checked {anchors}', { files: read.files, links: read.links, local: read.local, anchors: read.anchors }));
  const tail = warnings.length ? msg(project.cfg.lang, ', warnings {warnings}', { warnings: warnings.length }) : '';
  if (errors.length) {
    bad(msg(project.cfg.lang, 'lint: errors {errors}{tail}', { errors: errors.length, tail }));
    return 1;
  }
  ok(msg(project.cfg.lang, 'lint: no errors{tail}', { tail }));
  return 0;
}
