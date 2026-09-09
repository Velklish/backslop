// Переезд в архив настоящим процессом: ссылки чинятся по всему markdown репозитория,
// кроме чужого кода; result.md появляется заготовкой; повтор отказывает.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { cleanup, cli, gitAll, makeProject, put, read } from './helpers.mjs';

function seed(root) {
  put(root, 'docs/backlog/active/BS-1-a.md', [
    '# BS-1 · А',
    '',
    '- **Область:** [Справочник](../../reference/README.md)',
    '- **Взята:** 2026-09-01',
    '',
    '## Контекст',
    '',
    'Сосед [BS-2](../queue/BS-2-b.md), архив [BS-3](../../archive/BS-3-c/task.md), код [x](../../../lib/x.js).',
    '',
  ].join('\n'));
  put(root, 'docs/backlog/queue/BS-2-b.md', '# BS-2 · Б\n\n- **Порядок:** 10\n\nСм. [BS-1](../active/BS-1-a.md#контекст).\n');
  put(root, 'docs/archive/BS-3-c/task.md', '# BS-3 · В\n\nСм. [BS-1](../../backlog/active/BS-1-a.md).\n');
  put(root, 'docs/archive/BS-3-c/result.md', '# BS-3 · Результат\n\n**Закрыта 2026-08-01.** Готово.\n');
  put(root, 'docs/reference/README.md', '# Справочник\n\nЗадача [BS-1](../backlog/active/BS-1-a.md).\n');
  put(root, 'README.md', 'Читай [BS-1](docs/backlog/active/BS-1-a.md)\n');
  put(root, 'CHANGELOG.md', '## Не выпущено\n\n- **Закрыта** [BS-1](docs/backlog/active/BS-1-a.md)\n');
  put(root, 'node_modules/pkg/README.md', 'Чужое: [BS-1](../../docs/backlog/active/BS-1-a.md)\n');
  put(root, 'lib/x.js', '// код\n');
  gitAll(root);
}

