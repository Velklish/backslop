// Gate: Cyrillic lives only in templates/, docs/backlog/ and docs/archive/, the AGENTS.md rule.
// Tracked files only: the gate judges what a commit carries.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ALLOWED = ['templates/', 'docs/backlog/', 'docs/archive/'];
const CYRILLIC = new RegExp(`[${String.fromCodePoint(0x0400)}-${String.fromCodePoint(0x04ff)}]`, 'u');

export function allowed(rel) {
  return ALLOWED.some((dir) => rel.startsWith(dir));
}

// Line numbers, 1-based, of the lines that hold a character of U+0400–U+04FF.
export function cyrillicLines(text) {
  return text.split('\n').flatMap((l, i) => (CYRILLIC.test(l) ? [i + 1] : []));
}

// A deleted file is not judged: the index still lists it until `git add`.
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
  .split('\0').filter((f) => f && existsSync(path.join(ROOT, f)));

function hitsOf(files) {
  return files.flatMap((rel) => cyrillicLines(readFileSync(path.join(ROOT, rel), 'utf8')).map((n) => `${rel}:${n}`));
}

test('no tracked file outside templates/, docs/backlog/ and docs/archive/ holds a Cyrillic character', () => {
  const judged = tracked.filter((f) => !allowed(f));
  assert.ok(judged.some((f) => f.startsWith('lib/')), 'the walk reads no file of lib/ — it would pass on nothing');
  assert.deepEqual(hitsOf(judged), [], 'Cyrillic outside the three places, as file:line — translate it or move it to templates/i18n/ru.mjs');
});

test('the three places are exempt by directory, and templates/i18n/ru.mjs carries Cyrillic', () => {
  for (const dir of ALLOWED) assert.ok(tracked.some((f) => f.startsWith(dir)), `no tracked file under ${dir}`);
  assert.ok(hitsOf(['templates/i18n/ru.mjs']).length > 0, 'templates/i18n/ru.mjs carries no Cyrillic — the exemption is not exercised');
  assert.ok(allowed('templates/i18n/ru.mjs') && allowed('docs/backlog/x.md') && allowed('docs/archive/LOG.md'));
  assert.ok(!allowed('templates.md') && !allowed('docs/backlog.md') && !allowed('docs/reference/x.md') && !allowed('lib/templates/x.js'));
});

test('a hit is named by its line, and the range ends at U+0400 and U+04FF', () => {
  const ru = String.fromCodePoint(0x0400) + String.fromCodePoint(0x04ff);
  assert.deepEqual(cyrillicLines(`a\n${ru}\nb\nx${ru.slice(1)}\n`), [2, 4]);
  assert.deepEqual(cyrillicLines(String.fromCodePoint(0x03ff) + String.fromCodePoint(0x0500)), []);
});
