// Гейты lint: зелёный проект и по красной пробе на каждый гейт. Проба — мутация зелёного
// проекта; без неё гейт нечем отличить от холостого.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, renameSync, rmSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { loadProject } from '../lib/config.js';
import { lintProject } from '../lib/lint.js';
import { cleanup, cli, makeProject, put, read, toolCli, toolCopy } from './helpers.mjs';
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
  put(root, 'docs/backlog/active/BS-2-b.md', '# BS-2 · Б\n\n- **Область:** [x](../../reference/README.md)\n- **Взята:** 2026-09-01\n');
  put(root, 'docs/backlog/deferred/BS-3-c.md', '# BS-3 · В\n\n- **Область:** [x](../../reference/README.md)\n\n## Отложено\n\n- **Причина:** нет раннера\n- **Условие возврата:** появится раннер\n');
  put(root, 'docs/backlog/triage/BS-2.1-d.md', '# BS-2.1 · Г\n\nНаходка при работе над BS-2.\n');
  // Находка BS-4.1 разобрана — уехала в deferred/; закрытый родитель BS-4 её не красит.
  put(root, 'docs/backlog/deferred/BS-4.1-f.md', '# BS-4.1 · Е\n\n- **Область:** [x](../../reference/README.md)\n\n## Отложено\n\n- **Причина:** ждёт раннера\n- **Условие возврата:** появится раннер\n');
  put(root, 'docs/archive/BS-4-e/task.md', '# BS-4 · Д\n');
  put(root, 'docs/archive/BS-4-e/result.md', '# BS-4 · Результат\n\n**Закрыта 2026-08-01.** Готово.\n');
  put(root, 'docs/reference/README.md', '# Справочник\n\nОдно понятие — одно имя.\n\nПример:\n\n```\nбез фенса\n```\n');
  put(root, 'docs/quoting.md', ['# Цитаты', '',
    '<!-- quote:reference/README.md -->', '', '```', 'Одно понятие — одно имя.', '```', '', '<!-- /quote -->', '',
    // Цитата куска документации: фенс внутри цитаты — часть текста, а не обёртка.
    '<!-- quote:reference/README.md -->', '', 'Пример:', '', '```', 'без фенса', '```', '', '<!-- /quote -->', ''].join('\n'));
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
    assert.equal(r.err, '', 'зелёный lint молчит и в stderr');
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
  put(root, '.claude/skills/backslop-task/SKILL.md', '<!-- backslop:generated -->\n[нет](../none.md)\n');
}, /SKILL\.md: битая ссылка/);
probe('adapter: нет Claude stub', (root) => {
  const cfg = JSON.parse(read(root, 'backslop.json'));
  put(root, 'backslop.json', `${JSON.stringify({ ...cfg, tools: ['claude'] }, null, 2)}\n`);
}, /CLAUDE\.md: нет Claude stub/);
probe('1. битая ссылка в Cursor rule проверяется отдельно', (root) => {
  assert.equal(cli(root, ['init', '--tools', 'cursor']).code, 0);
  put(root, '.cursor/rules/backslop-task.mdc', '<!-- backslop:generated -->\n[missing](backslop-task/references/none.md)\n');
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
probe('3. нет каталога minor', (root) => rmSync(path.join(root, 'docs/backlog/minor'), { recursive: true }), /docs\/backlog\/minor: каталога статуса нет/);
probe('4. minor без цены', (root) => put(root, 'docs/backlog/minor/BS-1.1-m.md', '# BS-1.1 · М\n\n- **Родитель:** BS-1\n'), /в minor\/ без поля «Цена»/);
probe('4. цена не разбирается', (root) => put(root, 'docs/backlog/minor/BS-1.1-m.md', '# BS-1.1 · М\n\n- **Цена:** дорого\n'), /«Цена» не разбирается/);
probe('4. major в minor без гипотезы', (root) => put(root, 'docs/backlog/minor/BS-1.1-m.md', '# BS-1.1 · М\n\n- **Цена:** major\n'), /«Цена» major без пометки «гипотеза»/);
probe('4. цена повторяется', (root) => put(root, 'docs/backlog/minor/BS-1.1-m.md', '# BS-1.1 · М\n\n- **Цена:** minor\n- **Цена:** minor\n'), /поле «Цена» повторяется/);
probe('5. чужой файл в minor/ пачки', (root) => put(root, 'docs/archive/BS-4-e/minor/notes.md', '# заметки\n'), /archive\/BS-4-e\/minor\/notes\.md: в minor\/ пачки только файлы записей/);
probe('5. каталог в minor/ пачки', (root) => mkdirSync(path.join(root, 'docs/archive/BS-4-e/minor/BS-4.9-x'), { recursive: true }), /archive\/BS-4-e\/minor\/BS-4\.9-x: в minor\/ пачки только файлы записей/);
probe('2. запись в minor/ пачки с чужим заголовком', (root) => put(root, 'docs/archive/BS-4-e/minor/BS-4.1-m.md', '# BS-4.2 · Не та\n'), /archive\/BS-4-e\/minor\/BS-4\.1-m\.md: заголовок называет BS-4\.2/);
probe('4. заглушка вне «Области» в minor/', (root) => put(root, 'docs/backlog/minor/BS-1.1-m.md', '# BS-1.1 · М\n\n- **Цена:** minor\n\n## Улика\n\nУлика: [TODO: путь]\n'), /BS-1\.1-m\.md: строка 7: осталась заглушка \[TODO\]/);
probe('4. очередь без порядка', (root) => put(root, 'docs/backlog/queue/BS-1-a.md', '# BS-1 · А\n'), /без поля «Порядок»/);
probe('4. порядок не число', (root) => put(root, 'docs/backlog/queue/BS-1-a.md', '# BS-1 · А\n\n- **Порядок:** высокий\n'), /не целое число/);
probe('4. два файла очереди с одним порядком', (root) => put(root, 'docs/backlog/queue/BS-5-f.md', '# BS-5 · Е\n\n- **Порядок:** 10\n'), /BS-5-f\.md: «Порядок» 10 уже у docs\/backlog\/queue\/BS-1-a\.md/);
probe('4. дубль поля в одном файле с RU/EN алиасами', (root) => put(root, 'docs/backlog/queue/BS-1-a.md', '# BS-1 · А\n\n- **Порядок:** 10\n- **Order:** 20\n'), /BS-1-a\.md: поле «Порядок» повторяется в строках 3, 4/);
probe('4. «Прежний порядок» в очереди не заменяет «Порядок»', (root) => put(root, 'docs/backlog/queue/BS-1-a.md', '# BS-1 · А\n\n- **Прежний порядок:** 10\n- **Область:** [x](../../reference/README.md)\n'), /BS-1-a\.md: в очереди без поля «Порядок»/);
probe('4. дубль «Прежнего порядка» с RU/EN алиасами', (root) => put(root, 'docs/backlog/active/BS-2-b.md', '# BS-2 · Б\n\n- **Область:** [x](../../reference/README.md)\n- **Взята:** 2026-09-01\n- **Прежний порядок:** 20\n- **Previous order:** 30\n'), /BS-2-b\.md: поле «Прежний порядок» повторяется в строках 5, 6/);
probe('4. разобранная задача без «Области»', (root) => put(root, 'docs/backlog/queue/BS-1-a.md', '# BS-1 · А\n\n- **Порядок:** 10\n'), /BS-1-a\.md: без поля «Область»/);
probe('4. «Область» пуста', (root) => put(root, 'docs/backlog/active/BS-2-b.md', '# BS-2 · Б\n\n- **Область:**\n- **Взята:** 2026-09-01\n'), /BS-2-b\.md: «Область» пуста/);
probe('4. в работе без даты', (root) => put(root, 'docs/backlog/active/BS-2-b.md', '# BS-2 · Б\n'), /без даты «Взята/);
probe('4. отложена без раздела', (root) => put(root, 'docs/backlog/deferred/BS-3-c.md', '# BS-3 · В\n'), /без раздела «## Отложено»/);
probe('4. отложена с [TODO]', (root) => put(root, 'docs/backlog/deferred/BS-3-c.md', '# BS-3 · В\n\n## Отложено\n\n- **Причина:** [TODO]\n'), /не заполнен: остался \[TODO\]/);
probe('4. второй раздел «Отложено»', (root) => put(root, 'docs/backlog/deferred/BS-3-c.md', '# BS-3 · В\n\n- **Область:** [x](../../reference/README.md)\n\n## Отложено\n\n- **Причина:** готово\n- **Условие возврата:** готово\n\n## Отложено\n\n- **Причина:** второй\n- **Условие возврата:** второй\n'), /раздел «Отложено» повторяется 2 раза/);
probe('4. заглушка в любом файле backlog', (root) => put(root, 'docs/backlog/queue/BS-5-todo.md', '# BS-5 · Заглушка\n\n- [TODO]\n'), /docs\/backlog\/queue\/BS-5-todo\.md: строка 3: осталась заглушка \[TODO\]/);
probe('4. каноническая улика находки', (root) => put(root, 'docs/backlog/queue/BS-5-finding.md', '# BS-5 · Находка\n\nНаходка при работе над BS-1.\nУлика: [TODO: путь к файлу или команда с выводом]\nЦитату файла оборачивай в блок.\n'), /BS-5-finding\.md: строка 4: осталась заглушка \[TODO\]/);
probe('4. поле с двоеточием вне жирного', (root) => put(root, 'docs/backlog/queue/BS-6-reason.md', '# BS-6 · Причина\n\n- **Reason**: [TODO]\n'), /BS-6-reason\.md: строка 3: осталась заглушка \[TODO\]/);
probe('4. заглушка списка с подсказкой внутри скобок', (root) => put(root, 'docs/backlog/queue/BS-5-hint.md', '# BS-5 · Подсказка\n\n- [TODO: ход назначается при разборе triage]\n'), /docs\/backlog\/queue\/BS-5-hint\.md: строка 3: осталась заглушка \[TODO\]/);

test('lint: «Прежний порядок» вне queue/ гейт полей не красит', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    // Ранг, сохранённый уходом из очереди: «Порядка» в этих каталогах нет и не требуется.
    put(root, 'docs/backlog/active/BS-2-b.md', '# BS-2 · Б\n\n- **Область:** [x](../../reference/README.md)\n- **Взята:** 2026-09-01\n- **Прежний порядок:** 20\n');
    put(root, 'docs/backlog/deferred/BS-3-c.md', '# BS-3 · В\n\n- **Область:** [x](../../reference/README.md)\n- **Прежний порядок:** 30\n\n## Отложено\n\n- **Причина:** нет раннера\n- **Условие возврата:** появится раннер\n');
    assert.deepEqual(problems(root), []);
  } finally {
    cleanup(root);
  }
});

test('lint: текст о TODO внутри заполненного значения не красит backlog', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    put(root, 'docs/backlog/queue/BS-1-a.md', '# BS-1 · А\n\n- **Порядок:** 10\n- **Область:** заполнено; проверка [TODO] не должна искать подстроку\n');
    assert.deepEqual(problems(root), []);
  } finally {
    cleanup(root);
  }
});
test('lint: заголовок секции внутри fenced-примера не считается дублем', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    put(root, 'docs/backlog/deferred/BS-3-c.md', '# BS-3 · В\n\n- **Область:** [x](../../reference/README.md)\n\n## Отложено\n\n- **Причина:** нет раннера\n- **Условие возврата:** появится раннер\n\n```markdown\n## Отложено\n- **Причина:** пример\n```\n');
    assert.deepEqual(problems(root), []);
  } finally {
    cleanup(root);
  }
});

