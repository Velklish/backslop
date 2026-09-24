// Гейт: инлайн-комментарий не длиннее двух строк — правило AGENTS.md.
// Что он ловит, чего не ловит и как гасится долг — ADR-028.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { longBlocks, maskedLines, scannedCode } from './comment-scan.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LIMIT = 2;
const TREES = ['lib', 'test', 'bin', 'scripts'];

// Файлы, до которых свод не дошёл: каждый называет ЛИЧНОСТЬ каждого своего длинного блока,
// по разу на блок — записанный дважды должен быть должен дважды.
const PENDING = new Map(Object.entries(JSON.parse(
  readFileSync(path.join(ROOT, 'test', 'fixtures', 'comment-sweep-pending.json'), 'utf8'),
)));

/** Личность блока — его собственная проза: переписать его правка, перенести — нет. */
export function blockId(block) {
  return createHash('sha256').update(block.lines.map((l) => l.trim()).join('\n')).digest('hex').slice(0, 12);
}

export function blocksOf(text) {
  return longBlocks(text, LIMIT);
}

/** Сколько раз встречается каждое значение — вся разница между мультимножеством и `Set`. */
function countOf(values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return counts;
}

/** Блоки, которых список не называет, со счётом копий: назван раз, написан дважды — должен раз. */
export function unnamedBlocks(blocks, listed) {
  const owed = countOf(listed);
  const out = [];
  for (const block of blocks) {
    const id = blockId(block);
    const left = owed.get(id) ?? 0;
    if (left > 0) owed.set(id, left - 1);
    else out.push(block);
  }
  return out;
}

