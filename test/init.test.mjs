// init и сквозной цикл: раскладка → lint → new → mv → archive → lint; повтор init ничего не ломает.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
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
  'backslop.json', 'AGENTS.md',
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
      lang: 'ru', tools: [],
    });
    assert.match(read(root, 'docs/README.md'), /^# Документация demo-app\n/);
    assert.match(read(root, 'docs/adr/adr-001-process.md'), /\*\*Date:\*\* \d{4}-\d{2}-\d{2}\n/);
    assert.doesNotMatch(read(root, 'docs/backlog/README.md'), /\{\{/);
    assert.ok(!existsSync(path.join(root, 'CLAUDE.md')));
    assert.ok(!existsSync(path.join(root, '.claude/skills/backslop-task/SKILL.md')));
    const agents = read(root, 'AGENTS.md');
    assert.equal((agents.match(/<!-- backslop:start -->/g) ?? []).length, 1);
    assert.match(agents, /npx github:Velklish\/backslop#v\d+\.\d+\.\d+ status/);
    assert.match(agents, /Скиллы \(если выбран adapter\)/);

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

    // Повтор: docs не тронуты, конфиг тот же, блок заменён на тот же текст.
    const agentsBefore = read(root, 'AGENTS.md');
    put(root, 'docs/GLOSSARY.md', '# Мой глоссарий\n');
    put(root, 'AGENTS.md', `# Шапка проекта\n\n${agentsBefore.replace('Трекер задач', 'ИСПОРЧЕНО')}`);
    r = cli(root, ['init']);
    assert.equal(r.code, 0, r.err);
    assert.equal(read(root, 'docs/GLOSSARY.md'), '# Мой глоссарий\n', 'docs не перезаписываются');
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

test('init: при tools=[] CLAUDE.md-симлинк сохраняется; --dir нормализуется', () => {
  const root = emptyRepo();
  try {
    put(root, 'AGENTS.md', '# Проект\n');
    symlinkSync('AGENTS.md', path.join(root, 'CLAUDE.md'));
    const r = cli(root, ['init', '--dir', 'docs/']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /CLAUDE\.md: не выбран/);
    assert.equal(JSON.parse(read(root, 'backslop.json')).docs, 'docs');
    assert.doesNotMatch(read(root, 'AGENTS.md'), /docs\/\//);
  } finally {
    cleanup(root);
  }
});

test('init: adapters имеют canonical layout; deselect удаляет только owned outputs', () => {
  const root = emptyRepo();
  try {
    let r = cli(root, ['init', '--tools', 'codex,cursor,claude']);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(JSON.parse(read(root, 'backslop.json')).tools, ['claude', 'cursor', 'codex']);
    assert.equal(read(root, 'CLAUDE.md'), '@AGENTS.md\n');
    assert.ok(existsSync(path.join(root, '.claude/skills/backslop-task/SKILL.md')));
    assert.ok(existsSync(path.join(root, '.agents/skills/backslop-task/SKILL.md')));
    const cursor = read(root, '.cursor/rules/backslop-batch.mdc');
    assert.match(cursor, /^---\ndescription: ".+"\nalwaysApply: false\n---\n<!-- backslop:generated -->\n\n# backslop-batch/m);
    assert.match(cursor, /\(backslop-batch\/references\/measurements\.md\)/);
    assert.ok(existsSync(path.join(root, '.cursor/rules/backslop-batch/references/measurements.md')));
    assert.equal(cli(root, ['lint']).code, 0);

    r = cli(root, ['init', '--tools', 'none']);
    assert.equal(r.code, 0, r.err);
    assert.ok(!existsSync(path.join(root, 'CLAUDE.md')), 'точный generated stub удаляется');
    r = cli(root, ['init', '--tools', 'claude,cursor,codex']);
    assert.equal(r.code, 0, r.err);

    put(root, '.claude/skills/backslop-task/custom.md', 'custom quotes <!-- backslop:generated -->\n');
    put(root, '.cursor/rules/custom.mdc', 'custom\n');
    put(root, '.agents/skills/custom/SKILL.md', 'custom\n');
    put(root, 'CLAUDE.md', 'custom Claude instructions\n');
    r = cli(root, ['init', '--tools', 'none']);
    assert.equal(r.code, 0, r.err);
    assert.ok(!existsSync(path.join(root, '.claude/skills/backslop-task/SKILL.md')));
    assert.ok(!existsSync(path.join(root, '.cursor/rules/backslop-task.mdc')));
    assert.ok(!existsSync(path.join(root, '.agents/skills/backslop-task/SKILL.md')));
    assert.equal(read(root, '.claude/skills/backslop-task/custom.md'), 'custom quotes <!-- backslop:generated -->\n');
    assert.equal(read(root, '.cursor/rules/custom.mdc'), 'custom\n');
    assert.equal(read(root, '.agents/skills/custom/SKILL.md'), 'custom\n');
    assert.equal(read(root, 'CLAUDE.md'), 'custom Claude instructions\n');
  } finally {
    cleanup(root);
  }
});

for (const tool of ['claude', 'cursor', 'codex']) {
  test(`init: adapter ${tool} материализуется без outputs соседей`, () => {
    const root = emptyRepo();
    try {
      const r = cli(root, ['init', '--tools', tool]);
      assert.equal(r.code, 0, r.err);
      assert.equal(existsSync(path.join(root, '.claude/skills/backslop-task/SKILL.md')), tool === 'claude');
      assert.equal(existsSync(path.join(root, '.cursor/rules/backslop-task.mdc')), tool === 'cursor');
      assert.equal(existsSync(path.join(root, '.agents/skills/backslop-task/SKILL.md')), tool === 'codex');
      assert.equal(existsSync(path.join(root, 'CLAUDE.md')), tool === 'claude');
      assert.equal(cli(root, ['lint']).code, 0);
    } finally { cleanup(root); }
  });
}

test('init: неизвестные, пустые и повторные adapter ids отклоняются', () => {
  for (const tools of ['vscode', '', 'claude,claude']) {
    const root = emptyRepo();
    try {
      const r = cli(root, ['init', '--tools', tools]);
      assert.equal(r.code, 1);
      assert.match(r.err, /claude,cursor,codex/);
    } finally { cleanup(root); }
  }
});

test('init: legacy config получает lang=ru и tools=[]; mutable flags сохраняются', () => {
  const root = emptyRepo();
  try {
    put(root, 'backslop.json', '{"prefix":"BS","docs":"docs","cli":"node backslop.js","gates":[]}\n');
    let r = cli(root, ['init']);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(JSON.parse(read(root, 'backslop.json')).tools, []);
    assert.equal(JSON.parse(read(root, 'backslop.json')).lang, 'ru');
    r = cli(root, ['init', '--tools', 'cursor', '--lang', 'en']);
    assert.ok(existsSync(new URL('../templates/en/', import.meta.url)), 'templates/en/ обязателен в репозитории инструмента');
    assert.equal(r.code, 0, r.err);
    assert.equal(JSON.parse(read(root, 'backslop.json')).lang, 'en');
    assert.deepEqual(JSON.parse(read(root, 'backslop.json')).tools, ['cursor']);
  } finally {
    cleanup(root);
  }
});

test('init: legacy Claude skills сохраняют adapter и материализуют tools', () => {
  const root = emptyRepo();
  try {
    put(root, 'backslop.json', '{"prefix":"BS","docs":"docs","cli":"node backslop.js","gates":[]}\n');
    put(root, '.claude/skills/backslop-task/SKILL.md', '# legacy skill\n');
    const r = cli(root, ['init']);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(JSON.parse(read(root, 'backslop.json')).tools, ['claude']);
    assert.match(read(root, '.claude/skills/backslop-task/SKILL.md'), /<!-- backslop:generated -->/);
    assert.equal(read(root, 'CLAUDE.md'), '@AGENTS.md\n');
  } finally {
    cleanup(root);
  }
});

test('init --lang en: CLI и generated tree английские, mixed metadata читаются', () => {
  const root = emptyRepo();
  const cyrillic = /[А-Яа-яЁё]/;
  try {
    let r = cli(root, ['init', '--lang', 'en', '--tools', 'cursor']);
    assert.equal(r.code, 0, r.err);
    assert.doesNotMatch(r.out + r.err, cyrillic);
    for (const rel of [
      'docs/README.md', 'docs/GLOSSARY.md', 'docs/backlog/README.md', 'AGENTS.md',
      '.cursor/rules/backslop-task.mdc', '.cursor/rules/backslop-batch.mdc',
    ]) {
      assert.doesNotMatch(read(root, rel), cyrillic, rel);
    }
    r = cli(root, ['new', 'english', '--queue', '--title', 'English task']);
    assert.equal(r.code, 0, r.err);
    assert.match(read(root, 'docs/backlog/queue/BS-1-english.md'), /- \*\*Order:\*\* 10/);
    r = cli(root, ['mv', '1', 'active']);
    assert.equal(r.code, 0, r.err);
    r = cli(root, ['mv', '1', 'deferred']);
    assert.equal(r.code, 0, r.err);
    r = cli(root, ['mv', '1', 'queue']);
    assert.equal(r.code, 0, r.err);
    r = cli(root, ['adr', 'english-decision']);
    assert.equal(r.code, 0, r.err);
    put(root, 'docs/README.md', read(root, 'docs/README.md').replace(
      '| [adr/adr-001-process.md](adr/adr-001-process.md) | Tasks and decisions are managed with backslop | Accepted |',
      '| [adr/adr-001-process.md](adr/adr-001-process.md) | Tasks and decisions are managed with backslop | Accepted |\n| [adr/adr-002-english-decision.md](adr/adr-002-english-decision.md) | English decision | Accepted |',
    ));
    put(root, 'docs/backlog/triage/BS-2-russian.md', '# BS-2 · Русская задача\n\n- **Создана:** 2026-09-03\n');
    const json = JSON.parse(cli(root, ['status', '--json']).out);
    assert.equal(json.triage[0].created, '2026-09-03');
    assert.match(cli(root, ['status']).out, /^Active/m);
    spawnSync('git', ['-C', root, 'add', '-A']);
    spawnSync('git', ['-C', root, 'commit', '-qm', 'seed']);
    r = cli(root, ['archive', '1']);
    assert.equal(r.code, 0, r.err);
    put(root, 'docs/archive/BS-1-english/result.md', '# BS-1 · Result\n\n**Closed 2026-09-03.** Done.\n');
    r = cli(root, ['lint']);
    assert.equal(r.code, 0, r.err + r.out);
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

test('init в проекте со своими ADR: ADR процесса получает следующий номер, повтор не дублирует', () => {
  const root = emptyRepo();
  try {
    put(root, 'docs/adr/adr-001-architecture.md', '# ADR-001: Архитектура\n\n**Status:** Accepted\n');
    put(root, 'docs/adr/adr-002-storage.md', '# ADR-002: Хранилище\n\n**Status:** Accepted\n');
    put(root, 'docs/README.md', '# Документация\n\n| Документ | Тема | Статус |\n|---|---|---|\n');
    let r = cli(root, ['init']);
    assert.equal(r.code, 0, r.err);
    assert.ok(!existsSync(path.join(root, 'docs/adr/adr-001-process.md')));
    assert.match(read(root, 'docs/adr/adr-003-process.md'), /^# ADR-003: Задачи и решения ведутся по backslop\n/);
    assert.match(r.out, /adr\/adr-003-process\.md/);
    r = cli(root, ['init']);
    assert.equal(r.code, 0, r.err);
    assert.ok(!existsSync(path.join(root, 'docs/adr/adr-004-process.md')));
    assert.doesNotMatch(r.out, /adr-004/);
  } finally {
    cleanup(root);
  }
});

test('init в пустом проекте: строка таблицы docs/README.md называет тот же ADR, что создан', () => {
  const root = emptyRepo();
  try {
    const r = cli(root, ['init']);
    assert.equal(r.code, 0, r.err);
    assert.match(read(root, 'docs/README.md'), /\[adr\/adr-001-process\.md\]\(adr\/adr-001-process\.md\)/);
  } finally {
    cleanup(root);
  }
});

// Охрана ownedPath (lib/adapters.js): единственное, что держит init и cleanupAdapters от записи
// и удаления файлов по ту сторону ссылки. Symlink в init.test.mjs выше — про сохранение
// CLAUDE.md при tools: [], adapter-путь через него не проходит.
test('init: adapter path через symlink — отказ, за ссылку ничего не пишется', { skip: process.platform === 'win32' }, () => {
  const root = emptyRepo();
  try {
    mkdirSync(path.join(root, 'elsewhere'));
    symlinkSync('elsewhere', path.join(root, '.claude'));
    const r = cli(root, ['init', '--tools', 'claude']);
    assert.equal(r.code, 1);
    assert.match(r.err, /adapter path содержит symlink: \.claude/);
    assert.ok(!existsSync(path.join(root, 'elsewhere', 'skills')), 'за ссылку ничего не записано');
  } finally {
    cleanup(root);
  }
});
