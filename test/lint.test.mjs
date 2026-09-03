// Гейты lint: зелёный проект и по красной пробе на каждый гейт. Проба — мутация зелёного
// проекта; без неё гейт нечем отличить от холостого.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { loadProject } from '../lib/config.js';
import { lintProject } from '../lib/lint.js';
import { cleanup, cli, makeProject, put, read } from './helpers.mjs';
import { TOOL_VERSION } from '../lib/version.js';

function seedGreen(root) {
  put(root, 'docs/README.md', [
    '# Документация', '',
    '| Документ | Тема | Статус |', '|---|---|---|',
    '| [backlog/](backlog/README.md) | трекер | Живой |',
    '| [adr/adr-001-process.md](adr/adr-001-process.md) | процесс | Accepted |',
    '',
  ].join('\n'));
  put(root, 'docs/adr/adr-001-process.md', '# ADR-001: Процесс\n\n**Status:** Accepted\n');
  put(root, 'docs/backlog/queue/BS-1-a.md', '# BS-1 · А\n\n- **Порядок:** 10\n- **Область:** [x](../../reference/README.md)\n');
  put(root, 'docs/backlog/active/BS-2-b.md', '# BS-2 · Б\n\n- **Взята:** 2026-09-01\n');
  put(root, 'docs/backlog/deferred/BS-3-c.md', '# BS-3 · В\n\n## Отложено\n\n- **Причина:** нет раннера\n- **Условие возврата:** появится раннер\n');
  put(root, 'docs/backlog/triage/BS-2.1-d.md', '# BS-2.1 · Г\n\nНаходка при работе над BS-2.\n');
  put(root, 'docs/archive/BS-4-e/task.md', '# BS-4 · Д\n');
  put(root, 'docs/archive/BS-4-e/result.md', '# BS-4 · Результат\n\n**Закрыта 2026-08-01.** Готово.\n');
  put(root, 'docs/reference/README.md', '# Справочник\n');
  put(root, 'CHANGELOG.md', '## Не выпущено\n\n- **Одно** — BS-4\n\n## v0.1.0\n\n- **Одно** — прежняя редакция\n');
  put(root, 'README.md', 'См. [docs](docs/README.md)\n');
}

const problems = (root) => lintProject(loadProject(root)).errors.map((p) => `${p.file}: ${p.msg}`);
const warnings = (root) => lintProject(loadProject(root)).warnings.map((p) => `${p.file}: ${p.msg}`);

function probe(name, mutate, expect) {
  test(`lint: ${name}`, () => {
    const root = makeProject({ git: false });
    try {
      seedGreen(root);
      mutate(root);
      const found = problems(root);
      assert.ok(found.some((p) => expect.test(p)), `ожидалось /${expect.source}/, найдено: ${found.join(' | ') || 'ничего'}`);
    } finally {
      cleanup(root);
    }
  });
}

test('lint: зелёный проект без ошибок, CLI выходит нулём', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    assert.deepEqual(problems(root), []);
    const r = cli(root, ['lint']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /ошибок нет/);
  } finally {
    cleanup(root);
  }
});

test('lint: EN project accepts RU metadata and reports errors in English', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    put(root, 'backslop.json', '{"prefix":"BS","docs":"docs","gates":[],"lang":"en","tools":[]}\n');
    put(root, 'docs/archive/BS-4-e/result.md', '# Result\n\n[TODO]\n');
    const r = cli(root, ['lint']);
    assert.equal(r.code, 1);
    assert.match(r.err, /result is incomplete/);
    assert.doesNotMatch(r.err, /[А-Яа-яЁё]/);
  } finally { cleanup(root); }
});

