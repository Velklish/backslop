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
const WARNING = (limit) => ru('lint errors in changed files were reported {limit} times in a row; the hook now exits 0, the errors stay:', { limit });

// The stop event JSON the tests feed to the hook, one shape per harness.
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

// The errors come on stderr with exit 2, or as stdout JSON with exit 0 (cursor).
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

// The one note: stdout `systemMessage` JSON (claude, codex) or stderr (cursor).
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

  test(`hook ${harness}: an error in a file the session changed is printed with the fix request`, () => {
    const root = session(harness);
    try {
      put(root, BAD_A, broken('missing.md'));
      assertReturned(harness, hook(root, harness, 'stop'), [errorLine(BAD_A, 'missing.md')]);
    } finally { cleanup(root); }
  });

  test(`hook ${harness}: an error in an untouched file is not printed`, () => {
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

  test(`hook ${harness}: the fourth stop exits 0 with a note, and a clean stop resets the count`, () => {
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
    assert.equal(noteOf('claude', r).split('\n')[0], WARNING(3), 'the fourth stop exits 0 with the note');
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

test('hook: a repeated session-start keeps the first start and time but drops the count', () => {
  const root = session('claude');
  try {
    put(root, BAD_A, broken('missing.md'));
    assert.equal(hook(root, 'claude', 'stop').code, 2);
    const first = record(root, 'claude');
    assert.equal(first.returns.count, 1);
    gitAll(root, 'moved on');
    assert.equal(hook(root, 'claude', 'session-start').code, 0);
    const second = record(root, 'claude');
    assert.equal(second.start, first.start);
    assert.equal(second.time, first.time);
    assert.notEqual(second.start, head(root));
    assert.equal(second.returns, undefined);
    assertReturned('claude', hook(root, 'claude', 'stop'), [errorLine(BAD_A, 'missing.md')]);
  } finally { cleanup(root); }
});

test('hook: a new session id starts at the later commit', () => {
  const root = session('claude');
  try {
    put(root, BAD_A, broken('missing.md'));
    gitAll(root, 'moved on');
    const id = 's-2';
    assert.equal(hook(root, 'claude', 'session-start', { stdin: { session_id: id } }).code, 0);
    const next = JSON.parse(readFileSync(path.join(root, '.git', 'backslop', 'hooks', `claude-${id}.json`), 'utf8'));
    assert.equal(next.start, head(root));
    assertPasses(hook(root, 'claude', 'stop', { stdin: { session_id: id } }), 'the committed error predates the new id');
    assertReturned('claude', hook(root, 'claude', 'stop'), [errorLine(BAD_A, 'missing.md')]);
  } finally { cleanup(root); }
});

test('hook: a new session id sharing a record filename starts at the later commit', () => {
  const root = makeProject();
  try {
    gitAll(root, 'base');
    assert.equal(hook(root, 'claude', 'session-start', { stdin: { session_id: 'a/b' } }).code, 0);
    put(root, BAD_A, broken('missing.md'));
    gitAll(root, 'moved on');
    assert.equal(hook(root, 'claude', 'session-start', { stdin: { session_id: 'a_b' } }).code, 0);
    const next = JSON.parse(readFileSync(path.join(root, '.git', 'backslop', 'hooks', 'claude-a_b.json'), 'utf8'));
    assert.equal(next.session, 'a_b');
    assert.equal(next.start, head(root));
    assertPasses(hook(root, 'claude', 'stop', { stdin: { session_id: 'a_b' } }), 'the old id shares a filename');
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

test('hook: only errors count; a warning in a changed file is not printed', () => {
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

test('hook: first-start baseline suppresses an old missing link after harmless same-file prose', () => {
  const root = makeProject();
  try {
    put(root, BAD_A, broken('old.md'));
    gitAll(root, 'old missing link');
    assertPasses(hook(root, 'claude', 'session-start'), 'first observation');
    put(root, BAD_A, `${broken('old.md')}\nHarmless prose.\n`);
    assertPasses(hook(root, 'claude', 'stop'), 'old missing link after prose');
  } finally { cleanup(root); }
});

test('hook: old missing-link identity survives a source line insertion', () => {
  const root = makeProject();
  try {
    put(root, BAD_A, broken('old.md'));
    gitAll(root, 'old missing link');
    assertPasses(hook(root, 'claude', 'session-start'), 'first observation');
    put(root, BAD_A, `\n${broken('old.md')}`);
    assertPasses(hook(root, 'claude', 'stop'), 'old missing link after line insertion');
  } finally { cleanup(root); }
});

test('hook: an already-red file still returns a new missing-link target only', () => {
  const root = makeProject();
  try {
    put(root, BAD_A, broken('old.md'));
    gitAll(root, 'old missing link');
    assertPasses(hook(root, 'claude', 'session-start'), 'first observation');
    put(root, BAD_A, `${broken('old.md')}\n[new](new.md)\n`);
    assertReturned('claude', hook(root, 'claude', 'stop'), [errorLine(BAD_A, 'new.md', 5)]);
    const ordinary = spawnSync(process.execPath, [BIN, 'lint'], { cwd: root, encoding: 'utf8' });
    assert.equal(ordinary.status, 1, ordinary.stderr);
    assert.ok(ordinary.stderr.includes(errorLine(BAD_A, 'old.md')));
    assert.ok(ordinary.stderr.includes(errorLine(BAD_A, 'new.md', 5)));
  } finally { cleanup(root); }
});

for (const state of ['staged', 'unstaged', 'untracked']) {
  test(`hook: first-start observation includes pre-existing ${state} missing links`, () => {
    const root = makeProject();
    try {
      if (state !== 'untracked') put(root, BAD_A, '# Page\n');
      gitAll(root, 'clean base');
      put(root, BAD_A, broken('old.md'));
      if (state === 'staged') assert.equal(run(root, ['add', BAD_A]).status, 0);
      assertPasses(hook(root, 'claude', 'session-start'), 'first observation');
      put(root, BAD_A, `${broken('old.md')}\n[new](new.md)\n`);
      assertReturned('claude', hook(root, 'claude', 'stop'), [errorLine(BAD_A, 'new.md', 5)]);
    } finally { cleanup(root); }
  });
}

test('hook: a duplicate missing-link identity reports its surplus count in source order', () => {
  const root = makeProject();
  const before = `${broken('old.md')}\n[second](old.md)\n`;
  try {
    put(root, BAD_A, before);
    gitAll(root, 'old missing link');
    assertPasses(hook(root, 'claude', 'session-start'), 'first observation');
    assert.deepEqual(record(root, 'claude').baseline.entries, [
      { identity: [BAD_A, 'local-link.missing', 'old.md'], count: 2 },
    ]);
    put(root, BAD_A, `${before}\n[third](old.md)\n\n[fourth](old.md)\n`);
    assertReturned('claude', hook(root, 'claude', 'stop'), [
      errorLine(BAD_A, 'old.md', 7), errorLine(BAD_A, 'old.md', 9),
    ]);
  } finally { cleanup(root); }
});

test('hook: same-identity replacement with equal count is net zero', () => {
  const root = makeProject();
  try {
    put(root, BAD_A, broken('old.md'));
    gitAll(root, 'old missing link');
    assertPasses(hook(root, 'claude', 'session-start'), 'first observation');
    put(root, BAD_A, '# Replaced page\n\n[replacement occurrence](old.md)\n');
    assertPasses(hook(root, 'claude', 'stop'), 'equal-count identity replacement');
  } finally { cleanup(root); }
});

test('hook: a foreign post-start missing-link commit stays reportable', () => {
  const root = session('claude');
  try {
    assertPasses(hook(root, 'claude', 'session-start', { stdin: { session_id: 'other-session' } }), 'other session');
    put(root, BAD_A, broken('foreign.md'));
    gitAll(root, 'synthetic other session work');
    assert.equal(run(root, ['status', '--porcelain']).stdout, '');
    assertReturned('claude', hook(root, 'claude', 'stop'), [errorLine(BAD_A, 'foreign.md')]);
  } finally { cleanup(root); }
});

test('hook: repeated same-session start preserves the first baseline while resetting returns', () => {
  const root = makeProject();
  try {
    put(root, BAD_A, broken('old.md'));
    gitAll(root, 'old missing link');
    assertPasses(hook(root, 'claude', 'session-start'), 'first observation');
    const first = record(root, 'claude');
    put(root, BAD_A, `${broken('old.md')}\n[new](new.md)\n`);
    assertReturned('claude', hook(root, 'claude', 'stop'), [errorLine(BAD_A, 'new.md', 5)]);
    gitAll(root, 'own work after first observation');
    assertPasses(hook(root, 'claude', 'session-start'), 'repeated start');
    const repeated = record(root, 'claude');
    assert.equal(repeated.start, first.start);
    assert.equal(repeated.time, first.time);
    assert.deepEqual(repeated.baseline, first.baseline);
    assert.equal(repeated.returns, undefined);
    assertReturned('claude', hook(root, 'claude', 'stop'), [errorLine(BAD_A, 'new.md', 5)]);
  } finally { cleanup(root); }
});

test('hook: a new session id observes its own untracked baseline', () => {
  const root = session('claude');
  try {
    put(root, BAD_A, broken('old.md'));
    const stdin = { session_id: 'new-observation' };
    assertPasses(hook(root, 'claude', 'session-start', { stdin }), 'new observation');
    put(root, BAD_A, `${broken('old.md')}\nHarmless prose.\n`);
    assertPasses(hook(root, 'claude', 'stop', { stdin }), 'new id suppresses observed debt');
    assertReturned('claude', hook(root, 'claude', 'stop'), [errorLine(BAD_A, 'old.md')]);
  } finally { cleanup(root); }
});

for (const [variant, alter] of [
  ['legacy', (rec) => { delete rec.baseline; }],
  ['unavailable', (rec) => { rec.baseline = null; }],
  ['unsupported schema', (rec) => { rec.baseline.version = 2; }],
  ['incompatible fingerprint', (rec) => { rec.baseline.fingerprint = 'another tool or config'; }],
  ['invalid entries', (rec) => { rec.baseline.entries = [null]; }],
  ['unsupported identity', (rec) => { rec.baseline.entries[0].identity[1] = 'another-rule'; }],
  ['invalid count', (rec) => { rec.baseline.entries[0].count = 0; }],
  ['fractional count', (rec) => { rec.baseline.entries[0].count = 1.5; }],
  ['duplicate entry', (rec) => { rec.baseline.entries.push(rec.baseline.entries[0]); }],
]) {
  test(`hook: ${variant} baseline falls back without losing the valid first start or learning late`, () => {
    const root = makeProject();
    try {
      put(root, BAD_A, broken('old.md'));
      gitAll(root, 'old missing link');
      assertPasses(hook(root, 'claude', 'session-start'), 'first observation');
      const first = record(root, 'claude');
      alter(first);
      writeFileSync(recordFile(root, 'claude'), JSON.stringify(first));
      put(root, BAD_A, `${broken('old.md')}\n[new](new.md)\n`);
      gitAll(root, 'own work after first observation');
      assertPasses(hook(root, 'claude', 'session-start'), 'resume with unavailable suppression');
      const resumed = record(root, 'claude');
      assert.equal(resumed.start, first.start);
      assert.equal(resumed.time, first.time);
      assert.deepEqual(resumed.baseline, first.baseline);
      assertReturned('claude', hook(root, 'claude', 'stop'), [
        errorLine(BAD_A, 'new.md', 5), errorLine(BAD_A, 'old.md'),
      ]);
    } finally { cleanup(root); }
  });
}

test('hook: the exact serialized baseline budget works and one byte over falls back', () => {
  const root = makeProject();
  try {
    put(root, BAD_A, broken('old.md'));
    gitAll(root, 'old missing link');
    assertPasses(hook(root, 'claude', 'session-start'), 'first observation');
    const first = record(root, 'claude');
    const extra = { identity: [BAD_A, 'local-link.missing', 'padding'], count: 1 };
    first.baseline.entries.push(extra);
    const remaining = 1024 * 1024 - Buffer.byteLength(JSON.stringify(first.baseline));
    extra.identity[2] += 'x'.repeat(remaining);
    assert.equal(Buffer.byteLength(JSON.stringify(first.baseline)), 1024 * 1024);
    writeFileSync(recordFile(root, 'claude'), JSON.stringify(first));
    put(root, BAD_A, `${broken('old.md')}\nHarmless prose.\n`);
    assertPasses(hook(root, 'claude', 'stop'), 'exact budget');
    extra.identity[2] += 'x';
    assert.equal(Buffer.byteLength(JSON.stringify(first.baseline)), 1024 * 1024 + 1);
    writeFileSync(recordFile(root, 'claude'), JSON.stringify(first));
    assertReturned('claude', hook(root, 'claude', 'stop'), [errorLine(BAD_A, 'old.md')]);
    assert.equal(record(root, 'claude').start, first.start);
  } finally { cleanup(root); }
});

test('hook: oversized capture leaves a usable start and never learns a partial or late baseline', () => {
  const root = makeProject();
  try {
    gitAll(root, 'clean base');
    const start = head(root);
    const links = Array.from({ length: 6000 }, (_, i) => `[link](missing-${i}-${'x'.repeat(128)}.md)`);
    put(root, BAD_A, `# Page\n\n${links.join('\n')}\n`);
    const note = noteOf('claude', hook(root, 'claude', 'session-start'));
    assert.ok(note.includes(ru('missing-link baseline exceeds {limit} bytes; using changed-file filtering', { limit: 1024 * 1024 })));
    const first = record(root, 'claude');
    assert.equal(first.start, start);
    assert.equal(first.baseline, null);
    put(root, BAD_A, broken('old.md'));
    gitAll(root, 'own committed missing link');
    assertPasses(hook(root, 'claude', 'session-start'), 'resume after oversized observation');
    assert.deepEqual(record(root, 'claude'), first);
    assertReturned('claude', hook(root, 'claude', 'stop'), [errorLine(BAD_A, 'old.md')]);
  } finally { cleanup(root); }
});

test('hook: a failed capture keeps the coarse start and remains unavailable on resume', {
  skip: process.platform === 'win32' || process.getuid?.() === 0
    ? 'requires directory permissions that deny reads to the current process' : false,
}, () => {
  const root = makeProject();
  const locked = path.join(root, 'docs', 'reference', 'locked');
  try {
    put(root, BAD_A, broken('old.md'));
    gitAll(root, 'old missing link');
    mkdirSync(locked);
    chmodSync(locked, 0o000);
    assert.match(noteOf('claude', hook(root, 'claude', 'session-start')), /locked/);
    const first = record(root, 'claude');
    assert.equal(first.start, head(root));
    assert.equal(first.baseline, null);
    assertPasses(hook(root, 'claude', 'session-start'), 'resume does not rerun failed capture');
    assert.deepEqual(record(root, 'claude'), first);
    chmodSync(locked, 0o755);
    put(root, BAD_A, `${broken('old.md')}\nHarmless prose.\n`);
    gitAll(root, 'own committed prose');
    assertReturned('claude', hook(root, 'claude', 'stop'), [errorLine(BAD_A, 'old.md')]);
  } finally {
    chmodSync(locked, 0o755);
    cleanup(root);
  }
});

test('hook: unsupported diagnostics retain the current changed-file filter', () => {
  const root = makeProject();
  const target = '../README.md#missing-heading';
  try {
    put(root, BAD_A, broken(target));
    gitAll(root, 'old missing anchor');
    assertPasses(hook(root, 'claude', 'session-start'), 'first observation');
    put(root, BAD_A, `${broken(target)}\nHarmless prose.\n`);
    const message = ru('link {href}: {where} has no anchor “{fragment}” — no heading or id by that name (line {line})', {
      href: target, where: 'docs/README.md', fragment: 'missing-heading', line: 3,
    });
    assertReturned('claude', hook(root, 'claude', 'stop'), [`${BAD_A}: ${message}`]);
  } finally { cleanup(root); }
});

test('hook: language changes do not change missing-link identity compatibility', () => {
  const root = makeProject();
  try {
    put(root, BAD_A, broken('old.md'));
    gitAll(root, 'old missing link');
    assertPasses(hook(root, 'claude', 'session-start'), 'first observation');
    put(root, 'backslop.json', read(root, 'backslop.json').replace('"lang": "ru"', '"lang": "en"'));
    put(root, BAD_A, `${broken('old.md')}\nHarmless prose.\n`);
    assertPasses(hook(root, 'claude', 'stop'), 'language-independent identity');
  } finally { cleanup(root); }
});

test('hook: semantic config changes disable suppression without changing the first start', () => {
  const root = makeProject();
  try {
    put(root, BAD_A, broken('old.md'));
    gitAll(root, 'old missing link');
    assertPasses(hook(root, 'claude', 'session-start'), 'first observation');
    const first = record(root, 'claude');
    const cfg = JSON.parse(read(root, 'backslop.json'));
    cfg.gates.push('node --version');
    put(root, 'backslop.json', JSON.stringify(cfg));
    put(root, BAD_A, `${broken('old.md')}\nHarmless prose.\n`);
    gitAll(root, 'changed config and own prose');
    assertPasses(hook(root, 'claude', 'session-start'), 'resume keeps incompatible first observation');
    assert.deepEqual(record(root, 'claude').baseline, first.baseline);
    assertReturned('claude', hook(root, 'claude', 'stop'), [errorLine(BAD_A, 'old.md')]);
    assert.equal(record(root, 'claude').start, first.start);
  } finally { cleanup(root); }
});

for (const harness of HARNESSES) {
  test(`hook ${harness}: baseline delta preserves channels ceiling and suppressed-stop reset`, () => {
    const root = makeProject();
    try {
      put(root, BAD_A, broken('old.md'));
      gitAll(root, 'old missing link');
      assertPasses(hook(root, harness, 'session-start'), 'first observation');
      for (let i = 1; i <= 3; i += 1) {
        put(root, BAD_A, `${broken('old.md')}\n[new](new-${i}.md)\n`);
        assertReturned(harness, hook(root, harness, 'stop'), [errorLine(BAD_A, `new-${i}.md`, 5)]);
      }
      const lines = [errorLine(BAD_A, 'new-3.md', 5)];
      assert.equal(noteOf(harness, hook(root, harness, 'stop')), `${WARNING(3)}\n${lines[0]}`);
      put(root, BAD_A, `${broken('old.md')}\nOnly baseline debt remains.\n`);
      assertPasses(hook(root, harness, 'stop'), 'fully suppressed stop');
      assert.equal(record(root, harness).returns, null);
      put(root, BAD_A, `${broken('old.md')}\n[new](new-4.md)\n`);
      assertReturned(harness, hook(root, harness, 'stop'), [errorLine(BAD_A, 'new-4.md', 5)]);
      assert.equal(record(root, harness).returns.count, 1);
    } finally { cleanup(root); }
  });
}
