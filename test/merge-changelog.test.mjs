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
