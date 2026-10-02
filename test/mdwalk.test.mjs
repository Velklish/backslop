// The markdown walk: one set of files for the gates and for rewriting links on a move.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { markGenerated } from '../lib/adapter-ownership.js';
import { parseCli } from '../lib/config.js';
import { livePinFiles, mdFiles, repoMarkdown, rootMarkdown, stalePins } from '../lib/mdwalk.js';
import { rewriteProsePins } from '../lib/upgrade.js';
import { CliError } from '../lib/util.js';
import { cleanup, cli, gitAll, makeProject, read, ru, run } from './helpers.mjs';

function put(root, rel, text = '# x\n') {
  const abs = path.join(root, ...rel.split('/'));
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, text);
}

test('repoMarkdown: the root and directories in depth, without .git, node_modules and agent worktrees', () => {
  const sb = mkdtempSync(path.join(os.tmpdir(), 'backslop-walk-'));
  try {
    put(sb, 'README.md');
    put(sb, 'docs/README.md');
    put(sb, 'docs/backlog/queue/BS-1-a.md');
    put(sb, 'src/notes.txt', 'not markdown');
    put(sb, '.git/COMMIT_EDITMSG.md');
    put(sb, 'node_modules/pkg/README.md');
    put(sb, '.claude/worktrees/w1/docs/README.md');
    put(sb, '.claude/skills/backslop-task/SKILL.md', markGenerated('# x\n'));
    const rels = repoMarkdown(sb).map(([rel]) => rel).sort();
    assert.deepEqual(rels, [
      'README.md',
      'docs/README.md',
      'docs/backlog/queue/BS-1-a.md',
    ]);
    for (const [, abs] of repoMarkdown(sb)) assert.ok(path.isAbsolute(abs));
  } finally {
    rmSync(sb, { recursive: true, force: true });
  }
});

// `srcFiles` follows links on purpose; the set of real paths stops loops (this test). The
// harness-root test below guards that a file behind a directory link is found.
test('mdFiles: a symlink to an ancestor does not loop the walk', { skip: process.platform === 'win32' }, () => {
  const sb = mkdtempSync(path.join(os.tmpdir(), 'backslop-walk-'));
  try {
    put(sb, 'docs/a.md');
    symlinkSync(sb, path.join(sb, 'docs', 'loop'));
    const rels = mdFiles(path.join(sb, 'docs'), 'docs').map(([rel]) => rel);
    assert.deepEqual(rels, ['docs/a.md']);
  } finally {
    rmSync(sb, { recursive: true, force: true });
  }
});

