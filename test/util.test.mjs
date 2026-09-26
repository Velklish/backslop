// Shared helpers of lib/util.js that several commands lean on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CliError, insideRepo, isSameTree, lsFiles, porcelainPaths } from '../lib/util.js';
import { scannedCode } from './comment-scan.mjs';
import { cleanup, gitAll, makeProject, put, run } from './helpers.mjs';

// Runs `fn` with process.env patched; git inherits the environment of this process.
function withEnv(patch, fn) {
  const saved = Object.fromEntries(Object.keys(patch).map((key) => [key, process.env[key]]));
  Object.assign(process.env, patch);
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('insideRepo: a repository is true; no repository and no git binary are false', () => {
  const repo = makeProject();
  const plain = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-plain-')));
  const empty = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-nogit-')));
  try {
    assert.equal(insideRepo(repo), true);
    assert.equal(withEnv({ GIT_CEILING_DIRECTORIES: path.dirname(plain) }, () => insideRepo(plain)), false);
    assert.equal(withEnv({ PATH: empty }, () => insideRepo(repo)), false);
  } finally {
    cleanup(repo);
    rmSync(plain, { recursive: true, force: true });
    rmSync(empty, { recursive: true, force: true });
  }
});

test('insideRepo: any other git failure is a CliError with the git cause', { skip: process.platform === 'win32' }, () => {
  const repo = makeProject();
  const shim = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-git-shim-')));
  try {
    const owner = { GIT_TEST_ASSUME_DIFFERENT_OWNER: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
    assert.throws(() => withEnv(owner, () => insideRepo(repo, 'en')),
      (e) => e instanceof CliError && /^git rev-parse --is-inside-work-tree: fatal: detected dubious ownership/.test(e.message));
    writeFileSync(path.join(shim, 'git'), '#!/bin/sh\nkill -9 $$\n', { mode: 0o755 });
    assert.throws(() => withEnv({ PATH: `${shim}${path.delimiter}${process.env.PATH}` }, () => insideRepo(repo, 'en')),
      (e) => e instanceof CliError && e.message === 'git rev-parse --is-inside-work-tree: killed by SIGKILL');
    writeFileSync(path.join(shim, 'git'), '#!/bin/sh\necho "fatal: not a git repository" >&2\nexit 1\n', { mode: 0o755 });
    assert.throws(() => withEnv({ PATH: `${shim}${path.delimiter}${process.env.PATH}` }, () => insideRepo(repo, 'en')),
      (e) => e instanceof CliError && e.message === 'git rev-parse --is-inside-work-tree: fatal: not a git repository',
      'only exit 128 with that text means no repository');
  } finally {
    cleanup(repo);
    rmSync(shim, { recursive: true, force: true });
  }
});

test('isSameTree: realpath when both sides resolve; two unresolved paths never match', () => {
  const raw = mkdtempSync(path.join(os.tmpdir(), 'backslop-tree-'));
  try {
    assert.equal(isSameTree(raw, `${raw}/.`), true);
    assert.equal(isSameTree(raw, realpathSync(raw)), true, 'a symlinked tmpdir is the same tree');
    assert.equal(isSameTree(path.join(raw, 'gone'), path.join(raw, 'gone')), false, 'two missing paths');
    assert.equal(isSameTree(raw, path.join(raw, 'gone')), false);
  } finally {
    rmSync(raw, { recursive: true, force: true });
  }
});

test('porcelainPaths: files from the repository root, both names of a rename, non-ASCII unquoted', () => {
  const root = makeProject();
  const plain = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-plain-')));
  try {
    put(root, 'docs/old.md', 'old\n');
    gitAll(root);
    run(root, ['mv', 'docs/old.md', 'docs/new.md']);
    put(root, 'docs/тест.md', 'new\n');
    put(root, 'notes/deep/a.md', 'untracked\n');
    assert.deepEqual(porcelainPaths(root).sort(), ['docs/new.md', 'docs/old.md', 'docs/тест.md', 'notes/deep/a.md'].sort());
    assert.equal(withEnv({ GIT_CEILING_DIRECTORIES: path.dirname(plain) }, () => porcelainPaths(plain)), null);
  } finally {
    cleanup(root);
    rmSync(plain, { recursive: true, force: true });
  }
});

test('lsFiles: a non-ASCII path arrives unquoted; a git failure is a CliError', () => {
  const root = makeProject();
  const plain = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-plain-')));
  try {
    put(root, 'lib/a.js', '');
    put(root, 'lib/тест.js', '');
    run(root, ['add', 'lib']);
    put(root, 'lib/new.js', '');
    assert.deepEqual(lsFiles(root, ['lib']), ['lib/a.js', 'lib/тест.js']);
    assert.deepEqual(lsFiles(root, ['lib'], ['--others', '--exclude-standard']), ['lib/new.js']);
    assert.throws(() => withEnv({ GIT_CEILING_DIRECTORIES: path.dirname(plain) }, () => lsFiles(plain, ['lib'], [], 'en')),
      (e) => e instanceof CliError && e.message.startsWith('git ls-files -z -- lib: '));
  } finally {
    cleanup(root);
    rmSync(plain, { recursive: true, force: true });
  }
});

test('scannedCode: a staged non-ASCII file is judged, a tracked file deleted from the tree is not', () => {
  const root = makeProject();
  try {
    put(root, 'lib/a.js', '');
    put(root, 'lib/тест.js', '');
    put(root, 'lib/gone.js', '');
    run(root, ['add', 'lib']);
    rmSync(path.join(root, 'lib/gone.js'));
    assert.deepEqual(scannedCode(root, ['lib']), { files: ['lib/a.js', 'lib/тест.js'], empty: [] });
  } finally {
    cleanup(root);
  }
});
