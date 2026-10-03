import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../lib/config.js';
import { TEMPLATES_DIR, templateParity } from '../lib/templates.js';
import { REPO, cleanup, cli, escapeRe, makeProject, put, read, ruRe, ruTwinLine } from './helpers.mjs';

const TOOLS = ['claude', 'cursor', 'codex'];
const SKILL = 'backslop-writer';
const HEADING_RE = /^## .+$/gm;
const AUDIT_HEADINGS = ['## Audit Mode', '## Audit Report', '## Filing Findings', '## Regression Check', '## Release Hold'];
const AUDIT_AT = 6;
const RU_SKILL = 'skills/backslop-writer/SKILL.md';
// Fixed Russian expectations as code points: Cyrillic lives in templates/ only.
const ruText = (hex) => String.fromCodePoint(...hex.split(' ').map((code) => parseInt(code, 16)));
// "closing a run with workers"
const RU_RUN_CLOSES = ruText('0437 0430 043a 0440 044b 0442 0438 0438 0020 0437 0430 0445 043e 0434 0430 0020 0441 0020 0077 006f 0072 006b 0065 0072 0027 0430 043c 0438');
// "A statement of the document about the project itself that the code cannot confirm"
const RU_PROJECT_STATEMENT = ruText('0423 0442 0432 0435 0440 0436 0434 0435 043d 0438 0435 0020 0434 043e 043a 0443 043c 0435 043d 0442 0430 0020 043e 0020 0441 0430 043c 043e 043c 0020 043f 0440 043e 0435 043a 0442 0435');
// "A statement about another product is an assumption, not a confirmed Blocking finding"
const RU_OTHER_PRODUCT = ruText('0423 0442 0432 0435 0440 0436 0434 0435 043d 0438 0435 0020 043e 0020 043f 043e 0432 0435 0434 0435 043d 0438 0438 0020 0434 0440 0443 0433 043e 0433 043e 0020 043f 0440 043e 0434 0443 043a 0442 0430 002c 0020 043a 043e 0442 043e 0440 043e 0435 0020 043d 0435 0020 0443 0434 0430 043b 043e 0441 044c 0020 043f 0440 043e 0432 0435 0440 0438 0442 044c 0020 0441 0430 043c 043e 043c 0443 002c 0020 2014 0020 043d 0435 0020 044d 0442 043e 0442 0020 0441 043b 0443 0447 0430 0439 003a 0020 044d 0442 043e 0020 043f 0440 0435 0434 043f 043e 043b 043e 0436 0435 043d 0438 0435 002c 0020 0435 0433 043e 0020 0437 0430 0432 043e 0434 044f 0442 0020 0437 0430 043f 0438 0441 044c 044e 0020 0060 002d 002d 0068 0079 0070 006f 0074 0068 0065 0073 0069 0073 0060 0020 0441 0020 0446 0435 043d 043e 0439 0020 043f 043e 0020 0440 0430 0437 0434 0435 043b 0443 0020 00ab 0417 0430 0432 0435 0434 0435 043d 0438 0435 0020 043d 0430 0445 043e 0434 043e 043a 00bb 002c 0020 0430 0020 043d 0435 0020 043f 043e 0434 0442 0432 0435 0440 0436 0434 0451 043d 043d 043e 0439 0020 043d 0430 0445 043e 0434 043a 043e 0439 0020 0042 006c 006f 0063 006b 0069 006e 0067 002e');
const WRITER_REFUSALS = [
  '{config}: writer must be an object with optional style and currency arrays',
  '{config}: writer.{field} is unknown; expected style or currency',
  '{config}: writer.{field} must be an array of glob strings',
  '{config}: writer.{field}[{i}] must be a non-empty glob string',
];

