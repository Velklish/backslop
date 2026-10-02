// The seeding mechanics: candidates for `gates` and for subsystems, creating the "Reference: …"
// tasks. The command lists findings with evidence; the agent and the owner decide what is real.
import { closeSync, existsSync, openSync, readSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { loadProject } from './config.js';
import { EXTERNAL, linksOf, normalizeHrefTarget, repoPrefix, splitHref } from './links.js';
import { SKIP_DIRS, SKIP_RELS } from './mdwalk.js';
import { FIELD_AREA, SLUG_RE, createTask, getField, scanTasks, setField } from './tasks.js';
import {
  CliError, info, isFileAt, ok, parseCommandArgs, printJson, readJsonOrNull, readText, realpathOrNull, statOrNull, toPosix, warn, worktrees, writeText,
} from './util.js';
import { msg } from './i18n.js';
import { splitLines } from './text.js';

// Target names that in projects mean a check or a build, not an artifact built for sale.
const GATE_NAME = /^(test|tests|lint|check|build|typecheck|type-check|fmt|format)$/;
const MAKE_TARGET = /^([A-Za-z0-9][\w.-]*):(?!=)/;
const PY_TOOLS = ['pytest', 'ruff', 'mypy'];
// Directories that hold subsystems in other people's layouts.
const SUBSYSTEM_DIRS = ['src', 'services', 'apps', 'packages'];
const ENTRY_POINTS = new Set(['Program.cs', 'index.ts', 'index.js', 'main.go', 'main.py', 'main.ts', 'main.rs']);
const BIN_SCRIPT = /^[\w.-]+\.(?:js|mjs|cjs|ts|sh|py|rb)$/;
const BIN_BARE = /^[\w-]+$/;
const BLOCK_SCALAR = /^[|>](?:[+-]?\d?|\d?[+-]?)$/;
// Characters sh and cmd.exe take literally; another one gets the path double-quoted, and one that
// double quotes do not stop in either shell gets no command at all.
const SHELL_SAFE = /^[\w./@+,:=-]+$/;
const UNQUOTABLE = /["$`\\%]/;
// Build output and environments. The markdown walk's `SKIP_DIRS` does not know them, and here each
// would yield a "subsystem" and a gate from foreign code; a list of its own leaves mdwalk alone.
const SKIP_BUILD = new Set(['.venv', 'venv', 'vendor', 'dist', 'build', 'out', 'target', 'obj', 'bin', 'coverage', '.tox', '__pycache__']);

export async function run(argv, { cwd, lang }) {
  const { values } = parseCommandArgs(argv, {
    scan: { type: 'boolean' },
    json: { type: 'boolean' },
    'queue-reference': { type: 'boolean' },
  }, { positionals: 0, lang });
  const project = loadProject(cwd);
  const { cfg } = project;
  const scan = values.scan === true;
  const queue = values['queue-reference'] === true;
  if (scan === queue) {
    throw new CliError(msg(cfg.lang,
      'exactly one mode is required: {cli} seed --scan [--json] | --queue-reference', { cli: cfg.cli }));
  }
  if (queue && values.json === true) {
    throw new CliError(msg(cfg.lang,
      '--json belongs to --scan only: --queue-reference creates files rather than printing a list'));
  }
  return scan ? runScan(project, values.json === true) : runQueueReference(project);
}

// --- inventory ------------------------------------------------------------------------------

function runScan({ root, cfg }, asJson) {
  const gates = scanGates(root, cfg.lang);
  const subsystems = scanSubsystems(root, cfg.lang);
  if (asJson) {
    printJson({ gates, subsystems, total: subsystems.length });
    return 0;
  }
  ok(msg(cfg.lang, 'gate candidates {gates}, subsystem candidates {subsystems}', { gates: gates.length, subsystems: subsystems.length }));
  info(msg(cfg.lang, 'gate candidates (selection is yours: no secrets, network, or database):'));
  for (const g of gates) info(`  ${g.command} — ${g.evidence}`);
  info(msg(cfg.lang, 'subsystem candidates (which are real is for the agent and owner to decide):'));
  for (const s of subsystems) info(`  ${s.name} — ${s.evidence}`);
  return 0;
}

function scanGates(root, lang) {
  const out = [];
  const seen = new Set();
  const add = (command, evidence) => {
    const key = `${command}\u0000${evidence}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ command, evidence });
  };

  const pkg = readJsonOrNull(path.join(root, 'package.json'));
  for (const name of Object.keys(pkg?.scripts ?? {})) {
    if (GATE_NAME.test(name)) add(`npm run ${name}`, `package.json → scripts.${name}`);
  }

  for (const [file, runner] of [['Makefile', 'make'], ['makefile', 'make'], ['justfile', 'just']]) {
    for (const [line, text] of numberedLines(root, file)) {
      const m = text.match(MAKE_TARGET);
      if (m && GATE_NAME.test(m[1])) add(`${runner} ${m[1]}`, `${file}:${line}`);
    }
  }
  for (const file of ['Taskfile.yml', 'Taskfile.yaml']) {
    let inTasks = false;
    for (const [line, text] of numberedLines(root, file)) {
      if (/^tasks:\s*$/.test(text)) { inTasks = true; continue; }
      if (inTasks && /^\S/.test(text)) inTasks = false;
      const m = inTasks && text.match(/^ {2}([A-Za-z0-9][\w.-]*):\s*$/);
      if (m && GATE_NAME.test(m[1])) add(`task ${m[1]}`, `${file}:${line}`);
    }
  }

  for (const rel of walk(root, '.github/workflows', ['.yml', '.yaml'], lang)) {
    for (const [line, command] of ciCommands(root, rel, /^\s*(?:- )?run:\s*(.*)$/)) add(command, `${rel}:${line}`);
  }
  for (const file of ['.gitlab-ci.yml', '.gitlab-ci.yaml']) {
    for (const [line, command] of ciCommands(root, file, /^\s*(?:script|before_script):\s*(.*)$/)) add(command, `${file}:${line}`);
  }

  for (const rel of walk(root, '', ['.csproj', '.sln'], lang)) {
    if (UNQUOTABLE.test(rel)) {
      warn(msg(lang,
        '{rel}: the path holds ", $, `, \\ or % — no dotnet command offered, quote the path by hand', { rel }));
      continue;
    }
    add(`dotnet build ${shellQuote(rel)}`, rel);
    add(`dotnet test ${shellQuote(rel)}`, rel);
  }
  for (const file of ['pyproject.toml', 'setup.cfg', 'tox.ini']) {
    for (const [line, text] of numberedLines(root, file)) {
      for (const tool of PY_TOOLS) if (text.includes(tool)) add(tool, `${file}:${line}`);
    }
  }
  return out;
}

// CI commands: a value on the same line or a block below by indent (`run: |`). The YAML is not
// parsed whole: lines are taken, and a person decides anyway.
function ciCommands(root, rel, head) {
  const out = [];
  const lines = numberedLines(root, rel);
  for (let i = 0; i < lines.length; i += 1) {
    const [line, text] = lines[i];
    const m = text.match(head);
    if (!m) continue;
    const inline = m[1].trim();
    if (inline && !BLOCK_SCALAR.test(inline)) {
      if (!inline.startsWith('-')) out.push([line, inline]);
      continue;
    }
    const indent = text.match(/^\s*/)[0].length;
    for (let k = i + 1; k < lines.length; k += 1) {
      const [nextLine, nextText] = lines[k];
      if (!nextText.trim()) continue;
      if (nextText.match(/^\s*/)[0].length <= indent) break;
      out.push([nextLine, nextText.replace(/^\s*(?:- )?/, '').trim()]);
    }
  }
  return out;
}

function scanSubsystems(root, lang) {
  const out = [];
  const seen = new Set();
  const add = (name, evidence) => {
    if (seen.has(evidence)) return;
    seen.add(evidence);
    out.push({ name, evidence });
  };
  for (const dir of SUBSYSTEM_DIRS) {
    const abs = path.join(root, dir);
    if (!isDir(abs)) continue;
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      if (e.isDirectory() && !e.name.startsWith('.')) add(e.name, `${dir}/${e.name}`);
    }
  }
  for (const rel of walk(root, '', ['.csproj'], lang)) add(path.basename(rel, '.csproj'), rel);
  for (const rel of walk(root, '', ['.cs', '.ts', '.js', '.go', '.py', '.rs'], lang)) {
    const dir = path.posix.dirname(rel);
    if (ENTRY_POINTS.has(path.posix.basename(rel))) add(dir === '.' ? path.posix.basename(rel) : dir, rel);
  }
  // `bin/` is both a CLI entry point and .NET build output: only the scripts themselves are taken;
  // `Debug/`, `Release/` and `.dll` beside them do not count as subsystems.
  const bin = path.join(root, 'bin');
  if (isDir(bin)) {
    for (const e of readdirSync(bin, { withFileTypes: true })) {
      if (e.isFile() && isBinScript(bin, e.name)) add(`bin/${e.name}`, `bin/${e.name}`);
    }
  }
  return out;
}

