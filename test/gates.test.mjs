// Раннер гейтов: код возврата берётся у самой команды, а не у пайпа, и порядок прогона
// виден в выводе. Фикстура — проект с двумя гейтами, где красный стоит первым.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanup, cli, gitAll, makeProject, put, read, run } from './helpers.mjs';
import { globToRe } from '../lib/gates.js';

function withGates(root, gates) {
  put(root, 'backslop.json', `${JSON.stringify({ ...JSON.parse(read(root, 'backslop.json')), gates }, null, 2)}\n`);
}

// Гейт пишет метку в файл — видно, какие дошли до запуска. Путь — переменной окружения, а не
// литералом в `node -e`: `\t` или `\r` в пути (Windows) стали бы escape-последовательностью.
const mark = (name, code) => `node -e "require('fs').appendFileSync(process.env.GATES_MARK,'${name}\\n');process.exit(${code})"`;
const marked = (root) => ({ env: { GATES_MARK: path.join(root, 'ran.txt') } });
const ran = (root) => {
  try { return read(root, 'ran.txt').trim().split('\n'); } catch { return []; }
};

test('gates: красный первым останавливает прогон, --keep-going досчитывает остальные', () => {
  const root = makeProject({ git: false });
  try {
    withGates(root, [mark('first', 1), mark('second', 0)]);
    let r = cli(root, ['gates'], marked(root));
    assert.equal(r.code, 1);
    assert.deepEqual(ran(root), ['first'], 'второй гейт не должен запускаться без --keep-going');
    assert.match(r.err, /гейтов 2, зелёных 0/);
    assert.match(r.err, /не запущено 1/);

    put(root, 'ran.txt', '');
    r = cli(root, ['gates', '--keep-going'], marked(root));
    assert.equal(r.code, 1);
    assert.deepEqual(ran(root), ['first', 'second']);
    assert.match(r.err, /гейтов 2, зелёных 1/);
    assert.doesNotMatch(r.err, /не запущено/);
  } finally {
    cleanup(root);
  }
});

test('gates: все зелёные — код 0; --dry-run печатает перечень и ничего не гоняет', () => {
  const root = makeProject({ git: false });
  try {
    withGates(root, [mark('first', 0), mark('second', 0)]);
    let r = cli(root, ['gates', '--dry-run'], marked(root));
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(ran(root), [], '--dry-run не исполняет гейты');
    assert.match(r.out, /first/);
    assert.match(r.out, /second/);

    r = cli(root, ['gates'], marked(root));
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(ran(root), ['first', 'second']);
    assert.match(r.out, /гейтов 2, зелёных 2/);
  } finally {
    cleanup(root);
  }
});

test('gates: пустой список гейтов — отказ, а не зелёный ноль', () => {
  const root = makeProject({ git: false });
  try {
    withGates(root, []);
    const r = cli(root, ['gates']);
    assert.equal(r.code, 1);
    assert.match(r.err, /gates.*пуст/);
  } finally {
    cleanup(root);
  }
});

test('gates: --require-clean отказывает на грязном дереве до первой команды', () => {
  const root = makeProject();
  try {
    withGates(root, [mark('first', 0)]);
    gitAll(root, 'база');
    put(root, 'docs/note.md', 'правка\n');
    const r = cli(root, ['gates', '--require-clean'], marked(root));
    assert.equal(r.code, 1);
    assert.match(r.err, /дерево нечисто/);
    assert.match(r.err, /docs\/note\.md/);
    assert.deepEqual(ran(root), [], 'ни один гейт не запускается до проверки чистоты');
  } finally {
    cleanup(root);
  }
});

test('gates: --json — валидный JSON со снимком дерева, вывод гейтов в stderr', () => {
  const root = makeProject();
  try {
    // Гейты здесь ничего не пишут: снимок дерева должен остаться чистым.
    withGates(root, ['node -e "process.exit(0)"', `node -e "console.log('шум гейта');process.exit(1)"`]);
    gitAll(root, 'база');
    const r = cli(root, ['gates', '--keep-going', '--json']);
    assert.equal(r.code, 1);
    const report = JSON.parse(r.out);
    assert.equal(report.total, 2);
    assert.equal(report.green, 1);
    assert.equal(report.gates.length, 2);
    assert.equal(report.gates[0].code, 0);
    assert.equal(report.gates[1].code, 1);
    assert.ok(Number.isInteger(report.gates[0].ms));
    assert.match(report.tree.head, /^[0-9a-f]{40}$/);
    assert.equal(report.tree.clean, true);
    assert.match(r.err, /шум гейта/, 'вывод гейта уходит в stderr, чтобы stdout остался JSON');
  } finally {
    cleanup(root);
  }
});

