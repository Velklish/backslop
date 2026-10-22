import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO, cleanup, put } from './helpers.mjs';
import { LOCATION_EVIDENCE, boundaryLines, repositoryBoundary } from './repository-boundary.mjs';

const personalPath = ['', 'Users', 'fixture-person', 'work', 'consumer', 'src'].join('/');
const privateUrl = ['https:', '', 'tracker.fixture.internal', 'runs', 'sample'].join('/');

test('repository boundary: contributor rules require generic current-tree context and preserved history', () => {
  const rules = readFileSync(path.join(REPO, 'AGENTS.md'), 'utf8');
  assert.ok(rules.includes('Keep the current tracked tree about backslop.'), 'missing current-tree contributor boundary');
  assert.ok(rules.includes('retain uncertainty and the underlying issue.'), 'missing issue-preservation rule');
  assert.ok(rules.includes('Journal anchors, ids, slugs, dates, revisions and row order are historical keys'), 'missing historical-key rule');
  const reference = readFileSync(path.join(REPO, 'docs/reference/04-verification.md'), 'utf8');
  assert.ok(reference.includes('a clean scan does not replace content review'), 'missing structural-guard limitation');
});

test('repository boundary: all current tracked files are checked for private locations', () => {
  const { files, violations } = repositoryBoundary(REPO);
  for (const prefix of ['lib/', 'test/', 'templates/', 'docs/backlog/', 'docs/archive/', 'docs/adr/']) {
    assert.ok(files.some((file) => file.startsWith(prefix)), `no tracked files of ${prefix}`);
  }
  assert.deepEqual(violations, [], 'private locations as file:line; use self-contained synthetic examples');
});

test('repository boundary: negative fixtures cover files outside public reference prose', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'backslop-boundary-'));
  const files = ['docs/backlog/queue/BS-1-example.md', 'docs/archive/LOG.md', 'docs/adr/adr-001-example.md',
    'lib/example.js', 'test/example.test.mjs', 'templates/en/task.md', 'templates/task.md',
    '.github/workflows/example.yml', 'CHANGELOG.md'];
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  };
  try {
    git('init', '-q');
    for (const file of files) put(root, file, `Generic example\n${personalPath}\n${privateUrl}\n`);
    put(root, 'CHANGELOG.md', `## v1.0.0\n\n${personalPath}\n${privateUrl}\n`);
    put(root, 'untracked.md', personalPath);
    git('add', '--', ...files);
    const result = repositoryBoundary(root);
    assert.deepEqual(result.files.sort(), [...files].sort());
    assert.deepEqual(result.violations.sort(), files.flatMap((file) => {
      const first = file === 'CHANGELOG.md' ? 3 : 2;
      return [`${file}:${first}`, `${file}:${first + 1}`];
    }).sort());
    for (const file of files) put(root, file, 'Self-contained generic reproduction.\n');
    assert.deepEqual(repositoryBoundary(root).violations, []);
  } finally {
    cleanup(root);
  }
});

test('repository boundary: Windows paths and private URL ports are checked by line', () => {
  const windows = ['C:', 'Users', 'fixture-person', 'project'].join('\\');
  assert.deepEqual(boundaryLines('test/example.mjs', `ordinary\n${windows}\n${windows.replaceAll('\\', '\\\\')}\n`), [2, 3]);
  assert.deepEqual(boundaryLines('docs/example.md', privateUrl.replace('/runs/', ':443/runs/')), [1]);
  assert.deepEqual(boundaryLines('docs/example.md', `${privateUrl.split('/runs/')[0]}?query=sample`), [1]);
});

test('repository boundary: symbolic examples, public integrations and vendor provenance remain allowed', () => {
  const examples = ['~/project', '$HOME/project', '/home/user/project', '/Users/me/project',
    'C:\\Users\\example\\project', 'https://example.com/sample', 'https://github.com/example/project',
    'Claude Code, Cursor and Codex integration settings.'];
  assert.deepEqual(boundaryLines('README.md', examples.join('\n')), []);
  assert.deepEqual(boundaryLines('templates/vendor/example/SOURCE.md', personalPath), []);
  assert.deepEqual(boundaryLines('templates/vendor/example/LICENSE', privateUrl), []);
  assert.deepEqual(boundaryLines('templates/en/vendor/example.md', personalPath), [1]);
});

test('repository boundary: journal keys stay immutable while outcome and title prose are checked', () => {
  const key = `- <a id="bs-1"></a>\`BS-1-original-slug\` · 2026-01-01`;
  const revision = '`1234567890`';
  assert.deepEqual(boundaryLines('docs/archive/LOG.md', `${key} · completed · ${revision} · Generic title`), []);
  assert.deepEqual(boundaryLines('docs/archive/LOG.md', `${key} · completed · ${revision} · ${personalPath}`), [1]);
  assert.deepEqual(boundaryLines('docs/archive/LOG.md', `${key} · ${privateUrl} · ${revision} · Generic title`), [1]);
  assert.deepEqual(boundaryLines('docs/archive/LOG.md', `${key} · completed · ${privateUrl} · Generic title`), []);
  assert.deepEqual(boundaryLines('docs/archive/LOG.md', personalPath), [1]);
});

test('repository boundary: exact historical receipts permit no changed, repeated or relocated private path', () => {
  for (const entry of LOCATION_EVIDENCE) {
    const file = path.join(REPO, entry.file);
    if (!existsSync(file)) continue;
    const text = readFileSync(file, 'utf8');
    assert.deepEqual(boundaryLines(entry.file, text), [], entry.file);
    assert.deepEqual(boundaryLines(entry.file, text.replace(/\r?\n/g, '\r\n')), [], entry.file);
    const [number] = boundaryLines('another-file.md', text);
    assert.ok(number, `${entry.file}: receipt has no private path`);
    const lines = text.split('\n');
    const original = lines[number - 1];
    const changed = [...lines];
    changed[number - 1] += ' changed';
    assert.ok(boundaryLines(entry.file, changed.join('\n')).includes(number), entry.file);
    assert.ok(boundaryLines(entry.file, text.replace(original, `${original}\n${original}`)).length > 0, entry.file);
    assert.ok(boundaryLines(entry.file, `${text}\n## New context\n${original}`).length > 0, entry.file);
    assert.ok(boundaryLines(entry.file, text.replace(entry.heading, '## Different section')).length > 0, entry.file);
    assert.ok(boundaryLines('another-file.md', text).length > 0, entry.file);
  }
});
