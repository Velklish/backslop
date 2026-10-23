// Research fixtures only: this script never edits the source checkout.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [sourceArg, outputArg] = process.argv.slice(2);
assert(sourceArg && outputArg, 'usage: node reproduce.mjs <absolute-source-checkout> <new-output-directory>');
const source = path.resolve(sourceArg);
const output = path.resolve(outputArg);
assert(!existsSync(output), 'use a new output directory so earlier evidence cannot be overwritten');
mkdirSync(output, { recursive: true });
const receiptsDir = path.join(output, 'receipts');
mkdirSync(receiptsDir);
const fixtureRoot = mkdtempSync('/private/tmp/backslop-hook-research-');
const bin = path.join(source, 'bin/backslop.js');
const inspector = fileURLToPath(new URL('./inspect-lint.mjs', import.meta.url));
const receipts = [];
const cases = [];
let sequence = 0;
const env = { ...process.env, NO_COLOR: '1', NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --no-warnings`.trim() };
const configs = Number(env.GIT_CONFIG_COUNT ?? 0);
env[`GIT_CONFIG_KEY_${configs}`] = 'maintenance.auto';
env[`GIT_CONFIG_VALUE_${configs}`] = 'false';
env.GIT_CONFIG_COUNT = String(configs + 1);
const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
const hash = (text) => createHash('sha256').update(text).digest('hex');
const save = (name, value) => writeFileSync(path.join(output, name), `${JSON.stringify(value, null, 2)}\n`);

function run(label, cwd, executable, args, { stdin = '', expected = 0 } = {}) {
  const id = `${String(++sequence).padStart(3, '0')}-${label.replace(/[^a-z0-9-]/gi, '-')}`;
  const result = spawnSync(executable, args, { cwd, input: stdin, encoding: 'utf8', env });
  const receipt = {
    id, label, cwd, executable, argv: args,
    command: [executable, ...args].map(quote).join(' '),
    stdin, stdout: result.stdout ?? '', stderr: result.stderr ?? '',
    exitCode: result.status, signal: result.signal, launchError: result.error?.message ?? null,
    expectedExitCode: expected,
  };
  receipts.push(receipt);
  writeFileSync(path.join(receiptsDir, `${id}.stdin`), stdin);
  writeFileSync(path.join(receiptsDir, `${id}.stdout`), receipt.stdout);
  writeFileSync(path.join(receiptsDir, `${id}.stderr`), receipt.stderr);
  writeFileSync(path.join(receiptsDir, `${id}.json`), `${JSON.stringify(receipt, null, 2)}\n`);
  writeFileSync(path.join(output, 'commands.jsonl'), receipts.map((item) => JSON.stringify(item)).join('\n') + '\n');
  assert.equal(result.error, undefined, `${id}: launch failed`);
  assert.equal(result.signal, null, `${id}: process received a signal`);
  assert.equal(result.status, expected, `${id}: unexpected direct exit; see ${id}.json`);
  return receipt;
}

function git(label, root, args, options) { return run(label, root, 'git', args, options); }
function cli(label, root, args, options) { return run(label, root, process.execPath, [bin, ...args], options); }
function put(root, rel, text, evidence) {
  const file = path.join(root, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  if (evidence) evidence.mutations.push({ file: rel, utf8: text, sha256: hash(text), actor: evidence.nextActor ?? 'primary-session' });
}
function commit(root, message) {
  git('git-add-all', root, ['add', '-A']);
  git('git-commit', root, ['commit', '-qm', message]);
  return git('git-head', root, ['rev-parse', 'HEAD']).stdout.trim();
}
function fixture(name, initialText) {
  const root = path.join(fixtureRoot, name);
  mkdirSync(root);
  for (const args of [
    ['init', '-q', '-b', 'main'], ['config', 'user.email', 'fixture@example.invalid'],
    ['config', 'user.name', 'Generic Fixture'], ['config', 'commit.gpgsign', 'false'],
    ['config', 'core.hooksPath', path.join(root, '.git', 'disabled-hooks')],
  ]) git('fixture-git-setup', root, args);
  const version = JSON.parse(readFileSync(path.join(source, 'package.json'), 'utf8')).version;
  put(root, 'backslop.json', JSON.stringify({ prefix: 'GP', docs: 'docs', cli: `node ${quote(bin)}`, gates: [], lang: 'en', tools: [], version }, null, 2) + '\n');
  for (const dir of ['triage', 'queue', 'active', 'deferred', 'minor']) mkdirSync(path.join(root, 'docs/backlog', dir), { recursive: true });
  for (const dir of ['archive', 'adr', 'reference']) mkdirSync(path.join(root, 'docs', dir), { recursive: true });
  put(root, 'docs/README.md', '# Documentation\n\n| Document | Topic | Status |\n|---|---|---|\n| [backlog/](backlog/README.md) | tracker | Live |\n');
  put(root, 'docs/backlog/README.md', '# Backlog\n');
  put(root, 'docs/archive/README.md', '# Archive\n');
  put(root, 'docs/reference/sample.md', initialText);
  const baselineCommit = commit(root, 'Generic fixture baseline');
  const evidence = { name, root, baselineCommit, mutations: [], snapshots: {}, commands: {} };
  evidence.snapshots.baselineSample = initialText;
  cases.push(evidence);
  return evidence;
}
function lint(evidence, phase, expected) {
  evidence.commands[`${phase}Lint`] = cli(`${evidence.name}-${phase}-lint`, evidence.root, ['lint'], { expected }).id;
  const receipt = run(`${evidence.name}-${phase}-diagnostics`, evidence.root, process.execPath, [inspector, source, evidence.root]);
  evidence.commands[`${phase}StructuredDiagnostics`] = receipt.id;
  evidence[`${phase}Diagnostics`] = JSON.parse(receipt.stdout).errors;
}
function payload(harness, event, session = 'generic-primary') {
  return JSON.stringify(harness === 'cursor'
    ? { session_id: session, conversation_id: session, hook_event_name: event === 'stop' ? 'stop' : 'sessionStart', loop_count: 0 }
    : { session_id: session, hook_event_name: event === 'stop' ? 'Stop' : 'SessionStart', stop_hook_active: false }) + '\n';
}
function record(evidence, harness, suffix = '') {
  const file = path.join(evidence.root, '.git/backslop/hooks', `${harness}-generic-primary.json`);
  evidence.snapshots[`${harness}Record${suffix}`] = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}
function start(evidence, harness = 'claude', session = 'generic-primary') {
  const receipt = cli(`${evidence.name}-${harness}-session-start-${session}`, evidence.root, ['hook', 'session-start', '--harness', harness], { stdin: payload(harness, 'session-start', session) });
  evidence.commands[`${harness}Start-${session}`] = receipt.id;
  record(evidence, harness, 'AtStart');
}
function stop(evidence, harness = 'claude', suffix = '1', expected = harness === 'cursor' ? 0 : 2, stdin) {
  const receipt = cli(`${evidence.name}-${harness}-stop-${suffix}`, evidence.root, ['hook', 'stop', '--harness', harness], { stdin: stdin ?? payload(harness, 'stop'), expected });
  evidence.commands[`${harness}Stop${suffix}`] = receipt.id;
  record(evidence, harness, `AfterStop${suffix}`);
  return receipt;
}
function state(evidence) {
  evidence.commands.status = git(`${evidence.name}-git-status`, evidence.root, ['status', '--porcelain=v1', '--untracked-files=all']).id;
  evidence.commands.log = git(`${evidence.name}-git-log`, evidence.root, ['log', '--format=%H %P %an <%ae> %s']).id;
  const start = evidence.snapshots.claudeRecordAtStart?.start ?? evidence.snapshots.cursorRecordAtStart?.start ?? evidence.snapshots.codexRecordAtStart?.start;
  if (start) evidence.commands.fromStart = git(`${evidence.name}-git-diff-start`, evidence.root, ['diff', '--name-only', '--no-renames', start, '--']).id;
  evidence.commands.fromHead = git(`${evidence.name}-git-diff-head`, evidence.root, ['diff', '--name-only', '--no-renames', 'HEAD', '--']).id;
  evidence.commands.untracked = git(`${evidence.name}-git-untracked`, evidence.root, ['ls-files', '--others', '--exclude-standard']).id;
  evidence.snapshots.finalSample = readFileSync(path.join(evidence.root, 'docs/reference/sample.md'), 'utf8');
}

const baseline = '# Sample\n\n[old](missing-old.md)\n';
const clean = '# Sample\n\nPlain text.\n';
const sourceBefore = git('source-status-before', source, ['status', '--porcelain=v1', '--untracked-files=all']);
assert.equal(sourceBefore.stdout, '', 'source must be clean');
const sourceSha = git('source-head-before', source, ['rev-parse', 'HEAD']).stdout.trim();
const sourceBranch = git('source-branch', source, ['branch', '--show-current']).stdout.trim();
const versions = { node: run('node-version', source, process.execPath, ['--version']).stdout.trim(), git: git('git-version', source, ['--version']).stdout.trim() };
save('environment.json', { source, sourceSha, sourceBranch, fixtureRoot, platform: process.platform, arch: process.arch, versions, nodeExecutable: process.execPath, createdAt: new Date().toISOString(), environmentOverrides: { NO_COLOR: env.NO_COLOR, NODE_OPTIONS: env.NODE_OPTIONS, maintenanceAuto: false }, suiteExecution: 'notRun', performanceBenchmark: 'notMeasured', invocation: process.argv });

{
  const e = fixture('01-old-error-harmless-edit', baseline);
  lint(e, 'before', 1); start(e);
  put(e.root, 'docs/reference/sample.md', `${baseline}\nHarmless added prose.\n`, e);
  lint(e, 'after', 1); stop(e); state(e);
}
{
  const e = fixture('02-other-session-commit', clean);
  lint(e, 'before', 0); start(e); start(e, 'claude', 'generic-other');
  e.nextActor = 'other-session';
  put(e.root, 'docs/reference/sample.md', '# Sample\n\n[new](missing-new.md)\n', e);
  e.introducingCommit = commit(e.root, 'Generic work after primary session start');
  lint(e, 'after', 1); stop(e); state(e);
}
{
  const e = fixture('03-own-session-commit', clean);
  lint(e, 'before', 0); start(e);
  put(e.root, 'docs/reference/sample.md', '# Sample\n\n[new](missing-new.md)\n', e);
  e.introducingCommit = commit(e.root, 'Generic work after primary session start');
  lint(e, 'after', 1); stop(e); state(e);
}
{
  const e = fixture('04-line-insertion-before-old-error', baseline);
  lint(e, 'before', 1); start(e);
  put(e.root, 'docs/reference/sample.md', `Inserted harmless line.\n${baseline}`, e);
  lint(e, 'after', 1); stop(e); state(e);
}
{
  const e = fixture('05-new-error-in-already-red-file', baseline);
  lint(e, 'before', 1); start(e);
  put(e.root, 'docs/reference/sample.md', `${baseline}\n[new](missing-new.md)\n`, e);
  lint(e, 'after', 1); stop(e); state(e);
}
{
  const e = fixture('06-staged-error-control', clean);
  lint(e, 'before', 0); start(e);
  put(e.root, 'docs/reference/sample.md', '# Sample\n\n[new](missing-staged.md)\n', e);
  git('stage-sample', e.root, ['add', 'docs/reference/sample.md']);
  lint(e, 'after', 1); stop(e); state(e);
}
{
  const e = fixture('07-untracked-error-control', clean);
  lint(e, 'before', 0); start(e);
  put(e.root, 'docs/reference/untracked.md', '# New page\n\n[new](missing-untracked.md)\n', e);
  lint(e, 'after', 1); stop(e); state(e);
}
for (const harness of ['claude', 'cursor', 'codex']) {
  const e = fixture(`08-protocol-ceiling-${harness}`, clean);
  lint(e, 'before', 0); start(e, harness);
  put(e.root, 'docs/reference/sample.md', '# Sample\n\n[new](missing-new.md)\n', e);
  lint(e, 'after', 1);
  for (let count = 1; count <= 3; count += 1) stop(e, harness, String(count));
  stop(e, harness, '4', 0);
  put(e.root, 'docs/reference/sample.md', clean, e);
  stop(e, harness, 'clean', 0);
  put(e.root, 'docs/reference/sample.md', '# Sample\n\n[new](missing-new.md)\n', e);
  stop(e, harness, 'after-reset');
  stop(e, harness, 'bad-payload', 0, '{"session_id":7}\n');
  state(e);
}
{
  const e = fixture('09-duplicate-error-count', baseline);
  lint(e, 'before', 1); start(e);
  put(e.root, 'docs/reference/sample.md', `${baseline}\n[duplicate](missing-old.md)\n`, e);
  lint(e, 'after', 1); stop(e); state(e);
}
{
  const e = fixture('10-replaced-identical-error', baseline);
  lint(e, 'before', 1); start(e);
  put(e.root, 'docs/reference/sample.md', '# Sample\n\n[replacement occurrence](missing-old.md)\n', e);
  lint(e, 'after', 1); stop(e); state(e);
}
{
  const e = fixture('11-dirty-at-session-start', clean);
  put(e.root, 'docs/reference/sample.md', baseline, e);
  lint(e, 'before', 1); start(e);
  put(e.root, 'docs/reference/sample.md', `${baseline}\nHarmless added prose.\n`, e);
  lint(e, 'after', 1); stop(e); state(e);
}

const id = (error) => [error.file, error.msg];
const subtract = (after, before, key) => {
  const counts = new Map();
  for (const error of before) { const k = JSON.stringify(key(error)); counts.set(k, (counts.get(k) ?? 0) + 1); }
  return after.filter((error) => {
    const k = JSON.stringify(key(error)); const available = counts.get(k) ?? 0;
    if (!available) return true;
    counts.set(k, available - 1); return false;
  });
};
// This illustrative projection is restricted to these English broken-link fixtures. It is not a
// proposed production identity parser and is not loaded by the product.
const fixtureIdentity = (error) => {
  const match = /^broken link (.*) \(line \d+\)$/.exec(error.msg);
  assert(match, `fixture projection cannot classify ${error.msg}`);
  return [error.file, 'link.missing', match[1]];
};
const comparisons = cases.map((e) => ({
  case: e.name, rawMessageMultisetNew: subtract(e.afterDiagnostics, e.beforeDiagnostics, id),
  semanticBrokenLinkMultisetNew: subtract(e.afterDiagnostics, e.beforeDiagnostics, fixtureIdentity),
}));
save('candidate-comparisons.json', comparisons);
save('cases.json', cases);
const sourceAfter = git('source-status-after', source, ['status', '--porcelain=v1', '--untracked-files=all']);
const sourceShaAfter = git('source-head-after', source, ['rev-parse', 'HEAD']).stdout.trim();
assert.equal(sourceAfter.stdout, sourceBefore.stdout, 'source tree changed during research');
assert.equal(sourceShaAfter, sourceSha, 'source HEAD changed during research');
const expected = cases.length;
save('summary.json', { sourceSha, sourceShaAfter, sourceCleanBefore: sourceBefore.stdout === '', sourceCleanAfter: sourceAfter.stdout === '', fixtures: expected, requiredCases: 5, commands: receipts.length, expectedDirectExitsMatched: receipts.length, coreCaseNames: cases.slice(0, 5).map((e) => e.name), fullSuite: 'notRun', gates: 'notRun', liveHarnessObservation: 'notRun', fixtureRoot });
writeFileSync(path.join(output, 'COMMANDS.md'), '# Direct command receipts\n\nEach stdout, stderr and stdin artifact preserves the exact bytes; the JSON also records argv, cwd, signal and direct process exit. Expected lint 1 and Claude/Codex stop 2 are observations, not failed assertions.\n\n' + receipts.map((r) => `## ${r.id}\n\nCwd: \`${r.cwd}\`\n\n\`\`\`sh\n${r.command}\n\`\`\`\n\nDirect exit: ${r.exitCode}. Stdin: [${r.id}.stdin](receipts/${r.id}.stdin). Stdout: [${r.id}.stdout](receipts/${r.id}.stdout). Stderr: [${r.id}.stderr](receipts/${r.id}.stderr). Full receipt: [${r.id}.json](receipts/${r.id}.json).\n`).join('\n'));
process.stdout.write(`${JSON.stringify({ output, fixtures: expected, commands: receipts.length, sourceSha, fixtureRoot })}\n`);
