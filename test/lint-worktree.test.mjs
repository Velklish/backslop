// lint in a git worktree: generated adapter outputs are gitignored, so a fresh worktree lacks them.
// A missing output or Claude stub that git ignores is skipped; every other state stays an error.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanup, cli, gitAll, put, read, run } from './helpers.mjs';

const OUTPUT = '.claude/skills/backslop-task/SKILL.md';

// A committed `init --lang en --tools claude` project and a worktree of it, added at `wt`.
function withWorktree(body) {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-wt-')));
  const main = path.join(base, 'main');
  const wt = path.join(base, 'wt');
  try {
    mkdirSync(main);
    run(main, ['init', '-q', '-b', 'main']);
    run(main, ['config', 'user.email', 'test@example.com']);
    run(main, ['config', 'user.name', 'test']);
    assert.equal(cli(main, ['init', '--lang', 'en', '--tools', 'claude']).code, 0);
    gitAll(main, 'init');
    run(main, ['worktree', 'add', '-q', wt, '-b', 'wt']);
    assert.equal(existsSync(path.join(wt, OUTPUT)), false, 'a fresh worktree has no ignored output');
    body({ main, wt, base });
  } finally {
    cleanup(base);
  }
}

test('lint worktree: a fresh worktree with ignored outputs absent is green', () => {
  withWorktree(({ wt }) => {
    const r = cli(wt, ['lint']);
    assert.equal(r.code, 0, r.err + r.out);
    assert.doesNotMatch(r.err, /is missing/);
  });
});

test('lint worktree: an absent output that git does not ignore is an error', () => {
  withWorktree(({ wt }) => {
    put(wt, '.gitignore', '');
    const r = cli(wt, ['lint']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, /generated output for adapter claude is missing — run .* init/);
    assert.match(r.err, /Claude stub is missing — run .* init/);
  });
});

test('lint worktree: an ignored stub does not hide a missing output that git does not ignore', () => {
  withWorktree(({ wt }) => {
    put(wt, '.gitignore', '/CLAUDE.md\n');
    const r = cli(wt, ['lint']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, /generated output for adapter claude is missing/);
    assert.doesNotMatch(r.err, /Claude stub is missing/);
  });
});

test('lint worktree: an output that was committed and then deleted is an error', () => {
  withWorktree(({ main }) => {
    assert.equal(cli(main, ['init']).code, 0);
    run(main, ['add', '-f', OUTPUT]);
    run(main, ['commit', '-qm', 'track one output']);
    rmSync(path.join(main, OUTPUT));
    const r = cli(main, ['lint']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, /generated output for adapter claude is missing/);
  });
});

test('lint worktree: a present foreign file at an ignored output path is still an error', () => {
  withWorktree(({ wt }) => {
    put(wt, OUTPUT, '# my own skill\n');
    const r = cli(wt, ['lint']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, /a foreign file without the .* marker sits at the claude adapter output path/);
  });
});

test('lint worktree: a directory at an ignored output path is still an error', () => {
  withWorktree(({ wt }) => {
    mkdirSync(path.join(wt, OUTPUT), { recursive: true });
    const r = cli(wt, ['lint']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, /owned adapter output is not a file/);
  });
});

test('lint worktree: after init in the worktree the outputs are present and lint is green', () => {
  withWorktree(({ wt }) => {
    assert.equal(cli(wt, ['init']).code, 0);
    assert.equal(existsSync(path.join(wt, OUTPUT)), true);
    assert.equal(cli(wt, ['lint']).code, 0);
  });
});

test('lint worktree: a copy without git stays red, since no git decides the absence', () => {
  withWorktree(({ wt, base }) => {
    const copy = path.join(base, 'archive-copy');
    cpSync(wt, copy, { recursive: true, filter: (src) => path.basename(src) !== '.git' });
    assert.equal(existsSync(path.join(copy, '.git')), false);
    assert.equal(read(copy, '.gitignore').includes('/CLAUDE.md'), true);
    const r = cli(copy, ['lint']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, /generated output for adapter claude is missing/);
    assert.match(r.err, /Claude stub is missing/);
    rmSync(copy, { recursive: true, force: true });
  });
});
