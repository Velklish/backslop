// The hook command as a real process: fake harness stdin per harness, git fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BIN, cleanup, gitAll, makeProject, put, read, ru, run } from './helpers.mjs';

const HARNESSES = ['claude', 'cursor', 'codex'];
const SESSION = 's-1';
const BAD_A = 'docs/reference/a.md';
const BAD_B = 'docs/reference/b.md';
const broken = (target) => `# Page\n\n[broken](${target})\n`;
const errorLine = (file, target, line = 3) => `${file}: ${ru('broken link {href} (line {line})', { href: target, line })}`;
const FIX_LINE = ru('fix these errors in the files named above; do not bypass the hook');
const WARNING = (limit) => ru('lint errors in changed files returned the turn {limit} times in a row; letting it end:', { limit });

// The stop payload of each harness, with its loop flag as measured.
const payload = (harness, extra = {}) => (harness === 'cursor'
  ? { session_id: SESSION, conversation_id: SESSION, hook_event_name: 'stop', loop_count: 0, ...extra }
  : { session_id: SESSION, hook_event_name: 'Stop', stop_hook_active: false, ...extra });

function hook(root, harness, event, { stdin = payload(harness), cwd = root, args = ['--harness', harness], env = {} } = {}) {
  const input = typeof stdin === 'string' ? stdin : JSON.stringify(stdin);
  const nodeOptions = `${process.env.NODE_OPTIONS ?? ''} --no-warnings`.trim();
  const r = spawnSync(process.execPath, [BIN, 'hook', event, ...args], {
    cwd, input, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', NODE_OPTIONS: nodeOptions, ...env },
  });
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
}

// The turn is returned by stderr with exit 2, or by stdout JSON with exit 0 (cursor).
function returnedText(harness, r) {
  if (harness === 'cursor') {
    assert.equal(r.code, 0, r.err);
    assert.equal(r.err, '');
    return JSON.parse(r.out).followup_message;
  }
  assert.equal(r.code, 2, r.out);
  assert.equal(r.out, '');
  return r.err;
}

function assertReturned(harness, r, lines) {
  const text = returnedText(harness, r);
  assert.equal(text.trim(), [...lines, FIX_LINE].join('\n'), harness);
}

function assertPasses(r, what) {
  assert.equal(r.code, 0, `${what}: ${r.err}`);
  assert.equal(r.out, '', what);
  assert.equal(r.err, '', what);
}

// The one note on the channel the harness shows the user.
function noteOf(harness, r) {
  assert.equal(r.code, 0, `${harness}: ${r.err}`);
  if (harness === 'cursor') {
    assert.equal(r.out, '');
    return r.err.trim();
  }
  assert.equal(r.err, '');
  return JSON.parse(r.out).systemMessage;
}

// A green project with a commit, so `session-start` has a start point.
function session(harness) {
  const root = makeProject();
  gitAll(root, 'base');
  assert.equal(hook(root, harness, 'session-start').code, 0);
  return root;
}

const head = (root) => run(root, ['rev-parse', 'HEAD']).stdout.trim();
const recordFile = (root, harness) => path.join(root, '.git', 'backslop', 'hooks', `${harness}-${SESSION}.json`);
const record = (root, harness) => JSON.parse(readFileSync(recordFile(root, harness), 'utf8'));

