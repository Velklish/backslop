// Команды new, mv, status, adr настоящим процессом во временном проекте.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanup, cli, gitAll, makeProject, put, read, run } from './helpers.mjs';
import { loadProject } from '../lib/config.js';
import { toPosix } from '../lib/util.js';

// Гейт 4 требует «Область» у задачи вне triage/: фикстуры, доводящие lint до зелёного,
// заполняют заглушки от `new` этим хелпером: гейт BS-49 видит их во всём backlog.
function fillArea(root, rel) {
  const text = read(root, rel).replace(/\*\*Область:\*\* .*/, '**Область:** [x](../../README.md)');
  put(root, rel, text
    .replace(/^\s*-\s*\[TODO[^\]]*\](?:\([^)]*\))?\s*$/gm, '- готово')
    .replace(/^\s*\[TODO[^\]]*\]\s*$/gm, 'готово'));
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

test('new: дробный parent принимает находку и сохраняет связь в поле Родитель', () => {
  const root = makeProject();
  try {
    put(root, 'docs/backlog/triage/BS-007-root.md', '# BS-007 · Корень\n');
    put(root, 'docs/backlog/triage/BS-007.1-finding.md', '# BS-007.1 · Находка\n');
    const r = cli(root, ['new', 'child', '--parent', '7.1']);
    assert.equal(r.code, 0, r.err);
    const child = read(root, 'docs/backlog/triage/BS-007.2-child.md');
    assert.match(child, /^# BS-007\.2 · child\n/);
    assert.match(child, /- \*\*Родитель:\*\* BS-007\.1\n/);
    assert.match(child, /Находка при работе над BS-007\.1\.\nУлика: \[TODO: путь к файлу или команда с выводом\]\n/);
    fillArea(root, 'docs/backlog/triage/BS-007.2-child.md');
    let lint = cli(root, ['lint']);
    assert.equal(lint.code, 1, 'незаполненная улика находки должна красить lint');
    assert.match(lint.err, /BS-007\.2-child\.md: строка \d+: осталась заглушка \[TODO\]/);
    put(root, 'docs/backlog/triage/BS-007.2-child.md', read(root, 'docs/backlog/triage/BS-007.2-child.md')
      .replace('Улика: [TODO: путь к файлу или команда с выводом]', 'Улика: вывод проверки'));
    lint = cli(root, ['lint']);
    assert.equal(lint.code, 0, lint.err);
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

test('mv: готовый раздел «Отложено» не дублируется и подсказывает проверить его', () => {
  const root = makeProject();
  try {
    put(root, 'docs/backlog/queue/BS-1-ready.md', '# BS-1 · Готово\n\n- **Порядок:** 10\n- **Область:** [x](../../README.md)\n\n## Отложено\n\n- **Причина:** уже разобрано\n- **Условие возврата:** вернуть после проверки\n');
    gitAll(root);
    const r = cli(root, ['mv', '1', 'deferred']);
    assert.equal(r.code, 0, r.err);
    const moved = read(root, 'docs/backlog/deferred/BS-1-ready.md');
    assert.equal((moved.match(/^## Отложено$/gm) ?? []).length, 1);
    assert.match(moved, /Причина:\*\* уже разобрано/);
    assert.match(r.out, /раздел есть, проверь причину и условие возврата/);
  } finally {
    cleanup(root);
  }
});

test('mv: fenced-only заголовок секции не заменяет настоящий раздел', () => {
  const root = makeProject();
  try {
    put(root, 'docs/backlog/queue/BS-1-fenced.md', '# BS-1 · Fenced\n\n- **Порядок:** 10\n- **Область:** [x](../../README.md)\n\n```markdown\n## Отложено\n- **Причина:** пример\n```\n');
    gitAll(root);
    const r = cli(root, ['mv', '1', 'deferred']);
    assert.equal(r.code, 0, r.err);
    const moved = read(root, 'docs/backlog/deferred/BS-1-fenced.md');
    assert.equal((moved.match(/^## Отложено$/gm) ?? []).length, 2);
    assert.match(moved, /## Отложено\n\n- \*\*Отложена:\*\*/);
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
    assert.match(r.out, /migration through v0\.9\.0: status directory minor\/ \(--dry-run\)/);
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

// BS-19.1: каталог с именем файла задачи в плоском docs/backlog/ — не задача и для findFlatTask:
// иначе mv сначала переносил каталог, а потом падал на чтении — дерево тронуто, откат руками.
test('mv: каталог с именем файла задачи в плоском docs/backlog/ — отказ без переноса и без стека', () => {
  const root = makeProject();
  try {
    mkdirSync(path.join(root, 'docs/backlog/BS-9-sub.md'));
    const r = cli(root, ['mv', '9', 'queue']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, /задачи BS-9 нет ни в одном каталоге статуса/);
    assert.doesNotMatch(r.err, /EISDIR|node:fs/);
    assert.ok(existsSync(path.join(root, 'docs/backlog/BS-9-sub.md')), 'каталог остался на месте');
    assert.ok(!existsSync(path.join(root, 'docs/backlog/queue/BS-9-sub.md')));
  } finally {
    cleanup(root);
  }
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

test('mv: пакет номеров одним вызовом; отказ по любому — всё или ничего', () => {
  const root = makeProject();
  try {
    for (const slug of ['a', 'b', 'c']) assert.equal(cli(root, ['new', slug, '--queue']).code, 0);
    for (const n of [1, 2, 3]) fillArea(root, `docs/backlog/queue/BS-${n}-${'abc'[n - 1]}.md`);
    gitAll(root, 'очередь');

    // Отказ по несуществующему номеру в середине пакета не двигает ни один файл.
    let r = cli(root, ['mv', '1', '99', '3', 'active']);
    assert.equal(r.code, 1);
    assert.match(r.err, /BS-99/);
    for (const n of [1, 2, 3]) assert.ok(existsSync(path.join(root, `docs/backlog/queue/BS-${n}-${'abc'[n - 1]}.md`)), `BS-${n} тронут отказом`);

    // --top при нескольких номерах — отказ: место для пакета не определено одним числом.
    r = cli(root, ['mv', '1', '2', 'queue', '--top']);
    assert.equal(r.code, 1);
    assert.match(r.err, /место для пакета/);

    r = cli(root, ['mv', '1', '2', '3', 'active']);
    assert.equal(r.code, 0, r.err);
    for (const n of [1, 2, 3]) {
      const file = path.join(root, `docs/backlog/active/BS-${n}-${'abc'[n - 1]}.md`);
      assert.ok(existsSync(file), `BS-${n} не переехал`);
      assert.match(read(root, `docs/backlog/active/BS-${n}-${'abc'[n - 1]}.md`), /- \*\*Взята:\*\* \d{4}-\d{2}-\d{2}\n/);
      assert.doesNotMatch(read(root, `docs/backlog/active/BS-${n}-${'abc'[n - 1]}.md`), /Порядок/);
    }
    assert.equal((r.out.match(/→ active\//g) ?? []).length, 3, 'строка ok на каждый номер');

    // Обратно в очередь пакетом: порядок у каждого свой, дубля нет.
    r = cli(root, ['mv', '1', '2', '3', 'queue']);
    assert.equal(r.code, 0, r.err);
    const ranks = [1, 2, 3].map((n) => read(root, `docs/backlog/queue/BS-${n}-${'abc'[n - 1]}.md`).match(/- \*\*Порядок:\*\* (\d+)/)[1]);
    assert.equal(new Set(ranks).size, 3, `порядки совпали: ${ranks.join(', ')}`);
    assert.equal(cli(root, ['lint']).code, 0);

    // Один и тот же номер дважды в пакете — отказ до переноса.
    r = cli(root, ['mv', '1', '1', 'active']);
    assert.equal(r.code, 1);
    assert.match(r.err, /дважды/);
    assert.ok(existsSync(path.join(root, 'docs/backlog/queue/BS-1-a.md')));
  } finally {
    cleanup(root);
  }
});

// Раздел списка тронутых доков: строку переезда команда печатает выше, в список она не входит.
function touchedList(out) {
  const at = out.indexOf('доки, которых коснулся ход');
  return at === -1 ? '' : out.slice(at);
}

// Состав списка целиком, отсортированный: сверка «есть три пути» пропускала бы лишнее —
// путь от toplevel, строку патча. Список — последнее в stdout только под `--dry-run`: без него
// ниже печатается строка «допиши … result.md», и она попала бы в состав.
function touchedPaths(out) {
  return touchedList(out).split('\n').slice(1).map((l) => l.trim()).filter(Boolean).sort();
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

// Проект в подкаталоге репозитория: toplevel git и корень проекта — разные каталоги, и
// `git log --name-only` печатает пути от toplevel (`sub/docs/…`). Merge-коммит здесь же:
// его combined diff флаг `--relative` не учитывает, поэтому префикс срезает сама команда.
test('archive --range: проект в подкаталоге репозитория — пути от корня проекта, и у merge-коммита тоже', () => {
  const top = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-nested-')));
  try {
    run(top, ['init', '-q', '-b', 'main']);
    run(top, ['config', 'user.email', 'test@example.com']);
    run(top, ['config', 'user.name', 'test']);
    run(top, ['config', 'commit.gpgsign', 'false']);
    // Кириллическое имя в фикстуре: без пина имя ушло бы в NFD на машине с выключенной
    // нормализацией, и deepEqual с NFC-литералом покраснел бы не по предмету теста.
    run(top, ['config', 'core.precomposeunicode', 'true']);
    const root = path.join(top, 'sub');
    put(root, 'backslop.json', `${JSON.stringify({ prefix: 'BS', docs: 'docs', gates: [] }, null, 2)}\n`);
    put(root, 'docs/backlog/active/BS-1-a.md', '# BS-1 · А\n\n- **Взята:** 2026-09-01\n');
    put(root, 'docs/reference/README.md', '# Справочник\n');
    put(top, 'docs/reference/outer.md', '# вне проекта\n');
    gitAll(top, 'база');
    const base = run(top, ['rev-parse', 'HEAD']).stdout.trim();
    run(top, ['checkout', '-q', '-b', 'feat']);
    put(root, 'docs/reference/branch-only.md', '# из ветки\n');
    gitAll(top, 'BS-1: правка в ветке');
    run(top, ['checkout', '-q', 'main']);
    put(root, 'docs/reference/01-layout.md', '# 01. Раскладка\n');
    // Не-ASCII имя: git закавычивает такие пути (`core.quotePath`), и без явного выключения
    // префикс оказывался бы внутри кавычек, а в списке — восьмеричные последовательности.
    put(root, 'docs/reference/справка.md', '# справка\n');
    put(root, 'CHANGELOG.md', '## Не выпущено\n\n- **Одно** — BS-1\n');
    // Карточка трекера внутри диапазона: отбор держится на pathspec с префиксом cwd.
    put(root, 'docs/backlog/active/BS-1-a.md', '# BS-1 · А\n\n- **Взята:** 2026-09-01\n\nправка карточки\n');
    put(top, 'docs/reference/outer.md', '# вне проекта, правка\n');
    gitAll(top, 'BS-1: доки проекта, карточка и файл вне него');
    run(top, ['merge', '-q', '--no-ff', '--no-commit', 'feat']);
    put(root, 'docs/reference/merge-only.md', '# правка при слиянии\n');
    gitAll(top, 'Merge feat');

    const r = cli(root, ['archive', '1', '--range', `${base}..HEAD`, '--dry-run']);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(touchedPaths(r.out), [
      'CHANGELOG.md',
      'docs/reference/01-layout.md',
      'docs/reference/branch-only.md',
      'docs/reference/merge-only.md',
      'docs/reference/справка.md',
    ], 'пути от корня проекта, не-ASCII имя как есть, карточка и файл вне проекта не названы, у merge-коммита префикс срезан');
  } finally {
    cleanup(top);
  }
});

// Merge-коммит: файл ветки приходит через её коммит в диапазоне, а правка, сделанная самим
// слиянием, — только через `--cc`; без него `git log --name-only` для merge молчит.
test('archive --range: merge-коммит — файл из ветки и файл, изменённый только слиянием, названы оба', () => {
  const root = makeProject();
  try {
    put(root, 'docs/backlog/active/BS-1-a.md', '# BS-1 · А\n\n- **Взята:** 2026-09-01\n');
    put(root, 'docs/reference/README.md', '# Справочник\n');
    gitAll(root, 'база');
    const base = run(root, ['rev-parse', 'HEAD']).stdout.trim();
    run(root, ['checkout', '-q', '-b', 'feat']);
    put(root, 'docs/reference/branch-only.md', '# из ветки\n');
    gitAll(root, 'BS-1: правка в ветке');
    run(root, ['checkout', '-q', 'main']);
    put(root, 'docs/reference/main-side.md', '# в main\n');
    gitAll(root, 'работа в main');
    run(root, ['merge', '-q', '--no-ff', '--no-commit', 'feat']);
    put(root, 'docs/reference/merge-only.md', '# правка при слиянии\n');
    gitAll(root, 'Merge feat');

    const r = cli(root, ['archive', '1', '--range', `${base}..HEAD`, '--dry-run']);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(touchedPaths(r.out), [
      'docs/reference/branch-only.md',
      'docs/reference/main-side.md',
      'docs/reference/merge-only.md',
    ], 'файл ветки — через её коммит в диапазоне; merge-only — правка самого слияния; лишнего нет');

    // Без --range — только коммиты с заголовком BS-N: правка самого слияния сюда не попадает,
    // потому что заголовок merge-коммита её не называет.
    const byPrefix = cli(root, ['archive', '1', '--dry-run']);
    assert.equal(byPrefix.code, 0, byPrefix.err);
    assert.deepEqual(touchedPaths(byPrefix.out), ['docs/reference/branch-only.md']);
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

test('new --minor: файл N.k в minor/ с ценой и родителем, пустая область; отказы флагов', () => {
  const root = makeProject();
  try {
    cli(root, ['new', 'base', '--queue', '--title', 'База']);
    let r = cli(root, ['new', 'leak', '--parent', '1', '--minor', '--title', 'Мелкая течь']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /minor\/ до пачки/);
    const minor = read(root, 'docs/backlog/minor/BS-1.1-leak.md');
    assert.match(minor, /^# BS-1\.1 · Мелкая течь\n/);
    assert.match(minor, /- \*\*Область:\*\* \n/);
    assert.match(minor, /- \*\*Родитель:\*\* BS-1\n/);
    assert.match(minor, /- \*\*Цена:\*\* minor\n/);
    assert.match(minor, /## Улика\n\nНаходка при работе над BS-1\./);
    assert.doesNotMatch(minor, /Что сделать/);

    r = cli(root, ['new', 'guess', '--parent', '1', '--minor', '--cost', 'major', '--hypothesis']);
    assert.equal(r.code, 0, r.err);
    assert.match(read(root, 'docs/backlog/minor/BS-1.2-guess.md'), /- \*\*Цена:\*\* major \(гипотеза\)\n/);

    r = cli(root, ['new', 'a', '--minor']);
    assert.equal(r.code, 1);
    assert.match(r.err, /нужен --parent/);
    r = cli(root, ['new', 'a', '--parent', '1', '--minor', '--queue']);
    assert.equal(r.code, 1);
    assert.match(r.err, /--minor и --queue/);
    r = cli(root, ['new', 'a', '--parent', '1', '--cost', 'major']);
    assert.equal(r.code, 1);
    assert.match(r.err, /только вместе с --minor/);
    r = cli(root, ['new', 'a', '--parent', '1', '--minor', '--cost', 'major']);
    assert.equal(r.code, 1);
    assert.match(r.err, /--cost major без --hypothesis/);
    r = cli(root, ['new', 'a', '--parent', '1', '--minor', '--cost', 'huge']);
    assert.equal(r.code, 1);
    assert.match(r.err, /уровни — critical, major, minor/);
    assert.ok(!existsSync(path.join(root, 'docs/backlog/minor/BS-1.3-a.md')));
  } finally {
    cleanup(root);
  }
});

test('mv N minor дописывает «Цена: minor»; status печатает minor по областям и отдаёт их в JSON', () => {
  const root = makeProject();
  try {
    cli(root, ['new', 'base', '--queue', '--title', 'База']);
    cli(root, ['new', 'idea', '--title', 'Идея']);
    let r = cli(root, ['mv', '2', 'minor']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /«Цена: minor» дописана/);
    assert.match(read(root, 'docs/backlog/minor/BS-2-idea.md'), /- \*\*Цена:\*\* minor\n/);
    r = cli(root, ['mv', '2', 'minor']);
    assert.equal(r.code, 1);
    assert.match(r.err, /уже в minor\//);

    cli(root, ['new', 'late', '--parent', '1', '--minor', '--title', 'Поздняя']);
    put(root, 'docs/backlog/minor/BS-1.1-late.md', '# BS-1.1 · Поздняя\n\n- **Область:** [02. CLI](../../reference/02-cli.md)\n- **Создана:** 2026-09-18\n- **Родитель:** BS-1\n- **Цена:** minor\n');
    cli(root, ['new', 'early', '--parent', '1', '--minor', '--title', 'Ранняя']);
    put(root, 'docs/backlog/minor/BS-1.2-early.md', '# BS-1.2 · Ранняя\n\n- **Область:** [01. Раскладка](../../reference/01-layout.md)\n- **Создана:** 2026-09-18\n- **Родитель:** BS-1\n- **Цена:** major (гипотеза)\n');
    r = cli(root, ['status']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /Minor \(3\)\n  \[01\. Раскладка\] BS-1\.2 · Ранняя — major \(гипотеза\)\n  \[02\. CLI\] BS-1\.1 · Поздняя — minor\n  \[без области\] BS-2 · Идея — minor\nАрхив: 0/);
    const s = JSON.parse(cli(root, ['status', '--json']).out);
    assert.deepEqual(s.minor.map((m) => [m.id, m.area, m.cost]), [
      ['BS-1.2', '[01. Раскладка](../../reference/01-layout.md)', 'major (гипотеза)'],
      ['BS-1.1', '[02. CLI](../../reference/02-cli.md)', 'minor'],
      ['BS-2', null, 'minor'],
    ]);
    assert.equal(s.minor[2].file, 'docs/backlog/minor/BS-2-idea.md');
  } finally {
    cleanup(root);
  }
});

test('migrate до v0.9.0 создаёт каталог minor/ в проекте со старым штампом', () => {
  const root = makeProject({ git: false });
  try {
    rmSync(path.join(root, 'docs/backlog/minor'), { recursive: true });
    put(root, 'backslop.json', '{"prefix":"BS","docs":"docs","gates":[],"version":"0.8.0"}\n');
    let r = cli(root, ['lint']);
    assert.equal(r.code, 1);
    assert.match(r.err, /docs\/backlog\/minor: каталога статуса нет/);
    r = cli(root, ['migrate', '--dry-run']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /миграция до v0\.9\.0: каталог статуса minor\/ .*--dry-run/);
    assert.ok(!existsSync(path.join(root, 'docs/backlog/minor')));
    r = cli(root, ['migrate']);
    assert.equal(r.code, 0, r.err);
    assert.ok(existsSync(path.join(root, 'docs/backlog/minor/.gitkeep')));
    assert.equal(cli(root, ['lint']).code, 0);
  } finally {
    cleanup(root);
  }
});

test('archive N.k --into M: minor уезжает в minor/ архива пачки без result.md, ссылки переписаны; отказы', () => {
  const root = makeProject();
  try {
    cli(root, ['new', 'base', '--queue', '--title', 'База']);
    cli(root, ['new', 'leak', '--parent', '1', '--minor', '--title', 'Течь']);
    cli(root, ['new', 'typo', '--parent', '1', '--minor', '--title', 'Опечатка']);
    cli(root, ['new', 'batch', '--queue', '--title', 'Пачка']);
    put(root, 'docs/notes.md', '# Заметки\n\nСм. [течь](backlog/minor/BS-1.1-leak.md).\n');
    gitAll(root);

    let r = cli(root, ['archive', '1.1', '--into', '2']);
    assert.equal(r.code, 1);
    assert.match(r.err, /пачка BS-2 ещё в queue\/ — сначала закрой её: backslop archive BS-2/);
    assert.ok(existsSync(path.join(root, 'docs/backlog/minor/BS-1.1-leak.md')));
    assert.ok(!existsSync(path.join(root, 'docs/archive/BS-2-batch')));

    assert.equal(cli(root, ['archive', '2']).code, 0);
    r = cli(root, ['archive', '1.1', '--into', 'BS-2']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /archive: BS-1\.1 → пачка BS-2 — файлов с поправленными ссылками 1/);
    assert.match(r.out, /исход BS-1\.1 назови строкой в result\.md пачки BS-2/);
    assert.ok(existsSync(path.join(root, 'docs/archive/BS-2-batch/minor/BS-1.1-leak.md')));
    assert.ok(!existsSync(path.join(root, 'docs/backlog/minor/BS-1.1-leak.md')));
    assert.ok(!existsSync(path.join(root, 'docs/archive/BS-1.1-leak')));
    assert.match(read(root, 'docs/notes.md'), /\(archive\/BS-2-batch\/minor\/BS-1\.1-leak\.md\)/);
    assert.match(run(root, ['status', '--porcelain']).stdout, /^R  docs\/backlog\/minor\/BS-1\.1-leak\.md -> docs\/archive\/BS-2-batch\/minor\/BS-1\.1-leak\.md$/m);

    r = cli(root, ['archive', '1', '--into', '2']);
    assert.equal(r.code, 1);
    assert.match(r.err, /BS-1 не в minor\//);
    r = cli(root, ['archive', '1.2', '--into', '99']);
    assert.equal(r.code, 1);
    assert.match(r.err, /пачки BS-99 нет/);
    r = cli(root, ['archive', '1.2', '--into', '1.2']);
    assert.equal(r.code, 1);
    assert.match(r.err, /сама minor-запись/);
    r = cli(root, ['archive', '1.2', '--into', '2', '--range', 'HEAD~1..HEAD']);
    assert.equal(r.code, 1);
    assert.match(r.err, /--range с --into не сочетается/);
    r = cli(root, ['archive', '1.1', '--into', '2']);
    assert.equal(r.code, 1);
    assert.match(r.err, /BS-1\.1 уже в архиве/);

    // Закрытая пачкой запись известна нумерации и сводке: следующая находка — BS-1.3, архив считает задачи.
    r = cli(root, ['new', 'next', '--parent', '1', '--minor']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /BS-1\.3/);
    const s = JSON.parse(cli(root, ['status', '--json']).out);
    assert.equal(s.archive, 1);
    assert.deepEqual(s.minor.map((m) => m.id), ['BS-1.2', 'BS-1.3']);
  } finally {
    cleanup(root);
  }
});