/** Записанные id, которым в дереве больше не отвечает ни один блок, со счётом копий. */
export function staleIds(blocks, listed) {
  const have = countOf(blocks.map(blockId));
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

const { files: scanned, empty: emptyTrees } = scannedCode(ROOT, TREES);

test('каждое дерево, названное гейтом, несёт код, который он может судить', () => {
  assert.deepEqual(emptyTrees, [], 'дерево из TREES не несёт ни одного файла, который git не игнорирует — убери его или почини имя');
  assert.ok(scanned.length > 0, 'обход не прочитал ни одного файла');
});

test('список долга умеет только уменьшаться', () => {
  // Потолки литералами, опускаются РУКАМИ по мере гашения долга: без них новый блок вместе
  // со своим id в фикстуре проходит все прочие проверки, а подъём потолка виден ревью.
  assert.ok(PENDING.size <= 42, `список называет ${PENDING.size} файлов, потолок — 42`);
  const ids = [...PENDING.values()].flat().length;
  assert.ok(ids <= 178, `список должен ${ids} блоков, потолок — 178`);
});

/** Обход, со счётом прочитанного и отсуженного рядом с тремя списками вердиктов. */
export function surveyTree(files, listing) {
  const offenders = [];
  const appeared = [];
  const swept = [];
  let judged = 0;
  let seen = 0;
  let lines = 0;
  for (const rel of files) {
    const blocks = blocksOf(readFileSync(path.join(ROOT, rel), 'utf8'));
    judged++;
    seen += blocks.length;
    for (const block of blocks) lines += block.length;
    if (!listing.has(rel)) {
      for (const block of blocks) offenders.push(`${rel}:${block.line} — длина ${block.length}`);
      continue;
    }
    // Каждый блок тратит единицу того, что должен список; копия разрешённого блока не находит её.
    for (const block of unnamedBlocks(blocks, listing.get(rel))) {
      appeared.push(`${rel}:${block.line} — длинный блок, которого список не называет, длина ${block.length}`);
    }
    if (!blocks.length) swept.push(rel);
  }
  return { offenders, appeared, swept, judged, seen, lines };
}

const walk = surveyTree(scanned, PENDING);

test('обход говорит, сколько прочитал и сколько строк это стоит', () => {
  // Каждый вердикт ниже проверяет список на ПУСТОТУ, а обход, не прочитавший ни файла, наполняет
  // их всех ничем — и проходит. Пол отделяет «прочитал ничего» от «прочитал всё».
  assert.equal(walk.judged, scanned.length, `обход отсудил ${walk.judged} из ${scanned.length} файлов`);
  assert.equal(walk.seen, 178, `обход увидел ${walk.seen} длинных блоков, дерево известно как несущее 178`);
  // Счёт блоков заперт, а длина каждого — нет: блок из списка можно удлинить, обновив его id
  // в фикстуре тем же коммитом. Правило заведено ради строк, поэтому строки и считаются.
  assert.equal(walk.lines, 696, `блоки заняли ${walk.lines} строк, дерево известно как несущее 696`);
});

test('обход отказывает каждой из четырёх форм, ради которых существует', () => {
  // Пол ловит обход, не прочитавший НИЧЕГО, и не ловит тот, что читает все файлы и не судит ни
  // одного: judged и seen наполняются в обоих случаях. Поэтому судящие ветки гоняются здесь.
  const debtor = 'lib/lint.js';
  const carried = blocksOf(readFileSync(path.join(ROOT, debtor), 'utf8')).length;
  assert.ok(carried > 0, `${debtor} больше не несёт долга — наведи проверку на другой файл из списка`);
  const bare = surveyTree([debtor], new Map());
  assert.equal(bare.offenders.length, carried, 'каждый длинный блок файла вне списка отвергнут');
  assert.ok(bare.offenders[0].startsWith(`${debtor}:`), 'и отказ называет файл и строку');
  assert.deepEqual(bare.appeared, [], 'файл вне списка не может ещё и подменять долг');
  const owesNothing = surveyTree([debtor], new Map([[debtor, []]]));
  assert.deepEqual(owesNothing.offenders, [], 'файл из списка судится по его записям, а не отвергается целиком');
  assert.equal(owesNothing.appeared.length, carried, 'и каждый блок сверх них — блок, которого список не называет');
  const clean = 'lib/version.js';
  assert.deepEqual(surveyTree([clean], new Map([[clean, []]])).swept, [clean],
    'файл из списка, которому нечего сводить, обязан из списка уйти');
  assert.deepEqual(unknownFiles([clean], new Map([['lib/gone.js', []]])), ['lib/gone.js'],
    'и имя, которое список несёт, а обход не видит, тоже отвергнуто');
  assert.deepEqual(unknownFiles([clean], new Map([[clean, []]])), [], 'имя, которое обход видит, — нет');
});

test('инлайн-комментарий не длиннее двух строк, вне файлов, до которых свод не дошёл', () => {
  assert.deepEqual(walk.offenders, [], `блоки комментария длиннее ${LIMIT} строк`);
  assert.deepEqual(walk.appeared, [],
    'файл из списка несёт длинный блок, которого список не называет, — подмена долга не свод');
  assert.deepEqual(walk.swept, [], 'сведённые файлы всё ещё в списке — убери их оттуда');
});

test('каждая запись списка называет файл, который видит обход, и каждый записанный блок ещё существует', () => {
  assert.deepEqual(unknownFiles(scanned, PENDING), [], 'список называет файлы, которых обход не видит');
  const stale = [];
  for (const [rel, ids] of PENDING) {
    if (!scanned.includes(rel)) continue;
    // Записан чаще, чем файл его несёт, — долг уже погашен: лишняя запись уходит.
    const blocks = blocksOf(readFileSync(path.join(ROOT, rel), 'utf8'));
    for (const id of staleIds(blocks, ids)) stale.push(`${rel}: ${id} записан и не отвечен — убери его`);
  }
  assert.deepEqual(stale, [], 'записи списка для блоков, которых больше нет');
});

test('лексер видит формы, которых регэксп по одной строке не увидел бы', () => {
  const one = (src) => blocksOf(src).map((r) => [r.line, r.length]);
  assert.deepEqual(one('/*\n a\n b\n */\nconst x = 1;'), [[1, 4]], 'блок с голыми строками продолжения');
  // Границ мало: голые строки обязаны быть В блоке, иначе его личность — личность другого
  // комментария, и список долга сверяет не тот текст.
  assert.deepEqual(blocksOf('/*\n a\n b\n */\n')[0].lines.map((l) => l.trim()), ['/*', 'a', 'b', '*/']);
  assert.deepEqual(one('/* x */ // one\n// two\n// three\n'), [[1, 3]], 'блок, продолженный после `*/` на той же строке');
  assert.deepEqual(one('/*\n a\n b\n */ work();\n'), [[1, 3]], 'код после `*/` обрывает блок здесь');
  assert.deepEqual(one('/**\n * a\n * b\n */\nfn();'), [[1, 4]], 'блок jsdoc — тоже блок, по решению владельца');
  assert.deepEqual(one('// a\n// b\n// c\nconst x = 1;'), [[1, 3]], 'три строки комментария');
  assert.deepEqual(one('/** a */\n// b\n// c\nconst x = 1;'), [[1, 3]], 'два соседних комментария — один блок');
  assert.deepEqual(one('// a\nconst x = 1;\n// b\n'), [], 'код между ними обрывает блок');
  assert.deepEqual(one('// a\n\n// b\n// c\n'), [], 'пустая строка между ними обрывает блок');
});

test('комментарий в хвосте строки принадлежит своему коду: он не начинает и не продолжает блок', () => {
  const one = (src) => blocksOf(src).map((r) => [r.line, r.length]);
  assert.deepEqual(one('const x = 1; // one\n// two\n// three\n'), [],
    'комментарий, открытый после кода, блока не начинает');
  assert.deepEqual(one('// a\n// b\nconst x = 1; // c\n// d\n// e\n'), [],
    'строка кода рвёт блок независимо от того, кончается ли она комментарием');
});

test('маркер комментария внутри строки, шаблона или регэкспа — не комментарий', () => {
  const one = (src) => blocksOf(src).map((r) => [r.line, r.length]);
  assert.deepEqual(one("const s = '// не комментарий';\nconst u = 'http://x';\n"), [], 'внутри строки');
  assert.deepEqual(one('const s = "/*";\nconst t = "*/";\nconst u = 1;\n'), [], 'маркер блока внутри строки');
  assert.deepEqual(one('const s = `// не комментарий\n// всё ещё нет`;\nconst y = 1;\n'), [],
    'внутри шаблонной строки, которая живёт через перевод строки');
});

test('лексер держит состояние между строками: регэксп и вложенный шаблон закрываются там, где должны', () => {
  const one = (src) => blocksOf(src).map((r) => [r.line, r.length]);
  // Без состояния регэкспа бэктик ниже открывает шаблон, который никогда не закрывается,
  // и всё за ним перестаёт быть комментарием. Замер, стоящий за этой строкой, — ADR-028.
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

test('блок опознаётся своим текстом, и список должен его по разу на копию', () => {
  const a = blocksOf('// one\n// two\n// three\n')[0];
  const b = blocksOf('// four\n// five\n// six\n')[0];
  assert.equal(a.length, b.length, 'СЧЁТ у них равен — это и есть закрываемая дыра');
  assert.notEqual(blockId(a), blockId(b), 'равные счёта не должны давать равные личности');
  assert.equal(blockId(a), blockId(blocksOf('// one\n// two\n// three\n')[0]), 'тот же текст даёт тот же id');
  const twice = blocksOf('// one\n// two\n// three\nconst x = 1;\n// one\n// two\n// three\n');
  assert.equal(twice.length, 2, 'тот же блок, написанный дважды, — два блока');
  assert.equal(blockId(twice[0]), blockId(twice[1]), 'и личность у них одна, которую `Set` бы схлопнул');
});

test('список должен блок по разу на копию: подмена долга закрыта', () => {
  const twice = blocksOf('// one\n// two\n// three\nconst x = 1;\n// one\n// two\n// three\n');
  const id = blockId(twice[0]);
  assert.equal(unnamedBlocks(twice, [id]).length, 1, 'список, должный раз, платит одну копию и отвергает вторую');
  assert.equal(unnamedBlocks(twice, [id, id]).length, 0, 'список, должный дважды, платит обе');
  assert.equal(unnamedBlocks(twice, []).length, 2, 'список, не должный ничего, отвергает обе');
  // И обратная сторона: запись, встречающаяся чаще, чем дерево на неё отвечает, — мёртвый долг.
  assert.deepEqual(staleIds(twice, [id, id, id]), [id], 'записан трижды, написан дважды: одна запись мертва');
  assert.deepEqual(staleIds(twice, [id, id]), [], 'записан столько же, сколько написан, — убирать нечего');
  assert.deepEqual(staleIds([], [id]), [id], 'исчезнувший блок оставляет запись за собой');
});
