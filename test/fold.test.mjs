// Свёртка в строку журнала настоящим процессом: каталог уходит, тело — в заготовку, ссылки — на
// якорь строки. Проверяется и гибрид — свёрнутые записи рядом с несвёрнутыми каталогами.
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanup, cli, gitAll, makeProject, put, read, resultTemplateParagraphs, run } from './helpers.mjs';
import { TOOL_VERSION } from '../lib/version.js';
import { git, gitCause, today } from '../lib/util.js';

// Закрытая задача в архиве: каталог с постановкой и дописанным результатом, ссылка соседа на неё.
function closed(root, { id = 'BS-1', slug = 'alpha', title = 'Альфа', date = '2026-09-03', outcome = 'Выполнена.' } = {}) {
  put(root, `docs/archive/${id}-${slug}/task.md`, `# ${id} · ${title}\n\n- **Область:** [x](../../reference/README.md)\n\n## Контекст\n\nтекст постановки\n`);
  put(root, `docs/archive/${id}-${slug}/result.md`, `# ${id} · Результат\n\n**Закрыта ${date}.** ${outcome} Итог одной строкой.\n`);
}

function logLines(root) {
  return read(root, 'docs/archive/LOG.md').split('\n').filter((l) => l.startsWith('- <a id='));
}

test('fold N: каталог уходит, строка журнала на месте, ссылка соседа ведёт на якорь', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Справочник\n');
    closed(root);
    put(root, 'docs/ROADMAP.md', '# Roadmap\n\nСм. [BS-1](archive/BS-1-alpha/task.md#контекст) и [итог](archive/BS-1-alpha/result.md).\n');
    put(root, 'README.md', 'Корень: [BS-1](docs/archive/BS-1-alpha/task.md)\n');
    gitAll(root);

    const r = cli(root, ['fold', '1']);
    assert.equal(r.code, 0, r.err);
    assert.ok(!existsSync(path.join(root, 'docs/archive/BS-1-alpha')), 'каталога задачи нет');

    assert.equal(logLines(root).length, 1);
    assert.match(logLines(root)[0], /^- <a id="bs-1"><\/a>`BS-1-alpha` · 2026-09-03 · выполнена · `[0-9a-f]{10}` · Альфа$/);

    // Якорь исчезнувшего файла заменяется целиком: `#контекст` на строке журнала не значит ничего.
    assert.match(read(root, 'docs/ROADMAP.md'), /\[BS-1\]\(archive\/LOG\.md#bs-1\)/);
    assert.match(read(root, 'docs/ROADMAP.md'), /\[итог\]\(archive\/LOG\.md#bs-1\)/);
    assert.match(read(root, 'README.md'), /\(docs\/archive\/LOG\.md#bs-1\)/);

    // Заготовка — в stdout целиком, диагностика — в stderr: `fold N | git commit -F -` должен
    // получить сообщение без строк отчёта.
    assert.match(r.out, /^BS-1: Альфа\n/);
    assert.match(r.out, /--- docs\/archive\/BS-1-alpha\/task\.md ---/);
    assert.match(r.out, /--- docs\/archive\/BS-1-alpha\/result\.md ---/);
    assert.match(r.out, /текст постановки/);
    assert.match(r.out, /Итог одной строкой/);
    assert.doesNotMatch(r.out, /свёрнуто задач/);
    assert.match(r.err, /свёрнуто задач 1/);
  } finally {
    cleanup(root);
  }
});

test('fold N: корневая ссылка и каталог со слэшем ведут на якорь, ссылка мимо тела названа в итоге', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Справочник\n');
    closed(root);
    put(root, 'docs/archive/BS-1-alpha/notes.md', '# Заметки\n');
    put(root, 'docs/ROADMAP.md', '# Roadmap\n\nКорень: [BS-1](/docs/archive/BS-1-alpha/task.md#контекст), каталог: [альфа](archive/BS-1-alpha/), заметки: [n](archive/BS-1-alpha/notes.md).\n');
    gitAll(root);

    const r = cli(root, ['fold', '1']);
    assert.equal(r.code, 0, r.err);
    const roadmap = read(root, 'docs/ROADMAP.md');
    assert.match(roadmap, /\[BS-1\]\(\/docs\/archive\/LOG\.md#bs-1\)/, 'корневая ссылка осталась корневой');
    assert.match(roadmap, /\[альфа\]\(archive\/LOG\.md#bs-1\)/);
    assert.match(r.err, /файлов с поправленными ссылками 1, ссылок в свёрнутое без переписи 1\n/);
    assert.match(r.err, /мимо task\.md, result\.md и записей пачки/);
    assert.match(r.err, / {2}docs\/ROADMAP\.md: archive\/BS-1-alpha\/notes\.md\n/);

    // Названная ссылка — единственная битая: гейт 1 видит её, переписанные — нет.
    const lint = cli(root, ['lint']);
    assert.match(lint.err, /битая ссылка archive\/BS-1-alpha\/notes\.md/);
    assert.doesNotMatch(lint.err, /битая ссылка \/docs\/archive\/BS-1-alpha|битая ссылка archive\/BS-1-alpha\/[\s)]/);
  } finally {
    cleanup(root);
  }
});

test('fold N: тело с ревизией — заготовка не обязательна, show N достаёт тело; без ревизии — обязательна', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Справочник\n');
    closed(root);
    gitAll(root);
    const kept = cli(root, ['fold', '1']);
    assert.equal(kept.code, 0, kept.err);
    assert.match(logLines(root)[0], / · `[0-9a-f]{10}` · Альфа$/, 'фикстура даёт именно строку с ревизией');
    assert.match(kept.err, /коммитить её не обязательно: тело уже в истории/);
    assert.match(kept.err, / show BS-1 достаёт его оттуда/);
    assert.doesNotMatch(kept.err, /закоммить свёртку вместе с ней/);
    // Вступление заготовки говорит то же, что stderr: при ревизии заготовка — копия.
    assert.match(kept.out, /^Свёрнута в строку docs\/archive\/LOG\.md#bs-1\. Тело задачи — ниже, копией: строка журнала называет ревизию [0-9a-f]{10}, и .+ show BS-1 достаёт его оттуда\.$/m);
    assert.doesNotMatch(kept.out, /единственное хранилище/);
    // Замер карточки: свёртка закоммичена без заготовки, и тело всё равно достаётся.
    gitAll(root, 'свёртка без заготовки');
    const shown = cli(root, ['show', '1']);
    assert.equal(shown.code, 0, shown.err);
    assert.match(shown.out, /текст постановки/);
    assert.match(shown.out, /Итог одной строкой/);

    // Ход приёмки: archive N и result.md без коммита — ревизии нет, заготовка единственное хранилище.
    put(root, 'docs/backlog/active/BS-2-beta.md', '# BS-2 · Бета\n\n- **Область:** [x](../../reference/README.md)\n- **Взята:** 2026-09-01\n\n## Контекст\n\nтекст беты\n');
    gitAll(root, 'заведена бета');
    assert.equal(cli(root, ['archive', '2']).code, 0);
    put(root, 'docs/archive/BS-2-beta/result.md', '# BS-2 · Результат\n\n**Закрыта 2026-09-04.** Выполнена. Итог беты.\n');
    const draftOnly = cli(root, ['fold', '2']);
    assert.equal(draftOnly.code, 0, draftOnly.err);
    assert.match(logLines(root)[1], / · — · Бета$/, 'фикстура даёт именно строку без ревизии');
    assert.match(draftOnly.err, /заготовка сообщения коммита — в stdout: закоммить свёртку вместе с ней, иначе тело задачи потеряется/);
    assert.doesNotMatch(draftOnly.err, /не обязательно/);
    assert.match(draftOnly.out, /^Свёрнута в строку docs\/archive\/LOG\.md#bs-2\. Тело задачи — ниже: в дереве его больше нет, и это сообщение — его единственное хранилище\.$/m);
  } finally {
    cleanup(root);
  }
});

test('fold N: отказы — пустой result.md, заглушка в нём, задача не в архиве, уже свёрнутая', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Справочник\n');
    closed(root);
    put(root, 'docs/backlog/queue/BS-2-live.md', '# BS-2 · Живая\n\n- **Порядок:** 10\n');
    gitAll(root);

    put(root, 'docs/archive/BS-1-alpha/result.md', '');
    let r = cli(root, ['fold', '1']);
    assert.equal(r.code, 1);
    assert.match(r.err, /result\.md пуст/);

    put(root, 'docs/archive/BS-1-alpha/result.md', '# BS-1 · Результат\n\n**Закрыта 2026-09-03.** [TODO: исход]\n');
    r = cli(root, ['fold', '1']);
    assert.equal(r.code, 1);
    assert.match(r.err, /остался заглушкой/);
    assert.ok(existsSync(path.join(root, 'docs/archive/BS-1-alpha')), 'отказ не трогает каталог');
    assert.ok(!existsSync(path.join(root, 'docs/archive/LOG.md')), 'отказ не заводит журнал');

    r = cli(root, ['fold', '2']);
    assert.equal(r.code, 1);
    assert.match(r.err, /лежит в queue\/ — сворачивается закрытая задача/);

    r = cli(root, ['fold', '42']);
    assert.equal(r.code, 1);
    assert.match(r.err, /нет ни в одном каталоге статуса и в архиве/);

    closed(root);
    assert.equal(cli(root, ['fold', '1']).code, 0);
    r = cli(root, ['fold', '1']);
    assert.equal(r.code, 1);
    assert.match(r.err, /уже свёрнута в журнал/);
  } finally {
    cleanup(root);
  }
});

test('fold N: result.md без слова исхода — отказ до записи тем же текстом, что гейт 5; массовая форма читает голое «Закрыта»', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Справочник\n');
    put(root, 'docs/backlog/active/BS-1-alpha.md', '# BS-1 · Альфа\n\n- **Область:** [x](../../reference/README.md)\n- **Взята:** 2026-09-01\n\n## Контекст\n\nтекст постановки\n');
    gitAll(root, 'заведена альфа');
    assert.equal(cli(root, ['archive', '1']).code, 0);
    put(root, 'docs/archive/BS-1-alpha/result.md', '# BS-1 · Результат\n\n**Закрыта 2026-09-24.** Отказ: беспредметна.\n');
    const r = cli(root, ['fold', '1']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, /docs\/archive\/BS-1-alpha\/result\.md не называет исход словом словаря — выполнена, отклонена, снята с плана или слита в BS-N — ни в первом абзаце, ни в заголовке/);
    assert.equal(r.out, '', 'заготовки нет');
    assert.ok(existsSync(path.join(root, 'docs/archive/BS-1-alpha/task.md')), 'каталог на месте');
    assert.ok(!existsSync(path.join(root, 'docs/archive/LOG.md')), 'строки в журнале нет');
    const lint = cli(root, ['lint']);
    assert.match(lint.err, /docs\/archive\/BS-1-alpha: result\.md не называет исход словом словаря/, 'гейт 5 говорит то же');

    // Старую запись массовая свёртка по-прежнему читает фолбэком (ADR-037).
    gitAll(root, 'закрытие альфы');
    const bulk = cli(root, ['fold']);
    assert.equal(bulk.code, 0, bulk.err);
    assert.match(logLines(root)[0], /^- <a id="bs-1"><\/a>`BS-1-alpha` · 2026-09-24 · выполнена · /);
  } finally {
    cleanup(root);
  }
});

test('fold N: заглушка шаблона result.md отказывает абзацем, показанная в коде — нет', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Справочник\n');
    closed(root);
    gitAll(root);
    for (const lang of ['ru', 'en']) {
      for (const p of resultTemplateParagraphs(lang, { id: 'BS-1', date: '2026-09-03' })) {
        put(root, 'docs/archive/BS-1-alpha/result.md', `# BS-1 · Результат\n\n${p}\n`);
        const r = cli(root, ['fold', '1']);
        assert.equal(r.code, 1, `${lang}: ${p}`);
        assert.match(r.err, /остался заглушкой/);
      }
    }
    put(root, 'docs/archive/BS-1-alpha/result.md', '# BS-1 · Результат\n\n**Закрыта 2026-09-03.** Выполнена: `[TODO: исход]` в прозе — рассказ о заглушке.\n');
    const r = cli(root, ['fold', '1']);
    assert.equal(r.code, 0, r.err);
    assert.ok(!existsSync(path.join(root, 'docs/archive/BS-1-alpha')), 'свёрнута');
  } finally {
    cleanup(root);
  }
});

