// Обход markdown: одно множество файлов для гейтов и для правки ссылок при переезде.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseCli } from '../lib/config.js';
import { livePinFiles, mdFiles, repoMarkdown, rootMarkdown } from '../lib/mdwalk.js';
import { rewriteProsePins } from '../lib/upgrade.js';

function put(root, rel, text = '# x\n') {
  const abs = path.join(root, ...rel.split('/'));
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, text);
}

test('repoMarkdown: корень и каталоги вглубь, без .git, node_modules и worktrees агентов', () => {
  const sb = mkdtempSync(path.join(os.tmpdir(), 'backslop-walk-'));
  try {
    put(sb, 'README.md');
    put(sb, 'docs/README.md');
    put(sb, 'docs/backlog/queue/BS-1-a.md');
    put(sb, 'src/notes.txt', 'не markdown');
    put(sb, '.git/COMMIT_EDITMSG.md');
    put(sb, 'node_modules/pkg/README.md');
    put(sb, '.claude/worktrees/w1/docs/README.md');
    put(sb, '.claude/skills/backslop-task/SKILL.md');
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

test('mdFiles: симлинк на предка не зацикливает обход', { skip: process.platform === 'win32' }, () => {
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

// ADR-016. Ссылка внутрь проекта не роняет файлы проекта под их настоящим путём (общий seen по
// realpath); цели ссылок — в отдельной песочнице, чтобы результат не зависел от порядка readdir.
test('repoMarkdown: за ссылку на корне harness обход не заходит — на .claude и на .cursor/rules; ссылка внутрь проекта файлы проекта не теряет', { skip: process.platform === 'win32' }, () => {
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

// `srcFiles` идёт по ссылке намеренно, от петли держит набор настоящих путей. Тест про петлю —
// выше, этот — что за ссылкой файл действительно находится.
test('mdFiles: файл за симлинком на каталог попадает в обход', { skip: process.platform === 'win32' }, () => {
  const sb = mkdtempSync(path.join(os.tmpdir(), 'backslop-walk-'));
  try {
    put(sb, 'docs/a.md');
    put(sb, 'outside/b.md');
    symlinkSync(path.join(sb, 'outside'), path.join(sb, 'docs', 'link'));
    const rels = mdFiles(path.join(sb, 'docs'), 'docs').map(([rel]) => rel).sort();
    assert.deepEqual(rels, ['docs/a.md', 'docs/link/b.md']);
  } finally {
    rmSync(sb, { recursive: true, force: true });
  }
});

test('livePinFiles: markdown и исполняемые package/CI входят, история и служебные каталоги исключены', () => {
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