test('lint: fenced-only заголовок секции не заменяет раздел', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    put(root, 'docs/backlog/deferred/BS-3-c.md', '# BS-3 · В\n\n- **Область:** [x](../../reference/README.md)\n\n```markdown\n## Отложено\n- **Причина:** пример\n```\n');
    assert.match(problems(root).join('\n'), /без раздела «## Отложено»/);
  } finally {
    cleanup(root);
  }
});
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
test('lint: находка под закрытым родителем остаётся предупреждением для approver', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    put(root, 'docs/archive/BS-2-b/task.md', '# BS-2 · Б\n');
    put(root, 'docs/archive/BS-2-b/result.md', '# BS-2 · Результат\n\n**Закрыта 2026-08-01.** Готово.\n');
    put(root, 'docs/archive/BS-007-old/task.md', '# BS-007 · Старая\n');
    put(root, 'docs/archive/BS-007-old/result.md', '# BS-007 · Результат\n\n**Закрыта 2026-08-01.** Готово.\n');
    put(root, 'docs/backlog/triage/BS-007.1-x.md', '# BS-007.1 · Находка\n');
    rmSync(path.join(root, 'docs/backlog/active/BS-2-b.md'));
    assert.deepEqual(problems(root), []);
    assert.ok(warnings(root).some((w) => /BS-007\.1-x\.md: находка BS-007\.1 лежит в triage\/, а задача BS-007 закрыта — разбери её \(approver\)/.test(w)), warnings(root).join(' | '));
    assert.ok(warnings(root).some((w) => /BS-2\.1-d\.md: находка BS-2\.1 лежит в triage\/, а задача BS-2 закрыта — разбери её \(approver\)/.test(w)), warnings(root).join(' | '));
    const r = cli(root, ['lint']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.err, /разбери её \(approver\)/);
  } finally {
    cleanup(root);
  }
});

