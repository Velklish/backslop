// The runner of the `gates` field: commands in order, the command's own exit code, a tree snapshot
// last. The tool reports facts; whether red is a defect or dirt legitimate, the agent decides.
import { CONFIG_FILE, gateEntry, loadProject } from './config.js';
import {
  CliError, bad, escapeRe, git, gitCause, info, insideRepo, ok, parseCommandArgs, porcelainPaths, printJson, runShell, shellOutcome, shellPassed, showPrefix,
} from './util.js';
import { msg } from './i18n.js';

// A gate on a tree unequal to the commit proves nothing about the commit. No git, no snapshot
// (`null`); `head: null` is a repository without commits: cleanliness shows, nothing to name.
function treeSnapshot(root, prefix) {
  const status = git(root, ['status', '--porcelain', '--', '.']);
  if (status.status !== 0) return null;
  const head = git(root, ['rev-parse', 'HEAD']);
  const lines = status.stdout.replace(/\n$/, '').split('\n');
  return {
    head: head.status === 0 ? head.stdout.trim() : null,
    clean: status.stdout === '',
    dirty: lines.map((l) => porcelainInProject(l, prefix)).join('\n'),
  };
}

// A porcelain v1 path is bare or C-quoted by git (`"pkg/a b.md"`, octal for non-ASCII bytes).
const PORCELAIN_PATH = String.raw`"(?:[^"\\]|\\.)*"|[^ ]+`;
const PORCELAIN_LINE = new RegExp(`^(.. )(${PORCELAIN_PATH})(?: -> (${PORCELAIN_PATH}))?$`);

function cQuoted(text) {
  return [...Buffer.from(text)].map((b) => (b === 0x22 || b === 0x5c ? `\\${String.fromCharCode(b)}`
    : b < 0x20 || b >= 0x7f ? `\\${b.toString(8).padStart(3, '0')}` : String.fromCharCode(b))).join('');
}

function porcelainInProject(line, prefix) {
  const m = line.match(PORCELAIN_LINE);
  if (!m) return line;
  const strip = (p) => {
    if (p === prefix || p === `"${prefix}"` || p === `"${cQuoted(prefix)}"`) return './';
    if (p.startsWith(prefix)) return p.slice(prefix.length);
    const q = [prefix, cQuoted(prefix)].find((x) => p.startsWith(`"${x}`));
    if (q === undefined) return p;
    const rest = p.slice(q.length + 1, -1);
    // Git quotes a path only for a space or an escape; a prefix may have been the only reason.
    return /[\\ ]/.test(rest) ? `"${rest}"` : rest;
  };
  return `${m[1]}${strip(m[2])}${m[3] === undefined ? '' : ` -> ${strip(m[3])}`}`;
}

// A `when` pattern is matched against the whole path: `*` and `?` do not cross `/`, `**` does, and
// `**/` at the start of a segment also means "zero segments" (ADR-045).
export function globToRe(pattern) {
  let re = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') {
      i += 1;
      if (pattern[i + 1] === '/' && (i === 1 || pattern[i - 2] === '/')) {
        i += 1;
        re += '(?:.*/)?';
      } else re += '.*';
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += escapeRe(c);
  }
  return new RegExp(`^${re}$`);
}

// The dropped count tells "the base gave no diff" from "the diff is entirely outside the project":
// the moves differ.
function toProjectPaths(paths, prefix) {
  if (!prefix) return { paths, dropped: 0 };
  const inside = paths.filter((p) => p.startsWith(prefix));
  return { paths: inside.map((p) => p.slice(prefix.length)), dropped: paths.length - inside.length };
}

// The diff to the base. `--no-renames` gives both sides of a rename as separate entries, as for a
// dirty tree. `diff.relative=false`: a user's `diff.relative` would make paths cwd-relative.
function basePaths(root, base, lang) {
  const r = git(root, ['-c', 'diff.relative=false', 'diff', '--name-only', '-z', '--no-renames', `${base}..HEAD`]);
  if (r.status !== 0) {
    const why = gitCause(r, lang);
    throw new CliError(msg(lang, '--base {base}: git diff failed — {why}', { base, why }));
  }
  return r.stdout.split('\0').filter((p) => p !== '');
}

