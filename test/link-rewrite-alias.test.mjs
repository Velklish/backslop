// A card listed only through a symlinked alias of its directory still has its links rewritten.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { symlinkSync } from 'node:fs';
import { cleanup, cli, gitAll, makeProject, put, read, ruCard, ruOutcome, ruResult } from './helpers.mjs';

test('mv rewrites the link of a card that the walk lists only through an alias of the status tree', { skip: process.platform === 'win32' }, () => {
  const root = makeProject({ git: false });
  try {
    put(root, 'docs/backlog/triage/BS-1-a.md', '# BS-1 · a\n');
    put(root, 'docs/backlog/queue/BS-2-b.md', '# BS-2 · b\n\nSee [a](../triage/BS-1-a.md).\n');
    put(root, 'docs/backlog/deferred/BS-3-c.md', '# BS-3 · c\n\nSee [a](../triage/BS-1-a.md).\n');
    symlinkSync(`${root}/docs/backlog`, `${root}/aa-alias`);
    const r = cli(root, ['mv', '1', 'queue']);
    assert.equal(r.code, 0, r.err);
    assert.match(read(root, 'docs/backlog/queue/BS-2-b.md'), /See \[a\]\(BS-1-a\.md\)\./);
    assert.match(read(root, 'docs/backlog/deferred/BS-3-c.md'), /See \[a\]\(\.\.\/queue\/BS-1-a\.md\)\./);
  } finally {
    cleanup(root);
  }
});

test('fold rewrites the link of a card that the walk lists only through an alias of the status tree', { skip: process.platform === 'win32' }, () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Reference\n');
    put(root, 'docs/archive/BS-1-alpha/task.md', ruCard('BS-1', 'Alpha', { area: '[x](../../reference/README.md)' }));
    put(root, 'docs/archive/BS-1-alpha/result.md', ruResult('BS-1', '2026-09-03', `${ruOutcome('completed')}. One-line summary.`));
    put(root, 'docs/backlog/queue/BS-2-b.md', '# BS-2 · b\n\nSee [done](../../archive/BS-1-alpha/result.md).\n');
    symlinkSync(`${root}/docs/backlog`, `${root}/aa-alias`);
    gitAll(root);
    const r = cli(root, ['fold', '1']);
    assert.equal(r.code, 0, r.err);
    assert.match(read(root, 'docs/backlog/queue/BS-2-b.md'), /See \[done\]\(\.\.\/\.\.\/archive\/LOG\.md#bs-1\)\./);
  } finally {
    cleanup(root);
  }
});
