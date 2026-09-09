// Команда tracks: перечень worktree и веток захода с ответом «убирать можно» или «потеряешь
// работу». Worktree заводятся настоящим git — предмет проверки как раз в том, что читается
// живое состояние репозитория, а не выдумка.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanup, cli, makeProject, put, run } from './helpers.mjs';

// Worktree кладутся рядом с проектом, а не внутрь него: внутри git ругается на вложенный
// репозиторий, а обход markdown принял бы их файлы за файлы проекта.
function beside(root, name) {
  return path.join(path.dirname(root), `${path.basename(root)}-${name}`);
}

function seedRun(root) {
  put(root, 'docs/backlog/queue/BS-1-a.md', '# BS-1 · А\n\n- **Порядок:** 10\n');
  run(root, ['add', '-A']);
  run(root, ['commit', '-qm', 'BS-1: задача заведена']);

  // Track, который влит: своя ветка стоит на том же коммите, что HEAD, дерево чистое.
  run(root, ['branch', 'track-merged']);
  run(root, ['worktree', 'add', '-q', beside(root, 'merged'), 'track-merged']);

  // Track, который не влит: коммит задачи мимо HEAD плюс незакоммиченный файл.
  run(root, ['branch', 'track-pending']);
  run(root, ['worktree', 'add', '-q', beside(root, 'pending'), 'track-pending']);
  const wt = beside(root, 'pending');
  put(wt, 'docs/backlog/queue/BS-2-b.md', '# BS-2 · Б\n\n- **Порядок:** 20\n');
  run(wt, ['add', '-A']);
  run(wt, ['commit', '-qm', 'BS-2: работа второго track']);
  run(wt, ['commit', '-q', '--allow-empty', '-m', 'мимо префикса задач']);
  put(wt, 'docs/backlog/queue/BS-3-c.md', '# BS-3 · В\n\n- **Порядок:** 30\n');
}

function dropRun(root) {
  for (const name of ['merged', 'pending']) rmSync(beside(root, name), { recursive: true, force: true });
  cleanup(root);
}

test('tracks: влитый track и невлитый различаются, незакоммиченное названо', () => {
  const root = makeProject();
  try {
    seedRun(root);
    const r = cli(root, ['tracks']);
    assert.equal(r.code, 0, r.err);

    // Своё дерево в перечень не идёт: убирают не за собой. Каталоги worktree начинаются с пути
    // проекта, поэтому сверяется строка целиком, а не вхождение подстроки.
    const own = root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.doesNotMatch(r.out, new RegExp(`^ {2}${own} \\(`, 'm'));

    assert.match(r.out, /track-merged\)\n {4}влит в HEAD\n {4}не влитых коммитов задач нет\n {4}незакоммиченного нет/);
    assert.match(r.out, /track-pending\)\n {4}не влит в HEAD\n {4}не влито коммитов задач: 1\n {6}\w+ BS-2: работа второго track/);
    // Коммит без префикса задачи в перечень не попадает — считаются работы, а не все правки.
    assert.doesNotMatch(r.out, /мимо префикса задач/);
    assert.match(r.out, /незакоммиченного: 1\n {6}\?\? docs\/backlog\/queue\/BS-3-c\.md/);
    assert.match(r.out, /tracks: worktree и веток 2, не влитых 1/);
  } finally {
    dropRun(root);
  }
});

test('tracks --json: та же картина машиночитаемо, незакоммиченное отдельным полем', () => {
  const root = makeProject();
  try {
    seedRun(root);
    const r = cli(root, ['tracks', '--json']);
    assert.equal(r.code, 0, r.err);
    const report = JSON.parse(r.out);
    assert.equal(report.total, 2);

    const merged = report.tracks.find((t) => t.branch === 'track-merged');
    assert.equal(merged.kind, 'worktree');
    assert.equal(merged.merged, true);
    assert.deepEqual(merged.pending, []);
    assert.deepEqual(merged.dirty, [], 'чистое дерево — пустой список, а не null');

    const pending = report.tracks.find((t) => t.branch === 'track-pending');
    assert.equal(pending.merged, false);
    assert.equal(pending.pending.length, 1);
    assert.match(pending.pending[0], /BS-2: работа второго track/);
    assert.deepEqual(pending.dirty, ['?? docs/backlog/queue/BS-3-c.md']);
  } finally {
    dropRun(root);
  }
});