// The Russian paragraph that is the twin of the English one holding `en`: the same code spans.
function twinParagraph(enText, en) {
  const enLine = enText.split('\n').find((line) => line.includes(en));
  const ruLine = ruTwinLine(RU_SKILL, en);
  assert.deepEqual(ruLine.match(/`[^`]+`/g), enLine.match(/`[^`]+`/g), `the twin of “${en}” keeps the code spans`);
  return ruLine;
}

function headings(rel) {
  return readFileSync(path.join(TEMPLATES_DIR, ...rel.split('/')), 'utf8').match(HEADING_RE) ?? [];
}

function sections(rel) {
  const text = readFileSync(path.join(TEMPLATES_DIR, ...rel.split('/')), 'utf8');
  return text.split(/^## .+$/gm).slice(1);
}

function emptyRepo() {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-writer-')));
  spawnSync('git', ['-C', root, 'init', '-q', '-b', 'main']);
  return root;
}

test('writer templates: parity and stable headings', () => {
  assert.deepEqual(templateParity(), []);
  const en = readFileSync(path.join(TEMPLATES_DIR, 'en/skills/backslop-writer/SKILL.md'), 'utf8');
  const ru = readFileSync(path.join(TEMPLATES_DIR, 'skills/backslop-writer/SKILL.md'), 'utf8');
  assert.doesNotMatch(en, /superseding ADR/);
  assert.doesNotMatch(ru, /superseding ADR/);
  assert.match(en, /every documentation or configured currency surface[\s\S]*not touched by the diff/);
  assert.match(twinParagraph(en, 'every documentation or configured currency surface'), /diff/);
  assert.match(en, /A fact the original states and the translation lacks is not added by the pass: record it in the currency ledger row and file a task with evidence\./);
  assert.match(twinParagraph(en, 'A fact the original states and the translation lacks'), /currency ledger/);
  const enHeadings = headings('en/skills/backslop-writer/SKILL.md');
  assert.deepEqual(enHeadings, [
    '## Precedence',
    '## Scope',
    '## Local Rules',
    '## Language',
    '## Release Mode',
    '## Batch Close Mode',
    ...AUDIT_HEADINGS,
    '## Currency Ledger',
    '## Style Ledger',
    '## Output',
  ]);
  const ruHeadings = headings('skills/backslop-writer/SKILL.md');
  assert.equal(ruHeadings.length, enHeadings.length);
  assert.deepEqual([...ruHeadings.slice(0, AUDIT_AT), ...ruHeadings.slice(AUDIT_AT + AUDIT_HEADINGS.length)], [
    ...enHeadings.slice(0, AUDIT_AT).map((heading) => ruTwinLine(RU_SKILL, heading)),
    '## Currency ledger',
    '## Style ledger',
    '## Output',
  ]);
  assert.match(ruHeadings[AUDIT_AT], /audit$/);
});

test('writer: the README and the skill description name the closing of a run with workers', () => {
  const readme = readFileSync(path.join(REPO, 'README.md'), 'utf8');
  assert.doesNotMatch(readme, /worker\sbatch/i);
  assert.match(readme, /when a run with workers closes/);
  const descriptions = ['en/skills/backslop-writer/SKILL.md', RU_SKILL].map((rel) => (
    readFileSync(path.join(TEMPLATES_DIR, ...rel.split('/')), 'utf8').match(/^description: (".*")$/m)[1]));
  assert.match(descriptions[0], /closing a run with workers/);
  assert.doesNotMatch(descriptions[0], /worker\sbatch/i);
  assert.ok(descriptions[1].includes(RU_RUN_CLOSES), 'the twin says a run with workers closes');
  assert.doesNotMatch(descriptions[1], /worker-/, 'the twin does not glue worker to the batch');
});

test('writer templates: a statement about another product is an assumption in both layers', () => {
  const en = readFileSync(path.join(TEMPLATES_DIR, 'en/skills/backslop-writer/SKILL.md'), 'utf8');
  const step = en.split('\n').find((line) => line.startsWith('3. Read the document as its reader'));
  assert.match(step, /about this project that the code cannot confirm is an unverifiable fact/);
  assert.match(step, /behaviour of another product that you cannot verify yourself[^.]*assumption[^.]*`--hypothesis` entry with a cost/);
  assert.match(step, /not as a confirmed Blocking finding/);
  const twin = twinParagraph(en, 'A statement about the behaviour of another product');
  assert.ok(twin.includes(RU_PROJECT_STATEMENT), 'the twin limits the confirmed finding to the project itself');
  assert.ok(twin.includes(RU_OTHER_PRODUCT), 'the twin makes another product an assumption, not a confirmed finding');
});

test('writer templates: both layers carry the audit mode, its report fields and the cost mapping', () => {
  for (const rel of ['en/skills/backslop-writer/SKILL.md', 'skills/backslop-writer/SKILL.md']) {
    const [mode, report, filing, check, hold] = sections(rel).slice(AUDIT_AT, AUDIT_AT + AUDIT_HEADINGS.length);
    assert.match(mode, /`backslop-techdoc`/, rel);
    assert.match(mode, /references\/audit-checklist\.md/, rel);
    for (const field of ['Score', 'Shippable', 'Blocking', 'Language', 'Local style guide', 'Findings', 'Filed as']) {
      assert.ok(report.includes(`\`${field}\``), `${rel}: the report names no ${field} field`);
    }
    for (const [severity, cost] of [['Blocking', 'critical'], ['High', 'major'], ['Medium, Low', 'minor']]) {
      assert.match(filing, new RegExp(`\\| ${severity} \\| \`${cost}\` \\|`), `${rel}: ${severity} is not mapped to ${cost}`);
    }
    assert.ok(filing.includes('{{cli}} new <slug> --parent N`'), `${rel}: no card command`);
    assert.ok(filing.includes('{{cli}} new <slug> --parent N --minor --evidence "…"`'), `${rel}: no minor command`);
    assert.ok(filing.includes('--minor --cost <level> --hypothesis --evidence'), `${rel}: no hypothesis command`);
    assert.ok(filing.includes('<!-- quote:before:<path> -->'), `${rel}: no quote:before rule`);
    assert.ok(check.includes('<!-- quote:<path> -->'), `${rel}: the regression check names no quote block`);
    assert.ok(check.includes('`--evidence`'), `${rel}: the regression check does not place a minor entry's check`);
    assert.ok(hold.includes('`Shippable: no`'), `${rel}: the release hold names no Shippable: no`);
    for (const token of ['`{{cli}} archive N.k`', '`{{cli}} archive N.k --into M`', '`Filed as`', '`{{cli}} show N`']) {
      assert.ok(hold.includes(token), `${rel}: the release hold lacks ${token}`);
    }
  }
});

test('init lays out backslop-writer in both languages and writes no writer config', () => {
  for (const lang of ['en', 'ru']) {
    const root = emptyRepo();
    try {
      let r = cli(root, ['init', '--lang', lang, '--tools', TOOLS.join(','), '--cli', 'node bs.js']);
      assert.equal(r.code, 0, r.err);
      assert.equal(JSON.parse(read(root, 'backslop.json')).writer, undefined, 'init wrote writer by default');
      for (const rel of [
        `.claude/skills/${SKILL}/SKILL.md`,
        `.agents/skills/${SKILL}/SKILL.md`,
        `.cursor/rules/${SKILL}.mdc`,
      ]) {
        assert.ok(existsSync(path.join(root, ...rel.split('/'))), `${lang}: ${rel} is missing`);
      }
      assert.match(read(root, `.claude/skills/${SKILL}/SKILL.md`), /^---\nname: backslop-writer\n[\s\S]*\n---\n<!-- backslop:generated -->\n/);
      const sourceRel = lang === 'en' ? `en/skills/${SKILL}/SKILL.md` : `skills/${SKILL}/SKILL.md`;
      const source = readFileSync(path.join(TEMPLATES_DIR, ...sourceRel.split('/')), 'utf8')
        .replace(/\r\n/g, '\n').replaceAll('{{docs}}', 'docs').replaceAll('{{cli}}', 'node bs.js');
      for (const adapter of ['.claude', '.agents']) {
        const actual = read(root, `${adapter}/skills/${SKILL}/SKILL.md`)
          .replace('<!-- backslop:generated -->\n', '');
        assert.equal(actual, source, `${lang}: ${adapter} differs from the writer template`);
      }
      assert.match(read(root, `.agents/skills/${SKILL}/SKILL.md`), new RegExp(`(${['## Release Mode', ruTwinLine(RU_SKILL, '## Release Mode')].map(escapeRe).join('|')})\\n`));
      const description = lang === 'en'
        ? /^---\ndescription: "Run the backslop technical-writer pass/m
        : new RegExp(`^---\\ndescription: ${escapeRe(source.match(/^description: (".*")$/m)[1])}`, 'm');
      assert.match(read(root, `.cursor/rules/${SKILL}.mdc`), description);
      r = cli(root, ['lint']);
      assert.equal(r.code, 0, r.err + r.out);
    } finally {
      cleanup(root);
    }
  }
});

test('config: writer refusals name each field in English and Russian', () => {
  const root = makeProject({ git: false });
  try {
    for (const lang of ['en', 'ru']) {
      for (const [writer, field] of [
        [null, 'writer'],
        [[], 'writer'],
        [{ extra: [] }, 'writer.extra'],
        [{ style: 'docs/**' }, 'writer.style'],
        [{ currency: null }, 'writer.currency'],
        [{ style: [false] }, 'writer.style[0]'],
        [{ currency: ['bin/**', 7] }, 'writer.currency[1]'],
        [{ style: [' '] }, 'writer.style[0]'],
      ]) {
        put(root, 'backslop.json', `${JSON.stringify({
          prefix: 'BS', docs: 'docs', gates: [], lang, tools: [], writer,
        })}\n`);
        const r = cli(root, ['status']);
        assert.equal(r.code, 1, `${lang}: accepted ${JSON.stringify(writer)}`);
        assert.ok(r.err.includes(field), `${lang}: missing ${field} in ${r.err}`);
        assert.match(r.err, lang === 'en' ? /must be|is unknown/ : new RegExp(WRITER_REFUSALS.map((en) => ruRe(en).source).join('|')));
      }
    }
  } finally {
    cleanup(root);
  }
});

test('config: writer accepts style and currency arrays and refuses named bad fields', () => {
  const root = makeProject({ git: false });
  const setConfig = (patch) => put(root, 'backslop.json', `${JSON.stringify({
    prefix: 'BS', docs: 'docs', gates: [], lang: 'en', tools: [], ...patch,
  }, null, 2)}\n`);
  try {
    setConfig({ writer: { style: ['guides/**'], currency: ['bin/**', 'templates/skills/**'] } });
    assert.deepEqual(loadConfig(root).writer, { style: ['guides/**'], currency: ['bin/**', 'templates/skills/**'] });

    setConfig({ writer: { style: [], extra: ['docs/**'] } });
    assert.throws(() => loadConfig(root), /writer\.extra is unknown/);
    let r = cli(root, ['status']);
    assert.equal(r.code, 1);
    assert.match(r.err, /^✖ backslop\.json: writer\.extra is unknown/);

    setConfig({ writer: { currency: ['bin/help.mjs', 7] } });
    assert.throws(() => loadConfig(root), /writer\.currency\[1\] must be a non-empty glob string/);
    r = cli(root, ['status']);
    assert.equal(r.code, 1);
    assert.match(r.err, /^✖ backslop\.json: writer\.currency\[1\] must be a non-empty glob string/);

    setConfig({ writer: { style: 'docs/**' } });
    assert.throws(() => loadConfig(root), /writer\.style must be an array/);
  } finally {
    cleanup(root);
  }
});
