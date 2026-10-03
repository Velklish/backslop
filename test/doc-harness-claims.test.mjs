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

// Code, templates and tests say what backslop prints or writes; one phrase per file stays removed.
const CODE_REMOVED = [
  ['lib/hook.js', 'returns the turn'],
  ['lib/adapters.js', 'will not see the backslop block'],
  ['lib/mdwalk.js', 'Subagent working copies'],
  ['bin/backslop.js', 'returns the turn on errors'],
  ['templates/en/agents-hooks.md', 'returns the turn'],
  ['templates/en/skills/backslop-batch/SKILL.md', 'Claude Code'],
  ['templates/skills/backslop-batch/SKILL.md', 'Claude Code'],
  ['templates/i18n/ru.mjs', 'returned the turn'],
  ['templates/i18n/ru.mjs', 'Claude Code will not see'],
  ['test/hook.test.mjs', 'return the turn'],
  ['test/config.test.mjs', 'never breaks a session'],
];

for (const [file, phrase] of CODE_REMOVED) {
  test(`${file} states what backslop does, not a harness: "${phrase}" stays removed`, () => {
    assert.ok(!read(file).includes(phrase), `${file} holds "${phrase}": say what the code prints or writes`);
  });
}

test('the Russian hook sentence has the verb of the English one before the lint span', () => {
  assert.match(read('templates/en/agents-hooks.md'), /^The stop hook runs `lint` and prints/);
  assert.match(read('templates/agents-hooks.md'), /^Stop hook \S+ `lint` \S+ /, 'the sentence names the verb, not a harness effect');
});

test('01-layout names the target of a pointer instead of saying above or below', () => {
  const text = read('docs/reference/01-layout.md');
  for (const phrase of ['see the table below', 'as in "Refusal: moot" above']) assert.ok(!text.includes(phrase), `01-layout holds "${phrase}"`);
});

test('a missing Unreleased section reads as empty', () => {
  assert.equal(unreleased('# Changelog\n\n## v1.0.0 — 2026-01-01\n\n- x\n'), '');
  assert.equal(unreleased('## Unreleased\r\n\r\n- a\r\n\r\n## v1.0.0\r\n'), '## Unreleased\n\n- a\n');
  assert.equal(unreleased('# Changelog\n\n## Unreleased\n\n- a\n\n## v1.0.0 — 2026-01-01\n\n- b\n'), '## Unreleased\n\n- a\n');
});
