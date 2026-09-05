// Команды new, mv, status, adr настоящим процессом во временном проекте.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { cleanup, cli, gitAll, makeProject, put, read } from './helpers.mjs';

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
