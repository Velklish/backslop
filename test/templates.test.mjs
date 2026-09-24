import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TEMPLATES_DIR, renderTemplate, templateParity, templateSlots } from '../lib/templates.js';
import { srcFiles } from '../lib/mdwalk.js';
import { cleanup, put } from './helpers.mjs';

test('template parity: состав и placeholders совпадают', () => {
  assert.ok(existsSync(path.join(TEMPLATES_DIR, 'en')), 'templates/en/ обязателен в репозитории инструмента');
  assert.deepEqual(templateParity(), []);
});

test('template parity: называет missing, extra и mismatch placeholders', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'backslop-templates-'));
  try {
    put(root, 'task.md', '{{id}} {{title}}\n');
    put(root, 'only-ru.md', 'ru\n');
    put(root, 'repeat.md', '{{cli}}\n');
    put(root, 'en/task.md', '{{id}}\n');
    put(root, 'en/only-en.md', 'en\n');
    put(root, 'en/repeat.md', '{{cli}} and again {{cli}}\n');
    assert.deepEqual(templateParity(root), [
      'templates/en/only-ru.md is missing',
      'templates/en/only-en.md has no source counterpart',
      'templates/en/task.md placeholders differ: id != id, title',
    ]);
  } finally { cleanup(root); }
});

// Фикстура двух слоёв: рендер не нужен, гейт сравнивает файлы механически.
function parity(files) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'backslop-templates-'));
  try {
    for (const [rel, text] of Object.entries(files)) put(root, rel, text);
    return templateParity(root);
  } finally { cleanup(root); }
}

test('templates: agents-probe.md держит {{probe}} в код-спане — на этом стоит форма поля probe', () => {
  for (const rel of ['agents-probe.md', 'en/agents-probe.md']) {
    const text = readFileSync(path.join(TEMPLATES_DIR, ...rel.split('/')), 'utf8');
    assert.equal((text.match(/`/g) ?? []).length, 2, `${rel}: обратных кавычек ровно две — пара код-спана`);
    assert.match(text, /`\{\{probe\}\}`/, `${rel}: значение стоит внутри код-спана`);
  }
});

// Фронтматтер скилла обязан разбираться как YAML-мэппинг. Плоский скаляр ломают четыре вещи:
// «: » и « #» внутри, хвостовое «:» и индикатор YAML первым символом — на этом краснел гейт
// фронтматтера у потребителя после каждого `init` (BS-63). Парсер не тащим: зависимостей у
// инструмента нет (ADR-003), а правило проверяется само — значение либо плоский скаляр без
// этих четырёх примет, либо JSON-строка, которую разберёт любой YAML 1.2. Гейт парности
// (`frontmatterField`) построчный и к этому слеп.
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

test('template parity: пустой description и чужое name в SKILL.md', () => {
  assert.deepEqual(parity({
    'skills/backslop-task/SKILL.md': '---\nname: backslop-task\ndescription: Цикл одной задачи\n---\n\n# Заголовок\n',
    'en/skills/backslop-task/SKILL.md': '---\nname: backslop-tsk\n---\n\n# Title\n',
  }), [
    'templates/en/skills/backslop-task/SKILL.md frontmatter name is backslop-tsk, expected backslop-task',
    'templates/en/skills/backslop-task/SKILL.md frontmatter has no description',
  ]);
});

test('template parity: разное число заголовков; `# ` в блоке кода заголовком не считается', () => {
  assert.deepEqual(parity({
    'docs/README.md': '# Один\n\n## Два\n',
    'en/docs/README.md': '# One\n\n```sh\n# not a heading\n```\n',
  }), ['templates/en/docs/README.md headings differ: 1 != 1,2']);
});

test('template parity: кириллица в файле английского слоя', () => {
  assert.deepEqual(parity({
    'task.md': '# Задача\n',
    'en/task.md': '# Task\n\nОписание\n',
  }), ['templates/en/task.md contains Cyrillic']);
});

// Слоты: пара «плейсхолдер в шаблоне ↔ ключ в vars». Фикстура частичная, поэтому обратная
// половина правила (объявленный ключ без места) шумит по чужим строкам реестра — она
// проверяется отдельной пробой ниже.
test('template slots: реестр и шаблоны инструмента сходятся', () => {
  assert.deepEqual(templateSlots(), []);
});

test('template slots: имя без ключа и шаблон вне реестра', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'backslop-templates-'));
  try {
    put(root, 'adr.md', '{{date}} {{number}} {{title}} {{budget}}\n');
    put(root, 'stray.md', '{{cli}}\n');
    put(root, 'en/adr.md', '{{date}} {{number}} {{title}}\n');
    assert.deepEqual(templateSlots(root).filter((m) => !m.startsWith('TEMPLATE_KEYS:')).sort(), [
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
    assert.ok(templateSlots(root).includes('TEMPLATE_KEYS: title is declared but no template uses it'));
  } finally { cleanup(root); }
});

test('renderTemplate: подстановка без ключа — отказ, а не буквальный {{…}} читателю', () => {
  assert.throws(() => renderTemplate('adr.md', { number: 1, title: 'x' }),
    /adr\.md: подстановке \{\{date\}\} не передан ключ date/);
});

// Эта пара рендерится в docs/ репозитория 1:1 (AGENTS.md): без сверки правка одной стороны
// расходится с другой молча, а цитаты и ссылки карточек смотрят в рабочую копию.
test('self-host: правила ведения в docs/ — рендер своего шаблона 1:1', () => {
  const repo = path.dirname(TEMPLATES_DIR);
  const cfg = JSON.parse(readFileSync(path.join(repo, 'backslop.json'), 'utf8'));
  const project = JSON.parse(readFileSync(path.join(repo, 'package.json'), 'utf8')).name;
  for (const rel of ['docs/backlog/README.md', 'docs/archive/README.md']) {
    const expected = renderTemplate(rel, { cli: cfg.cli, prefix: cfg.prefix, project });
    assert.equal(readFileSync(path.join(repo, ...rel.split('/')), 'utf8'), expected, `${rel} разошёлся с templates/${rel}`);
  }
});

// Свёрнутую пачку записью не догрузить: порядок её закрытия и шаг приёмки со свёрткой держатся
// в обоих языковых слоях скилла пачек.
test('backslop-batch: пачка сворачивается после своих записей, приёмка идёт через fold и заготовку', () => {
  for (const rel of ['skills/backslop-batch/SKILL.md', 'en/skills/backslop-batch/SKILL.md']) {
    const text = readFileSync(path.join(TEMPLATES_DIR, ...rel.split('/')), 'utf8');
    const into = text.indexOf('`backslop archive N.k --into M`');
    assert.ok(into !== -1 && text.indexOf('`backslop fold M`', into) !== -1, `${rel}: fold M не назван после archive N.k --into M`);
    const accept = text.split('\n').find((line) => line.startsWith('4. ') && line.includes('`backslop archive N`'));
    assert.ok(accept, `${rel}: шаг приёмки с archive N не найден`);
    assert.ok(accept.indexOf('`backslop fold N') > accept.indexOf('`backslop archive N`'), `${rel}: после archive N нет fold N`);
    assert.ok(accept.includes('git commit -F "$(git rev-parse --git-dir)/BACKSLOP_DRAFT"'), `${rel}: коммит приёмки не несёт заготовку`);
    const track = accept.indexOf('(ADR-033)');
    assert.ok(track !== -1 && accept.lastIndexOf('`backslop fold`', track) > accept.indexOf('`backslop fold N >'),
      `${rel}: не назван track одним коммитом — свёртка следующим коммитом, fold N или массовый fold`);
  }
});