test('fold N: archive N той же задачи после свёртки отказывает, а не заводит второй каталог', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Справочник\n');
    closed(root);
    gitAll(root);
    assert.equal(cli(root, ['fold', '1']).code, 0);
    const r = cli(root, ['archive', '1']);
    assert.equal(r.code, 1);
    assert.match(r.err, /уже свёрнута в журнал/);
  } finally {
    cleanup(root);
  }
});

test('fold: массовая свёртка, --older-than отбирает по дате закрытия, --dry-run ничего не пишет', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Справочник\n');
    closed(root, { id: 'BS-1', slug: 'alpha', title: 'Альфа', date: '2026-01-10' });
    closed(root, { id: 'BS-2', slug: 'beta', title: 'Бета', date: '2026-05-10', outcome: 'Отклонена.' });
    closed(root, { id: 'BS-3', slug: 'gamma', title: 'Гамма', date: '2026-09-10', outcome: 'Слита в BS-1.' });
    gitAll(root);

    const dry = cli(root, ['fold', '--dry-run']);
    assert.equal(dry.code, 0, dry.err);
    assert.match(dry.out, /задач 3/);
    assert.ok(existsSync(path.join(root, 'docs/archive/BS-1-alpha')), '--dry-run каталогов не трогает');
    assert.ok(!existsSync(path.join(root, 'docs/archive/LOG.md')), '--dry-run журнала не заводит');

    const older = cli(root, ['fold', '--older-than', '2026-06-01']);
    assert.equal(older.code, 0, older.err);
    // Тел в заготовке массовой свёртки нет: коммитить её ради тел незачем, они в истории.
    assert.match(older.err.trimEnd().split('\n').at(-1), /^⚠ заготовка сообщения коммита — в stdout, тел задач в ней нет: строка журнала называет ревизию, в которой лежит тело, и .+ show N достаёт его оттуда$/);
    assert.doesNotMatch(older.err, /потеряется|потеряются/);
    assert.ok(!existsSync(path.join(root, 'docs/archive/BS-1-alpha')));
    assert.ok(!existsSync(path.join(root, 'docs/archive/BS-2-beta')));
    assert.ok(existsSync(path.join(root, 'docs/archive/BS-3-gamma')), 'свежая задача остаётся каталогом');

    // Ревизия тела: каталоги закоммичены, значит строка называет коммит, а не длинное тире.
    const lines = logLines(root);
    assert.equal(lines.length, 2);
    assert.match(lines[0], /^- <a id="bs-1"><\/a>`BS-1-alpha` · 2026-01-10 · выполнена · `[0-9a-f]{10}` · Альфа$/);
    assert.match(lines[1], / · отклонена · /);

    // Гибрид: свёрнутые записи и несвёрнутый каталог живут рядом, lint зелёный.
    const lint = cli(root, ['lint']);
    assert.equal(lint.code, 0, lint.err);

    const rest = cli(root, ['fold']);
    assert.equal(rest.code, 0, rest.err);
    assert.match(logLines(root)[2], / · слита в BS-1 · /);

    const empty = cli(root, ['fold']);
    assert.equal(empty.code, 0, empty.err);
    assert.match(empty.out, /сворачивать нечего/);
  } finally {
    cleanup(root);
  }
});

