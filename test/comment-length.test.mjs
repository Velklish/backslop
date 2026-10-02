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

const { files: scanned, empty: emptyTrees } = scannedCode(ROOT, TREES);

test('every tree the gate names carries code it can judge', () => {
  assert.deepEqual(emptyTrees, [], 'a tree of TREES carries no file git does not ignore — remove it or fix the name');
});

// The walk: the long blocks and the wide lines of every file, and how many files it judged.
function surveyTree(files) {
  const offenders = [];
  const wide = [];
  let judged = 0;
  for (const rel of files) {
    const text = readFileSync(path.join(ROOT, rel), 'utf8');
    for (const w of wideLines(text)) wide.push(`${rel}:${w.line} — width ${w.width}`);
    judged += 1;
    for (const block of longBlocks(text)) offenders.push(`${rel}:${block.line} — length ${block.length}`);
  }
  return { offenders, wide, judged };
}

const walk = surveyTree(scanned);

test('the walk judges every file it reads', () => {
  // Every verdict below checks a list for EMPTINESS, and a walk that read no file fills them all
  // with nothing and passes. The floor separates "read nothing" from "read everything".
  assert.equal(walk.judged, scanned.length, `the walk judged ${walk.judged} of ${scanned.length} files`);
});

test('the walk refuses every long block of a file it judges and names the file and the line', () => {
  // The floor catches a walk that read NOTHING, not one that reads every file and judges none:
  // judged counts reads, not verdicts. So the judging branch runs here.
  const debtor = 'test/fixtures/comment-debtor.js.txt';
  assert.ok(!scanned.includes(debtor), `${debtor} is in the walk — the gate would judge the probe carrier as debt (ADR-046)`);
  const carried = longBlocks(readFileSync(path.join(ROOT, debtor), 'utf8')).length;
  assert.ok(carried > 0, `${debtor} carries no long blocks any more — the probe has nothing to judge`);
  const bare = surveyTree([debtor]);
  assert.equal(bare.offenders.length, carried, 'every long block of the file is refused');
  assert.match(bare.offenders[0], /^test\/fixtures\/comment-debtor\.js\.txt:\d+ — length \d+$/, 'and the refusal names the file and the line');
});

test('an inline comment is at most two lines long, in every file of the walk', () => {
  assert.deepEqual(walk.offenders, [], `comment blocks longer than ${LIMIT} lines`);
});

test('an inline comment line is at most 100 characters wide, in every file of the walk', () => {
  assert.deepEqual(walk.wide, [], `comment lines wider than ${WIDTH} characters`);
});

test('the walk refuses every wide comment line of a file it judges', () => {
  const debtor = 'test/fixtures/comment-debtor.js.txt';
  const carried = wideLines(readFileSync(path.join(ROOT, debtor), 'utf8')).length;
  assert.ok(carried > 0, `${debtor} carries no wide line any more — the probe has nothing to judge`);
  const bare = surveyTree([debtor]);
  assert.equal(bare.wide.length, carried, 'every wide line of the file is refused');
  assert.match(bare.wide[0], /^test\/fixtures\/comment-debtor\.js\.txt:\d+ — width 101$/, 'and the refusal names the file, the line and the width');
});

test('width: a comment line of 101 characters is a violation of the same kind as a third line of a block', () => {
  const line = (width, indent = '') => `${indent}// ${'x'.repeat(width - indent.length - 3)}`;
  assert.deepEqual(wideLines(`${line(40)}\n${line(101)}\nconst x = 1;\n`), [{ line: 2, width: 101 }],
    'a block of two lines, the second one 101 characters');
  assert.deepEqual(wideLines(`${line(100)}\n${line(100)}\nconst x = 1;\n`), [], 'exactly 100 is within the limit');
  assert.deepEqual(wideLines(`${line(101, '    ')}\n`), [{ line: 1, width: 101 }], 'the indent counts into the width');
  assert.deepEqual(wideLines(`${line(100)}\r\n${line(100)}\r\n`), [], 'the `\\r` of a CRLF line break is not a character');
  assert.deepEqual(wideLines(`// ${'𝑥'.repeat(97)}\n`), [], 'a character is a code point, not a UTF-16 unit');
  assert.deepEqual(wideLines(`const x = 1; // ${'x'.repeat(120)}\n`), [], 'the gate does not judge the tail of a code line (ADR-046)');
});

const one = (src) => longBlocks(src).map((r) => [r.line, r.length]);

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

// A comment misread inside a string or a template is mostly one line, or sits after code, so
// the block table above cannot see it: these rows read the text the lexer takes for comments.
const MASKED = [
  { why: 'lexer: a comment marker inside a string is not a comment',
    src: "const s = '// not a comment';\nconst u = 'http://x';\n", exp: [] },
  { why: 'lexer: a block comment marker inside a string is not a comment',
    src: 'const s = "/*";\nconst t = "*/";\nconst u = 1;\n', exp: [] },
  { why: 'lexer: a comment marker inside a template literal that spans lines is not a comment',
    src: 'const s = `// not a comment\n// still not`;\nconst y = 1;\n', exp: [] },
  { why: 'lexer: a comment marker in the text of a template around `${…}` is not a comment',
    src: 'const s = `a // ${ "b // " } c // d`;\n// real\n', exp: ['// real'] },
  { why: 'lexer: a comment marker in the text of a nested template is not a comment',
    src: 'const s = `a${`b // ${c} d // `} e // f`;\n// real\n', exp: ['// real'] },
];

for (const c of MASKED) test(c.why, () => assert.deepEqual(maskedLines(c.src).filter(Boolean), c.exp));

test('lexer: the lines of a block include its bare continuation lines', () => {
  // The count is not enough: the bare lines must be IN the block, since the width gate reads
  // exactly these lines.
  assert.deepEqual(longBlocks('/*\n a\n b\n */\n')[0].lines.map((l) => l.trim()), ['/*', 'a', 'b', '*/']);
});

test('what `/` turns out to be is decided by the token before it, and the proof is the comment next to it', () => {
  // A misread `/` costs the comment to its RIGHT, not a parse error — hence this assert: a regexp
  // that swallowed `/* note */` and a division that left it are the two observable outcomes.
  const noteOn = (src) => maskedLines(src)[0].trim();
  assert.equal(noteOn('let i = 0; i++ / 2; /* note */'), '/* note */', '`++` is one token: a division follows');
  assert.equal(noteOn('while (i--) { x(); } / 2; /* note */'), '/* note */', 'so is `--`; a bracket also ends a value');
  assert.equal(noteOn('const v = !/\\s/.test(x); /* note */'), '/* note */', 'a regexp after `!` closes with its own `/`');
  assert.equal(noteOn('#!/usr/bin/env node // note'), '// note', 'a shebang opens nothing that would stay open');
});
