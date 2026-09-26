// Гейты lint: зелёный проект и по красной пробе на каждый гейт. Проба — мутация зелёного
// проекта; без неё гейт нечем отличить от холостого.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadProject, parseCli } from '../lib/config.js';
import { lintProject } from '../lib/lint.js';
import { livePinFiles } from '../lib/mdwalk.js';
import { rewriteProsePins } from '../lib/upgrade.js';
import { REPO, cleanup, cli, gitAll, makeProject, put, read, resultTemplateParagraphs, run, toolCli, toolCopy } from './helpers.mjs';
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
  put(root, 'docs/archive/BS-4-e/result.md', '# BS-4 · Результат\n\n**Закрыта 2026-08-01.** Выполнена.\n');
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

test('lint: an unknown flag is refused like in every other command', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    for (const args of [['--bogus'], ['--json'], ['--nope', '--json', 'foo']]) {
      const r = cli(root, ['lint', ...args]);
      assert.equal(r.code, 1, `${args.join(' ')}: ${r.out}`);
      assert.match(r.err, new RegExp(`^✖ неизвестный флаг «${args[0]}»`), args.join(' '));
      assert.doesNotMatch(r.out, /ошибок нет/, `${args.join(' ')}: lint ran anyway`);
    }
    assert.equal(cli(root, ['lint']).code, 0);
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
test('lint: 1. a link whose target differs only in letter case is an error on any filesystem', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    put(root, 'backslop.json', '{"prefix":"BS","docs":"docs","gates":[],"lang":"en","tools":[]}\n');
    put(root, 'docs/note.md', '[overview](reference/readme.md)\n');
    const r = cli(root, ['lint']);
    assert.equal(r.code, 1);
    assert.match(r.err, /docs\/note\.md: link target differs in case: docs\/reference\/README\.md \(link reference\/readme\.md\)/);
    assert.match(r.err, /lint: errors 1\b/);
  } finally {
    cleanup(root);
  }
});
test('lint: 1. balanced parentheses and every URI scheme pass; a BOM hides no first-line link', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    put(root, 'docs/reference/foo(1).md', '# Foo\n');
    const links = '[foo](reference/foo(1).md) [ftp](ftp://host/f.txt) [file](file:///etc/hosts) [tel](tel:+123) '
      + '[up](HTTPS://example.com) [proto](//cdn.example.com/a.png)\n';
    put(root, 'docs/note.md', links);
    put(root, 'README.md', links.replace('reference/', 'docs/reference/'));
    assert.deepEqual(problems(root), []);
    put(root, 'docs/bom.md', '\uFEFF[missing]: reference/nope.md\n');
    put(root, 'docs/fence.md', '\uFEFF```\nexample\n```\n\nSee [missing](reference/nope.md).\n');
    assert.deepEqual(problems(root), [
      'docs/bom.md: битая ссылка reference/nope.md',
      'docs/fence.md: битая ссылка reference/nope.md',
    ]);
  } finally {
    cleanup(root);
  }
});
probe('1. an upper-case .MD file is walked', (root) => put(root, 'docs/NOTE.MD', '[missing](reference/nope.md)\n'), /docs\/NOTE\.MD: битая ссылка reference\/nope\.md/);
test('lint: 1, 8, 13. a git failure while finding the repository root refuses instead of resolving blind', { skip: process.platform === 'win32' }, () => {
  const root = makeProject();
  const shim = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-git-shim-')));
  try {
    seedGreen(root);
    const real = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
    writeFileSync(path.join(shim, 'git'), `#!/bin/sh\nfor a in "$@"; do [ "$a" = "$KILL_ON" ] && kill -9 $$; done\nexec "${real}" "$@"\n`, { mode: 0o755 });
    assert.equal(cli(root, ['lint']).code, 0);
    for (const [arg, cause] of [
      ['--is-inside-work-tree', /git rev-parse --is-inside-work-tree: оборван сигналом SIGKILL/],
      ['--show-prefix', /git rev-parse --show-prefix: оборван сигналом SIGKILL/],
    ]) {
      const r = cli(root, ['lint'], { env: { KILL_ON: arg, PATH: `${shim}${path.delimiter}${process.env.PATH}` } });
      assert.equal(r.code, 1, `${arg}: ${r.out}`);
      assert.match(r.err, cause);
    }
  } finally {
    cleanup(root);
    rmSync(shim, { recursive: true, force: true });
  }
});

