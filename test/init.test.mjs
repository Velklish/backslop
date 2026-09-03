// init и сквозной цикл: раскладка → lint → new → mv → archive → lint; повтор init ничего не ломает.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { cleanup, cli, put, read } from './helpers.mjs';
import { TOOL_VERSION } from '../lib/version.js';

function emptyRepo() {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-init-')));
  spawnSync('git', ['-C', root, 'init', '-q', '-b', 'main']);
  spawnSync('git', ['-C', root, 'config', 'user.email', 'test@example.com']);
  spawnSync('git', ['-C', root, 'config', 'user.name', 'test']);
  return root;
}

const EXPECTED = [
  'backslop.json', 'AGENTS.md', 'CLAUDE.md',
  '.claude/skills/backslop-task/SKILL.md', '.claude/skills/backslop-batch/SKILL.md', '.claude/skills/backslop-batch/references/measurements.md',
  '.claude/skills/backslop-seed/SKILL.md', '.claude/skills/backslop-seed/references/inventory.md',
  '.claude/skills/backslop-seed/references/glossary.md', '.claude/skills/backslop-seed/references/adr-backfill.md',
  'docs/README.md', 'docs/ROADMAP.md', 'docs/GLOSSARY.md', 'docs/reference/README.md',
  'docs/adr/adr-001-process.md', 'docs/backlog/README.md', 'docs/archive/README.md',
  'docs/backlog/triage/.gitkeep', 'docs/backlog/queue/.gitkeep', 'docs/backlog/active/.gitkeep', 'docs/backlog/deferred/.gitkeep',
];

