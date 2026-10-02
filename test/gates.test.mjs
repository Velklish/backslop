// The gates runner: the exit code comes from the command itself, not from the pipe, and the run
// order is visible in the output. The fixture: a project with two gates, the red one first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { cleanup, cli, escapeRe, gitAll, makeProject, put, read, ru, ruRe, run } from './helpers.mjs';
import { globToRe } from '../lib/gates.js';

const TALLY = 'gates {gates}, green {green}{tail}{why}';
const SCOPE_LINE = 'scope: {how}{from}, paths {paths}{out}';
const KILLED = 'killed by {signal}';
const NOT_RUN = ', not run {skipped}';
const DROPPED = ', {dropped} dropped outside the project';
const BASE_FAILED = '--base {base}: git diff failed — {why}';
const NO_BASE = '--require-clean without --base: on a clean tree the changed path set is empty, so every scoped entry would be skipped. Name the base: --base <ref>';
const EMPTY_SET = '--require-clean --base {base}: the changed path set is empty — the base yielded no diff, so every scoped entry would be skipped. Name the base the branch diverged from';
// A non-ASCII (Cyrillic) project directory: git quotes such paths in porcelain output.
const PKG = String.fromCodePoint(0x43f, 0x430, 0x43a, 0x435, 0x442);

function withGates(root, gates) {
  put(root, 'backslop.json', `${JSON.stringify({ ...JSON.parse(read(root, 'backslop.json')), gates }, null, 2)}\n`);
}

// A gate writes a mark to a file — it shows which ones reached a run. The path goes by an
// environment variable, not as a literal in `node -e`: a `\t` or `\r` in a path would be an escape.
const mark = (name, code) => `node -e "require('fs').appendFileSync(process.env.GATES_MARK,'${name}\\n');process.exit(${code})"`;
const marked = (root) => ({ env: { GATES_MARK: path.join(root, 'ran.txt') } });
const ran = (root) => {
  try { return read(root, 'ran.txt').trim().split('\n'); } catch { return []; }
};

test('gates: a red one first stops the run, --keep-going counts the rest', () => {
  const root = makeProject({ git: false });
  try {
    withGates(root, [mark('first', 1), mark('second', 0)]);
    let r = cli(root, ['gates'], marked(root));
    assert.equal(r.code, 1);
    assert.deepEqual(ran(root), ['first'], 'the second gate must not run without --keep-going');
    assert.match(r.err, ruRe(TALLY, { gates: 2, green: 0 }));
    assert.match(r.err, ruRe(NOT_RUN, { skipped: 1 }));

    put(root, 'ran.txt', '');
    r = cli(root, ['gates', '--keep-going'], marked(root));
    assert.equal(r.code, 1);
    assert.deepEqual(ran(root), ['first', 'second']);
    assert.match(r.err, ruRe(TALLY, { gates: 2, green: 1 }));
    assert.doesNotMatch(r.err, ruRe(NOT_RUN));
  } finally {
    cleanup(root);
  }
});

test('gates: all green — code 0; --dry-run prints the list and runs nothing', () => {
  const root = makeProject({ git: false });
  try {
    withGates(root, [mark('first', 0), mark('second', 0)]);
    let r = cli(root, ['gates', '--dry-run'], marked(root));
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(ran(root), [], '--dry-run runs no gates');
    assert.match(r.out, /first/);
    assert.match(r.out, /second/);

    r = cli(root, ['gates'], marked(root));
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(ran(root), ['first', 'second']);
    assert.match(r.out, ruRe(TALLY, { gates: 2, green: 2 }));
  } finally {
    cleanup(root);
  }
});

test('gates: an empty gates list — a refusal, not a green zero', () => {
  const root = makeProject({ git: false });
  try {
    withGates(root, []);
    const r = cli(root, ['gates']);
    assert.equal(r.code, 1);
    assert.match(r.err, ruRe('{config}: the gates list is empty — there is nothing to run'));
  } finally {
    cleanup(root);
  }
});

test('gates: --require-clean refuses on a dirty tree before the first command', () => {
  const root = makeProject();
  try {
    withGates(root, [mark('first', 0)]);
    gitAll(root, 'base');
    put(root, 'docs/note.md', 'edit\n');
    const r = cli(root, ['gates', '--require-clean'], marked(root));
    assert.equal(r.code, 1);
    assert.match(r.err, ruRe('--require-clean: the tree is dirty, no gate was run:\n{dirty}'));
    assert.match(r.err, /docs\/note\.md/);
    assert.deepEqual(ran(root), [], 'no gate runs before the cleanliness check');
  } finally {
    cleanup(root);
  }
});

