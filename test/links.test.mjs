// Разбор и перепись ссылок markdown: все формы, что ломались при ручном переезде файла, плюс те,
// что трогать нельзя.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  blankCode, brokenLinks, directoryLinks, refDefinitions, relativeLinks, rewriteFoldedLinks, rewriteIncomingLinks, rewriteMovedLinks,
} from '../lib/links.js';

const FROM = 'docs/backlog/active';
const TO = 'docs/archive/BS-42-move-breaks-links';

test('перенесённый файл: цель пересчитывается от нового каталога', () => {
  for (const [before, after] of [
    ['[10](../../reference/10-validation.md)', '[10](../../reference/10-validation.md)'],
    ['[BS-7](../../archive/BS-7-x/task.md)', '[BS-7](../BS-7-x/task.md)'],
    ['[lint.js](../../../lib/lint.js)', '[lint.js](../../../lib/lint.js)'],
    ['[BS-41](BS-41-x.md)', '[BS-41](../../backlog/active/BS-41-x.md)'],
    ['[BS-40](../queue/BS-40-y.md)', '[BS-40](../../backlog/queue/BS-40-y.md)'],
  ]) {
    assert.equal(rewriteMovedLinks(before, FROM, TO), after);
  }
});

test('перенесённый файл: якорь, заголовок и угловые скобки сохраняются', () => {
  assert.equal(
    rewriteMovedLinks('[р](../queue/BS-40-y.md#итог)', FROM, TO),
    '[р](../../backlog/queue/BS-40-y.md#итог)',
  );
  assert.equal(
    rewriteMovedLinks('[р](../queue/BS-40-y.md "Заголовок")', FROM, TO),
    '[р](../../backlog/queue/BS-40-y.md "Заголовок")',
  );
  assert.equal(
    rewriteMovedLinks('[р](<../queue/BS-40-y.md>)', FROM, TO),
    '[р](<../../backlog/queue/BS-40-y.md>)',
  );
});

test('перенесённый файл: reference-style объявление переписывается', () => {
  assert.equal(
    rewriteMovedLinks('Смотри [очередь][q].\n\n[q]: ../queue/BS-40-y.md\n', FROM, TO),
    'Смотри [очередь][q].\n\n[q]: ../../backlog/queue/BS-40-y.md\n',
  );
});

test('перенесённый файл: внешние адреса и якоря не трогаются', () => {
  const outside = '[gh](https://github.com/x), [почта](mailto:a@b) и [раздел](#итог)';
  assert.equal(rewriteMovedLinks(outside, FROM, TO), outside);
});

const OLD = 'docs/backlog/active/BS-42-x.md';
const NEW = 'docs/archive/BS-42-x/task.md';

test('входящие ссылки: чинится ровно ссылка на переехавший файл', () => {
  assert.equal(
    rewriteIncomingLinks('[BS-42](BS-42-x.md)', 'docs/backlog/active', OLD, NEW),
    '[BS-42](../../archive/BS-42-x/task.md)',
  );
  assert.equal(
    rewriteIncomingLinks('[BS-42](../backlog/active/BS-42-x.md)', 'docs/reference', OLD, NEW),
    '[BS-42](../archive/BS-42-x/task.md)',
  );
  assert.equal(
    rewriteIncomingLinks('[BS-42](../../backlog/active/BS-42-x.md)', 'docs/archive/BS-30-y', OLD, NEW),
    '[BS-42](../BS-42-x/task.md)',
  );
  assert.equal(
    rewriteIncomingLinks('[BS-42](docs/backlog/active/BS-42-x.md)', '', OLD, NEW),
    '[BS-42](docs/archive/BS-42-x/task.md)',
  );
});

test('входящие ссылки: чужая ссылка рядом не трогается, якорь сохраняется', () => {
  const mixed = '[BS-42](BS-42-x.md#итог) и [BS-41](BS-41-y.md)';
  assert.equal(
    rewriteIncomingLinks(mixed, 'docs/backlog/active', OLD, NEW),
    '[BS-42](../../archive/BS-42-x/task.md#итог) и [BS-41](BS-41-y.md)',
  );
});

test('входящие ссылки: корневая ссылка на переехавший файл переписывается и остаётся корневой', () => {
  assert.equal(
    rewriteIncomingLinks('[BS-42](/docs/backlog/active/BS-42-x.md#итог) и [BS-41](/docs/backlog/active/BS-41-y.md)', 'docs', OLD, NEW),
    '[BS-42](/docs/archive/BS-42-x/task.md#итог) и [BS-41](/docs/backlog/active/BS-41-y.md)',
  );
  assert.equal(
    rewriteIncomingLinks('Смотри [задачу][t].\n\n[t]: </docs/backlog/active/BS-42-x.md>\n', '', OLD, NEW),
    'Смотри [задачу][t].\n\n[t]: </docs/archive/BS-42-x/task.md>\n',
  );
});