// Коммит с заданной датой: день свёртки и дата ревизии иначе совпали бы, и проверка была бы холостой.
function commitOn(root, date, message) {
  run(root, ['add', '-A']);
  const env = { ...process.env, GIT_AUTHOR_DATE: `${date}T12:00:00`, GIT_COMMITTER_DATE: `${date}T12:00:00` };
  const r = spawnSync('git', ['-C', root, 'commit', '-qm', message], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
}

test('fold: без даты в result.md строка берёт дату коммита ревизии тела, день свёртки — только без ревизии', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Справочник\n');
    put(root, '.gitignore', 'docs/archive/BS-3-gamma/\n');
    for (const [id, slug] of [['BS-1', 'alpha'], ['BS-2', 'beta'], ['BS-3', 'gamma']]) {
      put(root, `docs/archive/${id}-${slug}/task.md`, `# ${id} · ${slug}\n\n## Контекст\n\nтекст\n`);
      put(root, `docs/archive/${id}-${slug}/result.md`, `# ${id} · Результат\n\nВыполнена без даты.\n`);
    }
    commitOn(root, '2026-02-03', 'закрытие');

    const older = cli(root, ['fold', '--older-than', '2026-03-01']);
    assert.equal(older.code, 0, older.err);
    assert.ok(existsSync(path.join(root, 'docs/archive/BS-3-gamma')), 'без ревизии возраст неизвестен — --older-than её не берёт');
    const lines = logLines(root);
    assert.equal(lines.length, 2);
    for (const line of lines) assert.match(line, / · 2026-02-03 · выполнена · `[0-9a-f]{10}` · /);

    const rest = cli(root, ['fold']);
    assert.equal(rest.code, 0, rest.err);
    assert.match(logLines(root)[2], new RegExp(`^- <a id="bs-3"></a>\`BS-3-gamma\` · ${today()} · выполнена · — · `), 'без ревизии — день свёртки');
  } finally {
    cleanup(root);
  }
});

