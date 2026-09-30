import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TEMPLATES_DIR, renderProjectTemplate, renderTemplate, templateParity, templateRel, templateSlots } from '../lib/templates.js';
import { srcFiles } from '../lib/mdwalk.js';
import {
  FIELD_AREA, FIELD_COST, FIELD_CREATED, FIELD_DEPS, FIELD_ORDER, FIELD_PARENT, FIELD_PREV_ORDER, FIELD_TAKEN,
  SECTION_CHECKS, SECTION_CONTEXT, SECTION_DEFERRED, SECTION_EVIDENCE, SECTION_OUT, SECTION_WORK,
  fieldName, getField, readTitle, sectionName, sections,
} from '../lib/tasks.js';
import { cleanup, put } from './helpers.mjs';

test('template parity: состав и placeholders совпадают', () => {
  assert.deepEqual(templateParity(), []);
});

test('template parity and slot messages follow the project language', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'backslop-templates-'));
  try {
    put(root, 'adr.md', '{{date}} {{number}} {{title}} {{budget}}\n');
    put(root, 'only-ru.md', 'ru\n');
    put(root, 'en/adr.md', '{{date}} {{number}} {{title}} {{budget}}\n');
    assert.deepEqual(templateParity(root, 'ru'), ['templates/only-ru.md: нет английского исходника templates/en/only-ru.md']);
    assert.ok(templateSlots(root, 'ru').includes('templates/adr.md: подстановке {{budget}} не передан ключ'));
  } finally { cleanup(root); }
});

