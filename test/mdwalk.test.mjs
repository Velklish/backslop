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

// Комментарий lib/mdwalk.js:33-34 объявляет следование по ссылке намеренным: от петли держит
// набор пройденных настоящих путей, а не отказ идти по symlink. Тест выше проверяет петлю,
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
