// Гейт: инлайн-комментарий не длиннее двух строк (правило владельца от 2026-09-12, AGENTS.md).
// Что он ловит, чего не ловит и как гасится долг — ADR-028.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { longRuns, maskedLines, trackedCode } from './comment-scan.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LIMIT = 2;
const TREES = ['lib', 'test', 'bin', 'scripts'];

// Файлы, до которых свод не дошёл: каждый называет ЛИЧНОСТЬ каждого своего длинного прогона,
// по разу на прогон — записанный дважды должен быть должен дважды.
const PENDING = new Map(Object.entries(JSON.parse(
  readFileSync(path.join(ROOT, 'test', 'fixtures', 'comment-sweep-pending.json'), 'utf8'),
)));

/** Личность прогона — его собственная проза: переписать его правка, перенести — нет. */
export function runId(run) {
  return createHash('sha256').update(run.lines.map((l) => l.trim()).join('\n')).digest('hex').slice(0, 12);
}

export function runsOf(text) {
  return longRuns(text, LIMIT);
}

/** Сколько раз встречается каждое значение — вся разница между мультимножеством и `Set`. */
function countOf(values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return counts;
}

/** Прогоны, которых список не называет, со счётом копий: назван раз, написан дважды — должен раз. */
export function unnamedRuns(runs, listed) {
  const owed = countOf(listed);
  const out = [];
  for (const run of runs) {
    const id = runId(run);
    const left = owed.get(id) ?? 0;
    if (left > 0) owed.set(id, left - 1);
    else out.push(run);
  }
  return out;
}

/** Записанные id, которым в дереве больше не отвечает ни один прогон, со счётом копий. */
export function staleIds(runs, listed) {
  const have = countOf(runs.map(runId));
  const out = [];
  for (const [id, owed] of countOf(listed)) {
    for (let n = have.get(id) ?? 0; n < owed; n++) out.push(id);
  }
  return out;
}

/** Файлы, которые список называет, а обход не видит, — вторая сторона той же сверки. */
export function unknownFiles(files, listing) {
  return [...listing.keys()].filter((rel) => !files.includes(rel));
}

const { files: tracked, empty: emptyTrees } = trackedCode(ROOT, TREES);

test('каждое дерево, названное гейтом, несёт код, который он может судить', () => {
  assert.deepEqual(emptyTrees, [], 'дерево из TREES не несёт ни одного файла под git — убери его или почини имя');
  assert.ok(tracked.length > 0, 'обход не прочитал ни одного файла');
});

test('список долга умеет только уменьшаться', () => {
  // Потолки литералами, опускаются РУКАМИ по мере гашения долга: без них новый прогон вместе
  // со своим id в фикстуре проходит все прочие проверки, а подъём потолка виден ревью.
  assert.ok(PENDING.size <= 42, `список называет ${PENDING.size} файлов, потолок — 42`);
  const ids = [...PENDING.values()].flat().length;
  assert.ok(ids <= 180, `список должен ${ids} прогонов, потолок — 180`);
});

/** Обход, со счётом прочитанного и отсуженного рядом с тремя списками вердиктов. */
export function surveyTree(files, listing) {
  const offenders = [];
  const appeared = [];
  const swept = [];
  let judged = 0;
  let seen = 0;
  for (const rel of files) {
    const runs = runsOf(readFileSync(path.join(ROOT, rel), 'utf8'));
    judged++;
    seen += runs.length;
    if (!listing.has(rel)) {
      for (const run of runs) offenders.push(`${rel}:${run.line} — длина ${run.length}`);
      continue;
    }
    // Каждый прогон тратит единицу того, что должен список; копия разрешённого блока не находит её.
    for (const run of unnamedRuns(runs, listing.get(rel))) {
      appeared.push(`${rel}:${run.line} — длинный прогон, которого список не называет, длина ${run.length}`);
    }
    if (!runs.length) swept.push(rel);
  }
  return { offenders, appeared, swept, judged, seen };
}

const walk = surveyTree(tracked, PENDING);

test('обход говорит, сколько прочитал: пустой обход даёт ту же зелень, что полный', () => {
  // Каждый вердикт ниже проверяет список на ПУСТОТУ, а обход, не прочитавший ни файла, наполняет
  // их всех ничем — и проходит. Пол отделяет «прочитал ничего» от «прочитал всё».
  assert.equal(walk.judged, tracked.length, `обход отсудил ${walk.judged} из ${tracked.length} файлов под git`);
  assert.equal(walk.seen, 180, `обход увидел ${walk.seen} длинных прогонов, дерево известно как несущее 180`);
});

