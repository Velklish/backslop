// Слияние двух рабочих редакций CHANGELOG: объединение записей секции невыпущенного по
// заголовку, с подгруппами и базой слияния. Команда гоняется настоящим процессом на
// git-репозитории — она читает редакции через `git show <ref>:./CHANGELOG.md`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFLICT_MARK, mergeChangelog } from '../lib/merge-changelog.js';
import { cleanup, cli, gitAll, makeProject, put, read, run } from './helpers.mjs';

const OURS = `# Changelog

## Не выпущено

- **Первое ours** — тело ours

- **Общее** — одна и та же редакция

## v0.1.0 — 2026-01-01

- **Старое** — выпущено
`;

const THEIRS = `# Changelog

## Не выпущено

- **Общее** — одна и та же редакция

- **Первое theirs** — тело theirs

## v0.1.0 — 2026-01-01

- **Старое** — выпущено
`;

test('merge-changelog: записи обеих сторон, совпавшая запись одна, выпущенные секции от ours', () => {
  const { text, report } = mergeChangelog(OURS, THEIRS);
  assert.equal(text, `# Changelog

## Не выпущено

- **Первое ours** — тело ours

- **Общее** — одна и та же редакция

- **Первое theirs** — тело theirs

## v0.1.0 — 2026-01-01

- **Старое** — выпущено
`);
  assert.deepEqual(report.onlyOurs, ['Первое ours']);
  assert.deepEqual(report.onlyTheirs, ['Первое theirs']);
  assert.deepEqual(report.conflicts, []);
  assert.equal(report.merged, 3);
});

test('merge-changelog: жирная подгруппа сохраняет принадлежность записи и порядок подгрупп', () => {
  const ours = `# Changelog

## Не выпущено

**Для пользователя:**

- **Кнопка** — ours

**Для агента:**

- **Правило** — ours
`;
  const theirs = `# Changelog

## Не выпущено

**Для пользователя:**

- **Форма** — theirs

**Для оператора:**

- **Метрика** — theirs
`;
  const { text } = mergeChangelog(ours, theirs);
  assert.equal(text, `# Changelog

## Не выпущено

**Для пользователя:**

- **Кнопка** — ours

- **Форма** — theirs

**Для агента:**

- **Правило** — ours

**Для оператора:**

- **Метрика** — theirs
`);
});

test('merge-changelog: разошедшиеся тела одного заголовка — обе редакции под меткой', () => {
  const ours = '# Changelog\n\n## Не выпущено\n\n- **Одна** — редакция ours\n';
  const theirs = '# Changelog\n\n## Не выпущено\n\n- **Одна** — редакция theirs\n';
  const { text, report } = mergeChangelog(ours, theirs);
  assert.deepEqual(report.conflicts, ['Одна']);
  assert.equal(text, `# Changelog

## Не выпущено

${CONFLICT_MARK} Одна -->
- **Одна** — редакция ours

- **Одна** — редакция theirs
`);
});

test('merge-changelog: с --base снятая стороной запись снимается, без базы остаётся', () => {
  const base = '# Changelog\n\n## Не выпущено\n\n- **Общая** — тело\n- **Снятая** — тело\n';
  const ours = '# Changelog\n\n## Не выпущено\n\n- **Общая** — тело\n- **Снятая** — тело\n';
  const theirs = '# Changelog\n\n## Не выпущено\n\n- **Общая** — тело\n';
  const withBase = mergeChangelog(ours, theirs, base);
  assert.deepEqual(withBase.report.dropped, ['Снятая']);
  assert.doesNotMatch(withBase.text, /Снятая/);
  const noBase = mergeChangelog(ours, theirs);
  assert.deepEqual(noBase.report.dropped, []);
  assert.deepEqual(noBase.report.onlyOurs, ['Снятая']);
  assert.match(noBase.text, /- \*\*Снятая\*\*/);

  // Обратное направление: запись есть в базе и у theirs, снял её ours.
  const reverse = mergeChangelog(theirs, ours, base);
  assert.deepEqual(reverse.report.dropped, ['Снятая']);
  assert.deepEqual(reverse.report.onlyTheirs, []);
  assert.doesNotMatch(reverse.text, /Снятая/);
});