test('gates: --json is valid JSON with a tree snapshot, the gate output goes to stderr', () => {
  const root = makeProject();
  try {
    // The gates write nothing here: the tree snapshot must stay clean.
    withGates(root, ['node -e "process.exit(0)"', `node -e "console.log('gate noise');process.exit(1)"`]);
    gitAll(root, 'base');
    const r = cli(root, ['gates', '--keep-going', '--json']);
    assert.equal(r.code, 1);
    const report = JSON.parse(r.out);
    assert.equal(report.total, 2);
    assert.equal(report.green, 1);
    assert.equal(report.gates.length, 2);
    assert.equal(report.gates[0].code, 0);
    assert.equal(report.gates[1].code, 1);
    assert.ok(Number.isInteger(report.gates[0].ms));
    assert.match(report.tree.head, /^[0-9a-f]{40}$/);
    assert.equal(report.tree.clean, true);
    assert.match(r.err, /gate noise/, 'the gate output goes to stderr so that stdout stays JSON');
  } finally {
    cleanup(root);
  }
});

test('gates: the tree snapshot keeps porcelain lines whole, the leading space included', () => {
  const root = makeProject();
  try {
    withGates(root, ['node -e "process.exit(0)"']);
    gitAll(root, 'base');
    put(root, 'docs/README.md', 'edit\n');
    put(root, 'docs/zz.md', 'new\n');
    const r = cli(root, ['gates', '--json']);
    assert.equal(r.code, 0, r.err);
    assert.equal(JSON.parse(r.out).tree.dirty, ' M docs/README.md\n?? docs/zz.md');
    const refused = cli(root, ['gates', '--require-clean']);
    assert.equal(refused.code, 1);
    assert.match(refused.err, /^ M docs\/README\.md$/m);
  } finally {
    cleanup(root);
  }
});

test('gates: the tree snapshot marks a dirty tree unclean; without git the tree is null', () => {
  const root = makeProject();
  try {
    withGates(root, ['node -e "process.exit(0)"']);
    gitAll(root, 'base');
    put(root, 'docs/note.md', 'edit\n');
    const r = cli(root, ['gates', '--json']);
    assert.equal(r.code, 0, r.err);
    const report = JSON.parse(r.out);
    assert.equal(report.tree.clean, false);

    const bare = makeProject({ git: false });
    try {
      withGates(bare, ['node -e "process.exit(0)"']);
      const b = JSON.parse(cli(bare, ['gates', '--json']).out);
      assert.equal(b.tree, null);
    } finally { cleanup(bare); }
  } finally {
    cleanup(root);
  }
});

// A record's scope is checked against the changed paths; without --base that is the dirty tree.
test('gates: a command outside the scope does not run and does not count as green', () => {
  const root = makeProject();
  try {
    withGates(root, [mark('always', 0), { command: mark('docs-only', 0), when: ['docs/**'] }, { command: mark('code-only', 0), when: ['lib/**', '*.mjs'] }]);
    // The gates' mark is the gates' own file, not a project edit: without an ignore it would enter
    // the path set and change its count from run to run.
    put(root, '.gitignore', 'ran.txt\n');
    gitAll(root, 'base');
    put(root, 'docs/note.md', 'edit\n');

    const r = cli(root, ['gates', '--json'], marked(root));
    assert.equal(r.code, 0, `a skip by scope does not redden the total: ${r.err}`);
    assert.deepEqual(ran(root), ['always', 'docs-only'], 'the touched scope and the command without a scope run');
    const report = JSON.parse(r.out);
    assert.equal(report.total, 3);
    assert.equal(report.green, 2);
    assert.equal(report.outOfScope, 1);
    assert.equal(report.skipped, 1);
    assert.equal(report.gates[2].code, undefined, 'a skipped command gets no exit code');
    assert.match(report.gates[2].skipped, ruRe('skipped: the scope is untouched ({when}), {paths} paths in the set'));
    assert.deepEqual(report.gates[2].when, ['lib/**', '*.mjs']);
    assert.equal(report.scope.source, 'worktree');
    assert.equal(report.scope.base, null);
    assert.deepEqual(report.scope.paths, ['docs/note.md']);

    put(root, 'ran.txt', '');
    const human = cli(root, ['gates'], marked(root));
    assert.equal(human.code, 0, human.err);
    assert.match(human.out, ruRe(SCOPE_LINE, { how: 'git status --porcelain', from: '', paths: 1, out: '' }));
    assert.match(human.out, ruRe('skipped: the scope is untouched ({when}), {paths} paths in the set', { when: 'lib/**, *.mjs', paths: 1 }));
    assert.ok(human.out.includes(ru(TALLY, { gates: 3, green: 2, tail: ru(NOT_RUN, { skipped: 1 }), why: ru(' (out of scope {outOfScope})', { outOfScope: 1 }) })));
  } finally {
    cleanup(root);
  }
});