// Without `--base` the set is the dirty tree, with it the diff to the base plus the dirty tree;
// without git there is no set and everything runs. The report prints how it was counted (ADR-045).
function changedPaths(root, base, prefix, lang) {
  // Both names of a rename count: the scope a file left is touched too (ADR-045).
  const dirty = porcelainPaths(root);
  if (dirty === null) {
    if (base !== undefined) {
      throw new CliError(msg(lang,
        '--base {base}: git did not report the tree state, so the path set cannot be computed', { base }));
    }
    return null;
  }
  // Deduplication before the filter: otherwise a path in both the diff and the dirty tree would
  // count as dropped twice.
  const fromBase = base === undefined ? [] : [...new Set(basePaths(root, base, lang))];
  const raw = [...new Set([...fromBase, ...dirty])];
  const { paths, dropped } = toProjectPaths(raw, prefix);
  // Neighbour dirt is not this project's business: only a base diff dropped outside counts as one.
  const baseDropped = toProjectPaths(fromBase, prefix).dropped;
  return {
    scope: { source: base === undefined ? 'worktree' : 'base+worktree', base: base ?? null, prefix, dropped, paths: paths.sort() },
    baseDropped,
  };
}

function scopeLine(scope, lang) {
  const how = scope.base === null
    ? 'git status --porcelain'
    : `git diff --name-only ${scope.base}..HEAD ${msg(lang, 'plus')} git status --porcelain`;
  // The prefix is named aloud, or a monorepo hides that the set is narrowed to the project. So is
  // what was dropped: an empty set beside a non-empty diff would read as "nothing touched".
  const from = scope.prefix ? msg(lang, ', paths relative to the project root ({prefix})', { prefix: scope.prefix }) : '';
  const out = scope.dropped ? msg(lang, ', {dropped} dropped outside the project', { dropped: scope.dropped }) : '';
  return msg(lang, 'scope: {how}{from}, paths {paths}{out}', { how, from, paths: scope.paths.length, out });
}

// A skip is named by a reason, not by silence: a line without a reason reads as coverage that never
// was. No scope or no set: the command runs as it ran before the form existed.
function skipReason(gate, scope, lang) {
  if (gate.when === null || scope === null) return null;
  const res = gate.when.map(globToRe);
  if (scope.paths.some((p) => res.some((re) => re.test(p)))) return null;
  return msg(lang,
    'skipped: the scope is untouched ({when}), {paths} paths in the set', { when: gate.when.join(', '), paths: scope.paths.length });
}