test('merge-changelog: снятый по --base последний блок не уносит пустую строку перед следующей секцией', () => {
  const tail = '## v0.1.0 — 2026-01-01\n\n- **Старое** — выпущено\n';
  const ours = `# Changelog\n\n## Не выпущено\n\n${tail}`;
  const theirs = `# Changelog\n\n## Не выпущено\n\n- **Новая** — тело\n- **Снятая** — тело\n\n${tail}`;
  const base = `# Changelog\n\n## Не выпущено\n\n- **Снятая** — тело\n\n${tail}`;
  const merged = mergeChangelog(ours, theirs, base);
  assert.deepEqual(merged.report.dropped, ['Снятая']);
  assert.equal(merged.text, `# Changelog\n\n## Не выпущено\n\n- **Новая** — тело\n\n${tail}`);

  // Та же отбивка со стороны ours: запись снял theirs, и у ours она стояла последней.
  const oursLast = `# Changelog\n\n## Не выпущено\n\n- **Общая** — тело\n- **Снятая** — тело\n\n${tail}`;
  const theirsLast = `# Changelog\n\n## Не выпущено\n\n- **Общая** — тело\n\n${tail}`;
  const reverse = mergeChangelog(oursLast, theirsLast, base);
  assert.deepEqual(reverse.report.dropped, ['Снятая']);
  assert.equal(reverse.text, theirsLast);
});

test('merge-changelog: сливается только первая секция невыпущенного', () => {
  const ours = '# Changelog\n\n## Не выпущено\n\n- **Одна** — ours\n\n## v0.1.0\n\n- **Выпущенная** — ours\n';
  const theirs = '# Changelog\n\n## Не выпущено\n\n- **Две** — theirs\n\n## v0.1.0\n\n- **Выпущенная** — theirs\n';
  const { text } = mergeChangelog(ours, theirs);
  assert.match(text, /- \*\*Одна\*\* — ours/);
  assert.match(text, /- \*\*Две\*\* — theirs/);
  assert.match(text, /- \*\*Выпущенная\*\* — ours/, 'выпущенная секция берётся у ours целиком');
  assert.doesNotMatch(text, /- \*\*Выпущенная\*\* — theirs/);
});

test('merge-changelog: без секции невыпущенного у ours — отказ', () => {
  assert.throws(() => mergeChangelog('# Changelog\n\n## v0.1.0\n\n- **Одна** — ours\n', THEIRS), /нет секции невыпущенного/);
});

