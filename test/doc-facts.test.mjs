// Reference facts that drift with the code: each is read from the page and from its source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const page = (name) => readFileSync(path.join(ROOT, 'docs/reference', name), 'utf8');
const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];

test('06-module-map states the number of files in lib/', () => {
  const stated = page('06-module-map.md').match(/`lib\/` has (\d+) files\./);
  assert.ok(stated, 'the sentence "`lib/` has N files." is gone');
  const files = readdirSync(path.join(ROOT, 'lib'), { withFileTypes: true }).filter((e) => e.isFile());
  assert.equal(Number(stated[1]), files.length);
});

test('05-orchestrator-contract lists the config fields in the order saveConfig writes them', () => {
  const source = readFileSync(path.join(ROOT, 'lib/config.js'), 'utf8');
  const order = source.slice(source.indexOf('export function saveConfig')).match(/const order = \[([^\]]*)\]/)[1]
    .match(/'([^']+)'/g).map((q) => q.slice(1, -1));
  const lines = page('05-orchestrator-contract.md').split('\n');
  const at = lines.findIndex((line) => /The \w+ fields, in the order the tool writes them:/.test(line));
  assert.ok(at >= 0, 'the sentence "The N fields, in the order the tool writes them:" is gone');
  const rows = lines.slice(at + 1).filter((line) => line.trim() !== '').slice(2);
  const documented = [];
  for (const row of rows) {
    const name = row.match(/^\| `([\w.]+)` \|/)?.[1];
    if (name === undefined) break;
    documented.push(name.split('.')[0]);
  }
  assert.deepEqual(documented, order);
  const word = lines[at].match(/The (\w+) fields/)[1];
  assert.equal(NUMBER_WORDS.indexOf(word), order.length, `the page says "${word}" fields`);
});
