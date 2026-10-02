// Review findings before publication: CRLF and BOM, root links and footnotes, atomic mv,
// a duplicate number, a long status --json through a pipe, the help and the version.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RU } from '../lib/i18n.js';
import { TOOL_VERSION } from '../lib/version.js';
import { BIN, FIELD, SECTION, cleanup, cli, escapeRe, gitAll, makeProject, put, read, ru, ruCard, ruRe } from './helpers.mjs';

test('CRLF and BOM: the title is read, lint is green, mv keeps the line breaks', () => {
  const root = makeProject();
  try {
    const card = ruCard('BS-1', 'Windows file', { order: 10, area: '[x](../../README.md)' }, [['context', 'text']]);
    put(root, 'docs/backlog/queue/BS-1-crlf.md', `﻿${card.replace(/\n/g, '\r\n')}`);
    put(root, 'docs/README.md', '# Documentation\r\n\r\n| Document | Topic | Status |\r\n|---|---|---|\r\n');
    gitAll(root);
    let r = cli(root, ['status', '--json']);
    assert.equal(JSON.parse(r.out).queue[0].title, 'Windows file');
    r = cli(root, ['lint']);
    assert.equal(r.code, 0, r.err);
    assert.equal(r.err, '', 'a green lint is silent on stderr too');
    r = cli(root, ['mv', '1', 'deferred']);
    assert.equal(r.code, 0, r.err);
    const moved = read(root, 'docs/backlog/deferred/BS-1-crlf.md');
    assert.ok(moved.startsWith('\uFEFF') && !moved.slice(1).includes('\uFEFF'), 'a rewrite keeps the one BOM');
    assert.ok(!/[^\r]\n/.test(moved), 'all line breaks stayed CRLF');
    assert.ok(moved.includes(`\r\n## ${SECTION.deferred}\r\n\r\n${ru('- **Deferred:** {date}', { date: '' }).trim()}`));
    assert.ok(!moved.includes(FIELD.order));
  } finally {
    cleanup(root);
  }
});

test('lint: a root link resolves from the project root, a footnote is not a link; archive leaves the root link alone', () => {
  const root = makeProject();
  try {
    put(root, 'docs/note.md', 'See [the index](/docs/README.md) and a footnote[^1].\n\n[^1]: The footnote text.\n');
    put(root, 'docs/backlog/queue/BS-1-a.md', `${ruCard('BS-1', 'A', { order: 10, area: '[x](../../README.md)' })}\n[root](/docs/README.md)\n`);
    gitAll(root);
    let r = cli(root, ['lint']);
    assert.equal(r.code, 0, r.err);
    r = cli(root, ['archive', '1']);
    assert.equal(r.code, 0, r.err);
    assert.match(read(root, 'docs/archive/BS-1-a/task.md'), /\(\/docs\/README\.md\)/);
    put(root, 'docs/note2.md', '[none](/docs/nope.md)\n');
    r = cli(root, ['lint']);
    assert.match(r.err, new RegExp(`note2\\.md: ${ruRe('broken link {href} (line {line})', { href: '/docs/nope.md' }).source}`));
  } finally {
    cleanup(root);
  }
});

test('mv --after to a foreign task refuses before the move', () => {
  const root = makeProject();
  try {
    put(root, 'docs/backlog/queue/BS-1-a.md', ruCard('BS-1', 'A', { order: 10 }));
    put(root, 'docs/backlog/triage/BS-2-b.md', ruCard('BS-2', 'B'));
    gitAll(root);
    const r = cli(root, ['mv', '2', 'queue', '--after', '7']);
    assert.equal(r.code, 1);
    assert.ok(existsSync(path.join(root, 'docs/backlog/triage/BS-2-b.md')), 'the file stayed in place');
    assert.ok(!existsSync(path.join(root, 'docs/backlog/queue/BS-2-b.md')));
    assert.ok(!read(root, 'docs/backlog/triage/BS-2-b.md').includes(FIELD.order));
  } finally {
    cleanup(root);
  }
});

test('duplicate number: mv and new refuse naming both paths', () => {
  const root = makeProject();
  try {
    put(root, 'docs/backlog/queue/BS-1-a.md', ruCard('BS-1', 'A', { order: 10 }));
    gitAll(root);
    put(root, 'docs/backlog/triage/BS-1-dup.md', ruCard('BS-1', 'Duplicate'));
    let r = cli(root, ['mv', '1', 'active']);
    assert.equal(r.code, 1);
    assert.match(r.err, ruRe('number {id} is used twice: {files} — assign distinct numbers; lint reports this too', { id: 'BS-1' }));
    assert.match(r.err, /queue\/BS-1-a\.md/);
    assert.match(r.err, /triage\/BS-1-dup\.md/);
    assert.ok(existsSync(path.join(root, 'docs/backlog/queue/BS-1-a.md')));
    r = cli(root, ['new', 'f', '--parent', '1']);
    assert.equal(r.code, 1);
    assert.match(r.err, ruRe('number {id} is used twice: {files} — assign distinct numbers; lint reports this too', { id: 'BS-1' }));
    assert.match(r.err, /queue\/BS-1-a\.md/);
    assert.match(r.err, /triage\/BS-1-dup\.md/);
  } finally {
    cleanup(root);
  }
});

