// The fixture helpers: what they promise the tests that build on them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanup, gitAll, makeProject, put } from './helpers.mjs';

test('a commit through the helpers forks no background git maintenance', () => {
  const root = makeProject();
  const dir = mkdtempSync(path.join(os.tmpdir(), 'backslop-trace-'));
  const trace = path.join(dir, 'events.json');
  try {
    put(root, 'docs/note.md', '# note\n');
    process.env.GIT_TRACE2_EVENT = trace;
    gitAll(root);
    delete process.env.GIT_TRACE2_EVENT;
    const started = readFileSync(trace, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
      .filter((event) => event.event === 'start').map((event) => event.argv.slice(1).join(' '));
    assert.ok(started.some((argv) => argv.split(' ').includes('commit')), `no commit was traced: ${started.join(' | ')}`);
    assert.deepEqual(started.filter((argv) => argv.split(' ').includes('maintenance')), []);
  } finally {
    delete process.env.GIT_TRACE2_EVENT;
    cleanup(root);
    rmSync(dir, { recursive: true, force: true });
  }
});