test('gates: --base adds the diff to the base, the source of the set is named in the report', () => {
  const root = makeProject();
  try {
    withGates(root, [{ command: mark('code-only', 0), when: ['lib/**'] }]);
    put(root, '.gitignore', 'ran.txt\n');
    gitAll(root, 'base');
    const base = run(root, ['rev-parse', 'HEAD']).stdout.trim();
    put(root, 'lib/thing.js', 'export const a = 1;\n');
    gitAll(root, 'code edit');

    // The tree is clean: without --base the set is empty, and a command with a scope is skipped.
    let report = JSON.parse(cli(root, ['gates', '--json'], marked(root)).out);
    assert.deepEqual(ran(root), []);
    assert.equal(report.outOfScope, 1);
    assert.deepEqual(report.scope.paths, []);

    const r = cli(root, ['gates', '--json', '--base', base], marked(root));
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(ran(root), ['code-only'], 'the diff to the base touched the scope');
    report = JSON.parse(r.out);
    assert.equal(report.green, 1);
    assert.equal(report.outOfScope, 0);
    assert.equal(report.scope.source, 'base+worktree');
    assert.equal(report.scope.base, base);
    assert.deepEqual(report.scope.paths, ['lib/thing.js']);
    assert.match(cli(root, ['gates', '--base', base], marked(root)).out, ruRe(SCOPE_LINE, { how: `git diff --name-only ${base}..HEAD ${ru('plus')} git status --porcelain`, from: '', paths: 1, out: '' }));

    const bad = cli(root, ['gates', '--base', 'no-such-ref'], marked(root));
    assert.equal(bad.code, 1);
    assert.match(bad.err, ruRe(BASE_FAILED, { base: 'no-such-ref' }));
  } finally {
    cleanup(root);
  }
});

test('gates --base: git diff killed by a signal — the refusal names the signal, not “null”', { skip: process.platform === 'win32' }, () => {
  const root = makeProject();
  const shim = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-git-shim-')));
  try {
    withGates(root, [mark('always', 0)]);
    gitAll(root, 'base');
    const real = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
    writeFileSync(path.join(shim, 'git'), `#!/bin/sh\nfor a in "$@"; do [ "$a" = diff ] && kill -9 $$; done\nexec "${real}" "$@"\n`, { mode: 0o755 });

    const r = cli(root, ['gates', '--base', 'HEAD'], { env: { ...marked(root).env, PATH: `${shim}${path.delimiter}${process.env.PATH}` } });
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, ruRe(BASE_FAILED, { base: 'HEAD', why: ru(KILLED, { signal: 'SIGKILL' }) }));
    assert.doesNotMatch(r.err, /\bnull\b/);
    assert.deepEqual(ran(root), [], 'a refusal before the first command');
  } finally {
    cleanup(root);
    rmSync(shim, { recursive: true, force: true });
  }
});

test('gates: a failing git rev-parse --show-prefix in a repository refuses instead of an empty prefix', { skip: process.platform === 'win32' }, () => {
  const root = makeProject();
  const shim = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-git-shim-')));
  try {
    withGates(root, [{ command: mark('docs-only', 0), when: ['docs/**'] }]);
    gitAll(root, 'base');
    put(root, 'docs/a.md', 'dirty\n');
    const real = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
    writeFileSync(path.join(shim, 'git'), `#!/bin/sh\nfor a in "$@"; do [ "$a" = --show-prefix ] && { echo "fatal: prefix lost" >&2; exit 128; }; done\nexec "${real}" "$@"\n`, { mode: 0o755 });

    const r = cli(root, ['gates'], { env: { ...marked(root).env, PATH: `${shim}${path.delimiter}${process.env.PATH}` } });
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, /git rev-parse --show-prefix: fatal: prefix lost/);
    assert.deepEqual(ran(root), [], 'refused before the first command');
  } finally {
    cleanup(root);
    rmSync(shim, { recursive: true, force: true });
  }
});

test('gates: a failing --show-prefix refuses before the first command even with no scope, base or clean check', { skip: process.platform === 'win32' }, () => {
  const root = makeProject();
  const shim = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-git-shim-')));
  try {
    withGates(root, [mark('plain', 0)]);
    gitAll(root, 'base');
    const real = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
    writeFileSync(path.join(shim, 'git'), `#!/bin/sh\nfor a in "$@"; do [ "$a" = --show-prefix ] && { echo "fatal: prefix lost" >&2; exit 128; }; done\nexec "${real}" "$@"\n`, { mode: 0o755 });

    for (const args of [['gates'], ['gates', '--json']]) {
      const r = cli(root, args, { env: { ...marked(root).env, PATH: `${shim}${path.delimiter}${process.env.PATH}` } });
      assert.equal(r.code, 1, r.out);
      assert.match(r.err, /git rev-parse --show-prefix: fatal: prefix lost/);
      assert.equal(r.out, '', `${args.join(' ')}: no report replaced by the refusal`);
      assert.deepEqual(ran(root), [], `${args.join(' ')}: refused before the first command`);
    }
  } finally {
    cleanup(root);
    rmSync(shim, { recursive: true, force: true });
  }
});

