// The brief for a worker as a real process: what is taken from disk, what the orchestrator
// decides by a flag, and what the command refuses to invent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROBE_WORDS, SECTION, cleanup, cli, escapeRe, makeProject, put, read, ru, ruCard, ruLineRe, ruRe, ruResult, ruTemplate } from './helpers.mjs';

const WHEN_NOTE = ' {scoped} of {entries} carry a `when` scope: on untouched paths they are skipped, and the runner prints them as “not run N”. A skip never adds to the green count — name it in the report separately.';
const MEASUREMENTS = new RegExp(escapeRe(ru('- **Take numbers from the run by measurement, not by feel**: a live wall clock measures your neighbours, an exit code is read from the command rather than the pipe, and an incomplete grep result looks as confident as a complete one. Not measured — write it as a hypothesis.\n').trim()));
const NOT_DECLARED = 'probe is not declared in {config}: the brief names no mutation-probe command — declare it in probe or name it in the brief yourself';

function seed(root) {
  put(root, 'backslop.json', `${JSON.stringify({
    prefix: 'BL', docs: 'docs', cli: 'npx backslop@1.2.3', gates: ['npm test', 'npx backslop@1.2.3 lint'], lang: 'ru', tools: [],
  }, null, 2)}\n`);
  put(root, 'docs/backlog/queue/BL-3-configs.md', `${ruCard('BL-3', 'Config migration', { order: 10, area: '[x](../../reference/README.md)' }, [
    ['context', 'The old format.'], ['work', '- migrate the keys'], ['outOfScope', '- schema change'],
  ])}`);
  put(root, 'docs/backlog/queue/BL-4-flags.md', ruCard('BL-4', 'Command flags', { order: 20, area: '[x](../../reference/README.md)' }, [
    ['work', '- add --dry-run'],
  ]));
}

