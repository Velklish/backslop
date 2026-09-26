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
    assert.match(r.out, /`npx backslop@1\.2\.3 new <slug> --parent N\[\.M\]`/);

    // Семь неизменных пунктов брифа.
    for (const re of [/## Границы правки/, /## Критерий готовности/, /Доки — тем же ходом/,
      /Коммить в свою ветку сразу/, /Каталоги статусов и `archive\/` не трогай/,
      /Находки — с меткой цены, и метка решает ход/, /Мутационная проба — после коммита/, /## Состав результата/]) {
      assert.match(r.out, re);
    }
    assert.match(r.out, /закрытие и правку текста файлов в каталогах статусов и `archive\/` делает approver/);
    assert.match(r.out, /worker присылает формулировку в результате/);
    assert.match(r.out, /Единственное исключение — новая находка: worker заводит её отдельным файлом командой `npx backslop@1\.2\.3 new <slug> --parent N\[\.M\]` \(с `--minor --evidence "…"` для minor и гипотез\) в своей ветке/);
    assert.match(r.out, /`critical` чини сейчас в своих границах, в чужих файлах — сообщение оркестратору сразу/);
    assert.match(r.out, /`minor` и гипотезу — `npx backslop@1\.2\.3 new <slug> --parent N\[\.M\] --minor --evidence "…"`/);
    assert.match(r.out, /уже созданную карточку worker не правит/);
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
    assert.match(r.out, /the approver closes tasks and edits file text in those directories; the worker sends the wording in the result\./);
    assert.match(r.out, /Moving a file between status directories or `archive\/` is not the worker’s move\./);
    assert.match(r.out, /The only exception is a new finding: the worker creates it as a separate file with `npx backslop@1\.2\.3 new <slug> --parent N\[\.M\]` \(with `--minor --evidence "…"` for minors and hypotheses\) on their branch/);
    assert.match(r.out, /Findings carry a cost label, and the label decides the route/);
    assert.match(r.out, /the worker does not edit an existing card/);
  } finally {
    cleanup(root);
  }
});

test('brief: old CLI pin warns, with stdout equal after normalizing the pin token', () => {
  const root = makeProject();
  try {
    seed(root);
    const cfg = { ...JSON.parse(read(root, 'backslop.json')), gates: ['npm test'], probe: 'npm test' };
    const render = (command) => {
      put(root, 'backslop.json', `${JSON.stringify({ ...cfg, cli: command }, null, 2)}\n`);
      const result = cli(root, ['brief', '3']);
      assert.equal(result.code, 0, result.err);
      return result;
    };
    const old = render('npx backslop@0.9.0');
    const floor = render('npx backslop@0.10.0');
    assert.ok((old.out.match(/backslop@0\.9\.0/g) ?? []).length > 0);
    assert.equal(old.out.replaceAll('backslop@0.9.0', 'backslop@0.10.0'), floor.out);
    assert.match(old.err, /--evidence/);
    assert.match(old.err, /npx backslop@0\.9\.0 upgrade/);
    assert.equal(floor.err, '');
    for (const command of ['npx backslop@0.11.0', 'npx backslop', 'npx backslop@latest']) {
      assert.equal(render(command).err, '');
    }
    put(root, 'backslop.json', `${JSON.stringify({ ...cfg, cli: 'npx backslop@0.9.0', lang: 'en' }, null, 2)}\n`);
    const english = cli(root, ['brief', '3']);
    assert.equal(english.code, 0, english.err);
    assert.match(english.err, /Pinned CLI .* lacks .*--evidence.*upgrade/);
  } finally {
    cleanup(root);
  }
});