test('gates: a git failure other than no repository or no git refuses before the first command', { skip: process.platform === 'win32' }, () => {
  const root = makeProject();
  const shim = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-git-shim-')));
  const empty = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-no-git-')));
  try {
    withGates(root, [mark('plain', 0)]);
    gitAll(root, 'base');
    const real = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
    writeFileSync(path.join(shim, 'git'), `#!/bin/sh\nfor a in "$@"; do [ "$a" = --is-inside-work-tree ] && kill -9 $$; done\nexec "${real}" "$@"\n`, { mode: 0o755 });

    let r = cli(root, ['gates'], { env: { ...marked(root).env, PATH: `${shim}${path.delimiter}${process.env.PATH}` } });
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, new RegExp(escapeRe(`git rev-parse --is-inside-work-tree: ${ru(KILLED, { signal: 'SIGKILL' })}`)));
    assert.deepEqual(ran(root), [], 'refused before the first command');

    symlinkSync(process.execPath, path.join(empty, 'node'));
    r = cli(root, ['gates'], { env: { ...marked(root).env, PATH: empty } });
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(ran(root), ['plain'], 'without git every gate runs, as before');
  } finally {
    cleanup(root);
    rmSync(shim, { recursive: true, force: true });
    rmSync(empty, { recursive: true, force: true });
  }
});

// The cap is narrowed to 2 s on the real `spawnSync`, the gate command is the same: the shell
// traps the cap's SIGTERM and exits with code 0, and `spawnSync` returns ETIMEDOUT with `status` 0.
test('gates: a gate with a launch error at code 0 is not green, the total and the exit code are red', { skip: process.platform === 'win32' }, () => {
  const root = makeProject({ git: false });
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-gate-cap-')));
  try {
    const cap = path.join(dir, 'cap.mjs');
    writeFileSync(cap, [
      "import cp from 'node:child_process';",
      "import { syncBuiltinESMExports } from 'node:module';",
      'const real = cp.spawnSync;',
      'cp.spawnSync = (file, opts, ...rest) => real(file, opts?.shell === true ? { ...opts, timeout: 2000 } : opts, ...rest);',
      'syncBuiltinESMExports();',
    ].join('\n'));
    const trapped = "trap 'exit 0' TERM; n=0; while [ $n -lt 100 ]; do sleep 0.05; n=$((n+1)); done; exit 7";
    withGates(root, [trapped, mark('after', 0)]);
    const env = { ...marked(root).env, NODE_OPTIONS: `--no-warnings --import ${pathToFileURL(cap).href}` };

    let r = cli(root, ['gates'], { env });
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, new RegExp(`✖ trap .* — ${escapeRe(ru('timed out after the {min}-min cap', { min: 10 }))}, \\d+ ms`));
    assert.doesNotMatch(r.err, ruRe('did not start: {error}'));
    assert.doesNotMatch(r.out, /✔ trap/);
    assert.match(r.err, new RegExp(escapeRe(ru(TALLY, { gates: 2, green: 0, tail: ru(NOT_RUN, { skipped: 1 }), why: '' }))));
    assert.deepEqual(ran(root), [], 'without --keep-going the run stops on it, as on a red one');

    r = cli(root, ['gates', '--json', '--keep-going'], { env });
    assert.equal(r.code, 1);
    const report = JSON.parse(r.out);
    assert.equal(report.gates[0].code, 0, 'the gate code is zero: the error reddens it, not the code');
    assert.match(report.gates[0].error, /ETIMEDOUT/);
    assert.equal(report.green, 1);
    assert.deepEqual(ran(root), ['after']);

    // The usual cap: the shell dies of SIGTERM, and spawnSync reports ETIMEDOUT with the signal.
    withGates(root, ['sleep 5']);
    r = cli(root, ['gates'], { env });
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, new RegExp(`✖ sleep 5 — ${escapeRe(ru('timed out after the {min}-min cap', { min: 10 }))}, \\d+ ms`));
    assert.doesNotMatch(r.err, new RegExp(['killed by signal {signal}', 'killed by {signal}'].map((en) => ruRe(en).source).join('|')));
    r = cli(root, ['gates', '--json'], { env });
    const capped = JSON.parse(r.out).gates[0];
    assert.equal(capped.signal, 'SIGTERM');
    assert.match(capped.error, /ETIMEDOUT/);
  } finally {
    cleanup(root);
    rmSync(dir, { recursive: true, force: true });
  }
});

