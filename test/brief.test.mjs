// Бриф worker'у настоящим процессом: что берётся с диска, что решает оркестратор флагом и
// что команда отказывается выдумывать.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanup, cli, makeProject, put, read } from './helpers.mjs';

function seed(root) {
  put(root, 'backslop.json', `${JSON.stringify({
    prefix: 'BL', docs: 'docs', cli: 'npx backslop@1.2.3', gates: ['npm test', 'npx backslop@1.2.3 lint'], tools: [],
  }, null, 2)}\n`);
  put(root, 'docs/backlog/queue/BL-3-configs.md', [
    '# BL-3 · Миграция конфигов', '',
    '- **Порядок:** 10',
    '- **Область:** [x](../../reference/README.md)', '',
    '## Контекст', '', 'Старый формат.', '',
    '## Что сделать', '', '- перенести ключи', '',
    '## Не входит', '', '- смена схемы', '',
  ].join('\n'));
  put(root, 'docs/backlog/queue/BL-4-flags.md', [
    '# BL-4 · Флаги команды', '',
    '- **Порядок:** 20',
    '- **Область:** [x](../../reference/README.md)', '',
    '## Что сделать', '', '- добавить --dry-run', '',
  ].join('\n'));
}

test('brief: заголовок track’а, постановки задач с диска, gates и prefix проекта', () => {
  const root = makeProject();
  try {
    seed(root);
    const r = cli(root, ['brief', '3', '4', '--track', 'миграция конфигов']);
    assert.equal(r.code, 0, r.err);

    assert.match(r.out, /^# миграция конфигов\n/);
    // Постановка берётся из файлов задач, а не пересказывается.
    assert.match(r.out, /### BL-3 — Миграция конфигов/);
    assert.match(r.out, /docs\/backlog\/queue\/BL-3-configs\.md/);
    assert.match(r.out, /- перенести ключи/);
    assert.match(r.out, /- смена схемы/);
    assert.match(r.out, /### BL-4 — Флаги команды/);
    assert.match(r.out, /- добавить --dry-run/);
    // Раздела «Не входит» у BL-4 нет — блок не выдумывается.
    assert.equal(r.out.match(/\*\*Не входит\*\*/g).length, 1);

    // gates, prefix и cli — из backslop.json проекта, не из умолчаний инструмента.
    assert.match(r.out, /`npm test`, `npx backslop@1\.2\.3 lint`/);
    assert.match(r.out, /префиксом `BL-N:`/);
    assert.match(r.out, /`npx backslop@1\.2\.3 new <slug> --parent N`/);

    // Семь неизменных пунктов брифа.
    for (const re of [/## Границы правки/, /## Критерий готовности/, /Доки — тем же ходом/,
      /Коммить в свою ветку сразу/, /Каталоги статусов и `archive\/` не трогай/,
      /Находки — файлом/, /Мутационная проба — после коммита/, /## Состав результата/]) {
      assert.match(r.out, re);
    }
  } finally {
    cleanup(root);
  }
});

test('brief: соседи и замеры — флагами; без них раздел границ остаётся заготовкой', () => {
  const root = makeProject();
  try {
    seed(root);
    const bare = cli(root, ['brief', '3']);
    assert.equal(bare.code, 0, bare.err);
    assert.match(bare.out, /\[TODO: какие каталоги твои/);
    assert.doesNotMatch(bare.out, /Число из захода снимай замером/);

    const full = cli(root, ['brief', '3', '--neighbour', 'test/=tests', '--neighbour', 'bin/=cli', '--measurements']);
    assert.equal(full.code, 0, full.err);
    assert.match(full.out, /- `test\/` — track «tests»;/);
    assert.match(full.out, /- `bin\/` — track «cli»;/);
    assert.doesNotMatch(full.out, /\[TODO: какие каталоги твои/);
    assert.match(full.out, /Число из захода снимай замером/);

    const bad = cli(root, ['brief', '3', '--neighbour', 'tests']);
    assert.equal(bad.code, 1);
    assert.match(bad.err, /--neighbour «tests»: нужна форма «путь=track»/);
  } finally {
    cleanup(root);
  }
});

test('brief: несуществующий номер — отказ с этим номером, а не пустой рендер', () => {
  const root = makeProject();
  try {
    seed(root);
    const r = cli(root, ['brief', '3', '9']);
    assert.equal(r.code, 1);
    assert.match(r.err, /BL-9/);
    assert.equal(r.out, '', 'частичный бриф не печатается');

    const none = cli(root, ['brief']);
    assert.equal(none.code, 1);
    assert.match(none.err, /нужны номера задач/);
  } finally {
    cleanup(root);
  }
});

test('brief: EN project renders the English twin', () => {
  const root = makeProject();
  try {
    seed(root);
    put(root, 'backslop.json', `${JSON.stringify({ ...JSON.parse(read(root, 'backslop.json')), lang: 'en' }, null, 2)}\n`);
    const r = cli(root, ['brief', '3', '--track', 'config migration']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /^# config migration\n/);
    assert.match(r.out, /## Track tasks, in this order/);
    assert.match(r.out, /\*\*Work to do\*\*/, 'RU-разделы карточки читаются в EN-проекте');
    assert.doesNotMatch(r.out, /## Как работать/, 'русская редакция брифа в EN-проект не попадает');
  } finally {
    cleanup(root);
  }
});

test('brief: архивная задача без task.md — отказ словами, а не ENOENT', () => {
  const root = makeProject();
  try {
    seed(root);
    put(root, 'docs/archive/BL-9-gone/result.md', '# BL-9 · Результат\n\n**Закрыта 2026-08-01.** Готово.\n');
    const r = cli(root, ['brief', '9']);
    assert.equal(r.code, 1);
    assert.match(r.err, /BL-9 в архиве без task\.md/);
    assert.doesNotMatch(r.err, /ENOENT|at Object\./, 'отказ адресован человеку, стека нет');
  } finally {
    cleanup(root);
  }
});