test('lint: пустая или незаполненная «Область» в minor/ — предупреждение, не ошибка', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    put(root, 'docs/backlog/minor/BS-1.1-m.md', '# BS-1.1 · М\n\n- **Область:** \n- **Цена:** minor\n');
    put(root, 'docs/backlog/minor/BS-1.2-n.md', '# BS-1.2 · Н\n\n- **Цена:** major (гипотеза)\n');
    put(root, 'docs/backlog/minor/BS-1.3-o.md', '# BS-1.3 · О\n\n- **Область:** [x](../../reference/README.md)\n- **Цена:** critical (hypothesis)\n');
    put(root, 'docs/backlog/minor/BS-1.4-p.md', '# BS-1.4 · П\n\n- **Область:** [TODO: раздел](../../reference/README.md)\n- **Цена:** minor\n');
    assert.deepEqual(problems(root), []);
    assert.ok(warnings(root).some((w) => /BS-1\.4-p\.md: «Область» не заполнена: осталась заглушка/.test(w)), warnings(root).join(' | '));
    assert.ok(warnings(root).some((w) => /BS-1\.1-m\.md: «Область» пуста/.test(w)), warnings(root).join(' | '));
    assert.ok(warnings(root).some((w) => /BS-1\.2-n\.md: без поля «Область»/.test(w)), warnings(root).join(' | '));
    assert.ok(!warnings(root).some((w) => /BS-1\.3-o\.md/.test(w)), warnings(root).join(' | '));
    const r = cli(root, ['lint']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /ошибок нет, предупреждений 3/);
  } finally {
    cleanup(root);
  }
});

