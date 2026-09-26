// Чистые функции задач: имена, номера, шапка, порядок очереди.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FIELD_CREATED, FIELD_ORDER, FIELD_TAKEN, SECTION_DEFERRED, appendSection, formatId, getField, idMentionRe,
  nextNumber, nextSub, parseId, placeInQueue, readFields, readTitle, removeField, sectionBody, sectionOccurrences, setField, taskDirRe, taskFileRe,
} from '../lib/tasks.js';
import { appendLogLines, batchOf, brokenLogLines, dateFromResult, formatLogLine, hasNamedOutcome, outcomeFromResult, parseLogLine } from '../lib/log.js';

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
test('разделы: заголовок внутри fenced-примера не считается повтором', () => {
  const text = `${HEADER}\n## Отложено\n\nпример\n\`\`\`markdown\n## Отложено\n\`\`\`\n`;
  assert.equal(sectionOccurrences(text, SECTION_DEFERRED), 1);
  assert.equal(sectionOccurrences(text.replace('## Отложено\n\nпример\n', ''), SECTION_DEFERRED), 0);
  assert.equal(sectionBody(text.replace('## Отложено\n\nпример\n', ''), SECTION_DEFERRED), null);
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

test('место в очереди: сохранённый ранг не позже соседа по пакету', () => {
  const rows = [row(9, 5), row(1, 10), row(2, 20)];
  const nine = { num: 9, sub: null };
  assert.deepEqual(placeInQueue(rows, { rank: 8, before: nine }), { rank: 2, renumbered: [], bounded: true }, 'свободное число позади соседа');
  assert.deepEqual(placeInQueue(rows, { rank: 20, before: nine }), { rank: 2, renumbered: [], bounded: true }, 'занятое число позади соседа');
  assert.deepEqual(placeInQueue(rows, { rank: 5, before: nine }), { rank: 2, renumbered: [] }, 'число занято самим соседом — обычное «перед занявшим»');
  assert.deepEqual(placeInQueue(rows, { rank: 3, before: nine }), { rank: 3, renumbered: [] }, 'число впереди соседа сосед не трогает');
  assert.deepEqual(placeInQueue(rows, { rank: 3, before: { num: 2, sub: null } }), { rank: 3, renumbered: [] });
  const tight = placeInQueue([row(1, 1), row(9, 2), row(2, 3)], { rank: 3, before: nine });
  assert.deepEqual(tight, { rank: 20, renumbered: [['f1', 10], ['f9', 30], ['f2', 40]], bounded: true }, 'тесно — перенумерация, задача перед соседом');
});

test('место в очереди: пакет --restore ложится по возрастанию сохранённых чисел — перебор', () => {
  // Модель цикла `mv <N…> queue --restore`: убывание сохранённых чисел, при равных — номеров,
  // каждая следующая с `before` на поставленную перед ней. Seed фиксирован — перебор повторяем.
  let seed = 30;
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = (lo, hi) => lo + Math.floor(random() * (hi - lo + 1));
  const byRank = (a, b) => a.rank - b.rank || a.task.num - b.task.num;
  const restore = (queue, batch, bound) => {
    const rows = queue.map((r) => ({ ...r }));
    let previous = null;
    let bounded = 0;
    for (const b of [...batch].sort((x, y) => y.saved - x.saved || y.task.num - x.task.num)) {
      rows.sort(byRank);
      const placed = placeInQueue(rows, { rank: b.saved, before: bound ? previous : null });
      const renumbered = new Map(placed.renumbered);
      for (const r of rows) r.rank = renumbered.get(r.task.file) ?? r.rank;
      rows.push({ task: b.task, rank: placed.rank });
      if (placed.bounded) bounded += 1;
      previous = b.task;
    }
    const got = rows.sort(byRank).filter((r) => r.task.file.startsWith('b')).map((r) => r.task.num);
    const want = [...batch].sort((x, y) => x.saved - y.saved || x.task.num - y.task.num).map((b) => b.task.num);
    return { inverted: got.join() !== want.join(), bounded };
  };

  const RUNS = 100_000;
  let inverted = 0;
  let unbounded = 0;
  let bounded = 0;
  for (let i = 0; i < RUNS; i += 1) {
    const queue = Array.from({ length: pick(1, 4) }, (_, k) => ({ task: { num: 50 + k, sub: null, file: `q${k}` }, rank: pick(1, 14) }));
    const batch = Array.from({ length: pick(2, 4) }, (_, k) => ({ task: { num: k + 1, sub: null, file: `b${k}` }, saved: pick(1, 14) }));
    const run = restore(queue, batch, true);
    if (run.inverted) inverted += 1;
    bounded += run.bounded;
    if (restore(queue, batch, false).inverted) unbounded += 1;
  }
  assert.equal(inverted, 0, `${inverted} конфигураций из ${RUNS} — восстановленные не по возрастанию сохранённых чисел`);
  assert.ok(unbounded > 0, 'без соседа-ограничителя перебор обязан находить инверсии — иначе он не видит дефекта');
  assert.ok(bounded > 0, 'перебор ни разу не дошёл до ограничения соседом');
});

// --- журнал закрытых ---------------------------------------------------------------------------

test('строка журнала: разбор, обратная сборка, битая строка не читается записью', () => {
  const line = '- <a id="bs-12.3"></a>`BS-12.3-finding` · 2026-09-03 · слита в BS-4 · `a1b2c3d4e5` · Заголовок · с точкой';
  const e = parseLogLine(line, 'BS');
  assert.deepEqual(
    { id: e.id, num: e.num, sub: e.sub, slug: e.slug, date: e.date, outcome: e.outcome, commit: e.commit, title: e.title, anchor: e.anchor },
    { id: 'BS-12.3', num: 12, sub: 3, slug: 'finding', date: '2026-09-03', outcome: 'слита в BS-4', commit: 'a1b2c3d4e5', title: 'Заголовок · с точкой', anchor: 'bs-12.3' },
  );
  assert.equal(formatLogLine({ id: 'BS-12.3', slug: 'finding', date: '2026-09-03', outcome: 'слита в BS-4', commit: 'a1b2c3d4e5', title: 'Заголовок · с точкой' }), line);
  // Коммит и исход, которых свёртка не узнала, — длинным тире; строка остаётся разбираемой.
  const bare = formatLogLine({ id: 'BS-1', slug: 'a', date: '2026-09-03', outcome: '—', commit: null, title: null });
  assert.equal(bare, '- <a id="bs-1"></a>`BS-1-a` · 2026-09-03 · — · — · —');
  assert.equal(parseLogLine(bare, 'BS').commit, null);
  assert.equal(parseLogLine('- обычный пункт списка', 'BS'), null);
  assert.equal(parseLogLine('- <a id="bs-1"></a>`BS-1-a` · вчера · выполнена · — · А', 'BS'), null);
  assert.deepEqual(brokenLogLines('- <a id="bs-1"></a>мусор\n- обычный пункт\n', 'BS').map((b) => b.line), [1]);
});

test('исход читается из первого абзаца result.md, обеими языковыми формами; не назван — тире', () => {
  const result = (body) => `# BS-1 · Результат\n\n${body}\n\n**Проверки.** Тут слово отклонена ничего не значит.\n`;
  assert.equal(outcomeFromResult(result('**Закрыта 2026-09-03.** Выполнена. Итог.'), 'BS', 'ru'), 'выполнена');
  assert.equal(outcomeFromResult(result('**Closed 2026-09-03.** Completed. Done.'), 'BS', 'ru'), 'выполнена');
  assert.equal(outcomeFromResult(result('**Закрыта 2026-09-03.** Отклонена.'), 'BS', 'en'), 'rejected');
  assert.equal(outcomeFromResult(result('**Закрыта 2026-09-03.** Слита в [BS-14](../BS-14-x/task.md). Выполнена там.'), 'BS', 'ru'), 'слита в BS-14');
  assert.equal(outcomeFromResult(result('Сделано по варианту (b).'), 'BS', 'ru'), '—');
  assert.equal(dateFromResult(result('**Закрыта 2026-09-03.** Выполнена.')), '2026-09-03');
  assert.equal(dateFromResult(result('**Закрыта.** Выполнена.')), null);
  assert.equal(batchOf('пачкой BS-4'), 'BS-4');
  assert.equal(batchOf('batch BS-4'), 'BS-4');
  assert.equal(batchOf('выполнена'), null);
});

// Заголовок и первый абзац — буквально из истории потребителей;
// `cut` — абзац обрезан до первой фразы.
const EVIDENCE = JSON.parse(readFileSync(new URL('./fixtures/outcome-first-paragraphs.json', import.meta.url), 'utf8'));

test('исход — первое по позиции слово словаря: записи, которые перебор словаря называл не тем исходом', () => {
  assert.equal(EVIDENCE.length, 15);
  const got = EVIDENCE.map((e) => {
    const [prefix] = e.id.split('-');
    const text = `${e.heading}\n\n${e.paragraph}\n\n## Проверки\n\nНиже абзаца «отклонена» и «слита в ${prefix}-1» — не исход.\n`;
    return [e.id, outcomeFromResult(text, prefix, prefix === 'PB' ? 'en' : 'ru')];
  });
  assert.deepEqual(got, EVIDENCE.map((e) => [e.id, e.outcome]));
});

test('исход по позиции: ведущее слово сильнее прозы, слияние — только с номером сразу после формы, отрицание — не слияние', () => {
  const ru = (body) => outcomeFromResult(`# BS-1 · Результат\n\n${body}\n`, 'BS', 'ru');
  assert.equal(ru('Слита в BS-14. Выполнена там.'), 'слита в BS-14');
  assert.equal(ru('Completed. Rejected option recorded.'), 'выполнена');
  assert.equal(ru('Выполнена; вариант с флагом отклонён.'), 'выполнена');
  assert.equal(ru('**Закрыта.** Не слита в BS-3: предмет другой.'), 'выполнена');
  assert.equal(ru('Closed; not merged into BS-3.'), 'выполнена');
  assert.equal(ru('Слито в main.'), '—');
  assert.equal(ru('Merged into it, BS-3 is the rest.'), '—');
  assert.equal(ru('Слита в `BS-7`.'), 'слита в BS-7');
  assert.equal(ru('Слита в BL-7.'), '—', 'номер чужого проекта — не слияние');
  assert.equal(ru('**Закрыта 2026-08-30.** Гейт-сверщик двух копий отклонён: список короткий.'), 'выполнена', 'мужской род — отвергнутый вариант, а не задача');
  assert.equal(ru('Отклонено решением владельца.'), 'отклонена');
  assert.equal(ru('Закрыта отклонением.'), 'отклонена');
  assert.equal(ru('Отклонение от плана — в разделе ниже.'), '—');
  assert.equal(ru('**Закрыта 2026-09-24** с отклонением от постановки: флаг не заведён.'), 'выполнена', '«с отклонением» — ход работы, а не исход');
  // Заголовок формой «— результат: <исход>» — источник наравне со скобками и слабее абзаца.
  assert.equal(outcomeFromResult('# PB-1 — Result: rejected\n\n**Closed 2026-09-01.**\n', 'PB', 'en'), 'rejected');
  assert.equal(outcomeFromResult('# BL-1 — результат: отклонена\n\nВыполнена.\n', 'BL', 'ru'), 'выполнена');
  assert.equal(outcomeFromResult('# BL-1 · Результат\n\n**Закрыта:** 2026-08-31.\n\nрезультат: отклонена\n', 'BL', 'ru'), 'выполнена');
});

// Заголовки и первые абзацы ниже — реальные строки result.md: не причёсывать.
test('дата закрытия: первый абзац сильнее заголовка result.md, заголовок — формой «(<исход> ГГГГ-ММ-ДД)»', () => {
  assert.equal(dateFromResult('# BL-005 — результат (снята с плана 2026-08-13)\n\nПлан сменился.\n'), '2026-08-13');
  assert.equal(dateFromResult('# BL-001 — результат (выполнена 2026-07-30)\n\n**Исход:** закрыта.\n'), '2026-07-30');
  assert.equal(dateFromResult('# BL-001 — результат (выполнена 2026-07-30)\n\n**Закрыта 2026-08-30.** Run 0830c, worker sync-doctor; ревью xhigh.\n'), '2026-08-30');
  assert.equal(dateFromResult('# PB-40 · Result\n\n**Outcome:** completed — closed by PB-37 (ADR-005), item by item.\n'), null);
  assert.equal(dateFromResult('# BS-1 · Результат 2026-07-30\n\n**Закрыта.** Выполнена.\n'), null, 'дата заголовка читается только в скобках');
});

test('исход старых архивов: заголовок «(<исход> ДАТА)», голое «Закрыта» / «Closed» / «Done»; названный исход сильнее голого', () => {
  const result = (head, body) => `${head}\n\n${body}\n\n**Проверки.** Гейты зелёные.\n`;
  assert.equal(outcomeFromResult(result('# BL-005 — результат (снята с плана 2026-08-13)', 'План сменился.'), 'BL', 'ru'), 'отклонена');
  assert.equal(outcomeFromResult(result('# BL-001 — результат (выполнена 2026-07-30)', 'Сделано по варианту (b).'), 'BL', 'en'), 'completed');
  assert.equal(outcomeFromResult(result('# BL-7 · Результат', '**Закрыта 2026-08-30.** Run 0830c, worker sync-doctor; ревью xhigh.'), 'BL', 'ru'), 'выполнена');
  assert.equal(outcomeFromResult(result('# PB-9 · Result', '**Closed 2026-09-05.** Done.'), 'PB', 'en'), 'completed');
  assert.equal(outcomeFromResult(result('# BL-8 · Результат', '**Исход:** закрыта.'), 'BL', 'ru'), 'выполнена');
  assert.equal(outcomeFromResult(result('# PB-40 · Result', '**Outcome:** completed — closed by PB-37 (ADR-005), item by item.'), 'PB', 'en'), 'completed');
  assert.equal(outcomeFromResult(result('# PB-41 · Result', '**Closed as dead weight removed, not as a defect fixed.**'), 'PB', 'en'), 'completed');
  // Голое «закрыта» — исход, пока другого слова нет ни в абзаце, ни в заголовке;
  // абзац сильнее заголовка.
  assert.equal(outcomeFromResult(result('# BL-005 — результат (снята с плана 2026-08-13)', '**Закрыта 2026-08-13.** План сменился.'), 'BL', 'ru'), 'отклонена');
  assert.equal(outcomeFromResult(result('# BL-001 — результат (отклонена 2026-07-30)', '**Закрыта 2026-07-30.** Выполнена.'), 'BL', 'ru'), 'выполнена');
  assert.equal(outcomeFromResult(result('# BL-9 · Результат (слита в BL-3 2026-08-01)', 'Дубль.'), 'BL', 'ru'), 'слита в BL-3');
  // Слияние и снятие с датой или разметкой внутри формы.
  assert.equal(outcomeFromResult(result('# BL-472 · Результат', '**Слита 2026-09-03 в [BL-470](../BL-470-canary-env-hygiene/task.md)** при разборе Triage.'), 'BL', 'ru'), 'слита в BL-470');
  assert.equal(outcomeFromResult(result('# BL-173 · Результат', 'Закрыта: 2026-08-27. Исход — **слита** в [BL-172](../BL-172-reviewer-spawn-task-and-name/task.md), работа там.'), 'BL', 'ru'), 'слита в BL-172');
  assert.equal(outcomeFromResult(result('# BL-055 · Результат', 'Закрыта: 2026-08-27. Исход — **снята с плана решением владельца**, прогон в живом Cursor IDE не проводится.'), 'BL', 'ru'), 'отклонена');
  assert.equal(outcomeFromResult(result('# BL-107 · Результат', 'Снята: 2026-08-26. Беспредметна — гейт, чью оценку она чинила, убран целиком.'), 'BL', 'ru'), 'отклонена');
  // Слово внутри слова — не исход; голое «снята» — исход только первым словом абзаца:
  // снятая заглушка задачу не отклоняет.
  assert.equal(outcomeFromResult(result('# PB-42 · Result', 'Abandoned; the flaw was disclosed upstream.'), 'PB', 'en'), '—');
  assert.equal(outcomeFromResult(result('# BL-10 · Результат', '**Закрыта 2026-08-02.** Снята переходная форма, заглушка снята.'), 'BL', 'ru'), 'выполнена');
});

test('маркер «Исход:» / «Outcome:» без слова словаря читается как голое «закрыта»; «исход» без двоеточия — не маркер', () => {
  const read = (id, body, lang = 'ru') => outcomeFromResult(`# ${id} · Результат\n\n${body}\n\n## Проверки\n\nОтклонена ниже абзаца — не исход.\n`, id.split('-')[0], lang);
  assert.equal(read('BL-641.3', '**Исход: обе формы понимаются, рычага два — по одному на форму.**'), 'выполнена');
  assert.equal(read('BL-642.1', '**Исход: снятие инструмента не оставляет следа, и право на снятие доказывается положительно.**'), 'выполнена');
  assert.equal(read('BL-642.2', '**Исход: в репозитории сервиса `doctor` отвечает, а не отказывает поиском корня.**'), 'выполнена');
  assert.equal(read('PB-1', '**Outcome:** the reviewer keeps the diff.', 'en'), 'completed');
  assert.equal(read('BL-1', '**Исход: отклонена** — предмет ушёл.'), 'отклонена', 'слово словаря после маркера решает само');
  assert.equal(read('BL-1', '**Исход: снята** вместе с предметом.'), 'выполнена', 'слово вне таблицы или «снята» не первым словом после маркера — как «Отказ: беспредметна»');
  assert.equal(read('PB-1', '**Outcome:** abandoned; the flaw was disclosed upstream.', 'en'), 'completed');
  assert.equal(read('BL-1', 'Исход спора решит владелец.'), '—');
  assert.equal(read('BL-1', '**Исход — обе формы понимаются.**'), '—', 'форма с тире — не маркер');
  assert.equal(read('BL-1', 'Исходы: два, оба в разделе ниже.'), '—');
  // Маркер — фолбэк свёртки старых записей, а не слово исхода: гейт 5 и `fold N` его не принимают.
  assert.equal(hasNamedOutcome('# BL-1 · Результат\n\n**Исход: обе формы понимаются.**\n', 'BL'), false);
});

test('«слиянием в <номер>» — слияние, как «слита в»: номер проекта сразу после формы, отрицание отсекается', () => {
  const read = (body) => outcomeFromResult(`# BL-1 · Результат\n\n${body}\n`, 'BL', 'ru');
  assert.equal(read('**Закрыта 2026-09-12 слиянием в `BL-624.1`.**'), 'слита в BL-624.1');
  assert.equal(read('**Закрыта 2026-09-12 слиянием в `BL-604`.**'), 'слита в BL-604');
  assert.equal(read('**Закрыта 2026-09-12 слиянием в `BL-565.2`.**'), 'слита в BL-565.2');
  assert.equal(read('**Закрыта.** Не слиянием в BL-3: предмет другой.'), 'выполнена');
  assert.equal(read('**Закрыта** слиянием в main.'), 'выполнена');
  assert.equal(hasNamedOutcome('# BL-1 · Результат\n\n**Закрыта 2026-09-12 слиянием в `BL-604`.**\n', 'BL'), true);
});

// Первые фразы записей потребителей, чей исход журнал называет иначе; «…» — сокращение, пути сняты.
const UNREAD = JSON.parse(readFileSync(new URL('./fixtures/outcome-unread-residue.json', import.meta.url), 'utf8'));

test('известный остаток: «Закрыта отказом», «а не выполнена», «Исход — снята», дубль без «слита», слово о чужой задаче — не читаются по решению владельца, вердикт держит нынешнее чтение', () => {
  assert.equal(UNREAD.length, 7);
  const got = UNREAD.map((e) => {
    const [prefix] = e.id.split('-');
    return [e.id, outcomeFromResult(`# ${e.id} · Результат\n\n${e.phrase}\n`, prefix, prefix === 'PB' ? 'en' : 'ru')];
  });
  assert.deepEqual(got, UNREAD.map((e) => [e.id, e.outcome]));
});

test('дописывание в журнал: пустая строка между прозой и первой записью, между записями — нет', () => {
  const head = '# Журнал\n\nПроза.\n';
  const one = appendLogLines(head, ['- <a id="bs-1"></a>x']);
  assert.equal(one, '# Журнал\n\nПроза.\n\n- <a id="bs-1"></a>x\n');
  assert.equal(appendLogLines(one, ['- <a id="bs-2"></a>y']), '# Журнал\n\nПроза.\n\n- <a id="bs-1"></a>x\n- <a id="bs-2"></a>y\n');
  assert.equal(appendLogLines('', ['- <a id="bs-1"></a>x']), '- <a id="bs-1"></a>x\n');
  assert.equal(appendLogLines('# Журнал\n\nПроза.\n\n', ['- <a id="bs-1"></a>x']), '# Журнал\n\nПроза.\n\n- <a id="bs-1"></a>x\n');
});
