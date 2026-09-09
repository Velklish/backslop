// Обход markdown: одно множество файлов для гейтов и для правки ссылок при переезде.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mdFiles, repoMarkdown } from '../lib/mdwalk.js';

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

// ADR-016: корень harness ссылкой — граница обхода: mv и archive по этому множеству пишут, и
// правка markdown за ссылкой ушла бы за пределы проекта. Ссылкой считается любая компонента
// корня adapter'а; ссылка внутрь проекта не должна ронять файлы проекта под их настоящим путём
// (общий seen по realpath). Цели ссылок — в отдельной песочнице, чтобы результат не зависел от
// порядка readdir. Обычная ссылка внутри docs проходится.
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

// Комментарий у `srcFiles` в lib/mdwalk.js объявляет следование по ссылке намеренным: от петли
// держит набор пройденных настоящих путей, а не отказ идти по symlink. Тест про петлю — выше,
// этот — что за ссылкой файл действительно находится.
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