test('lint: запись, закрытая пачкой, известна упоминаниям и не считается сиротой', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    put(root, 'docs/archive/BS-4-e/minor/BS-4.2-m.md', '# BS-4.2 · Закрыта пачкой\n\n- **Цена:** minor\n');
    put(root, 'docs/note.md', 'См. BS-4.2 — закрыта пачкой BS-4.\n');
    assert.deepEqual(problems(root), []);
    assert.deepEqual(warnings(root), []);
  } finally {
    cleanup(root);
  }
});

test('lint: предупреждения о версии не красят гейт', () => {
  const root = makeProject({ git: false, stamp: false });
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

test('lint: номер с ведущими нулями — форма файла сохраняется, сравнение числовое', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    put(root, 'docs/archive/BS-007-old/task.md', '# BS-007 · Старая\n');
    put(root, 'docs/archive/BS-007-old/result.md', '# BS-007 · Результат\n\n**Закрыта 2026-08-01.** Готово.\n');
    put(root, 'docs/ROADMAP.md', 'Сделано в BS-007, она же BS-7.\n');
    assert.deepEqual(problems(root), []);
  } finally {
    cleanup(root);
  }
});
probe('2. номер занят дважды в разных формах записи', (root) => put(root, 'docs/backlog/triage/BS-004-e2.md', '# BS-004 · Дубль\n'), /номер BS-004 уже занят: docs\/archive\/BS-4-e\/task\.md/);

// 11. Гейт релиза живёт только в дереве самого инструмента — тем же признаком, что равенство
// шаблонов (тождество каталога templates/ с каталогом запущенного CLI). Поэтому его пробы,
// как и пробы парности, идут на копии инструмента: у обычной фикстуры своей версии нет.
function bumpPackage(dir, version) {
  put(dir, 'package.json', `${JSON.stringify({ ...JSON.parse(read(dir, 'package.json')), version }, null, 2)}\n`);
}

test('lint: 11. свежая копия инструмента — гейт релиза молчит', () => {
  let project;
  try {
    project = toolProject(() => {});
    assert.equal(project.code, 0, project.err);
  } finally { if (project) cleanup(project.dir); }
});

probe('adapter output — каталог на owned-пути, на котором init отказывает', (root) => {
  assert.equal(cli(root, ['init', '--tools', 'claude']).code, 0);
  rmSync(path.join(root, '.claude/skills/backslop-task/SKILL.md'));
  mkdirSync(path.join(root, '.claude/skills/backslop-task/SKILL.md'));
}, /SKILL\.md: owned adapter output не является файлом/);
// ADR-015: чужой файл без маркера на owned-пути init не переписывает — скилл не установлен, и
// lint это называет. Не-legacy owned-путь есть только у копии инструмента с лишним шаблоном
// (состав шаблонов совпадает с legacy-набором); в копии работает и гейт парности — лишний
// шаблон кладётся в оба слоя.
test('lint: adapter output без маркера — чужой файл на owned-пути выбранного adapter\'а', () => {
  let project;
  try {
    project = toolProject((dir) => {
      put(dir, 'templates/skills/backslop-task/references/extra.md', '# extra\n');
      put(dir, 'templates/en/skills/backslop-task/references/extra.md', '# extra\n');
      const r = toolCli(dir, ['init', '--tools', 'claude']);
      assert.equal(r.code, 0, r.err);
      put(dir, '.claude/skills/backslop-task/references/extra.md', '# мой файл на этом пути\n');
    });
    assert.equal(project.code, 1, project.out);
    assert.match(project.err, /extra\.md: на пути adapter output claude чужой файл без маркера/);
  } finally { if (project) cleanup(project.dir); }
});