test('fold: массовая свёртка пишет строки по дате закрытия, равные даты — по номеру', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Справочник\n');
    closed(root, { id: 'BS-1', slug: 'alpha', title: 'Альфа', date: '2026-05-10' });
    closed(root, { id: 'BS-2', slug: 'beta', title: 'Бета', date: '2026-01-10' });
    closed(root, { id: 'BS-3', slug: 'gamma', title: 'Гамма', date: '2026-05-10' });
    put(root, 'docs/archive/BS-4-delta/task.md', '# BS-4 · Дельта\n\n## Контекст\n\nтекст\n');
    put(root, 'docs/archive/BS-4-delta/result.md', '# BS-4 · Результат\n\nВыполнена, дата — у коммита.\n');
    commitOn(root, '2026-03-15', 'закрытие');

    const r = cli(root, ['fold']);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(logLines(root).map((l) => l.match(/^- <a id="([^"]+)"><\/a>`[^`]+` · (\S+) ·/).slice(1).join(' ')), [
      'bs-2 2026-01-10', 'bs-4 2026-03-15', 'bs-1 2026-05-10', 'bs-3 2026-05-10',
    ]);
    // Заготовка перечисляет задачи в том же порядке, что журнал.
    const listed = r.out.split('\n').filter((l) => l.startsWith('- docs/archive/')).map((l) => l.split(' ')[1]);
    assert.deepEqual(listed, ['docs/archive/BS-2-beta', 'docs/archive/BS-4-delta', 'docs/archive/BS-1-alpha', 'docs/archive/BS-3-gamma']);
  } finally {
    cleanup(root);
  }
});

test('fold: тело вне истории — по умолчанию уходит с каталогом, с --embed-missing едет в заготовку', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Справочник\n');
    // Тела нет в истории и не будет: каталог под .gitignore, дерево чисто — ради этого флаг и
    // заведён. Незакоммиченный каталог не годится: он отказ, а не выброс.
    put(root, '.gitignore', 'docs/archive/BS-1-alpha/\ndocs/archive/BS-2-beta/\n');
    gitAll(root);
    closed(root, { id: 'BS-1', slug: 'alpha', title: 'Альфа' });
    assert.equal(run(root, ['status', '--porcelain', '--', 'docs/archive/BS-1-alpha']).stdout, '', 'дерево по каталогу чисто');
    assert.equal(run(root, ['log', '-1', '--format=%H', '--', 'docs/archive/BS-1-alpha/task.md']).stdout.trim(), '', 'ревизии с телом нет');

    const dropped = cli(root, ['fold']);
    assert.equal(dropped.code, 0, dropped.err);
    assert.match(dropped.err, /тела нет в истории git — текст уходит вместе с каталогом/);
    assert.match(dropped.err, /--embed-missing/);
    assert.doesNotMatch(dropped.out, /текст постановки/, 'умолчание тело не сохраняет');
    // Выброшенное тело не достать ничем: последняя строка не обещает для него show N.
    assert.match(dropped.err.trimEnd().split('\n').at(-1), /^⚠ заготовка сообщения коммита — в stdout, тел задач в ней нет: у строк с «—» \(задач 1\) тело ушло вместе с каталогом и не сохранено ни в заготовке, ни в истории$/);
    assert.doesNotMatch(dropped.err, /потеряется|потеряются|show N/, 'без --embed-missing тел в заготовке нет, а у выброшенного — и в истории');
    assert.match(logLines(root)[0], / · — · Альфа$/, 'коммита у такой записи нет');

    closed(root, { id: 'BS-2', slug: 'beta', title: 'Бета' });
    const kept = cli(root, ['fold', '--embed-missing']);
    assert.equal(kept.code, 0, kept.err);
    assert.doesNotMatch(kept.err, /текст уходит вместе с каталогом/);
    assert.match(kept.out, /--- docs\/archive\/BS-2-beta\/task\.md ---/);
    assert.match(kept.out, /текст постановки/);
    assert.match(kept.out, /--- docs\/archive\/BS-2-beta\/result\.md ---/);
    assert.match(kept.err, /в ней тела задач, которых нет в истории: закоммить свёртку вместе с ней, иначе эти тела потеряются/);

    const single = cli(root, ['fold', '1', '--embed-missing']);
    assert.equal(single.code, 1);
    assert.match(single.err, /--embed-missing с номером задачи не сочетается/);
  } finally {
    cleanup(root);
  }
});

test('fold: выброшенное тело и тело в истории в одной свёртке — последняя строка называет оба случая', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Справочник\n');
    put(root, '.gitignore', 'docs/archive/BS-1-alpha/\n');
    closed(root, { id: 'BS-2', slug: 'beta', title: 'Бета' });
    gitAll(root);
    closed(root, { id: 'BS-1', slug: 'alpha', title: 'Альфа' });
    const r = cli(root, ['fold']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.err.trimEnd().split('\n').at(-1), /^⚠ заготовка сообщения коммита — в stdout, тел задач в ней нет: у строк с «—» \(задач 1\) тело ушло вместе с каталогом и не сохранено ни в заготовке, ни в истории; у строк с ревизией тело достаёт .+ show N$/);
  } finally {
    cleanup(root);
  }
});

// Пустая ревизия тела приходит по четырём причинам, и умолчание «удалить» владелец выбирал только
// для одной — доказанного отсутствия тела. «Не смогли посмотреть в историю» — не она.
test('fold: массовая свёртка отказывает на незакоммиченном каталоге и вовсе без git, а не удаляет', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Справочник\n');
    gitAll(root);
    // Ход из документации: archive N переехал, approver дописал result.md и не закоммитил.
    put(root, 'docs/backlog/active/BS-1-alpha.md', '# BS-1 · Альфа\n\n- **Область:** [x](../../reference/README.md)\n- **Взята:** 2026-09-01\n\n## Контекст\n\nтекст постановки\n');
    gitAll(root, 'заведена альфа');
    assert.equal(cli(root, ['archive', '1']).code, 0);
    put(root, 'docs/archive/BS-1-alpha/result.md', '# BS-1 · Результат\n\n**Закрыта 2026-09-03.** Выполнена. Итог.\n');

    const dirty = cli(root, ['fold']);
    assert.equal(dirty.code, 1, dirty.out);
    assert.match(dirty.err, /каталог не закоммичен/);
    assert.ok(existsSync(path.join(root, 'docs/archive/BS-1-alpha/result.md')), 'отказ не трогает каталог');
    assert.ok(!existsSync(path.join(root, 'docs/archive/LOG.md')), 'отказ не заводит журнал');
    // Та же задача поодиночке сворачивается: тело уезжает в заготовку сообщения.
    const single = cli(root, ['fold', '1']);
    assert.equal(single.code, 0, single.err);
    assert.match(single.out, /текст постановки/);

    // Проекта без git массовая свёртка не трогает вовсе: тел она не печатает, и страховать
    // удаление нечем.
    const bare = makeProject({ git: false });
    try {
      put(bare, 'docs/reference/README.md', '# Справочник\n');
      closed(bare, { id: 'BS-1', slug: 'alpha', title: 'Альфа' });
      const nogit = cli(bare, ['fold']);
      assert.equal(nogit.code, 1, nogit.out);
      assert.match(nogit.err, /репозитория git нет/);
      assert.ok(existsSync(path.join(bare, 'docs/archive/BS-1-alpha/task.md')), 'каталог на месте');
      // Поодиночке — сворачивается: тело печатается целиком.
      const one = cli(bare, ['fold', '1']);
      assert.equal(one.code, 0, one.err);
      assert.match(one.out, /текст постановки/);
    } finally {
      cleanup(bare);
    }
  } finally {
    cleanup(root);
  }
});

