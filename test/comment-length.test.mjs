// Gate: an inline comment is at most two lines long and 100 characters wide, the AGENTS.md rule.
// What it catches and what it misses, the width included — ADR-046.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIMIT, WIDTH, longBlocks, maskedLines, scannedCode, wideLines } from './comment-scan.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TREES = ['lib', 'test', 'bin', 'scripts'];

export function blocksOf(text) {
  return longBlocks(text);
}

export function wideOf(text) {
  return wideLines(text);
}

const { files: scanned, empty: emptyTrees } = scannedCode(ROOT, TREES);

test('каждое дерево, названное гейтом, несёт код, который он может судить', () => {
  assert.deepEqual(emptyTrees, [], 'дерево из TREES не несёт ни одного файла, который git не игнорирует — убери его или почини имя');
});

// The walk: the long blocks and the wide lines of every file, and how many files it judged.
export function surveyTree(files) {
  const offenders = [];
  const wide = [];
  let judged = 0;
  for (const rel of files) {
    const text = readFileSync(path.join(ROOT, rel), 'utf8');
    for (const w of wideOf(text)) wide.push(`${rel}:${w.line} — ширина ${w.width}`);
    judged += 1;
    for (const block of blocksOf(text)) offenders.push(`${rel}:${block.line} — длина ${block.length}`);
  }
  return { offenders, wide, judged };
}

const walk = surveyTree(scanned);

test('the walk judges every file it reads', () => {
  // Каждый вердикт ниже проверяет список на ПУСТОТУ, а обход, не прочитавший ни файла, наполняет
  // их всех ничем — и проходит. Пол отделяет «прочитал ничего» от «прочитал всё».
  assert.equal(walk.judged, scanned.length, `обход отсудил ${walk.judged} из ${scanned.length} файлов`);
});

test('the walk refuses every long block of a file it judges and names the file and the line', () => {
  // The floor catches a walk that read NOTHING, not one that reads every file and judges none:
  // judged counts reads, not verdicts. So the judging branch runs here.
  const debtor = 'test/fixtures/comment-debtor.js.txt';
  assert.ok(!scanned.includes(debtor), `${debtor} попал в обход — гейт судил бы носителя пробы как долг (ADR-046)`);
  const carried = blocksOf(readFileSync(path.join(ROOT, debtor), 'utf8')).length;
  assert.ok(carried > 0, `${debtor} больше не несёт длинных блоков — пробе нечего судить`);
  const bare = surveyTree([debtor]);
  assert.equal(bare.offenders.length, carried, 'every long block of the file is refused');
  assert.match(bare.offenders[0], /^test\/fixtures\/comment-debtor\.js\.txt:\d+ — длина \d+$/, 'and the refusal names the file and the line');
});

test('an inline comment is at most two lines long, in every file of the walk', () => {
  assert.deepEqual(walk.offenders, [], `блоки комментария длиннее ${LIMIT} строк`);
});

test('строка инлайн-комментария не шире 100 знаков, в любом файле обхода', () => {
  assert.deepEqual(walk.wide, [], `строки комментария шире ${WIDTH} знаков`);
});

test('the walk refuses every wide comment line of a file it judges', () => {
  const debtor = 'test/fixtures/comment-debtor.js.txt';
  const carried = wideOf(readFileSync(path.join(ROOT, debtor), 'utf8')).length;
  assert.ok(carried > 0, `${debtor} больше не несёт широкой строки — пробе нечего судить`);
  const bare = surveyTree([debtor]);
  assert.equal(bare.wide.length, carried, 'every wide line of the file is refused');
  assert.match(bare.wide[0], /^test\/fixtures\/comment-debtor\.js\.txt:\d+ — ширина 101$/, 'and the refusal names the file, the line and the width');
});

