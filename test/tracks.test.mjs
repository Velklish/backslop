// The tracks command: worktrees and run branches with the answer "safe to remove" or "you will
// lose work". Worktrees come from a real git: the read of the live repository state is checked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanup, cli, escapeRe, makeProject, put, ru, ruCard, ruRe, run } from './helpers.mjs';

// A report line: the listing indent in front of the message's own indent.
const row = (en, params) => `\\n {2}${ruRe(en, params).source}`;
const MERGED = '  merged into HEAD';
const NO_PENDING = '  no task commits outside HEAD';
const CLEAN = '  nothing uncommitted';
const killedBy = (cmd) => new RegExp(escapeRe(`${cmd}: ${ru('killed by {signal}', { signal: 'SIGKILL' })}`));
const NO_REPO = 'there is no git repository: worktrees and run branches cannot be listed';
const TOTALS = 'tracks: worktrees and branches {entries}, not merged {notMerged}';
const UNCHECKED = '  task commits not in HEAD: could not be checked';

// Worktrees go next to the project, not into it: inside, git complains about a nested repository,
// and the markdown walk would take their files for project files.
function beside(root, name) {
  return path.join(path.dirname(root), `${path.basename(root)}-${name}`);
}

function seedRun(root) {
  put(root, 'docs/backlog/queue/BS-1-a.md', ruCard('BS-1', 'A', { order: 10 }));
  run(root, ['add', '-A']);
  run(root, ['commit', '-qm', 'BS-1: task created']);

  // A merged track: its own branch stands on the same commit as HEAD, the tree is clean.
  run(root, ['branch', 'track-merged']);
  run(root, ['worktree', 'add', '-q', beside(root, 'merged'), 'track-merged']);

  // An unmerged track: a task commit outside HEAD plus an uncommitted file.
  run(root, ['branch', 'track-pending']);
  run(root, ['worktree', 'add', '-q', beside(root, 'pending'), 'track-pending']);
  const wt = beside(root, 'pending');
  put(wt, 'docs/backlog/queue/BS-2-b.md', ruCard('BS-2', 'B', { order: 20 }));
  run(wt, ['add', '-A']);
  run(wt, ['commit', '-qm', 'BS-2: second track work']);
  run(wt, ['commit', '-q', '--allow-empty', '-m', 'off the task prefix']);
  put(wt, 'docs/backlog/queue/BS-3-c.md', ruCard('BS-3', 'C', { order: 30 }));
}

function dropRun(root) {
  for (const name of ['merged', 'pending']) rmSync(beside(root, name), { recursive: true, force: true });
  cleanup(root);
}

test('tracks: merged and unmerged tracks differ and uncommitted work is named, as text and as --json', () => {
  const root = makeProject();
  try {
    seedRun(root);
    const r = cli(root, ['tracks']);
    assert.equal(r.code, 0, r.err);

    // The own tree is not in the listing: nobody removes behind themselves. Worktree directories
    // start with the project path, so the whole line is compared, not a substring occurrence.
    const own = root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.doesNotMatch(r.out, new RegExp(`^ {2}${own} \\(`, 'm'));

    assert.match(r.out, new RegExp(`track-merged\\)${row(MERGED)}${row(NO_PENDING)}${row(CLEAN)}`));
    assert.match(r.out, new RegExp(`track-pending\\)${row('  not merged into HEAD')}${row('  task commits not in HEAD: {pending}', { pending: 1 })}\\n {6}\\w+ BS-2: second track work`));
    // A commit without a task prefix is not in the listing — works are counted, not all edits.
    assert.doesNotMatch(r.out, /off the task prefix/);
    assert.match(r.out, new RegExp(`${ruRe('  uncommitted entries: {dirty}', { dirty: 1 }).source}\\n {6}\\?\\? docs\\/backlog\\/queue\\/BS-3-c\\.md`));
    assert.match(r.out, ruRe(TOTALS, { entries: 2, notMerged: 1 }));

    const json = cli(root, ['tracks', '--json']);
    assert.equal(json.code, 0, json.err);
    const report = JSON.parse(json.out);
    assert.equal(report.total, 2);

    const merged = report.tracks.find((t) => t.branch === 'track-merged');
    assert.equal(merged.kind, 'worktree');
    assert.equal(merged.merged, true);
    assert.deepEqual(merged.pending, []);
    assert.deepEqual(merged.dirty, [], 'a clean tree is an empty list, not null');

    const pending = report.tracks.find((t) => t.branch === 'track-pending');
    assert.equal(pending.merged, false);
    assert.equal(pending.pending.length, 1);
    assert.match(pending.pending[0], /BS-2: second track work/);
    assert.deepEqual(pending.dirty, ['?? docs/backlog/queue/BS-3-c.md']);
  } finally {
    dropRun(root);
  }
});

test('tracks: a repository without foreign worktrees and branches — an empty listing and code 0', () => {
  const root = makeProject();
  try {
    put(root, 'docs/backlog/queue/BS-1-a.md', ruCard('BS-1', 'A', { order: 10 }));
    run(root, ['add', '-A']);
    run(root, ['commit', '-qm', 'BS-1: task created']);
    const r = cli(root, ['tracks']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, ruRe(TOTALS, { entries: 0, notMerged: 0 }));
    assert.equal(JSON.parse(cli(root, ['tracks', '--json']).out).tracks.length, 0);
  } finally {
    cleanup(root);
  }
});