test('lint: 11. version package.json расходится со штампом', () => {
  let project;
  try {
    project = toolProject((dir) => bumpPackage(dir, '9.9.9'));
    assert.equal(project.code, 1, project.out);
    assert.match(project.err, /версия package\.json v9\.9\.9 расходится со штампом backslop\.json v\d+\.\d+\.\d+/);
  } finally { if (project) cleanup(project.dir); }
});

test('lint: 11. нет секции CHANGELOG на выпускаемую версию', () => {
  let project;
  try {
    project = toolProject((dir) => {
      bumpPackage(dir, '9.9.9');
      put(dir, 'backslop.json', `${JSON.stringify({ ...JSON.parse(read(dir, 'backslop.json')), version: '9.9.9' }, null, 2)}\n`);
      put(dir, 'CHANGELOG.md', '# Changelog\n\n## Не выпущено\n\n- **Одно** — было\n');
    });
    assert.equal(project.code, 1, project.out);
    assert.match(project.err, /нет секции «## v9\.9\.9»/);
  } finally { if (project) cleanup(project.dir); }
});

test('lint: 11. устаревший пин в прозе README', () => {
  let project;
  try {
    project = toolProject((dir) => put(dir, 'README.md', 'Ставится `npx github:Velklish/backslop#v0.2.0`\n'));
    assert.equal(project.code, 1, project.out);
    assert.match(project.err, /README\.md: строка 1: пин github:Velklish\/backslop#v0\.2\.0 — инструмент на v\d+\.\d+\.\d+/);
  } finally { if (project) cleanup(project.dir); }
});

test('lint: 11. устаревший npm-пин в прозе AGENTS.md', () => {
  let project;
  try {
    project = toolProject((dir) => put(dir, 'AGENTS.md', `${read(dir, 'AGENTS.md')}\nРелиз ставится как \`npx backslop@0.2.0\`.\n`));
    assert.equal(project.code, 1, project.out);
    assert.match(project.err, /AGENTS\.md: .*пин backslop@0\.2\.0 — инструмент на v\d+\.\d+\.\d+/);
  } finally { if (project) cleanup(project.dir); }
});

// Гейт парности включается только в дереве самого инструмента: признак — тождество
// `templates/` проекта с каталогом, из которого рендерит запущенный CLI. Поэтому проба идёт
// на копии инструмента (toolCopy), а обычная фикстура с каталогом `templates/` гейт не будит.
function toolProject(mutate) {
  const dir = toolCopy();
  assert.equal(toolCli(dir, ['init']).code, 0, 'копия инструмента раскладывается сама собой');
  mutate(dir);
  return { dir, ...toolCli(dir, ['lint']) };
}

test('lint: template parity: переименование canonical-скилла не выключает гейт', () => {
  let project;
  try {
    project = toolProject((dir) => {
      for (const layer of ['skills', 'en/skills']) {
        renameSync(path.join(dir, 'templates', ...layer.split('/'), 'backslop-task'),
          path.join(dir, 'templates', ...layer.split('/'), 'backslop-tsk'));
      }
    });
    assert.equal(project.code, 1, project.out);
    assert.match(project.err, /skills\/backslop-tsk\/SKILL\.md frontmatter name is backslop-task, expected backslop-tsk/);
  } finally { if (project) cleanup(project.dir); }
});

test('lint: 11. гейт релиза жив после переименования canonical-скилла', () => {
  let project;
  try {
    project = toolProject((dir) => {
      for (const layer of ['skills', 'en/skills']) {
        renameSync(path.join(dir, 'templates', ...layer.split('/'), 'backslop-task'),
          path.join(dir, 'templates', ...layer.split('/'), 'backslop-tsk'));
      }
      put(dir, 'package.json', `${JSON.stringify({ ...JSON.parse(read(dir, 'package.json')), version: '9.9.9' }, null, 2)}\n`);
    });
    assert.equal(project.code, 1, project.out);
    assert.match(project.err, /версия package\.json v9\.9\.9 расходится со штампом/);
  } finally { if (project) cleanup(project.dir); }
});

// 12. Слоты шаблонов: плейсхолдер без ключа в vars. Проба в обе стороны — иначе гейт не
// отличить от холостого: красное без зелёного доказывает только то, что он умеет ругаться.
function withSlot(dir, name) {
  for (const rel of ['templates/brief.md', 'templates/en/brief.md']) {
    put(dir, rel, `${read(dir, rel)}\n{{${name}}}\n`);
  }
}

test('lint: 12. слот шаблона без ключа в vars красит гейт, с ключом — нет', () => {
  let red;
  let green;
  try {
    red = toolProject((dir) => withSlot(dir, 'budget'));
    assert.equal(red.code, 1, red.out);
    assert.match(red.err, /templates\/brief\.md placeholder \{\{budget\}\} has no key in vars/);
    assert.match(red.err, /templates\/en\/brief\.md placeholder \{\{budget\}\} has no key in vars/);

    green = toolProject((dir) => {
      withSlot(dir, 'budget');
      put(dir, 'lib/templates.js', read(dir, 'lib/templates.js')
        .replace("[/^brief\\.md$/, ['autonomy',", "[/^brief\\.md$/, ['autonomy', 'budget',"));
    });
    assert.equal(green.code, 0, green.err);
  } finally {
    if (red) cleanup(red.dir);
    if (green) cleanup(green.dir);
  }
});

test('lint: template parity: пропавший английский слой — ошибка, а не тишина', () => {
  let project;
  try {
    project = toolProject((dir) => rmSync(path.join(dir, 'templates', 'en'), { recursive: true }));
    assert.equal(project.code, 1, project.out);
    assert.match(project.err, /templates\/en\/ is missing/);
  } finally { if (project) cleanup(project.dir); }
});

test('lint: чужой проект получает ошибок парности не больше, чем каталогов templates/', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    // Каталога templates/ у потребителя нет вовсе: признак читает несуществующий путь и
    // обязан тихо выключить гейт, а не уронить lint исключением.
    let r = cli(root, ['lint']);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(problems(root), []);
    put(root, 'templates/skills/own-skill/SKILL.md', '{{cli}}\n');
    r = cli(root, ['lint']);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(problems(root), []);
  } finally {
    cleanup(root);
  }
});

