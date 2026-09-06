// Чистые функции задач: имена, номера, шапка, порядок очереди.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FIELD_CREATED, FIELD_ORDER, FIELD_TAKEN, SECTION_DEFERRED, appendSection, formatId, getField, idMentionRe,
  nextNumber, nextSub, parseId, placeInQueue, readFields, readTitle, removeField, sectionBody, setField, taskDirRe, taskFileRe,
} from '../lib/tasks.js';

test('имя файла задачи: номер, sub-ID и slug', () => {
  const re = taskFileRe('BS');
  assert.deepEqual('BS-12-drop-index.md'.match(re).slice(1), ['12', undefined, 'drop-index']);
  assert.deepEqual('BS-12.3-finding.md'.match(re).slice(1), ['12', '3', 'finding']);
  assert.equal('bs-12-x.md'.match(re), null);
  assert.equal('BS-12-Drop.md'.match(re), null);
  assert.equal('BS-12-.md'.match(re), null);
  assert.deepEqual('BS-7.1-a-b'.match(taskDirRe('BS')).slice(1), ['7', '1', 'a-b']);
});

test('разбор номера из аргумента', () => {
  assert.deepEqual(parseId('12', 'BS'), { num: 12, sub: null });
  assert.deepEqual(parseId('BS-12.3', 'BS'), { num: 12, sub: 3 });
  assert.deepEqual(parseId('bs-4', 'BS'), { num: 4, sub: null });
  assert.throws(() => parseId('x12', 'BS'), /не разбирается/);
  assert.equal(formatId('BS', 12, 3), 'BS-12.3');
});

test('упоминания в тексте: BS-12.3 не читается как BS-12', () => {
  const found = [...'см. BS-12, BS-12.3 и BS-7; BSX-1 и ABS-2 не наши'.matchAll(idMentionRe('BS'))].map((m) => m[0]);
  assert.deepEqual(found, ['BS-12', 'BS-12.3', 'BS-7']);
});

test('следующий номер и sub-ID считаются по всем статусам и архиву', () => {
  const tasks = [
    { num: 3, sub: null, status: 'queue' },
    { num: 9, sub: null, status: 'archive' },
    { num: 9, sub: 2, status: 'triage' },
    { num: 5, sub: 1, status: 'active' },
  ];
  assert.equal(nextNumber(tasks), 10);
  assert.equal(nextSub(tasks, 9), 3);
  assert.equal(nextSub(tasks, 3), 1);
  assert.equal(nextNumber([]), 1);
});

const HEADER = '# BS-1 · Заголовок\n\n- **Область:** [x](../reference/a.md)\n- **Создана:** 2026-09-03\n\n## Контекст\n\nтекст\n';

test('шапка: заголовок, поля, замена и вставка', () => {
  assert.deepEqual(readTitle(HEADER), { id: 'BS-1', title: 'Заголовок' });
  assert.deepEqual([...readFields(HEADER).keys()], ['Область', 'Создана']);
  const taken = setField(HEADER, FIELD_TAKEN, '2026-09-04');
  assert.deepEqual([...readFields(taken).keys()], ['Область', 'Создана', 'Взята']);
  const ordered = setField(taken, FIELD_ORDER, '30');
  assert.deepEqual([...readFields(ordered).keys()], ['Порядок', 'Область', 'Создана', 'Взята']);
  assert.equal(readFields(setField(ordered, FIELD_ORDER, '40')).get('Порядок'), '40');
  assert.equal(removeField(removeField(ordered, FIELD_ORDER), FIELD_TAKEN), HEADER);
  assert.equal(removeField(HEADER, 'Нет такого'), HEADER);
});

test('шапка: поле вставляется в файл без полей через пустые строки', () => {
  const bare = '# BS-2 · Голый\n\n## Контекст\n';
  const withField = setField(bare, FIELD_ORDER, '10');
  assert.equal(withField, '# BS-2 · Голый\n\n- **Порядок:** 10\n\n## Контекст\n');
  assert.equal(setField('# BS-3 · Без пустой\n## Контекст\n', FIELD_ORDER, '10'),
    '# BS-3 · Без пустой\n\n- **Порядок:** 10\n\n## Контекст\n');
});

