// Раннер гейтов: код возврата берётся у самой команды, а не у пайпа, и порядок прогона
// виден в выводе. Фикстура — проект с двумя гейтами, где красный стоит первым.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { cleanup, cli, gitAll, makeProject, put, read } from './helpers.mjs';

function withGates(root, gates) {
  put(root, 'backslop.json', `${JSON.stringify({ ...JSON.parse(read(root, 'backslop.json')), gates }, null, 2)}\n`);
}

// Гейты пишут метку в файл: так видно, какие из них дошли до запуска. Путь идёт переменной
// окружения, а не литералом внутри `node -e`: в пути с `\t` или `\r` (Windows) литерал стал
// бы escape-последовательностью.
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

test('gates: команда есть в CLI и в справке', () => {
  const root = makeProject({ git: false });
  try {
    const help = cli(root, ['help']);
    assert.equal(help.code, 0, help.err);
    assert.match(help.out, /gates \[--keep-going\] \[--json\] \[--require-clean\] \[--dry-run\]/);
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

    // Команда идёт через оболочку, поэтому ненайденное имя — это код самой оболочки (127 у sh,
    // 1 или 9009 у cmd.exe), а не `r.error`: ветка «не запустился» через shell недостижима и
    // пробой не покрыта. Число не проверяем — оно от оболочки, а не от нас.
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