test('lint: 4. заглушка «Области» от new красит разобранную задачу и молчит в triage/', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    assert.equal(cli(root, ['new', 'queued', '--queue']).code, 0);
    assert.equal(cli(root, ['new', 'triaged']).code, 0);
    const found = problems(root);
    assert.ok(found.some((p) => /queued\.md: «Область» не заполнена/.test(p)), found.join(' | ') || 'ничего');
    assert.ok(!found.some((p) => /triaged\.md: «Область»/.test(p)), `запись triage/ не разобрана — гейт молчит: ${found.join(' | ')}`);
  } finally {
    cleanup(root);
  }
});

// Карточка, заведённая штатной командой, обязана проходить гейт до разбора: в triage/ её
// заготовки не проверяются вовсе. Та же карточка в queue/ разобрана — краснеет каждая.
test('lint: 4. карточка new в triage/ гейт не красит, она же в queue/ — красит каждую заглушку', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    assert.equal(cli(root, ['new', 'placeholders', '--title', 'Заготовки']).code, 0);
    assert.deepEqual(problems(root), []);
    assert.equal(cli(root, ['mv', '5', 'queue']).code, 0);
    const found = problems(root);
    const todoLines = read(root, 'docs/backlog/queue/BS-5-placeholders.md')
      .split('\n').map((line, i) => (line.includes('[TODO') ? i + 1 : 0)).filter(Boolean);
    assert.ok(todoLines.length >= 4, `в карточке new заготовок ${todoLines.length}`);
    for (const line of todoLines) {
      assert.ok(found.some((p) => p === `docs/backlog/queue/BS-5-placeholders.md: строка ${line}: осталась заглушка [TODO]`),
        `строка ${line} не покраснела: ${found.join(' | ') || 'ничего'}`);
    }
  } finally {
    cleanup(root);
  }
});

test('lint: 10. цитата в docs/archive — снимок момента, а показанная в фенсе — не блок', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    // Закрытая задача цитирует то, чего в файле давно нет: красить её нельзя.
    put(root, 'docs/archive/BS-4-e/task.md', '# BS-4 · Д\n\n<!-- quote:../reference/README.md -->\n\nчего в файле нет\n\n<!-- /quote -->\n');
    // Форма блока, показанная внутри фенса, — пример, а не цитата.
    put(root, 'docs/howto.md', ['# Как цитировать', '', '```markdown', '<!-- quote:reference/none.md -->', 'что угодно', '<!-- /quote -->', '```', ''].join('\n'));
    assert.deepEqual(problems(root), []);
  } finally {
    cleanup(root);
  }
});
test('lint: 10. quote:before сохраняет снимок до правки, но не скрывает ошибки блока', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    put(root, 'docs/quoting.md', [
      '# Цитаты', '',
      '<!-- quote:before:reference/README.md -->', '',
      'состояние до правки', '',
      '<!-- /quote -->', '',
    ].join('\n'));
    let r = cli(root, ['lint']);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(problems(root), []);
    put(root, 'docs/quoting.md', '<!-- quote:before:reference/missing.md -->\n\nсостояние до правки\n\n<!-- /quote -->\n');
    r = cli(root, ['lint']);
    assert.equal(r.code, 1);
    assert.match(r.err, /missing\.md/);
  } finally {
    cleanup(root);
  }
});