test('шапка: RU и EN metadata читаются вместе, новые labels выбирает lang', () => {
  const mixed = '# BS-4 · Mixed\n\n- **Created:** 2026-09-03\n- **Порядок:** 10\n- **Taken:** 2026-09-04\n\n## Deferred\n\nreason\n';
  assert.equal(getField(mixed, FIELD_CREATED), '2026-09-03');
  assert.equal(getField(mixed, FIELD_ORDER), '10');
  assert.equal(getField(mixed, FIELD_TAKEN), '2026-09-04');
  assert.equal(sectionBody(mixed, SECTION_DEFERRED), 'reason');
  assert.match(setField(mixed, FIELD_ORDER, '20', 'en'), /- \*\*Order:\*\* 20/);
  assert.match(appendSection('# BS-5 · English\n', SECTION_DEFERRED, 'reason', 'en'), /## Deferred/);
});

test('шапка: чтение и запись дубля поля используют первое вхождение и схлопывают алиасы', () => {
  const duplicate = '# BS-6 · Duplicate\n\n- **Order:** 30\n- **Порядок:** 25\n- **Order:** 20\n';
  assert.equal(readFields(duplicate).get('Order'), '30');
  assert.equal(getField(duplicate, FIELD_ORDER), '30');
  const changed = setField(duplicate, FIELD_ORDER, '5');
  assert.equal(getField(changed, FIELD_ORDER), '5');
  assert.equal((changed.match(/^- \*\*[^*]+:\*\*/gm) ?? []).length, 1);
  assert.doesNotMatch(changed, /Order:\*\* 25|Order:\*\* 20|Порядок:\*\* 25|Порядок:\*\* 20/);
  assert.doesNotMatch(removeField(duplicate, FIELD_ORDER), /Order|Порядок/);
});

test('разделы: тело до следующего заголовка и дописывание в конец', () => {
  assert.equal(sectionBody(HEADER, 'Контекст'), 'текст');
  assert.equal(sectionBody(HEADER, 'Отложено'), null);
  const withDeferred = appendSection(HEADER, 'Отложено', '- **Причина:** нет раннера');
  assert.equal(sectionBody(withDeferred, 'Отложено'), '- **Причина:** нет раннера');
  assert.equal(sectionBody(withDeferred, 'Контекст'), 'текст');
  const indented = '# BS-6 · Отступ\n\n  ## Отложено\n\n- **Причина:** нет раннера\n\n  ## Контекст\n\nтекст\n';
  assert.equal(sectionBody(indented, 'Отложено'), '- **Причина:** нет раннера');
  assert.equal(sectionBody(indented, 'Контекст'), 'текст');
  assert.equal(sectionBody('# BS-7 · Код\n\n    ## Отложено\n\n    не раздел\n', 'Отложено'), null);
});

const row = (num, rank) => ({ task: { num, sub: null, file: `f${num}` }, rank });

test('место в очереди: конец, верх, после задачи, середина между соседями', () => {
  const rows = [row(1, 10), row(2, 20), row(3, 30)];
  assert.deepEqual(placeInQueue(rows), { rank: 40, renumbered: [] });
  assert.deepEqual(placeInQueue([]), { rank: 10, renumbered: [] });
  assert.deepEqual(placeInQueue(rows, { after: { num: 1, sub: null } }), { rank: 15, renumbered: [] });
  assert.deepEqual(placeInQueue(rows, { after: { num: 3, sub: null } }), { rank: 40, renumbered: [] });
  assert.deepEqual(placeInQueue([row(1, 30)], { top: true }), { rank: 15, renumbered: [] });
  assert.throws(() => placeInQueue(rows, { after: { num: 9, sub: null } }), /в очереди нет/);
});

test('место в очереди: без целого места очередь перенумеровывается шагом 10', () => {
  const tight = [row(1, 1), row(2, 2), row(3, 3)];
  const top = placeInQueue(tight, { top: true });
  assert.equal(top.rank, 10);
  assert.deepEqual(top.renumbered, [['f1', 20], ['f2', 30], ['f3', 40]]);
  const mid = placeInQueue(tight, { after: { num: 1, sub: null } });
  assert.equal(mid.rank, 20);
  assert.deepEqual(mid.renumbered, [['f1', 10], ['f2', 30], ['f3', 40]]);
});
