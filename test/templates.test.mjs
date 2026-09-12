import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TEMPLATES_DIR, renderTemplate, templateParity, templateSlots } from '../lib/templates.js';
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