for (const harness of HARNESSES) {
  test(`hook ${harness}: session-start records the id, HEAD and time under the git directory, silently`, () => {
    const root = makeProject();
    try {
      gitAll(root, 'base');
      const r = hook(root, harness, 'session-start');
      assertPasses(r, 'session-start');
      const rec = record(root, harness);
      assert.equal(rec.session, SESSION);
      assert.equal(rec.harness, harness);
      assert.equal(rec.start, head(root));
      assert.ok(!Number.isNaN(Date.parse(rec.time)), `time: ${rec.time}`);
      assert.equal(run(root, ['status', '--porcelain']).stdout, '', 'the record is not a tracked or untracked file');
    } finally { cleanup(root); }
  });

  test(`hook ${harness}: an error in a file the session changed returns the turn`, () => {
    const root = session(harness);
    try {
      put(root, BAD_A, broken('missing.md'));
      assertReturned(harness, hook(root, harness, 'stop'), [errorLine(BAD_A, 'missing.md')]);
    } finally { cleanup(root); }
  });

  test(`hook ${harness}: an error in an untouched file does not return the turn`, () => {
    const root = makeProject();
    try {
      put(root, BAD_B, broken('nothing.md'));
      gitAll(root, 'red base');
      assert.equal(hook(root, harness, 'session-start').code, 0);
      put(root, 'docs/reference/clean.md', '# Clean\n\n[up](../README.md)\n');
      assertPasses(hook(root, harness, 'stop'), 'a clean change next to a red file');
      put(root, BAD_A, broken('missing.md'));
      assertReturned(harness, hook(root, harness, 'stop'), [errorLine(BAD_A, 'missing.md')]);
    } finally { cleanup(root); }
  });

  test(`hook ${harness}: bad stdin, no git, no config and a foreign harness exit 0 with one note`, () => {
    const root = makeProject();
    try {
      gitAll(root, 'base');
      for (const event of ['session-start', 'stop']) {
        for (const stdin of ['', 'not json', '[]', '{"session_id": 5}', '{"session_id": ""}']) {
          const r = hook(root, harness, event, { stdin });
          assert.ok(noteOf(harness, r), `${event} ${JSON.stringify(stdin)}`);
          assert.ok(!existsSync(path.join(root, '.git', 'backslop')), 'a record was written for a bad payload');
        }
      }
      const foreign = hook(root, harness, 'stop', { args: ['--harness', 'vim'] });
      assert.equal(foreign.code, 0);
      assert.match(foreign.out + foreign.err, /vim/);
      assert.equal(hook(root, harness, 'stop', { args: [] }).code, 0, 'no --harness');

      const plain = makeProject({ git: false });
      try {
        assert.ok(noteOf(harness, hook(plain, harness, 'stop')), 'no git');
      } finally { cleanup(plain); }

      rmSync(path.join(root, 'backslop.json'));
      assert.ok(noteOf(harness, hook(root, harness, 'stop')), 'no config');
      put(root, 'backslop.json', '{ not json');
      assert.ok(noteOf(harness, hook(root, harness, 'stop')), 'a config that cannot be parsed');
    } finally { cleanup(root); }
  });

  test(`hook ${harness}: the fourth stop lets the turn end, and a clean stop resets the count`, () => {
    const root = session(harness);
    try {
      put(root, BAD_A, broken('missing.md'));
      const lines = [errorLine(BAD_A, 'missing.md')];
      for (let i = 1; i <= 3; i += 1) assertReturned(harness, hook(root, harness, 'stop'), lines);
      assert.equal(record(root, harness).returns.count, 3);

      for (const n of [4, 5]) {
        const r = hook(root, harness, 'stop');
        assert.equal(r.code, 0, `stop ${n}: ${r.err}`);
        const warning = noteOf(harness, r);
        assert.equal(warning, `${WARNING(3)}\n${lines[0]}`, `stop ${n}`);
      }

      rmSync(path.join(root, ...BAD_A.split('/')));
      assertPasses(hook(root, harness, 'stop'), 'a clean stop');
      assert.equal(record(root, harness).returns, null, 'the count was not reset');

      put(root, BAD_A, broken('missing.md'));
      assertReturned(harness, hook(root, harness, 'stop'), lines);
      assert.equal(record(root, harness).returns.count, 1);
    } finally { cleanup(root); }
  });
}

test('hook: the count goes on when the errors change on every stop', () => {
  const root = session('claude');
  try {
    const target = (n) => `${'\n'.repeat(n)}${broken('missing.md')}`;
    for (let i = 0; i < 3; i += 1) {
      put(root, BAD_A, target(i));
      const r = hook(root, 'claude', 'stop');
      assert.equal(r.code, 2, `stop ${i + 1}: ${r.out}`);
      assert.ok(r.err.includes(errorLine(BAD_A, 'missing.md', 3 + i)), 'the line shifts with every stop');
    }
    put(root, BAD_A, target(3));
    put(root, BAD_B, broken('nothing.md'));
    const r = hook(root, 'claude', 'stop');
    assert.equal(noteOf('claude', r).split('\n')[0], WARNING(3), 'the fourth stop lets the turn end');
    assert.equal(record(root, 'claude').returns.count, 3);
  } finally { cleanup(root); }
});

test('hook: a record that is not JSON, or has no commit id as its start, reads as missing', () => {
  const root = session('claude');
  try {
    put(root, BAD_A, broken('missing.md'));
    gitAll(root, 'work');
    assert.equal(hook(root, 'claude', 'stop').code, 2, 'the control: a valid record counts the commit');
    for (const text of ['{ not json', '{"start": "abc"}', '{"start": "--output=x"}', '{"start": 7}', 'null']) {
      put(root, `.git/backslop/hooks/claude-${SESSION}.json`, text);
      assertPasses(hook(root, 'claude', 'stop'), text);
    }
  } finally { cleanup(root); }
});

