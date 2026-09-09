// init и сквозной цикл: раскладка → lint → new → mv → archive → lint; повтор init ничего не ломает.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { cleanup, cli, put, read, toolCli, toolCopy } from './helpers.mjs';
import { isOwnedAdapterFile } from '../lib/adapter-ownership.js';
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
    put(root, 'doc/backlog/queue/DFL-1-x.md', read(root, 'doc/backlog/queue/DFL-1-x.md').replace(/\*\*Область:\*\* .*/, '**Область:** [x](../../reference/README.md)'));
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

// Owned-путь adapter'а выводится из состава templates/skills/**, legacy-набор зашит в
// lib/adapter-ownership.js. Разойтись они могут только сменой состава шаблонов, поэтому
// проба меняет его в копии инструмента (toolCopy), а не в дереве репозитория.

test('init --tools none: файл без маркера на пути текущего шаблона остаётся и назван предупреждением', () => {
  const tool = toolCopy((dir) => put(dir, 'templates/skills/backslop-task/references/extra.md', '# extra\n'));
  const root = emptyRepo();
  try {
    assert.equal(toolCli(tool, ['init', '--tools', 'none'], { cwd: root }).code, 0);
    put(root, '.claude/skills/backslop-task/references/extra.md', 'чужой файл\n');
    put(root, '.claude/skills/backslop-task/mine.md', 'чужой файл\n');
    const r = toolCli(tool, ['init', '--tools', 'none'], { cwd: root });
    assert.equal(r.code, 0, r.err);
    assert.equal(read(root, '.claude/skills/backslop-task/references/extra.md'), 'чужой файл\n');
    assert.equal(read(root, '.claude/skills/backslop-task/mine.md'), 'чужой файл\n');
    assert.match(r.err, /\.claude\/skills\/backslop-task\/references\/extra\.md/);
  } finally {
    cleanup(tool);
    cleanup(root);
  }
});

test('init --tools none: legacy-путь без маркера, выпавший из состава шаблонов, снимается', () => {
  const legacy = '.claude/skills/backslop-batch/references/measurements.md';
  const tool = toolCopy((dir) => rmSync(path.join(dir, 'templates', 'skills', 'backslop-batch', 'references', 'measurements.md')));
  const root = emptyRepo();
  try {
    assert.equal(toolCli(tool, ['init', '--tools', 'none'], { cwd: root }).code, 0);
    put(root, legacy, 'legacy без маркера\n');
    const r = toolCli(tool, ['init', '--tools', 'none'], { cwd: root });
    assert.equal(r.code, 0, r.err);
    assert.ok(!existsSync(path.join(root, ...legacy.split('/'))), 'legacy-путь снимается по предикату владения');
  } finally {
    cleanup(tool);
    cleanup(root);
  }
});

// ADR-016: на symlink проверяются только корни выбранных adapter'ов — туда backslop пишет и
// оттуда снимает; корни невыбранных не проверяются и не чистятся. Куда ведёт ссылка — наружу
// или внутрь проекта — не различается: ссылка на выбранном корне остаётся отказом.
test('init: symlink на корне harness — отказ только для выбранного adapter\'а, до первой записи', () => {
  const root = emptyRepo();
  const shared = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-shared-')));
  try {
    symlinkSync(shared, path.join(root, '.claude'));
    put(shared, 'skills/backslop-task/SKILL.md', '<!-- backslop:generated -->\n# за ссылкой\n');
    const r = cli(root, ['init', '--tools', 'claude']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, /adapter path содержит symlink: \.claude/);
    assert.match(r.err, /сними adapter claude/, 'отказ называет лечение — снять adapter');
    assert.ok(!existsSync(path.join(root, 'backslop.json')), 'конфиг не записан');
    assert.ok(!existsSync(path.join(root, 'docs')), 'скелет docs не разложен');

    // Невыбранный adapter за ссылкой: init проходит, файл за ссылкой не снимается.
    for (const args of [['init'], ['init', '--tools', 'none'], ['init', '--tools', 'cursor']]) {
      const ok = cli(root, args);
      assert.equal(ok.code, 0, `${args.join(' ')}: ${ok.err}`);
    }
    assert.equal(read(shared, 'skills/backslop-task/SKILL.md'), '<!-- backslop:generated -->\n# за ссылкой\n', 'сквозь ссылку backslop не снимает');
    assert.ok(existsSync(path.join(root, '.cursor/rules/backslop-task.mdc')));

    // Ссылка внутрь проекта на выбранном корне — тот же отказ: цель ссылки не различается.
    unlinkSync(path.join(root, '.claude'));
    mkdirSync(path.join(root, 'inner'));
    symlinkSync(path.join(root, 'inner'), path.join(root, '.claude'));
    const inner = cli(root, ['init', '--tools', 'claude']);
    assert.equal(inner.code, 1, inner.out);
    assert.match(inner.err, /adapter path содержит symlink: \.claude/);
    assert.deepEqual(JSON.parse(read(root, 'backslop.json')).tools, ['cursor'], 'отказ до записи конфига');

    // Существующий конфиг с claude в tools: голый init состав не меняет и не лечит — лечит --tools.
    const root2 = emptyRepo();
    const shared2 = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-shared-')));
    try {
      assert.equal(cli(root2, ['init', '--tools', 'claude']).code, 0);
      rmSync(path.join(root2, '.claude'), { recursive: true, force: true });
      symlinkSync(shared2, path.join(root2, '.claude'));
      const bare = cli(root2, ['init']);
      assert.equal(bare.code, 1, bare.out);
      assert.match(bare.err, /--tools без него/);
      assert.equal(cli(root2, ['init', '--tools', 'none']).code, 0);
    } finally {
      cleanup(shared2);
      cleanup(root2);
    }
  } finally {
    cleanup(shared);
    cleanup(root);
  }
});