test('brief: the track heading, task definitions from disk, the project gates and prefix', () => {
  const root = makeProject();
  try {
    seed(root);
    const r = cli(root, ['brief', '3', '4', '--track', 'config migration']);
    assert.equal(r.code, 0, r.err);

    assert.match(r.out, /^# config migration\n/);
    // The definition is taken from the task files, not retold.
    assert.match(r.out, /### BL-3 — Config migration/);
    assert.match(r.out, /docs\/backlog\/queue\/BL-3-configs\.md/);
    assert.match(r.out, /- migrate the keys/);
    assert.match(r.out, /- schema change/);
    assert.match(r.out, /### BL-4 — Command flags/);
    assert.match(r.out, /- add --dry-run/);
    // BL-4 has no out-of-scope section — the block is not invented.
    assert.equal(r.out.match(new RegExp(`\\*\\*${SECTION.outOfScope}\\*\\*`, 'g')).length, 1);

    // gates, prefix and cli come from the project's backslop.json, not from the tool's defaults.
    assert.match(r.out, /`npm test`, `npx backslop@1\.2\.3 lint`/);
    assert.match(r.out, /`BL-N:`/);

    // Fixed items of the brief, each as the whole line of the Russian template; the mutation-probe
    // items are conditional, see the probe test below.
    for (const en of ['## Editing boundaries', '## Definition of done', 'Documentation goes in the same pass',
      'Commit to your branch immediately', '**Do not push.**', 'Do not touch status directories',
      'Findings carry a cost label', '## What the result contains']) {
      assert.match(r.out, ruLineRe('brief.md', en, { cli: 'npx backslop@1.2.3', prefix: 'BL' }), en);
    }
  } finally {
    cleanup(root);
  }
});

test('brief: orchestrator slots — a placeholder without the flag, the value with it', () => {
  const root = makeProject();
  try {
    seed(root);
    const slots = [
      { label: 'neighbours', flagArgs: ['--neighbour', 'test/=tests', '--neighbour', 'bin/=cli'],
        placeholder: ruRe('[TODO: which directories are yours. Name neighbouring tracks explicitly — `--neighbour "test/=tests"`: a ban without a neighbour’s name invites the worker to work around it.]'), values: [ruRe('- `{path}` — track “{track}”;', { path: 'test/', track: 'tests' }), ruRe('- `{path}` — track “{track}”;', { path: 'bin/', track: 'cli' })] },
      { label: 'entry', flagArgs: ['--entry', 'lib/guard.js, then the reference'],
        placeholder: ruRe('[TODO: where the subject lives and what to read first — `--entry "lib/guard.js, then docs/reference/03-cli.md"`. Without a map the participant looks for the subject itself and pays for it in recon turns.]'), values: [/lib\/guard\.js, then the reference/] },
      { label: 'autonomy', flagArgs: ['--autonomy', 'wording is yours, the schema is not'],
        placeholder: ruRe('[TODO: what the participant closes by its own decision and what it brings to the orchestrator — `--autonomy "…"`. Without this list a fork leaves as a question on the bus and the participant waits for the answer.]'), values: [/wording is yours, the schema is not/] },
      { label: 'handover', flagArgs: ['--handover', 'the gate record as an artifact'],
        placeholder: ruRe('[TODO: the gate protocol and the header of the report — `--handover "…"`. The template sets the structure, the caller supplies the content: the format of those two lives outside backslop.]'), values: [/the gate record as an artifact/] },
      { label: 'measurements', flagArgs: ['--measurements'], absent: MEASUREMENTS, values: [MEASUREMENTS] },
    ];
    const bare = cli(root, ['brief', '3']);
    assert.equal(bare.code, 0, bare.err);
    for (const en of ['## Entry point', '## What you decide yourself', '## Hand-off form']) assert.match(bare.out, ruLineRe('brief.md', en));
    // A slot without a key would reach the reader literally; a definition without `{{` has none.
    assert.doesNotMatch(bare.out, /\{\{/);
    const full = cli(root, ['brief', '3', ...slots.flatMap((slot) => slot.flagArgs)]);
    assert.equal(full.code, 0, full.err);
    for (const { label, placeholder, absent, values } of slots) {
      if (placeholder) {
        assert.match(bare.out, placeholder, `${label}: placeholder without the flag`);
        assert.doesNotMatch(full.out, placeholder, `${label}: no placeholder with the flag`);
      } else {
        assert.doesNotMatch(bare.out, absent, `${label}: absent without the flag`);
      }
      for (const value of values) assert.match(full.out, value, `${label}: value with the flag`);
    }

    const bad = cli(root, ['brief', '3', '--neighbour', 'tests']);
    assert.equal(bad.code, 1);
    assert.match(bad.err, ruRe('--neighbour “{pair}”: expected the form “path=track”', { pair: 'tests' }));
  } finally {
    cleanup(root);
  }
});

test('brief: a nonexistent number — a refusal naming it, not an empty render', () => {
  const root = makeProject();
  try {
    seed(root);
    const r = cli(root, ['brief', '3', '9']);
    assert.equal(r.code, 1);
    assert.match(r.err, /BL-9/);
    assert.equal(r.out, '', 'a partial brief is not printed');

    const none = cli(root, ['brief']);
    assert.equal(none.code, 1);
    assert.match(none.err, ruRe('task numbers are required: {cli} brief <N…> [--track "…"] [--neighbour "path=track"] [--entry "…"] [--autonomy "…"] [--handover "…"] [--measurements]'));
  } finally {
    cleanup(root);
  }
});

test('brief: EN project renders the English twin', () => {
  const root = makeProject();
  try {
    seed(root);
    put(root, 'backslop.json', `${JSON.stringify({ ...JSON.parse(read(root, 'backslop.json')), lang: 'en' }, null, 2)}\n`);
    const r = cli(root, ['brief', '3', '--track', 'config migration']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /^# config migration\n/);
    assert.match(r.out, /## Track tasks, in this order/);
    assert.match(r.out, /\*\*Work to do\*\*/, 'the RU sections of the card are read in an EN project');
    assert.doesNotMatch(r.out, ruLineRe('brief.md', '## How to work'), 'the Russian edition of the brief does not reach an EN project');
    assert.match(r.out, /the approver closes tasks and edits file text in those directories; the worker sends the wording in the result\./);
    assert.match(r.out, /Moving a file between status directories or `archive\/` is not the worker’s move\./);
    assert.match(r.out, /The only exception is a new finding: the worker creates it as a separate file with `npx backslop@1\.2\.3 new <slug> --parent N\[\.M\]` \(with `--minor --evidence "…"` for minors; a hypothesis as in the next bullet\) on their branch/);
    assert.match(r.out, /Findings carry a cost label, and the label decides the route/);
    assert.match(r.out, /the worker does not edit an existing card/);
    assert.match(r.out, /commits per task, each prefixed `BL-N:` — including review fixes/);
    assert.match(r.out, /a `major` or `critical` hypothesis is filed with `npx backslop@1\.2\.3 new <slug> --parent N\[\.M\] --minor --cost <level> --hypothesis --evidence "…"`, and only a minor finding uses plain `--minor --evidence`/);
    assert.match(r.out, /\*\*Do not push\.\*\* Decision points go to the orchestrator, never to the owner directly\./);
    assert.match(r.out, /file `major` outside it with `npx backslop@1\.2\.3 new <slug> --parent N\[\.M\]`, then fill the `Evidence:` line of its Context/);
    assert.doesNotMatch(r.out, /one commit per task/);
  } finally {
    cleanup(root);
  }
});

test('brief: old CLI pin warns, with stdout equal after normalizing the pin token', () => {
  const root = makeProject();
  try {
    seed(root);
    const cfg = { ...JSON.parse(read(root, 'backslop.json')), gates: ['npm test'], probe: 'npm test' };
    const render = (command) => {
      put(root, 'backslop.json', `${JSON.stringify({ ...cfg, cli: command }, null, 2)}\n`);
      const result = cli(root, ['brief', '3']);
      assert.equal(result.code, 0, result.err);
      return result;
    };
    const old = render('npx backslop@0.9.0');
    const floor = render('npx backslop@0.10.0');
    assert.ok((old.out.match(/backslop@0\.9\.0/g) ?? []).length > 0);
    assert.equal(old.out.replaceAll('backslop@0.9.0', 'backslop@0.10.0'), floor.out);
    assert.match(old.err, /--evidence/);
    assert.match(old.err, /npx backslop@0\.9\.0 upgrade/);
    assert.equal(floor.err, '');
    for (const command of ['npx backslop@0.11.0', 'npx backslop', 'npx backslop@latest']) {
      assert.equal(render(command).err, '');
    }
    put(root, 'backslop.json', `${JSON.stringify({ ...cfg, cli: 'npx backslop@0.9.0', lang: 'en' }, null, 2)}\n`);
    const english = cli(root, ['brief', '3']);
    assert.equal(english.code, 0, english.err);
    assert.match(english.err, /Pinned CLI .* lacks .*--evidence.*upgrade/);
  } finally {
    cleanup(root);
  }
});

test('brief: GitHub CLI pin warning follows the command floor', () => {
  const root = makeProject();
  try {
    seed(root);
    const cfg = { ...JSON.parse(read(root, 'backslop.json')), lang: 'en', gates: ['npm test'], probe: 'npm test' };
    const render = (command) => {
      put(root, 'backslop.json', `${JSON.stringify({ ...cfg, cli: command }, null, 2)}\n`);
      const result = cli(root, ['brief', '3']);
      assert.equal(result.code, 0, result.err);
      return result;
    };
    const old = render('npx github:Velklish/backslop#v0.9.0');
    assert.match(old.err, /--evidence/);
    assert.match(old.err, /npx github:Velklish\/backslop#v0\.9\.0 upgrade/);
    assert.equal(render('npx github:Velklish/backslop#v0.10.0').err, '');
    assert.equal(render('npx github:Velklish/backslop').err, '');
  } finally {
    cleanup(root);
  }
});

test('brief: an archived task without task.md — a refusal in words, not ENOENT', () => {
  const root = makeProject();
  try {
    seed(root);
    put(root, 'docs/archive/BL-9-gone/result.md', ruResult('BL-9', '2026-08-01', 'Done.'));
    const r = cli(root, ['brief', '9']);
    assert.equal(r.code, 1);
    assert.match(r.err, ruRe('{id} is archived without task.md — there is no definition for the brief to take', { id: 'BL-9' }));
    assert.doesNotMatch(r.err, /ENOENT|at Object\./, 'the refusal is addressed to a human, no stack');
  } finally {
    cleanup(root);
  }
});

test('brief: the gates step names the runner through the project cli', () => {
  const root = makeProject();
  try {
    seed(root);
    // The gates step names the runner of the pinned cli.
    const fresh = cli(root, ['brief', '3']);
    assert.equal(fresh.code, 0, fresh.err);
    assert.match(fresh.out, ruRe('Project gates are green by count: `{cli} gates` prints the summary “gates N, green N”. Their contents: {list}.{scopeNote} Read the exit code of the command, not of a pipe: `cmd > out; echo $?`.', { cli: 'npx backslop@1.2.3' }));
  } finally {
    cleanup(root);
  }
});

// A `gates` entry has a second form. The brief must print the command, not the object, and name
// the skip by scope: "green N" of N stopped being an equality with the list.
test('brief: an entry with a scope is printed as its command, and the skip is named', () => {
  const root = makeProject();
  try {
    seed(root);
    const cfg = JSON.parse(read(root, 'backslop.json'));
    put(root, 'backslop.json', `${JSON.stringify({ ...cfg, gates: ['npm test', { command: 'npx backslop@1.2.3 lint', when: ['docs/**'] }] }, null, 2)}\n`);
    const r = cli(root, ['brief', '3']);
    assert.equal(r.code, 0, r.err);
    assert.doesNotMatch(r.out, /\[object Object\]/);
    assert.match(r.out, /`npm test`, `npx backslop@1\.2\.3 lint`/);
    assert.match(r.out, ruRe(WHEN_NOTE, { scoped: 1, entries: 2 }));

    put(root, 'backslop.json', `${JSON.stringify(cfg, null, 2)}\n`);
    assert.doesNotMatch(cli(root, ['brief', '3']).out, ruRe(WHEN_NOTE), 'without a scope it is not mentioned');
  } finally {
    cleanup(root);
  }
});

test('brief: the probe command comes from the project probe field; no field — no suggestion', () => {
  const root = makeProject();
  try {
    seed(root);
    let r = cli(root, ['brief', '3', '--track', 'config migration']);
    assert.equal(r.code, 0, r.err);
    assert.doesNotMatch(r.out, PROBE_WORDS, 'without the probe field the brief says nothing about the probe');
    // The dropped requirement is named as in `init` (ADR-041), in stderr: stdout is the brief.
    assert.match(r.err, ruRe(NOT_DECLARED, { config: 'backslop.json' }));
    assert.doesNotMatch(r.out, ruRe(NOT_DECLARED, { config: 'backslop.json' }), 'a note in stdout would reach the worker as part of the definition');

    put(root, 'backslop.json', `${JSON.stringify({
      prefix: 'BL', docs: 'docs', cli: 'npx backslop@1.2.3', gates: [], lang: 'ru', tools: [], probe: 'npm run probe',
    }, null, 2)}\n`);
    r = cli(root, ['brief', '3', '--track', 'config migration']);
    assert.equal(r.code, 0, r.err);
    const rule = ruTemplate('agents-probe.md', { probe: 'npm run probe' }).trim();
    assert.ok(r.out.includes(rule), 'the brief carries the commit-first rule with the project probe');
    const clause = rule.split(': ')[1].split(',')[0];
    assert.equal(r.out.split(clause).length - 1, 1, 'the brief states commit first once');
    assert.doesNotMatch(r.err, ruRe(NOT_DECLARED, { config: 'backslop.json' }), 'the field is declared — no note');
  } finally { cleanup(root); }
});