test('fold: ревизия строки — последний коммит, тронувший каталог: show N печатает result.md, дописанный после архивации', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Справочник\n');
    put(root, 'docs/backlog/active/BS-1-alpha.md', '# BS-1 · Альфа\n\n- **Область:** [x](../../reference/README.md)\n- **Взята:** 2026-09-01\n\n## Контекст\n\nтекст постановки\n');
    gitAll(root, 'заведена альфа');
    assert.equal(cli(root, ['archive', '1']).code, 0);
    put(root, 'docs/archive/BS-1-alpha/result.md', '# BS-1 · Результат\n\n**Закрыта 2026-09-03.** Выполнена. Черновик итога.\n');
    gitAll(root, 'архивация альфы');
    put(root, 'docs/archive/BS-1-alpha/result.md', '# BS-1 · Результат\n\n**Закрыта 2026-09-03.** Выполнена. Итог после ревью.\n');
    gitAll(root, 'итог альфы по ревью');
    const reviewed = run(root, ['rev-parse', 'HEAD']).stdout.trim();
    // Результата нет вовсе в коммите, последним тронувшем постановку.
    put(root, 'docs/archive/BS-2-beta/task.md', '# BS-2 · Бета\n\n- **Область:** [x](../../reference/README.md)\n\n## Контекст\n\nпостановка беты\n');
    gitAll(root, 'только постановка беты');
    put(root, 'docs/archive/BS-2-beta/result.md', '# BS-2 · Результат\n\n**Закрыта 2026-09-04.** Выполнена. Итог беты.\n');
    gitAll(root, 'итог беты');
    const late = run(root, ['rev-parse', 'HEAD']).stdout.trim();

    const r = cli(root, ['fold']);
    assert.equal(r.code, 0, r.err);
    const lines = logLines(root);
    assert.match(lines[0], new RegExp(` · \`${reviewed.slice(0, 10)}\` · Альфа$`));
    assert.match(lines[1], new RegExp(` · \`${late.slice(0, 10)}\` · Бета$`));
    gitAll(root, 'свёртка архива');

    const alpha = cli(root, ['show', '1']);
    assert.equal(alpha.code, 0, alpha.err);
    assert.match(alpha.out, /Итог после ревью/);
    assert.doesNotMatch(alpha.out, /Черновик итога/);
    const beta = cli(root, ['show', '2']);
    assert.equal(beta.code, 0, beta.err);
    assert.match(beta.out, /--- docs\/archive\/BS-2-beta\/result\.md ---/);
    assert.match(beta.out, /Итог беты/);
  } finally {
    cleanup(root);
  }
});

// Правка, которую `git status` не видит: чистый по статусу каталог, а на диске — не то, что в ревизии.
test('fold: файл каталога расходится с ревизией при чистом git status — массовая отказывает с именем файла, одиночная уносит тело в заготовку', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Справочник\n');
    closed(root);
    gitAll(root);
    put(root, 'docs/archive/BS-1-alpha/result.md', '# BS-1 · Результат\n\n**Закрыта 2026-09-03.** Выполнена. Правка мимо индекса.\n');
    run(root, ['update-index', '--assume-unchanged', 'docs/archive/BS-1-alpha/result.md']);
    assert.equal(run(root, ['status', '--porcelain']).stdout, '', 'git status правки не видит');

    const bulk = cli(root, ['fold']);
    assert.equal(bulk.code, 1, bulk.out);
    assert.match(bulk.err, /docs\/archive\/BS-1-alpha\/result\.md: файл расходится со своей редакцией в [0-9a-f]{10}/);
    assert.ok(existsSync(path.join(root, 'docs/archive/BS-1-alpha/result.md')), 'отказ не трогает каталог');
    assert.ok(!existsSync(path.join(root, 'docs/archive/LOG.md')), 'отказ не заводит журнал');

    const single = cli(root, ['fold', '1']);
    assert.equal(single.code, 0, single.err);
    assert.match(logLines(root)[0], / · — · Альфа$/, 'ревизия, обещающая другой текст, в строку не идёт');
    assert.match(single.out, /Правка мимо индекса/);
  } finally {
    cleanup(root);
  }
});

test('fold: рабочее дерево с CRLF над LF-блобом (core.autocrlf) — не расхождение, строка получает ревизию', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Справочник\n');
    closed(root);
    gitAll(root);
    run(root, ['config', 'core.autocrlf', 'true']);
    rmSync(path.join(root, 'docs/archive/BS-1-alpha'), { recursive: true, force: true });
    run(root, ['checkout', '--', 'docs/archive/BS-1-alpha']);
    assert.match(read(root, 'docs/archive/BS-1-alpha/result.md'), /\r\n/, 'фикстура даёт CRLF на диске');
    assert.equal(run(root, ['status', '--porcelain']).stdout, '');

    const r = cli(root, ['fold']);
    assert.equal(r.code, 0, r.err);
    assert.match(logLines(root)[0], / · `[0-9a-f]{10}` · Альфа$/);
  } finally {
    cleanup(root);
  }
});