test('tracks: a branch without a worktree is listed by its task commits outside HEAD', () => {
  const root = makeProject();
  try {
    put(root, 'docs/backlog/queue/BS-1-a.md', ruCard('BS-1', 'A', { order: 10 }));
    run(root, ['add', '-A']);
    run(root, ['commit', '-qm', 'BS-1: task created']);

    run(root, ['checkout', '-q', '-b', 'track-branch-only']);
    run(root, ['commit', '-q', '--allow-empty', '-m', 'BS-4: branch only, no worktree']);
    // From main, not from the previous branch: else the BS-4 commit would reach it by inheritance.
    // It has no task commits of its own — not listed, although it has a commit outside HEAD.
    run(root, ['checkout', '-q', 'main']);
    run(root, ['checkout', '-q', '-b', 'no-tasks']);
    run(root, ['commit', '-q', '--allow-empty', '-m', 'an edit outside the tracker']);
    run(root, ['checkout', '-q', 'main']);

    const report = JSON.parse(cli(root, ['tracks', '--json']).out);
    const branches = report.tracks.map((t) => t.branch).sort();
    assert.deepEqual(branches, ['track-branch-only']);
    const only = report.tracks[0];
    assert.equal(only.kind, 'branch');
    assert.equal(only.path, null);
    assert.equal(only.dirty, null, 'a branch without a worktree has no tree — not "clean" but "nothing to look at"');
    assert.equal(only.pending.length, 1);
  } finally {
    cleanup(root);
  }
});

test('tracks: without a git repository — a refusal in words, not an empty listing', () => {
  const root = makeProject({ git: false });
  try {
    const r = cli(root, ['tracks']);
    assert.equal(r.code, 1);
    assert.match(r.err, ruRe(NO_REPO));
  } finally {
    cleanup(root);
  }
});

test('tracks: a task commit is recognised by its subject, not by the message body', () => {
  const root = makeProject();
  try {
    put(root, 'docs/backlog/queue/BS-1-a.md', ruCard('BS-1', 'A', { order: 10 }));
    run(root, ['add', '-A']);
    run(root, ['commit', '-qm', 'BS-1: task created']);
    run(root, ['checkout', '-q', '-b', 'track-body']);
    // A squashed commit drags the subjects of the squashed ones into its body — by the body the
    // listing would take in work whose subject has no task number.
    run(root, ['commit', '-q', '--allow-empty', '-m', 'an edit outside the tracker\n\nBS-9: a subject in the body']);
    run(root, ['checkout', '-q', 'main']);

    const report = JSON.parse(cli(root, ['tracks', '--json']).out);
    assert.deepEqual(report.tracks, [], 'a commit with the number only in the body is not a track');
  } finally {
    cleanup(root);
  }
});

test('tracks: a detached worktree is measured by its own sha, not counted as unmerged', () => {
  const root = makeProject();
  try {
    put(root, 'docs/backlog/queue/BS-1-a.md', ruCard('BS-1', 'A', { order: 10 }));
    run(root, ['add', '-A']);
    run(root, ['commit', '-qm', 'BS-1: task created']);
    run(root, ['worktree', 'add', '-q', '--detach', beside(root, 'detached'), 'HEAD']);

    const report = JSON.parse(cli(root, ['tracks', '--json']).out);
    assert.equal(report.tracks.length, 1);
    const wt = report.tracks[0];
    assert.equal(wt.branch, null, 'a detached worktree has no branch');
    assert.match(wt.head, /^[0-9a-f]+$/, 'the sha is read from porcelain');
    assert.equal(wt.merged, true, 'a detached worktree on HEAD is merged, not "unmerged"');
    assert.deepEqual(wt.pending, []);
  } finally {
    rmSync(beside(root, 'detached'), { recursive: true, force: true });
    cleanup(root);
  }
});

test('tracks: a worktree whose directory is gone is named prunable, its status is not asked', () => {
  const root = makeProject();
  try {
    put(root, 'docs/backlog/queue/BS-1-a.md', ruCard('BS-1', 'A', { order: 10 }));
    run(root, ['add', '-A']);
    run(root, ['commit', '-qm', 'init']);
    run(root, ['worktree', 'add', '-q', '-b', 'gone', beside(root, 'gone'), 'HEAD']);
    rmSync(beside(root, 'gone'), { recursive: true, force: true });
    run(root, ['worktree', 'add', '-q', '-b', 'held', beside(root, 'held'), 'HEAD']);
    run(root, ['worktree', 'lock', beside(root, 'held')]);

    const report = JSON.parse(cli(root, ['tracks', '--json']).out);
    const gone = report.tracks.find((t) => t.branch === 'gone');
    assert.equal(gone.prunable, true);
    assert.equal(gone.locked, false);
    assert.equal(gone.dirty, null);
    const held = report.tracks.find((t) => t.branch === 'held');
    assert.equal(held.prunable, false);
    assert.equal(held.locked, true);
    assert.deepEqual(held.dirty, []);

    const text = cli(root, ['tracks']);
    assert.equal(text.code, 0, text.err);
    assert.match(text.out, new RegExp(`\\(gone\\)${row(MERGED)}${row(NO_PENDING)}${row('  directory is gone — git worktree prune')}\\n`));
    assert.doesNotMatch(text.out, new RegExp(`${ruRe(UNCHECKED).source}|${ruRe('  uncommitted: could not be checked').source}`), 'the status of a gone directory is not asked');
  } finally {
    rmSync(beside(root, 'held'), { recursive: true, force: true });
    cleanup(root);
  }
});