// Фикстура двух слоёв: рендер не нужен, гейт сравнивает файлы механически.
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
      'skills/backslop-task/SKILL.md': '---\nname: backslop-task\ndescription: Цикл одной задачи\n---\n\n# Заголовок\n',
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
      'skills/x/SKILL.md': '---\nname: x\ndescription: "Делает x"\n---\n\n# X\n',
      'en/skills/x/SKILL.md': '---\nname: x\ndescription: "abc\n---\n\n# X\n',
    },
    expected: ['templates/en/skills/x/SKILL.md frontmatter description is not a valid JSON string'],
  },
  {
    name: 'a malformed quoted name is an error, not a throw',
    files: {
      'skills/x/SKILL.md': '---\nname: "x\ndescription: "Делает x"\n---\n\n# X\n',
      'en/skills/x/SKILL.md': '---\nname: x\ndescription: "Does x"\n---\n\n# X\n',
    },
    expected: ['templates/skills/x/SKILL.md frontmatter name is not a valid JSON string'],
  },
  {
    name: 'a different number of headings; `# ` inside a code block is not a heading',
    files: {
      'docs/README.md': '# Один\n\n## Два\n',
      'en/docs/README.md': '# One\n\n```sh\n# not a heading\n```\n',
    },
    expected: ['templates/docs/README.md headings differ from the en source templates/en/docs/README.md: expected 1, found 1,2'],
  },
  {
    name: 'Cyrillic in a file of the English layer',
    files: {
      'task.md': '# Задача\n',
      'en/task.md': '# Task\n\nОписание\n',
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

test('templates: agents-probe.md держит {{probe}} в код-спане — на этом стоит форма поля probe', () => {
  for (const rel of ['agents-probe.md', 'en/agents-probe.md']) {
    const text = readFileSync(path.join(TEMPLATES_DIR, ...rel.split('/')), 'utf8');
    assert.equal((text.match(/`/g) ?? []).length, 2, `${rel}: обратных кавычек ровно две — пара код-спана`);
    assert.match(text, /`\{\{probe\}\}`/, `${rel}: значение стоит внутри код-спана`);
  }
});

// Фронтматтер — YAML-мэппинг: значение либо JSON-строка, либо плоский скаляр без «: », « #»,
// хвостового «:» и индикатора YAML первым символом. Парсера нет (ADR-039).
const YAML_INDICATOR = /^(?:[*&!%@`{[|>?#,\]}']|-(?:\s|$))/;

function frontmatterFaults(rel, text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!m) return [`${rel}: фронтматтера нет`];
  const faults = [];
  for (const line of m[1].split(/\r?\n/)) {
    const key = line.match(/^([A-Za-z][\w-]*): /)?.[1];
    if (!key) { faults.push(`${rel}: строка не «ключ: значение» — ${line}`); continue; }
    const value = line.slice(key.length + 2);
    if (value.startsWith('"')) {
      try { JSON.parse(value); } catch { faults.push(`${rel}: ${key} — закавыченное значение не разбирается как строка`); }
      continue;
    }
    if (value.includes(': ')) faults.push(`${rel}: ${key} — плоский скаляр с «: » внутри`);
    if (value.includes(' #')) faults.push(`${rel}: ${key} — плоский скаляр с « #» внутри`);
    if (value.endsWith(':')) faults.push(`${rel}: ${key} — плоский скаляр кончается на «:»`);
    if (YAML_INDICATOR.test(value)) faults.push(`${rel}: ${key} — плоский скаляр начинается с индикатора YAML`);
  }
  return faults;
}

test('templates: фронтматтер скиллов разбирается как YAML-мэппинг — плоский скаляр без примет', () => {
  const files = [
    ...srcFiles(TEMPLATES_DIR, '', ['.md']).filter(([rel]) => !rel.startsWith('en/')),
    ...srcFiles(path.join(TEMPLATES_DIR, 'en'), '', ['.md']).map(([rel, abs]) => [`en/${rel}`, abs]),
  ].filter(([rel]) => rel.endsWith('/SKILL.md'));
  assert.equal(files.length, 6, 'три скилла в двух слоях');
  assert.deepEqual(files.flatMap(([rel, abs]) => frontmatterFaults(rel, readFileSync(abs, 'utf8'))), []);
});

// Слоты: пара «плейсхолдер ↔ ключ в vars». Обратная половина (ключ без места) на частичной фикстуре
// шумит по чужим строкам реестра — она проверяется отдельной пробой ниже.
test('template slots: реестр и шаблоны инструмента сходятся', () => {
  assert.deepEqual(templateSlots(), []);
});

test('template slots: имя без ключа и шаблон вне реестра', () => {
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

test('template slots: объявленный ключ, которому не нашлось места в шаблоне', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'backslop-templates-'));
  try {
    put(root, 'adr.md', '{{date}} {{number}}\n');
    put(root, 'en/adr.md', '{{date}} {{number}}\n');
    assert.ok(templateSlots(root, 'en').includes('TEMPLATE_KEYS: title is declared but no template uses it'));
  } finally { cleanup(root); }
});

test('renderTemplate: подстановка без ключа — отказ, а не буквальный {{…}} читателю', () => {
  assert.throws(() => renderTemplate('adr.md', { number: 1, title: 'x' }),
    /adr\.md: подстановке \{\{date\}\} не передан ключ date/);
});

// Эта пара рендерится в docs/ репозитория 1:1 (AGENTS.md): без сверки правка одной стороны
// расходится с другой молча, а цитаты и ссылки карточек смотрят в рабочую копию.
test('self-host: the rules pair and the LOG header in docs/ are the render of the template in the project language', () => {
  const repo = path.dirname(TEMPLATES_DIR);
  const cfg = JSON.parse(readFileSync(path.join(repo, 'backslop.json'), 'utf8'));
  const project = JSON.parse(readFileSync(path.join(repo, 'package.json'), 'utf8')).name;
  for (const rel of ['docs/backlog/README.md', 'docs/archive/README.md']) {
    const expected = renderProjectTemplate(cfg, rel, { cli: cfg.cli, prefix: cfg.prefix, project });
    assert.equal(readFileSync(path.join(repo, ...rel.split('/')), 'utf8'), expected, `${rel} differs from its ${cfg.lang} template`);
  }
  const log = readFileSync(path.join(repo, 'docs', 'archive', 'LOG.md'), 'utf8').replace(/\r\n/g, '\n');
  const header = log.slice(0, log.search(/^- <a id=/m)).trimEnd();
  const expected = renderProjectTemplate(cfg, 'docs/archive/LOG.md', { cli: cfg.cli, prefix: cfg.prefix }).trimEnd();
  assert.equal(header, expected, `docs/archive/LOG.md header differs from its ${cfg.lang} template`);
});

// A folded batch cannot be reloaded by a write: the close order lives in the backlog README
// of both language layers, and the batch skill only links there.
test('backlog README: a batch is folded after its entries', () => {
  for (const rel of ['docs/backlog/README.md', 'en/docs/backlog/README.md']) {
    const text = readFileSync(path.join(TEMPLATES_DIR, ...rel.split('/')), 'utf8');
    const open = text.indexOf(rel.startsWith('en/') ? 'Closing batch M' : 'Закрытие пачки M');
    assert.ok(open !== -1, `${rel}: the closing paragraph of a batch is not found`);
    const archive = text.indexOf('`{{cli}} archive M`', open);
    const into = text.indexOf('`{{cli}} archive N.k --into M`', open);
    const fold = text.indexOf('`{{cli}} fold M`', open);
    assert.ok(archive !== -1 && archive < into && into < fold, `${rel}: the closing order is not archive M, the entries, fold M`);
  }
});

test('backslop-batch: step 4 links the backslop-task recipe', () => {
  for (const rel of ['skills/backslop-batch/SKILL.md', 'en/skills/backslop-batch/SKILL.md']) {
    const text = readFileSync(path.join(TEMPLATES_DIR, ...rel.split('/')), 'utf8');
    const accept = text.split('\n').find((line) => line.startsWith('4. ') && line.includes('../backslop-task/SKILL.md#'));
    assert.ok(accept, `${rel}: step 4 with the link to the backslop-task recipe not found`);
    const heading = rel.startsWith('en/') ? 'acceptance-and-archive' : 'приёмка-и-архив';
    assert.ok(accept.includes(`(../backslop-task/SKILL.md#${heading})`), `${rel}: step 4 does not link the backslop-task acceptance section`);
    assert.ok(!accept.includes('BACKSLOP_DRAFT') && !accept.includes('git reset --soft'), `${rel}: step 4 restates the recipe instead of linking it`);
    const track = accept.indexOf(rel.startsWith('en/') ? 'leaving as one commit' : 'уезжающий одним коммитом');
    assert.ok(track !== -1 && accept.indexOf('`{{cli}} fold N`', track) > accept.indexOf('`{{cli}} archive N`', track),
      `${rel}: the multi-task track is not named: archive directories without fold, fold in the next commit`);
    const plain = rel.startsWith('en/') ? 'without the draft and without `reset --soft`' : 'без заготовки и без `reset --soft`';
    assert.ok(accept.indexOf(plain, track) !== -1, `${rel}: the fold commit after a multi-task track is not named a plain commit without the draft`);
    const gates = rel.startsWith('en/') ? 'Run gates before committing, on an unchanged tree' : 'Гейты — до коммита, на неподвижном дереве';
    assert.ok(accept.includes(gates), `${rel}: step 4 does not say when the gates of the integrated tree run`);
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