// `release --bump` переименовывает секцию невыпущенного в `## vX.Y.Z — <дата>` до тега.
const BUMPED = (body) => `# Changelog\n\n## v0.2.0 — 2026-02-01\n\n${body}\n## v0.1.0 — 2026-01-01\n\n- **Старое** — выпущено\n`;
const UNBUMPED = (body) => `# Changelog\n\n## Не выпущено\n\n${body}\n## v0.1.0 — 2026-01-01\n\n- **Старое** — выпущено\n`;
const onlyFirstTagged = (version) => version === '0.1.0';
const headings = (text) => text.match(/^## .+$/gm);
const entries = (text) => [...text.matchAll(/^- \*\*(.+?)\*\*/gm)].map((m) => m[1]);

test('merge-changelog: после бампа сливается верхняя секция версии без тега', () => {
  const base = BUMPED('- **Общее** — тело\n- **Снятая** — тело\n');
  const ours = BUMPED('- **Своя ours** — тело\n- **Общее** — тело\n- **Снятая** — тело\n');
  const theirs = BUMPED('- **Общее** — тело\n- **Своя theirs** — тело\n');
  const { text, report } = mergeChangelog(ours, theirs, base, 'ru', onlyFirstTagged);
  assert.deepEqual(report.section, { ours: 'v0.2.0 — 2026-02-01', theirs: 'v0.2.0 — 2026-02-01', base: 'v0.2.0 — 2026-02-01' });
  assert.deepEqual(report.onlyTheirs, ['Своя theirs']);
  assert.deepEqual(report.dropped, ['Снятая'], 'база после бампа читается тем же правилом');
  assert.deepEqual(headings(text), ['## v0.2.0 — 2026-02-01', '## v0.1.0 — 2026-01-01']);
  assert.deepEqual(entries(text), ['Своя ours', 'Общее', 'Своя theirs', 'Старое']);
});

test('merge-changelog: ours после бампа, theirs отрезан до него — записи theirs ложатся в секцию версии', () => {
  const ours = BUMPED('- **Своя ours** — тело\n- **Общее** — тело\n');
  const theirs = UNBUMPED('- **Общее** — тело\n- **Своя theirs** — тело\n');
  const { text, report } = mergeChangelog(ours, theirs, null, 'ru', onlyFirstTagged);
  assert.deepEqual(report.section, { ours: 'v0.2.0 — 2026-02-01', theirs: 'Не выпущено', base: null });
  assert.deepEqual(headings(text), ['## v0.2.0 — 2026-02-01', '## v0.1.0 — 2026-01-01']);
  assert.deepEqual(entries(text), ['Своя ours', 'Общее', 'Своя theirs', 'Старое']);
});

test('merge-changelog: бамп только у theirs — его записи не теряются', () => {
  const ours = UNBUMPED('- **Своя ours** — тело\n- **Общее** — тело\n');
  const theirs = BUMPED('- **Общее** — тело\n- **Своя theirs** — тело\n');
  const { text, report } = mergeChangelog(ours, theirs, null, 'ru', onlyFirstTagged);
  assert.equal(report.theirs, 2);
  assert.deepEqual(report.section, { ours: 'Не выпущено', theirs: 'v0.2.0 — 2026-02-01', base: null });
  assert.deepEqual(entries(text), ['Своя ours', 'Общее', 'Своя theirs', 'Старое']);
});

test('merge-changelog: верхняя секция версии с тегом выпущена — отказ', () => {
  const tagged = (version) => ['0.1.0', '0.2.0'].includes(version);
  assert.throws(() => mergeChangelog(BUMPED('- **Одна** — ours\n'), THEIRS, null, 'ru', tagged), /нет секции невыпущенного/);
});

test('merge-changelog: у theirs нет секции невыпущенного — отчёт говорит, что его записи не читались', () => {
  const root = makeProject({ prefix: 'BS' });
  try {
    put(root, 'CHANGELOG.md', '# Changelog\n\n## v0.1.0 — 2026-01-01\n\n- **Старое** — выпущено\n');
    gitAll(root, 'релиз 0.1.0');
    run(root, ['tag', 'v0.1.0']);
    run(root, ['checkout', '-qb', 'worker']);
    put(root, 'CHANGELOG.md', '# Changelog\n\n## v0.1.0 — 2026-01-01\n\n- **Старое** — выпущено\n- **Запись в выпущенной** — тело\n');
    gitAll(root, 'worker');
    run(root, ['checkout', '-q', 'main']);
    put(root, 'CHANGELOG.md', UNBUMPED('- **Своя ours** — тело\n'));
    gitAll(root, 'ours');

    const r = cli(root, ['merge-changelog', '--ours=main', '--theirs=worker', '--out=CHANGELOG.md']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.err, /записей: ours 1, theirs 0, в результате 1/);
    assert.match(r.err, /у theirs нет секции невыпущенного — записи theirs не читались/);
    assert.doesNotMatch(read(root, 'CHANGELOG.md'), /Запись в выпущенной/);
  } finally {
    cleanup(root);
  }
});

test('merge-changelog: команда сверяет версию секции с тегами репозитория', () => {
  const root = makeProject({ prefix: 'BS' });
  try {
    put(root, 'CHANGELOG.md', '# Changelog\n\n## v0.1.0 — 2026-01-01\n\n- **Старое** — выпущено\n');
    gitAll(root, 'релиз 0.1.0');
    run(root, ['tag', 'v0.1.0']);
    put(root, 'CHANGELOG.md', BUMPED('- **Общее** — тело\n'));
    gitAll(root, 'бамп 0.2.0');
    const bump = run(root, ['rev-parse', 'HEAD']).stdout.trim();
    run(root, ['checkout', '-qb', 'worker']);
    put(root, 'CHANGELOG.md', BUMPED('- **Общее** — тело\n- **Своя theirs** — тело\n'));
    gitAll(root, 'worker');
    run(root, ['checkout', '-q', 'main']);

    let r = cli(root, ['merge-changelog', '--ours=main', '--theirs=worker', `--base=${bump}`, '--out=CHANGELOG.md']);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(entries(read(root, 'CHANGELOG.md')), ['Общее', 'Своя theirs', 'Старое']);
    for (const side of ['ours', 'theirs', 'base']) {
      assert.match(r.err, new RegExp(`секция невыпущенного у ${side} — «v0\\.2\\.0 — 2026-02-01»: тега у версии нет`));
    }

    // Тег без `v` тоже выпускает версию.
    run(root, ['checkout', '--', 'CHANGELOG.md']);
    run(root, ['tag', '0.2.0']);
    r = cli(root, ['merge-changelog', '--ours=main', '--theirs=worker', '--out=CHANGELOG.md']);
    assert.equal(r.code, 1);
    assert.match(r.err, /нет секции невыпущенного/);
    assert.deepEqual(entries(read(root, 'CHANGELOG.md')), ['Общее', 'Старое'], 'отказ --out не трогает');
  } finally {
    cleanup(root);
  }
});

test('merge-changelog: команда читает редакции из git и пишет в --out, отчёт в stderr', () => {
  const root = makeProject({ prefix: 'BS' });
  try {
    put(root, 'CHANGELOG.md', OURS);
    gitAll(root, 'ours');
    run(root, ['checkout', '-qb', 'worker']);
    put(root, 'CHANGELOG.md', THEIRS);
    gitAll(root, 'theirs');
    run(root, ['checkout', '-q', 'main']);

    const r = cli(root, ['merge-changelog', '--ours=main', '--theirs=worker', '--out=CHANGELOG.md']);
    assert.equal(r.code, 0, r.err);
    assert.match(read(root, 'CHANGELOG.md'), /- \*\*Первое theirs\*\* — тело theirs/);
    assert.match(read(root, 'CHANGELOG.md'), /- \*\*Первое ours\*\* — тело ours/);
    assert.equal((read(root, 'CHANGELOG.md').match(/- \*\*Общее\*\*/g) ?? []).length, 1);
    assert.match(r.err, /записей: ours 2, theirs 2, в результате 3/);
    assert.match(r.err, /только у theirs: Первое theirs/);
    assert.equal(r.out, '', 'с --out данные в файл, stdout пуст');
  } finally {
    cleanup(root);
  }
});

test('merge-changelog: CHANGELOG.md больше 1 МиБ читается из git, а не обрывается ENOBUFS', () => {
  const root = makeProject({ prefix: 'BS' });
  try {
    const history = '- **Старая запись** — длинная история выпущенных версий\n'.repeat(20_000);
    put(root, 'CHANGELOG.md', `${OURS}${history}`);
    gitAll(root, 'ours');
    run(root, ['checkout', '-qb', 'worker']);
    put(root, 'CHANGELOG.md', `${THEIRS}${history}`);
    gitAll(root, 'theirs');
    run(root, ['checkout', '-q', 'main']);
    assert.ok(Buffer.byteLength(read(root, 'CHANGELOG.md')) > 1 << 20, 'файл больше буфера spawnSync по умолчанию');

    const r = cli(root, ['merge-changelog', '--ours=main', '--theirs=worker', '--out=CHANGELOG.md']);
    assert.equal(r.code, 0, r.err);
    assert.match(read(root, 'CHANGELOG.md'), /- \*\*Первое theirs\*\* — тело theirs/);
    assert.equal(read(root, 'CHANGELOG.md').split('- **Старая запись**').length - 1, 20_000);
  } finally {
    cleanup(root);
  }
});

test('merge-changelog: --base читается командой и снимает запись, которой сторона лишилась', () => {
  const root = makeProject({ prefix: 'BS' });
  try {
    put(root, 'CHANGELOG.md', '# Changelog\n\n## Не выпущено\n\n- **Общая** — тело\n\n- **Снятая** — тело\n');
    gitAll(root, 'база');
    const base = run(root, ['rev-parse', 'HEAD']).stdout.trim();
    run(root, ['checkout', '-qb', 'worker']);
    put(root, 'CHANGELOG.md', '# Changelog\n\n## Не выпущено\n\n- **Общая** — тело\n\n- **Своя у worker** — тело\n');
    gitAll(root, 'worker снял Снятую');
    run(root, ['checkout', '-q', 'main']);

    let r = cli(root, ['merge-changelog', `--ours=${base}`, '--theirs=worker', `--base=${base}`, '--out=CHANGELOG.md']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.err, /снята относительно --base: Снятая/);
    assert.doesNotMatch(read(root, 'CHANGELOG.md'), /Снятая/);
    assert.match(read(root, 'CHANGELOG.md'), /- \*\*Своя у worker\*\*/);

    // Без базы та же пара оставляет запись и не называет её снятой.
    r = cli(root, ['merge-changelog', `--ours=${base}`, '--theirs=worker', '--out=CHANGELOG.md']);
    assert.equal(r.code, 0, r.err);
    assert.doesNotMatch(r.err, /снята относительно --base/);
    assert.match(read(root, 'CHANGELOG.md'), /- \*\*Снятая\*\*/);
  } finally {
    cleanup(root);
  }
});

test('merge-changelog: без --out слитый файл идёт в stdout, без --ours и --theirs — отказ', () => {
  const root = makeProject({ prefix: 'BS' });
  try {
    put(root, 'CHANGELOG.md', OURS);
    gitAll(root, 'ours');
    let r = cli(root, ['merge-changelog', '--ours=HEAD', '--theirs=HEAD']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /^# Changelog\n/);
    assert.doesNotMatch(r.out, /записей:/, 'отчёт не попадает в данные');
    r = cli(root, ['merge-changelog', '--ours=HEAD']);
    assert.equal(r.code, 1);
    assert.match(r.err, /нужны --ours <ref> и --theirs <ref>/);
    r = cli(root, ['merge-changelog', '--ours=HEAD', '--theirs=нет-такой-ветки']);
    assert.equal(r.code, 1);
    assert.match(r.err, /не читается нет-такой-ветки:CHANGELOG\.md/);
  } finally {
    cleanup(root);
  }
});

// Секция с заголовками `### …`, буллетом без жирного заголовка и записями по обе стороны от
// него — ровно та форма, на которой v0.9.0 дублировала заголовок, выдумывала расхождение тел
// и переразмечала файл (BS-65).
const HEAD_OURS = `# Changelog

## Не выпущено

### Добавлено

- **Общая добавленная** — тело
- Буллет без жирного заголовка, продолжение которого
  идёт с отступом.
- **Своя у ours** — тело ours

### Исправлено

- **Новая у ours** — тело ours
- **Старая общая** — тело
`;

const HEAD_THEIRS = `# Changelog

## Не выпущено

### Добавлено

- **Общая добавленная** — тело
- Буллет без жирного заголовка, продолжение которого
  идёт с отступом.
- **Своя у theirs** — тело theirs

### Исправлено

- **Новая у theirs** — тело theirs
- **Старая общая** — тело
`;

// «−0 строк» карточки: результат получается из ours одними вставками, то есть каждая строка
// ours лежит в нём в том же порядке. Жадный проход — корректная проверка на подпоследовательность.
function insertionsOver(oursText, mergedText) {
  const ours = oursText.split('\n');
  const merged = mergedText.split('\n');
  let i = 0;
  for (const line of merged) if (i < ours.length && line === ours[i]) i += 1;
  assert.equal(i, ours.length, 'строка ours пропала из результата');
  return merged.length - ours.length;
}

test('merge-changelog: заголовок ### — граница записи, а не её тело', () => {
  const { text, report } = mergeChangelog(HEAD_OURS, HEAD_THEIRS);
  assert.deepEqual(report.conflicts, [], 'тела записей у сторон совпадают — расхождения нет');
  assert.equal((text.match(/^### Добавлено$/gm) ?? []).length, 1);
  assert.equal((text.match(/^### Исправлено$/gm) ?? []).length, 1);
  assert.equal((text.match(/- \*\*Общая добавленная\*\*/g) ?? []).length, 1);
  assert.equal((text.match(/^- Буллет без жирного заголовка/gm) ?? []).length, 1);
  // Буллет без жирного заголовка — свой блок: он не утягивает в тело соседней записи ни
  // себя, ни хвост секции вместе с её заголовком.
  assert.doesNotMatch(text, /- \*\*Общая добавленная\*\* — тело\n- Буллет[\s\S]*### Исправлено[\s\S]*\n- \*\*Общая добавленная\*\*/);
});

test('merge-changelog: аддитивное слияние только добавляет строки и не трогает раскладку', () => {
  const { text } = mergeChangelog(HEAD_OURS, HEAD_THEIRS);
  const added = insertionsOver(HEAD_OURS, text);
  assert.equal(added, 3, 'две записи theirs и одна их отбивка — и ни одной строки сверх');
  const blanks = (s) => (s.match(/^$/gm) ?? []).length;
  assert.equal(blanks(text), blanks(HEAD_OURS) + 1, 'пустые строки не размножаются');
});

test('merge-changelog: позиция записи сохраняется — новое сверху', () => {
  const { text } = mergeChangelog(HEAD_OURS, HEAD_THEIRS);
  const fixed = text.slice(text.indexOf('### Исправлено'));
  // У theirs запись стояла первой в своей секции — первой же встаёт и здесь, выше записи
  // ours, которая claims то же место: сторона, которую вливают, и есть новое.
  assert.match(fixed, /### Исправлено\n\n- \*\*Новая у theirs\*\* — тело theirs\n- \*\*Новая у ours\*\* — тело ours\n- \*\*Старая общая\*\*/);
  // А запись, стоявшая у theirs за общим буллетом, остаётся сразу за ним.
  assert.match(text, /идёт с отступом\.\n- \*\*Своя у theirs\*\* — тело theirs\n\n- \*\*Своя у ours\*\* — тело ours/);
});

test('merge-changelog: самопроверка отказывает и файл не отдаётся', () => {
  // Одна и та же жирная подгруппа приходит у сторон под разными заголовками: в результате
  // строка подгруппы встала бы дважды там, где у каждой стороны она одна. Слияние
  // отказывается, а не отдаёт файл с выросшей структурой.
  const ours = '# Changelog\n\n## Не выпущено\n\n### Добавлено\n\n**Для агента:**\n\n- **Одна** — ours\n';
  const theirs = '# Changelog\n\n## Не выпущено\n\n### Исправлено\n\n**Для агента:**\n\n- **Две** — theirs\n';
  assert.throws(() => mergeChangelog(ours, theirs), /не прошло собственную проверку.*«\*\*Для агента:\*\*».*2 раз/s);
});

test('merge-changelog: незакрытая метка конфликта — ненулевой код возврата', () => {
  const root = makeProject({ prefix: 'BS' });
  try {
    put(root, 'CHANGELOG.md', '# Changelog\n\n## Не выпущено\n\n- **Одна** — редакция ours\n');
    gitAll(root, 'ours');
    run(root, ['checkout', '-qb', 'worker']);
    put(root, 'CHANGELOG.md', '# Changelog\n\n## Не выпущено\n\n- **Одна** — редакция theirs\n');
    gitAll(root, 'theirs');
    run(root, ['checkout', '-q', 'main']);

    const r = cli(root, ['merge-changelog', '--ours=main', '--theirs=worker', '--out=CHANGELOG.md']);
    assert.equal(r.code, 1, 'незакрытый конфликт успехом не считается');
    assert.match(r.err, /осталось меток <!-- backslop:conflict: 1/);
    assert.match(read(root, 'CHANGELOG.md'), /<!-- backslop:conflict Одна -->/, 'файл всё равно записан — его и разбирать');

    // Метка, приехавшая из самой редакции, — тоже незакрытый конфликт, и слияние поверх неё
    // отказывается: обе редакции под меткой стоят под одним заголовком, и вторая пропала бы
    // как дубль. Отказ назван причиной, а не молчаливой потерей строк.
    put(root, 'CHANGELOG.md', `# Changelog\n\n## Не выпущено\n\n<!-- backslop:conflict Одна -->\n- **Одна** — редакция ours\n\n- **Одна** — редакция theirs\n`);
    gitAll(root, 'метка осталась');
    const again = cli(root, ['merge-changelog', '--ours=main', '--theirs=main', '--out=CHANGELOG.md']);
    assert.equal(again.code, 1);
    assert.match(again.err, /секция невыпущенного стороны --ours несёт незакрытую метку <!-- backslop:conflict/);
  } finally {
    cleanup(root);
  }
});

test('merge-changelog: имя метки прозой в код-спане — не метка', () => {
  // Собственное имя метки стоит в CHANGELOG любого проекта, который про неё написал: у
  // самого backslop — в записях v0.7.0 и v0.10.0. Подстрочная проверка считала это
  // незакрытым конфликтом и отказывала на каждом слиянии в его же репозитории.
  const released = '## v0.1.0 — 2026-01-01\n\n- **Слияние командой** — оставляет обе редакции под меткой `<!-- backslop:conflict … -->`, когда тела разошлись\n';
  const ours = `# Changelog\n\n## Не выпущено\n\n- **Своя у ours** — тело ours\n\n${released}`;
  const theirs = `# Changelog\n\n## Не выпущено\n\n- **Своя у theirs** — тело theirs\n\n${released}`;
  const { text, report } = mergeChangelog(ours, theirs);
  assert.equal(report.marks, 0, 'проза в выпущенной секции меткой не считается');
  assert.match(text, /- \*\*Своя у ours\*\*/);
  assert.match(text, /- \*\*Своя у theirs\*\*/);
  assert.equal(insertionsOver(ours, text), 2);
});

test('merge-changelog: имя метки прозой в самой сливаемой секции — тоже не метка', () => {
  // Запись про merge-changelog в проекте посреди цикла лежит именно в невыпущенном, то есть
  // ровно в сливаемой секции. Здесь от ложного отказа спасает только якорь начала строки:
  // сужение до секции не спасает, потому что секция та самая.
  const entry = '- **Слияние командой** — обе редакции под меткой `<!-- backslop:conflict … -->`\n';
  const ours = `# Changelog\n\n## Не выпущено\n\n${entry}- **Своя у ours** — тело ours\n`;
  const theirs = `# Changelog\n\n## Не выпущено\n\n${entry}- **Своя у theirs** — тело theirs\n`;
  const { text, report } = mergeChangelog(ours, theirs);
  assert.equal(report.marks, 0, 'метка — строка, которая с неё начинается, а не подстрока');
  assert.equal(report.conflicts.length, 0);
  assert.match(text, /- \*\*Своя у theirs\*\* — тело theirs/);
  assert.equal(insertionsOver(ours, text), 2, 'одна запись theirs с её отбивкой');
});

test('merge-changelog: имя метки прозой — код возврата 0, а строка-метка — 1', () => {
  const root = makeProject({ prefix: 'BS' });
  try {
    const released = '## v0.1.0 — 2026-01-01\n\n- **Слияние** — обе редакции под меткой `<!-- backslop:conflict … -->`\n';
    put(root, 'CHANGELOG.md', `# Changelog\n\n## Не выпущено\n\n- **Своя у ours** — тело\n\n${released}`);
    gitAll(root, 'ours');
    run(root, ['checkout', '-qb', 'worker']);
    put(root, 'CHANGELOG.md', `# Changelog\n\n## Не выпущено\n\n- **Своя у theirs** — тело\n\n${released}`);
    gitAll(root, 'theirs');
    run(root, ['checkout', '-q', 'main']);

    const r = cli(root, ['merge-changelog', '--ours=main', '--theirs=worker', '--out=CHANGELOG.md']);
    assert.equal(r.code, 0, r.err);
    assert.doesNotMatch(r.err, /незакрытую метку/);
    assert.doesNotMatch(r.err, /осталось меток/);
  } finally {
    cleanup(root);
  }
});

test('merge-changelog: повтор блока у ours — отказ называет повтор, а не потерю строк', () => {
  const ours = '# Changelog\n\n## Не выпущено\n\n- Повторённый буллет без заголовка\n- Повторённый буллет без заголовка\n';
  assert.throws(() => mergeChangelog(ours, ours), (e) => {
    assert.match(e.message, /сторона ours несёт повтор блока, второе вхождение снято: «Повторённый буллет без заголовка»/);
    assert.doesNotMatch(e.message, /потеряло строк/);
    return true;
  });
});

test('merge-changelog: односторонний буллет без заголовка называется в отчёте отдельной строкой', () => {
  const root = makeProject({ prefix: 'BS' });
  try {
    put(root, 'CHANGELOG.md', '# Changelog\n\n## Не выпущено\n\n- **Запись** — тело\n- Буллет, который есть у обеих сторон\n');
    gitAll(root, 'ours');
    run(root, ['checkout', '-qb', 'worker']);
    put(root, 'CHANGELOG.md', '# Changelog\n\n## Не выпущено\n\n- **Запись** — тело\n- Буллет, который есть у обеих сторон\n- Буллет соседнего track’а, приехавший один\n');
    gitAll(root, 'theirs');
    run(root, ['checkout', '-q', 'main']);

    const r = cli(root, ['merge-changelog', '--ours=main', '--theirs=worker', '--out=CHANGELOG.md']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.err, /только у theirs, буллет без заголовка: Буллет соседнего track’а, приехавший один/);
    // В счёт записей он не входит: запись опознаётся заголовком, буллет — своим текстом.
    assert.match(r.err, /записей: ours 1, theirs 1, в результате 1/);
    assert.match(read(root, 'CHANGELOG.md'), /- Буллет соседнего track’а, приехавший один/);
  } finally {
    cleanup(root);
  }
});

test('merge-changelog: снятый повтор называется в отчёте и когда до отказа не дошло', () => {
  const root = makeProject({ prefix: 'BS' });
  try {
    // База снимает запись, поэтому слияние не аддитивное и третий инвариант молчит. Строка
    // содержания при этом всё равно пропадает — сказать об этом обязан отчёт, а не отказ.
    put(root, 'CHANGELOG.md', '# Changelog\n\n## Не выпущено\n\n- **Общая** — тело\n- **Снятая** — тело\n- Буллет, который повторится\n');
    gitAll(root, 'база');
    const base = run(root, ['rev-parse', 'HEAD']).stdout.trim();
    run(root, ['checkout', '-qb', 'worker']);
    put(root, 'CHANGELOG.md', '# Changelog\n\n## Не выпущено\n\n- **Общая** — тело\n- Буллет, который повторится\n');
    gitAll(root, 'worker снял Снятую');
    run(root, ['checkout', '-q', 'main']);
    put(root, 'CHANGELOG.md', '# Changelog\n\n## Не выпущено\n\n- **Общая** — тело\n- **Снятая** — тело\n- Буллет, который повторится\n- Буллет, который повторится\n');
    gitAll(root, 'ours с повтором');

    const r = cli(root, ['merge-changelog', '--ours=main', '--theirs=worker', `--base=${base}`, '--out=CHANGELOG.md']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.err, /снята относительно --base: Снятая/);
    assert.match(r.err, /повтор блока у ours, второе вхождение снято: Буллет, который повторится/);
  } finally {
    cleanup(root);
  }
});

test('merge-changelog: повтор у theirs тоже называется — в общем seen он неотличим от пришедшего от ours', () => {
  const root = makeProject({ prefix: 'BS' });
  try {
    put(root, 'CHANGELOG.md', '# Changelog\n\n## Не выпущено\n\n- **Общая** — тело\n');
    gitAll(root, 'ours');
    run(root, ['checkout', '-qb', 'worker']);
    put(root, 'CHANGELOG.md', '# Changelog\n\n## Не выпущено\n\n- **Общая** — тело\n- Свой буллет worker’а\n- Свой буллет worker’а\n');
    gitAll(root, 'theirs с повтором');
    run(root, ['checkout', '-q', 'main']);

    const r = cli(root, ['merge-changelog', '--ours=main', '--theirs=worker', '--out=CHANGELOG.md']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.err, /повтор блока у theirs, второе вхождение снято: Свой буллет worker’а/);
    assert.equal((read(root, 'CHANGELOG.md').match(/- Свой буллет worker’а/g) ?? []).length, 1);
  } finally {
    cleanup(root);
  }
});

test('merge-changelog: имя метки с отступом — не метка, отступ поблажки не даёт', () => {
  // Настоящую метку `conflictEntry` ставит с первой колонки. Поблажка на отступ вернула бы
  // ложный отказ для имени метки в отступном блоке кода внутри сливаемой секции.
  const entry = '- **Слияние командой** — пример вывода:\n\n      <!-- backslop:conflict Одна -->\n\n';
  const ours = `# Changelog\n\n## Не выпущено\n\n${entry}- **Своя у ours** — тело ours\n`;
  const theirs = `# Changelog\n\n## Не выпущено\n\n${entry}- **Своя у theirs** — тело theirs\n`;
  const { text, report } = mergeChangelog(ours, theirs);
  assert.equal(report.marks, 0, 'отступная строка меткой не считается');
  assert.match(text, /- \*\*Своя у theirs\*\* — тело theirs/);
});
