// Offline evidence consistency check: does not launch Git, the CLI or a test suite.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const output = path.resolve(process.argv[2]);
const json = (name) => JSON.parse(readFileSync(path.join(output, name), 'utf8'));
const summary = json('summary.json');
const cases = json('cases.json');
const commands = readFileSync(path.join(output, 'commands.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const byId = new Map(commands.map((r) => [r.id, r]));
assert.equal(commands.length, summary.commands);
assert.equal(cases.length, summary.fixtures);
assert.equal(new Set(commands.map((r) => r.id)).size, commands.length);
for (const receipt of commands) {
  assert.equal(receipt.exitCode, receipt.expectedExitCode, receipt.id);
  assert.equal(receipt.signal, null, receipt.id);
  assert.equal(receipt.launchError, null, receipt.id);
  const prefix = path.join(output, 'receipts', receipt.id);
  assert.deepEqual(JSON.parse(readFileSync(`${prefix}.json`, 'utf8')), receipt);
  for (const field of ['stdin', 'stdout', 'stderr']) {
    assert.equal(readFileSync(`${prefix}.${field}`, 'utf8'), receipt[field], `${receipt.id}: ${field}`);
  }
}

const lookup = (e, key) => byId.get(e.commands[key]);
const byCase = new Map(cases.map((e) => [e.name, e]));
const fix = 'fix these errors in the files named above; do not bypass the hook';
for (const e of cases) {
  const harness = e.name.endsWith('-cursor') ? 'cursor' : e.name.endsWith('-codex') ? 'codex' : 'claude';
  const start = lookup(e, `${harness}Start-generic-primary`);
  assert.equal(start.exitCode, 0);
  assert.equal(start.stdout + start.stderr, '');
  assert.equal(JSON.parse(start.stdin).session_id, 'generic-primary');
  const text = [...new Set(e.afterDiagnostics.map((d) => `${d.file}: ${d.msg}`))].sort().concat(fix).join('\n') + '\n';
  const stop = lookup(e, `${harness}Stop1`);
  if (harness === 'cursor') {
    assert.equal(stop.exitCode, 0);
    assert.equal(stop.stderr, '');
    assert.deepEqual(JSON.parse(stop.stdout), { followup_message: text.trimEnd() });
  } else {
    assert.equal(stop.exitCode, 2);
    assert.equal(stop.stdout, '');
    assert.equal(stop.stderr, text);
  }
  assert.equal(e.snapshots[`${harness}RecordAtStart`].start, e.baselineCommit);
  assert.equal(e.snapshots[`${harness}RecordAfterStop1`].returns.count, 1);
  for (const mutation of e.mutations) {
    assert.equal(createHash('sha256').update(mutation.utf8).digest('hex'), mutation.sha256);
  }
  if (e.name.startsWith('08-')) {
    for (const n of [2, 3]) {
      const next = lookup(e, `${harness}Stop${n}`);
      assert.equal(next.stdout, stop.stdout);
      assert.equal(next.stderr, stop.stderr);
      assert.equal(e.snapshots[`${harness}RecordAfterStop${n}`].returns.count, n);
    }
    const fourth = lookup(e, `${harness}Stop4`);
    assert.equal(fourth.exitCode, 0);
    const note = harness === 'cursor' ? fourth.stderr.trimEnd() : JSON.parse(fourth.stdout).systemMessage;
    assert.equal(note, `lint errors in changed files were reported 3 times in a row; the hook now exits 0, the errors stay:\n${e.afterDiagnostics.map((d) => `${d.file}: ${d.msg}`).join('\n')}`);
    assert.equal(e.snapshots[`${harness}RecordAfterStop4`].returns.count, 3);
    assert.equal(e.snapshots[`${harness}RecordAfterStopclean`].returns, null);
    assert.equal(e.snapshots[`${harness}RecordAfterStopafter-reset`].returns.count, 1);
    const invalid = lookup(e, `${harness}Stopbad-payload`);
    const invalidNote = harness === 'cursor' ? invalid.stderr.trimEnd() : JSON.parse(invalid.stdout).systemMessage;
    assert.equal(invalidNote, 'hook skipped: the event on stdin is not a JSON object with a session_id');
  }
}

for (const name of ['02-other-session-commit', '03-own-session-commit']) {
  const e = byCase.get(name);
  if (!e) continue;
  assert.equal(lookup(e, 'status').stdout, '');
  assert.equal(lookup(e, 'fromHead').stdout, '');
  assert.equal(lookup(e, 'fromStart').stdout, 'docs/reference/sample.md\n');
  assert.notEqual(e.introducingCommit, e.baselineCommit);
}
if (byCase.has('06-staged-error-control')) assert.equal(lookup(byCase.get('06-staged-error-control'), 'status').stdout, 'M  docs/reference/sample.md\n');
if (byCase.has('07-untracked-error-control')) {
  const e = byCase.get('07-untracked-error-control');
  assert.equal(lookup(e, 'status').stdout, '?? docs/reference/untracked.md\n');
  assert.equal(lookup(e, 'fromStart').stdout, '');
  assert.equal(lookup(e, 'untracked').stdout, 'docs/reference/untracked.md\n');
}
const comparisons = new Map(json('candidate-comparisons.json').map((e) => [e.case, e]));
for (const [name, raw, semantic] of [
  ['01-old-error-harmless-edit', 0, 0], ['02-other-session-commit', 1, 1],
  ['03-own-session-commit', 1, 1], ['04-line-insertion-before-old-error', 1, 0],
  ['05-new-error-in-already-red-file', 1, 1], ['09-duplicate-error-count', 1, 1],
  ['10-replaced-identical-error', 0, 0], ['11-dirty-at-session-start', 0, 0],
]) {
  const item = comparisons.get(name);
  if (!item) continue;
  assert.equal(item.rawMessageMultisetNew.length, raw);
  assert.equal(item.semanticBrokenLinkMultisetNew.length, semantic);
}
assert.equal(summary.sourceSha, summary.sourceShaAfter);
assert.equal(summary.sourceCleanBefore, true);
assert.equal(summary.sourceCleanAfter, true);
const result = { kind: 'offline-evidence-consistency', commandsChecked: commands.length, fixturesChecked: cases.length, status: 'passed', launchesSourceCli: false, sourceSha: summary.sourceSha };
writeFileSync(path.join(output, 'offline-verification.json'), `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(result)}\n`);