test('обход отказывает каждой из четырёх форм, ради которых существует', () => {
  // Пол ловит обход, не прочитавший НИЧЕГО, и не ловит тот, что читает все файлы и не судит ни
  // одного: judged и seen наполняются в обоих случаях. Поэтому судящие ветки гоняются здесь.
  const debtor = 'lib/lint.js';
  const carried = runsOf(readFileSync(path.join(ROOT, debtor), 'utf8')).length;
  assert.ok(carried > 0, `${debtor} больше не несёт долга — наведи проверку на другой файл из списка`);
  const bare = surveyTree([debtor], new Map());
  assert.equal(bare.offenders.length, carried, 'каждый длинный прогон файла вне списка отвергнут');
  assert.ok(bare.offenders[0].startsWith(`${debtor}:`), 'и отказ называет файл и строку');
  assert.deepEqual(bare.appeared, [], 'файл вне списка не может ещё и подменять долг');
  const owesNothing = surveyTree([debtor], new Map([[debtor, []]]));
  assert.deepEqual(owesNothing.offenders, [], 'файл из списка судится по его записям, а не отвергается целиком');
  assert.equal(owesNothing.appeared.length, carried, 'и каждый прогон сверх них — прогон, которого список не называет');
  const clean = 'lib/version.js';
  assert.deepEqual(surveyTree([clean], new Map([[clean, []]])).swept, [clean],
    'файл из списка, которому нечего сводить, обязан из списка уйти');
  assert.deepEqual(unknownFiles([clean], new Map([['lib/gone.js', []]])), ['lib/gone.js'],
    'и имя, которое список несёт, а обход не видит, тоже отвергнуто');
  assert.deepEqual(unknownFiles([clean], new Map([[clean, []]])), [], 'имя, которое обход видит, — нет');
});

test('инлайн-комментарий не длиннее двух строк, вне файлов, до которых свод не дошёл', () => {
  assert.deepEqual(walk.offenders, [], `прогоны комментария длиннее ${LIMIT} строк`);
  assert.deepEqual(walk.appeared, [],
    'файл из списка несёт длинный прогон, которого список не называет, — подмена долга не свод');
  assert.deepEqual(walk.swept, [], 'сведённые файлы всё ещё в списке — убери их оттуда');
});

test('каждая запись списка называет файл под git, и каждый записанный прогон ещё существует', () => {
  assert.deepEqual(unknownFiles(tracked, PENDING), [], 'список называет файлы, которых обход не видит');
  const stale = [];
  for (const [rel, ids] of PENDING) {
    if (!tracked.includes(rel)) continue;
    // Записан чаще, чем файл его несёт, — долг уже погашен: лишняя запись уходит.
    const runs = runsOf(readFileSync(path.join(ROOT, rel), 'utf8'));
    for (const id of staleIds(runs, ids)) stale.push(`${rel}: ${id} записан и не отвечен — убери его`);
  }
  assert.deepEqual(stale, [], 'записи списка для прогонов, которых больше нет');
});

test('лексер видит формы, которых регэксп по одной строке не увидел бы', () => {
  const one = (src) => runsOf(src).map((r) => [r.line, r.length]);
  assert.deepEqual(one('/*\n a\n b\n */\nconst x = 1;'), [[1, 4]], 'блок с голыми строками продолжения');
  // Границ мало: голые строки обязаны быть В прогоне, иначе его личность — личность другого
  // комментария, и список долга сверяет не тот текст.
  assert.deepEqual(runsOf('/*\n a\n b\n */\n')[0].lines.map((l) => l.trim()), ['/*', 'a', 'b', '*/']);
  assert.deepEqual(one('/* x */ // one\n// two\n// three\n'), [[1, 3]], 'прогон, продолженный после `*/` на той же строке');
  assert.deepEqual(one('/*\n a\n b\n */ work();\n'), [[1, 3]], 'код после `*/` обрывает прогон здесь');
  assert.deepEqual(one('/**\n * a\n * b\n */\nfn();'), [[1, 4]], 'блок jsdoc — тоже прогон, по решению владельца');
  assert.deepEqual(one('// a\n// b\n// c\nconst x = 1;'), [[1, 3]], 'три строки комментария');
  assert.deepEqual(one('/** a */\n// b\n// c\nconst x = 1;'), [[1, 3]], 'два соседних комментария — один прогон');
  assert.deepEqual(one('// a\nconst x = 1;\n// b\n'), [], 'код между ними обрывает прогон');
  assert.deepEqual(one('// a\n\n// b\n// c\n'), [], 'пустая строка между ними обрывает прогон');
});

test('комментарий в хвосте строки принадлежит своему коду: он не начинает и не продолжает прогон', () => {
  const one = (src) => runsOf(src).map((r) => [r.line, r.length]);
  assert.deepEqual(one('const x = 1; // one\n// two\n// three\n'), [],
    'комментарий, открытый после кода, прогона не начинает');
  assert.deepEqual(one('// a\n// b\nconst x = 1; // c\n// d\n// e\n'), [],
    'строка кода рвёт прогон независимо от того, кончается ли она комментарием');
});

