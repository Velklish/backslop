import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { TEMPLATES_DIR, renderProjectTemplate, renderTemplate, templateParity, templateRel, templateSlots } from '../lib/templates.js';
import { srcFiles } from '../lib/mdwalk.js';
import { slugOf } from '../lib/links.js';
import {
  FIELD_AREA, FIELD_COST, FIELD_CREATED, FIELD_DEPS, FIELD_ORDER, FIELD_PARENT, FIELD_PREV_ORDER, FIELD_TAKEN,
  SECTION_CHECKS, SECTION_CONTEXT, SECTION_DEFERRED, SECTION_EVIDENCE, SECTION_OUT, SECTION_WORK,
  fieldName, getField, readTitle, sectionName, sections,
} from '../lib/tasks.js';
import { SECTION, cleanup, put, ru, ruTwinLine, run, toolCli, toolCopy } from './helpers.mjs';

test('template parity: the composition and placeholders match', () => {
  assert.deepEqual(templateParity(), []);
});

test('template parity and slot messages follow the project language', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'backslop-templates-'));
  try {
    put(root, 'adr.md', '{{date}} {{number}} {{title}} {{budget}}\n');
    put(root, 'only-ru.md', 'ru\n');
    put(root, 'en/adr.md', '{{date}} {{number}} {{title}} {{budget}}\n');
    assert.deepEqual(templateParity(root, 'ru'), [ru('templates/{rel} has no en source templates/en/{rel}', { rel: 'only-ru.md' })]);
    assert.ok(templateSlots(root, 'ru').includes(ru('templates/{layer}{rel} placeholder {{{name}}} has no key in vars', { layer: '', rel: 'adr.md', name: 'budget' })));
  } finally { cleanup(root); }
});

// A fixture of two layers: no render is needed, the gate compares the files mechanically.
function parity(files) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'backslop-templates-'));
  try {
    for (const [rel, text] of Object.entries(files)) put(root, rel, text);
    return templateParity(root, 'en');
  } finally { cleanup(root); }
}

const PARITY_CASES = [
  {
    name: 'names missing, extra and mismatched placeholders',
    files: {
      'task.md': '{{id}} {{title}}\n',
      'only-ru.md': 'ru\n',
      'repeat.md': '{{cli}}\n',
      'en/task.md': '{{id}}\n',
      'en/only-en.md': 'en\n',
      'en/repeat.md': '{{cli}} and again {{cli}}\n',
    },
    expected: [
      'templates/only-en.md: ru twin of templates/en/only-en.md is missing',
      'templates/only-ru.md has no en source templates/en/only-ru.md',
      'templates/task.md placeholders differ from the en source templates/en/task.md: expected id, found id, title',
    ],
  },
  {
    name: 'a missing description and a foreign name in SKILL.md',
    files: {
      'skills/backslop-task/SKILL.md': '---\nname: backslop-task\ndescription: One task cycle\n---\n\n# Heading\n',
      'en/skills/backslop-task/SKILL.md': '---\nname: backslop-tsk\n---\n\n# Title\n',
    },
    expected: [
      'templates/en/skills/backslop-task/SKILL.md frontmatter name is backslop-tsk, expected backslop-task',
      'templates/en/skills/backslop-task/SKILL.md frontmatter has no description',
    ],
  },
  {
    name: 'a quoted empty description is an error',
    files: {
      'skills/x/SKILL.md': '---\nname: x\ndescription: ""\n---\n\n# X\n',
      'en/skills/x/SKILL.md': '---\nname: x\ndescription: "Does x"\n---\n\n# X\n',
    },
    expected: ['templates/skills/x/SKILL.md frontmatter has no description'],
  },
  {
    name: 'a malformed quoted description is an error, not a throw',
    files: {
      'skills/x/SKILL.md': '---\nname: x\ndescription: "Does x in the other layer"\n---\n\n# X\n',
      'en/skills/x/SKILL.md': '---\nname: x\ndescription: "abc\n---\n\n# X\n',
    },
    expected: ['templates/en/skills/x/SKILL.md frontmatter description is not a valid JSON string'],
  },
  {
    name: 'a malformed quoted name is an error, not a throw',
    files: {
      'skills/x/SKILL.md': '---\nname: "x\ndescription: "Does x in the other layer"\n---\n\n# X\n',
      'en/skills/x/SKILL.md': '---\nname: x\ndescription: "Does x"\n---\n\n# X\n',
    },
    expected: ['templates/skills/x/SKILL.md frontmatter name is not a valid JSON string'],
  },
  {
    name: 'a different number of headings; `# ` inside a code block is not a heading',
    files: {
      'docs/README.md': '# One\n\n## Two\n',
      'en/docs/README.md': '# One\n\n```sh\n# not a heading\n```\n',
    },
    expected: ['templates/docs/README.md headings differ from the en source templates/en/docs/README.md: expected 1, found 1,2'],
  },
  {
    name: 'Cyrillic in a file of the English layer',
    files: {
      'task.md': '# Task\n',
      'en/task.md': `# Task\n\n${SECTION.context}\n`,
    },
    expected: ['templates/en/task.md contains Cyrillic'],
  },
];