test('hook: characters of the session id outside [\\w.-] become _ and the name is cut at 128', () => {
  const root = makeProject();
  try {
    gitAll(root, 'base');
    for (const [id, name] of [
      ['a/b c:../x', 'claude-a_b_c_.._x.json'],
      [`caf${String.fromCodePoint(0xe9)}`, 'claude-caf_.json'],
      ['x'.repeat(200), `claude-${'x'.repeat(128)}.json`],
    ]) {
      assert.equal(hook(root, 'claude', 'session-start', { stdin: { session_id: id } }).code, 0, id);
      assert.ok(existsSync(path.join(root, '.git', 'backslop', 'hooks', name)), name);
    }
    assert.equal(readdirSync(path.join(root, '.git', 'backslop', 'hooks')).length, 3, 'nothing escaped the hooks directory');
    assert.ok(!existsSync(path.join(root, '.git', 'backslop', 'x.json')));
  } finally { cleanup(root); }
});

test('hook: a second session-start replaces the record and drops the count', () => {
  const root = session('claude');
  try {
    put(root, BAD_A, broken('missing.md'));
    assert.equal(hook(root, 'claude', 'stop').code, 2);
    const first = record(root, 'claude');
    assert.equal(first.returns.count, 1);
    gitAll(root, 'moved on');
    assert.equal(hook(root, 'claude', 'session-start').code, 0);
    const second = record(root, 'claude');
    assert.equal(second.start, head(root));
    assert.notEqual(second.start, first.start);
    assert.equal(second.returns, undefined);
    assertPasses(hook(root, 'claude', 'stop'), 'the committed error is before the new start');
  } finally { cleanup(root); }
});

test('hook: a failing git call names its cause in the project language', { skip: process.platform === 'win32' }, () => {
  const root = session('claude');
  const bin = mkdtempSync(path.join(os.tmpdir(), 'backslop-fakegit-'));
  try {
    put(root, 'backslop.json', read(root, 'backslop.json').replace('"lang": "ru"', '"lang": "en"'));
    const real = spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim();
    const fake = path.join(bin, 'git');
    writeFileSync(fake, `#!/bin/sh\ncase " $* " in *" diff "*) exit 3;; esac\nexec "${real}" "$@"\n`);
    chmodSync(fake, 0o755);
    put(root, 'docs/reference/clean.md', '# Clean\n\n[up](../README.md)\n');
    const r = hook(root, 'claude', 'stop', { env: { PATH: `${bin}${path.delimiter}${process.env.PATH}` } });
    assert.equal(JSON.parse(r.out).systemMessage, 'hook skipped: exit code 3');
  } finally {
    rmSync(bin, { recursive: true, force: true });
    cleanup(root);
  }
});

test('hook: a file committed after session-start counts as changed, so does a staged one', () => {
  const root = session('claude');
  try {
    put(root, BAD_A, broken('missing.md'));
    gitAll(root, 'work');
    assert.equal(run(root, ['status', '--porcelain']).stdout, '');
    assert.equal(hook(root, 'claude', 'stop').code, 2, 'committed');
    const r2 = session('claude');
    try {
      put(r2, BAD_A, broken('missing.md'));
      run(r2, ['add', BAD_A]);
      assert.equal(hook(r2, 'claude', 'stop').code, 2, 'staged');
    } finally { cleanup(r2); }
  } finally { cleanup(root); }
});

test('hook: an untracked file counts as changed and an ignored one does not', () => {
  const root = makeProject();
  try {
    put(root, '.gitignore', 'docs/scratch/\n');
    gitAll(root, 'base');
    hook(root, 'claude', 'session-start');
    put(root, 'docs/scratch/x.md', broken('missing.md'));
    assertPasses(hook(root, 'claude', 'stop'), 'an ignored file');
    put(root, BAD_A, broken('missing.md'));
    const r = hook(root, 'claude', 'stop');
    assert.equal(r.code, 2);
    assert.equal(r.err.trim(), [errorLine(BAD_A, 'missing.md'), FIX_LINE].join('\n'));
  } finally { cleanup(root); }
});

test('hook: without a record the start is HEAD, and the record appears with the first return', () => {
  const root = makeProject();
  try {
    put(root, BAD_B, broken('nothing.md'));
    gitAll(root, 'committed before the hook was installed');
    assertPasses(hook(root, 'claude', 'stop'), 'a commit before HEAD');
    assert.ok(!existsSync(path.join(root, '.git', 'backslop')), 'a clean stop wrote a record');
    put(root, BAD_A, broken('missing.md'));
    for (let i = 0; i < 3; i += 1) assert.equal(hook(root, 'claude', 'stop').code, 2);
    const r = hook(root, 'claude', 'stop');
    assert.equal(r.code, 0, 'the ceiling holds without session-start');
    assert.equal(record(root, 'claude').start, head(root));
  } finally { cleanup(root); }
});