// --- queue seeding --------------------------------------------------------------------------

// A row of the reference table: the slug comes from the file name of the row's first link, not
// from the heading: the file name is already Latin, and no transliteration is needed.
const TABLE_ROW = /^\s*\|/;

async function runQueueReference(project) {
  const { cfg, dirs } = project;
  const index = path.join(dirs.reference, 'README.md');
  if (!existsSync(index)) {
    throw new CliError(msg(cfg.lang,
      '{index} is missing — the agent writes the subsystem table, this command only reads it', { index: toPosix(path.relative(project.root, index)) }));
  }
  const refDir = toPosix(path.relative(project.root, dirs.reference));
  const prefix = repoPrefix(project.root, cfg.lang);
  const rows = [];
  const text = readText(index);
  const lines = splitLines(text);
  const first = new Map();
  for (const link of linksOf(text)) {
    if (link.text !== undefined && link.href && !first.has(link.line) && TABLE_ROW.test(lines[link.line - 1])) first.set(link.line, link);
  }
  for (const { text: label, href } of first.values()) {
    if (EXTERNAL.test(href)) continue;
    const { target } = splitHref(href);
    const rel = normalizeHrefTarget(refDir, target, prefix);
    if (rel !== null && existsSync(path.join(project.root, rel))) continue;
    rows.push({ label, href, rel: rel ?? target, base: `describe-${path.basename(target, '.md').toLowerCase()}` });
  }
  // A re-run creates no duplicates: a task with the slug is seeded unless every code span of its
  // Scope names another file (no span: the slug decides); a folded one, when its title matches.
  const taken = new Map(scanTasks(project).map((t) => [t.slug, t]));
  const scopeHrefs = (slug) => {
    const task = taken.get(slug);
    if (task.hrefs !== undefined) return task.hrefs;
    const area = !task.folded && existsSync(task.file) ? getField(readText(task.file), FIELD_AREA) : null;
    return area === null ? [] : [...area.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  };
  const titleOf = (label) => `${msg(cfg.lang, 'Reference')}: ${label}`;
  const nameOf = (task) => (task.folded ? task.id : task.rel);
  const seededFor = (slug, row) => {
    const task = taken.get(slug);
    if (task.folded) return [msg('ru', 'Reference'), 'Reference'].some((w) => task.log.title.trim() === `${w}: ${row.label.trim()}`);
    const hrefs = scopeHrefs(slug);
    return !hrefs.length || hrefs.some((h) => normalizeHrefTarget(refDir, splitHref(h).target, prefix) === row.rel);
  };
  const noSlug = (label, href) => warn(msg(cfg.lang, 'row “{label}”: {href} does not yield a slug — create the task by hand', { label, href }));
  let created = 0;
  let skipped = 0;
  for (const row of rows) {
    const { label, href, rel, base } = row;
    if (!SLUG_RE.test(base)) {
      noSlug(label, href);
      continue;
    }
    if (taken.has(base) && seededFor(base, row)) {
      skipped += 1;
      continue;
    }
    // Two different files with one basename: the task takes its parent directory into the slug.
    const other = rows.find((o) => o.base === base && o.rel !== rel);
    const owner = taken.get(base);
    let slug = base;
    if (other || owner) {
      slug = `describe-${path.posix.basename(path.posix.dirname(rel)).toLowerCase()}-${base.slice('describe-'.length)}`;
      if (!SLUG_RE.test(slug)) {
        noSlug(label, href);
        continue;
      }
      if (taken.has(slug)) {
        if (seededFor(slug, row)) {
          skipped += 1;
        } else {
          warn(msg(cfg.lang,
            'row “{label}”: slug {slug} is already taken by the task {task} — create the task for {href} by hand', { label, slug, task: nameOf(taken.get(slug)), href }));
        }
        continue;
      }
    }
    const { id, file, notes } = createTask(project, { slug, queue: true, title: titleOf(label) });
    ok(`${id}: ${toPosix(path.relative(project.root, file))}`);
    for (const note of notes) info(note);
    // The task's "Scope" is known: it is the section the task is created for. The `new` stub would
    // leave gate 4 red on every seeded task.
    const area = msg(cfg.lang,
      '[{label}](../../reference/README.md) — section `{href}` is not written yet', { label, href });
    writeText(file, setField(readText(file), FIELD_AREA, area, cfg.lang));
    taken.set(slug, { slug, file, rel: toPosix(path.relative(project.root, file)), hrefs: [href] });
    created += 1;
    if (other) {
      warn(msg(cfg.lang,
        'slug {base}: {href} and {otherHref} are different files; the task for {href} took slug {slug}', { base, href, otherHref: other.href, slug }));
    } else if (owner) {
      warn(msg(cfg.lang,
        'slug {base} is taken by the task {task} for another file; the task for {href} took slug {slug}', { base, task: nameOf(owner), href, slug }));
    }
  }
  ok(msg(cfg.lang,
    'seed --queue-reference: tasks created {created}, skipped as already seeded {skipped}', { created, skipped }));
  return 0;
}

// A walk over sources for the inventory: past service directories (`SKIP_DIRS`) and past build
// output and environments (`SKIP_BUILD`). Symlinks are not followed: the tree is read as is.
function walk(root, rel, exts, lang) {
  let linked = null;
  // A linked worktree of this repository is a copy of the tree; a submodule is not and is walked.
  const isLinkedWorktree = (abs) => {
    if (!isFileAt(path.join(abs, '.git'))) return false;
    linked ??= new Set(worktrees(root, lang).map((w) => realpathOrNull(w.path)));
    return linked.has(realpathOrNull(abs));
  };
  const out = [];
  const visit = (dir, dirRel) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const childRel = dirRel ? `${dirRel}/${e.name}` : e.name;
      if (SKIP_DIRS.has(e.name) || SKIP_BUILD.has(e.name) || e.name.startsWith('.git')) continue;
      if (SKIP_RELS.has(childRel)) continue;
      const child = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!isLinkedWorktree(child)) visit(child, childRel);
      } else if (e.isFile() && exts.some((x) => e.name.endsWith(x))) {
        out.push(childRel);
      }
    }
  };
  visit(rel ? path.join(root, ...rel.split('/')) : root, rel);
  return out;
}

// A script by its extension (dots in the stem allowed), or an extensionless file opening with `#!`.
function isBinScript(bin, name) {
  if (BIN_SCRIPT.test(name)) return true;
  if (!BIN_BARE.test(name)) return false;
  const buf = Buffer.alloc(2);
  let fd;
  try {
    fd = openSync(path.join(bin, name), 'r');
    return readSync(fd, buf, 0, 2, 0) === 2 && buf.toString('latin1') === '#!';
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function shellQuote(rel) {
  return SHELL_SAFE.test(rel) ? rel : `"${rel}"`;
}

// --- reading files --------------------------------------------------------------------------

function numberedLines(root, rel) {
  const abs = path.join(root, ...rel.split('/'));
  if (!isFileAt(abs)) return [];
  return splitLines(readText(abs)).map((text, i) => [i + 1, text]);
}

function isDir(p) {
  return statOrNull(p)?.isDirectory() === true;
}
