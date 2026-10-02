// The unreleased CHANGELOG section writes straight quotes only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO } from './helpers.mjs';

const CURLY = /[“”]/;

// Line numbers of the lines with a curly double quote, from `## Unreleased` to the next `## `.
function curlyLines(text) {
  const lines = text.split(/\r?\n/);
  const from = lines.indexOf('## Unreleased');
  if (from === -1) return [];
  const next = lines.findIndex((line, i) => i > from && line.startsWith('## '));
  const to = next === -1 ? lines.length : next;
  const found = [];
  for (let i = from + 1; i < to; i += 1) if (CURLY.test(lines[i])) found.push(i + 1);
  return found;
}

test('changelog quotes: the checker finds a curly double quote only inside the unreleased section', () => {
  const text = ['## Unreleased', '', '- **One** — “quoted”', '- **Two** — "straight"', '', '## v0.1.0', '', '- **Old** — “quoted”', ''].join('\n');
  assert.deepEqual(curlyLines(text), [3]);
  assert.deepEqual(curlyLines('## v0.1.0\n\n- **Old** — “quoted”\n'), []);
});

test('changelog quotes: the unreleased section of CHANGELOG.md holds no curly double quote', () => {
  const text = readFileSync(path.join(REPO, 'CHANGELOG.md'), 'utf8');
  assert.deepEqual(curlyLines(text), [], 'a quoted tool message goes in a code span, and the quotes are straight');
});
