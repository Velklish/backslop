// The product documentation says what backslop writes, not what another program does with it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

// The CHANGELOG is judged in its `## Unreleased` section only; a missing section reads as empty.
function unreleased(text) {
  const lines = text.split(/\r?\n/);
  const from = lines.findIndex((l) => l === '## Unreleased');
  if (from === -1) return '';
  const next = lines.findIndex((l, i) => i > from && l.startsWith('## '));
  return lines.slice(from, next === -1 ? undefined : next).join('\n');
}

const REMOVED = [
  ['README.md', 'trust step'],
  ['docs/reference/01-layout.md', 'Measured on 2026-09-30'],
  ['docs/reference/02-cli.md', 'Checked live on'],
  ['docs/reference/README.md', 'files and protocols'],
  ['docs/reference/03-lint.md', 'subagent working copies'],
  ['docs/reference/06-module-map.md', 'protocol of each harness'],
  ['docs/adr/adr-055-docs-rules-ship-to-projects.md', 'ships on the Claude Code protocol'],
  ['docs/reference/05-orchestrator-contract.md', 'protocol of the harness'],
  ['docs/GLOSSARY.md', 'directory of a specific harness'],
  ['CHANGELOG.md', 'agent hooks of Claude Code'],
];

for (const [file, phrase] of REMOVED) {
  test(`${file} does not state what a harness does: "${phrase}" stays removed`, () => {
    const text = file === 'CHANGELOG.md' ? unreleased(read(file)) : read(file);
    assert.ok(!text.includes(phrase), `${file} holds "${phrase}": describe what init writes, lint reads or hook prints`);
  });
}

test('01-layout names the target of a pointer instead of saying above or below', () => {
  const text = read('docs/reference/01-layout.md');
  for (const phrase of ['see the table below', 'as in "Refusal: moot" above']) assert.ok(!text.includes(phrase), `01-layout holds "${phrase}"`);
});

test('a missing Unreleased section reads as empty', () => {
  assert.equal(unreleased('# Changelog\n\n## v1.0.0 — 2026-01-01\n\n- x\n'), '');
  assert.equal(unreleased('## Unreleased\r\n\r\n- a\r\n\r\n## v1.0.0\r\n'), '## Unreleased\n\n- a\n');
  assert.equal(unreleased('# Changelog\n\n## Unreleased\n\n- a\n\n## v1.0.0 — 2026-01-01\n\n- b\n'), '## Unreleased\n\n- a\n');
});