test('lint: 1, 10, 13. a root markdown symlink into the project is read; one leading outside is not', { skip: process.platform === 'win32' }, () => {
  const root = makeProject({ git: false });
  const outside = mkdtempSync(path.join(os.tmpdir(), 'backslop-lint-outside-'));
  try {
    seedGreen(root);
    seedLog(root);
    rmSync(path.join(root, 'README.md'));
    put(root, 'notes/README.md', '[broken](docs/none.md) [log](docs/archive/LOG.md#bs-55)\n\n<!-- quote:docs/none.md -->\ntext\n<!-- /quote -->\n');
    symlinkSync(path.join(root, 'notes', 'README.md'), path.join(root, 'README.md'));
    writeFileSync(path.join(outside, 'OUT.md'), '[broken](docs/none.md)\n');
    symlinkSync(path.join(outside, 'OUT.md'), path.join(root, 'OUT.md'));
    assert.deepEqual(problems(root), [
      'README.md: битая ссылка docs/none.md',
      'README.md: ссылка docs/archive/LOG.md#bs-55 ведёт на строку журнала, которой нет — якорь «bs-55» ни за одной записью',
      'README.md: цитата ведёт на несуществующий файл docs/none.md',
    ]);
  } finally {
    cleanup(root);
    rmSync(outside, { recursive: true, force: true });
  }
});
probe('1. ссылка с номером задачи ведёт на каталог', (root) => put(root, 'docs/backlog/queue/BS-1-a.md', `${read(root, 'docs/backlog/queue/BS-1-a.md')}\n**Находка.** [BS-2.1](../triage) — карточка\n`), /BS-1-a\.md: ссылка \[BS-2\.1\]\(\.\.\/triage\) ведёт на каталог/);
probe('1. reference-style ссылка с номером задачи ведёт на каталог', (root) => put(root, 'docs/backlog/queue/BS-1-a.md', `${read(root, 'docs/backlog/queue/BS-1-a.md')}\n**Находка.** [BS-2.1][f] — карточка\n\n[f]: ../triage\n`), /BS-1-a\.md: ссылка \[BS-2\.1\]\(\.\.\/triage\) ведёт на каталог/);
probe('1. ссылка с номером задачи на каталог в generated adapter output', (root) => {
  assert.equal(cli(root, ['init', '--tools', 'claude']).code, 0);
  put(root, '.claude/skills/backslop-task/SKILL.md', `${read(root, '.claude/skills/backslop-task/SKILL.md')}\nСм. [BS-2](../../../docs/backlog/triage)\n`);
}, /\.claude\/skills\/backslop-task\/SKILL\.md: ссылка \[BS-2\]\(\.\.\/\.\.\/\.\.\/docs\/backlog\/triage\) ведёт на каталог/);
probe('1. номер в тексте ссылки на каталог — и в код-спане', (root) => put(root, 'README.md', 'См. [`BS-2.1` · находка](docs/backlog/triage/)\n'), /README\.md: ссылка \[`BS-2\.1` · находка\]\(docs\/backlog\/triage\/\) ведёт на каталог/);
test('lint: 1. незакрытая скобка с номером перед ссылкой на каталог — не текст ссылки', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    put(root, 'docs/note.md', 'Полуинтервал [0, 1) — см. BS-2.1. Раскладка — [backlog/](backlog/triage).\n');
    assert.deepEqual(problems(root), []);
  } finally {
    cleanup(root);
  }
});
test('lint: 1. каталог без номера в тексте и карточка с номером — законные цели', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    put(root, 'docs/backlog/queue/BS-1-a.md', `${read(root, 'docs/backlog/queue/BS-1-a.md')}\n[triage/](../triage) и **Находка.** [BS-2.1](../triage/BS-2.1-d.md)\n`);
    assert.deepEqual(problems(root), []);
  } finally {
    cleanup(root);
  }
});
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
test('lint: 3. a status directory symlinked inside the project is a status; one leading outside is not followed', { skip: process.platform === 'win32' }, () => {
  const root = makeProject({ git: false });
  const outside = mkdtempSync(path.join(os.tmpdir(), 'backslop-lint-outside-'));
  try {
    seedGreen(root);
    renameSync(path.join(root, 'docs/backlog/queue'), path.join(root, 'store-queue'));
    symlinkSync(path.join(root, 'store-queue'), path.join(root, 'docs/backlog/queue'));
    assert.deepEqual(problems(root), []);
    unlinkSync(path.join(root, 'docs/backlog/queue'));
    renameSync(path.join(root, 'store-queue'), path.join(outside, 'queue'));
    symlinkSync(path.join(outside, 'queue'), path.join(root, 'docs/backlog/queue'));
    assert.ok(problems(root).some((p) => /^docs\/backlog\/queue: файл вне каталога статуса/.test(p)), problems(root).join(' | '));
  } finally {
    cleanup(root);
    rmSync(outside, { recursive: true, force: true });
  }
});
probe('3. нет каталога статуса', (root) => rmSync(path.join(root, 'docs/backlog/deferred'), { recursive: true }), /каталога статуса нет/);
probe('3. нет каталога minor', (root) => rmSync(path.join(root, 'docs/backlog/minor'), { recursive: true }), /docs\/backlog\/minor: каталога статуса нет/);
probe('4. minor без цены', (root) => put(root, 'docs/backlog/minor/BS-1.1-m.md', '# BS-1.1 · М\n\n- **Родитель:** BS-1\n'), /в minor\/ без поля «Цена»/);
probe('4. цена не разбирается', (root) => put(root, 'docs/backlog/minor/BS-1.1-m.md', '# BS-1.1 · М\n\n- **Цена:** дорого\n'), /«Цена» не разбирается/);
probe('4. major в minor без гипотезы', (root) => put(root, 'docs/backlog/minor/BS-1.1-m.md', '# BS-1.1 · М\n\n- **Цена:** major\n'), /«Цена» major без пометки «гипотеза»/);
probe('4. цена повторяется', (root) => put(root, 'docs/backlog/minor/BS-1.1-m.md', '# BS-1.1 · М\n\n- **Цена:** minor\n- **Цена:** minor\n'), /поле «Цена» повторяется/);
probe('5. чужой файл в minor/ пачки', (root) => put(root, 'docs/archive/BS-4-e/minor/notes.md', '# заметки\n'), /archive\/BS-4-e\/minor\/notes\.md: в minor\/ пачки только файлы записей/);
probe('5. каталог в minor/ пачки', (root) => mkdirSync(path.join(root, 'docs/archive/BS-4-e/minor/BS-4.9-x'), { recursive: true }), /archive\/BS-4-e\/minor\/BS-4\.9-x: в minor\/ пачки только файлы записей/);
probe('2. запись в minor/ пачки с чужим заголовком', (root) => put(root, 'docs/archive/BS-4-e/minor/BS-4.1-m.md', '# BS-4.2 · Не та\n'), /archive\/BS-4-e\/minor\/BS-4\.1-m\.md: заголовок называет BS-4\.2/);
// Вторая дверь в minor/ закрыта с той же стороны, что new --minor:
// раздел «Улика» обязателен (ADR-036).
probe('4. minor без раздела «Улика»', (root) => put(root, 'docs/backlog/minor/BS-1.1-m.md', '# BS-1.1 · М\n\n- **Цена:** minor\n\n## Контекст\n\nистория\n'), /BS-1\.1-m\.md: в minor\/ без раздела «## Улика» или он пуст: запись уезжает в пачку без разбора/);
probe('4. minor с пустой «Уликой»', (root) => put(root, 'docs/backlog/minor/BS-1.1-m.md', '# BS-1.1 · М\n\n- **Цена:** minor\n\n## Улика\n\n## Контекст\n\nистория\n'), /BS-1\.1-m\.md: в minor\/ без раздела «## Улика» или он пуст/);
probe('4. «Улика» в minor/ заглушкой', (root) => put(root, 'docs/backlog/minor/BS-1.1-m.md', '# BS-1.1 · М\n\n- **Цена:** minor\n\n## Улика\n\nНаходка при работе над BS-1.\nУлика: [TODO: путь к файлу или команда с выводом]\n'), /BS-1\.1-m\.md: раздел «Улика» не заполнен: осталась заглушка \[TODO\]/);
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
probe('4. placeholder in a numbered item', (root) => put(root, 'docs/backlog/queue/BS-5-num.md', '# BS-5 · N\n\n1. [TODO]\n2) [TODO: command]\n'), /BS-5-num\.md: строка 4: осталась заглушка \[TODO\]/);
probe('4. placeholder in a task-list box', (root) => put(root, 'docs/backlog/queue/BS-5-box.md', '# BS-5 · B\n\n- [ ] [TODO]\n'), /BS-5-box\.md: строка 3: осталась заглушка \[TODO\]/);
probe('4. placeholder in a checked task-list box', (root) => put(root, 'docs/backlog/queue/BS-5-done.md', '# BS-5 · D\n\n- [x] [TODO: step]\n'), /BS-5-done\.md: строка 3: осталась заглушка \[TODO\]/);
probe('4. placeholder in a table cell', (root) => put(root, 'docs/backlog/queue/BS-5-table.md', '# BS-5 · T\n\n| a | b |\n|---|---|\n| done | [TODO] |\n'), /BS-5-table\.md: строка 5: осталась заглушка \[TODO\]/);

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
    put(root, 'docs/backlog/queue/BS-1-a.md', '# BS-1 · А\n\n- **Порядок:** 10\n- **Область:** заполнено; проверка [TODO] не должна искать подстроку\n\n| a | b |\n|---|---|\n| заполнено; [TODO] внутри | 1. [TODO] в тексте |\n');
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
// Построчный разбор заглушек `docs/backlog/**` строку шаблона заглушкой не считает: проба на
// голую `- [TODO]` не отличила бы рабочий гейт от холостого.
for (const lang of ['ru', 'en']) {
  const paragraphs = resultTemplateParagraphs(lang);
  assert.ok(paragraphs.length > 0 && paragraphs.every((p) => p.includes('[TODO')), `шаблон result.md (${lang}) без заглушек — проба была бы холостой`);
  probe(`5. нетронутый шаблон result.md (${lang})`, (root) => put(root, 'docs/archive/BS-4-e/result.md', `# BS-4 · Результат\n\n${paragraphs.join('\n\n')}\n`), /BS-4-e\/result\.md: результат не дописан/);
  paragraphs.forEach((p, i) => {
    probe(`5. абзац ${i + 1} шаблона result.md (${lang}) — единственная заглушка`, (root) => put(root, 'docs/archive/BS-4-e/result.md', `# BS-4 · Результат\n\n${p}\n`), /BS-4-e\/result\.md: результат не дописан/);
  });
}
test('lint: 5. заглушка, показанная в коде, — рассказ о ней, а не она сама', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    put(root, 'docs/archive/BS-4-e/result.md', [
      '# BS-4 · Результат', '',
      '**Закрыта 2026-08-01.** Выполнена: гейт краснел на `[TODO: исход]` в прозе, а ``[TODO`` в код-спане — пример.', '',
      '```', '**Закрыта 2026-08-01.** [TODO: исход]', '```', '',
    ].join('\n'));
    assert.deepEqual(problems(root), []);
  } finally {
    cleanup(root);
  }
});
// Исход словом словаря: голое «Закрыта» свёртка прочла бы «выполнена», и отказ стал бы выполнением.
for (const [first, lang] of [['**Закрыта 2026-08-01.** Готово.', 'ru'], ['**Закрыта 2026-08-01.** Отказ: беспредметна.', 'ru'], ['**Закрыта 2026-08-01.** Дубль BS-2.', 'ru'], ['**Закрыта 2026-08-01.** Слито в main.', 'ru'], ['**Closed 2026-08-01.** Done.', 'en']]) {
  probe(`5. первый абзац result.md без слова исхода: «${first}»`, (root) => put(root, 'docs/archive/BS-4-e/result.md', `# BS-4 · Результат\n\n${first}\n\n**Проверки.** Отклонена гипотеза о кэше.\n`),
    /archive\/BS-4-e: result\.md не называет исход словом словаря — выполнена, отклонена, снята с плана или слита в BS-N — ни в первом абзаце, ни в заголовке/);
}
test('lint: 5. слово исхода из словаря в первом абзаце или заголовке — любой исход и оба языка', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    for (const first of ['**Закрыта 2026-08-01.** Выполнена.', '**Закрыта 2026-08-01.** Отклонена: беспредметна.', '**Закрыта 2026-08-01.** Снята с плана.', '**Закрыта 2026-08-01.** Слита в BS-2.', '**Closed 2026-08-01.** Completed.', '**Closed 2026-08-01.** Rejected.', '**Closed 2026-08-01.** Merged into BS-2.']) {
      put(root, 'docs/archive/BS-4-e/result.md', `# BS-4 · Результат\n\n${first}\n`);
      assert.deepEqual(problems(root), [], first);
    }
    // Исход в заголовке старого архива свёртка читает — гейт тоже.
    for (const heading of ['# BS-4 — результат (снята с плана 2026-08-13)', '# BS-4 — результат: отклонена']) {
      put(root, 'docs/archive/BS-4-e/result.md', `${heading}\n\nОписание дефекта без слова исхода.\n`);
      assert.deepEqual(problems(root), [], heading);
    }
  } finally {
    cleanup(root);
  }
});
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
test('lint: 7. a CHANGELOG code fence neither resets the section nor adds entries', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    put(root, 'CHANGELOG.md', '## 1.0.0\n\n- **Alpha** — one\n\n```\n## 0.9.0\n```\n\n- **Alpha** — two\n');
    assert.deepEqual(problems(root), ['CHANGELOG.md: строка 9: заголовок записи «Alpha» уже есть в секции «1.0.0» (строка 3) — оставь одну редакцию']);
    put(root, 'CHANGELOG.md', '## 1.0.0\n\n- **Entry format** — real\n\n```\n- **Entry format** — example\n- **Entry format** — example\n```\n');
    assert.deepEqual(problems(root), []);
  } finally {
    cleanup(root);
  }
});
probe('8. ADR без строки в таблице', (root) => put(root, 'docs/adr/adr-002-orphan.md', '# ADR-002: Сирота\n'), /adr-002-orphan\.md: нет строки/);
probe('8. номер ADR занят дважды', (root) => put(root, 'docs/adr/adr-001-again.md', '# ADR-001: Снова\n'), /номер ADR 1 уже занят/);
probe('8. an ADR file with an upper-case .MD extension is name-checked', (root) => put(root, 'docs/adr/adr-002-x.MD', '# ADR-002: X\n'), /docs\/adr\/adr-002-x\.MD: имя не по шаблону adr-NNN-<slug>\.md/);
test('lint: 8. an ADR file name is checked even when no ADR is named correctly', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    rmSync(path.join(root, 'docs/adr/adr-001-process.md'));
    put(root, 'docs/adr/ADR-001-process.md', '# ADR-001: Process\n\n**Status:** Accepted\n');
    put(root, 'docs/README.md', read(root, 'docs/README.md').replaceAll('adr/adr-001-process.md', 'adr/ADR-001-process.md'));
    assert.deepEqual(problems(root), ['docs/adr/ADR-001-process.md: имя не по шаблону adr-NNN-<slug>.md']);
    assert.equal(cli(root, ['lint']).code, 1);
  } finally {
    cleanup(root);
  }
});
probe('8. файл в adr/ не по шаблону', (root) => put(root, 'docs/adr/decision.md', '# x\n'), /decision\.md: имя не по шаблону adr-NNN/);
test('lint: 8. an ADR row linked from the root, with ?query or with a %-escape counts as its row', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    for (const href of ['/docs/adr/adr-001-process.md', 'adr/adr-001-process.md?plain=1', 'adr/adr-001-process%2Emd']) {
      put(root, 'docs/README.md', read(root, 'docs/README.md').replace(/\(\/?[^)]*adr-001-process[^)]*\)/, `(${href})`));
      assert.ok(read(root, 'docs/README.md').includes(`(${href})`), 'the ADR row carries the href form');
      assert.deepEqual(problems(root), [], href);
    }
  } finally {
    cleanup(root);
  }
});
test('lint: находка под закрытым родителем остаётся предупреждением для approver', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    put(root, 'docs/archive/BS-2-b/task.md', '# BS-2 · Б\n');
    put(root, 'docs/archive/BS-2-b/result.md', '# BS-2 · Результат\n\n**Закрыта 2026-08-01.** Выполнена.\n');
    put(root, 'docs/archive/BS-007-old/task.md', '# BS-007 · Старая\n');
    put(root, 'docs/archive/BS-007-old/result.md', '# BS-007 · Результат\n\n**Закрыта 2026-08-01.** Выполнена.\n');
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
    put(root, 'docs/backlog/minor/BS-1.1-m.md', '# BS-1.1 · М\n\n- **Область:** \n- **Цена:** minor\n\n## Улика\n\nlib/a.js:1\n');
    put(root, 'docs/backlog/minor/BS-1.2-n.md', '# BS-1.2 · Н\n\n- **Цена:** major (гипотеза)\n\n## Улика\n\nпредположительно течёт\n');
    put(root, 'docs/backlog/minor/BS-1.3-o.md', '# BS-1.3 · О\n\n- **Область:** [x](../../reference/README.md)\n- **Цена:** critical (hypothesis)\n\n## Evidence\n\npresumably leaks\n');
    put(root, 'docs/backlog/minor/BS-1.4-p.md', '# BS-1.4 · П\n\n- **Область:** [TODO: раздел](../../reference/README.md)\n- **Цена:** minor\n\n## Улика\n\nlib/b.js:2\n');
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
    put(root, 'docs/archive/BS-007-old/result.md', '# BS-007 · Результат\n\n**Закрыта 2026-08-01.** Выполнена.\n');
    put(root, 'docs/ROADMAP.md', 'Сделано в BS-007, она же BS-7.\n');
    assert.deepEqual(problems(root), []);
  } finally {
    cleanup(root);
  }
});
probe('2. номер занят дважды в разных формах записи', (root) => put(root, 'docs/backlog/triage/BS-004-e2.md', '# BS-004 · Дубль\n'), /номер BS-004 уже занят: docs\/archive\/BS-4-e\/task\.md/);