probe('1. битая ссылка в docs', (root) => put(root, 'docs/note.md', '[нет](reference/none.md)\n'), /docs\/note\.md: битая ссылка reference\/none\.md/);
probe('1. битая ссылка в корневом README', (root) => put(root, 'README.md', '[нет](docs/none.md)\n'), /README\.md: битая ссылка/);
probe('1. битая ссылка в скилле backslop', (root) => {
  assert.equal(cli(root, ['init', '--tools', 'claude']).code, 0);
  put(root, '.claude/skills/backslop-task/SKILL.md', '[нет](../none.md)\n');
}, /SKILL\.md: битая ссылка/);
probe('adapter: нет Claude stub', (root) => {
  const cfg = JSON.parse(read(root, 'backslop.json'));
  put(root, 'backslop.json', `${JSON.stringify({ ...cfg, tools: ['claude'] }, null, 2)}\n`);
}, /CLAUDE\.md: нет Claude stub/);
probe('template parity: гейт подключён к lintProject', (root) => {
  put(root, 'templates/skills/backslop-task/SKILL.md', '{{cli}}\n');
  put(root, 'templates/en/skills/backslop-task/SKILL.md', '{{project}}\n');
}, /templates\/en\/skills\/backslop-task\/SKILL\.md placeholders differ/);
probe('1. битая ссылка в Cursor rule проверяется отдельно', (root) => {
  assert.equal(cli(root, ['init', '--tools', 'cursor']).code, 0);
  put(root, '.cursor/rules/backslop-task.mdc', '[missing](backslop-task/references/none.md)\n');
}, /backslop-task\.mdc: битая ссылка/);
probe('adapter output отсутствует', (root) => {
  assert.equal(cli(root, ['init', '--tools', 'claude']).code, 0);
  rmSync(path.join(root, '.claude/skills/backslop-task/SKILL.md'));
}, /generated output для adapter claude/);
probe('2. номер занят дважды', (root) => put(root, 'docs/backlog/triage/BS-1-dup.md', '# BS-1 · Дубль\n'), /номер BS-1 уже занят/);
probe('2. заголовок не совпадает с именем', (root) => put(root, 'docs/backlog/triage/BS-9-x.md', '# BS-8 · Не тот\n'), /заголовок называет BS-8/);
probe('2. заголовок не по форме', (root) => put(root, 'docs/backlog/triage/BS-9-x.md', 'Без заголовка\n'), /первая строка не/);
probe('2. находка без родителя', (root) => put(root, 'docs/backlog/triage/BS-7.1-x.md', '# BS-7.1 · Сирота\n'), /без родителя BS-7/);
probe('2. чужой файл в каталоге статуса', (root) => put(root, 'docs/backlog/queue/notes.md', '# заметки\n'), /имя не по шаблону/);
probe('3. файл вне каталога статуса', (root) => put(root, 'docs/backlog/BS-9-x.md', '# BS-9 · Х\n'), /файл вне каталога статуса/);
probe('3. каталог не статус', (root) => mkdirSync(path.join(root, 'docs/backlog/done')), /каталог не статус/);
probe('3. нет каталога статуса', (root) => rmSync(path.join(root, 'docs/backlog/deferred'), { recursive: true }), /каталога статуса нет/);
probe('4. очередь без порядка', (root) => put(root, 'docs/backlog/queue/BS-1-a.md', '# BS-1 · А\n'), /без поля «Порядок»/);
probe('4. порядок не число', (root) => put(root, 'docs/backlog/queue/BS-1-a.md', '# BS-1 · А\n\n- **Порядок:** высокий\n'), /не целое число/);
probe('4. в работе без даты', (root) => put(root, 'docs/backlog/active/BS-2-b.md', '# BS-2 · Б\n'), /без даты «Взята/);
probe('4. отложена без раздела', (root) => put(root, 'docs/backlog/deferred/BS-3-c.md', '# BS-3 · В\n'), /без раздела «## Отложено»/);
probe('4. отложена с [TODO]', (root) => put(root, 'docs/backlog/deferred/BS-3-c.md', '# BS-3 · В\n\n## Отложено\n\n- **Причина:** [TODO]\n'), /не заполнен: остался \[TODO\]/);
probe('5. архив без result.md', (root) => rmSync(path.join(root, 'docs/archive/BS-4-e/result.md')), /нет result\.md/);
probe('5. результат не дописан', (root) => put(root, 'docs/archive/BS-4-e/result.md', '# BS-4 · Результат\n\n**Закрыта 2026-08-01.** [TODO: исход]\n'), /результат не дописан/);
probe('5. каталог архива не по шаблону', (root) => put(root, 'docs/archive/old-stuff/task.md', '# x\n'), /old-stuff: имя не по шаблону/);
probe('6. упоминание номера без файла в docs', (root) => put(root, 'docs/ROADMAP.md', 'Сделаем в BS-99.\n'), /упоминает BS-99/);
probe('6. упоминание номера без файла в CHANGELOG', (root) => put(root, 'CHANGELOG.md', '## Не выпущено\n\n- **Закрыта** BS-2.7\n'), /CHANGELOG\.md: упоминает BS-2\.7/);
test('lint: 6. упоминание номера внутри блока кода — пример, а не ссылка', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    put(root, 'docs/note.md', 'Пример вывода:\n\n```\n  10  BS-77 · Пример\n```\n\nА в прозе `BS-4` — ссылка.\n');
    assert.deepEqual(problems(root), []);
  } finally {
    cleanup(root);
  }
});