test('brief: GitHub CLI pin warning follows the command floor', () => {
  const root = makeProject();
  try {
    seed(root);
    const cfg = { ...JSON.parse(read(root, 'backslop.json')), lang: 'en', gates: ['npm test'], probe: 'npm test' };
    const render = (command) => {
      put(root, 'backslop.json', `${JSON.stringify({ ...cfg, cli: command }, null, 2)}\n`);
      const result = cli(root, ['brief', '3']);
      assert.equal(result.code, 0, result.err);
      return result;
    };
    const old = render('npx github:Velklish/backslop#v0.9.0');
    assert.match(old.err, /--evidence/);
    assert.match(old.err, /npx github:Velklish\/backslop#v0\.9\.0 upgrade/);
    assert.equal(render('npx github:Velklish/backslop#v0.10.0').err, '');
    assert.equal(render('npx github:Velklish/backslop').err, '');
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

test('brief: три слота решения оркестратора — заготовка без флага, значение с флагом', () => {
  const root = makeProject();
  try {
    seed(root);
    const bare = cli(root, ['brief', '3']);
    assert.equal(bare.code, 0, bare.err);
    for (const re of [/## Точка входа/, /## Что решаешь сам/, /## Форма сдачи/]) assert.match(bare.out, re);
    assert.match(bare.out, /\[TODO: где лежит предмет и с чего начинать чтение/);
    assert.match(bare.out, /\[TODO: что участник закрывает своим решением/);
    assert.match(bare.out, /\[TODO: протокол гейта и шапка отчёта/);
    // Слот без ключа уехал бы читателю буквально; на постановке без `{{` в тексте их ноль.
    assert.doesNotMatch(bare.out, /\{\{/);

    const full = cli(root, ['brief', '3',
      '--entry', 'lib/guard.js, затем справочник',
      '--autonomy', 'формулировки твои, схема — нет',
      '--handover', 'запись гейта артефактом']);
    assert.equal(full.code, 0, full.err);
    assert.match(full.out, /lib\/guard\.js, затем справочник/);
    assert.match(full.out, /формулировки твои, схема — нет/);
    assert.match(full.out, /запись гейта артефактом/);
    assert.doesNotMatch(full.out, /\[TODO: где лежит предмет/);
  } finally {
    cleanup(root);
  }
});

test('brief: the gates step names the runner through the project cli', () => {
  const root = makeProject();
  try {
    seed(root);
    // The gates step names the runner of the pinned cli.
    const fresh = cli(root, ['brief', '3']);
    assert.equal(fresh.code, 0, fresh.err);
    assert.match(fresh.out, /`npx backslop@1\.2\.3 gates` печатает итог «гейтов N, зелёных N»/);
  } finally {
    cleanup(root);
  }
});

// BS-66: у записи `gates` появилась вторая форма. Бриф обязан печатать команду, а не объект, и
// назвать пропуск по области: «зелёных N» из N перестало быть равенством со списком.
test('brief: запись с областью печатается командой, и пропуск назван', () => {
  const root = makeProject();
  try {
    seed(root);
    const cfg = JSON.parse(read(root, 'backslop.json'));
    put(root, 'backslop.json', `${JSON.stringify({ ...cfg, gates: ['npm test', { command: 'npx backslop@1.2.3 lint', when: ['docs/**'] }] }, null, 2)}\n`);
    const r = cli(root, ['brief', '3']);
    assert.equal(r.code, 0, r.err);
    assert.doesNotMatch(r.out, /\[object Object\]/);
    assert.match(r.out, /`npm test`, `npx backslop@1\.2\.3 lint`/);
    assert.match(r.out, /Область `when` несут 1 из 2/);
    assert.match(r.out, /Пропущенное к зелёным не прибавляется/);

    put(root, 'backslop.json', `${JSON.stringify(cfg, null, 2)}\n`);
    assert.doesNotMatch(cli(root, ['brief', '3']).out, /Область `when` несут/, 'без области про неё не говорится');
  } finally {
    cleanup(root);
  }
});

test('brief: команда пробы — из поля probe проекта; поля нет — нет и предложения', () => {
  const root = makeProject();
  try {
    seed(root);
    let r = cli(root, ['brief', '3', '--track', 'миграция конфигов']);
    assert.equal(r.code, 0, r.err);
    assert.doesNotMatch(r.out, /потом проба —/, 'поля probe нет — команду бриф не называет');
    assert.ok(!r.out.includes('{{'), 'пустая подстановка не оставляет {{…}} читателю');
    // Выкинутое требование называется вслух, как у `init` (ADR-021), и в stderr: stdout — бриф.
    assert.match(r.err, /probe в backslop\.json не объявлен/);
    assert.doesNotMatch(r.out, /probe в backslop\.json не объявлен/, 'нота в stdout уехала бы worker’у частью постановки');

    put(root, 'backslop.json', `${JSON.stringify({
      prefix: 'BL', docs: 'docs', cli: 'npx backslop@1.2.3', gates: [], tools: [], probe: 'npm run probe',
    }, null, 2)}\n`);
    r = cli(root, ['brief', '3', '--track', 'миграция конфигов']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /сначала коммит, потом проба — `npm run probe`\./);
    assert.doesNotMatch(r.err, /probe в backslop\.json не объявлен/, 'поле объявлено — ноты нет');
  } finally { cleanup(root); }
});
