import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../lib/config.js';
import { TEMPLATES_DIR, templateParity } from '../lib/templates.js';
import { cleanup, cli, makeProject, put, read } from './helpers.mjs';

const TOOLS = ['claude', 'cursor', 'codex'];
const SKILL = 'backslop-writer';
const HEADING_RE = /^## .+$/gm;
const AUDIT_HEADINGS = ['## Audit Mode', '## Audit Report', '## Filing Findings', '## Regression Check', '## Release Hold'];
const AUDIT_AT = 6;

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
  assert.match(ru, /каждый документ и каждое настроенное место проверки актуальности[\s\S]*diff этого места не коснулся/);
  assert.match(en, /A fact the original states and the translation lacks is not added by the pass: record it in the currency ledger row and file a task with evidence\./);
  assert.match(ru, /Факт, который есть в оригинале, но отсутствует в переводе, этот проход не добавляет: запиши его в строку currency ledger и заведи задачу с уликой\./);
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
    '## Приоритет',
    '## Область',
    '## Локальные правила',
    '## Язык',
    '## Режим release',
    '## Режим batch close',
    '## Currency ledger',
    '## Style ledger',
    '## Output',
  ]);
  assert.match(ruHeadings[AUDIT_AT], /audit$/);
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
      assert.match(read(root, `.agents/skills/${SKILL}/SKILL.md`), /## (Release Mode|Режим release)\n/);
      const description = lang === 'en'
        ? /^---\ndescription: "Run the backslop technical-writer pass/m
        : /^---\ndescription: "Технический проход writer в backslop/m;
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
        assert.match(r.err, lang === 'en' ? /must be|is unknown/ : / — |неизвестен/);
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