// 11. Гейт релиза работает только в дереве самого инструмента, поэтому его пробы, как и пробы
// парности, идут на копии инструмента: у обычной фикстуры своей версии нет.
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
// ADR-015: ownership is the marker alone, so an unmarked file at a template path is foreign.
// The copy adds the template to both layers, since the parity gate runs there too.
test('lint: adapter output без маркера — чужой файл на owned-пути выбранного adapter\'а', () => {
  let project;
  try {
    project = toolProject((dir) => {
      put(dir, 'templates/skills/backslop-task/references/extra.md', '# extra\n');
      put(dir, 'templates/en/skills/backslop-task/references/extra.md', '# extra\n');
      // `init --tools` в корне инструмента отказывает;
      // adapter в self-host выбирается правкой конфига.
      put(dir, 'backslop.json', `${JSON.stringify({ ...JSON.parse(read(dir, 'backslop.json')), tools: ['claude'] }, null, 2)}\n`);
      const r = toolCli(dir, ['init']);
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

test('lint: 11. a stale release pin with a .git suffix or without v in README', () => {
  let project;
  try {
    project = toolProject((dir) => put(dir, 'README.md', 'Install `npx github:Velklish/backslop.git#v0.2.0` or `npx github:Velklish/backslop#0.2.0`\n'));
    assert.equal(project.code, 1, project.out);
    assert.match(project.err, /README\.md: строка 1: пин github:Velklish\/backslop\.git#v0\.2\.0 — инструмент на v\d+\.\d+\.\d+/);
    assert.match(project.err, /README\.md: строка 1: пин github:Velklish\/backslop#0\.2\.0 — инструмент на v\d+\.\d+\.\d+/);
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

// A `templates` link to the running tool's own directory wakes the self-host gates.
test('lint: 11. a malformed package.json is a gate error, and the other gates still report', { skip: process.platform === 'win32' }, () => {
  for (const [lang, parsed] of [['ru', /^✖ .*package\.json: не разбирается: .*JSON/m], ['en', /^✖ .*package\.json: cannot be parsed: .*JSON/m]]) {
    const root = makeProject({ git: false });
    try {
      seedGreen(root);
      put(root, 'backslop.json', `${JSON.stringify({ ...JSON.parse(read(root, 'backslop.json')), lang }, null, 2)}\n`);
      symlinkSync(path.join(REPO, 'templates'), path.join(root, 'templates'), 'dir');
      put(root, 'package.json', '{ "version": "0.11.0", }\n');
      put(root, 'docs/stray.md', '[x](nowhere.md)\n');
      const r = cli(root, ['lint']);
      assert.equal(r.code, 1, `${lang}: ${r.out}`);
      assert.match(r.err, parsed, lang);
      assert.match(r.err, /stray\.md: .*nowhere\.md/, `${lang}: the links gate still reports`);
      assert.match(r.err, /^✖ lint: (ошибок|errors) 2\b/m, lang);
      assert.doesNotMatch(r.err, /SyntaxError|lintReleaseVersions/, lang);
    } finally {
      cleanup(root);
    }
  }
});

// Гейт парности работает только в дереве самого инструмента, поэтому проба идёт на копии
// (toolCopy): обычная фикстура с каталогом `templates/` гейт не будит.
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

// 14. Непечатаемый байт: гейт судит отслеживаемые файлы,
// поэтому копия инструмента заводит индекс git.
test('lint: 14. байт ниже 0x09 в отслеживаемом исходнике инструмента — ошибка с файлом, смещением и строкой', () => {
  let red;
  let green;
  try {
    red = toolProject((dir) => {
      put(dir, 'lib/probe.js', 'const a = 1;\nconst key = `a\u0000b`;\n');
      put(dir, 'bin/probe.txt', 'ab\u0001c\n');
      run(dir, ['init', '-q']);
      run(dir, ['add', '-A']);
    });
    assert.equal(red.code, 1, red.out);
    assert.match(red.err, /lib\/probe\.js: байт 0x00 на смещении 27 \(строка 2\): NUL делает файл бинарным для git и grep, и поиск по нему молчит — запиши его escape-последовательностью \(\\u0000\)/);
    assert.match(red.err, /bin\/probe\.txt: байт 0x01 на смещении 2 \(строка 1\): невидимый управляющий байт: в редакторе и в выводе его не видно — запиши его escape-последовательностью \(\\u0001\)/);
    assert.doesNotMatch(red.err, /0x01[^\n]*git/, 'про git — только у NUL: прочие байты git бинарными не считает');
    assert.equal(red.err.match(/: байт 0x/g).length, 2, 'копия инструмента других таких байтов не несёт');

    green = toolProject((dir) => {
      put(dir, 'lib/probe.js', 'const a = 1;\n\tconst key = `a\\u0000b`;\n');
      put(dir, 'docs/untracked.md', 'не в индексе \u0001\n');
      run(dir, ['init', '-q']);
      run(dir, ['add', '-A', '--', 'lib', 'bin', 'templates', 'package.json']);
    });
    assert.equal(green.code, 0, green.err);
    assert.doesNotMatch(green.err, /байт 0x|не проверены/);
  } finally {
    if (red) cleanup(red.dir);
    if (green) cleanup(green.dir);
  }
});

test('lint: 14. чужой проект гейт байтов не судит — его docs/** и test/** законно бинарные', () => {
  const root = makeProject();
  try {
    seedGreen(root);
    put(root, 'lib/probe.js', 'const key = `a\u0000b`;\n');
    put(root, 'docs/logo.png', '\u0089PNG\r\n\u001a\n\u0000\u0000');
    gitAll(root);
    assert.deepEqual(problems(root), []);
  } finally {
    cleanup(root);
  }
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
probe('10. a spaced opener is a quote block', (root) => put(root, 'docs/quoting.md', '<!-- quote: reference/README.md -->\n\nnot the text\n\n<!-- /quote -->\n'), /quoting\.md: цитата разошлась с reference\/README\.md: «not the text»/);
probe('10. a spaced quote:before opener still checks the target', (root) => put(root, 'docs/quoting.md', '<!-- quote: before: reference/none.md -->\n\ntext\n\n<!-- /quote -->\n'), /quoting\.md: цитата ведёт на несуществующий файл reference\/none\.md/);
probe('10. a closer with no open block', (root) => put(root, 'docs/quoting.md', `${read(root, 'docs/quoting.md')}\n<!-- /quote -->\n`), /quoting\.md: строка 21: «\/quote» не закрывает ни одного блока цитаты/);
probe('10. a quote marker that does not parse', (root) => put(root, 'docs/quoting.md', '<!-- quote reference/README.md -->\n\ntext\n'), /quoting\.md: строка 1: маркер цитаты не разбирается/);
test('lint: 10. a quote marker inside inline code or mid-prose is prose', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    put(root, 'docs/howto-inline.md', '# Q\n\nClose a block with `<!-- /quote -->`; open it with `<!-- quote:<path> -->`.\n\nWrap it in a “<!-- quote:path --> … <!-- /quote -->” block.\n\n`<!-- quote -->`\n');
    assert.deepEqual(problems(root), []);
  } finally {
    cleanup(root);
  }
});
test('lint: 10. a finding card fresh from new passes the quote gate', () => {
  const root = makeProject();
  try {
    seedGreen(root);
    assert.equal(cli(root, ['new', 'finding', '--parent', '1']).code, 0);
    assert.ok(!problems(root).some((p) => /цитат/.test(p)), problems(root).join(' | '));
  } finally {
    cleanup(root);
  }
});

// BS-19: пять ветвей err(), которые до сих пор можно было вырезать при зелёном npm test.
probe('2. каталог вместо файла задачи в каталоге статуса', (root) => mkdirSync(path.join(root, 'docs/backlog/queue/sub')), /каталог внутри каталога статуса/);
// Каталог, названный как файл задачи: scanTasks читал его как файл и падал EISDIR раньше гейта.
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
test('lint: 5. an archive task directory symlinked inside the project is a task directory', { skip: process.platform === 'win32' }, () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    renameSync(path.join(root, 'docs/archive/BS-4-e'), path.join(root, 'store-BS-4-e'));
    symlinkSync(path.join(root, 'store-BS-4-e'), path.join(root, 'docs/archive/BS-4-e'));
    assert.deepEqual(problems(root), []);
  } finally {
    cleanup(root);
  }
});
probe('5. каталог архива без task.md', (root) => rmSync(path.join(root, 'docs/archive/BS-4-e/task.md')), /нет task\.md — постановки/);
probe('8. ADR есть, а индекса документации нет', (root) => rmSync(path.join(root, 'docs/README.md')), /нет индекса документации, а ADR есть/);

// 13. Журнал закрытых: запись разбирается, якорь равен номеру, ссылка на якорь ведёт на запись —
// у каждого своя проба; достижимость ревизии из HEAD проверяют тесты ниже.
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
    assert.ok(warnings(root).some((w) => /LOG\.md: достижимость ревизий журнала из HEAD не проверена/.test(w)), warnings(root).join(' | '));
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

test('lint: 13. the journal anchor is checked behind ?query and a %-escape; a malformed escape does not throw', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    seedLog(root);
    put(root, 'docs/ROADMAP.md', '# Roadmap\n\n[BS-5](archive/LOG.md?plain=1#bs-5) [q](archive/LOG.md?plain=1#bs-99) [e](archive/LOG%2Emd#bs-9) [m](a%E0%A4%A.md#bs-5)\n');
    assert.deepEqual(problems(root), [
      'docs/ROADMAP.md: битая ссылка a%E0%A4%A.md#bs-5',
      'docs/ROADMAP.md: ссылка archive/LOG.md?plain=1#bs-99 ведёт на строку журнала, которой нет — якорь «bs-99» ни за одной записью',
      'docs/ROADMAP.md: ссылка archive/LOG%2Emd#bs-9 ведёт на строку журнала, которой нет — якорь «bs-9» ни за одной записью',
    ]);
  } finally {
    cleanup(root);
  }
});

// Закрытая задача, закоммиченная между `archive N` и `fold N`:
// этот коммит и становится ревизией строки журнала.
function foldCommitted(root) {
  put(root, 'docs/archive/BS-5-folded/task.md', '# BS-5 · Свёрнутая\n\n- **Область:** [x](../../reference/README.md)\n');
  put(root, 'docs/archive/BS-5-folded/result.md', '# BS-5 · Результат\n\n**Закрыта 2026-08-02.** Выполнена.\n');
  gitAll(root, 'BS-5: приёмка до свёртки');
  const r = cli(root, ['fold', '5']);
  assert.equal(r.code, 0, r.err);
  assert.match(read(root, 'docs/archive/LOG.md'), /· `[0-9a-f]{10}` · Свёрнутая/, 'строка называет ревизию');
  return r.out;
}

test('lint: 13. ревизия строки журнала не достижима из HEAD — squash выбросил коммит между archive и fold', () => {
  const root = makeProject();
  try {
    seedGreen(root);
    gitAll(root, 'база');
    const base = run(root, ['rev-parse', 'HEAD']).stdout.trim();
    const draft = foldCommitted(root);
    assert.deepEqual(problems(root), [], 'до squash ревизия строки лежит в истории HEAD');
    run(root, ['add', '-A']);
    run(root, ['reset', '-q', '--soft', base]);
    run(root, ['commit', '-q', '-m', draft]);
    const line = read(root, 'docs/archive/LOG.md').split('\n').findIndex((l) => l.startsWith('- <a id="bs-5">')) + 1;
    const found = problems(root);
    assert.ok(found.some((p) => new RegExp(`LOG\\.md: строка ${line}: ревизия [0-9a-f]{10} не достижима из HEAD`).test(p)), found.join(' | ') || 'ничего');
  } finally {
    cleanup(root);
  }
});

test('lint: 13. неполный клон — достижимость ревизий журнала не проверяется, предупреждение вместо ошибки', () => {
  const root = makeProject();
  const clone = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-shallow-')));
  try {
    seedGreen(root);
    gitAll(root, 'база');
    foldCommitted(root);
    gitAll(root, 'BS-5: закрыта');
    run(root, ['clone', '-q', '--depth', '1', `file://${root}`, clone]);
    assert.deepEqual(problems(clone).filter((p) => p.startsWith('docs/archive/LOG.md')), [], 'ревизии в неполном клоне нет, и это не довод против строки');
    assert.ok(warnings(clone).some((w) => /LOG\.md: достижимость ревизий журнала из HEAD не проверена: клон неполный/.test(w)), warnings(clone).join(' | '));
  } finally {
    cleanup(root);
    cleanup(clone);
  }
});

test('lint: 13. git rev-list, оборванный сигналом, — предупреждение называет сигнал, а не «git null»', { skip: process.platform === 'win32' }, () => {
  const root = makeProject();
  const shim = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-git-shim-')));
  try {
    seedGreen(root);
    gitAll(root, 'база');
    foldCommitted(root);
    const real = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
    writeFileSync(path.join(shim, 'git'), `#!/bin/sh\nfor a in "$@"; do [ "$a" = rev-list ] && kill -9 $$; done\nexec "${real}" "$@"\n`, { mode: 0o755 });

    const r = cli(root, ['lint'], { env: { PATH: `${shim}${path.delimiter}${process.env.PATH}` } });
    assert.equal(r.code, 0, `предупреждение гейт не красит: ${r.err}`);
    assert.match(r.err, /LOG\.md: достижимость ревизий журнала из HEAD не проверена: оборван сигналом SIGKILL$/m);
    assert.doesNotMatch(r.err, /git null/);
  } finally {
    cleanup(root);
    rmSync(shim, { recursive: true, force: true });
  }
});

test('lint: 13. многострочный stderr git rev-list — предупреждение несёт только первую строку', { skip: process.platform === 'win32' }, () => {
  const root = makeProject();
  const shim = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-git-shim-')));
  try {
    seedGreen(root);
    gitAll(root, 'база');
    foldCommitted(root);
    const real = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
    writeFileSync(path.join(shim, 'git'), `#!/bin/sh\nfor a in "$@"; do [ "$a" = rev-list ] && { printf 'fatal: первая\\nвторая\\n' >&2; exit 128; }; done\nexec "${real}" "$@"\n`, { mode: 0o755 });

    const r = cli(root, ['lint'], { env: { PATH: `${shim}${path.delimiter}${process.env.PATH}` } });
    assert.equal(r.code, 0, `предупреждение гейт не красит: ${r.err}`);
    assert.match(r.err, /LOG\.md: достижимость ревизий журнала из HEAD не проверена: fatal: первая$/m);
    assert.doesNotMatch(r.err, /вторая/);
  } finally {
    cleanup(root);
    rmSync(shim, { recursive: true, force: true });
  }
});

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

test('lint: a layout directory that is a file is a gate error naming the path, not a stack', () => {
  for (const rel of ['docs/backlog/queue', 'docs/adr', 'docs/archive/BS-4-e/minor', 'docs/archive']) {
    const root = makeProject({ git: false });
    try {
      seedGreen(root);
      rmSync(path.join(root, ...rel.split('/')), { recursive: true, force: true });
      put(root, rel, 'x\n');
      const r = cli(root, ['lint']);
      assert.equal(r.code, 1, `${rel}: ${r.out}`);
      assert.ok(r.err.split('\n').includes(`✖ ${rel}: файл, а нужен каталог`), `${rel}: ${r.err}`);
      assert.doesNotMatch(r.err, /ENOTDIR|node:fs|\n\s+at /, `${rel}: a stack`);
    } finally {
      cleanup(root);
    }
  }
});

test('lint: a stale pin in a gate command or probe is an error naming gates[i]', () => {
  const root = makeProject({ git: false });
  const V = TOOL_VERSION;
  try {
    seedGreen(root);
    const setConfig = (patch) => put(root, 'backslop.json', `${JSON.stringify({ ...JSON.parse(read(root, 'backslop.json')), ...patch }, null, 2)}\n`);
    const now = `npx github:me/proj#v${V}`;
    setConfig({ cli: now, version: V, lang: 'en', gates: [`${now} lint`, { command: `cd . && ${now} lint && npx github:me/proj#v0.1.0 gates`, when: ['docs/**'] }] });
    assert.ok(problems(root).includes(`backslop.json: gates[1]: pin github:me/proj#v0.1.0 differs from cli — expected github:me/proj#v${V}; ${now} upgrade rewrites it`), problems(root).join(' | '));
    const r = cli(root, ['lint']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, /backslop\.json: gates\[1\]: pin/);

    setConfig({ gates: [`${now} lint`], probe: 'npx github:me/proj#v0.1.0 status' });
    assert.ok(problems(root).some((p) => p.startsWith('backslop.json: probe: pin github:me/proj#v0.1.0 differs from cli')), problems(root).join(' | '));
    setConfig({ probe: `${now} status` });
    assert.deepEqual(problems(root), []);
  } finally {
    cleanup(root);
  }
});

test('lint: a stale pin with a .git suffix or without v in gates[i] or probe is an error too', () => {
  const root = makeProject({ git: false });
  const V = TOOL_VERSION;
  try {
    seedGreen(root);
    const setConfig = (patch) => put(root, 'backslop.json', `${JSON.stringify({ ...JSON.parse(read(root, 'backslop.json')), ...patch }, null, 2)}\n`);
    const now = `npx github:me/proj#v${V}`;
    setConfig({ cli: now, version: V, lang: 'en', gates: ['npx github:me/proj.git#v0.1.0 lint'], probe: 'npx github:me/proj#0.1.0 status' });
    const found = problems(root);
    assert.ok(found.includes(`backslop.json: gates[0]: pin github:me/proj.git#v0.1.0 differs from cli — expected github:me/proj#v${V}; ${now} upgrade rewrites it`), found.join(' | '));
    assert.ok(found.some((p) => p.startsWith('backslop.json: probe: pin github:me/proj#0.1.0 differs from cli')), found.join(' | '));
  } finally {
    cleanup(root);
  }
});

test('lint: a stale pin in a file upgrade skips names a hand edit as the remedy', { skip: process.platform === 'win32' }, () => {
  const root = makeProject({ git: false });
  const shared = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-shared-')));
  try {
    seedGreen(root);
    const now = `npx github:me/proj#v${TOOL_VERSION}`;
    put(root, 'backslop.json', `${JSON.stringify({ ...JSON.parse(read(root, 'backslop.json')), cli: now, lang: 'en' }, null, 2)}\n`);
    writeFileSync(path.join(shared, 'package.json'), '{"scripts":{"l":"npx github:me/proj#v0.1.0 lint"}}\n');
    symlinkSync(shared, path.join(root, 'vendor'));
    writeFileSync(path.join(root, 'docs', 'NOTES.md'), Buffer.concat([Buffer.from([0xC7, 0xE0, 0xEC]), Buffer.from(': `npx github:me/proj#v0.1.0 lint`\n')]));
    put(root, 'docs/reference/README.md', `${read(root, 'docs/reference/README.md')}\nRun \`npx github:me/proj#v0.1.0 status\`.\n`);
    put(root, 'misc/notes.md', 'Run `npx github:me/proj#v0.1.0 status`.\n');
    symlinkSync(path.join(root, 'misc', 'notes.md'), path.join(root, 'NOTES.md'));
    const found = problems(root);
    assert.ok(found.some((p) => p.startsWith('NOTES.md: line 1:') && p.endsWith('upgrade does not rewrite it (the path goes through the symlink NOTES.md) — edit it by hand')), found.join(' | '));
    assert.ok(found.some((p) => p.startsWith('vendor/package.json: line 1: pin github:me/proj#v0.1.0 differs from cli') && p.endsWith('upgrade does not rewrite it (the path goes through the symlink vendor) — edit it by hand')), found.join(' | '));
    assert.ok(found.some((p) => p.startsWith('docs/NOTES.md: line 1:') && p.endsWith('upgrade does not rewrite it (the file is not UTF-8) — edit it by hand')), found.join(' | '));
    assert.ok(found.some((p) => p.startsWith('docs/reference/README.md:') && p.endsWith(`${now} upgrade rewrites it`)), found.join(' | '));
  } finally {
    cleanup(root);
    rmSync(shared, { recursive: true, force: true });
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

test('lint: a pin in a journal entry is a record of its moment, the LOG.md header stays live', () => {
  const root = makeProject({ git: false });
  const V = TOOL_VERSION;
  const old = 'npx github:me/proj#v0.1.0';
  const now = `npx github:me/proj#v${V}`;
  try {
    seedGreen(root);
    put(root, 'backslop.json', `${JSON.stringify({ ...JSON.parse(read(root, 'backslop.json')), cli: now, version: V }, null, 2)}\n`);
    const entry = `- <a id="bs-6"></a>\`BS-6-y\` · 2026-09-01 · completed · — · Measured with \`${old} lint\``;
    put(root, 'docs/archive/LOG.md', `# Log\n\nBodies: \`${now} show N\`.\n\n${entry}\n`);
    assert.deepEqual(problems(root), []);
    assert.deepEqual(rewriteProsePins(root, 'docs', 'BS', parseCli(now), V), []);

    put(root, 'docs/archive/LOG.md', `# Log\n\nBodies: \`${old} show N\`.\n\n${entry}\n`);
    assert.equal(problems(root).length, 1, problems(root).join(' | '));
    assert.match(problems(root)[0], /^docs\/archive\/LOG\.md: строка 3: пин github:me\/proj#v0\.1\.0 расходится с cli/);
    assert.deepEqual(rewriteProsePins(root, 'docs', 'BS', parseCli(now), V), ['docs/archive/LOG.md']);
    assert.equal(read(root, 'docs/archive/LOG.md'), `# Log\n\nBodies: \`${now} show N\`.\n\n${entry}\n`);
    assert.deepEqual(problems(root), []);
  } finally {
    cleanup(root);
  }
});

test('lint: a prose pin in the other forms parseCli accepts, .git suffix or no v, is checked too', () => {
  const root = makeProject({ git: false });
  const V = TOOL_VERSION;
  try {
    seedGreen(root);
    put(root, 'backslop.json', `${JSON.stringify({ ...JSON.parse(read(root, 'backslop.json')), cli: `npx github:me/proj#v${V}`, version: V }, null, 2)}\n`);
    put(root, 'docs/ROADMAP.md', 'Run `npx github:me/proj.git#v0.1.0 lint` or `npx github:me/proj#0.1.0 lint`.\n');
    const found = problems(root);
    assert.ok(found.some((p) => p.includes('docs/ROADMAP.md: строка 1: пин github:me/proj.git#v0.1.0 расходится с cli')), found.join(' | '));
    assert.ok(found.some((p) => p.includes('docs/ROADMAP.md: строка 1: пин github:me/proj#0.1.0 расходится с cli')), found.join(' | '));
    put(root, 'docs/ROADMAP.md', `Run \`npx github:me/proj.git#v${V} lint\` or \`npx github:me/proj#${V} lint\`.\n`);
    assert.deepEqual(problems(root), [], 'the current version in another form is no drift');
  } finally {
    cleanup(root);
  }
});

test('lint: an upper-case CHANGELOG.MD or card file stays a record of its moment for the pin gate and upgrade', () => {
  const root = makeProject({ git: false });
  const V = TOOL_VERSION;
  const old = 'npx github:me/proj#v0.1.0';
  try {
    seedGreen(root);
    put(root, 'backslop.json', `${JSON.stringify({ ...JSON.parse(read(root, 'backslop.json')), cli: `npx github:me/proj#v${V}`, version: V }, null, 2)}\n`);
    rmSync(path.join(root, 'CHANGELOG.md'));
    const changelog = `## Unreleased\n\n- **Old** — ran \`${old}\`\n`;
    put(root, 'CHANGELOG.MD', changelog);
    put(root, 'docs/notes/BS-7-x.MD', `Measured on \`${old}\`.\n`);
    // A lower-case prefix is no card, so the file stays live; its own name avoids an APFS clash.
    put(root, 'docs/notes/bs-8-y.md', `Run \`${old} lint\`.\n`);
    const live = livePinFiles(root, 'docs', 'BS').map(([rel]) => rel);
    assert.ok(!live.includes('CHANGELOG.MD') && !live.includes('docs/notes/BS-7-x.MD'), live.join(' '));
    assert.ok(live.includes('docs/notes/bs-8-y.md'), live.join(' '));
    assert.equal(problems(root).length, 1, problems(root).join(' | '));
    assert.match(problems(root)[0], /^docs\/notes\/bs-8-y\.md: строка 1: пин github:me\/proj#v0\.1\.0 расходится с cli/);
    assert.deepEqual(rewriteProsePins(root, 'docs', 'BS', parseCli(`npx github:me/proj#v${V}`), `v${V}`), ['docs/notes/bs-8-y.md']);
    assert.equal(read(root, 'CHANGELOG.MD'), changelog);
    assert.equal(read(root, 'docs/notes/BS-7-x.MD'), `Measured on \`${old}\`.\n`);
  } finally {
    cleanup(root);
  }
});