export async function run(argv, { cwd, lang }) {
  const { values } = parseCommandArgs(argv, {
    'keep-going': { type: 'boolean' },
    'require-clean': { type: 'boolean' },
    'dry-run': { type: 'boolean' },
    json: { type: 'boolean' },
    base: { type: 'string' },
  }, { positionals: 0, lang });
  const keepGoing = values['keep-going'] === true;
  const dry = values['dry-run'] === true;
  const asJson = values.json === true;

  const { root, cfg } = loadProject(cwd);
  const gates = cfg.gates.map(gateEntry);
  if (!cfg.gates.length) {
    throw new CliError(msg(cfg.lang,
      '{config}: the gates list is empty — there is nothing to run', { config: CONFIG_FILE }));
  }

  if (dry && values['require-clean'] === true) {
    throw new CliError(msg(cfg.lang,
      '--dry-run and --require-clean make no sense together: the list is printed without running any gate'));
  }
  if (dry && values.base !== undefined) {
    throw new CliError(msg(cfg.lang,
      '--dry-run and --base make no sense together: the whole list is printed and no scope is computed'));
  }
  // An empty `--base` is an unset `$BASE`, not a default base: quietly it would count the dirty
  // tree alone while the report claims a base (ADR-045).
  if (values.base !== undefined && !values.base.trim()) {
    throw new CliError(msg(cfg.lang,
      '--base is empty: name a ref or drop the flag — an empty base would count the dirty tree alone and call it a diff'));
  }

  // The list prints whole: `--dry-run` answers "what is configured", not "what would run now". A
  // scope is visible beside its command, so there is no point in counting a path set.
  if (dry) {
    const report = { gates: gates.map(({ command, when }) => ({ command, when })), total: gates.length, dryRun: true };
    if (asJson) printJson(report);
    else {
      for (const gate of gates) info(gate.when ? `${gate.command} — ${msg(cfg.lang, 'scope')}: ${gate.when.join(', ')}` : gate.command);
      ok(msg(cfg.lang, 'gates {gates}, nothing was run (--dry-run)', { gates: gates.length }));
    }
    return 0;
  }

  // git paths start at the repository root, `when` globs at `backslop.json` (ADR-045). Resolved
  // before the first command: a refusal after the gates ran would replace their report.
  const prefix = insideRepo(root, cfg.lang) ? showPrefix(root, cfg.lang) : '';

  if (values['require-clean'] === true) {
    const before = treeSnapshot(root, prefix);
    if (before === null) {
      throw new CliError(msg(cfg.lang,
        '--require-clean: there is no git repository, so tree cleanliness cannot be checked'));
    }
    if (!before.clean) {
      throw new CliError(msg(cfg.lang,
        '--require-clean: the tree is dirty, no gate was run:\n{dirty}', { dirty: before.dirty }));
    }
  }

  // The set is counted only when at least one scope reads it or an explicit `--base` asks for it.
  const counted = gates.some((g) => g.when !== null) || values.base !== undefined
    ? changedPaths(root, values.base, prefix, cfg.lang)
    : null;
  const scope = counted?.scope ?? null;
  if (!asJson && scope !== null) info(scopeLine(scope, cfg.lang));

  // An empty set at acceptance is refused by the set, not by flags (even `--base HEAD`). The raw
  // base diff separates them: a neighbouring monorepo package is an honest skip (ADR-045).
  if (values['require-clean'] === true && scope !== null && !scope.paths.length && !counted.baseDropped && gates.some((g) => g.when !== null)) {
    throw new CliError(values.base === undefined
      ? msg(cfg.lang,
        '--require-clean without --base: on a clean tree the changed path set is empty, so every scoped entry would be skipped. Name the base: --base <ref>')
      : msg(cfg.lang,
        '--require-clean --base {base}: the changed path set is empty — the base yielded no diff, so every scoped entry would be skipped. Name the base the branch diverged from', { base: values.base }));
  }

  const results = [];
  for (const gate of gates) {
    const skip = skipReason(gate, scope, cfg.lang);
    if (skip !== null) {
      results.push({ command: gate.command, when: gate.when, skipped: skip });
      if (!asJson) info(`${gate.command} — ${skip}`);
      continue;
    }
    // A tool failure is not called a red gate (ADR-045); the report keeps the fields it always had.
    const shell = runShell(gate.command, { cwd: root, quiet: asJson });
    const { command, code, signal, error, ms } = shell;
    const result = { command, code, signal, error, ms, when: gate.when };
    results.push(result);
    if (!asJson) {
      const line = `${gate.command} — ${shellOutcome(shell, cfg.lang)}, ${result.ms} ms`;
      if (shellPassed(result)) ok(line);
      else bad(line);
    }
    if (!shellPassed(result) && !keepGoing) break;
  }

  // What scope skips never adds to the green count and never reddens the total: only a red gate
  // makes the run red. Gates not reached after a red one are counted where they were before.
  const green = results.filter(shellPassed).length;
  const outOfScope = results.filter((r) => r.skipped !== undefined).length;
  const skipped = outOfScope + (gates.length - results.length);
  const failed = results.some((r) => r.skipped === undefined && !shellPassed(r));
  const tree = treeSnapshot(root, prefix);
  if (asJson) {
    printJson({ gates: results, total: gates.length, green, skipped, outOfScope, scope, tree });
  } else {
    const tail = skipped ? msg(cfg.lang, ', not run {skipped}', { skipped }) : '';
    const why = outOfScope ? msg(cfg.lang, ' (out of scope {outOfScope})', { outOfScope }) : '';
    const line = msg(cfg.lang, 'gates {gates}, green {green}{tail}{why}', { gates: gates.length, green, tail, why });
    if (failed) bad(line);
    else ok(line);
    if (tree === null) info(msg(cfg.lang, 'tree: no git repository, no snapshot'));
    else info(msg(cfg.lang, 'tree: {head}, {state}', { head: tree.head ?? msg(cfg.lang, 'no commits yet'), state: tree.clean ? msg(cfg.lang, 'clean') : msg(cfg.lang, 'dirty') }));
  }
  return failed ? 1 : 0;
}