// The project root is below the repository root: git prints `pkg/lib/x.js`, and the pattern is
// written next to the config — `lib/**`. Without stripping the prefix the gate would never run.
test('gates: in a monorepo paths are brought to the project root', () => {
  const repo = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-mono-')));
  try {
    run(repo, ['init', '-q', '-b', 'main']);
    run(repo, ['config', 'user.email', 'test@example.com']);
    run(repo, ['config', 'user.name', 'test']);
    run(repo, ['config', 'commit.gpgsign', 'false']);
    const proj = path.join(repo, 'pkg');
    mkdirSync(path.join(proj, 'docs', 'backlog'), { recursive: true });
    writeFileSync(path.join(proj, 'backslop.json'), `${JSON.stringify({
      prefix: 'BS',
      docs: 'docs', lang: 'ru', tools: [],
      gates: [{ command: mark('code', 0), when: ['lib/**'] }, { command: mark('docs', 0), when: ['docs/**'] }],
    }, null, 2)}\n`);
    writeFileSync(path.join(repo, '.gitignore'), 'ran.txt\n');
    run(repo, ['add', '-A']);
    run(repo, ['commit', '-qm', 'base']);
    put(repo, 'pkg/lib/x.js', 'export const a = 1;\n');
    // A monorepo neighbour: a path outside the project leaves the set — a pattern from the project
    // root can say nothing about it.
    put(repo, 'other/lib/y.js', 'export const b = 2;\n');

    const inProject = { cwd: proj, env: { GATES_MARK: path.join(proj, 'ran.txt') } };
    const r = cli(repo, ['gates', '--json'], inProject);
    assert.equal(r.code, 0, r.err);
    const report = JSON.parse(r.out);
    assert.equal(report.scope.prefix, 'pkg/');
    assert.deepEqual(report.scope.paths, ['lib/x.js'], 'the prefix is stripped, the foreign path is dropped');
    assert.equal(report.scope.dropped, 1);
    assert.equal(report.green, 1);
    assert.equal(report.outOfScope, 1, 'the docs/** scope is untouched');
    const human = cli(repo, ['gates'], inProject).out;
    assert.match(human, ruRe(', paths relative to the project root ({prefix})', { prefix: 'pkg/' }));
    assert.match(human, ruRe(DROPPED, { dropped: 1 }));

    // A diff entirely outside the project is not "the base gave no diff": changes exist, none ours.
    // It is an honest skip, not a refusal, else the CI matrix would fail on each untouched package.
    run(repo, ['add', '-A']);
    run(repo, ['commit', '-qm', 'edits']);
    const base = run(repo, ['rev-parse', 'HEAD']).stdout.trim();
    put(repo, 'other/lib/z.js', 'export const c = 3;\n');
    run(repo, ['add', '-A']);
    run(repo, ['commit', '-qm', 'a neighbour edit']);
    writeFileSync(path.join(proj, 'ran.txt'), '');

    const foreign = cli(repo, ['gates', '--require-clean', '--base', base, '--json'], inProject);
    assert.equal(foreign.code, 0, foreign.err);
    const alien = JSON.parse(foreign.out);
    assert.deepEqual(alien.scope.paths, [], 'there are no paths of ours in the diff');
    assert.equal(alien.scope.dropped, 1, 'but the diff is non-empty — it is entirely outside the project');
    assert.equal(alien.outOfScope, 2, 'both entries with a scope are skipped honestly');
    assert.equal(alien.green, 0);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('gates: in a monorepo the tree snapshot and --require-clean see only the project', () => {
  const repo = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-mono-tree-')));
  try {
    run(repo, ['init', '-q', '-b', 'main']);
    run(repo, ['config', 'user.email', 'test@example.com']);
    run(repo, ['config', 'user.name', 'test']);
    run(repo, ['config', 'commit.gpgsign', 'false']);
    run(repo, ['config', 'status.renames', 'true']);
    const proj = path.join(repo, 'pkg');
    mkdirSync(path.join(proj, 'docs', 'backlog'), { recursive: true });
    writeFileSync(path.join(proj, 'backslop.json'), `${JSON.stringify({ prefix: 'BS', docs: 'docs', gates: [], lang: 'ru', tools: [] }, null, 2)}\n`);
    put(repo, 'pkg/a.md', 'a\n');
    put(repo, 'other/a.txt', 'x\n');
    run(repo, ['add', '-A']);
    run(repo, ['commit', '-qm', 'init']);
    writeFileSync(path.join(proj, 'backslop.json'), `${JSON.stringify({
      prefix: 'BS', docs: 'docs', lang: 'ru', tools: [], gates: [{ command: 'node -e "process.exit(0)"', when: ['backslop.json'] }],
    }, null, 2)}\n`);
    run(repo, ['commit', '-qam', 'cfg']);
    put(repo, 'other/b.txt', 'y\n');

    const inProject = { cwd: proj };
    let r = cli(repo, ['gates', '--require-clean', '--base', 'HEAD~1', '--json'], inProject);
    assert.equal(r.code, 0, `a file outside the project does not make it dirty: ${r.err}`);
    let tree = JSON.parse(r.out).tree;
    assert.equal(tree.clean, true);
    assert.equal(tree.dirty, '');

    run(repo, ['mv', 'pkg/a.md', 'pkg/b c.md']);
    put(repo, 'pkg/new.txt', 'n\n');
    r = cli(repo, ['gates', '--require-clean', '--base', 'HEAD~1'], inProject);
    assert.equal(r.code, 1);
    assert.match(r.err, /^R {2}a\.md -> "b c\.md"$/m, 'both sides of a rename are relative to the project');
    assert.match(r.err, /^\?\? new\.txt$/m);
    assert.doesNotMatch(r.err, /other\/b\.txt|pkg\//);

    r = cli(repo, ['gates', '--base', 'HEAD~1', '--json'], inProject);
    assert.equal(r.code, 0, r.err);
    tree = JSON.parse(r.out).tree;
    assert.equal(tree.clean, false);
    assert.equal(tree.dirty, 'R  a.md -> "b c.md"\n?? new.txt');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('gates: neighbour dirt in a monorepo does not lift the empty-set refusal of --require-clean', () => {
  const repo = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-mono-empty-')));
  try {
    run(repo, ['init', '-q', '-b', 'main']);
    run(repo, ['config', 'user.email', 'test@example.com']);
    run(repo, ['config', 'user.name', 'test']);
    run(repo, ['config', 'commit.gpgsign', 'false']);
    const proj = path.join(repo, 'pkg');
    mkdirSync(path.join(proj, 'docs', 'backlog'), { recursive: true });
    writeFileSync(path.join(proj, 'backslop.json'), `${JSON.stringify({
      prefix: 'BS', docs: 'docs', lang: 'ru', tools: [], gates: [{ command: 'node -e "process.exit(0)"', when: ['src/**'] }],
    }, null, 2)}\n`);
    put(repo, 'other/a.txt', 'x\n');
    run(repo, ['add', '-A']);
    run(repo, ['commit', '-qm', 'init']);
    put(repo, 'other/b.txt', 'y\n');

    let r = cli(repo, ['gates', '--require-clean'], { cwd: proj });
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, ruRe(NO_BASE));
    r = cli(repo, ['gates', '--require-clean', '--base', 'HEAD'], { cwd: proj });
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, ruRe(EMPTY_SET, { base: 'HEAD' }));
    assert.match(cli(repo, ['gates', '--base', 'HEAD'], { cwd: proj }).out, ruRe(DROPPED, { dropped: 1 }), 'the printed count stays');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('gates: a non-ASCII project directory is stripped from quoted porcelain paths too', () => {
  const repo = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-mono-quoted-')));
  try {
    run(repo, ['init', '-q', '-b', 'main']);
    run(repo, ['config', 'core.quotePath', 'true']);
    const proj = path.join(repo, PKG);
    mkdirSync(path.join(proj, 'docs', 'backlog'), { recursive: true });
    writeFileSync(path.join(proj, 'backslop.json'), `${JSON.stringify({ prefix: 'BS', docs: 'docs', gates: ['node -e "process.exit(0)"'], lang: 'ru', tools: [] }, null, 2)}\n`);
    let r = cli(repo, ['gates', '--json'], { cwd: proj });
    assert.equal(JSON.parse(r.out).tree.dirty, '?? ./', 'the untracked project directory itself');
    put(proj, 'docs/backlog/README.md', '# Backlog\n');
    run(repo, ['config', 'user.email', 'test@example.com']);
    run(repo, ['config', 'user.name', 'test']);
    run(repo, ['config', 'commit.gpgsign', 'false']);
    run(repo, ['add', '-A']);
    run(repo, ['commit', '-qm', 'init']);
    put(repo, `${PKG}/plain.md`, 'a\n');
    put(repo, `${PKG}/a b.md`, 'b\n');
    r = cli(repo, ['gates', '--json'], { cwd: proj });
    assert.equal(r.code, 0, r.err);
    assert.equal(JSON.parse(r.out).tree.dirty, '?? "a b.md"\n?? plain.md');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('gates: a bare porcelain path with a Unicode space loses the project prefix too', () => {
  const repo = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-mono-nbsp-')));
  try {
    run(repo, ['init', '-q', '-b', 'main']);
    run(repo, ['config', 'core.quotePath', 'false']);
    run(repo, ['config', 'user.email', 'test@example.com']);
    run(repo, ['config', 'user.name', 'test']);
    run(repo, ['config', 'commit.gpgsign', 'false']);
    const proj = path.join(repo, 'pkg');
    mkdirSync(path.join(proj, 'docs', 'backlog'), { recursive: true });
    writeFileSync(path.join(proj, 'backslop.json'), `${JSON.stringify({ prefix: 'BS', docs: 'docs', gates: ['node -e "process.exit(0)"'], lang: 'ru', tools: [] }, null, 2)}\n`);
    run(repo, ['add', '-A']);
    run(repo, ['commit', '-qm', 'init']);
    put(repo, 'pkg/a b.md', 'x\n');
    const r = cli(repo, ['gates', '--json'], { cwd: proj });
    assert.equal(r.code, 0, r.err);
    assert.equal(JSON.parse(r.out).tree.dirty, '?? a b.md');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('gates: diff.relative=true does not drop the paths of a monorepo subproject', () => {
  const repo = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-mono-rel-')));
  try {
    run(repo, ['init', '-q', '-b', 'main']);
    run(repo, ['config', 'user.email', 'test@example.com']);
    run(repo, ['config', 'user.name', 'test']);
    run(repo, ['config', 'commit.gpgsign', 'false']);
    const proj = path.join(repo, 'pkg');
    mkdirSync(path.join(proj, 'docs', 'backlog'), { recursive: true });
    writeFileSync(path.join(proj, 'backslop.json'), `${JSON.stringify({
      prefix: 'BS',
      docs: 'docs', lang: 'ru', tools: [],
      gates: [{ command: mark('code', 0), when: ['lib/**'] }],
    }, null, 2)}\n`);
    writeFileSync(path.join(repo, '.gitignore'), 'ran.txt\n');
    run(repo, ['add', '-A']);
    run(repo, ['commit', '-qm', 'base']);
    run(repo, ['tag', 'base']);
    put(repo, 'pkg/lib/x.js', 'export const a = 1;\n');
    run(repo, ['add', '-A']);
    run(repo, ['commit', '-qm', 'code']);
    run(repo, ['config', 'diff.relative', 'true']);

    const r = cli(repo, ['gates', '--base', 'base', '--json'], { cwd: proj, env: { GATES_MARK: path.join(proj, 'ran.txt') } });
    assert.equal(r.code, 0, r.err);
    const report = JSON.parse(r.out);
    assert.equal(report.scope.dropped, 0);
    assert.deepEqual(report.scope.paths, ['lib/x.js']);
    assert.equal(report.green, 1, 'the lib/** gate runs');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('gates: an empty --base and --require-clean without a base — a refusal before the first command', () => {
  const root = makeProject();
  try {
    withGates(root, [mark('always', 0), { command: mark('scoped', 0), when: ['lib/**'] }]);
    put(root, '.gitignore', 'ran.txt\n');
    gitAll(root, 'base');

    for (const argv of [['gates', '--base', ''], ['gates', '--base', '   ']]) {
      const r = cli(root, argv, marked(root));
      assert.equal(r.code, 1);
      assert.match(r.err, ruRe('--base is empty: name a ref or drop the flag — an empty base would count the dirty tree alone and call it a diff'));
      assert.deepEqual(ran(root), [], 'it did not get to the first command');
    }

    const clean = cli(root, ['gates', '--require-clean'], marked(root));
    assert.equal(clean.code, 1);
    assert.match(clean.err, ruRe(NO_BASE));
    assert.deepEqual(ran(root), [], 'the idle run is known before the first command');

    // A named base does not cure an idle run: `HEAD..HEAD` is empty just as a clean tree is. The
    // refusal is counted by the path set, not by the form of the flags.
    const empty = cli(root, ['gates', '--require-clean', '--base', 'HEAD'], marked(root));
    assert.equal(empty.code, 1);
    assert.match(empty.err, ruRe(EMPTY_SET, { base: 'HEAD' }));
    assert.deepEqual(ran(root), [], 'it did not get to the first command with a base either');
  } finally {
    cleanup(root);
  }
});

// A non-empty set that touched no scope is legitimate: the skip is honest, no refusal is due.
// Otherwise the refusal above would eat the routine acceptance of a docs-only edit.
test('gates: --require-clean on a non-empty set without matches — a run, not a refusal', () => {
  const root = makeProject();
  try {
    withGates(root, [mark('always', 0), { command: mark('scoped', 0), when: ['lib/**'] }]);
    put(root, '.gitignore', 'ran.txt\n');
    gitAll(root, 'base');
    const base = run(root, ['rev-parse', 'HEAD']).stdout.trim();
    put(root, 'docs/note.md', 'edit\n');
    gitAll(root, 'docs edit');

    const r = cli(root, ['gates', '--require-clean', '--base', base, '--json'], marked(root));
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(ran(root), ['always']);
    const report = JSON.parse(r.out);
    assert.deepEqual(report.scope.paths, ['docs/note.md'], 'the set is non-empty — there must be no refusal');
    assert.equal(report.outOfScope, 1);
    assert.equal(report.green, 1);
  } finally {
    cleanup(root);
  }
});

test('gates: --require-clean without --base is legitimate while there are no scopes', () => {
  const root = makeProject();
  try {
    withGates(root, [mark('always', 0)]);
    put(root, '.gitignore', 'ran.txt\n');
    gitAll(root, 'base');
    const r = cli(root, ['gates', '--require-clean'], marked(root));
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(ran(root), ['always'], 'a list without scopes behaves as it did before scopes existed');
  } finally {
    cleanup(root);
  }
});

test('gates: without git the scope is not counted — everything runs', () => {
  const root = makeProject({ git: false });
  try {
    withGates(root, [{ command: mark('code-only', 0), when: ['lib/**'] }]);
    const r = cli(root, ['gates', '--json'], marked(root));
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(ran(root), ['code-only'], 'there is no path set — nothing to skip by');
    const report = JSON.parse(r.out);
    assert.equal(report.green, 1);
    assert.equal(report.outOfScope, 0);
    assert.equal(report.scope, null);

    const withBase = cli(root, ['gates', '--base', 'HEAD']);
    assert.equal(withBase.code, 1);
    assert.match(withBase.err, ruRe('--base {base}: git did not report the tree state, so the path set cannot be computed', { base: 'HEAD' }));
  } finally {
    cleanup(root);
  }
});

test('gates: glob — * does not cross a slash, ** does, **/ catches the root too', () => {
  for (const [pattern, hits, misses] of [
    ['docs/**', ['docs/a.md', 'docs/a/b/c.md'], ['docs', 'lib/a.md']],
    ['*.md', ['a.md'], ['docs/a.md']],
    ['**/*.md', ['a.md', 'docs/a/b.md'], ['a.mdx', 'docs/a.txt']],
    ['lib/?.js', ['lib/a.js'], ['lib/ab.js', 'lib/a/b.js']],
    ['docs/a.md', ['docs/a.md'], ['docs/aXmd', 'xdocs/a.md']],
    ['src**/x.js', ['srcfoo/x.js', 'src/a/x.js'], ['srcx.js']],
    ['a/**/b.md', ['a/b.md', 'a/c/d/b.md'], ['ab.md']],
  ]) {
    for (const p of hits) assert.ok(globToRe(pattern).test(p), `${pattern} must catch ${p}`);
    for (const p of misses) assert.ok(!globToRe(pattern).test(p), `${pattern} must not catch ${p}`);
  }
});

test('gates: --dry-run lists every gate with its scope', () => {
  const root = makeProject();
  try {
    withGates(root, ['npm test', { command: 'npm run e2e', when: ['src/**'] }]);
    gitAll(root, 'base');
    const r = cli(root, ['gates', '--dry-run', '--json']);
    assert.equal(r.code, 0, r.err);
    const report = JSON.parse(r.out);
    assert.equal(report.dryRun, true);
    assert.deepEqual(report.gates, [{ command: 'npm test', when: null }, { command: 'npm run e2e', when: ['src/**'] }]);
    assert.match(cli(root, ['gates', '--dry-run']).out, new RegExp(`npm run e2e — ${ru('scope')}: src/\\*\\*`));
  } finally {
    cleanup(root);
  }
});

test('gates: help prints the gates usage line', () => {
  const root = makeProject({ git: false });
  try {
    const help = cli(root, ['help']);
    assert.equal(help.code, 0, help.err);
    assert.match(help.out, /gates \[--keep-going\] \[--json\] \[--require-clean\] \[--dry-run\] \[--base <ref>\]/);
  } finally {
    cleanup(root);
  }
});

test('gates: the outcome tells code, signal and no-start apart; the gate line format is pinned', () => {
  const root = makeProject({ git: false });
  try {
    withGates(root, ['node -e "process.exit(3)"']);
    let r = cli(root, ['gates', '--keep-going']);
    assert.equal(r.code, 1);
    assert.match(r.err, new RegExp(`^✖ node -e "process\\.exit\\(3\\)" — ${escapeRe(ru('exit code {status}', { status: 3 }))}, \\d+ ms$`, 'm'));

    withGates(root, ['node -e "process.kill(process.pid, \'SIGTERM\')"']);
    r = cli(root, ['gates', '--json']);
    assert.equal(r.code, 1);
    const killed = JSON.parse(r.out).gates[0];
    assert.equal(killed.code, null);
    assert.equal(killed.signal, 'SIGTERM');
    r = cli(root, ['gates']);
    assert.equal(r.code, 1);
    assert.match(r.err, new RegExp(`— ${escapeRe(ru('killed by signal {signal}', { signal: 'SIGTERM' }))}, \\d+ ms$`, 'm'));
    assert.doesNotMatch(r.err, new RegExp(`${ruRe('timed out after the {min}-min cap').source}|${ruRe('timed out after the {seconds}-second cap').source}`), 'a self-kill is not the time cap');

    // A name not found is the shell's own code (127 for sh, 1 or 9009 for cmd.exe), not `r.error`:
    // for it the "did not start" branch through the shell is unreachable; its number is unchecked.
    withGates(root, ['no-such-command-will-ever-exist']);
    r = cli(root, ['gates', '--json']);
    assert.equal(r.code, 1);
    const missing = JSON.parse(r.out).gates[0];
    assert.notEqual(missing.code, 0, 'a command not found does not count as green');
    assert.equal(missing.error, null, 'through the shell the refusal arrives as the shell code, not r.error');
  } finally {
    cleanup(root);
  }
});

test('gates: --dry-run refuses --base and --require-clean before any gate runs', () => {
  const root = makeProject();
  try {
    withGates(root, [mark('first', 0)]);
    gitAll(root, 'base');
    put(root, 'docs/note.md', 'edit\n');
    for (const [flags, err] of [
      [['--dry-run', '--base', 'HEAD'], ruRe('--dry-run and --base make no sense together: the whole list is printed and no scope is computed')],
      [['--dry-run', '--require-clean'], ruRe('--dry-run and --require-clean make no sense together: the list is printed without running any gate')],
    ]) {
      const r = cli(root, ['gates', ...flags], marked(root));
      assert.equal(r.code, 1, `${flags.join(' ')}: ${r.out}`);
      assert.match(r.err, err, flags.join(' '));
      assert.deepEqual(ran(root), [], `${flags.join(' ')}: no gate ran`);
    }
  } finally {
    cleanup(root);
  }
});

test('gates: a repository without commits — there is a snapshot, no commit in it', () => {
  const root = makeProject();
  try {
    withGates(root, ['node -e "process.exit(0)"']);
    const r = cli(root, ['gates', '--json']);
    assert.equal(r.code, 0, r.err);
    const tree = JSON.parse(r.out).tree;
    assert.notEqual(tree, null, 'the repository exists, so the snapshot must exist');
    assert.equal(tree.head, null);
    assert.equal(tree.clean, false);
    assert.match(cli(root, ['gates']).out, ruRe('no commits yet'));
  } finally {
    cleanup(root);
  }
});