test('fold: незакоммиченный result.md при status.showUntrackedFiles=no — отказ «каталог не закоммичен», а не выброс', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Справочник\n');
    put(root, 'docs/archive/BS-1-alpha/task.md', '# BS-1 · Альфа\n\n- **Область:** [x](../../reference/README.md)\n\n## Контекст\n\nтекст постановки\n');
    gitAll(root);
    run(root, ['config', 'status.showUntrackedFiles', 'no']);
    put(root, 'docs/archive/BS-1-alpha/result.md', '# BS-1 · Результат\n\n**Закрыта 2026-09-03.** Выполнена. Итог вне истории.\n');
    assert.equal(run(root, ['status', '--porcelain']).stdout, '', 'обычный git status новый файл не показывает');

    const r = cli(root, ['fold']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, /каталог не закоммичен/);
    assert.ok(existsSync(path.join(root, 'docs/archive/BS-1-alpha/result.md')), 'отказ не трогает каталог');
  } finally {
    cleanup(root);
  }
});

test('fold: файл каталога не читается git hash-object — отказ называет причину, а не расхождение', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Справочник\n');
    closed(root);
    put(root, 'docs/archive/BS-1-alpha/notes.txt', 'вложение\n');
    gitAll(root);
    run(root, ['update-index', '--assume-unchanged', 'docs/archive/BS-1-alpha/notes.txt']);
    rmSync(path.join(root, 'docs/archive/BS-1-alpha/notes.txt'));
    assert.equal(run(root, ['status', '--porcelain']).stdout, '', 'git status удаления не видит');

    const r = cli(root, ['fold']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, /docs\/archive\/BS-1-alpha: файлы каталога не сверить с ревизией [0-9a-f]{10} — git hash-object: .*notes\.txt/);
    assert.doesNotMatch(r.err, /файл расходится/);
    assert.ok(existsSync(path.join(root, 'docs/archive/BS-1-alpha/result.md')), 'отказ не трогает каталог');
  } finally {
    cleanup(root);
  }
});

test('fold: номера свёрнутых заняты — new и new --parent их не переиспользуют, lint на упоминание молчит', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Справочник\n');
    closed(root, { id: 'BS-7', slug: 'seven', title: 'Семь' });
    gitAll(root);
    assert.equal(cli(root, ['fold', '7']).code, 0);

    const next = cli(root, ['new', 'eight', '--queue']);
    assert.equal(next.code, 0, next.err);
    assert.match(next.out, /BS-8: /);

    const child = cli(root, ['new', 'finding', '--parent', '7']);
    assert.equal(child.code, 0, child.err);
    assert.match(child.out, /BS-7\.1: /);

    put(root, 'docs/ROADMAP.md', '# Roadmap\n\nЗакрыта BS-7, живёт BS-8.\n');
    put(root, 'docs/backlog/queue/BS-8-eight.md', read(root, 'docs/backlog/queue/BS-8-eight.md').replace('[TODO: раздел]', 'Справочник'));
    const lint = cli(root, ['lint']);
    assert.doesNotMatch(lint.err, /упоминает BS-7/);
  } finally {
    cleanup(root);
  }
});

test('fold: пачка уходит вместе со своими minor-записями, счёт архива их не считает', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Справочник\n');
    closed(root, { id: 'BS-1', slug: 'batch', title: 'Пачка' });
    put(root, 'docs/archive/BS-1-batch/minor/BS-1.1-finding.md', '# BS-1.1 · Находка\n\n- **Цена:** minor\n');
    gitAll(root);

    const r = cli(root, ['fold', '1']);
    assert.equal(r.code, 0, r.err);
    const lines = logLines(root);
    assert.equal(lines.length, 2);
    assert.match(lines[1], /^- <a id="bs-1\.1"><\/a>`BS-1\.1-finding` · 2026-09-03 · пачкой BS-1 · /);
    assert.match(r.out, /--- docs\/archive\/BS-1-batch\/minor\/BS-1\.1-finding\.md ---/);

    const status = JSON.parse(cli(root, ['status', '--json']).out);
    assert.equal(status.archive, 1, 'запись пачки закрытой задачей не считается');
    assert.equal(cli(root, ['lint']).code, 0);
  } finally {
    cleanup(root);
  }
});

test('archive N в дереве без каталогов архива: свёрнутый архив не краевой случай', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Справочник\n');
    closed(root);
    gitAll(root);
    assert.equal(cli(root, ['fold', '1']).code, 0);
    gitAll(root, 'свёртка');
    // В docs/archive/ остались только LOG.md и README.md — состояние сразу после свёртки.
    assert.ok(!existsSync(path.join(root, 'docs/archive/BS-1-alpha')));

    put(root, 'docs/backlog/active/BS-2-next.md', '# BS-2 · Следующая\n\n- **Область:** [x](../../reference/README.md)\n- **Взята:** 2026-09-20\n');
    gitAll(root, 'вторая задача');
    const r = cli(root, ['archive', '2']);
    assert.equal(r.code, 0, r.err);
    assert.ok(existsSync(path.join(root, 'docs/archive/BS-2-next/task.md')));
    put(root, 'docs/archive/BS-2-next/result.md', '# BS-2 · Результат\n\n**Закрыта 2026-09-21.** Выполнена. Готово.\n');
    const folded = cli(root, ['fold', '2']);
    assert.equal(folded.code, 0, folded.err);
    assert.equal(logLines(root).length, 2);
    assert.equal(cli(root, ['lint']).code, 0);
  } finally {
    cleanup(root);
  }
});