// ADR-040. A link into the project does not drop the project files from under their real path
// (one shared `seen` by realpath); link targets sit in a separate sandbox: readdir order is moot.
test('repoMarkdown: the walk does not follow a link at the harness root — to .claude and .cursor/rules; a link into the project does not lose the project files', { skip: process.platform === 'win32' }, () => {
  const sb = mkdtempSync(path.join(os.tmpdir(), 'backslop-walk-'));
  const outside = mkdtempSync(path.join(os.tmpdir(), 'backslop-walk-outside-'));
  try {
    put(sb, 'docs/a.md');
    put(sb, 'tools/harness/skills/own.md');
    put(outside, 'harness/commands/note.md');
    put(outside, 'rules/mine.mdc');
    put(outside, 'docs/b.md');
    symlinkSync(path.join(outside, 'harness'), path.join(sb, '.claude'));
    mkdirSync(path.join(sb, '.cursor'));
    symlinkSync(path.join(outside, 'rules'), path.join(sb, '.cursor', 'rules'));
    mkdirSync(path.join(sb, '.agents'));
    symlinkSync(path.join(sb, 'tools', 'harness', 'skills'), path.join(sb, '.agents', 'skills'));
    symlinkSync(path.join(outside, 'docs'), path.join(sb, 'docs', 'link'));
    const rels = repoMarkdown(sb).map(([rel]) => rel).sort();
    assert.deepEqual(rels, ['docs/a.md', 'docs/link/b.md', 'tools/harness/skills/own.md']);
  } finally {
    rmSync(sb, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('livePinFiles: markdown and executable package/CI files are in, history and service directories are out', () => {
  const sb = mkdtempSync(path.join(os.tmpdir(), 'backslop-walk-'));
  try {
    put(sb, 'README.md');
    put(sb, 'CHANGELOG.md');
    put(sb, 'docs/live.md');
    put(sb, 'docs/adr/adr-001.md');
    put(sb, 'docs/archive/BS-1-old/task.md');
    put(sb, 'docs/backlog/queue/BS-2-card.md');
    put(sb, 'package.json');
    put(sb, 'packages/app/package.json');
    put(sb, 'old-package.json');
    put(sb, 'packages/app/fixture-package.json');
    put(sb, 'node_modules/dep/package.json');
    put(sb, '.gitlab-ci.yml');
    put(sb, '.github/workflows/ci.yml');
    put(sb, '.github/actions/check.yaml');
    put(sb, '.circleci/config.yml');
    const rels = livePinFiles(sb, 'docs', 'BS').map(([rel]) => rel).sort();
    assert.deepEqual(rels, [
      '.circleci/config.yml',
      '.github/actions/check.yaml',
      '.github/workflows/ci.yml',
      '.gitlab-ci.yml',
      'README.md',
      'docs/live.md',
      'package.json',
      'packages/app/package.json',
    ]);
  } finally {
    rmSync(sb, { recursive: true, force: true });
  }
});

test('rootMarkdown: a symlink counts once, only to a regular file inside the project; the non-link path wins', { skip: process.platform === 'win32' }, () => {
  const sb = mkdtempSync(path.join(os.tmpdir(), 'backslop-walk-'));
  const outside = mkdtempSync(path.join(os.tmpdir(), 'backslop-walk-outside-'));
  try {
    put(sb, 'AGENTS.md');
    put(sb, 'NOTES.MD');
    put(sb, 'notes/README.md');
    put(sb, 'docs/guide.md');
    mkdirSync(path.join(sb, 'dir.md'));
    put(outside, 'OUT.md');
    symlinkSync(path.join(sb, 'notes', 'README.md'), path.join(sb, 'README.md'));
    symlinkSync(path.join(sb, 'notes', 'README.md'), path.join(sb, 'SECOND.md'));
    symlinkSync(path.join(sb, 'AGENTS.md'), path.join(sb, 'CLAUDE.md'));
    symlinkSync(path.join(sb, 'docs', 'guide.md'), path.join(sb, 'GUIDE.md'));
    symlinkSync(path.join(outside, 'OUT.md'), path.join(sb, 'OUT.md'));
    symlinkSync(path.join(sb, 'none.md'), path.join(sb, 'DANGLING.md'));
    symlinkSync(path.join(sb, 'dir.md'), path.join(sb, 'LINKDIR.md'));
    const walked = mdFiles(path.join(sb, 'docs'), 'docs');
    const names = rootMarkdown(sb, walked).map(([name]) => name).sort();
    const kept = names.filter((n) => n === 'README.md' || n === 'SECOND.md');
    assert.equal(kept.length, 1, 'two links to one file count once');
    assert.deepEqual(names.filter((n) => !kept.includes(n)), ['AGENTS.md', 'NOTES.MD']);
    assert.deepEqual(rootMarkdown(sb).map(([name]) => name).filter((n) => n === 'GUIDE.md'), ['GUIDE.md'], 'unwalked docs file is read through the link');
  } finally {
    rmSync(sb, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('mdFiles: an upper-case .MD extension is walked', () => {
  const sb = mkdtempSync(path.join(os.tmpdir(), 'backslop-walk-'));
  try {
    put(sb, 'docs/NOTE.MD');
    put(sb, 'docs/b.Md');
    put(sb, 'docs/c.txt');
    assert.deepEqual(mdFiles(path.join(sb, 'docs'), 'docs').map(([rel]) => rel).sort(), ['docs/NOTE.MD', 'docs/b.Md']);
  } finally {
    rmSync(sb, { recursive: true, force: true });
  }
});

test('upgrade prose pins: a root symlink to a file outside the project is left unchanged', { skip: process.platform === 'win32' }, () => {
  const sb = mkdtempSync(path.join(os.tmpdir(), 'backslop-walk-'));
  const outside = mkdtempSync(path.join(os.tmpdir(), 'backslop-walk-outside-'));
  try {
    const old = 'npx github:me/proj#v0.1.0';
    put(sb, 'README.md', `Run \`${old} lint\`.\n`);
    put(outside, 'OUT.md', `Run \`${old} lint\`.\n`);
    symlinkSync(path.join(outside, 'OUT.md'), path.join(sb, 'OUT.md'));
    put(sb, 'notes/x.md');
    symlinkSync(path.join(sb, 'notes', 'x.md'), path.join(sb, 'LINKED.md'));
    const live = livePinFiles(sb, 'docs', 'BS').map(([rel]) => rel);
    assert.ok(live.includes('LINKED.md') && !live.includes('OUT.md'), live.join(' '));
    assert.ok(rewriteProsePins(sb, 'docs', 'BS', parseCli(old), 'v0.2.0').includes('README.md'));
    assert.equal(readFileSync(path.join(outside, 'OUT.md'), 'utf8'), `Run \`${old} lint\`.\n`);
  } finally {
    rmSync(sb, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('stalePins: pins off the cli pin with their line, a journal entry of LOG.md excluded', () => {
  const sb = mkdtempSync(path.join(os.tmpdir(), 'backslop-walk-'));
  try {
    const form = parseCli('npx github:me/proj#v0.2.0');
    put(sb, 'README.md', 'Run `npx github:me/proj#v0.2.0 lint`.\nOr `npx github:me/proj#v0.1.0 lint`.\n');
    const entry = '- <a id="bs-1"></a>`BS-1-x` · 2026-01-01 · completed · — · Measured with `npx github:me/proj#v0.1.0 lint`';
    put(sb, 'docs/archive/LOG.md', `# Log\n\nOld: \`npx github:me/proj#v0.1.0\`.\n\n${entry}\n`);
    const pins = stalePins(sb, 'docs', 'BS', form).map(({ abs, lineNo, match }) => [path.relative(sb, abs), lineNo, match[0]]);
    assert.deepEqual(pins.sort(), [
      [path.join('README.md'), 2, 'github:me/proj#v0.1.0'],
      [path.join('docs', 'archive', 'LOG.md'), 3, 'github:me/proj#v0.1.0'],
    ].sort());
  } finally {
    rmSync(sb, { recursive: true, force: true });
  }
});

const asRoot = process.getuid?.() === 0;

test('srcFiles: an unreadable directory is a CliError that names it', { skip: process.platform === 'win32' || asRoot }, () => {
  const sb = mkdtempSync(path.join(os.tmpdir(), 'backslop-walk-'));
  const locked = path.join(sb, 'docs', 'locked');
  try {
    put(sb, 'docs/a.md');
    mkdirSync(locked);
    chmodSync(locked, 0o000);
    assert.throws(() => mdFiles(path.join(sb, 'docs'), 'docs'), (e) => e instanceof CliError && e.message.includes(locked) && e.dir === locked);
  } finally {
    chmodSync(locked, 0o755);
    rmSync(sb, { recursive: true, force: true });
  }
});

const WALK = '{rel}: the directory is not readable ({code}) — lint cannot walk it; restore read access or move it out of the project';
const WHAT = '{rel}: the directory is not readable ({code}) — {what}; restore read access or move it out of the project';

test('lint names an unreadable directory in the project language instead of a stack trace', { skip: process.platform === 'win32' || asRoot }, () => {
  const root = makeProject();
  const locked = path.join(root, 'src', 'locked');
  try {
    mkdirSync(locked, { recursive: true });
    chmodSync(locked, 0o000);
    let r = cli(root, ['lint']);
    assert.equal(r.code, 1, r.out);
    assert.equal(r.err, `✖ ${ru(WALK, { rel: 'src/locked', code: 'EACCES' })}\n`);
    put(root, 'backslop.json', read(root, 'backslop.json').replace('"lang": "ru"', '"lang": "en"'));
    r = cli(root, ['lint']);
    assert.equal(r.code, 1, r.out);
    assert.equal(r.err, '✖ src/locked: the directory is not readable (EACCES) — lint cannot walk it; restore read access or move it out of the project\n');
  } finally {
    chmodSync(locked, 0o755);
    cleanup(root);
  }
});

const TAIL_EN = 'restore read access or move it out of the project';

test('status and lint word an unreadable status directory or archive, not a stack trace', { skip: process.platform === 'win32' || asRoot }, () => {
  for (const rel of ['docs/backlog/queue', 'docs/archive']) {
    const root = makeProject();
    const locked = path.join(root, ...rel.split('/'));
    try {
      chmodSync(locked, 0o000);
      let r = cli(root, ['status']);
      assert.equal(r.code, 1, `${rel}: ${r.out}`);
      assert.equal(r.err, `✖ ${ru(WHAT, { rel, code: 'EACCES', what: ru('tasks cannot be read from it') })}\n`);
      r = cli(root, ['lint']);
      assert.equal(r.code, 1, `${rel}: ${r.out}`);
      assert.equal(r.err, `✖ ${ru(WALK, { rel, code: 'EACCES' })}\n`);
      put(root, 'backslop.json', read(root, 'backslop.json').replace('"lang": "ru"', '"lang": "en"'));
      r = cli(root, ['status']);
      assert.equal(r.err, `✖ ${rel}: the directory is not readable (EACCES) — tasks cannot be read from it; ${TAIL_EN}\n`);
    } finally {
      chmodSync(locked, 0o755);
      cleanup(root);
    }
  }
});

test('mv words an unreadable directory of the link walk, not a bare code', { skip: process.platform === 'win32' || asRoot }, () => {
  const root = makeProject({ git: false });
  const locked = path.join(root, 'src', 'locked');
  try {
    put(root, 'docs/backlog/triage/BS-1-a.md', '# BS-1 · a\n');
    put(root, 'docs/backlog/triage/BS-2-b.md', '# BS-2 · b\n');
    mkdirSync(locked, { recursive: true });
    chmodSync(locked, 0o000);
    let r = cli(root, ['mv', '1', 'queue']);
    assert.equal(r.code, 1, r.out);
    assert.ok(r.err.endsWith(`✖ ${ru(WHAT, { rel: 'src/locked', code: 'EACCES', what: ru('links in it cannot be updated') })}\n`), r.err);
    put(root, 'backslop.json', read(root, 'backslop.json').replace('"lang": "ru"', '"lang": "en"'));
    r = cli(root, ['mv', '2', 'queue']);
    assert.ok(r.err.endsWith(`✖ src/locked: the directory is not readable (EACCES) — links in it cannot be updated; ${TAIL_EN}\n`), r.err);
  } finally {
    chmodSync(locked, 0o755);
    cleanup(root);
  }
});

// A directory the link walk cannot list refuses the command, and the card stays where it was: a
// repeat finds it in its status directory instead of answering "already there".
test('mv and archive refuse over an unreadable directory before the card moves, and a repeat works', { skip: process.platform === 'win32' || asRoot }, () => {
  const root = makeProject({ git: false });
  const locked = path.join(root, 'src', 'locked');
  try {
    put(root, 'docs/backlog/triage/BS-1-a.md', '# BS-1 · a\n');
    put(root, 'docs/backlog/queue/BS-2-b.md', '# BS-2 · b\n');
    mkdirSync(locked, { recursive: true });
    chmodSync(locked, 0o000);
    let r = cli(root, ['mv', '1', 'queue']);
    assert.equal(r.code, 1, r.out);
    assert.ok(existsSync(path.join(root, 'docs/backlog/triage/BS-1-a.md')), 'mv: the card stays in triage/');
    assert.ok(!existsSync(path.join(root, 'docs/backlog/queue/BS-1-a.md')), 'mv: nothing arrived in queue/');
    r = cli(root, ['archive', '2']);
    assert.equal(r.code, 1, r.out);
    assert.ok(existsSync(path.join(root, 'docs/backlog/queue/BS-2-b.md')), 'archive: the card stays in queue/');
    assert.ok(!existsSync(path.join(root, 'docs/archive/BS-2-b')), 'archive: no directory was made');
    chmodSync(locked, 0o755);
    r = cli(root, ['mv', '1', 'queue']);
    assert.equal(r.code, 0, r.err);
    r = cli(root, ['archive', '2']);
    assert.equal(r.code, 0, r.err);
    assert.ok(existsSync(path.join(root, 'docs/archive/BS-2-b/task.md')));
  } finally {
    chmodSync(locked, 0o755);
    cleanup(root);
  }
});

test('mv with a symlinked alias of a status directory in the link walk moves the card and does not read the old path', { skip: process.platform === 'win32' }, () => {
  const root = makeProject({ git: false });
  try {
    put(root, 'docs/backlog/triage/BS-1-a.md', '# BS-1 · a\n');
    symlinkSync(path.join(root, 'docs', 'backlog'), path.join(root, 'aa-alias'));
    const r = cli(root, ['mv', '1', 'queue']);
    assert.equal(r.code, 0, r.err);
    assert.ok(existsSync(path.join(root, 'docs/backlog/queue/BS-1-a.md')), 'the card is in queue/');
  } finally {
    cleanup(root);
  }
});

test('commands word a status tree whose parent is unreadable, not an empty backlog or a stack trace', { skip: process.platform === 'win32' || asRoot }, () => {
  const root = makeProject();
  const locked = path.join(root, 'docs', 'backlog');
  try {
    put(root, 'docs/backlog/triage/BS-1-a.md', '# BS-1 · a\n');
    gitAll(root);
    chmodSync(locked, 0o000);
    const worded = `✖ ${ru(WHAT, { rel: 'docs/backlog', code: 'EACCES', what: ru('tasks cannot be read from it') })}\n`;
    for (const args of [['status'], ['status', '--json'], ['show', '1'], ['brief', '1'], ['mv', '1', 'queue'], ['archive', '1'], ['new', 'zzz']]) {
      const r = cli(root, args);
      assert.equal(r.code, 1, `${args.join(' ')}: ${r.out}`);
      assert.equal(r.err, worded, args.join(' '));
    }
    // Searchable but not listable: the scan passes, the search for a flat card does not.
    chmodSync(locked, 0o111);
    const r = cli(root, ['mv', '2', 'queue']);
    assert.equal(r.code, 1, r.out);
    assert.equal(r.err, worded);
  } finally {
    chmodSync(locked, 0o755);
    cleanup(root);
  }
});

test('new words an unreadable status directory of another worktree, not a stack trace', { skip: process.platform === 'win32' || asRoot }, () => {
  const root = makeProject();
  const other = `${root}-other`;
  try {
    put(root, 'docs/backlog/queue/.gitkeep', '');
    gitAll(root);
    run(root, ['worktree', 'add', '-q', '-b', 'other', other]);
    const locked = path.join(other, 'docs', 'backlog', 'queue');
    chmodSync(locked, 0o111);
    const r = cli(root, ['new', 'zzz']);
    chmodSync(locked, 0o755);
    assert.equal(r.code, 1, r.out);
    const rel = path.relative(root, locked).split(path.sep).join('/');
    assert.equal(r.err, `✖ ${ru(WHAT, { rel, code: 'EACCES', what: ru('task numbers cannot be read from it') })}\n`);
  } finally {
    cleanup(root);
    rmSync(other, { recursive: true, force: true });
  }
});