// Its own limit: a direct `node --test <file>` gets no --test-timeout from npm test, and an
// "exitCode instead of process.exit" regression (bin/backslop.js) would hang the test, not fail it.
test('status --json arrives whole through a pipe that is read late', { timeout: 20000 }, async () => {
  const root = makeProject({ git: false });
  try {
    const title = 'A long title so that the output outgrows the pipe buffer '.repeat(4);
    for (let i = 1; i <= 400; i += 1) {
      put(root, `docs/backlog/queue/BS-${i}-t.md`, ruCard(`BS-${i}`, title, { order: i * 10 }));
    }
    const child = spawn(process.execPath, [BIN, 'status', '--json'], { cwd: root });
    await new Promise((resolve) => { setTimeout(resolve, 400); });
    const chunks = [];
    for await (const chunk of child.stdout) chunks.push(chunk);
    const out = Buffer.concat(chunks).toString('utf8');
    const code = await new Promise((resolve) => { child.on('close', resolve); });
    assert.equal(code, 0);
    assert.ok(out.length > 65536, `output ${out.length} bytes — did not outgrow the buffer, the probe is idle`);
    assert.equal(JSON.parse(out).queue.length, 400);
  } finally {
    cleanup(root);
  }
});

test('<command> --help and -h print the help outside a project too', () => {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-noproj-')));
  try {
    for (const args of [['new', '--help'], ['lint', '--help'], ['status', '-h'], ['init', '-h'], ['mv', '1', 'queue', '--help']]) {
      const r = cli(dir, args);
      assert.equal(r.code, 0, `${args.join(' ')}: ${r.err}`);
      assert.match(r.out, /Commands:/, args.join(' '));
      assert.ok(r.out.includes(RU.help(TOOL_VERSION)), args.join(' '));
    }
    assert.ok(!existsSync(path.join(dir, 'backslop.json')), 'init -h initialised the directory');
  } finally {
    cleanup(dir);
  }
});

// The help grid: a command line holds its description at column 54, or the synopsis ends the line
// and the description goes on the next line, indented by 54 spaces.
function helpGridFaults(help) {
  const lines = help.split('\n');
  const from = lines.findIndex((line) => /^\S.*:$/.test(line)) + 1;
  const faults = [];
  const block = lines.slice(from, lines.indexOf('', from));
  block.forEach((line, i) => {
    if (/^ {54}\S/.test(line) || /^ {8}\S/.test(line)) return;
    const gap = line.match(/^ {2}\S.*?( {2,})\S/);
    if (gap) {
      if (gap[0].length - 1 !== 54) faults.push(`description at column ${gap[0].length - 1}: ${line}`);
    } else if (!/^ {2}\S/.test(line)) {
      faults.push(`not a command line: ${line}`);
    } else if (!/^ {54}\S|^ {8}\S/.test(block[i + 1] ?? '')) {
      faults.push(`the synopsis ends the line but the next line is off the grid: ${line}`);
    }
  });
  return faults;
}

test('help prints its RU and EN content; the mv help line and the mv usage refusal agree', () => {
  const root = makeProject({ git: false });
  try {
    let r = cli(root, ['help']);
    assert.equal(r.code, 0);
    assert.ok(r.out.includes(RU.help(TOOL_VERSION)), 'the RU help is printed whole');
    assert.deepEqual(helpGridFaults(r.out), []);
    assert.notDeepEqual(helpGridFaults(r.out.replace('  show <N> ', '  show <N>  ')), [], 'a line off the grid is found');
    assert.match(r.out, /archive <N\.k> --into <M>/);

    // The mv line of the help and the usage refusal of mv itself must name the same position
    // flags: both are matched against one pattern, in RU and in EN.
    const flags = /mv <N…> <triage\|queue\|active\|deferred\|minor> \[--top \| --after M \| --restore\]/;
    assert.match(r.out, flags);
    r = cli(root, ['mv']);
    assert.equal(r.code, 1);
    assert.match(r.err, flags);
    put(root, 'backslop.json', read(root, 'backslop.json').replace('"lang": "ru"', '"lang": "en"'));
    r = cli(root, ['help']);
    assert.equal(r.code, 0);
    assert.match(r.out, /change status with git mv/);
    assert.deepEqual(helpGridFaults(r.out), []);
    assert.match(r.out, /fourteen gates/);
    assert.match(r.out, flags);
    r = cli(root, ['mv']);
    assert.equal(r.code, 1);
    assert.match(r.err, flags);
  } finally {
    cleanup(root);
  }
});

test('version, -v, a command --help and an unknown command: exit code and output', () => {
  const root = makeProject({ git: false });
  try {
    const rows = [
      { args: ['version'], code: 0, stream: 'out', regex: /^backslop \d+\.\d+\.\d+\n$/ },
      { args: ['-v'], code: 0, stream: 'out', regex: /^backslop \d+\.\d+\.\d+\n$/ },
      { args: ['new', '--help'], code: 0, stream: 'out', regex: new RegExp(escapeRe(RU.help(TOOL_VERSION))) },
      { args: ['frobnicate'], code: 1, stream: 'err', regex: ruRe('unknown command “{name}”; see {cli} help', { name: 'frobnicate' }) },
    ];
    for (const { args, code, stream, regex } of rows) {
      const r = cli(root, args);
      assert.equal(r.code, code, `${args.join(' ')}: ${r.err}`);
      assert.match(r[stream], regex, args.join(' '));
    }
  } finally {
    cleanup(root);
  }
});

test('help outside a project prints both languages', () => {
  const root = makeProject();
  try {
    const help = cli(root, ['help'], { cwd: path.dirname(root) }).out;
    assert.match(help, /Commands:/);
    assert.ok(help.includes(RU.help(TOOL_VERSION)));
  } finally {
    cleanup(root);
  }
});
