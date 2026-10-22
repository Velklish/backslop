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

test('04-verification states the deletion-probe repeat scope and baseline reuse conditions', () => {
  const repeat = page('04-verification.md').split('\n').find((line) => line.startsWith('   - k.'));
  assert.equal(repeat, '   - k. Repeat sub-steps 6b through 6j with a second, different mutation of the same guarded code. Reuse the baseline from 6a only for the identical committed SHA, the same environment and a clean restored tree; otherwise rerun 6a before repeating 6b through 6j.');
});


test('adr reference requires a link and treats its table row as conventional', () => {
  const output = page('02-cli.md').split('\n').find((line) => line.startsWith('- Output: the file, and a reminder'));
  assert.match(output, /link it from `docs\/README\.md`; a table row is conventional/);
  assert.match(output, /`lint` fails until the link is added/);
  const adr = readFileSync(path.join(ROOT, 'docs/adr/adr-056-adr-placeholder-gate.md'), 'utf8');
  assert.match(adr, /lint fails without a link from `docs\/README\.md`; a table row is conventional/);
});


test('new reference scopes the major-cost hypothesis refusal to minor mode', () => {
  const reference = page('02-cli.md');
  const refusals = reference.split('\n').find((line) => line.startsWith('- `--top` without `--queue`;'));
  assert.ok(refusals.includes('; `--minor --cost major|critical` without `--hypothesis`;'));
  assert.match(reference, /`--cost critical\|major` with `--parent` and without `--minor` writes that level into the Cost field/);
});


test('06-module-map names the owned renders and the current self-host check', () => {
  const rule = page('06-module-map.md').split('\n').find((line) => line.startsWith('6. **Rendered files in `docs/`.**'));
  for (const rel of ['docs/backlog/README.md', 'docs/archive/README.md', 'docs/ROLES.md', 'docs/archive/LOG.md']) {
    assert.ok(rule.includes(`\`${rel}\``), `06-module-map.md: rendered-file rule omits ${rel}`);
  }
  const title = rule.match(/fails on "([^"]+)" in `test\/templates\.test\.mjs`/)?.[1];
  assert.ok(title, '06-module-map.md: the self-host check is not named');
  assert.ok(readFileSync(path.join(ROOT, 'test/templates.test.mjs'), 'utf8').includes(`test('${title}',`),
    `06-module-map.md: no self-host test named ${title}`);
});

test('06-module-map selected key exports exist in their source modules', () => {
  let checked = 0;
  for (const [index, row] of page('06-module-map.md').split('\n').entries()) {
    const cells = row.match(/^\| `(lib\/[^`]+\.js)` \| .+ \| (.+) \|$/);
    if (!cells) continue;
    const source = readFileSync(path.join(ROOT, cells[1]), 'utf8');
    const exported = new Set([...source.matchAll(/^export (?:async )?(?:function|class|const) ([A-Za-z_$][\w$]*)|^export \{ ([A-Za-z_$][\w$]*) \};$/gm)]
      .map((match) => match[1] ?? match[2]));
    for (const [, name] of cells[2].matchAll(/`([A-Za-z_$][\w$]*)`/g)) {
      assert.ok(exported.has(name), `docs/reference/06-module-map.md:${index + 1}: ${cells[1]} documents missing export ${name}`);
      checked += 1;
    }
  }
  assert.ok(checked > 0, '06-module-map.md: no selected key exports were checked');
});

test('06-module-map template errors use the selected language with an English default', () => {
  const rule = page('06-module-map.md').split('\n').find((line) => line.startsWith('2. **The placeholder.**'));
  assert.match(rule, /in the passed `lang`, defaulting to English; `renderProjectTemplate` passes `cfg\.lang`/);
  assert.match(rule, /throws an `Error`/);
  assert.match(rule, /the throw is a crash, not a refusal/);
});

test('numbering-lock instructions describe identity-checked replacement without a free path', () => {
  const layout = page('01-layout.md').split('\n').find((line) => line.startsWith('- **Simultaneous calls.**'));
  assert.match(layout, /polls for 10 seconds/);
  assert.match(layout, /older than 60 seconds is stale/);
  const cli = page('02-cli.md').split('\n').find((line) => line.startsWith('- The whole operation — the scan'));
  const backlog = readFileSync(path.join(ROOT, 'templates/en/docs/backlog/README.md'), 'utf8').split('\n')
    .find((line) => line.startsWith('- **Numbers are sequential**'));
  for (const text of [layout, cli, backlog]) {
    assert.match(text, /after rechecking its identity/);
    assert.match(text, /without freeing the lock path/);
  }
  const ru = readFileSync(path.join(ROOT, 'templates/docs/backlog/README.md'), 'utf8').split('\n')[26];
  const replacement = String.fromCodePoint(1079, 1072, 1084, 1077, 1085, 1080, 1074);
  assert.ok(ru.includes(replacement), 'ru: takeover replaces the file');
});