test('gates: снимок дерева называет грязь и коммит; без git — tree null', () => {
  const root = makeProject();
  try {
    withGates(root, ['node -e "process.exit(0)"']);
    gitAll(root, 'база');
    put(root, 'docs/note.md', 'правка\n');
    const r = cli(root, ['gates', '--json']);
    assert.equal(r.code, 0, r.err);
    const report = JSON.parse(r.out);
    assert.equal(report.tree.clean, false);
    assert.equal(report.tree.head.length, 40);

    const bare = makeProject({ git: false });
    try {
      withGates(bare, ['node -e "process.exit(0)"']);
      const b = JSON.parse(cli(bare, ['gates', '--json']).out);
      assert.equal(b.tree, null);
    } finally { cleanup(bare); }
  } finally {
    cleanup(root);
  }
});

// BS-66: область записи сверяется с набором изменённых путей. Без --base набор — грязное дерево.
test('gates: команда вне области не запускается и в зелёные не попадает', () => {
  const root = makeProject();
  try {
    withGates(root, [mark('always', 0), { command: mark('docs-only', 0), when: ['docs/**'] }, { command: mark('code-only', 0), when: ['lib/**', '*.mjs'] }]);
    // Метка гейтов — файл самих гейтов, а не правка проекта: без игнора она попадала бы в набор
    // путей и меняла его счёт от прогона к прогону.
    put(root, '.gitignore', 'ran.txt\n');
    gitAll(root, 'база');
    put(root, 'docs/note.md', 'правка\n');

    const r = cli(root, ['gates', '--json'], marked(root));
    assert.equal(r.code, 0, `пропуск по области не краснит итог: ${r.err}`);
    assert.deepEqual(ran(root), ['always', 'docs-only'], 'запускается задетая область и команда без области');
    const report = JSON.parse(r.out);
    assert.equal(report.total, 3);
    assert.equal(report.green, 2);
    assert.equal(report.outOfScope, 1);
    assert.equal(report.skipped, 1);
    assert.equal(report.gates[2].code, undefined, 'пропущенная команда кода возврата не получает');
    assert.match(report.gates[2].skipped, /область не задета/);
    assert.deepEqual(report.gates[2].when, ['lib/**', '*.mjs']);
    assert.equal(report.scope.source, 'worktree');
    assert.equal(report.scope.base, null);
    assert.deepEqual(report.scope.paths, ['docs/note.md']);

    put(root, 'ran.txt', '');
    const human = cli(root, ['gates'], marked(root));
    assert.equal(human.code, 0, human.err);
    assert.match(human.out, /область: git status --porcelain, путей 1/);
    assert.match(human.out, /пропущен: область не задета \(lib\/\*\*, \*\.mjs\), путей в наборе 1/);
    assert.match(human.out, /гейтов 3, зелёных 2, не запущено 1 \(вне области 1\)/);
  } finally {
    cleanup(root);
  }
});

test('gates: --base добавляет дифф к базе, источник набора назван в отчёте', () => {
  const root = makeProject();
  try {
    withGates(root, [{ command: mark('code-only', 0), when: ['lib/**'] }]);
    put(root, '.gitignore', 'ran.txt\n');
    gitAll(root, 'база');
    const base = run(root, ['rev-parse', 'HEAD']).stdout.trim();
    put(root, 'lib/thing.js', 'export const a = 1;\n');
    gitAll(root, 'правка кода');

    // Дерево чисто: без --base набор пуст, и команда с областью пропускается.
    let report = JSON.parse(cli(root, ['gates', '--json'], marked(root)).out);
    assert.deepEqual(ran(root), []);
    assert.equal(report.outOfScope, 1);
    assert.deepEqual(report.scope.paths, []);

    const r = cli(root, ['gates', '--json', '--base', base], marked(root));
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(ran(root), ['code-only'], 'дифф к базе задел область');
    report = JSON.parse(r.out);
    assert.equal(report.green, 1);
    assert.equal(report.outOfScope, 0);
    assert.equal(report.scope.source, 'base+worktree');
    assert.equal(report.scope.base, base);
    assert.deepEqual(report.scope.paths, ['lib/thing.js']);
    assert.match(cli(root, ['gates', '--base', base], marked(root)).out, new RegExp(`область: git diff --name-only ${base}\\.\\.HEAD плюс git status --porcelain, путей 1`));

    const bad = cli(root, ['gates', '--base', 'нет-такой-ссылки'], marked(root));
    assert.equal(bad.code, 1);
    assert.match(bad.err, /--base нет-такой-ссылки: git diff отказал/);
  } finally {
    cleanup(root);
  }
});