probe('10. второй маркер закрывает незакрытый блок ошибкой', (root) => put(root, 'docs/quoting.md', '<!-- quote:reference/README.md -->\n\nОдно понятие — одно имя.\n\n<!-- quote:reference/README.md -->\n\nОдно понятие — одно имя.\n\n<!-- /quote -->\n'), /quoting\.md: блок цитаты .* не закрыт/);
probe('10. цитата разошлась с файлом', (root) => put(root, 'docs/reference/README.md', '# Справочник\n\nОдно понятие — два имени.\n'), /quoting\.md: цитата разошлась с reference\/README\.md/);
probe('10. цитата ведёт на несуществующий файл', (root) => put(root, 'docs/quoting.md', '<!-- quote:reference/none.md -->\n\nтекст\n\n<!-- /quote -->\n'), /quoting\.md: цитата ведёт на несуществующий файл reference\/none\.md/);
probe('10. блок цитаты не закрыт', (root) => put(root, 'docs/quoting.md', '<!-- quote:reference/README.md -->\n\nОдно понятие — одно имя.\n'), /quoting\.md: блок цитаты .* не закрыт/);

// BS-19: пять ветвей err(), которые до сих пор можно было вырезать при зелёном npm test.
probe('2. каталог вместо файла задачи в каталоге статуса', (root) => mkdirSync(path.join(root, 'docs/backlog/queue/sub')), /каталог внутри каталога статуса/);
// Каталог, названный как файл задачи: scanTasks читал его как файл и падал EISDIR раньше гейта (BS-19.1).
probe('2. каталог, названный как файл задачи, в каталоге статуса', (root) => mkdirSync(path.join(root, 'docs/backlog/queue/BS-9-sub.md')), /BS-9-sub\.md: каталог внутри каталога статуса/);
probe('2. symlink на каталог с именем файла задачи — та же диагностика', (root) => {
  mkdirSync(path.join(root, 'docs/shared'));
  symlinkSync(path.join(root, 'docs/shared'), path.join(root, 'docs/backlog/queue/BS-9-sub.md'));
}, /BS-9-sub\.md: каталог внутри каталога статуса/);
probe('2. битая ссылка с именем файла задачи в каталоге статуса', (root) => {
  symlinkSync(path.join(root, 'docs/nowhere.md'), path.join(root, 'docs/backlog/queue/BS-9-sub.md'));
}, /BS-9-sub\.md: битая ссылка в каталоге статуса/);
probe('3. каталога бэклога нет', (root) => rmSync(path.join(root, 'docs/backlog'), { recursive: true }), /каталога бэклога нет/);
probe('5. посторонний файл в архиве', (root) => put(root, 'docs/archive/NOTES.txt', 'заметка\n'), /в архиве только каталоги задач, README\.md и LOG\.md/);
probe('5. каталог архива без task.md', (root) => rmSync(path.join(root, 'docs/archive/BS-4-e/task.md')), /нет task\.md — постановки/);
probe('8. ADR есть, а индекса документации нет', (root) => rmSync(path.join(root, 'docs/README.md')), /нет индекса документации, а ADR есть/);

// 13. Журнал закрытых. Гейт держит три утверждения, и у каждого своя проба: запись разбирается,
// якорь строки равен номеру, ссылка на якорь ведёт на существующую запись. Третья — единственная
// проверка якоря во всём lint: гейт ссылок резолвит только путь.
const LOG_GREEN = [
  '# Журнал закрытых задач',
  '',
  'Строка на задачу.',
  '',
  '- <a id="bs-5"></a>`BS-5-folded` · 2026-08-02 · выполнена · `abcdef1234` · Свёрнутая',
  '',
].join('\n');

function seedLog(root) {
  put(root, 'docs/archive/LOG.md', LOG_GREEN);
  put(root, 'docs/ROADMAP.md', '# Roadmap\n\nЗакрыта [BS-5](archive/LOG.md#bs-5).\n');
}

test('lint: журнал закрытых рядом с каталогом архива — зелёный', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    seedLog(root);
    assert.deepEqual(problems(root), []);
  } finally {
    cleanup(root);
  }
});

probe('13. строка журнала не разбирается', (root) => {
  seedLog(root);
  put(root, 'docs/archive/LOG.md', LOG_GREEN.replace('· 2026-08-02 ·', '· вчера ·'));
}, /LOG\.md: строка 5 выглядит записью журнала, но не разбирается/);

probe('13. якорь строки не совпадает с номером', (root) => {
  seedLog(root);
  put(root, 'docs/archive/LOG.md', LOG_GREEN.replace('id="bs-5"', 'id="bs-50"'));
}, /LOG\.md: строка 5: якорь «bs-50» не совпадает с номером/);