test('разбор: блоки кода, спаны и внешние адреса не дают ссылок', () => {
  const text = [
    'Живая [а](a.md) и внешняя [gh](https://x.y).',
    '',
    '```',
    '[пример](example.md)',
    '```',
    '',
    '````md',
    '```',
    '[вложенный](nested.md)',
    '```',
    '````',
    '',
    '1. Пункт:',
    '',
    '   ```json',
    '   [в отступе](indented.md)',
    '   ```',
    '',
    'Спан `[в кавычках](span.md)` и якорь [я](#top).',
    'Заголовок [б](b.md "title") и скобки [в](<c d.md>).',
  ].join('\n');
  assert.deepEqual(relativeLinks(text), ['a.md', 'b.md', 'c d.md']);
});

test('разбор: фенс с большим отступом во вложенном списке — всё ещё код; незакрытый фенс гасит до конца', () => {
  assert.deepEqual(relativeLinks('- пункт\n  - подпункт:\n\n      ```\n      [а](a.md)\n      ```\n\n[б](b.md)\n'), ['b.md']);
  assert.deepEqual(relativeLinks('```\n[а](a.md)\n\nтекст [б](b.md)\n'), []);
  assert.deepEqual(relativeLinks('~~~\n```\n[а](a.md)\n~~~\n[б](b.md)\n'), ['b.md']);
});

test('разбор: сноска — не объявление ссылки; объявление после заголовка — объявление', () => {
  assert.deepEqual(relativeLinks('Текст[^1].\n\n[^1]: Пояснение сноски.\n'), []);
  assert.deepEqual(refDefinitions('# Заголовок\n[a]: a.md\n'), ['a.md']);
});

test('перепись: корневой путь и query не трогаются', () => {
  assert.equal(rewriteMovedLinks('[к](/docs/README.md)', FROM, TO), '[к](/docs/README.md)');
  assert.equal(rewriteMovedLinks('[з](../queue/BS-40-y.md?plain=1)', FROM, TO), '[з](../../backlog/queue/BS-40-y.md?plain=1)');
});