test('show N: тело файлами из ревизии строки, иначе по заголовку BS-N:, иначе отказ', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Справочник\n');
    // Штатный ход: карточка переезжает `archive N` и коммитится переименованием — в диффе
    // содержимого нет, тело показывает только `git show <rev>:<путь>`.
    put(root, 'docs/backlog/active/BS-1-alpha.md', '# BS-1 · Альфа\n\n- **Область:** [x](../../reference/README.md)\n- **Взята:** 2026-09-01\n\n## Контекст\n\nтекст постановки\n');
    gitAll(root, 'заведена альфа');
    assert.equal(cli(root, ['archive', '1']).code, 0);
    put(root, 'docs/archive/BS-1-alpha/result.md', '# BS-1 · Результат\n\n**Закрыта 2026-09-03.** Выполнена. Итог одной строкой.\n');
    gitAll(root, 'BS-1: закрытие альфы');
    assert.match(run(root, ['show', '--stat', 'HEAD']).stdout, /=> archive\/BS-1-alpha\/task\.md/, 'фикстура даёт именно переезд');
    assert.doesNotMatch(run(root, ['show', 'HEAD']).stdout, /текст постановки/, 'тела в коммите нет — иначе тест зелёный по построению');

    assert.equal(cli(root, ['fold', '1']).code, 0);
    const byRev = cli(root, ['show', '1']);
    assert.equal(byRev.code, 0, byRev.err);
    assert.match(byRev.out, /--- docs\/archive\/BS-1-alpha\/task\.md ---/);
    assert.match(byRev.out, /--- docs\/archive\/BS-1-alpha\/result\.md ---/);
    assert.match(byRev.out, /текст постановки/);
    assert.match(byRev.out, /Итог одной строкой/);
    // Постановка перед результатом: по алфавиту было бы наоборот.
    assert.ok(byRev.out.indexOf('/task.md ---') < byRev.out.indexOf('/result.md ---'));
    assert.match(byRev.err, /BS-1 · 2026-09-03 · выполнена/);

    // Строка без ревизии: тело уехало в сообщение коммита, и коммит ищется по заголовку.
    closed(root, { id: 'BS-2', slug: 'beta', title: 'Бета' });
    assert.equal(cli(root, ['fold', '2']).code, 0);
    assert.match(logLines(root)[1], / · — · Бета$/);
    gitAll(root, 'BS-2: тело беты в сообщении');
    const bySubject = cli(root, ['show', '2']);
    assert.equal(bySubject.code, 0, bySubject.err);
    assert.match(bySubject.out, /BS-2: тело беты в сообщении/);

    // Коммита с таким заголовком нет — отказ словами, а не пустой вывод.
    closed(root, { id: 'BS-3', slug: 'gamma', title: 'Гамма' });
    assert.equal(cli(root, ['fold', '3']).code, 0);
    gitAll(root, 'без номера в заголовке');
    const none = cli(root, ['show', '3']);
    assert.equal(none.code, 1);
    assert.match(none.err, /коммита с заголовком «BS-3: …» в истории нет/);

    put(root, 'docs/backlog/queue/BS-4-live.md', '# BS-4 · Живая\n\n- **Порядок:** 10\n');
    const live = cli(root, ['show', '4']);
    assert.equal(live.code, 1);
    assert.match(live.err, /не свёрнута — её тело лежит в дереве/);
  } finally {
    cleanup(root);
  }
});

test('show N: тело из сообщения коммита печатается без диффа — коммит приёмки больше 1 МиБ не роняет команду', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Справочник\n');
    gitAll(root);
    closed(root, { id: 'BS-2', slug: 'beta', title: 'Бета' });
    const folded = cli(root, ['fold', '2']);
    assert.equal(folded.code, 0, folded.err);
    assert.match(logLines(root)[0], / · — · Бета$/, 'тело едет только в сообщении');
    const draft = path.join(root, '.git', 'BACKSLOP_DRAFT');
    writeFileSync(draft, folded.out);
    put(root, 'docs/bulk.txt', 'строка массовой переписи\n'.repeat(60_000));
    run(root, ['add', '-A']);
    run(root, ['commit', '-q', '-F', draft]);
    assert.ok(Number(run(root, ['cat-file', '-s', 'HEAD:docs/bulk.txt']).stdout) > 1 << 20, 'добавленный файл, а с ним и дифф коммита, больше буфера spawnSync по умолчанию');

    const r = cli(root, ['show', '2']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /^BS-2: Бета$/m);
    assert.match(r.out, /^--- docs\/archive\/BS-2-beta\/task\.md ---$/m);
    assert.match(r.out, /текст постановки/);
    assert.match(r.out, /^--- docs\/archive\/BS-2-beta\/result\.md ---$/m);
    assert.doesNotMatch(r.out, /^diff --git/m, 'печатается сообщение, а не коммит с диффом');
    assert.doesNotMatch(r.out, /массовой переписи/);
    assert.match(r.err, /печатается сообщение коммита/);
  } finally {
    cleanup(root);
  }
});

test('git: вывод больше 1 МиБ читается — потолок буфера задан явно, а не умолчанием spawnSync', () => {
  const root = makeProject();
  try {
    put(root, 'docs/bulk.txt', 'x'.repeat(3 << 20));
    gitAll(root);
    const r = git(root, ['cat-file', 'blob', 'HEAD:docs/bulk.txt']);
    assert.equal(r.error, undefined, r.error?.message);
    assert.equal(r.status, 0);
    assert.equal(r.stdout.length, 3 << 20);
  } finally {
    cleanup(root);
  }
});

test('git: отказ без кода возврата называет причину — ошибку запуска или сигнал, а не «код null»', () => {
  const root = makeProject();
  try {
    put(root, 'docs/bulk.txt', 'x'.repeat(1 << 20));
    gitAll(root);
    const overflow = git(root, ['cat-file', 'blob', 'HEAD:docs/bulk.txt'], { maxBuffer: 1024 });
    assert.equal(overflow.status, null, 'фикстура даёт именно status null');
    assert.match(gitCause(overflow), /ENOBUFS/);
    assert.equal(gitCause({ status: null, signal: 'SIGKILL', stderr: '' }), 'оборван сигналом SIGKILL');
    assert.equal(gitCause({ status: null, signal: 'SIGKILL', stderr: '' }, 'en'), 'killed by SIGKILL');
    assert.equal(gitCause({ status: 128, stderr: 'fatal: bad object\n' }), 'fatal: bad object');
    assert.equal(gitCause({ status: 1, stderr: '' }, 'en'), 'exit code 1');
  } finally {
    cleanup(root);
  }
});