test('tracks: the text listing names a locked worktree and says how to release it', () => {
  const root = makeProject();
  try {
    put(root, 'docs/backlog/queue/BS-1-a.md', ruCard('BS-1', 'A', { order: 10 }));
    run(root, ['add', '-A']);
    run(root, ['commit', '-qm', 'init']);
    run(root, ['worktree', 'add', '-q', '-b', 'held', beside(root, 'held'), 'HEAD']);
    run(root, ['worktree', 'lock', beside(root, 'held')]);
    run(root, ['worktree', 'add', '-q', '-b', 'free', beside(root, 'free'), 'HEAD']);

    const text = cli(root, ['tracks']);
    assert.equal(text.code, 0, text.err);
    assert.match(text.out, new RegExp(`\\(held\\)${row(MERGED)}${row(NO_PENDING)}${row(CLEAN)}${row('  locked — git worktree unlock, then remove')}\\n`));
    assert.equal(text.out.split('\n').filter((l) => l.includes(ru('  locked — git worktree unlock, then remove').trim())).length, 1, 'only the locked worktree is named');
  } finally {
    rmSync(beside(root, 'held'), { recursive: true, force: true });
    rmSync(beside(root, 'free'), { recursive: true, force: true });
    cleanup(root);
  }
});

test('tracks: a branch named like a path is read as a branch, its task commit listed', () => {
  const root = makeProject();
  try {
    put(root, 'docs/backlog/queue/BS-1-a.md', ruCard('BS-1', 'A', { order: 10 }));
    run(root, ['add', '-A']);
    run(root, ['commit', '-qm', 'init']);
    run(root, ['checkout', '-q', '-b', 'docs']);
    run(root, ['commit', '-q', '--allow-empty', '-m', 'BS-1: work on docs branch']);
    run(root, ['checkout', '-q', 'main']);

    const report = JSON.parse(cli(root, ['tracks', '--json']).out);
    assert.equal(report.tracks.length, 1);
    assert.equal(report.tracks[0].branch, 'docs');
    assert.equal(report.tracks[0].pending.length, 1);
    assert.match(report.tracks[0].pending[0], /BS-1: work on docs branch/);
  } finally {
    cleanup(root);
  }
});

test('tracks: a git log that fails reports pending as unchecked, not as empty', { skip: process.platform === 'win32' }, () => {
  const root = makeProject();
  const shim = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-git-shim-')));
  try {
    seedRun(root);
    run(root, ['branch', 'side']);
    const real = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
    writeFileSync(path.join(shim, 'git'), `#!/bin/sh\nfor a in "$@"; do [ "$a" = "$KILL_ON" ] && kill -9 $$; done\nexec "${real}" "$@"\n`, { mode: 0o755 });
    const env = { PATH: `${shim}${path.delimiter}${process.env.PATH}` };

    const json = cli(root, ['tracks', '--json'], { env: { ...env, KILL_ON: 'log' } });
    assert.equal(json.code, 0, json.err);
    const report = JSON.parse(json.out);
    assert.deepEqual(report.tracks.map((t) => [t.branch, t.pending]).sort(),
      [['side', null], ['track-merged', null], ['track-pending', null]], 'an unchecked branch is listed, not dropped');
    const text = cli(root, ['tracks'], { env: { ...env, KILL_ON: 'log' } });
    assert.equal(text.code, 0, text.err);
    assert.match(text.out, new RegExp(`track-pending\\)${row('  not merged into HEAD')}${row(UNCHECKED)}\\n`));

    const list = cli(root, ['tracks'], { env: { ...env, KILL_ON: 'worktree' } });
    assert.equal(list.code, 1, list.out);
    assert.match(list.err, killedBy('git worktree list --porcelain'));

    const refs = cli(root, ['tracks'], { env: { ...env, KILL_ON: 'for-each-ref' } });
    assert.equal(refs.code, 1, refs.out);
    assert.match(refs.err, killedBy('git for-each-ref refs/heads/'));
    assert.doesNotMatch(refs.out, ruRe(TOTALS), 'no listing is printed');

    const top = cli(root, ['tracks'], { env: { ...env, KILL_ON: '--show-toplevel' } });
    assert.equal(top.code, 1, top.out);
    assert.match(top.err, killedBy('git rev-parse --show-toplevel'));
    assert.doesNotMatch(top.err, ruRe(NO_REPO));
  } finally {
    rmSync(shim, { recursive: true, force: true });
    dropRun(root);
  }
});