// Корень проекта ниже корня репозитория: git печатает `pkg/lib/x.js`, а образец написан рядом с
// конфигом — `lib/**`. Без снятия префикса гейт не запускался бы никогда при зелёном итоге.
test('gates: в монорепе пути приводятся к корню проекта', () => {
  const repo = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-mono-')));
  try {
    run(repo, ['init', '-q', '-b', 'main']);
    run(repo, ['config', 'user.email', 'test@example.com']);
    run(repo, ['config', 'user.name', 'test']);
    run(repo, ['config', 'commit.gpgsign', 'false']);
    const proj = path.join(repo, 'pkg');
    mkdirSync(path.join(proj, 'docs', 'backlog'), { recursive: true });
    writeFileSync(path.join(proj, 'backslop.json'), `${JSON.stringify({
      prefix: 'BS',
      docs: 'docs',
      gates: [{ command: mark('code', 0), when: ['lib/**'] }, { command: mark('docs', 0), when: ['docs/**'] }],
    }, null, 2)}\n`);
    writeFileSync(path.join(repo, '.gitignore'), 'ran.txt\n');
    run(repo, ['add', '-A']);
    run(repo, ['commit', '-qm', 'база']);
    put(repo, 'pkg/lib/x.js', 'export const a = 1;\n');
    // Сосед по монорепе: путь вне проекта из набора уходит — образец от корня проекта про него
    // ничего сказать не может.
    put(repo, 'other/lib/y.js', 'export const b = 2;\n');

    const inProject = { cwd: proj, env: { GATES_MARK: path.join(proj, 'ran.txt') } };
    const r = cli(repo, ['gates', '--json'], inProject);
    assert.equal(r.code, 0, r.err);
    const report = JSON.parse(r.out);
    assert.equal(report.scope.prefix, 'pkg/');
    assert.deepEqual(report.scope.paths, ['lib/x.js'], 'префикс снят, чужой путь отброшен');
    assert.equal(report.scope.dropped, 1);
    assert.equal(report.green, 1);
    assert.equal(report.outOfScope, 1, 'область docs/** не задета');
    const human = cli(repo, ['gates'], inProject).out;
    assert.match(human, /пути от корня проекта \(pkg\/\)/);
    assert.match(human, /отброшено 1 вне проекта/);

    // Дифф целиком вне проекта — не «база не дала диффа»: изменения есть, наших среди них нет.
    // Это честный пропуск, а не отказ, иначе матрица CI падала бы на каждом нетронутом пакете.
    run(repo, ['add', '-A']);
    run(repo, ['commit', '-qm', 'правки']);
    const base = run(repo, ['rev-parse', 'HEAD']).stdout.trim();
    put(repo, 'other/lib/z.js', 'export const c = 3;\n');
    run(repo, ['add', '-A']);
    run(repo, ['commit', '-qm', 'правка соседа']);
    writeFileSync(path.join(proj, 'ran.txt'), '');

    const foreign = cli(repo, ['gates', '--require-clean', '--base', base, '--json'], inProject);
    assert.equal(foreign.code, 0, foreign.err);
    const alien = JSON.parse(foreign.out);
    assert.deepEqual(alien.scope.paths, [], 'наших путей в диффе нет');
    assert.equal(alien.scope.dropped, 1, 'но дифф непуст — он весь вне проекта');
    assert.equal(alien.outOfScope, 2, 'обе записи с областью пропущены честно');
    assert.equal(alien.green, 0);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('gates: пустой --base и --require-clean без базы — отказ до первой команды', () => {
  const root = makeProject();
  try {
    withGates(root, [mark('always', 0), { command: mark('scoped', 0), when: ['lib/**'] }]);
    put(root, '.gitignore', 'ran.txt\n');
    gitAll(root, 'база');

    for (const argv of [['gates', '--base', ''], ['gates', '--base', '   ']]) {
      const r = cli(root, argv, marked(root));
      assert.equal(r.code, 1);
      assert.match(r.err, /--base пуст/);
      assert.deepEqual(ran(root), [], 'до первой команды дело не дошло');
    }

    const clean = cli(root, ['gates', '--require-clean'], marked(root));
    assert.equal(clean.code, 1);
    assert.match(clean.err, /--require-clean без --base/);
    assert.deepEqual(ran(root), [], 'холостой прогон известен до первой команды');

    // Названная база холостой прогон не лечит: `HEAD..HEAD` пуст ровно так же, как чистое
    // дерево. Отказ считается по набору путей, а не по форме флагов.
    const empty = cli(root, ['gates', '--require-clean', '--base', 'HEAD'], marked(root));
    assert.equal(empty.code, 1);
    assert.match(empty.err, /--require-clean --base HEAD: набор изменённых путей пуст/);
    assert.deepEqual(ran(root), [], 'до первой команды дело не дошло и с базой');
  } finally {
    cleanup(root);
  }
});

// Непустой набор, не задевший областей, — случай законный: пропуск честный, отказа быть не
// должно. Иначе отказ из предыдущей проверки съел бы штатную приёмку правки одних доков.
test('gates: --require-clean на непустом наборе без совпадений — прогон, а не отказ', () => {
  const root = makeProject();
  try {
    withGates(root, [mark('always', 0), { command: mark('scoped', 0), when: ['lib/**'] }]);
    put(root, '.gitignore', 'ran.txt\n');
    gitAll(root, 'база');
    const base = run(root, ['rev-parse', 'HEAD']).stdout.trim();
    put(root, 'docs/note.md', 'правка\n');
    gitAll(root, 'правка доков');

    const r = cli(root, ['gates', '--require-clean', '--base', base, '--json'], marked(root));
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(ran(root), ['always']);
    const report = JSON.parse(r.out);
    assert.deepEqual(report.scope.paths, ['docs/note.md'], 'набор непуст — отказа быть не должно');
    assert.equal(report.outOfScope, 1);
    assert.equal(report.green, 1);
  } finally {
    cleanup(root);
  }
});

test('gates: --require-clean без --base законен, пока областей нет', () => {
  const root = makeProject();
  try {
    withGates(root, [mark('always', 0)]);
    put(root, '.gitignore', 'ran.txt\n');
    gitAll(root, 'база');
    const r = cli(root, ['gates', '--require-clean'], marked(root));
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(ran(root), ['always'], 'список без областей ведёт себя как до BS-66');
  } finally {
    cleanup(root);
  }
});

test('gates: без git область не считается — гоняется всё', () => {
  const root = makeProject({ git: false });
  try {
    withGates(root, [{ command: mark('code-only', 0), when: ['lib/**'] }]);
    const r = cli(root, ['gates', '--json'], marked(root));
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(ran(root), ['code-only'], 'набора путей нет — пропускать не по чему');
    const report = JSON.parse(r.out);
    assert.equal(report.green, 1);
    assert.equal(report.outOfScope, 0);
    assert.equal(report.scope, null);

    const withBase = cli(root, ['gates', '--base', 'HEAD']);
    assert.equal(withBase.code, 1);
    assert.match(withBase.err, /--base HEAD: git не отдал состояние дерева/);
  } finally {
    cleanup(root);
  }
});

test('gates: glob — * не переходит слэш, ** переходит, **/ ловит и корень', () => {
  for (const [pattern, hits, misses] of [
    ['docs/**', ['docs/a.md', 'docs/a/b/c.md'], ['docs', 'lib/a.md']],
    ['*.md', ['a.md'], ['docs/a.md']],
    ['**/*.md', ['a.md', 'docs/a/b.md'], ['a.mdx', 'docs/a.txt']],
    ['lib/?.js', ['lib/a.js'], ['lib/ab.js', 'lib/a/b.js']],
    ['docs/a.md', ['docs/a.md'], ['docs/aXmd', 'xdocs/a.md']],
  ]) {
    for (const p of hits) assert.ok(globToRe(pattern).test(p), `${pattern} обязан ловить ${p}`);
    for (const p of misses) assert.ok(!globToRe(pattern).test(p), `${pattern} не должен ловить ${p}`);
  }
});

test('gates: --dry-run печатает область и отказывает вместе с --base', () => {
  const root = makeProject();
  try {
    withGates(root, ['npm test', { command: 'npm run e2e', when: ['src/**'] }]);
    gitAll(root, 'база');
    const r = cli(root, ['gates', '--dry-run', '--json']);
    assert.equal(r.code, 0, r.err);
    const report = JSON.parse(r.out);
    assert.equal(report.dryRun, true);
    assert.deepEqual(report.gates, [{ command: 'npm test', when: null }, { command: 'npm run e2e', when: ['src/**'] }]);
    assert.match(cli(root, ['gates', '--dry-run']).out, /npm run e2e — область: src\/\*\*/);

    const clash = cli(root, ['gates', '--dry-run', '--base', 'HEAD']);
    assert.equal(clash.code, 1);
    assert.match(clash.err, /--dry-run и --base вместе бессмысленны/);
  } finally {
    cleanup(root);
  }
});

test('gates: команда есть в CLI и в справке', () => {
  const root = makeProject({ git: false });
  try {
    const help = cli(root, ['help']);
    assert.equal(help.code, 0, help.err);
    assert.match(help.out, /gates \[--keep-going\] \[--json\] \[--require-clean\] \[--dry-run\] \[--base <ref>\]/);
    assert.match(readFileSync(new URL('../bin/backslop.js', import.meta.url), 'utf8'), /'gates'/);
  } finally {
    cleanup(root);
  }
});

test('gates: исход различает код, сигнал и незапуск; формат строки гейта закреплён', () => {
  const root = makeProject({ git: false });
  try {
    withGates(root, ['node -e "process.exit(3)"']);
    let r = cli(root, ['gates', '--keep-going']);
    assert.equal(r.code, 1);
    assert.match(r.err, /^✖ node -e "process\.exit\(3\)" — код 3, \d+ ms$/m);

    withGates(root, ['node -e "process.kill(process.pid, \'SIGTERM\')"']);
    r = cli(root, ['gates', '--json']);
    assert.equal(r.code, 1);
    const killed = JSON.parse(r.out).gates[0];
    assert.equal(killed.code, null);
    assert.equal(killed.signal, 'SIGTERM');

    // Ненайденное имя — код самой оболочки (127 у sh, 1 или 9009 у cmd.exe), а не `r.error`: ветка
    // «не запустился» через shell недостижима, и число от оболочки не проверяем.
    withGates(root, ['такой-команды-нет-и-не-будет']);
    r = cli(root, ['gates', '--json']);
    assert.equal(r.code, 1);
    const missing = JSON.parse(r.out).gates[0];
    assert.notEqual(missing.code, 0, 'ненайденная команда не считается зелёной');
    assert.equal(missing.error, null, 'через shell отказ приходит кодом оболочки, а не r.error');
  } finally {
    cleanup(root);
  }
});

test('gates: --dry-run вместе с --require-clean — отказ, а не молчаливый пропуск флага', () => {
  const root = makeProject();
  try {
    withGates(root, [mark('first', 0)]);
    gitAll(root, 'база');
    put(root, 'docs/note.md', 'правка\n');
    const r = cli(root, ['gates', '--dry-run', '--require-clean'], marked(root));
    assert.equal(r.code, 1);
    assert.match(r.err, /--dry-run и --require-clean вместе бессмысленны/);
    assert.deepEqual(ran(root), []);
  } finally {
    cleanup(root);
  }
});

test('gates: репозиторий без коммитов — снимок есть, коммита в нём нет', () => {
  const root = makeProject();
  try {
    withGates(root, ['node -e "process.exit(0)"']);
    const r = cli(root, ['gates', '--json']);
    assert.equal(r.code, 0, r.err);
    const tree = JSON.parse(r.out).tree;
    assert.notEqual(tree, null, 'репозиторий есть, снимок обязан быть');
    assert.equal(tree.head, null);
    assert.equal(tree.clean, false);
    assert.match(cli(root, ['gates']).out, /коммитов ещё нет/);
  } finally {
    cleanup(root);
  }
});