test('hook: a repository without a commit uses the empty tree as the start', () => {
  const root = makeProject();
  try {
    assert.equal(hook(root, 'claude', 'session-start').code, 0);
    put(root, BAD_A, broken('missing.md'));
    run(root, ['add', '-A']);
    assert.equal(hook(root, 'claude', 'stop').code, 2);
  } finally { cleanup(root); }
});

test('hook: only errors count; a warning in a changed file does not return the turn', () => {
  const root = makeProject({ stamp: false });
  try {
    gitAll(root, 'base');
    hook(root, 'claude', 'session-start');
    put(root, 'backslop.json', `${read(root, 'backslop.json')}\n`);
    const lint = spawnSync(process.execPath, [BIN, 'lint'], { cwd: root, encoding: 'utf8' });
    assert.equal(lint.status, 0, lint.stderr);
    assert.match(lint.stderr, /backslop\.json/, 'the fixture must carry a warning on a changed file');
    assertPasses(hook(root, 'claude', 'stop'), 'a warning');
  } finally { cleanup(root); }
});

test('hook: a project below the repository root maps the changed paths to project paths', () => {
  const project = makeProject({ git: false });
  const outer = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-outer-')));
  try {
    const sub = path.join(outer, 'sub');
    cpSync(project, sub, { recursive: true });
    for (const args of [['init', '-q', '-b', 'main'], ['config', 'user.email', 't@example.com'], ['config', 'user.name', 't'], ['config', 'commit.gpgsign', 'false']]) run(outer, args);
    gitAll(outer, 'base');
    assert.equal(hook(sub, 'claude', 'session-start').code, 0);
    assert.ok(existsSync(path.join(outer, '.git', 'backslop', 'hooks', `claude-${SESSION}.json`)));
    put(sub, BAD_A, broken('missing.md'));
    put(outer, 'docs/outside.md', broken('missing.md'));
    const r = hook(sub, 'claude', 'stop');
    assert.equal(r.code, 2, r.out);
    assert.equal(r.err.trim(), [errorLine(BAD_A, 'missing.md'), FIX_LINE].join('\n'));
  } finally {
    cleanup(project);
    cleanup(outer);
  }
});

test('hook: a linked worktree keeps its own record under its own git directory', () => {
  const root = makeProject();
  const tree = path.join(os.tmpdir(), `backslop-wt-${process.pid}`);
  try {
    gitAll(root, 'base');
    run(root, ['worktree', 'add', '-q', '-b', 'side', tree]);
    const real = realpathSync(tree);
    assert.equal(hook(real, 'claude', 'session-start').code, 0);
    assert.ok(!existsSync(path.join(root, '.git', 'backslop')), 'the main git directory got the record');
    const gitDir = run(real, ['rev-parse', '--absolute-git-dir']).stdout.trim();
    assert.ok(existsSync(path.join(gitDir, 'backslop', 'hooks', `claude-${SESSION}.json`)));
  } finally {
    rmSync(tree, { recursive: true, force: true });
    cleanup(root);
  }
});

test('hook: an empty changed set does not run lint', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, () => {
  const root = session('claude');
  const locked = path.join(root, 'docs', 'reference', 'locked');
  try {
    mkdirSync(locked);
    chmodSync(locked, 0o000);
    put(root, 'docs/reference/clean.md', '# Clean\n\n[up](../README.md)\n');
    const ran = hook(root, 'claude', 'stop');
    assert.match(JSON.parse(ran.out).systemMessage, /locked/, 'with a change, lint runs and cannot read the directory');
    rmSync(path.join(root, 'docs', 'reference', 'clean.md'));
    assertPasses(hook(root, 'claude', 'stop'), 'an empty changed set');
  } finally {
    chmodSync(locked, 0o755);
    cleanup(root);
  }
});

test('hook: an unknown event is a usage refusal, and the harness id is checked per event', () => {
  const root = makeProject();
  try {
    let r = hook(root, 'claude', 'bogus');
    assert.equal(r.code, 1);
    assert.match(r.err, /bogus/);
    r = hook(root, 'claude', 'stop', { args: ['--harness', 'claude', 'extra'] });
    assert.equal(r.code, 1);
    assert.match(r.err, /extra/);
  } finally { cleanup(root); }
});