test('свёртка: корневая цель и каталог со слэшем доходят до resolve путём от корня, форма ссылки сохраняется', () => {
  const seen = [];
  const resolve = (target, href) => {
    seen.push([target, href]);
    return target === 'docs/archive/BS-1-x' || target === 'docs/archive/BS-1-x/task.md'
      ? { path: 'docs/archive/LOG.md', anchor: 'bs-1' }
      : null;
  };
  const text = [
    '[к](/docs/archive/BS-1-x/task.md#контекст) [д](../archive/BS-1-x/) [у](<../archive/BS-1-x/> "каталог")',
    '[о](../archive/BS-1-x/notes.md) [gh](https://x.y/docs/archive/BS-1-x/task.md) [я](#итог)',
    '',
    '[r]: /docs/archive/BS-1-x/',
  ].join('\n');
  assert.equal(rewriteFoldedLinks(text, 'docs/backlog', resolve), [
    '[к](/docs/archive/LOG.md#bs-1) [д](../archive/LOG.md#bs-1) [у](<../archive/LOG.md#bs-1> "каталог")',
    '[о](../archive/BS-1-x/notes.md) [gh](https://x.y/docs/archive/BS-1-x/task.md) [я](#итог)',
    '',
    '[r]: /docs/archive/LOG.md#bs-1',
  ].join('\n'));
  // Нераспознанная цель приходит в resolve как написана — по ней свёртка называет ссылку в итоге.
  assert.deepEqual(seen.find(([, href]) => href.endsWith('notes.md')), ['docs/archive/BS-1-x/notes.md', '../archive/BS-1-x/notes.md']);
  assert.ok(!seen.some(([, href]) => /^(https?:|#)/.test(href)), 'внешний адрес и якорь в resolve не попадают');
});

test('разбор: reference-style объявление только в начале абзаца', () => {
  assert.deepEqual(refDefinitions('[a]: a.md\n[a2]: a2.md\n\nтекст\n[b]: b.md\n[c]: c.md\n'), ['a.md', 'a2.md']);
  assert.deepEqual(refDefinitions('Первая строка абзаца,\n[Заметка]: пояснение\n'), []);
  assert.equal(blankCode('x `y` z'), 'x     z');
});

test('битые ссылки файла: цель резолвится от его каталога, якорь отбрасывается', () => {
  const sb = mkdtempSync(path.join(os.tmpdir(), 'backslop-links-'));
  try {
    mkdirSync(path.join(sb, 'docs', 'reference'), { recursive: true });
    writeFileSync(path.join(sb, 'docs', 'reference', 'README.md'), '# Справочник\n');
    const file = path.join(sb, 'docs', 'note.md');
    writeFileSync(file, '[ж](reference/README.md#верх) [м](reference/missing.md) [в](https://x.y) [к](/docs/reference/README.md?plain=1) [н](/nope.md)\n');
    assert.deepEqual(brokenLinks(file, sb), ['reference/missing.md', '/nope.md']);
  } finally {
    rmSync(sb, { recursive: true, force: true });
  }
});

test('ссылки на каталог: только существующий каталог, текст — из исходника, показанное в коде не считается', () => {
  const sb = mkdtempSync(path.join(os.tmpdir(), 'backslop-links-'));
  try {
    mkdirSync(path.join(sb, 'docs', 'triage'), { recursive: true });
    writeFileSync(path.join(sb, 'docs', 'triage', 'BS-5-x.md'), '# BS-5 · Х\n');
    const file = path.join(sb, 'docs', 'note.md');
    writeFileSync(file, '[a](triage) [ф](triage/BS-5-x.md) [н](none) [`BS-5`](triage/#x) [в](https://x.y) [к](/docs/triage) `[s](triage)`\n\n```\n[f](triage)\n```\n');
    assert.deepEqual(directoryLinks(file, sb), [
      { text: 'a', href: 'triage' },
      { text: '`BS-5`', href: 'triage/#x' },
      { text: 'к', href: '/docs/triage' },
    ]);
  } finally {
    rmSync(sb, { recursive: true, force: true });
  }
});

test('ссылки на каталог: reference-style — полная, свёрнутая и краткая формы, метка без регистра', () => {
  const sb = mkdtempSync(path.join(os.tmpdir(), 'backslop-links-'));
  try {
    mkdirSync(path.join(sb, 'docs', 'triage'), { recursive: true });
    writeFileSync(path.join(sb, 'docs', 'triage', 'BS-5-x.md'), '# BS-5 · Х\n');
    const file = path.join(sb, 'docs', 'note.md');
    writeFileSync(file, [
      'Полная [BS-5][f], регистр [`BS-6`][F], свёрнутая [BS-7][] и краткая [BS-8].',
      'Файл [BS-9][card], инлайн [a](triage/BS-5-x.md), спан `[BS-10][f]`, чекбокс [x] без объявления.',
      '',
      '[f]: triage',
      '[bs-7]: <triage/>',
      '[BS-8]: /docs/triage#x',
      '[card]: triage/BS-5-x.md',
      '',
      'Абзац',
      '[late]: triage',
      '',
      '```',
      '[code]: triage',
      '```',
      '[Late] и [code].',
    ].join('\n'));
    assert.deepEqual(directoryLinks(file, sb), [
      { text: 'BS-5', href: 'triage' },
      { text: '`BS-6`', href: 'triage' },
      { text: 'BS-7', href: 'triage/' },
      { text: 'BS-8', href: '/docs/triage#x' },
    ]);
  } finally {
    rmSync(sb, { recursive: true, force: true });
  }
});

test('ссылки на каталог: текст — от ближайшей скобки, путь через файл — не каталог и не отказ', () => {
  const sb = mkdtempSync(path.join(os.tmpdir(), 'backslop-links-'));
  try {
    mkdirSync(path.join(sb, 'docs', 'triage'), { recursive: true });
    writeFileSync(path.join(sb, 'docs', 'triage', 'BS-5-x.md'), '# BS-5 · Х\n');
    const file = path.join(sb, 'docs', 'note.md');
    writeFileSync(file, 'Полуинтервал [0, 1) — см. BS-5. Шаблоны — [templates/](triage).\nЕщё [полуинтервал — BS-5,\nи [каталог](triage/).\n[BS-5](triage/BS-5-x.md/x)\n');
    assert.deepEqual(directoryLinks(file, sb), [
      { text: 'templates/', href: 'triage' },
      { text: 'каталог', href: 'triage/' },
    ]);
  } finally {
    rmSync(sb, { recursive: true, force: true });
  }
});