for (const { name, files, expected } of PARITY_CASES) {
  test(`template parity: ${name}`, () => assert.deepEqual(parity(files), expected));
}

// Parity compares heading levels, not text: a renamed heading or label passes it, and only the task
// parser's names catch it before `brief` and `mv` stop finding the section.
const FIELDS = [FIELD_ORDER, FIELD_PREV_ORDER, FIELD_AREA, FIELD_CREATED, FIELD_TAKEN, FIELD_DEPS, FIELD_PARENT, FIELD_COST];
const SECTIONS = [SECTION_CONTEXT, SECTION_WORK, SECTION_OUT, SECTION_CHECKS, SECTION_DEFERRED, SECTION_EVIDENCE];
const REQUIRED = { 'task.md': [SECTION_WORK, SECTION_OUT, SECTION_CHECKS], 'minor.md': [SECTION_EVIDENCE] };
const CARD_VARS = { area: 'a', context: 'c', cost: 'minor', date: '2026-01-01', id: 'X-1', parent: 'X-0', title: 't' };

for (const lang of ['ru', 'en']) {
  for (const rel of ['task.md', 'minor.md']) {
    test(`templates: ${lang} ${rel} headings and field labels are names the task parser knows`, () => {
      const text = renderTemplate(templateRel(lang, rel), CARD_VARS);
      assert.deepEqual(readTitle(text), { id: 'X-1', title: 't' }, `${lang} ${rel}: readTitle reads the title line`);
      const { clean, list } = sections(text);
      assert.ok(list.length, `${rel}: the template has ## sections`);
      for (const { name } of list) {
        assert.ok(SECTIONS.some((key) => sectionName(key, lang) === name), `${lang} ${rel}: unknown section "${name}"`);
      }
      for (const key of REQUIRED[rel]) {
        assert.ok(list.some(({ name }) => name === sectionName(key, lang)), `${lang} ${rel}: missing section "${sectionName(key, lang)}"`);
      }
      const labels = clean.slice(0, list[0].start).flatMap((line) => line.match(/^- \*\*(.+?):\*\* /)?.[1] ?? []);
      assert.ok(labels.length, `${rel}: the template has header fields`);
      for (const label of labels) {
        const key = FIELDS.find((k) => fieldName(k, lang) === label);
        assert.ok(key, `${lang} ${rel}: unknown field "${label}"`);
        assert.notEqual(getField(text, key), null, `${lang} ${rel}: getField does not read "${label}"`);
      }
    });
  }
}