test('ширина: строка комментария в 101 знак — нарушение той же природы, что третья строка блока', () => {
  const line = (width, indent = '') => `${indent}// ${'x'.repeat(width - indent.length - 3)}`;
  assert.deepEqual(wideOf(`${line(40)}\n${line(101)}\nconst x = 1;\n`), [{ line: 2, width: 101 }],
    'блок в две строки, вторая — 101 знак');
  assert.deepEqual(wideOf(`${line(100)}\n${line(100)}\nconst x = 1;\n`), [], 'ровно 100 — в пределе');
  assert.deepEqual(wideOf(`${line(101, '    ')}\n`), [{ line: 1, width: 101 }], 'отступ входит в ширину');
  assert.deepEqual(wideOf(`${line(100)}\r\n${line(100)}\r\n`), [], '`\\r` перевода строки CRLF — не знак');
  assert.deepEqual(wideOf(`// ${'𝑥'.repeat(97)}\n`), [], 'знак — кодпоинт, а не единица UTF-16');
  assert.deepEqual(wideOf(`const x = 1; // ${'x'.repeat(120)}\n`), [], 'хвост строки кода гейт не судит (ADR-046)');
});

const one = (src) => blocksOf(src).map((r) => [r.line, r.length]);

const CASES = [
  { why: 'lexer: a block comment with bare continuation lines is one block',
    src: '/*\n a\n b\n */\nconst x = 1;', exp: [[1, 4]] },
  { why: 'lexer: a block continues after `*/` on the same line',
    src: '/* x */ // one\n// two\n// three\n', exp: [[1, 3]] },
  { why: 'lexer: code after `*/` ends the block on that line',
    src: '/*\n a\n b\n */ work();\n', exp: [[1, 3]] },
  { why: "lexer: a JSDoc block is a block too, by the owner's decision",
    src: '/**\n * a\n * b\n */\nfn();', exp: [[1, 4]] },
  { why: 'lexer: three comment lines are one block of three',
    src: '// a\n// b\n// c\nconst x = 1;', exp: [[1, 3]] },
  { why: 'lexer: two adjacent comments are one block',
    src: '/** a */\n// b\n// c\nconst x = 1;', exp: [[1, 3]] },
  { why: 'lexer: code between comments ends the block',
    src: '// a\nconst x = 1;\n// b\n', exp: [] },
  { why: 'lexer: a blank line between comments ends the block',
    src: '// a\n\n// b\n// c\n', exp: [] },
  { why: 'lexer: a comment opened after code on its line starts no block',
    src: 'const x = 1; // one\n// two\n// three\n', exp: [] },
  { why: 'lexer: a code line ends a block whether or not it ends in a comment',
    src: '// a\n// b\nconst x = 1; // c\n// d\n// e\n', exp: [] },
  { why: 'lexer: a comment marker inside a string is not a comment',
    src: "const s = '// не комментарий';\nconst u = 'http://x';\n", exp: [] },
  { why: 'lexer: a block comment marker inside a string is not a comment',
    src: 'const s = "/*";\nconst t = "*/";\nconst u = 1;\n', exp: [] },
  { why: 'lexer: a comment marker inside a template literal that spans lines is not a comment',
    src: 'const s = `// не комментарий\n// всё ещё нет`;\nconst y = 1;\n', exp: [] },
  // Without regex state the backtick below opens a template that never closes, and nothing
  // after it is a comment any more. Why the gate needs a lexer: ADR-046.
  { why: 'lexer: a backtick inside a regex opens nothing',
    src: 'const r = /`/g;\n// a\n// b\n// c\n', exp: [[2, 3]] },
  { why: 'lexer: a block after a regex with a backtick is still seen',
    src: "text.replace(/`/g, '');\n/*\n a\n b\n*/\n", exp: [[2, 4]] },
  { why: 'lexer: templates nested through `${…}` close where they should',
    src: 'const s = `a${`b${c}d`}e`;\n// a\n// b\n// c\n', exp: [[2, 3]] },
  { why: 'lexer: a brace inside `${…}` does not end it',
    src: 'const s = `${ {a: 1} }`;\n// a\n// b\n// c\n', exp: [[2, 3]] },
  { why: 'lexer: a division is not a regex',
    src: 'const q = (a + b) / 2;\n// a\n// b\n// c\n', exp: [[2, 3]] },
];

for (const c of CASES) test(c.why, () => assert.deepEqual(one(c.src), c.exp));

test('lexer: the lines of a block include its bare continuation lines', () => {
  // The count is not enough: the bare lines must be IN the block, since the width gate reads
  // exactly these lines.
  assert.deepEqual(blocksOf('/*\n a\n b\n */\n')[0].lines.map((l) => l.trim()), ['/*', 'a', 'b', '*/']);
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