probe('7. дубль заголовка записи в секции CHANGELOG', (root) => put(root, 'CHANGELOG.md', '## Не выпущено\n\n- **Одно** — раз\n- **Одно** — два\n'), /заголовок записи «Одно» уже есть/);
probe('8. ADR без строки в таблице', (root) => put(root, 'docs/adr/adr-002-orphan.md', '# ADR-002: Сирота\n'), /adr-002-orphan\.md: нет строки/);
probe('8. номер ADR занят дважды', (root) => put(root, 'docs/adr/adr-001-again.md', '# ADR-001: Снова\n'), /номер ADR 1 уже занят/);
probe('8. файл в adr/ не по шаблону', (root) => put(root, 'docs/adr/decision.md', '# x\n'), /decision\.md: имя не по шаблону adr-NNN/);

test('lint: предупреждения о версии не красят гейт', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    const setConfig = (patch) => put(root, 'backslop.json', `${JSON.stringify({ ...JSON.parse(read(root, 'backslop.json')), ...patch }, null, 2)}\n`);
    assert.ok(warnings(root).some((w) => /backslop\.json: нет штампа версии/.test(w)), warnings(root).join(' | '));
    setConfig({ version: '0.0.1' });
    assert.ok(warnings(root).some((w) => /скелет старее инструмента: v0\.0\.1 </.test(w)), warnings(root).join(' | '));
    setConfig({ version: TOOL_VERSION, cli: 'npx github:me/proj#v0.0.1' });
    assert.ok(warnings(root).some((w) => /пин в cli v0\.0\.1 расходится со штампом/.test(w)), warnings(root).join(' | '));
    setConfig({ version: TOOL_VERSION, cli: `npx github:me/proj#v${TOOL_VERSION}` });
    assert.deepEqual(warnings(root), []);
    setConfig({ version: '9.9.9' });
    assert.ok(warnings(root).some((w) => /штамп новее инструмента: v9\.9\.9 >/.test(w)), warnings(root).join(' | '));
    setConfig({ version: TOOL_VERSION, cli: 'npx github:me/proj' });
    assert.ok(warnings(root).some((w) => /cli без пина тянет свежую версию/.test(w)), warnings(root).join(' | '));
    setConfig({ version: TOOL_VERSION, cli: 'npx backslop' });
    assert.ok(warnings(root).some((w) => /cli без пина тянет свежую версию/.test(w)), warnings(root).join(' | '));
    setConfig({ version: TOOL_VERSION, cli: 'npx backslop@latest' });
    assert.ok(warnings(root).some((w) => /cli без пина тянет свежую версию/.test(w)), warnings(root).join(' | '));
    setConfig({ version: TOOL_VERSION, cli: 'backslop' });
    assert.deepEqual(warnings(root), [], 'глобальная установка пина не несёт и не предупреждает');
    setConfig({ version: '0.0.1', cli: 'backslop' });
    const r = cli(root, ['lint']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.err, /⚠ backslop\.json: скелет старее инструмента/);
    assert.match(r.out, /ошибок нет, предупреждений 1/);
  } finally {
    cleanup(root);
  }
});

test('lint: CLI печатает каждую ошибку и выходит единицей', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    put(root, 'docs/note.md', '[нет](none.md)\n');
    const r = cli(root, ['lint']);
    assert.equal(r.code, 1);
    assert.match(r.err, /docs\/note\.md: битая ссылка none\.md/);
    assert.match(r.err, /lint: ошибок 1/);
  } finally {
    cleanup(root);
  }
});