test('маркер комментария внутри строки, шаблона или регэкспа — не комментарий', () => {
  const one = (src) => runsOf(src).map((r) => [r.line, r.length]);
  assert.deepEqual(one("const s = '// не комментарий';\nconst u = 'http://x';\n"), [], 'внутри строки');
  assert.deepEqual(one('const s = "/*";\nconst t = "*/";\nconst u = 1;\n'), [], 'маркер блока внутри строки');
  assert.deepEqual(one('const s = `// не комментарий\n// всё ещё нет`;\nconst y = 1;\n'), [],
    'внутри шаблонной строки, которая живёт через перевод строки');
});

test('лексер держит состояние между строками: регэксп и вложенный шаблон закрываются там, где должны', () => {
  const one = (src) => runsOf(src).map((r) => [r.line, r.length]);
  // Замер соседа, 2026-09-16: без состояния регэкспа бэктик ниже открывал шаблон, который
  // никогда не закрывался, и прятал 66 блоков, 413 строк, в 10 файлах.
  assert.deepEqual(one('const r = /`/g;\n// a\n// b\n// c\n'), [[2, 3]], 'бэктик внутри регэкспа не открывает ничего');
  assert.deepEqual(one("text.replace(/`/g, '');\n/*\n a\n b\n*/\n"), [[2, 4]], 'и блок после него всё ещё виден');
  assert.deepEqual(one('const s = `a${`b${c}d`}e`;\n// a\n// b\n// c\n'), [[2, 3]], 'шаблоны, вложенные через `${…}`');
  assert.deepEqual(one('const s = `${ {a: 1} }`;\n// a\n// b\n// c\n'), [[2, 3]], 'скобка внутри `${…}` — не его конец');
  assert.deepEqual(one('const q = (a + b) / 2;\n// a\n// b\n// c\n'), [[2, 3]], 'деление — не регэксп');
});

test('чем оказался `/`, решает токен перед ним, и доказательство — комментарий рядом', () => {
  // Неверно прочитанный `/` стоит комментария СПРАВА от него, а не разбора, — поэтому ассерт такой:
  // регэксп, съевший `/* note */`, и деление, оставившее его, — два наблюдаемых исхода.
  const noteOn = (src) => maskedLines(src)[0].trim();
  assert.equal(noteOn('let i = 0; i++ / 2; /* note */'), '/* note */', '`++` — один токен: дальше деление');
  assert.equal(noteOn('while (i--) { x(); } / 2; /* note */'), '/* note */', 'и `--` тоже; скобка тоже кончает значение');
  assert.equal(noteOn('const v = !/\\s/.test(x); /* note */'), '/* note */', 'регэксп после `!` закрывается своим `/`');
  assert.equal(noteOn('#!/usr/bin/env node // note'), '// note', 'шебанг не открывает ничего, что осталось бы открытым');
});

test('прогон опознаётся своим текстом, и список должен его по разу на копию', () => {
  const a = runsOf('// one\n// two\n// three\n')[0];
  const b = runsOf('// four\n// five\n// six\n')[0];
  assert.equal(a.length, b.length, 'СЧЁТ у них равен — это и есть закрываемая дыра');
  assert.notEqual(runId(a), runId(b), 'равные счёта не должны давать равные личности');
  assert.equal(runId(a), runId(runsOf('// one\n// two\n// three\n')[0]), 'тот же текст даёт тот же id');
  const twice = runsOf('// one\n// two\n// three\nconst x = 1;\n// one\n// two\n// three\n');
  assert.equal(twice.length, 2, 'тот же блок, написанный дважды, — два прогона');
  assert.equal(runId(twice[0]), runId(twice[1]), 'и личность у них одна, которую `Set` бы схлопнул');
});

test('список должен прогон по разу на копию: подмена долга закрыта', () => {
  const twice = runsOf('// one\n// two\n// three\nconst x = 1;\n// one\n// two\n// three\n');
  const id = runId(twice[0]);
  assert.equal(unnamedRuns(twice, [id]).length, 1, 'список, должный раз, платит одну копию и отвергает вторую');
  assert.equal(unnamedRuns(twice, [id, id]).length, 0, 'список, должный дважды, платит обе');
  assert.equal(unnamedRuns(twice, []).length, 2, 'список, не должный ничего, отвергает обе');
  // И обратная сторона: запись, встречающаяся чаще, чем дерево на неё отвечает, — мёртвый долг.
  assert.deepEqual(staleIds(twice, [id, id, id]), [id], 'записан трижды, написан дважды: одна запись мертва');
  assert.deepEqual(staleIds(twice, [id, id]), [], 'записан столько же, сколько написан, — убирать нечего');
  assert.deepEqual(staleIds([], [id]), [id], 'исчезнувший прогон оставляет запись за собой');
});