test('archive: переезд с правкой исходящих и входящих ссылок, result.md заготовкой', () => {
  const root = makeProject();
  try {
    seed(root);
    const dry = cli(root, ['archive', '1', '--dry-run']);
    assert.equal(dry.code, 0, dry.err);
    assert.ok(existsSync(path.join(root, 'docs/backlog/active/BS-1-a.md')), 'dry-run ничего не двигает');
    assert.ok(!existsSync(path.join(root, 'docs/archive/BS-1-a')));
    // Перечень, а не число: `for (const rel of changed) info(rel)` печатает пути с отступом,
    // и сравнение с составом seed() ловит и пропавший путь, и лишний. Порядок обхода markdown
    // зависит от файловой системы, поэтому сравниваются отсортированные списки.
    const listed = dry.out.split('\n').filter((l) => l.startsWith('  ') && !l.includes('переезд:')).map((l) => l.slice(2));
    assert.deepEqual(listed.sort(), [
      'CHANGELOG.md',
      'README.md',
      'docs/archive/BS-1-a/task.md',
      'docs/archive/BS-3-c/task.md',
      'docs/backlog/queue/BS-2-b.md',
      'docs/reference/README.md',
    ]);
    assert.match(dry.out, new RegExp(`файлов с поправленными ссылками ${listed.length}`));

    const r = cli(root, ['archive', 'BS-1']);
    assert.equal(r.code, 0, r.err);
    assert.ok(!existsSync(path.join(root, 'docs/backlog/active/BS-1-a.md')));
    const task = read(root, 'docs/archive/BS-1-a/task.md');
    assert.match(task, /\(\.\.\/\.\.\/reference\/README\.md\)/);
    assert.match(task, /\(\.\.\/\.\.\/backlog\/queue\/BS-2-b\.md\)/);
    assert.match(task, /\(\.\.\/BS-3-c\/task\.md\)/);
    assert.match(task, /\(\.\.\/\.\.\/\.\.\/lib\/x\.js\)/);
    assert.match(read(root, 'docs/backlog/queue/BS-2-b.md'), /\(\.\.\/\.\.\/archive\/BS-1-a\/task\.md#контекст\)/);
    assert.match(read(root, 'docs/archive/BS-3-c/task.md'), /\(\.\.\/BS-1-a\/task\.md\)/);
    assert.match(read(root, 'docs/reference/README.md'), /\(\.\.\/archive\/BS-1-a\/task\.md\)/);
    assert.match(read(root, 'README.md'), /\(docs\/archive\/BS-1-a\/task\.md\)/);
    assert.match(read(root, 'CHANGELOG.md'), /\(docs\/archive\/BS-1-a\/task\.md\)/);
    assert.match(read(root, 'node_modules/pkg/README.md'), /backlog\/active\/BS-1-a\.md/, 'чужой код не трогается');
    const result = read(root, 'docs/archive/BS-1-a/result.md');
    assert.match(result, /^# BS-1 · Результат\n\n\*\*Закрыта \d{4}-\d{2}-\d{2}\.\*\*/);
    assert.match(result, /BS-N/);

    const again = cli(root, ['archive', '1']);
    assert.equal(again.code, 1);
    assert.match(again.err, /уже в архиве/);
    const missing = cli(root, ['archive', '42']);
    assert.equal(missing.code, 1);
    assert.match(missing.err, /нет ни в одном каталоге статуса/);
  } finally {
    cleanup(root);
  }
});

test('archive: находка с sub-ID уезжает в каталог с точкой в номере', () => {
  const root = makeProject();
  try {
    put(root, 'docs/backlog/queue/BS-4-d.md', '# BS-4 · Г\n\n- **Порядок:** 10\n');
    put(root, 'docs/backlog/triage/BS-4.2-e.md', '# BS-4.2 · Д\n\nРодитель [BS-4](../queue/BS-4-d.md).\n');
    gitAll(root);
    const r = cli(root, ['archive', '4.2']);
    assert.equal(r.code, 0, r.err);
    assert.match(read(root, 'docs/archive/BS-4.2-e/task.md'), /\(\.\.\/\.\.\/backlog\/queue\/BS-4-d\.md\)/);
    assert.ok(existsSync(path.join(root, 'docs/archive/BS-4.2-e/result.md')));
  } finally {
    cleanup(root);
  }
});

test('archive: файл из плоского docs/backlog/ переезжает с переписью исходящих и входящих ссылок', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Справочник\n');
    cli(root, ['new', 'a', '--queue']);
    put(root, 'docs/backlog/BS-5-flat.md', '# BS-5 · Плоская\n\n- **Область:** [x](../reference/README.md)\n\nСм. [BS-1](queue/BS-1-a.md) и [архив](../archive/README.md).\n');
    put(root, 'docs/ROADMAP.md', '# Roadmap\n\n[BS-5](backlog/BS-5-flat.md)\n');
    gitAll(root);

    const r = cli(root, ['archive', '5']);
    assert.equal(r.code, 0, r.err);
    assert.ok(!existsSync(path.join(root, 'docs/backlog/BS-5-flat.md')));
    const archived = read(root, 'docs/archive/BS-5-flat/task.md');
    assert.match(archived, /\(\.\.\/\.\.\/reference\/README\.md\)/);
    assert.match(archived, /\(\.\.\/\.\.\/backlog\/queue\/BS-1-a\.md\)/);
    assert.match(archived, /\[архив\]\(\.\.\/README\.md\)/);
    assert.match(read(root, 'docs/ROADMAP.md'), /\(archive\/BS-5-flat\/task\.md\)/);
    assert.ok(existsSync(path.join(root, 'docs/archive/BS-5-flat/result.md')));
    put(root, 'docs/archive/BS-5-flat/result.md', '# BS-5 · Результат\n\n**Закрыта 2026-09-06.** Перенесено.\n');
    const lint = cli(root, ['lint']);
    assert.equal(lint.code, 0, lint.err);
  } finally {
    cleanup(root);
  }
});