probe('13. ссылка ведёт на якорь, которого в журнале нет', (root) => {
  seedLog(root);
  put(root, 'docs/ROADMAP.md', '# Roadmap\n\nЗакрыта [BS-5](archive/LOG.md#bs-55).\n');
}, /ROADMAP\.md: ссылка archive\/LOG\.md#bs-55 ведёт на строку журнала, которой нет/);

probe('13. ссылка из корневого файла на промахнувшийся якорь', (root) => {
  seedLog(root);
  put(root, 'README.md', 'См. [BS-5](docs/archive/LOG.md#bs-55)\n');
}, /README\.md: ссылка docs\/archive\/LOG\.md#bs-55 ведёт на строку журнала, которой нет/);

probe('2. номер занят и каталогом архива, и строкой журнала', (root) => {
  put(root, 'docs/archive/LOG.md', LOG_GREEN.replace('bs-5', 'bs-4').replace('BS-5-folded', 'BS-4-e'));
}, /номер BS-4 уже занят/);

test('lint: каталог с именем файла задачи — диагностика гейта 2 в stderr, а не стек EISDIR', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    mkdirSync(path.join(root, 'docs/backlog/queue/BS-9-sub.md'));
    const r = cli(root, ['lint']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, /BS-9-sub\.md: каталог внутри каталога статуса/);
    assert.doesNotMatch(r.err, /EISDIR|node:fs/);
  } finally {
    cleanup(root);
  }
});

test('lint: живой пин, расходящийся с cli, — ошибка с файлом и строкой', () => {
  const root = makeProject({ git: false });
  const V = TOOL_VERSION;
  try {
    seedGreen(root);
    const setConfig = (patch) => put(root, 'backslop.json', `${JSON.stringify({ ...JSON.parse(read(root, 'backslop.json')), ...patch }, null, 2)}\n`);
    setConfig({ cli: `npx github:me/proj#v${V}`, version: V });
    assert.deepEqual(warnings(root), []);
    put(root, 'package.json', `{"scripts":{"lint:backslop":"npx github:me/proj#v0.1.0 lint"}}\n`);
    put(root, '.github/workflows/ci.yml', `steps:\n  - run: npx github:me/proj#v0.1.0 init\n`);
    assert.ok(problems(root).some((p) => p.startsWith('package.json:')), problems(root).join(' | '));
    assert.ok(problems(root).some((p) => p.startsWith('.github/workflows/ci.yml:')), problems(root).join(' | '));
    put(root, 'package.json', `{"scripts":{"lint:backslop":"npx github:me/proj#v${V} lint"}}\n`);
    put(root, '.github/workflows/ci.yml', `steps:\n  - run: npx github:me/proj#v${V} init\n`);
    assert.deepEqual(problems(root), []);

    put(root, 'docs/archive/README.md', '# Архив\n\nПереезд делает `npx github:me/proj#v0.1.0 archive N`.\n');
    assert.ok(problems(root).some((p) => p.includes('docs/archive/README.md: строка 3: пин github:me/proj#v0.1.0 расходится с cli')), problems(root).join(' | '));

    // Записи о моменте — не инструкция: их версии дрейфом не считаются.
    put(root, 'docs/archive/README.md', '# Архив\n');
    put(root, 'CHANGELOG.md', '## Не выпущено\n\n- **Одно** — было `npx github:me/proj#v0.1.0`\n');
    put(root, 'docs/adr/adr-001-process.md', '# ADR-001: Процесс\n\n**Status:** Accepted\n\nПри `npx github:me/proj#v0.1.0`.\n');
    put(root, 'docs/archive/BS-4-e/task.md', '# BS-4 · Д\n\nГнали `npx github:me/proj#v0.1.0 lint`.\n');
    assert.deepEqual(problems(root), []);

    // Карточка задачи цитирует пин уликой момента — предупреждать не о чем.
    put(root, 'docs/backlog/queue/BS-1-a.md', '# BS-1 · А\n\n- **Порядок:** 10\n- **Область:** [x](../../reference/README.md)\n\nЗамер сделан на `npx github:me/proj#v0.1.0`.\n');
    assert.deepEqual(problems(root), []);

    // npm-форма пина сверяется тем же способом.
    setConfig({ cli: `npx backslop@${V}`, version: V });
    put(root, 'docs/ROADMAP.md', 'Ставится `npx backslop@0.3.0`.\n');
    assert.ok(problems(root).some((p) => /docs\/ROADMAP\.md: строка 1: пин backslop@0\.3\.0 расходится с cli/.test(p)), problems(root).join(' | '));

    // cli без пина — сверять не с чем: self-host и глобальная установка молчат.
    setConfig({ cli: 'node bin/backslop.js', version: V });
    assert.deepEqual(problems(root), []);
    assert.deepEqual(warnings(root), []);
  } finally {
    cleanup(root);
  }
});