test('templates: agents-probe.md holds {{probe}} in a code span — the probe field form rests on it', () => {
  for (const rel of ['agents-probe.md', 'en/agents-probe.md']) {
    const text = readFileSync(path.join(TEMPLATES_DIR, ...rel.split('/')), 'utf8');
    assert.equal((text.match(/`/g) ?? []).length, 2, `${rel}: exactly two backticks — the pair of a code span`);
    assert.match(text, /`\{\{probe\}\}`/, `${rel}: the value stands inside a code span`);
  }
});

// Frontmatter is a YAML mapping: a value is a JSON string or a flat scalar without “: ”, “ #”, a
// trailing “:” and a YAML indicator as its first character. There is no parser.
const YAML_INDICATOR = /^(?:[*&!%@`{[|>?#,\]}']|-(?:\s|$))/;

function frontmatterFaults(rel, text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!m) return [`${rel}: no frontmatter`];
  const faults = [];
  for (const line of m[1].split(/\r?\n/)) {
    const key = line.match(/^([A-Za-z][\w-]*): /)?.[1];
    if (!key) { faults.push(`${rel}: the line is not “key: value” — ${line}`); continue; }
    const value = line.slice(key.length + 2);
    if (value.startsWith('"')) {
      try { JSON.parse(value); } catch { faults.push(`${rel}: ${key} — the quoted value does not parse as a string`); }
      continue;
    }
    if (value.includes(': ')) faults.push(`${rel}: ${key} — a flat scalar with “: ” inside`);
    if (value.includes(' #')) faults.push(`${rel}: ${key} — a flat scalar with “ #” inside`);
    if (value.endsWith(':')) faults.push(`${rel}: ${key} — a flat scalar ends with “:”`);
    if (YAML_INDICATOR.test(value)) faults.push(`${rel}: ${key} — a flat scalar starts with a YAML indicator`);
  }
  return faults;
}

test('templates: skill frontmatter parses as a YAML mapping — a flat scalar without the telltale signs', () => {
  const files = [
    ...srcFiles(TEMPLATES_DIR, '', ['.md']).filter(([rel]) => !rel.startsWith('en/') && !rel.startsWith('vendor/')),
    ...srcFiles(path.join(TEMPLATES_DIR, 'en'), '', ['.md']).map(([rel, abs]) => [`en/${rel}`, abs]),
  ].filter(([rel]) => rel.endsWith('/SKILL.md'));
  assert.equal(files.length, 8, 'four skills in two layers');
  assert.deepEqual(files.flatMap(([rel, abs]) => frontmatterFaults(rel, readFileSync(abs, 'utf8'))), []);
});

// Slots: the pair “placeholder ↔ key in vars”. The reverse half (a key with no place) on a partial
// fixture is noisy over foreign registry rows — a separate probe below checks it.
test('template slots: the registry and the tool templates agree', () => {
  assert.deepEqual(templateSlots(), []);
});

test('template slots: a name without a key and a template outside the registry', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'backslop-templates-'));
  try {
    put(root, 'adr.md', '{{date}} {{number}} {{title}} {{budget}}\n');
    put(root, 'stray.md', '{{cli}}\n');
    put(root, 'en/adr.md', '{{date}} {{number}} {{title}}\n');
    assert.deepEqual(templateSlots(root, 'en').filter((m) => !m.startsWith('TEMPLATE_KEYS:')).sort(), [
      'templates/adr.md placeholder {{budget}} has no key in vars',
      'templates/stray.md has placeholders but no TEMPLATE_KEYS row',
    ]);
  } finally { cleanup(root); }
});

test('template slots: a declared key that found no place in a template', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'backslop-templates-'));
  try {
    put(root, 'adr.md', '{{date}} {{number}}\n');
    put(root, 'en/adr.md', '{{date}} {{number}}\n');
    assert.ok(templateSlots(root, 'en').includes('TEMPLATE_KEYS: title is declared but no template uses it'));
  } finally { cleanup(root); }
});

test('renderTemplate: a placeholder without a key is a refusal, not a literal {{…}} to the reader', () => {
  assert.throws(() => renderTemplate('adr.md', { number: 1, title: 'x' }),
    /adr\.md: placeholder \{\{date\}\} is given no key date/);
});

// This pair renders into the repo docs/ 1:1 (AGENTS.md): without the check an edit of one side
// drifts from the other silently, while card quotes and links look at the working copy.
test('self-host: the rules pair, ROLES.md and the LOG header in docs/ are the render of the template in the project language', () => {
  const repo = path.dirname(TEMPLATES_DIR);
  const cfg = JSON.parse(readFileSync(path.join(repo, 'backslop.json'), 'utf8'));
  const project = JSON.parse(readFileSync(path.join(repo, 'package.json'), 'utf8')).name;
  for (const rel of ['docs/backlog/README.md', 'docs/archive/README.md', 'docs/ROLES.md']) {
    const expected = renderProjectTemplate(cfg, rel, { cli: cfg.cli, prefix: cfg.prefix, project });
    assert.equal(readFileSync(path.join(repo, ...rel.split('/')), 'utf8'), expected, `${rel} differs from its ${cfg.lang} template`);
  }
  const log = readFileSync(path.join(repo, 'docs', 'archive', 'LOG.md'), 'utf8').replace(/\r\n/g, '\n');
  const header = log.slice(0, log.search(/^- <a id=/m)).trimEnd();
  const expected = renderProjectTemplate(cfg, 'docs/archive/LOG.md', { cli: cfg.cli, prefix: cfg.prefix }).trimEnd();
  assert.equal(header, expected, `docs/archive/LOG.md header differs from its ${cfg.lang} template`);
});

test('archive header: the revision is the body source and can include edits after closure', () => {
  const text = readFileSync(path.join(TEMPLATES_DIR, 'en/docs/archive/LOG.md'), 'utf8');
  assert.ok(text.includes('number with slug, closing date, outcome, body revision, and title'));
  assert.ok(text.includes('The revision names the commit `show N` reads the body from, which may include edits made after closure.'));
  assert.ok(!text.includes('closing commit'));
});

test('archive header: a task directory is before folding and a journal line is after it', () => {
  const text = readFileSync(path.join(TEMPLATES_DIR, 'en/docs/archive/README.md'), 'utf8');
  const intro = text.split('\n')[2];
  assert.ok(intro.startsWith('Before folding, a closed task is a '));
  assert.ok(intro.endsWith('After folding, it has a line in [LOG.md](LOG.md) and no directory in the tree.'));
});

test('archive header: bulk ordering is top-level with minor entries beside their batch', () => {
  const text = readFileSync(path.join(TEMPLATES_DIR, 'en/docs/archive/LOG.md'), 'utf8');
  assert.ok(text.includes('a bulk fold orders top-level tasks by closing date, equal dates by number.'));
  assert.ok(text.includes("Each batch's minor entries follow its line in numeric order."));
  const repo = path.dirname(TEMPLATES_DIR);
  for (const rel of ['docs/reference/01-layout.md', 'docs/reference/02-cli.md']) {
    const reference = readFileSync(path.join(repo, ...rel.split('/')), 'utf8');
    assert.ok(reference.includes('top-level tasks') || reference.includes('Top-level tasks'), rel);
    assert.ok(reference.includes("Each batch's minor entries follow its"), rel);
  }
});

// A folded batch cannot be reloaded by a write: the close order lives in the backlog README
// of both language layers, and the batch skill only links there.
test('backlog README: a batch is folded after its entries', () => {
  for (const rel of ['docs/backlog/README.md', 'en/docs/backlog/README.md']) {
    const text = readFileSync(path.join(TEMPLATES_DIR, ...rel.split('/')), 'utf8');
    const open = text.indexOf(rel.startsWith('en/') ? 'Closing batch M' : ruTwinLine('docs/backlog/README.md', 'Closing batch M'));
    assert.ok(open !== -1, `${rel}: the closing paragraph of a batch is not found`);
    const archive = text.indexOf('`{{cli}} archive M`', open);
    const into = text.indexOf('`{{cli}} archive N.k --into M`', open);
    const fold = text.indexOf('`{{cli}} fold M`', open);
    assert.ok(archive !== -1 && archive < into && into < fold, `${rel}: the closing order is not archive M, the entries, fold M`);
  }
});

// The role protocol has one home: the README and the block link to it and do not restate it.
test('ROLES.md: the rules the README no longer holds sit in the roles document of both layers', () => {
  for (const layer of ['', 'en/']) {
    const read = (rel) => readFileSync(path.join(TEMPLATES_DIR, ...`${layer}${rel}`.split('/')), 'utf8');
    const roles = read('docs/ROLES.md');
    const readme = read('docs/backlog/README.md');
    const decided = roles.split('\n').filter((line) => /^ {2}- /.test(line));
    assert.equal(decided.length, 3, `${layer}ROLES.md: the three decisions without asking are not found`);
    for (const line of decided) assert.ok(!readme.includes(line.trim().slice(2)), `${layer}README restates a role rule: ${line.trim()}`);
    assert.ok(readme.includes('](../ROLES.md)'), `${layer}README does not link ROLES.md`);
    assert.ok(read('docs/README.md').includes('](ROLES.md)'), `${layer}the docs index does not link ROLES.md`);
    assert.ok(read('agents-section.md').includes('`{{docs}}/ROLES.md`'), `${layer}agents-section.md does not name ROLES.md`);
  }
});

// The README names the criterion of the triage review; step 6 of the block points to it.
test('block step 6 points to the triage criterion of the backlog README, its commands are examples', () => {
  for (const layer of ['', 'en/']) {
    const read = (rel) => readFileSync(path.join(TEMPLATES_DIR, ...`${layer}${rel}`.split('/')), 'utf8');
    const step = read('agents-section.md').split('\n').find((line) => line.startsWith('6. '));
    assert.ok(step?.includes('`{{docs}}/backlog/README.md`'), `${layer}step 6 does not point to the backlog README`);
    assert.ok(step.includes('`triage/`') && step.includes('`{{cli}} mv N queue`'), `${layer}step 6 lost the criterion or its examples`);
    const criterion = read('docs/backlog/README.md').trimEnd().split('\n').at(-1);
    assert.ok(criterion.includes('`triage/`'), `${layer}the last line of the backlog README is not the triage criterion`);
  }
});

// With an attachment the recipe squashes before the fold: two commits, the squash one first.
test('block step 5 carries the attachment branch in both layers: squash, fold, commit the draft', () => {
  for (const layer of ['', 'en/']) {
    const step = readFileSync(path.join(TEMPLATES_DIR, ...`${layer}agents-section.md`.split('/')), 'utf8').split('\n').find((line) => line.startsWith('5. '));
    const squash = step.indexOf('git commit -m "{{prefix}}-N: ');
    const fold = step.indexOf('`{{cli}} fold N >', squash);
    const draft = step.indexOf('git commit --cleanup=verbatim -F', fold);
    assert.ok(squash !== -1 && squash < fold && fold < draft, `${layer}step 5 lacks the attachment branch: squash, then fold, then the draft commit`);
    const seven = readFileSync(path.join(TEMPLATES_DIR, ...`${layer}agents-section.md`.split('/')), 'utf8').split('\n').find((line) => line.startsWith('7. '));
    if (layer === 'en/') assert.ok(seven.includes('as one commit, or as two in the attachment branch of step 5'), 'step 7 does not name the two-commit exception');
  }
});

test('backslop-batch: step 4 links the backslop-task recipe', () => {
  for (const rel of ['skills/backslop-batch/SKILL.md', 'en/skills/backslop-batch/SKILL.md']) {
    const text = readFileSync(path.join(TEMPLATES_DIR, ...rel.split('/')), 'utf8');
    const accept = text.split('\n').find((line) => line.startsWith('4. ') && line.includes('../backslop-task/SKILL.md#'));
    assert.ok(accept, `${rel}: step 4 with the link to the backslop-task recipe not found`);
    const heading = rel.startsWith('en/') ? 'acceptance-and-archive' : slugOf(ruTwinLine('skills/backslop-task/SKILL.md', '## Acceptance and archive').replace(/^#+ /, ''));
    assert.ok(accept.includes(`(../backslop-task/SKILL.md#${heading})`), `${rel}: step 4 does not link the backslop-task acceptance section`);
    assert.ok(!accept.includes('BACKSLOP_DRAFT') && !accept.includes('git reset --soft'), `${rel}: step 4 restates the recipe instead of linking it`);
    // The Russian layer keeps the English sentence order: one index names the same fact.
    const stepOf = (layer) => readFileSync(path.join(TEMPLATES_DIR, ...layer, ...rel.replace(/^en\//, '').split('/')), 'utf8').split('\n').find((line) => line.startsWith('4. '));
    const sentences = (line) => line.trim().split('. ');
    const enSentences = sentences(stepOf(['en']));
    const trackAt = enSentences.findIndex((sentence) => sentence.includes('leaving as one commit'));
    const plainAt = enSentences.findIndex((sentence) => sentence.includes('without the draft'));
    const gates = 'Run gates before committing, on an unchanged tree';
    assert.ok(trackAt !== -1 && plainAt > trackAt && enSentences.at(-1) === `${gates}.`, `${rel}: the English step lost the multi-task track, the plain fold commit or the gates sentence`);
    assert.equal(sentences(accept).length, enSentences.length, `${rel}: step 4 does not keep the sentence order of the English layer`);
    const en = rel.startsWith('en/');
    const track = en ? accept.indexOf('leaving as one commit') : accept.indexOf(sentences(accept)[trackAt]);
    assert.ok(track !== -1 && accept.indexOf('`{{cli}} fold N`', track) > accept.indexOf('`{{cli}} archive N`', track),
      `${rel}: the multi-task track is not named: archive directories without fold, fold in the next commit`);
    const plain = en ? accept.slice(track) : sentences(accept)[plainAt];
    assert.ok(plain.includes(en ? 'without the draft and without `reset --soft`' : '`reset --soft`'), `${rel}: the fold commit after a multi-task track is not named a plain commit without the draft`);
    assert.ok(en ? accept.includes(gates) : accept.endsWith('.') && accept.indexOf(sentences(accept).at(-1)) > accept.indexOf(sentences(accept)[plainAt]), `${rel}: step 4 does not say when the gates of the integrated tree run`);
  }
});

const BARE_COMMAND = /(^|[^{}a-z-])backslop (lint|status|new|adr|mv|gates|fold|archive|seed|brief|tracks|upgrade|migrate|show|changelog|merge-changelog)\b/m;

test('skills: every runnable command is spelled with {{cli}}, none with a bare backslop', () => {
  const files = [
    ...srcFiles(TEMPLATES_DIR, '', ['.md']).filter(([rel]) => rel.startsWith('skills/')),
    ...srcFiles(path.join(TEMPLATES_DIR, 'en'), '', ['.md']).filter(([rel]) => rel.startsWith('skills/')).map(([rel, abs]) => [`en/${rel}`, abs]),
  ];
  assert.ok(files.length >= 10, 'the skill files of both layers are found');
  for (const [rel, abs] of files) {
    assert.doesNotMatch(readFileSync(abs, 'utf8'), BARE_COMMAND, `${rel}: a command is spelled with a bare backslop`);
  }
});

test('backslop-batch: the end of the run reads total of tracks --json, brief stubs are checked for [TODO', () => {
  for (const rel of ['skills/backslop-batch/SKILL.md', 'en/skills/backslop-batch/SKILL.md']) {
    const text = readFileSync(path.join(TEMPLATES_DIR, ...rel.split('/')), 'utf8');
    assert.match(text, /`\{\{cli\}\} tracks --json`/, `${rel}: the end of the run does not use tracks --json`);
    assert.match(text, /`total`/, `${rel}: total is not named`);
    assert.ok(text.includes('`[TODO`'), `${rel}: the [TODO check of the brief output is not named`);
  }
});

test('documentation-fix rule: both layers carry the check, the writer pass and the release sentence', () => {
  const layers = ['', 'en/'];
  const text = (rel) => layers.map((layer) => [layer, readFileSync(path.join(TEMPLATES_DIR, ...(layer + rel).split('/')), 'utf8')]);
  for (const [layer, block] of text('agents-section.md')) {
    const lines = block.split('\n');
    const release = lines.findIndex((line) => line.includes('`backslop-writer`') && !line.startsWith('**'));
    assert.ok(release > 0, `${layer}agents-section.md: no release sentence outside the Skills line`);
    assert.ok(release < lines.findIndex((line) => line.startsWith('1. ')), `${layer}agents-section.md: the release sentence sits inside the numbered steps`);
    const step3 = lines.find((line) => line.startsWith('3. '));
    assert.ok(step3.includes('`quote:`'), `${layer}agents-section.md: step 3 does not name the quote: block`);
    assert.equal(step3.split(/(?<=\.)\s+/).length, 5, `${layer}agents-section.md: step 3 must keep its five sentences, the last one on task citations`);
    assert.match(lines[release], /adapter/, `${layer}agents-section.md: the release sentence lacks the adapter condition`);
    const skills = lines.find((line) => line.includes('`backslop-seed`'));
    for (const name of ['backslop-writer', 'backslop-techdoc', 'backslop-humanizer']) {
      assert.ok(skills.includes(`\`${name}\``), `${layer}agents-section.md: the Skills line omits ${name}`);
    }
  }
  const en = readFileSync(path.join(TEMPLATES_DIR, 'en', 'agents-section.md'), 'utf8');
  for (const sentence of [
    'A documentation fix carries a check that fails on the old text: a `quote:` block, a test or a lint rule.',
    'Documentation does not cite tasks: state the contract, the rationale or the measurement.',
    'When an adapter is selected, before a release commit, run the `backslop-writer` pass in release mode over the diff since the previous tag.',
  ]) assert.ok(en.includes(sentence), `en/agents-section.md lacks: ${sentence}`);
  for (const rel of ['skills/backslop-task/SKILL.md', 'brief.md', 'docs/backlog/README.md']) {
    for (const [layer, body] of text(rel)) assert.ok(body.includes('`quote:`'), `${layer}${rel}: the regression-check rule is missing`);
  }
  for (const [layer, body] of text('skills/backslop-task/SKILL.md')) {
    assert.ok(body.split('\n').find((line) => line.startsWith('3. ')).includes('`backslop-writer`'), `${layer}skills/backslop-task/SKILL.md: step 3 does not point to backslop-writer`);
  }
  for (const [layer, body] of text('skills/backslop-batch/SKILL.md')) {
    const heading = body.split('\n').findIndex((line) => line.startsWith('## ') && line.includes('writer'));
    const section = body.split('\n').slice(heading + 1).join('\n').split('\n## ')[0];
    assert.ok(heading > 0 && section.includes('`backslop-writer`') && section.includes('..HEAD'), `${layer}skills/backslop-batch/SKILL.md: the closing writer pass is missing`);
    for (const token of ['`{{cli}} new <slug> --queue', '`result.md`', '`{{prefix}}-N:`', '`--parent N`']) {
      assert.ok(section.includes(token), `${layer}skills/backslop-batch/SKILL.md: the closing pass lacks ${token}`);
    }
  }
});

test('backslop-task: the report step says an absent not-run or out-of-scope part of the gates summary is 0', () => {
  const notRun = (en) => (en ? ', not run N' : ru(', not run {skipped}', { skipped: 'N' }));
  const outOfScope = (en) => (en ? ' (out of scope K)' : ru(' (out of scope {outOfScope})', { outOfScope: 'K' }));
  const enLine = readFileSync(path.join(TEMPLATES_DIR, 'en', 'skills', 'backslop-task', 'SKILL.md'), 'utf8').split('\n')
    .find((line) => line.startsWith('- gate results as numbers'));
  const ruLine = ruTwinLine('skills/backslop-task/SKILL.md', '- gate results as numbers');
  assert.ok(enLine.includes(notRun(true)) && enLine.includes(outOfScope(true)), 'en: the line names both printed parts');
  assert.ok(enLine.includes('a part that is absent means 0'), 'en: the line says what an absent part means');
  assert.ok(ruLine.includes(notRun(false)) && ruLine.includes(outOfScope(false)), 'ru: the line names both printed parts as the tool prints them');
  // The meaning clause is what the printed parts lead to: the same two zeros, after the last part.
  const zeros = (line, last) => line.slice(line.indexOf(last) + last.length).match(/\b0\b/g)?.length ?? 0;
  assert.equal(zeros(enLine, outOfScope(true)), 2, 'en: the clause says what an absent part is and what the report says');
  assert.equal(zeros(ruLine, outOfScope(false)), 2, 'ru: the clause says what an absent part is and what the report says');
});

test('renderTemplate: a call without a language refuses in English, with no Cyrillic', () => {
  assert.throws(() => renderTemplate('adr.md', { number: 1, title: 'x' }),
    (e) => e.message === 'adr.md: placeholder {{date}} is given no key date');
});

test('renderProjectTemplate: an en project sees the refusal for a placeholder without a key in English only', () => {
  assert.throws(() => renderProjectTemplate({ lang: 'en' }, 'adr.md', { number: 1, title: 'x' }),
    (e) => e.message === 'en/adr.md: placeholder {{date}} is given no key date' && !/\p{Script=Cyrillic}/u.test(e.message));
});

test('the acceptance recipe of the managed block commits the draft with --cleanup=verbatim, in both layers', () => {
  for (const layer of ['en', '']) {
    const text = readFileSync(path.join(TEMPLATES_DIR, layer, 'agents-section.md'), 'utf8');
    assert.ok(text.includes('git commit --cleanup=verbatim -F "$(git rev-parse --git-dir)/BACKSLOP_DRAFT"'), `layer ${layer || 'ru'}`);
  }
});

const JSON_CLI = 'node "C:\\Users\\me\\backslop.js"';
const FRONT = '---\nname: "fixture"\ndescription: "Run {{cli}} first"\n---\n\nBody `{{cli}}`.\n';

test('renderTemplate escapes a value inside a JSON-quoted frontmatter value and keeps it raw elsewhere', async () => {
  const tool = toolCopy((dir) => put(dir, 'templates/fixture.md', FRONT));
  try {
    const { renderTemplate } = await import(pathToFileURL(path.join(tool, 'lib', 'templates.js')));
    const text = renderTemplate('fixture.md', { cli: JSON_CLI });
    const description = text.split('\n')[2];
    assert.equal(JSON.parse(description.slice('description: '.length)), `Run ${JSON_CLI} first`);
    assert.ok(text.endsWith(`Body \`${JSON_CLI}\`.\n`), 'the body takes the value as it is');
    assert.equal(renderTemplate('fixture.md', { cli: 'npx backslop' }), FRONT.replaceAll('{{cli}}', 'npx backslop'), 'a plain value is unchanged');
  } finally { cleanup(tool); }
});

test('init lays out a skill whose description holds a cli with a quote and a backslash', () => {
  const tool = toolCopy((dir) => {
    const skill = path.join(dir, 'templates/en/skills/backslop-task/SKILL.md');
    put(dir, 'templates/en/skills/backslop-task/SKILL.md', readFileSync(skill, 'utf8').replace('description: "', 'description: "Run {{cli}} first. '));
  });
  const project = mkdtempSync(path.join(os.tmpdir(), 'backslop-json-'));
  try {
    run(project, ['init', '-q', '-b', 'main']);
    const r = toolCli(tool, ['init', '--lang', 'en', '--tools', 'cursor,claude,codex', '--cli', JSON_CLI], { cwd: project });
    assert.equal(r.code, 0, r.err);
    for (const rel of ['.claude/skills/backslop-task/SKILL.md', '.agents/skills/backslop-task/SKILL.md', '.cursor/rules/backslop-task.mdc']) {
      const line = readFileSync(path.join(project, rel), 'utf8').split('\n').find((l) => l.startsWith('description: '));
      assert.ok(JSON.parse(line.slice('description: '.length)).startsWith(`Run ${JSON_CLI} first. `), rel);
    }
  } finally { cleanup(tool); cleanup(project); }
});
