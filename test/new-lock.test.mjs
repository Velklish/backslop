// `new` in sibling worktrees: real processes started together get distinct numbers, and the
// numbering lock in the git common directory is released, waited for, broken when stale, refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync, mkdtempSync, readdirSync, renameSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BIN, REPO, cleanup, cli, escapeRe, gitAll, makeProject, ru, run } from './helpers.mjs';
import { LOCK_FILE, LOCK_STALE_MS, LOCK_WAIT_MS, lockIo, takeNumberingLock, withNumberingLock } from '../lib/lock.js';
import { run as runNew } from '../lib/new.js';
import { CliError, toPosix } from '../lib/util.js';

const REFUSAL = 'another `new` holds the numbering lock {lock} and did not release it in {seconds} s: run the command again; if no backslop process is running, delete the file (a lock older than {stale} s is removed by the next `new` on its own)';
const NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ''} --no-warnings`.trim();

function cliAsync(cwd, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, ...args], { cwd, env: { ...process.env, NO_COLOR: '1', NODE_OPTIONS } });
    let out = '';
    let err = '';
    child.stdout.on('data', (x) => { out += x; });
    child.stderr.on('data', (x) => { err += x; });
    child.on('close', (code) => resolve({ code, out, err }));
  });
}

// A project with one committed task BS-1 and `siblings` worktrees of it; `sub` puts the project
// into `pkg/a`. `dirs` are the project directories of the main tree and of each sibling.
function fixture({ siblings, sub = false }) {
  const root = makeProject();
  const extra = mkdtempSync(path.join(os.tmpdir(), 'backslop-wt-'));
  const dirs = [root];
  const projectDir = (top) => (sub ? path.join(top, 'pkg', 'a') : top);
  if (sub) {
    mkdirSync(projectDir(root), { recursive: true });
    for (const name of ['backslop.json', 'docs']) renameSync(path.join(root, name), path.join(projectDir(root), name));
    dirs[0] = projectDir(root);
  }
  assert.equal(cli(dirs[0], ['new', 'first', '--queue']).code, 0);
  gitAll(root);
  for (let i = 0; i < siblings; i += 1) {
    const wt = path.join(extra, `w${i}`);
    run(root, ['worktree', 'add', '-q', '-b', `w${i}`, wt]);
    dirs.push(projectDir(wt));
  }
  return { root, dirs, lockPath: path.join(root, '.git', LOCK_FILE), done: () => { cleanup(root); cleanup(extra); } };
}

// Every round starts one `new` per directory together; all must succeed, no id may repeat.
async function raceRounds({ dirs, rounds, args }) {
  const ids = [];
  for (let round = 0; round < rounds; round += 1) {
    const results = await Promise.all(dirs.map((dir, i) => cliAsync(dir, ['new', `r${round}-c${i}`, ...args])));
    for (const r of results) {
      assert.equal(r.code, 0, r.err);
      ids.push(r.out.match(/✔ (BS-[\d.]+): /)[1]);
    }
  }
  assert.equal(new Set(ids).size, ids.length, `ids repeat: ${ids.join(' ')}`);
  return ids;
}

test('new: three processes started together in sibling worktrees give distinct queue numbers', async () => {
  const f = fixture({ siblings: 2 });
  try {
    await raceRounds({ dirs: f.dirs, rounds: 4, args: ['--queue'] });
    assert.equal(existsSync(f.lockPath), false, 'the lock is released');
  } finally {
    f.done();
  }
});

test('new: findings of one parent started together in sibling worktrees get distinct sub-ids', async () => {
  const f = fixture({ siblings: 2 });
  try {
    const ids = await raceRounds({ dirs: f.dirs, rounds: 3, args: ['--parent', '1', '--minor', '--evidence', 'e'] });
    assert.ok(ids.every((id) => id.startsWith('BS-1.')), ids.join(' '));
  } finally {
    f.done();
  }
});

test('new: a project in a repository subdirectory gets distinct numbers from sibling worktrees', async () => {
  const f = fixture({ siblings: 1, sub: true });
  try {
    await raceRounds({ dirs: f.dirs, rounds: 3, args: ['--queue'] });
  } finally {
    f.done();
  }
});

// A child process that takes the lock through the helper, tells it did, and holds it for `holdMs`.
function holder(root, holdMs) {
  const script = `
    import { writeSync } from 'node:fs';
    const { withNumberingLock } = await import(${JSON.stringify(pathToFileURL(path.join(REPO, 'lib', 'lock.js')).href)});
    withNumberingLock(${JSON.stringify(root)}, 'en', () => {
      writeSync(1, 'held\\n');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${holdMs});
    });`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'inherit'] });
  const held = new Promise((resolve) => child.stdout.once('data', resolve));
  const closed = new Promise((resolve) => child.on('close', resolve));
  return { child, held, closed };
}

test('new: a caller that finds the lock taken waits for its release and then takes the next number', async () => {
  const f = fixture({ siblings: 0 });
  try {
    const h = holder(f.root, 500);
    await h.held;
    assert.ok(existsSync(f.lockPath), 'the holder owns the lock');
    const r = await cliAsync(f.dirs[0], ['new', 'waiter']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /✔ BS-2: /);
    await h.closed;
    assert.equal(existsSync(f.lockPath), false);
  } finally {
    f.done();
  }
});

test('new: a lock left by a killed process is taken over once it is older than a minute', async () => {
  const f = fixture({ siblings: 0 });
  try {
    const h = holder(f.root, 60_000);
    await h.held;
    h.child.kill('SIGKILL');
    await h.closed;
    assert.ok(existsSync(f.lockPath), 'a killed holder cannot release its lock');
    const old = new Date(Date.now() - 120_000);
    utimesSync(f.lockPath, old, old);
    const r = cli(f.dirs[0], ['new', 'after-kill']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /✔ BS-2: /);
    assert.equal(existsSync(f.lockPath), false);
    assert.equal(readdirSync(path.join(f.root, '.git')).filter((n) => n.includes('stale')).length, 0, 'no tombstone is left');
  } finally {
    f.done();
  }
});

// The deterministic part: the clock, the sleep and the file operations of lib/lock.js are the
// `lockIo` seam, so deadlines, polls and interleavings of several callers do not depend on timing.
function fakeClock() {
  let t = Math.floor(Date.now() / 1000) * 1000;
  const sleeps = [];
  return {
    sleeps,
    set: (value) => { t = value; },
    now: () => t,
    io: {
      now: () => t,
      sleep: (ms) => {
        sleeps.push(ms);
        t += ms;
        if (sleeps.length > 100_000) throw new Error('the wait is not bounded');
      },
    },
  };
}

function withIo(patch, fn) {
  const saved = { ...lockIo };
  Object.assign(lockIo, patch);
  try {
    return fn();
  } finally {
    Object.assign(lockIo, saved);
  }
}

const lockOf = (root) => path.join(root, '.git', LOCK_FILE);
const DEAD = 'dead holder\n';
const leftovers = (root) => readdirSync(path.join(root, '.git')).filter((n) => n.startsWith(LOCK_FILE));

// A lock file written by a holder that is gone, with an mtime on a whole second.
function deadLock(root, mtime = Math.floor(Date.now() / 1000) * 1000 - 600_000) {
  writeFileSync(lockOf(root), DEAD);
  utimesSync(lockOf(root), mtime / 1000, mtime / 1000);
  return mtime;
}

const isRefusal = (lock) => (e) => e instanceof CliError && e.message.includes(toPosix(lock)) && /delete the file/.test(e.message);

test('lock: a caller that observed a stale lock cannot remove the lock of the caller that took it over', () => {
  const root = makeProject();
  try {
    deadLock(root);
    const clock = fakeClock();
    let releaseA = null;
    let hooked = false;
    const trace = (point) => {
      if (point !== 'stale-seen' || hooked) return;
      hooked = true;
      releaseA = takeNumberingLock(root, 'en');
    };
    withIo({ ...clock.io, trace }, () => {
      assert.throws(() => takeNumberingLock(root, 'en', { waitMs: 1000 }), isRefusal(lockOf(root)));
      assert.ok(releaseA, 'the first caller took the stale lock over while the second still held the old observation');
      assert.notEqual(readFileSync(lockOf(root), 'utf8'), DEAD, 'the lock is the first caller\u2019s');
      assert.throws(() => takeNumberingLock(root, 'en', { waitMs: 100 }), isRefusal(lockOf(root)));
      releaseA();
    });
    assert.deepEqual(leftovers(root), [], 'no lock, claim or temporary file is left');
  } finally {
    cleanup(root);
  }
});

test('lock: two callers recovering the same stale lock do not both take it', () => {
  const root = makeProject();
  try {
    deadLock(root);
    const clock = fakeClock();
    let nested = 0;
    let release = null;
    const trace = (point) => {
      if (point !== 'claimed' || nested) return;
      nested += 1;
      assert.throws(() => takeNumberingLock(root, 'en', { waitMs: 100 }), isRefusal(lockOf(root)));
    };
    withIo({ ...clock.io, trace }, () => {
      release = takeNumberingLock(root, 'en');
    });
    assert.equal(nested, 1);
    assert.notEqual(readFileSync(lockOf(root), 'utf8'), DEAD);
    release();
    assert.deepEqual(leftovers(root), []);
  } finally {
    cleanup(root);
  }
});

test('lock: a claimant killed in the middle of a takeover is recovered once its claim is stale too', () => {
  const root = makeProject();
  try {
    deadLock(root);
    const clock = fakeClock();
    const dies = () => {
      const unlink = lockIo.unlink;
      // A killed process runs no cleanup: its claim stays.
      lockIo.unlink = (file) => (file.includes('.claim-') ? undefined : unlink(file));
      throw new Error('killed');
    };
    const real = lockIo.unlink;
    try {
      withIo({ ...clock.io, trace: (point) => { if (point === 'claimed') dies(); } }, () => {
        assert.throws(() => takeNumberingLock(root, 'en'), /killed/);
      });
    } finally {
      lockIo.unlink = real;
    }
    assert.ok(leftovers(root).some((n) => n.includes('.claim-')), 'the dead claim is on disk');
    let release;
    withIo(clock.io, () => {
      release = takeNumberingLock(root, 'en', { waitMs: 120_000 });
    });
    assert.ok(clock.sleeps.length >= 2900 && clock.sleeps.length <= 3100, `waited for the claim to age: ${clock.sleeps.length} polls`);
    assert.notEqual(readFileSync(lockOf(root), 'utf8'), DEAD);
    release();
    assert.deepEqual(leftovers(root), []);
  } finally {
    cleanup(root);
  }
});

test('lock: a takeover that fails on the file system refuses at once with the path and the cause', () => {
  const root = makeProject();
  try {
    deadLock(root);
    const clock = fakeClock();
    const denied = (what) => Object.assign(new Error(`${what}: permission denied`), { code: 'EACCES' });
    const { open } = lockIo;
    withIo({ ...clock.io, rename: () => { throw denied('rename'); } }, () => {
      assert.throws(() => takeNumberingLock(root, 'en'), (e) => e instanceof CliError && e.message.includes(toPosix(lockOf(root))) && e.message.includes('rename: permission denied'));
    });
    withIo({ ...clock.io, open: (file, flags) => { if (file.includes('.claim-')) throw denied('claim'); return open(file, flags); } }, () => {
      assert.throws(() => takeNumberingLock(root, 'en'), (e) => e instanceof CliError && e.message.includes('.claim-') && e.message.includes('claim: permission denied'));
    });
    assert.equal(clock.sleeps.length, 0, 'no waiting loop on a persistent failure');
    assert.equal(readFileSync(lockOf(root), 'utf8'), DEAD, 'the stale lock is untouched');
    assert.deepEqual(leftovers(root), [LOCK_FILE]);
  } finally {
    cleanup(root);
  }
});

test('lock: a write that fails after the file was created leaves no orphan lock', () => {
  const root = makeProject();
  try {
    withIo({ write: () => { throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' }); } }, () => {
      assert.throws(() => takeNumberingLock(root, 'en'), (e) => e instanceof CliError && e.message.includes('no space left'));
    });
    assert.deepEqual(leftovers(root), []);
    takeNumberingLock(root, 'en')();
  } finally {
    cleanup(root);
  }
});

test('lock: `new` with the default policy polls every 20 ms for 10 s, then refuses and writes nothing', async () => {
  const root = makeProject();
  try {
    writeFileSync(lockOf(root), 'another holder\n');
    const clock = fakeClock();
    const before = readdirSync(path.join(root, 'docs/backlog/triage'));
    const saved = { ...lockIo };
    Object.assign(lockIo, clock.io);
    try {
      await assert.rejects(runNew(['x'], { cwd: root, lang: 'ru' }), (e) => {
        assert.ok(e instanceof CliError);
        assert.equal(e.message, ru(REFUSAL, { lock: toPosix(lockOf(root)), seconds: 10, stale: 60 }));
        return true;
      });
    } finally {
      Object.assign(lockIo, saved);
    }
    assert.equal(clock.sleeps.length, 500);
    assert.ok(clock.sleeps.every((ms) => ms === 20), 'every poll is 20 ms');
    assert.deepEqual(readdirSync(path.join(root, 'docs/backlog/triage')), before);
    assert.equal(readFileSync(lockOf(root), 'utf8'), 'another holder\n', 'a lock that is not stale stays');
    assert.equal(LOCK_WAIT_MS, 10_000);
    assert.equal(LOCK_STALE_MS, 60_000);
  } finally {
    cleanup(root);
  }
});

test('lock: a lock is stale only when it is older than 60 s', () => {
  const root = makeProject();
  try {
    const mtime = deadLock(root);
    const clock = fakeClock();
    clock.set(mtime + 60_000);
    withIo(clock.io, () => {
      assert.throws(() => takeNumberingLock(root, 'en', { waitMs: 0 }), isRefusal(lockOf(root)));
    });
    assert.equal(readFileSync(lockOf(root), 'utf8'), DEAD, 'exactly 60 s is not stale');
    clock.set(mtime + 60_001);
    withIo(clock.io, () => takeNumberingLock(root, 'en', { waitMs: 0 })());
    assert.deepEqual(leftovers(root), [], '60.001 s is stale: taken over and released');
  } finally {
    cleanup(root);
  }
});

test('new: the lock is released after a refusal and after a success', () => {
  const root = makeProject();
  try {
    const lock = path.join(root, '.git', LOCK_FILE);
    assert.equal(cli(root, ['new', 'x', '--parent', '99']).code, 1);
    assert.equal(existsSync(lock), false, 'released after a refusal');
    assert.equal(cli(root, ['new', 'y']).code, 0);
    assert.equal(existsSync(lock), false, 'released after a success');
  } finally {
    cleanup(root);
  }
});

test('new: a project outside a git repository takes no lock and numbers as before', () => {
  const root = makeProject({ git: false });
  try {
    let r = cli(root, ['new', 'a']);
    assert.equal(r.code, 0, r.err);
    r = cli(root, ['new', 'b']);
    assert.match(r.out, /✔ BS-2: /);
    assert.equal(withNumberingLock(root, 'en', () => 'ran'), 'ran');
    assert.deepEqual(readdirSync(root).filter((n) => n.includes('lock')), []);
  } finally {
    cleanup(root);
  }
});

test('new: a path the card would take is never overwritten', () => {
  const root = makeProject();
  try {
    mkdirSync(path.join(root, 'docs/backlog/triage/BS-1-a.md'));
    const r = cli(root, ['new', 'a']);
    assert.equal(r.code, 1);
    assert.match(r.err, new RegExp(escapeRe(ru('{file} already exists and is not overwritten', { file: 'docs/backlog/triage/BS-1-a.md' }))));
    assert.equal(existsSync(path.join(root, '.git', LOCK_FILE)), false);
  } finally {
    cleanup(root);
  }
});

test('the lock policy in the docs, the rules templates and the changelog names the code constants', () => {
  const wait = `${LOCK_WAIT_MS / 1000} seconds`;
  const stale = `${LOCK_STALE_MS / 1000} seconds`;
  const read = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
  const numbersLine = (rel) => read(rel).split('\n').find((l) => l.startsWith('- **Numbers are sequential'));
  for (const rel of ['docs/reference/01-layout.md', 'docs/reference/02-cli.md', 'docs/adr/adr-050-process.md']) {
    assert.ok(read(rel).includes(wait) && read(rel).includes(stale), `${rel} states the wait and the stale age`);
    assert.ok(read(rel).includes(LOCK_FILE) || rel.endsWith('02-cli.md'), `${rel} names the lock file`);
  }
  assert.ok(read('CHANGELOG.md').includes(LOCK_FILE), 'the changelog names the lock file');
  for (const rel of ['docs/reference/01-layout.md', 'docs/adr/adr-050-process.md']) assert.ok(read(rel).includes('claim'), `${rel} describes the claim of a stale takeover`);
  for (const rel of ['templates/en/docs/backlog/README.md', 'docs/backlog/README.md']) {
    assert.match(numbersLine(rel), new RegExp(`${LOCK_WAIT_MS / 1000} seconds.*lock.*a minute`), `${rel} states the policy`);
  }
  const ruLine = read('templates/docs/backlog/README.md').split('\n').find((l) => l.startsWith('- **') && l.includes('{{cli}} new'));
  assert.match(ruLine, new RegExp(`\\b${LOCK_WAIT_MS / 1000}\\b`), 'the Russian twin states the wait in seconds');
});
