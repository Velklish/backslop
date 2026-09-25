// Команды new, mv, status, adr настоящим процессом во временном проекте.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanup, cli, gitAll, makeProject, put, read, run } from './helpers.mjs';
import { loadProject } from '../lib/config.js';
import { toPosix } from '../lib/util.js';
import { listReleaseTags } from '../lib/upgrade.js';

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
    // Гейт заглушек в triage/ не смотрит: запись лежит там до разбора, заполнять её некому.
    let lint = cli(root, ['lint']);
    assert.equal(lint.code, 0, lint.err);
    // Разобранная находка — уже не запись triage/: незаполненная улика красит гейт.
    assert.equal(cli(root, ['mv', '7.2', 'queue']).code, 0);
    lint = cli(root, ['lint']);
    assert.equal(lint.code, 1, 'незаполненная улика разобранной находки должна красить lint');
    assert.match(lint.err, /BS-007\.2-child\.md: строка \d+: осталась заглушка \[TODO\]/);
    put(root, 'docs/backlog/queue/BS-007.2-child.md', read(root, 'docs/backlog/queue/BS-007.2-child.md')
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

// BS-1 committed on main, BS-2 committed only on branch `worker`; `new c` then runs on main.
function takenOnWorker(repo, project, docs = 'docs') {
  put(project, 'backslop.json', `${JSON.stringify({ ...JSON.parse(read(project, 'backslop.json')), lang: 'en' }, null, 2)}\n`);
  assert.equal(cli(project, ['new', 'a']).code, 0);
  gitAll(repo, 'BS-1: a');
  run(repo, ['checkout', '-q', '-b', 'worker']);
  assert.equal(cli(project, ['new', 'b']).code, 0);
  gitAll(repo, 'BS-2: b');
  run(repo, ['checkout', '-q', 'main']);
  const r = cli(project, ['new', 'c']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(readdirSync(path.join(project, docs, 'backlog', 'triage')).sort(), ['BS-1-a.md', 'BS-3-c.md']);
  assert.match(r.out, /BS-2 is taken: branch worker/);
}

test('new: a project in a repository subdirectory sees the numbers taken on another branch', () => {
  const root = makeProject();
  try {
    const project = path.join(root, 'pkg', 'a');
    mkdirSync(project, { recursive: true });
    for (const name of ['backslop.json', 'docs']) renameSync(path.join(root, name), path.join(project, name));
    takenOnWorker(root, project);
  } finally {
    cleanup(root);
  }
});

test('new: a non-ASCII docs directory sees the numbers taken on another branch', () => {
  const root = makeProject({ docs: 'доки' });
  try {
    // Pinned against a global core.quotePath=false, which would hide the quoted listing.
    run(root, ['config', 'core.quotePath', 'true']);
    takenOnWorker(root, root, 'доки');
  } finally {
    cleanup(root);
  }
});

test('new: a committed predecessor on the only branch is not named as taken elsewhere', () => {
  const root = makeProject();
  try {
    assert.equal(cli(root, ['new', 'alpha', '--queue']).code, 0);
    assert.equal(cli(root, ['new', 'alpha-finding', '--parent', '1']).code, 0);
    gitAll(root);
    let r = cli(root, ['new', 'beta', '--queue']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /✔ BS-2: /);
    assert.doesNotMatch(r.out, /занят|is taken/);
    r = cli(root, ['new', 'beta-finding', '--parent', '1']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /✔ BS-1\.2: /);
    assert.doesNotMatch(r.out, /занят|is taken/);
  } finally {
    cleanup(root);
  }
});

test('new: a git call that fails while scanning other worktrees and branches refuses instead of numbering blind', { skip: process.platform === 'win32' }, () => {
  const root = makeProject();
  const shim = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-git-shim-')));
  try {
    put(root, 'docs/archive/LOG.md', '# Log\n');
    assert.equal(cli(root, ['new', 'a']).code, 0);
    gitAll(root, 'BS-1: a');
    run(root, ['branch', 'worker']);
    const real = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
    writeFileSync(path.join(shim, 'git'), `#!/bin/sh\nfor a in "$@"; do [ "$a" = "$KILL_ON" ] && kill -9 $$; done\nexec "${real}" "$@"\n`, { mode: 0o755 });
    const cases = [
      ['--is-inside-work-tree', /git rev-parse --is-inside-work-tree: оборван сигналом SIGKILL/],
      ['--show-toplevel', /git rev-parse --show-toplevel: оборван сигналом SIGKILL/],
      ['worktree', /git worktree list --porcelain: оборван сигналом SIGKILL/],
      ['for-each-ref', /git for-each-ref .*: оборван сигналом SIGKILL/],
      ['ls-tree', /git ls-tree .*: оборван сигналом SIGKILL/],
      ['show', /git show main:docs\/archive\/LOG\.md: оборван сигналом SIGKILL/],
    ];
    for (const [arg, cause] of cases) {
      const r = cli(root, ['new', 'c'], { env: { KILL_ON: arg, PATH: `${shim}${path.delimiter}${process.env.PATH}` } });
      assert.equal(r.code, 1, `${arg}: ${r.out}`);
      assert.match(r.err, cause);
      assert.deepEqual(readdirSync(path.join(root, 'docs/backlog/triage')), ['BS-1-a.md'], `${arg}: no file`);
    }
  } finally {
    cleanup(root);
    rmSync(shim, { recursive: true, force: true });
  }
});

test('new: without a git binary the number comes from the working tree', { skip: process.platform === 'win32' }, () => {
  const root = makeProject();
  const empty = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-no-git-')));
  try {
    const r = cli(root, ['new', 'a'], { env: { PATH: empty } });
    assert.equal(r.code, 0, r.err);
    assert.ok(existsSync(path.join(root, 'docs/backlog/triage/BS-1-a.md')));
  } finally {
    cleanup(root);
    rmSync(empty, { recursive: true, force: true });
  }
});

test('new: a translated "not a git repository" is still no repository', { skip: process.platform === 'win32' }, () => {
  const root = makeProject({ git: false });
  const shim = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-git-shim-')));
  try {
    writeFileSync(path.join(shim, 'git'), '#!/bin/sh\nif [ "$LC_ALL" = C ]; then echo "fatal: not a git repository" >&2; else echo "fatal: не найден git-репозиторий" >&2; fi\nexit 128\n', { mode: 0o755 });
    const r = cli(root, ['new', 'a'], { env: { LC_ALL: 'ru_RU.UTF-8', PATH: `${shim}${path.delimiter}${process.env.PATH}` } });
    assert.equal(r.code, 0, r.err);
    assert.ok(existsSync(path.join(root, 'docs/backlog/triage/BS-1-a.md')));
  } finally {
    cleanup(root);
    rmSync(shim, { recursive: true, force: true });
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
    assert.match(r.err, /уже в queue\/; место — --top, --after M или --restore/);
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

test('mv: уход из очереди сохраняет «Прежний порядок», --restore возвращает место', () => {
  const root = makeProject();
  try {
    cli(root, ['new', 'a', '--queue']); // 10
    cli(root, ['new', 'b', '--queue']); // 20
    cli(root, ['new', 'c', '--queue']); // 30
    for (const n of ['1-a', '2-b', '3-c']) fillArea(root, `docs/backlog/queue/BS-${n}.md`);
    gitAll(root);

    // Уход из очереди: активного «Порядка» нет, но ранг не потерян.
    let r = cli(root, ['mv', '2', 'active']);
    assert.equal(r.code, 0, r.err);
    const active = read(root, 'docs/backlog/active/BS-2-b.md');
    assert.doesNotMatch(active, /- \*\*Порядок:\*\*/);
    assert.match(active, /- \*\*Прежний порядок:\*\* 20\n/);
    assert.equal(cli(root, ['lint']).code, 0, 'сохранённый ранг вне queue/ гейт полей не красит');

    // Место свободно — задача встаёт ровно на него, сохранённое число снимается.
    r = cli(root, ['mv', '2', 'queue', '--restore']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /«Порядок» 20 восстановлен/);
    const back = read(root, 'docs/backlog/queue/BS-2-b.md');
    assert.match(back, /- \*\*Порядок:\*\* 20\n/);
    assert.doesNotMatch(back, /Прежний порядок/);
    assert.equal(cli(root, ['lint']).code, 0);

    // Сохранённого числа больше нет: отказ, а не тихая постановка в конец.
    r = cli(root, ['mv', '2', 'queue', '--restore']);
    assert.equal(r.code, 1);
    assert.match(r.err, /нет поля «Прежний порядок» — место не сохранено/);
    assert.match(read(root, 'docs/backlog/queue/BS-2-b.md'), /- \*\*Порядок:\*\* 20\n/);
  } finally {
    cleanup(root);
  }
});

test('mv --restore: занятое место — ближайшее свободное, тесная очередь перенумеровывается', () => {
  const root = makeProject();
  try {
    cli(root, ['new', 'a', '--queue']); // 10
    cli(root, ['new', 'b', '--queue']); // 20
    cli(root, ['new', 'c', '--queue']); // 30
    for (const n of ['1-a', '2-b', '3-c']) fillArea(root, `docs/backlog/queue/BS-${n}.md`);
    gitAll(root);

    assert.equal(cli(root, ['mv', '2', 'active']).code, 0); // «Прежний порядок» 20
    assert.equal(cli(root, ['mv', '3', 'queue', '--after', '1']).code, 0); // BS-3 занял 20
    let r = cli(root, ['mv', '2', 'queue', '--restore']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /сохранённое место 20 занято — «Порядок» 15/);
    assert.match(read(root, 'docs/backlog/queue/BS-2-b.md'), /- \*\*Порядок:\*\* 15\n/);
    assert.equal(cli(root, ['lint']).code, 0);

    // Целого места между соседом и занятым рангом нет — очередь перенумеровывается шагом 10,
    // а восстановленная задача остаётся впереди того, кто занял её число.
    put(root, 'docs/backlog/queue/BS-1-a.md', '# BS-1 · a\n\n- **Порядок:** 10\n- **Область:** [x](../../README.md)\n');
    put(root, 'docs/backlog/queue/BS-2-b.md', '# BS-2 · b\n\n- **Порядок:** 11\n- **Область:** [x](../../README.md)\n');
    put(root, 'docs/backlog/active/BS-3-c.md', '# BS-3 · c\n\n- **Прежний порядок:** 11\n- **Область:** [x](../../README.md)\n- **Взята:** 2026-09-01\n');
    rmSync(path.join(root, 'docs/backlog/queue/BS-3-c.md'));
    gitAll(root);
    r = cli(root, ['mv', '3', 'queue', '--restore']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /перенумерована/);
    const ranks = ['1-a', '3-c', '2-b'].map((n) => read(root, `docs/backlog/queue/BS-${n}.md`).match(/- \*\*Порядок:\*\* (\d+)/)[1]);
    assert.deepEqual(ranks, ['10', '20', '30']);
    assert.equal(cli(root, ['lint']).code, 0);
  } finally {
    cleanup(root);
  }
});

test('mv --restore: вне queue, вместе с другим флагом и на пакете — отказы; нецелое число — отказ', () => {
  const root = makeProject();
  try {
    cli(root, ['new', 'a', '--queue']);
    cli(root, ['new', 'b', '--queue']);
    for (const n of ['1-a', '2-b']) fillArea(root, `docs/backlog/queue/BS-${n}.md`);
    gitAll(root);

    let r = cli(root, ['mv', '1', 'active', '--restore']);
    assert.equal(r.code, 1);
    assert.match(r.err, /--top, --after и --restore имеют смысл только при переводе в queue/);
    r = cli(root, ['mv', '1', 'queue', '--restore', '--top']);
    assert.equal(r.code, 1);
    assert.match(r.err, /--top и --restore вместе не сочетаются: место одно/);
    r = cli(root, ['mv', '1', '2', 'queue', '--top']);
    assert.equal(r.code, 1);
    assert.match(r.err, /--top и --after — только с одним номером/);
    // Пакет --restore разрешён, но без сохранённых чисел отказывает целиком и поимённо.
    r = cli(root, ['mv', '1', '2', 'queue', '--restore']);
    assert.equal(r.code, 1);
    assert.match(r.err, /у BS-1, BS-2 нет поля «Прежний порядок» — место не сохранено/);
    for (const n of ['1-a', '2-b']) assert.ok(existsSync(path.join(root, `docs/backlog/queue/BS-${n}.md`)), 'отказ пакета не двигает ни одной задачи');

    put(root, 'docs/backlog/active/BS-3-c.md', '# BS-3 · c\n\n- **Прежний порядок:** высокий\n- **Область:** [x](../../README.md)\n- **Взята:** 2026-09-01\n');
    gitAll(root);
    r = cli(root, ['mv', '3', 'queue', '--restore']);
    assert.equal(r.code, 1);
    assert.match(r.err, /«Прежний порядок» у BS-3 не целое число/);
    assert.ok(existsSync(path.join(root, 'docs/backlog/active/BS-3-c.md')), 'отказ виден до переноса');
  } finally {
    cleanup(root);
  }
});

test('mv --restore: исход пакета не зависит от порядка аргументов', () => {
  // Сохранённые числа 10 и 11 при тесной занятой очереди: кто встал первым, тот и решил, как
  // перенумеровались соседи. Обе формы вызова обязаны дать одну очередь.
  const restore = (ids) => {
    const root = makeProject();
    try {
      put(root, 'docs/backlog/queue/BS-5-e.md', '# BS-5 · e\n\n- **Порядок:** 10\n- **Область:** [x](../../README.md)\n');
      put(root, 'docs/backlog/queue/BS-6-f.md', '# BS-6 · f\n\n- **Порядок:** 11\n- **Область:** [x](../../README.md)\n');
      put(root, 'docs/backlog/active/BS-1-a.md', '# BS-1 · a\n\n- **Прежний порядок:** 10\n- **Область:** [x](../../README.md)\n- **Взята:** 2026-09-01\n');
      put(root, 'docs/backlog/active/BS-2-b.md', '# BS-2 · b\n\n- **Прежний порядок:** 11\n- **Область:** [x](../../README.md)\n- **Взята:** 2026-09-01\n');
      gitAll(root);
      const r = cli(root, ['mv', ...ids, 'queue', '--restore']);
      assert.equal(r.code, 0, r.err);
      assert.equal(cli(root, ['lint']).code, 0);
      return ['1-a', '5-e', '2-b', '6-f'].map((n) => read(root, `docs/backlog/queue/BS-${n}.md`).match(/- \*\*Порядок:\*\* (\d+)/)[1]);
    } finally {
      cleanup(root);
    }
  };
  assert.deepEqual(restore(['1', '2']), ['5', '10', '20', '30']);
  assert.deepEqual(restore(['2', '1']), ['5', '10', '20', '30']);
});

test('mv --restore: восстановленные задачи сохраняют порядок между собой', () => {
  const root = makeProject();
  try {
    // BS-1 ушла раньше BS-2 и обязана вернуться впереди неё. Сохранённое место BS-1 занято и
    // тесно — она расталкивает очередь; свободное место BS-2 её не обгоняет.
    put(root, 'docs/backlog/queue/BS-5-e.md', '# BS-5 · e\n\n- **Порядок:** 10\n- **Область:** [x](../../README.md)\n');
    put(root, 'docs/backlog/queue/BS-6-f.md', '# BS-6 · f\n\n- **Порядок:** 11\n- **Область:** [x](../../README.md)\n');
    put(root, 'docs/backlog/active/BS-1-a.md', '# BS-1 · a\n\n- **Прежний порядок:** 11\n- **Область:** [x](../../README.md)\n- **Взята:** 2026-09-01\n');
    put(root, 'docs/backlog/active/BS-2-b.md', '# BS-2 · b\n\n- **Прежний порядок:** 12\n- **Область:** [x](../../README.md)\n- **Взята:** 2026-09-01\n');
    gitAll(root);

    const r = cli(root, ['mv', '1', '2', 'queue', '--restore']);
    assert.equal(r.code, 0, r.err);
    const rank = (n) => Number(read(root, `docs/backlog/queue/BS-${n}.md`).match(/- \*\*Порядок:\*\* (\d+)/)[1]);
    assert.ok(rank('1-a') < rank('2-b'), `BS-1 ${rank('1-a')} обязана стоять раньше BS-2 ${rank('2-b')}`);
    assert.deepEqual(['5-e', '1-a', '6-f', '2-b'].map(rank), [10, 20, 30, 40]);
    assert.equal(cli(root, ['lint']).code, 0);
  } finally {
    cleanup(root);
  }
});

test('mv --restore: широкий разрыв перед занятым числом не уводит задачу вперёд соседа по пакету', () => {
  const root = makeProject();
  try {
    // Очередь 7/12, пакет 13, 10, 8, 13. BS-2 (10) находит место занятым и встаёт на 5; BS-3 (8)
    // со свободным числом позади неё встаёт перед ней, а не на своё 8.
    put(root, 'docs/backlog/queue/BS-5-e.md', '# BS-5 · e\n\n- **Порядок:** 7\n- **Область:** [x](../../README.md)\n');
    put(root, 'docs/backlog/queue/BS-6-f.md', '# BS-6 · f\n\n- **Порядок:** 12\n- **Область:** [x](../../README.md)\n');
    for (const [n, slug, saved] of [['1', 'a', 13], ['2', 'b', 10], ['3', 'c', 8], ['4', 'd', 13]]) {
      put(root, `docs/backlog/active/BS-${n}-${slug}.md`, `# BS-${n} · ${slug}\n\n- **Прежний порядок:** ${saved}\n- **Область:** [x](../../README.md)\n- **Взята:** 2026-09-01\n`);
    }
    gitAll(root);

    const r = cli(root, ['mv', '1', '2', '3', '4', 'queue', '--restore']);
    assert.equal(r.code, 0, r.err);
    const rank = (n) => Number(read(root, `docs/backlog/queue/BS-${n}.md`).match(/- \*\*Порядок:\*\* (\d+)/)[1]);
    const batch = ['3-c', '2-b', '1-a', '4-d'];
    assert.deepEqual(batch.map(rank), [...batch.map(rank)].sort((a, b) => a - b), 'пакет встал по возрастанию сохранённых чисел 8, 10, 13, 13');
    assert.deepEqual(['3-c', '2-b', '5-e', '6-f', '1-a', '4-d'].map(rank), [2, 5, 10, 20, 30, 40]);
    assert.match(r.out, /сохранённое место 8 позади BS-2 из того же пакета — «Порядок» 2, перед ней/);
    assert.match(r.out, /сохранённое место 10 занято — «Порядок» 5/);
    assert.equal(cli(root, ['lint']).code, 0);
  } finally {
    cleanup(root);
  }
});

test('mv --restore: сводка перенумерации считает файлы, а не срабатывания', () => {
  const root = makeProject();
  try {
    // Три задачи на одно сохранённое место при занятом ранге 1: первая и третья перенумеровывают
    // очередь, и BS-4 попадает в перенумерованные дважды за один вызов.
    put(root, 'docs/backlog/queue/BS-4-d.md', '# BS-4 · d\n\n- **Порядок:** 1\n- **Область:** [x](../../README.md)\n');
    for (const [n, slug] of [['1', 'a'], ['2', 'b'], ['3', 'c']]) {
      put(root, `docs/backlog/active/BS-${n}-${slug}.md`, `# BS-${n} · ${slug}\n\n- **Прежний порядок:** 1\n- **Область:** [x](../../README.md)\n- **Взята:** 2026-09-01\n`);
    }
    gitAll(root);

    const r = cli(root, ['mv', '1', '2', '3', 'queue', '--restore']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /очередь перенумерована шагом 10: 3 файлов/);
    assert.deepEqual(['1-a', '2-b', '3-c', '4-d'].map((n) => read(root, `docs/backlog/queue/BS-${n}.md`).match(/- \*\*Порядок:\*\* (\d+)/)[1]), ['10', '20', '30', '40']);
    assert.equal(cli(root, ['lint']).code, 0);
  } finally {
    cleanup(root);
  }
});

test('mv N queue без --restore: отброшенное место названо вслух, в пакете — про каждую', () => {
  const root = makeProject();
  try {
    put(root, 'docs/backlog/active/BS-1-a.md', '# BS-1 · a\n\n- **Прежний порядок:** 20\n- **Область:** [x](../../README.md)\n- **Взята:** 2026-09-01\n');
    put(root, 'docs/backlog/active/BS-2-b.md', '# BS-2 · b\n\n- **Прежний порядок:** 30\n- **Область:** [x](../../README.md)\n- **Взята:** 2026-09-01\n');
    put(root, 'docs/backlog/active/BS-3-c.md', '# BS-3 · c\n\n- **Область:** [x](../../README.md)\n- **Взята:** 2026-09-01\n');
    gitAll(root);

    const r = cli(root, ['mv', '1', '2', '3', 'queue']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /BS-1: сохранённое место 20 отброшено — вернуть его можно было --restore/);
    assert.match(r.out, /BS-2: сохранённое место 30 отброшено — вернуть его можно было --restore/);
    assert.equal((r.out.match(/отброшено/g) ?? []).length, 2, 'о задаче без сохранённого числа команда молчит');
    for (const n of ['1-a', '2-b', '3-c']) assert.doesNotMatch(read(root, `docs/backlog/queue/BS-${n}.md`), /Прежний порядок/);
    assert.deepEqual(['1-a', '2-b', '3-c'].map((n) => read(root, `docs/backlog/queue/BS-${n}.md`).match(/- \*\*Порядок:\*\* (\d+)/)[1]), ['10', '20', '30']);
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

const BOM = '﻿';
const withBom = (root, rel) => writeFileSync(path.join(root, rel), BOM + read(root, rel));
const startsWithBom = (root, rel) => readFileSync(path.join(root, rel)).subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]));

test('mv, renumbering and archive keep the UTF-8 BOM of a rewritten card', () => {
  const root = makeProject();
  try {
    cli(root, ['new', 'a', '--queue']); // 10
    cli(root, ['new', 'b', '--queue', '--top']); // 5
    cli(root, ['new', 'c', '--queue', '--top']); // 2
    cli(root, ['new', 'd', '--queue', '--top']); // 1
    for (const n of ['1-a', '2-b', '3-c', '4-d']) withBom(root, `docs/backlog/queue/BS-${n}.md`);
    gitAll(root);

    let r = cli(root, ['mv', '1', 'queue', '--top']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /перенумерована/);
    for (const n of ['1-a', '2-b', '3-c', '4-d']) assert.ok(startsWithBom(root, `docs/backlog/queue/BS-${n}.md`), `renumbered ${n} keeps the BOM`);
    r = cli(root, ['mv', '4', 'active']);
    assert.equal(r.code, 0, r.err);
    assert.ok(startsWithBom(root, 'docs/backlog/active/BS-4-d.md'), 'mv keeps the BOM');

    put(root, 'docs/backlog/active/BS-5-e.md', `${BOM}# BS-5 · E\n\n- **Область:** [x](../../README.md)\n- **Взята:** 2026-09-01\n\nSee [f](BS-6-f.md).\n`);
    put(root, 'docs/backlog/active/BS-6-f.md', `${BOM}# BS-6 · F\n\n- **Область:** [x](../../README.md)\n- **Взята:** 2026-09-01\n\nSee [e](BS-5-e.md).\n`);
    gitAll(root);
    r = cli(root, ['archive', '5']);
    assert.equal(r.code, 0, r.err);
    assert.match(read(root, 'docs/archive/BS-5-e/task.md'), /See \[f\]\(\.\.\/\.\.\/backlog\/active\/BS-6-f\.md\)/);
    assert.ok(startsWithBom(root, 'docs/archive/BS-5-e/task.md'), 'archive keeps the BOM of a card whose link it rewrote');
    assert.match(read(root, 'docs/backlog/active/BS-6-f.md'), /See \[e\]\(\.\.\/\.\.\/archive\/BS-5-e\/task\.md\)/);
    assert.ok(startsWithBom(root, 'docs/backlog/active/BS-6-f.md'), 'a neighbour whose incoming link was rewritten keeps its BOM');
  } finally {
    cleanup(root);
  }
});

test('mv: a failed git ls-files refuses before touching the file; an untracked card still moves', { skip: process.platform === 'win32' }, () => {
  const root = makeProject();
  const shim = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-git-shim-')));
  try {
    cli(root, ['new', 'a', '--queue']);
    gitAll(root);
    const real = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
    writeFileSync(path.join(shim, 'git'), `#!/bin/sh\nfor a in "$@"; do [ "$a" = "$KILL_ON" ] && kill -9 $$; done\nexec "${real}" "$@"\n`, { mode: 0o755 });
    const r = cli(root, ['mv', '1', 'active'], { env: { KILL_ON: '--error-unmatch', PATH: `${shim}${path.delimiter}${process.env.PATH}` } });
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, /git ls-files --error-unmatch: оборван сигналом SIGKILL/);
    assert.doesNotMatch(r.err, /без git mv/);
    assert.ok(existsSync(path.join(root, 'docs/backlog/queue/BS-1-a.md')), 'the card stays where it was');
    assert.ok(!existsSync(path.join(root, 'docs/backlog/active/BS-1-a.md')));
    assert.equal(run(root, ['status', '--porcelain']).stdout, '');

    cli(root, ['new', 'b', '--queue']);
    const untracked = cli(root, ['mv', '2', 'active']);
    assert.equal(untracked.code, 0, untracked.err);
    assert.match(untracked.err, /файл не в индексе git — перенесён без git mv/);
    assert.ok(existsSync(path.join(root, 'docs/backlog/active/BS-2-b.md')));
  } finally {
    cleanup(root);
    rmSync(shim, { recursive: true, force: true });
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

test('mv: a card linking to itself still resolves after the move, relative and rooted', () => {
  const root = makeProject();
  try {
    cli(root, ['new', 'a', '--title', 'A']);
    fillArea(root, 'docs/backlog/triage/BS-1-a.md');
    put(root, 'docs/backlog/triage/BS-1-a.md', `${read(root, 'docs/backlog/triage/BS-1-a.md')}\n[self](BS-1-a.md#context) [root](/docs/backlog/triage/BS-1-a.md)\n`);
    gitAll(root);
    const r = cli(root, ['mv', '1', 'queue']);
    assert.equal(r.code, 0, r.err);
    const card = read(root, 'docs/backlog/queue/BS-1-a.md');
    assert.match(card, /\[self\]\(BS-1-a\.md#context\) \[root\]\(\/docs\/backlog\/queue\/BS-1-a\.md\)/);
    const lint = cli(root, ['lint']);
    assert.equal(lint.code, 0, lint.err);
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

// Состав списка целиком, отсортированный: «есть три пути» пропустило бы лишнее. Список последний в
// stdout только под `--dry-run`: без него ниже печатается «допиши … result.md».
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

// Проект в подкаталоге: `git log --name-only` печатает пути от toplevel (`sub/docs/…`), а combined
// diff merge-коммита `--relative` не учитывает — префикс срезает сама команда.
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
    let r = cli(root, ['new', 'leak', '--parent', '1', '--minor', '--title', 'Мелкая течь', '--evidence', 'lib/new.js:97 — область пуста']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /minor\/ до пачки/);
    const minor = read(root, 'docs/backlog/minor/BS-1.1-leak.md');
    assert.match(minor, /^# BS-1\.1 · Мелкая течь\n/);
    assert.match(minor, /- \*\*Область:\*\* \n/);
    assert.match(minor, /- \*\*Родитель:\*\* BS-1\n/);
    assert.match(minor, /- \*\*Цена:\*\* minor\n/);
    assert.match(minor, /## Улика\n\nНаходка при работе над BS-1\.\n\nУлика: lib\/new\.js:97 — область пуста\n/);
    // Заглушке в minor/ взяться неоткуда: улику даёт флаг, и гейт заглушек её не красит.
    assert.doesNotMatch(minor, /\[TODO/);
    assert.doesNotMatch(minor, /Что сделать/);

    r = cli(root, ['new', 'guess', '--parent', '1', '--minor', '--cost', 'major', '--hypothesis', '--evidence', 'предположительно течёт на пике']);
    assert.equal(r.code, 0, r.err);
    assert.match(read(root, 'docs/backlog/minor/BS-1.2-guess.md'), /- \*\*Цена:\*\* major \(гипотеза\)\n/);

    r = cli(root, ['new', 'a', '--minor']);
    assert.equal(r.code, 1);
    assert.match(r.err, /нужен --parent/);
    r = cli(root, ['new', 'a', '--parent', '1', '--minor', '--queue', '--evidence', 'x']);
    assert.equal(r.code, 1);
    assert.match(r.err, /--minor и --queue/);
    r = cli(root, ['new', 'a', '--parent', '1', '--cost', 'major']);
    assert.equal(r.code, 1);
    assert.match(r.err, /только вместе с --minor/);
    r = cli(root, ['new', 'a', '--parent', '1', '--evidence', 'x']);
    assert.equal(r.code, 1);
    assert.match(r.err, /--cost, --hypothesis и --evidence имеют смысл только вместе с --minor/);
    r = cli(root, ['new', 'a', '--parent', '1', '--minor', '--cost', 'major', '--evidence', 'x']);
    assert.equal(r.code, 1);
    assert.match(r.err, /--cost major без --hypothesis/);
    r = cli(root, ['new', 'a', '--parent', '1', '--minor', '--cost', 'huge', '--evidence', 'x']);
    assert.equal(r.code, 1);
    assert.match(r.err, /уровни — critical, major, minor/);
    assert.ok(!existsSync(path.join(root, 'docs/backlog/minor/BS-1.3-a.md')));
  } finally {
    cleanup(root);
  }
});

test('new --minor без --evidence: отказ до записи на диск, текст называет, чем улика бывает', () => {
  const root = makeProject();
  try {
    put(root, 'docs/backlog/queue/BS-1-base.md', '# BS-1 · База\n\n- **Порядок:** 10\n- **Область:** [x](../../README.md)\n');
    const before = readdirSync(path.join(root, 'docs/backlog/minor')).sort();

    let r = cli(root, ['new', 'probe', '--parent', '1', '--minor']);
    assert.equal(r.code, 1);
    assert.match(r.err, /--minor без --evidence/);
    // Отказ учит формулировать улику, а не только тому, что флаг обязателен.
    assert.match(r.err, /путь со строкой/);
    assert.match(r.err, /команда с выводом и кодом/);
    assert.match(r.err, /замер числом/);
    assert.match(r.err, /Не проверено — это не пропуск улики, а предположение/);
    // Отказ приходит раньше любой записи: каталог статуса не изменился.
    assert.deepEqual(readdirSync(path.join(root, 'docs/backlog/minor')).sort(), before);

    // Пустая и пробельная улика — то же, что её отсутствие; гипотеза исключением не служит.
    for (const extra of [['--evidence', ''], ['--evidence', '   '], ['--cost', 'major', '--hypothesis']]) {
      r = cli(root, ['new', 'probe', '--parent', '1', '--minor', ...extra]);
      assert.equal(r.code, 1, extra.join(' '));
      assert.match(r.err, /--minor без --evidence/);
    }
    assert.deepEqual(readdirSync(path.join(root, 'docs/backlog/minor')).sort(), before);

    // С уликой та же команда создаёт карточку без заглушки, и гейт заглушек её не красит.
    r = cli(root, ['new', 'probe', '--parent', '1', '--minor', '--evidence', 'lib/lint.js:294 → код 1']);
    assert.equal(r.code, 0, r.err);
    const card = read(root, 'docs/backlog/minor/BS-1.1-probe.md');
    assert.match(card, /## Улика\n\nНаходка при работе над BS-1\.\n\nУлика: lib\/lint\.js:294 → код 1\n/);
    assert.doesNotMatch(card, /\[TODO/);
    assert.equal(cli(root, ['lint']).code, 0, 'карточка из new --minor не красит lint с рождения');

    // Находка в triage/ улики флагом не требует: её достраивают при разборе.
    r = cli(root, ['new', 'triaged', '--parent', '1']);
    assert.equal(r.code, 0, r.err);
    assert.match(read(root, 'docs/backlog/triage/BS-1.2-triaged.md'), /Улика: \[TODO: путь к файлу или команда с выводом\]/);
  } finally {
    cleanup(root);
  }
});

test('new --minor в EN-проекте: отказ и раздел Evidence на английском', () => {
  const root = makeProject();
  try {
    put(root, 'backslop.json', `${JSON.stringify({ ...JSON.parse(read(root, 'backslop.json')), lang: 'en' }, null, 2)}\n`);
    put(root, 'docs/backlog/queue/BS-1-base.md', '# BS-1 · Base\n\n- **Order:** 10\n- **Scope:** [x](../../README.md)\n');

    let r = cli(root, ['new', 'probe', '--parent', '1', '--minor']);
    assert.equal(r.code, 1);
    assert.match(r.err, /--minor without --evidence/);
    assert.match(r.err, /a path with a line/);
    assert.match(r.err, /a command, output, and code/);
    assert.match(r.err, /a measurement with a number/);
    assert.ok(!existsSync(path.join(root, 'docs/backlog/minor/BS-1.1-probe.md')));

    r = cli(root, ['new', 'probe', '--parent', '1', '--minor', '--evidence', 'lib/lint.js:294 → exit 1']);
    assert.equal(r.code, 0, r.err);
    const card = read(root, 'docs/backlog/minor/BS-1.1-probe.md');
    assert.match(card, /## Evidence\n\nFinding discovered while working on BS-1\.\n\nEvidence: lib\/lint\.js:294 → exit 1\n/);
    assert.doesNotMatch(card, /\[TODO/);
  } finally {
    cleanup(root);
  }
});

test('mv N minor дописывает «Цена: minor»; status печатает minor по областям и отдаёт их в JSON', () => {
  const root = makeProject();
  try {
    cli(root, ['new', 'base', '--queue', '--title', 'База']);
    cli(root, ['new', 'idea', '--title', 'Идея']);
    let r = cli(root, ['mv', '2', 'minor', '--evidence', 'docs/backlog/README.md:15 — предположительно']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /«Цена: minor» дописана/);
    assert.match(read(root, 'docs/backlog/minor/BS-2-idea.md'), /- \*\*Цена:\*\* minor\n/);
    r = cli(root, ['mv', '2', 'minor']);
    assert.equal(r.code, 1);
    assert.match(r.err, /уже в minor\//);

    cli(root, ['new', 'late', '--parent', '1', '--minor', '--title', 'Поздняя', '--evidence', 'docs/backlog/README.md:13']);
    put(root, 'docs/backlog/minor/BS-1.1-late.md', '# BS-1.1 · Поздняя\n\n- **Область:** [02. CLI](../../reference/02-cli.md)\n- **Создана:** 2026-09-18\n- **Родитель:** BS-1\n- **Цена:** minor\n');
    cli(root, ['new', 'early', '--parent', '1', '--minor', '--title', 'Ранняя', '--evidence', 'docs/backlog/README.md:21']);
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

test('mv N.k minor: без улики — отказ до переноса; с --evidence заглушки постановки сняты, «Контекст» стал «Уликой», lint по записи молчит', () => {
  const root = makeProject();
  try {
    assert.equal(cli(root, ['new', 'base', '--queue', '--title', 'База']).code, 0);
    assert.equal(cli(root, ['new', 'finding', '--parent', '1']).code, 0);
    const triage = 'docs/backlog/triage/BS-1.1-finding.md';
    const before = read(root, triage);

    let r = cli(root, ['mv', '1.1', 'minor']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, /BS-1\.1: в minor\/ без улики — раздела «Улика» нет, он пуст или в нём заглушка \[TODO\]/);
    assert.match(r.err, /mv N minor --evidence "…" — путь со строкой, команда с выводом и кодом или замер числом/);
    assert.equal(read(root, triage), before, 'отказ до переноса: карточка на месте и не тронута');

    r = cli(root, ['mv', '1.1', 'minor', '--evidence', 'lib/mv.js:95 → «Цена» дописана, «Улики» нет']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /сняты разделы из одних заглушек: «Что сделать», «Не входит», «Проверки»/);
    assert.match(r.out, /«Контекст» стал «Уликой»/);
    const card = read(root, 'docs/backlog/minor/BS-1.1-finding.md');
    assert.match(card, /## Улика\n\nНаходка при работе над BS-1\.\nУлика: lib\/mv\.js:95 → «Цена» дописана, «Улики» нет\n/);
    assert.doesNotMatch(card, /\[TODO|## Контекст|## Что сделать|## Не входит|## Проверки/);
    assert.match(card, /- \*\*Цена:\*\* minor\n/);
    assert.ok(card.endsWith('\n') && !card.endsWith('\n\n'), 'хвост файла — одна новая строка');
    assert.doesNotMatch(cli(root, ['lint']).err, /✖ docs\/backlog\/minor\/BS-1\.1/, 'запись в minor/ гейт не красит');
  } finally {
    cleanup(root);
  }
});

test('mv N minor keeps a table row with a filled cell, a numbered item and a task box as text', () => {
  const root = makeProject();
  try {
    const rows = '| a | b |\n|---|---|\n| done | [TODO] |\n\n1. [TODO]\n- [ ] [TODO]\n';
    put(root, 'docs/backlog/triage/BS-1-a.md', `# BS-1 · A\n\n## Контекст\n\nзамер\n\n## Что сделать\n\n${rows}`);
    const r = cli(root, ['mv', '1', 'minor', '--evidence', 'lib/x.js:1 — код 1']);
    assert.equal(r.code, 0, r.err);
    assert.ok(read(root, 'docs/backlog/minor/BS-1-a.md').includes(`## Что сделать\n\n${rows}`), read(root, 'docs/backlog/minor/BS-1-a.md'));
  } finally {
    cleanup(root);
  }
});

test('mv N minor: написанный текст остаётся, готовая «Улика» улики флагом не требует, отказы флага', () => {
  const root = makeProject();
  try {
    put(root, 'docs/backlog/triage/BS-1-a.md', '# BS-1 · А\n\n- **Область:** [TODO: раздел]\n\n## Контекст\n\nЗачем: замер lint → код 1.\n\n## Что сделать\n\n- [TODO]\n- поправить отказ\n\n## Не входит\n\n- [TODO]\n\n## Проверки\n\n```\n[TODO] в примере\n```\n');
    put(root, 'docs/backlog/triage/BS-2-b.md', '# BS-2 · Б\n\n## Контекст\n\nистория\n\n## Улика\n\nlib/x.js:1 — код 1\n');
    put(root, 'docs/backlog/triage/BS-3-c.md', '# BS-3 · В\n\n## Контекст\n\n[TODO: откуда задача]\n');
    let r = cli(root, ['mv', '1', 'minor']);
    assert.equal(r.code, 0, r.err);
    assert.equal(read(root, 'docs/backlog/minor/BS-1-a.md'), '# BS-1 · А\n\n- **Область:** \n- **Цена:** minor\n\n## Улика\n\nЗачем: замер lint → код 1.\n\n## Что сделать\n\n- поправить отказ\n\n## Проверки\n\n```\n[TODO] в примере\n```\n');
    r = cli(root, ['mv', '2', 'minor']);
    assert.equal(r.code, 0, r.err);
    assert.equal(read(root, 'docs/backlog/minor/BS-2-b.md'), '# BS-2 · Б\n\n- **Цена:** minor\n\n## Контекст\n\nистория\n\n## Улика\n\nlib/x.js:1 — код 1\n');
    assert.doesNotMatch(r.out, /стал «Уликой»/);

    r = cli(root, ['mv', '3', 'queue', '--evidence', 'x']);
    assert.equal(r.code, 1);
    assert.match(r.err, /--evidence имеет смысл только при переводе в minor/);
    put(root, 'docs/backlog/triage/BS-4-d.md', '# BS-4 · Г\n');
    r = cli(root, ['mv', '3', '4', 'minor', '--evidence', 'x']);
    assert.equal(r.code, 1);
    assert.match(r.err, /--evidence — только с одним номером/);
    r = cli(root, ['mv', '3', '4', 'minor']);
    assert.equal(r.code, 1);
    assert.match(r.err, /BS-3, BS-4: в minor\/ без улики/);
    assert.ok(existsSync(path.join(root, 'docs/backlog/triage/BS-3-c.md')) && existsSync(path.join(root, 'docs/backlog/triage/BS-4-d.md')), 'пакет — всё или ничего');
    r = cli(root, ['mv', '3', 'minor', '--evidence', 'предположительно течёт']);
    assert.equal(r.code, 0, r.err);
    assert.equal(read(root, 'docs/backlog/minor/BS-3-c.md'), '# BS-3 · В\n\n- **Цена:** minor\n\n## Улика\n\nУлика: предположительно течёт\n');
  } finally {
    cleanup(root);
  }
});

test('mv N minor в EN-проекте: Context становится Evidence, строка улики — Evidence:', () => {
  const root = makeProject();
  try {
    put(root, 'backslop.json', `${JSON.stringify({ ...JSON.parse(read(root, 'backslop.json')), lang: 'en' }, null, 2)}\n`);
    put(root, 'docs/backlog/triage/BS-1-a.md', '# BS-1 · A\n\n## Context\n\nFinding discovered while working on BS-7.\nEvidence: [TODO: file path or command output]\n\n## Work to do\n\n- [TODO]\n');
    let r = cli(root, ['mv', '1', 'minor']);
    assert.equal(r.code, 1);
    assert.match(r.err, /BS-1: no evidence for minor\//);
    r = cli(root, ['mv', '1', 'minor', '--evidence', 'lib/mv.js:95 → exit 0']);
    assert.equal(r.code, 0, r.err);
    assert.equal(read(root, 'docs/backlog/minor/BS-1-a.md'), '# BS-1 · A\n\n- **Cost:** minor\n\n## Evidence\n\nFinding discovered while working on BS-7.\nEvidence: lib/mv.js:95 → exit 0\n');
  } finally {
    cleanup(root);
  }
});

test('migrate до v0.9.0 создаёт каталог minor/ в проекте со старым штампом', () => {
  const root = makeProject({ git: false });
  try {
    rmSync(path.join(root, 'docs/backlog/minor'), { recursive: true });
    put(root, 'backslop.json', '{"prefix":"BS","docs":"docs","gates":[],"version":"0.8.0"}\n');
    // Правила ведения, перерисованные migrate, ссылаются на скелет, который кладёт init.
    put(root, 'docs/ROADMAP.md', '# Roadmap\n');
    put(root, 'docs/reference/README.md', '# Справочник\n');
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
    cli(root, ['new', 'leak', '--parent', '1', '--minor', '--title', 'Течь', '--evidence', 'lib/lint.js:294, код 1']);
    cli(root, ['new', 'typo', '--parent', '1', '--minor', '--title', 'Опечатка', '--evidence', 'docs/GLOSSARY.md:12']);
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

    // Закрытая пачкой запись известна нумерации и сводке: следующая находка — BS-1.3,
    // архив считает задачи.
    r = cli(root, ['new', 'next', '--parent', '1', '--minor', '--evidence', 'docs/reference/02-cli.md:12']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /BS-1\.3/);
    const s = JSON.parse(cli(root, ['status', '--json']).out);
    assert.equal(s.archive, 1);
    assert.deepEqual(s.minor.map((m) => m.id), ['BS-1.2', 'BS-1.3']);
  } finally {
    cleanup(root);
  }
});

test('upgrade: список тегов источника больше 1 МиБ читается, а не обрывается ENOBUFS', () => {
  const src = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-many-tags-')));
  try {
    run(src, ['init', '-q', '-b', 'main']);
    run(src, ['-c', 'user.email=t@e', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'one']);
    const sha = run(src, ['rev-parse', 'HEAD']).stdout.trim();
    const refs = Array.from({ length: 20_000 }, (_, i) => `${sha} refs/tags/v0.0.${i}\n`).join('');
    writeFileSync(path.join(src, '.git', 'packed-refs'), refs);
    assert.ok(refs.length > 1 << 20, 'вывод ls-remote больше буфера spawnSync по умолчанию');
    assert.equal(listReleaseTags(src).length, 20_000);
  } finally {
    rmSync(src, { recursive: true, force: true });
  }
});