test('show N: git, оборванный на чтении сообщения, — отказ называет сигнал, а не «код null»', () => {
  const root = makeProject();
  const shim = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-git-shim-')));
  try {
    put(root, 'docs/reference/README.md', '# Справочник\n');
    gitAll(root);
    closed(root, { id: 'BS-2', slug: 'beta', title: 'Бета' });
    assert.equal(cli(root, ['fold', '2']).code, 0);
    gitAll(root, 'BS-2: тело беты в сообщении');
    const real = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
    writeFileSync(path.join(shim, 'git'), `#!/bin/sh\nfor a in "$@"; do [ "$a" = "--format=%B" ] && kill -9 $$; done\nexec "${real}" "$@"\n`, { mode: 0o755 });

    const r = cli(root, ['show', '2'], { env: { PATH: `${shim}${path.delimiter}${process.env.PATH}` } });
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, /git show [0-9a-f]+: оборван сигналом SIGKILL — коммит из строки/);
    assert.doesNotMatch(r.err, /код null/);
  } finally {
    cleanup(root);
    rmSync(shim, { recursive: true, force: true });
  }
});

// Проект в подкаталоге репозитория: `ls-tree` без `--full-name` даёт пути от текущего каталога,
// а `<rev>:<путь>` без `./` — от корня git; совпадают эти системы только в корневой раскладке.
test('show N: проект в подкаталоге репозитория — тело читается, а не объявляется отсутствующим', () => {
  const top = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-nested-show-')));
  try {
    run(top, ['init', '-q', '-b', 'main']);
    run(top, ['config', 'user.email', 'test@example.com']);
    run(top, ['config', 'user.name', 'test']);
    run(top, ['config', 'commit.gpgsign', 'false']);
    run(top, ['config', 'status.renames', 'true']);
    const root = path.join(top, 'sub');
    put(root, 'backslop.json', `${JSON.stringify({ prefix: 'BS', docs: 'docs', gates: [], version: TOOL_VERSION }, null, 2)}\n`);
    for (const dir of ['triage', 'queue', 'active', 'deferred', 'minor']) put(root, `docs/backlog/${dir}/.gitkeep`, '');
    put(root, 'docs/archive/README.md', '# Архив\n');
    put(root, 'docs/reference/README.md', '# Справочник\n');
    put(root, 'docs/backlog/active/BS-1-alpha.md', '# BS-1 · Альфа\n\n- **Область:** [x](../../reference/README.md)\n- **Взята:** 2026-09-01\n\n## Контекст\n\nтекст постановки\n');
    gitAll(top, 'заведена альфа');
    assert.equal(cli(root, ['archive', '1']).code, 0);
    put(root, 'docs/archive/BS-1-alpha/result.md', '# BS-1 · Результат\n\n**Закрыта 2026-09-03.** Выполнена. Итог одной строкой.\n');
    // Заголовок коммита намеренно БЕЗ номера задачи: иначе откат на печать коммита целиком
    // прошёл бы через поиск по заголовку и спрятал бы дефект чтения по пути.
    gitAll(top, 'закрытие альфы');
    assert.equal(cli(root, ['fold', '1']).code, 0);
    gitAll(top, 'свёртка альфы');

    const r = cli(root, ['show', '1']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /--- docs\/archive\/BS-1-alpha\/task\.md ---/);
    assert.match(r.out, /текст постановки/);
    assert.match(r.out, /Итог одной строкой/);
    assert.doesNotMatch(r.err, /тела файлом в .* нет/, 'тело в ревизии есть — объяснять его отсутствие нечем');
  } finally {
    rmSync(top, { recursive: true, force: true });
  }
});

test('migrate: заводит журнал и не удаляет ни одного каталога архива', () => {
  const root = makeProject({ stamp: false });
  try {
    put(root, 'docs/reference/README.md', '# Справочник\n');
    closed(root);
    gitAll(root);
    const r = cli(root, ['migrate']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /журнал закрытых/);
    assert.ok(existsSync(path.join(root, 'docs/archive/LOG.md')));
    assert.ok(existsSync(path.join(root, 'docs/archive/BS-1-alpha/task.md')), 'апгрейд накопленное не сносит');
    assert.equal(logLines(root).length, 0, 'новый журнал пуст');
  } finally {
    cleanup(root);
  }
});

// Номер свёрнутой задачи не виден по именам файлов вовсе: он стоит строкой внутри журнала.
// Без чтения содержимого worker в своём worktree выдал бы номер, уже закрытый на соседней ветке.
test('fold: номера свёрнутых задач чужого worktree и чужой ветки заняты', () => {
  const root = makeProject();
  const wt = path.join(mkdtempSync(path.join(os.tmpdir(), 'backslop-wt-')), 'worker');
  const git = (...args) => run(root, args);
  try {
    put(root, 'docs/reference/README.md', '# Справочник\n');
    closed(root, { id: 'BS-1', slug: 'alpha', title: 'Альфа' });
    gitAll(root);
    git('worktree', 'add', '-q', wt, '-b', 'worker');
    // Свёртка идёт в чужом worktree и ещё не закоммичена — номер считается по диску.
    assert.equal(cli(wt, ['fold', '1'], { cwd: wt }).code, 0);
    let r = cli(root, ['new', 'b']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /BS-2: /);

    // Worktree убран, ветка со свёрнутой BS-2 осталась — номер считается по дереву ветки.
    run(wt, ['add', '-A']);
    run(wt, ['commit', '-qm', 'worker: свёртка и вторая задача']);
    closed(wt, { id: 'BS-5', slug: 'five', title: 'Пять' });
    assert.equal(cli(wt, ['fold', '5'], { cwd: wt }).code, 0);
    run(wt, ['add', '-A']);
    run(wt, ['commit', '-qm', 'worker: пятая']);
    git('worktree', 'remove', '--force', wt);
    r = cli(root, ['new', 'c']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /BS-6: /, 'BS-5 занят строкой журнала на ветке worker');
    assert.match(r.out, /BS-5 занят: ветка worker/);
  } finally {
    rmSync(path.dirname(wt), { recursive: true, force: true });
    cleanup(root);
  }
});