test('init: раскладка, lint зелёный, сквозной цикл задачи, повтор init идемпотентен', () => {
  const root = emptyRepo();
  try {
    writeFileSync(path.join(root, 'package.json'), '{ "name": "@me/demo-app" }\n');
    let r = cli(root, ['init']);
    assert.equal(r.code, 0, r.err);
    for (const rel of EXPECTED) assert.ok(existsSync(path.join(root, rel)), `нет ${rel}`);
    const cfg = JSON.parse(read(root, 'backslop.json'));
    assert.deepEqual(cfg, {
      prefix: 'BS', docs: 'docs', cli: `npx github:Velklish/backslop#v${TOOL_VERSION}`,
      gates: [`npx github:Velklish/backslop#v${TOOL_VERSION} lint`], version: TOOL_VERSION,
    });
    assert.match(read(root, 'docs/README.md'), /^# Документация demo-app\n/);
    assert.match(read(root, 'docs/adr/adr-001-process.md'), /\*\*Date:\*\* \d{4}-\d{2}-\d{2}\n/);
    assert.doesNotMatch(read(root, 'docs/backlog/README.md'), /\{\{/);
    assert.doesNotMatch(read(root, '.claude/skills/backslop-task/SKILL.md'), /\{\{/);
    assert.equal(read(root, 'CLAUDE.md'), '@AGENTS.md\n');
    const agents = read(root, 'AGENTS.md');
    assert.equal((agents.match(/<!-- backslop:start -->/g) ?? []).length, 1);
    assert.match(agents, /npx github:Velklish\/backslop#v\d+\.\d+\.\d+ status/);

    r = cli(root, ['lint']);
    assert.equal(r.code, 0, r.err + r.out);

    r = cli(root, ['status']);
    assert.match(r.out, /Очередь \(0\)/);
    r = cli(root, ['new', 'first-task', '--queue', '--title', 'Первая задача']);
    assert.equal(r.code, 0, r.err);
    r = cli(root, ['mv', '1', 'active']);
    assert.equal(r.code, 0, r.err);
    spawnSync('git', ['-C', root, 'add', '-A']);
    spawnSync('git', ['-C', root, 'commit', '-qm', 'посев']);
    r = cli(root, ['archive', '1']);
    assert.equal(r.code, 0, r.err);
    r = cli(root, ['lint']);
    assert.equal(r.code, 1, 'result.md с [TODO] держит lint красным');
    assert.match(r.err, /результат не дописан/);
    put(root, 'docs/archive/BS-1-first-task/result.md', '# BS-1 · Результат\n\n**Закрыта 2026-09-03.** Сделано.\n');
    r = cli(root, ['lint']);
    assert.equal(r.code, 0, r.err);

    // Повтор: docs не тронуты, конфиг тот же, блок заменён на тот же текст, скиллы переписаны.
    const agentsBefore = read(root, 'AGENTS.md');
    put(root, 'docs/GLOSSARY.md', '# Мой глоссарий\n');
    put(root, '.claude/skills/backslop-task/SKILL.md', 'испорчено\n');
    put(root, 'AGENTS.md', `# Шапка проекта\n\n${agentsBefore.replace('Трекер задач', 'ИСПОРЧЕНО')}`);
    r = cli(root, ['init']);
    assert.equal(r.code, 0, r.err);
    assert.equal(read(root, 'docs/GLOSSARY.md'), '# Мой глоссарий\n', 'docs не перезаписываются');
    assert.match(read(root, '.claude/skills/backslop-task/SKILL.md'), /^---\nname: backslop-task/, 'скиллы обновляются');
    const agentsAfter = read(root, 'AGENTS.md');
    assert.equal(agentsAfter, `# Шапка проекта\n\n${agentsBefore}`, 'блок заменён между маркерами, шапка сохранена');
    assert.equal((agentsAfter.match(/<!-- backslop:start -->/g) ?? []).length, 1);
    assert.equal((agentsAfter.match(/<!-- backslop:end -->/g) ?? []).length, 1);
    assert.match(r.out, /оставлено как есть/);
  } finally {
    cleanup(root);
  }
});

test('init: свой префикс и каталог, существующий AGENTS.md сохраняется, конфликт флагов с конфигом — отказ', () => {
  const root = emptyRepo();
  try {
    put(root, 'AGENTS.md', '# Мой проект\n\nПравила проекта.\n');
    put(root, 'CLAUDE.md', 'Что-то своё\n');
    let r = cli(root, ['init', '--prefix', 'DFL', '--dir', 'doc']);
    assert.equal(r.code, 0, r.err);
    assert.ok(existsSync(path.join(root, 'doc/backlog/README.md')));
    assert.match(read(root, 'doc/archive/README.md'), /DFL-<номер>-<slug>/);
    const agents = read(root, 'AGENTS.md');
    assert.match(agents, /^# Мой проект\n\nПравила проекта\.\n\n<!-- backslop:start -->/);
    assert.match(agents, /префикс задач — `DFL`/);
    assert.match(r.err, /не импортирует AGENTS\.md/);
    assert.equal(read(root, 'CLAUDE.md'), 'Что-то своё\n');

    r = cli(root, ['new', 'x', '--queue']);
    assert.ok(existsSync(path.join(root, 'doc/backlog/queue/DFL-1-x.md')));
    r = cli(root, ['lint']);
    assert.equal(r.code, 0, r.err);

    r = cli(root, ['init', '--prefix', 'ZZ']);
    assert.equal(r.code, 1);
    assert.match(r.err, /prefix = «DFL»/);
    r = cli(root, ['init', '--prefix', 'bad']);
    assert.equal(r.code, 1);
  } finally {
    cleanup(root);
  }
});

test('init: внутри уже инициализированного проекта — отказ с путём корня', () => {
  const root = emptyRepo();
  try {
    let r = cli(root, ['init']);
    assert.equal(r.code, 0, r.err);
    const sub = path.join(root, 'src');
    put(root, 'src/keep.txt', '');
    r = cli(root, ['init'], { cwd: sub });
    assert.equal(r.code, 1);
    assert.match(r.err, /уже инициализирован выше/);
    assert.ok(!existsSync(path.join(sub, 'backslop.json')));
  } finally {
    cleanup(root);
  }
});

test('init: CLAUDE.md-симлинк на AGENTS.md не считается пропущенным импортом; --dir нормализуется', () => {
  const root = emptyRepo();
  try {
    put(root, 'AGENTS.md', '# Проект\n');
    symlinkSync('AGENTS.md', path.join(root, 'CLAUDE.md'));
    const r = cli(root, ['init', '--dir', 'docs/']);
    assert.equal(r.code, 0, r.err);
    assert.doesNotMatch(r.err, /не импортирует/);
    assert.match(r.out, /симлинк на AGENTS\.md/);
    assert.equal(JSON.parse(read(root, 'backslop.json')).docs, 'docs');
    assert.doesNotMatch(read(root, 'AGENTS.md'), /docs\/\//);
  } finally {
    cleanup(root);
  }
});

test('init повторно: штамп версии переставляется, расхождение с пином в cli называется', () => {
  const root = emptyRepo();
  try {
    let r = cli(root, ['init']);
    assert.equal(r.code, 0, r.err);
    const cfg = JSON.parse(read(root, 'backslop.json'));
    put(root, 'backslop.json', `${JSON.stringify({ ...cfg, version: '0.0.1', cli: 'npx github:Velklish/backslop#v0.0.1' }, null, 2)}\n`);
    r = cli(root, ['init']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /штамп версии: v0\.0\.1 → v\d+\.\d+\.\d+/);
    assert.match(r.err, /пин в cli — v0\.0\.1, а раскладку сделала v/);
    const after = JSON.parse(read(root, 'backslop.json'));
    assert.equal(after.version, TOOL_VERSION);
    assert.equal(after.cli, 'npx github:Velklish/backslop#v0.0.1', 'пин init не трогает — это ход upgrade');
  } finally {
    cleanup(root);
  }
});

test('init на проекте со своим docs/README.md: ADR-001 создан, строка в таблицу — подсказкой', () => {
  const root = emptyRepo();
  try {
    put(root, 'docs/README.md', '# Мои доки\n');
    const r = cli(root, ['init']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /docs\/README\.md уже был: добавь в таблицу строку/);
    assert.equal(read(root, 'docs/README.md'), '# Мои доки\n');
  } finally {
    cleanup(root);
  }
});
