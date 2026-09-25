// Shared helpers of lib/util.js that several commands lean on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CliError, insideRepo } from '../lib/util.js';
import { cleanup, makeProject } from './helpers.mjs';

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