test('tracks: репозиторий без чужих worktree и веток — пустой перечень и код 0', () => {
  const root = makeProject();
  try {
    put(root, 'docs/backlog/queue/BS-1-a.md', '# BS-1 · А\n\n- **Порядок:** 10\n');
    run(root, ['add', '-A']);
    run(root, ['commit', '-qm', 'BS-1: задача заведена']);
    const r = cli(root, ['tracks']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /tracks: worktree и веток 0, не влитых 0/);
    assert.equal(JSON.parse(cli(root, ['tracks', '--json']).out).tracks.length, 0);
  } finally {
    cleanup(root);
  }
});

test('tracks: ветка без worktree попадает в перечень по коммитам задач мимо HEAD', () => {
  const root = makeProject();
  try {
    put(root, 'docs/backlog/queue/BS-1-a.md', '# BS-1 · А\n\n- **Порядок:** 10\n');
    run(root, ['add', '-A']);
    run(root, ['commit', '-qm', 'BS-1: задача заведена']);

    run(root, ['checkout', '-q', '-b', 'track-branch-only']);
    run(root, ['commit', '-q', '--allow-empty', '-m', 'BS-4: только ветка, без worktree']);
    // От main, а не от предыдущей ветки: иначе коммит BS-4 достался бы ей по наследству.
    // Своих коммитов задач у неё нет — в перечень не идёт, хотя коммит мимо HEAD у неё есть.
    run(root, ['checkout', '-q', 'main']);
    run(root, ['checkout', '-q', '-b', 'без-задач']);
    run(root, ['commit', '-q', '--allow-empty', '-m', 'правка мимо трекера']);
    run(root, ['checkout', '-q', 'main']);

    const report = JSON.parse(cli(root, ['tracks', '--json']).out);
    const branches = report.tracks.map((t) => t.branch).sort();
    assert.deepEqual(branches, ['track-branch-only']);
    const only = report.tracks[0];
    assert.equal(only.kind, 'branch');
    assert.equal(only.path, null);
    assert.equal(only.dirty, null, 'у ветки без worktree дерева нет — не «чисто», а «нечего смотреть»');
    assert.equal(only.pending.length, 1);
  } finally {
    cleanup(root);
  }
});

test('tracks: без git-репозитория — отказ текстом, а не пустой перечень', () => {
  const root = makeProject({ git: false });
  try {
    const r = cli(root, ['tracks']);
    assert.equal(r.code, 1);
    assert.match(r.err, /git-репозитория нет/);
  } finally {
    cleanup(root);
  }
});

test('tracks: коммит задачи опознаётся по заголовку, а не по телу сообщения', () => {
  const root = makeProject();
  try {
    put(root, 'docs/backlog/queue/BS-1-a.md', '# BS-1 · А\n\n- **Порядок:** 10\n');
    run(root, ['add', '-A']);
    run(root, ['commit', '-qm', 'BS-1: задача заведена']);
    run(root, ['checkout', '-q', '-b', 'track-body']);
    // Схлопнутый коммит тащит заголовки схлопнутых в тело — по телу в перечень попала бы
    // работа, которой в заголовке номера задачи нет.
    run(root, ['commit', '-q', '--allow-empty', '-m', 'правка мимо трекера\n\nBS-9: заголовок в теле']);
    run(root, ['checkout', '-q', 'main']);

    const report = JSON.parse(cli(root, ['tracks', '--json']).out);
    assert.deepEqual(report.tracks, [], 'коммит с номером только в теле track-ом не считается');
  } finally {
    cleanup(root);
  }
});

test('tracks: detached worktree меряется по своему sha, а не считается невлитым', () => {
  const root = makeProject();
  try {
    put(root, 'docs/backlog/queue/BS-1-a.md', '# BS-1 · А\n\n- **Порядок:** 10\n');
    run(root, ['add', '-A']);
    run(root, ['commit', '-qm', 'BS-1: задача заведена']);
    run(root, ['worktree', 'add', '-q', '--detach', beside(root, 'detached'), 'HEAD']);

    const report = JSON.parse(cli(root, ['tracks', '--json']).out);
    assert.equal(report.tracks.length, 1);
    const wt = report.tracks[0];
    assert.equal(wt.branch, null, 'ветки у detached нет');
    assert.match(wt.head, /^[0-9a-f]+$/, 'sha из porcelain прочитан');
    assert.equal(wt.merged, true, 'detached на HEAD влит, а не «не влит»');
    assert.deepEqual(wt.pending, []);
  } finally {
    rmSync(beside(root, 'detached'), { recursive: true, force: true });
    cleanup(root);
  }
});