test('init: блок .gitignore по выбранным adapters; tools none снимает состав, self-host файла не заводит', () => {
  const root = emptyRepo();
  try {
    let r = cli(root, ['init', '--tools', 'none']);
    assert.equal(r.code, 0, r.err);
    assert.ok(!existsSync(path.join(root, '.gitignore')), 'без adapters .gitignore не заводится');

    r = cli(root, ['init', '--tools', 'claude,cursor']);
    assert.equal(r.code, 0, r.err);
    const block = read(root, '.gitignore');
    assert.match(block, /^# backslop:start$/m);
    assert.match(block, /^\.claude\/skills\/backslop-\*$/m);
    assert.match(block, /^\.cursor\/rules\/backslop-\*$/m);
    assert.doesNotMatch(block, /^\.agents\/skills\/backslop-\*$/m);
    assert.match(block, /^\/CLAUDE\.md$/m);
    assert.match(block, /^# backslop:end$/m);
    assert.equal(block.startsWith('# backslop:start'), true, 'в пустом .gitignore блок и есть весь файл');

    // Чужие строки сохраняются, блок заменяется на месте.
    put(root, '.gitignore', `node_modules/\n\n${block}`);
    r = cli(root, ['init', '--tools', 'codex']);
    assert.equal(r.code, 0, r.err);
    const next = read(root, '.gitignore');
    assert.match(next, /^node_modules\/$/m);
    assert.match(next, /^\.agents\/skills\/backslop-\*$/m);
    assert.doesNotMatch(next, /^\.claude\/skills\/backslop-\*$/m);
    assert.doesNotMatch(next, /^\/CLAUDE\.md$/m, 'stub снят вместе с adapter claude');
    assert.equal((next.match(/# backslop:start/g) ?? []).length, 1);

    r = cli(root, ['init', '--tools', 'none']);
    assert.equal(r.code, 0, r.err);
    assert.doesNotMatch(read(root, '.gitignore'), /backslop-\*/, 'снятые adapters уходят и из блока');
    assert.match(read(root, '.gitignore'), /^node_modules\/$/m);
  } finally {
    cleanup(root);
  }
});

test('init: пользовательский CLAUDE.md не попадает в .gitignore', () => {
  const root = emptyRepo();
  try {
    put(root, 'CLAUDE.md', 'Свои инструкции\n');
    const r = cli(root, ['init', '--tools', 'claude']);
    assert.equal(r.code, 0, r.err);
    assert.match(read(root, '.gitignore'), /^\.claude\/skills\/backslop-\*$/m);
    assert.doesNotMatch(read(root, '.gitignore'), /^\/CLAUDE\.md$/m);
    assert.equal(read(root, 'CLAUDE.md'), 'Свои инструкции\n');
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

// BS-36.1: маркер под корнем harness признаётся по любому пути — снятие и предикат владения
// читают одно правило; фильтр «первый сегмент backslop-*» у снятия оставлял такой файл навсегда,
// хотя mv, archive и lint его уже не видели.
test('init: файл с маркером вне backslop-* под корнем harness — owned и для предиката, и для снятия', () => {
  const root = emptyRepo();
  try {
    assert.equal(cli(root, ['init', '--tools', 'claude']).code, 0);
    const marked = '.claude/skills/other/note.md';
    const plain = '.claude/skills/other/mine.md';
    put(root, marked, '<!-- backslop:generated -->\n# чужим путём, наш маркер\n');
    put(root, plain, '# без маркера\n');
    assert.equal(isOwnedAdapterFile(marked, path.join(root, marked)), true);
    assert.equal(isOwnedAdapterFile(plain, path.join(root, plain)), false);
    const r = cli(root, ['init', '--tools', 'claude']);
    assert.equal(r.code, 0, r.err);
    assert.equal(existsSync(path.join(root, marked)), false, 'owned по маркеру — снят');
    assert.equal(read(root, plain), '# без маркера\n', 'без маркера и вне путей шаблонов — не кандидат, остаётся молча');
    assert.doesNotMatch(r.err, /other\/mine\.md/);
  } finally {
    cleanup(root);
  }
});

// BS-36.2 / ADR-015: запись читает владение тем же предикатом, что снятие, — чужой файл без
// маркера на пути owned output не переписывается и назван предупреждением; legacy-путь
// маркера не требует и переписывается, как раньше.
// Состав шаблонов сегодня совпадает с legacy-набором файл в файл, и на текущем дереве чужой
// файл на owned-пути всегда legacy — то есть owned и переписывается. Не-legacy owned-путь
// даёт копия инструмента с лишним шаблоном, как в пробах BS-36.
test('init --tools claude: чужой файл без маркера на пути owned output не переписывается и назван предупреждением', () => {
  const tool = toolCopy((dir) => put(dir, 'templates/skills/backslop-task/references/extra.md', '# extra\n'));
  const root = emptyRepo();
  try {
    assert.equal(toolCli(tool, ['init', '--tools', 'claude'], { cwd: root }).code, 0);
    const rel = '.claude/skills/backslop-task/references/extra.md';
    assert.match(read(root, rel), /<!-- backslop:generated -->/);
    put(root, rel, '# мой файл на этом пути\n');
    const r = toolCli(tool, ['init', '--tools', 'claude'], { cwd: root });
    assert.equal(r.code, 0, r.err);
    assert.equal(read(root, rel), '# мой файл на этом пути\n', 'файл без маркера — не owned, не переписан');
    assert.match(r.err, /не переписаны: \.claude\/skills\/backslop-task\/references\/extra\.md/);
    const lint = toolCli(tool, ['lint'], { cwd: root });
    assert.equal(lint.code, 1);
    assert.match(lint.err, /extra\.md: на пути adapter output claude чужой файл без маркера/);

    // Legacy-путь owned без маркера — переписывается, как раньше.
    const legacy = '.claude/skills/backslop-batch/references/measurements.md';
    put(root, legacy, 'без маркера, но legacy-путь\n');
    assert.equal(toolCli(tool, ['init', '--tools', 'claude'], { cwd: root }).code, 0);
    assert.match(read(root, legacy), /<!-- backslop:generated -->/, 'legacy-путь owned без маркера — переписан');
  } finally {
    cleanup(tool);
    cleanup(root);
  }
});

// Каталог на owned-пути: запись в него — отказ словами, как у снятия, а не стек EISDIR.
test('init --tools claude: каталог на пути owned output — отказ без стека', () => {
  const root = emptyRepo();
  try {
    mkdirSync(path.join(root, '.claude/skills/backslop-task/SKILL.md'), { recursive: true });
    const r = cli(root, ['init', '--tools', 'claude']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, /owned adapter output не является файлом: \.claude\/skills\/backslop-task\/SKILL\.md/);
    assert.doesNotMatch(r.err, /EISDIR|node:fs/);
  } finally {
    cleanup(root);
  }
});

// Файл на компоненте пути owned output — отказ словами, а не стек ENOTDIR из mkdirSync.
test('init --tools claude: файл на компоненте пути owned output — отказ без стека', () => {
  const root = emptyRepo();
  try {
    put(root, '.claude/skills/backslop-task', 'файл вместо каталога\n');
    const r = cli(root, ['init', '--tools', 'claude']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, /на пути adapter output файл вместо каталога: \.claude\/skills\/backslop-task\//);
    assert.doesNotMatch(r.err, /ENOTDIR|EISDIR|node:fs/);
  } finally {
    cleanup(root);
  }
});
