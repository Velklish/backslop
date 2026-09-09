// Команды new, mv, status, adr настоящим процессом во временном проекте.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanup, cli, gitAll, makeProject, put, read, run } from './helpers.mjs';
import { loadProject } from '../lib/config.js';
import { toPosix } from '../lib/util.js';

// Гейт 4 требует «Область» у задачи вне triage/: фикстуры, доводящие lint до зелёного,
// заполняют заглушку от `new` этим хелпером.
function fillArea(root, rel) {
  put(root, rel, read(root, rel).replace(/\*\*Область:\*\* .*/, '**Область:** [x](../../README.md)'));
}

test('new: задача в triage по умолчанию, в очередь с порядком, находка с sub-ID', () => {
  const root = makeProject();
  try {
    let r = cli(root, ['new', 'first', '--title', 'Первая']);
    assert.equal(r.code, 0, r.err);
    assert.ok(existsSync(path.join(root, 'docs/backlog/triage/BS-1-first.md')));
    assert.match(read(root, 'docs/backlog/triage/BS-1-first.md'), /^# BS-1 · Первая\n/);

    r = cli(root, ['new', 'second', '--queue']);
    assert.equal(r.code, 0, r.err);
    assert.match(read(root, 'docs/backlog/queue/BS-2-second.md'), /- \*\*Порядок:\*\* 10\n/);
    r = cli(root, ['new', 'third', '--queue']);
    assert.match(read(root, 'docs/backlog/queue/BS-3-third.md'), /- \*\*Порядок:\*\* 20\n/);
    r = cli(root, ['new', 'urgent', '--queue', '--top']);
    assert.equal(r.code, 0, r.err);
    assert.match(read(root, 'docs/backlog/queue/BS-4-urgent.md'), /- \*\*Порядок:\*\* 5\n/);

    r = cli(root, ['new', 'finding', '--parent', '2']);
    assert.equal(r.code, 0, r.err);
    const finding = read(root, 'docs/backlog/triage/BS-2.1-finding.md');
    assert.match(finding, /^# BS-2\.1 · finding\n/);
    assert.match(finding, /Находка при работе над BS-2/);
    r = cli(root, ['new', 'finding-two', '--parent', 'BS-2']);
    assert.ok(existsSync(path.join(root, 'docs/backlog/triage/BS-2.2-finding-two.md')));

    r = cli(root, ['new', 'orphan', '--parent', '99']);
    assert.equal(r.code, 1);
    assert.match(r.err, /нет ни в одном каталоге/);
    r = cli(root, ['new', 'Bad_Slug']);
    assert.equal(r.code, 1);
    assert.match(r.err, /slug/);
    r = cli(root, ['new', 'x', '--top']);
    assert.equal(r.code, 1);
  } finally {
    cleanup(root);
  }
});

test('new: номер и sub-ID учитывают файлы чужого worktree и коммиты чужой ветки, вывод называет источник', () => {
  const root = makeProject();
  const wt = path.join(mkdtempSync(path.join(os.tmpdir(), 'backslop-wt-')), 'worker');
  const git = (...args) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  try {
    cli(root, ['new', 'a', '--queue']);
    gitAll(root);
    assert.equal(git('worktree', 'add', '-q', wt, '-b', 'worker').status, 0);

    // Файлы в чужом worktree ещё не закоммичены — считаются по диску.
    let r = cli(root, ['new', 'b'], { cwd: wt });
    assert.equal(r.code, 0, r.err);
    r = cli(root, ['new', 'f', '--parent', '1'], { cwd: wt });
    assert.equal(r.code, 0, r.err);
    assert.ok(existsSync(path.join(wt, 'docs/backlog/triage/BS-1.1-f.md')));
    r = cli(root, ['new', 'c']);
    assert.equal(r.code, 0, r.err);
    assert.ok(existsSync(path.join(root, 'docs/backlog/triage/BS-3-c.md')), 'BS-2 занят worktree');
    assert.match(r.out, /BS-2 занят: worktree .*worker \(worker\)/);
    r = cli(root, ['new', 'g', '--parent', '1']);
    assert.equal(r.code, 0, r.err);
    assert.ok(existsSync(path.join(root, 'docs/backlog/triage/BS-1.2-g.md')), 'BS-1.1 занят worktree');
    assert.match(r.out, /BS-1\.1 занят: worktree/);

    // Worktree убран, ветка осталась — считаются по дереву ветки.
    spawnSync('git', ['-C', wt, 'add', '-A'], { encoding: 'utf8' });
    spawnSync('git', ['-C', wt, 'commit', '-qm', 'worker'], { encoding: 'utf8' });
    assert.equal(git('worktree', 'remove', '--force', wt).status, 0);
    rmSync(path.join(root, 'docs/backlog/triage/BS-3-c.md'));
    rmSync(path.join(root, 'docs/backlog/triage/BS-1.2-g.md'));
    r = cli(root, ['new', 'd']);
    assert.equal(r.code, 0, r.err);
    assert.ok(existsSync(path.join(root, 'docs/backlog/triage/BS-3-d.md')), 'BS-2 занят веткой');
    assert.match(r.out, /BS-2 занят: ветка worker/);
    r = cli(root, ['new', 'h', '--parent', '1']);
    assert.equal(r.code, 0, r.err);
    assert.ok(existsSync(path.join(root, 'docs/backlog/triage/BS-1.2-h.md')), 'BS-1.1 занят веткой');
    // Свободный номер без чужих — без сообщения об источнике.
    r = cli(root, ['new', 'e']);
    assert.equal(r.code, 0, r.err);
    assert.ok(existsSync(path.join(root, 'docs/backlog/triage/BS-4-e.md')));
    assert.doesNotMatch(r.out, /занят/);
  } finally {
    cleanup(root);
    rmSync(path.dirname(wt), { recursive: true, force: true });
  }
});

test('new/adr: значение --title с ведущим дефисом принимается, имя известного флага — отказ с подсказкой --title=', () => {
  const root = makeProject();
  try {
    let r = cli(root, ['new', 'strategy-flag', '--title', '--strategy on spawn and review', '--queue']);
    assert.equal(r.code, 0, r.err);
    assert.match(read(root, 'docs/backlog/queue/BS-1-strategy-flag.md'), /^# BS-1 · --strategy on spawn and review\n/);
    r = cli(root, ['new', 'dash', '--title', '-x']);
    assert.equal(r.code, 0, r.err);
    assert.match(read(root, 'docs/backlog/triage/BS-2-dash.md'), /^# BS-2 · -x\n/);
    r = cli(root, ['adr', 'flag', '--title', '--flag as a title']);
    assert.equal(r.code, 0, r.err);
    assert.match(read(root, 'docs/adr/adr-001-flag.md'), /^# ADR-001: --flag as a title\n/);
    r = cli(root, ['new', 'ambiguous', '--title', '--queue']);
    assert.equal(r.code, 1);
    assert.match(r.err, /--title=/);
    assert.ok(!existsSync(path.join(root, 'docs/backlog/triage/BS-3-ambiguous.md')));
    r = cli(root, ['new', 'explicit', '--title=--queue']);
    assert.equal(r.code, 0, r.err);
    assert.match(read(root, 'docs/backlog/triage/BS-3-explicit.md'), /^# BS-3 · --queue\n/);
  } finally {
    cleanup(root);
  }
});

test('new: даты — локальная календарная дата машины, не UTC', () => {
  const root = makeProject({ git: false });
  try {
    assert.equal(cli(root, ['new', 'east'], { env: { TZ: 'Etc/GMT-14' } }).code, 0);
    assert.equal(cli(root, ['new', 'west'], { env: { TZ: 'Etc/GMT+12' } }).code, 0);
    const east = read(root, 'docs/backlog/triage/BS-1-east.md').match(/Создана:\*\* (\S+)/)[1];
    const west = read(root, 'docs/backlog/triage/BS-2-west.md').match(/Создана:\*\* (\S+)/)[1];
    assert.match(east, /^\d{4}-\d{2}-\d{2}$/);
    assert.notEqual(east, west, 'UTC+14 и UTC−12 разнесены на 26 часов и никогда не в одном дне');
  } finally {
    cleanup(root);
  }
});

test('new: без git номер считается по текущему дереву', () => {
  const root = makeProject({ git: false });
  try {
    const r = cli(root, ['new', 'a']);
    assert.equal(r.code, 0, r.err);
    assert.ok(existsSync(path.join(root, 'docs/backlog/triage/BS-1-a.md')));
  } finally {
    cleanup(root);
  }
});

test('mv: очередь → работа ставит «Взята» и снимает порядок; deferred получает раздел; --after ставит между', () => {
  const root = makeProject();
  try {
    cli(root, ['new', 'a', '--queue']);
    cli(root, ['new', 'b', '--queue']);
    cli(root, ['new', 'c', '--queue']);
    gitAll(root);

    let r = cli(root, ['mv', '1', 'active']);
    assert.equal(r.code, 0, r.err);
    assert.ok(!existsSync(path.join(root, 'docs/backlog/queue/BS-1-a.md')));
    const active = read(root, 'docs/backlog/active/BS-1-a.md');
    assert.match(active, /- \*\*Взята:\*\* \d{4}-\d{2}-\d{2}\n/);
    assert.doesNotMatch(active, /Порядок/);

    // Задача уже в очереди: --top/--after только меняют «Порядок», файл не двигается.
    r = cli(root, ['mv', 'BS-3', 'queue', '--top']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /BS-3: queue\/ «Порядок» 10/);
    assert.match(read(root, 'docs/backlog/queue/BS-3-c.md'), /- \*\*Порядок:\*\* 10\n/);
    assert.ok(existsSync(path.join(root, 'docs/backlog/queue/BS-3-c.md')));
    r = cli(root, ['mv', '3', 'queue']);
    assert.equal(r.code, 1);
    assert.match(r.err, /уже в queue\/; место — --top или --after M/);
    r = cli(root, ['mv', '3', 'queue', '--after', '3']);
    assert.equal(r.code, 1);
    assert.match(r.err, /после самой себя/);
    r = cli(root, ['mv', '3', 'triage']);
    assert.equal(r.code, 0, r.err);
    r = cli(root, ['mv', '3', 'queue', '--after', '2']);
    assert.equal(r.code, 0, r.err);
    assert.match(read(root, 'docs/backlog/queue/BS-3-c.md'), /- \*\*Порядок:\*\* 30\n/);

    r = cli(root, ['mv', '2', 'deferred']);
    assert.equal(r.code, 0, r.err);
    const deferred = read(root, 'docs/backlog/deferred/BS-2-b.md');
    assert.match(deferred, /## Отложено\n\n- \*\*Отложена:\*\* \d{4}/);
    assert.doesNotMatch(deferred, /Порядок/);

    r = cli(root, ['mv', '2', 'deferred']);
    assert.equal(r.code, 1);
    assert.match(r.err, /уже в deferred/);
    r = cli(root, ['mv', '2', 'done']);
    assert.equal(r.code, 1);
    r = cli(root, ['mv', '7', 'queue']);
    assert.equal(r.code, 1);
    assert.match(r.err, /нет ни в одном/);
  } finally {
    cleanup(root);
  }
});

test('mv: дублированное поле читается первым, queue --top схлопывает его, active снимает целиком', () => {
  const root = makeProject();
  try {
    put(root, 'docs/backlog/queue/BS-1-duplicate.md', '# BS-1 · Дубль\n\n- **Порядок:** 30\n- **Order:** 25\n- **Область:** [x](../../README.md)\n');
    put(root, 'docs/backlog/queue/BS-2-second.md', '# BS-2 · Вторая\n\n- **Порядок:** 10\n- **Область:** [x](../../README.md)\n');
    put(root, 'docs/backlog/queue/BS-3-third.md', '# BS-3 · Третья\n\n- **Порядок:** 20\n- **Область:** [x](../../README.md)\n');
    gitAll(root);

    let r = cli(root, ['status']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /\n\s+30  BS-1 · Дубль/);
    assert.equal(cli(root, ['lint']).code, 1, 'lint должен ловить дубль до команды');

    r = cli(root, ['mv', '1', 'queue', '--top']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /BS-1: queue\/ «Порядок» 5/);
    assert.match(read(root, 'docs/backlog/queue/BS-1-duplicate.md'), /^# BS-1 · Дубль\n\n- \*\*Порядок:\*\* 5\n- \*\*Область:\*\* \[x\]\(\.\.\/\.\.\/README\.md\)\n$/);
    r = cli(root, ['status']);
    assert.match(r.out, /\n\s+5  BS-1 · Дубль/);
    assert.equal(cli(root, ['lint']).code, 0);

    r = cli(root, ['mv', '1', 'active']);
    assert.equal(r.code, 0, r.err);
    const active = read(root, 'docs/backlog/active/BS-1-duplicate.md');
    assert.doesNotMatch(active, /(?:Order|Порядок):/);
    assert.equal(cli(root, ['lint']).code, 0);
  } finally {
    cleanup(root);
  }
});

test('mv: --top на тесной очереди перенумеровывает соседей', () => {
  const root = makeProject();
  try {
    cli(root, ['new', 'a', '--queue']);
    cli(root, ['new', 'b', '--queue', '--top']); // 5
    cli(root, ['new', 'c', '--queue', '--top']); // 2
    cli(root, ['new', 'd', '--queue', '--top']); // 1
    cli(root, ['new', 'e']);
    const r = cli(root, ['mv', '5', 'queue', '--top']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /перенумерована/);
    const ranks = ['5-e', '4-d', '3-c', '2-b', '1-a'].map((n) => read(root, `docs/backlog/queue/BS-${n}.md`).match(/Порядок:\*\* (\d+)/)[1]);
    assert.deepEqual(ranks, ['10', '20', '30', '40', '50']);
  } finally {
    cleanup(root);
  }
});

test('mv: --top на задаче из тесной очереди перенумеровывает соседей без переноса файла', () => {
  const root = makeProject();
  try {
    cli(root, ['new', 'a', '--queue']); // 10
    cli(root, ['new', 'b', '--queue', '--top']); // 5
    cli(root, ['new', 'c', '--queue', '--top']); // 2
    cli(root, ['new', 'd', '--queue', '--top']); // 1
    for (const n of ['1-a', '2-b', '3-c', '4-d']) fillArea(root, `docs/backlog/queue/BS-${n}.md`);
    gitAll(root);
    const r = cli(root, ['mv', '1', 'queue', '--top']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /перенумерована/);
    const ranks = ['1-a', '4-d', '3-c', '2-b'].map((n) => read(root, `docs/backlog/queue/BS-${n}.md`).match(/Порядок:\*\* (\d+)/)[1]);
    assert.deepEqual(ranks, ['10', '20', '30', '40']);
    assert.equal(cli(root, ['lint']).code, 0);
  } finally {
    cleanup(root);
  }
});

test('status: сводка и --json в одном составе', () => {
  const root = makeProject();
  try {
    cli(root, ['new', 'a', '--queue', '--title', 'Первая']);
    cli(root, ['new', 'b', '--queue', '--title', 'Вторая']);
    cli(root, ['new', 'c', '--title', 'Идея']);
    cli(root, ['mv', '2', 'active']);
    let r = cli(root, ['status']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /В работе \(1\)\n  BS-2 · Вторая — взята \d{4}/);
    assert.match(r.out, /Очередь \(1\)\n {4}10  BS-1 · Первая/);
    assert.match(r.out, /Triage \(1\)\n  BS-3 · Идея/);
    assert.match(r.out, /Архив: 0/);
    r = cli(root, ['status', '--json']);
    const s = JSON.parse(r.out);
    assert.equal(s.prefix, 'BS');
    assert.deepEqual(s.queue.map((q) => [q.id, q.order]), [['BS-1', 10]]);
    assert.equal(s.active[0].id, 'BS-2');
    assert.equal(s.triage[0].file, 'docs/backlog/triage/BS-3-c.md');
  } finally {
    cleanup(root);
  }
});

test('status: EN human output, JSON contract unchanged, RU metadata accepted', () => {
  const root = makeProject({ git: false });
  try {
    put(root, 'backslop.json', '{"prefix":"BS","docs":"docs","gates":[],"lang":"en","tools":[]}\n');
    put(root, 'docs/backlog/active/BS-1-mixed.md', '# BS-1 · Mixed\n\n- **Создана:** 2026-09-01\n- **Взята:** 2026-09-02\n');
    const human = cli(root, ['status']);
    assert.equal(human.code, 0, human.err);
    assert.match(human.out, /^Active \(1\)/);
    assert.match(human.out, /Queue \(0\)/);
    assert.match(human.out, /Archive: 0/);
    assert.doesNotMatch(human.out, /[А-Яа-яЁё]/);
    const json = JSON.parse(cli(root, ['status', '--json']).out);
    assert.deepEqual(json.active[0], {
      id: 'BS-1', title: 'Mixed', file: 'docs/backlog/active/BS-1-mixed.md', created: '2026-09-01', taken: '2026-09-02',
    });
  } finally { cleanup(root); }
});

test('adr: следующий номер и напоминание про таблицу', () => {
  const root = makeProject();
  try {
    let r = cli(root, ['adr', 'first', '--title', 'Первое решение']);
    assert.equal(r.code, 0, r.err);
    assert.match(read(root, 'docs/adr/adr-001-first.md'), /^# ADR-001: Первое решение\n/);
    assert.match(r.out, /docs\/README\.md/);
    r = cli(root, ['adr', 'second']);
    assert.ok(existsSync(path.join(root, 'docs/adr/adr-002-second.md')));
  } finally {
    cleanup(root);
  }
});

test('команды вне проекта отказывают с подсказкой про init', () => {
  const root = makeProject();
  try {
    const r = cli(root, ['status'], { cwd: path.dirname(root) });
    assert.equal(r.code, 1);
    assert.match(r.err, /backslop init/);
    const help = cli(root, ['help'], { cwd: path.dirname(root) }).out;
    assert.match(help, /Commands:/);
    assert.match(help, /Команды:/);
    assert.match(help, /adapter outputs/);
    assert.match(help, /равенство шаблонов/);
    assert.match(help, /--title="--…"/);
    assert.match(help, /starts with a dash/);
  } finally {
    cleanup(root);
  }
});

test('release-related CLI messages follow project lang without changing their flow', () => {
  const root = makeProject({ git: false });
  try {
    put(root, 'backslop.json', '{"prefix":"BS","docs":"docs","cli":"node bin/backslop.js","gates":[],"lang":"en","tools":[]}\n');
    let r = cli(root, ['migrate', '--dry-run']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /nothing to migrate/);
    assert.doesNotMatch(r.out + r.err, /[А-Яа-яЁё]/);
    r = cli(root, ['changelog', '--since', 'v99.0.0']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /no entries after v99\.0\.0/);
    r = cli(root, ['upgrade']);
    assert.equal(r.code, 1);
    assert.match(r.err, /there is nothing to update/);
    assert.doesNotMatch(r.err, /[А-Яа-яЁё]/);
  } finally { cleanup(root); }
});

test('mv: входящие ссылки на задачу переписываются, как при archive', () => {
  const root = makeProject();
  try {
    cli(root, ['new', 'a', '--queue', '--title', 'А']);
    fillArea(root, 'docs/backlog/queue/BS-1-a.md');
    put(root, 'docs/ROADMAP.md', '# Roadmap\n\nЗадача [BS-1](backlog/queue/BS-1-a.md).\n');
    put(root, 'docs/backlog/triage/BS-2-b.md', '# BS-2 · Б\n\nСм. [BS-1](../queue/BS-1-a.md#контекст).\n');
    put(root, 'README.md', 'В работе [BS-1](docs/backlog/queue/BS-1-a.md)\n');
    gitAll(root);
    const r = cli(root, ['mv', '1', 'active']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /ссылки на задачу поправлены: README\.md, docs\/ROADMAP\.md, docs\/backlog\/triage\/BS-2-b\.md/);
    assert.match(read(root, 'README.md'), /\(docs\/backlog\/active\/BS-1-a\.md\)/);
    assert.match(read(root, 'docs/ROADMAP.md'), /\(backlog\/active\/BS-1-a\.md\)/);
    assert.match(read(root, 'docs/backlog/triage/BS-2-b.md'), /\(\.\.\/active\/BS-1-a\.md#контекст\)/);
    assert.equal(cli(root, ['lint']).code, 0);
  } finally {
    cleanup(root);
  }
});

test('mv: файл из плоского docs/backlog/ переезжает в каталог статуса с пересчётом исходящих ссылок', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Справочник\n');
    cli(root, ['new', 'a', '--queue']);
    fillArea(root, 'docs/backlog/queue/BS-1-a.md');
    put(root, 'docs/backlog/BS-5-flat.md', '# BS-5 · Плоская\n\n- **Область:** [x](../reference/README.md)\n\nСм. [BS-1](queue/BS-1-a.md) и [архив](../archive/README.md).\n');
    put(root, 'docs/ROADMAP.md', '# Roadmap\n\n[BS-5](backlog/BS-5-flat.md)\n');
    gitAll(root);
    assert.equal(cli(root, ['lint']).code, 1, 'плоский файл — ошибка раскладки');
    const r = cli(root, ['mv', '5', 'queue']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /BS-5: backlog\/ → queue\/ \(docs\/backlog\/queue\/BS-5-flat\.md\)/);
    assert.match(r.out, /исходящие ссылки пересчитаны/);
    const moved = read(root, 'docs/backlog/queue/BS-5-flat.md');
    assert.match(moved, /\(\.\.\/\.\.\/reference\/README\.md\)/);
    assert.match(moved, /\[BS-1\]\(BS-1-a\.md\)/);
    assert.match(moved, /\(\.\.\/\.\.\/archive\/README\.md\)/);
    assert.match(moved, /- \*\*Порядок:\*\* 20\n/);
    assert.match(read(root, 'docs/ROADMAP.md'), /\(backlog\/queue\/BS-5-flat\.md\)/);
    assert.equal(cli(root, ['lint']).code, 0);
    // Между каталогами статусов глубина та же: `../../reference/…` не меняется, а ссылка на
    // соседа из прежнего каталога получает `../queue/`.
    const again = cli(root, ['mv', '5', 'active']);
    assert.equal(again.code, 0, again.err);
    const active = read(root, 'docs/backlog/active/BS-5-flat.md');
    assert.match(active, /\(\.\.\/\.\.\/reference\/README\.md\)/);
    assert.match(active, /\[BS-1\]\(\.\.\/queue\/BS-1-a\.md\)/);
    assert.equal(cli(root, ['lint']).code, 0);
  } finally {
    cleanup(root);
  }
});

test('mv: generated adapter outputs исключены из repository-wide relink', () => {
  const root = makeProject();
  try {
    cli(root, ['new', 'a', '--queue']);
    const generated = '[BS-1](../../../docs/backlog/queue/BS-1-a.md)\n';
    put(root, '.agents/skills/backslop-task/SKILL.md', generated);
    gitAll(root);
    const r = cli(root, ['mv', '1', 'active']);
    assert.equal(r.code, 0, r.err);
    assert.equal(read(root, '.agents/skills/backslop-task/SKILL.md'), generated);
  } finally {
    cleanup(root);
  }
});

test('new и mv на номере с ведущими нулями: находка наследует форму родителя, аргумент разбирается числом', () => {
  const root = makeProject();
  try {
    put(root, 'docs/backlog/queue/BS-007-padded.md', '# BS-007 · С нулями\n\n- **Порядок:** 10\n');
    let r = cli(root, ['new', 'finding', '--parent', '7']);
    assert.equal(r.code, 0, r.err);
    assert.match(read(root, 'docs/backlog/triage/BS-007.1-finding.md'), /^# BS-007\.1 · finding\n[\s\S]*Находка при работе над BS-007/);
    r = cli(root, ['mv', '7', 'active']);
    assert.equal(r.code, 0, r.err);
    assert.ok(existsSync(path.join(root, 'docs/backlog/active/BS-007-padded.md')));
    r = cli(root, ['new', 'next', '--queue']);
    assert.equal(r.code, 0, r.err);
    assert.ok(existsSync(path.join(root, 'docs/backlog/queue/BS-8-next.md')));
  } finally {
    cleanup(root);
  }
});

// Раздел списка тронутых доков: строку переезда команда печатает выше, в список она не входит.
function touchedList(out) {
  const at = out.indexOf('доки, которых коснулся ход');
  return at === -1 ? '' : out.slice(at);
}

test('archive --range: печатает файлы docs и CHANGELOG, изменённые ходом задачи', () => {
  const root = makeProject();
  try {
    put(root, 'docs/backlog/active/BS-1-a.md', '# BS-1 · А\n\n- **Взята:** 2026-09-01\n');
    put(root, 'docs/reference/README.md', '# Справочник\n');
    gitAll(root, 'база');
    const head = run(root, ['rev-parse', 'HEAD']);
    assert.equal(head.status, 0, head.stderr);
    const base = head.stdout.trim();

    put(root, 'docs/reference/01-layout.md', '# 01. Раскладка\n');
    gitAll(root, 'правка справочника без номера задачи');
    put(root, 'CHANGELOG.md', '## Не выпущено\n\n- **Одно** — BS-1\n');
    gitAll(root, 'BS-1: запись в CHANGELOG');
    put(root, 'lib/x.js', '// код\n');
    gitAll(root, 'BS-1: код мимо docs');
    put(root, 'docs/backlog/triage/BS-1.1-finding.md', '# BS-1.1 · Находка\n');
    gitAll(root, 'BS-1: находка файлом');
    put(root, 'docs/ROADMAP.md', '# Roadmap\n');
    gitAll(root, 'снимок захода\n\nBS-1: заголовок схлопнутого коммита в теле');

    const r = cli(root, ['archive', '1', '--range', `${base}..HEAD`, '--dry-run']);
    assert.equal(r.code, 0, r.err);
    assert.match(touchedList(r.out), /docs\/reference\/01-layout\.md/);
    assert.match(touchedList(r.out), /CHANGELOG\.md/);
    assert.doesNotMatch(touchedList(r.out), /lib\/x\.js/, 'вне docs и CHANGELOG — не печатается');
    assert.doesNotMatch(touchedList(r.out), /docs\/backlog\//, 'карточки трекера — не «доки тем же ходом»');

    // Без --range остаются только коммиты с префиксом задачи в заголовке.
    const byPrefix = cli(root, ['archive', '1', '--dry-run']);
    assert.equal(byPrefix.code, 0, byPrefix.err);
    assert.match(touchedList(byPrefix.out), /CHANGELOG\.md/);
    assert.doesNotMatch(touchedList(byPrefix.out), /docs\/reference\/01-layout\.md/);
    assert.doesNotMatch(touchedList(byPrefix.out), /docs\/ROADMAP\.md/, 'заголовок схлопнутого коммита в теле — не заголовок');
    assert.doesNotMatch(touchedList(byPrefix.out), /docs\/backlog\//, 'карточки трекера — не «доки тем же ходом»');

    // Неразрешимая ревизия — отказ словами git, а не пустой список.
    const broken = cli(root, ['archive', '1', '--range', 'nosuchref..HEAD', '--dry-run']);
    assert.equal(broken.code, 1);
    assert.match(broken.err, /--range nosuchref\.\.HEAD/);
    assert.equal(cli(root, ['archive', '1', '--range=', '--dry-run']).code, 1);
  } finally {
    cleanup(root);
  }
});

test('archive: выборка коммитов по номеру — числом, не формой записи в имени файла', () => {
  const root = makeProject();
  try {
    put(root, 'docs/backlog/active/BS-007-zero.md', '# BS-007 · Ноли\n\n- **Область:** [x](../../README.md)\n- **Взята:** 2026-09-01\n');
    gitAll(root, 'база');
    put(root, 'docs/ROADMAP.md', '# Roadmap\n');
    gitAll(root, 'BS-7: правка справочника под задачей с нулями');
    put(root, 'docs/GLOSSARY.md', '# Глоссарий\n');
    gitAll(root, 'BS-007: та же задача, номер записан нулями');

    const r = cli(root, ['archive', '7', '--dry-run']);
    assert.equal(r.code, 0, r.err);
    assert.match(touchedList(r.out), /docs\/ROADMAP\.md/, 'коммит BS-7 относится к файлу BS-007-…');
    assert.match(touchedList(r.out), /docs\/GLOSSARY\.md/, '…и коммит BS-007 — к номеру 7');
  } finally {
    cleanup(root);
  }
});

test('new: «Область» — ссылка на reference/ с посчитанной от каталога статуса глубиной', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Справочник\n');
    assert.equal(cli(root, ['new', 'triaged']).code, 0);
    assert.equal(cli(root, ['new', 'queued', '--queue']).code, 0);
    const { dirs } = loadProject(root);
    // Глубина берётся из раскладки, а не из сегодняшнего совпадения triage/ и queue/.
    for (const [status, rel] of [['triage', 'docs/backlog/triage/BS-1-triaged.md'], ['queue', 'docs/backlog/queue/BS-2-queued.md']]) {
      const area = read(root, rel).match(/^- \*\*Область:\*\* (.+)$/m)[1];
      const href = area.match(/\(([^)]+)\)\s*$/)?.[1];
      assert.equal(href, `${toPosix(path.relative(dirs.statusDir[status], dirs.reference))}/README.md`, `${rel}: «Область» = ${area}`);
      assert.ok(existsSync(path.join(dirs.statusDir[status], ...href.split('/'))), `${rel}: ссылка ${href} должна вести к файлу`);
    }
    assert.doesNotMatch(cli(root, ['lint']).err, /битая ссылка/);
  } finally {
    cleanup(root);
  }
});

test('archive: отказ по битому --range наступает до переезда', () => {
  const root = makeProject();
  try {
    put(root, 'docs/backlog/active/BS-1-a.md', '# BS-1 · А\n\n- **Область:** [x](../../README.md)\n- **Взята:** 2026-09-01\n');
    gitAll(root, 'база');
    const r = cli(root, ['archive', '1', '--range', 'nosuchref..HEAD']);
    assert.equal(r.code, 1);
    assert.ok(existsSync(path.join(root, 'docs/backlog/active/BS-1-a.md')), 'карточка осталась в своём каталоге');
    assert.ok(!existsSync(path.join(root, 'docs/archive/BS-1-a')), 'каталог архива не заведён');
  } finally {
    cleanup(root);
  }
});

test('new: без docs/reference/README.md «Область» остаётся текстом, а не битой ссылкой', () => {
  const root = makeProject();
  try {
    assert.equal(cli(root, ['new', 'noref', '--queue']).code, 0);
    assert.match(read(root, 'docs/backlog/queue/BS-1-noref.md'), /- \*\*Область:\*\* \[TODO: раздел reference\/\]\n/);
    assert.doesNotMatch(cli(root, ['lint']).err, /битая ссылка/);
  } finally {
    cleanup(root);
  }
});

test('archive: --range в проекте без git — отказ, а не тихий пустой список', () => {
  const root = makeProject({ git: false });
  try {
    put(root, 'docs/backlog/active/BS-1-a.md', '# BS-1 · А\n\n- **Область:** [x](../../README.md)\n- **Взята:** 2026-09-01\n');
    const r = cli(root, ['archive', '1', '--range', 'HEAD~1..HEAD', '--dry-run']);
    assert.equal(r.code, 1);
    assert.match(r.err, /--range HEAD~1\.\.HEAD/);
    // Без флага список никто не просил: команда работает молча.
    assert.equal(cli(root, ['archive', '1', '--dry-run']).code, 0);
  } finally {
    cleanup(root);
  }
});
