// init и сквозной цикл: раскладка → lint → new → mv → archive → lint; повтор init ничего не ломает.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { cleanup, cli, put, read, toolCli, toolCopy } from './helpers.mjs';
import { isOwnedAdapterFile } from '../lib/adapter-ownership.js';
import { TOOL_VERSION } from '../lib/version.js';
import { srcFiles } from '../lib/mdwalk.js';

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
  'docs/backlog/triage/.gitkeep', 'docs/backlog/queue/.gitkeep', 'docs/backlog/active/.gitkeep', 'docs/backlog/deferred/.gitkeep', 'docs/backlog/minor/.gitkeep',
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
    put(root, 'docs/archive/BS-1-first-task/result.md', '# BS-1 · Результат\n\n**Закрыта 2026-09-03.** Выполнена.\n');
    r = cli(root, ['lint']);
    assert.equal(r.code, 0, r.err);

    // Повтор: docs не тронуты, конфиг тот же, блок заменён на тот же текст.
    const agentsBefore = read(root, 'AGENTS.md');
    put(root, 'docs/GLOSSARY.md', '# Мой глоссарий\n');
    put(root, 'docs/backlog/README.md', '# Мои правила ведения\n');
    put(root, 'AGENTS.md', `# Шапка проекта\n\n${agentsBefore.replace('Трекер задач', 'ИСПОРЧЕНО')}`);
    r = cli(root, ['init']);
    assert.equal(r.code, 0, r.err);
    assert.equal(read(root, 'docs/GLOSSARY.md'), '# Мой глоссарий\n', 'docs не перезаписываются');
    assert.equal(read(root, 'docs/backlog/README.md'), '# Мои правила ведения\n', 'правила ведения перерисовывает migrate, а не init');
    const agentsAfter = read(root, 'AGENTS.md');
    assert.equal(agentsAfter, `# Шапка проекта\n\n${agentsBefore}`, 'блок заменён между маркерами, шапка сохранена');
    assert.equal((agentsAfter.match(/<!-- backslop:start -->/g) ?? []).length, 1);
    assert.equal((agentsAfter.match(/<!-- backslop:end -->/g) ?? []).length, 1);
    assert.match(r.out, /оставлено как есть/);
  } finally {
    cleanup(root);
  }
});

// Первый init loadConfig не зовёт, и метку из `--cli` или `--dir` ловит его своя проверка — до
// первой записи, каталог остаётся пустым. Проверка общая: закрыт класс полей, а не одно.
test('init: --cli с меткой блока — отказ до первой записи', () => {
  for (const [flag, value, why] of [
    ['--cli', 'node bin/backslop.js <!-- backslop:end -->', /cli — значение без меток backslop/],
    ['--dir', 'docs <!-- backslop:end -->', /docs — значение без меток backslop/],
    ['--dir', 'docs`', /docs — значение без обратной кавычки/],
  ]) {
    const root = emptyRepo();
    try {
      const r = cli(root, ['init', flag, value]);
      assert.equal(r.code, 1, `${flag} «${value}»: ожидался отказ`);
      assert.match(r.err, why);
      assert.equal(existsSync(path.join(root, 'backslop.json')), false, 'конфиг не записан');
      assert.equal(existsSync(path.join(root, 'AGENTS.md')), false, 'блок не записан');
    } finally {
      cleanup(root);
    }
  }
});

test('init refuses --cli and --dir values that later commands would refuse, before any write', () => {
  for (const args of [['--cli', ''], ['--cli', '  '], ['--dir', '../x'], ['--dir', 'a\\..\\b'], ['--dir', 'docs/../x'], ['--dir', 'C:\\x'], ['--dir', 'C:/x'], ['--dir', '\\\\server\\x']]) {
    const root = emptyRepo();
    try {
      const r = cli(root, ['init', '--lang', 'en', '--tools', 'none', ...args]);
      assert.equal(r.code, 1, `${args.join(' ')}: ${r.out}`);
      assert.match(r.err, /^✖ .*(cli must be a non-empty command string|expected a relative path inside the project)/, args.join(' '));
      assert.doesNotMatch(r.err, /\n\s+at /, `${args.join(' ')}: a stack`);
      assert.equal(existsSync(path.join(root, 'backslop.json')), false, `${args.join(' ')}: the config was written`);
      assert.equal(existsSync(path.join(root, 'AGENTS.md')), false, `${args.join(' ')}: the block was written`);
    } finally {
      cleanup(root);
    }
  }
});

test('init --dir with ".." inside a name passes init and every later command', () => {
  for (const dir of ['my..docs', 'docs..v2']) {
    const root = emptyRepo();
    try {
      let r = cli(root, ['init', '--dir', dir, '--tools', 'none', '--lang', 'en']);
      assert.equal(r.code, 0, r.err);
      assert.equal(JSON.parse(read(root, 'backslop.json')).docs, dir);
      r = cli(root, ['lint']);
      assert.equal(r.code, 0, `${dir}: ${r.err}`);
      r = cli(root, ['init']);
      assert.equal(r.code, 0, `${dir}: ${r.err}`);
    } finally {
      cleanup(root);
    }
  }
});

test('init: agents.stepOverrides заменяет шаг в RU и EN блоке и сохраняется при повторе', () => {
  for (const [lang, override, escaped, oldStep] of [
    ['ru', 'Проверяй гейты командой `npm run probe` и сохраняй снимок дерева.', 'Проверяй гейты командой \\`npm run probe\\` и сохраняй снимок дерева\\.', /4\. \*\*Гейты до отчёта\./],
    ['en', 'Run gates with `npm run probe` and keep the tree snapshot.', 'Run gates with \\`npm run probe\\` and keep the tree snapshot\\.', /4\. \*\*Gates before reporting\./],
  ]) {
    const root = emptyRepo();
    try {
      let r = cli(root, ['init', '--lang', lang]);
      assert.equal(r.code, 0, r.err);
      const cfg = JSON.parse(read(root, 'backslop.json'));
      put(root, 'backslop.json', `${JSON.stringify({ ...cfg, agents: { stepOverrides: { '4': override } } }, null, 2)}\n`);

      r = cli(root, ['init']);
      assert.equal(r.code, 0, r.err);
      const generated = read(root, 'AGENTS.md');
      assert.ok(generated.includes(`4. ${escaped}`), `${lang}: значение подставлено экранированным текстом`);
      assert.doesNotMatch(generated, oldStep);

      r = cli(root, ['init']);
      assert.equal(r.code, 0, r.err);
      assert.equal(read(root, 'AGENTS.md'), generated, `${lang}: повторный init не теряет переопределение`);
    } finally {
      cleanup(root);
    }
  }
});

test('init: probe обрезается по краям — пробелы не уезжают в код-спан', () => {
  const root = emptyRepo();
  try {
    let r = cli(root, ['init']);
    assert.equal(r.code, 0, r.err);
    const cfg = JSON.parse(read(root, 'backslop.json'));
    put(root, 'backslop.json', `${JSON.stringify({ ...cfg, probe: '  npm run probe  ' }, null, 2)}\n`);
    r = cli(root, ['init']);
    assert.equal(r.code, 0, r.err);
    assert.match(read(root, 'AGENTS.md'), /потом проба — `npm run probe`\.$/m);
  } finally {
    cleanup(root);
  }
});

test('init: значение переопределения остаётся текстом — определение ссылки не открывается', () => {
  const root = emptyRepo();
  try {
    let r = cli(root, ['init']);
    assert.equal(r.code, 0, r.err);
    const cfg = JSON.parse(read(root, 'backslop.json'));
    // Цель ссылки за пределами блока: переопределение внутри блока не должно её сдвинуть.
    put(root, 'AGENTS.md', `# Проект\n\nПолитика описана в [policy].\n\n[policy]: /original\n\n${read(root, 'AGENTS.md')}`);
    put(root, 'backslop.json', `${JSON.stringify({ ...cfg, agents: { stepOverrides: { '4': '[policy]: /changed', '5': '[policy]' } } }, null, 2)}\n`);

    r = cli(root, ['init']);
    assert.equal(r.code, 0, r.err);
    const agents = read(root, 'AGENTS.md');
    const block = agents.slice(agents.indexOf('<!-- backslop:start -->'), agents.indexOf('<!-- backslop:end -->'));
    assert.match(block, /^4\. \\\[policy\\\]\\: \\\/changed$/m, 'текст шага остался видимым текстом');
    assert.match(block, /^5\. \\\[policy\\\]$/m, 'соседний шаг не стал ссылкой');
    // Маркер пункта списка блоком не является, поэтому снимается перед сверкой: без этого
    // проверка смотрела бы на строки, которые с «[» не начинаются никогда (ADR-020).
    const defs = agents.split('\n')
      .map((l) => l.replace(/^ {0,3}(?:[-*+]|\d{1,9}[.)]) +/, ''))
      .filter((l) => /^ {0,3}\[[^\]\\]*\]:/.test(l));
    assert.deepEqual(defs, ['[policy]: /original'], 'в блоке определения ссылки не появилось, внешнее не изменилось');
  } finally {
    cleanup(root);
  }
});

test('init: скобки без определения ссылки остаются законным значением переопределения', () => {
  const root = emptyRepo();
  try {
    let r = cli(root, ['init']);
    assert.equal(r.code, 0, r.err);
    const cfg = JSON.parse(read(root, 'backslop.json'));
    put(root, 'backslop.json', `${JSON.stringify({ ...cfg, agents: { stepOverrides: { '4': 'см. таблицу [гейтов] и поле gates' } } }, null, 2)}\n`);
    r = cli(root, ['init']);
    assert.equal(r.code, 0, r.err, 'скобки без признаков определения ссылки не отвергаются');
    assert.match(read(root, 'AGENTS.md'), /^4\. см\\\. таблицу \\\[гейтов\\\] и поле gates$/m);
  } finally {
    cleanup(root);
  }
});

test('init: stepOverrides отклоняет переводы строк и сохраняет границы при повторе', () => {
  const root = emptyRepo();
  try {
    let r = cli(root, ['init']);
    assert.equal(r.code, 0, r.err);
    const cfg = JSON.parse(read(root, 'backslop.json'));
    const before = read(root, 'AGENTS.md');
    for (const override of [
      'свой текст\n5. ложный шаг',
      'свой текст\n 5. ложный шаг',
      'свой текст\n5) ложный шаг',
      'свой текст\n5.\n   **ложный шаг**',
      'свой текст\n5)\n   **ложный шаг**',
      'свой текст\r\n5.\r\n   **ложный шаг**',
      'свой текст\r\n5)\r\n   **ложный шаг**',
      'свой текст\n\n   ```markdown\n5. ложный шаг',
      'свой текст\r\n\r\n   ```markdown\r\n5. ложный шаг',
      "свой текст\nГраницы worker'а: чужая граница",
      'свой текст\nWorker boundaries: чужая граница',
      'свой текст\n<!-- backslop:start -->',
      'свой текст\n<!-- backslop:end -->',
    ]) {
      put(root, 'backslop.json', `${JSON.stringify({ ...cfg, agents: { stepOverrides: { '4': override } } }, null, 2)}\n`);
      r = cli(root, ['init']);
      assert.equal(r.code, 1);
      assert.match(r.err, /однострочное значение/);
      assert.equal(read(root, 'AGENTS.md'), before, 'отказ не меняет managed-блок');
    }
    for (const override of ['свой текст <!-- backslop:end -->', 'свой текст <script>']) {
      put(root, 'backslop.json', `${JSON.stringify({ ...cfg, agents: { stepOverrides: { '4': override } } }, null, 2)}\n`);
      r = cli(root, ['init']);
      assert.equal(r.code, 1);
      assert.match(r.err, /inline-текст/);
      const after = read(root, 'AGENTS.md');
      assert.equal(after, before, 'отказ не меняет managed-блок');
      assert.match(after, /^5\. \*\*Приёмка и архив\*\*/m);
      assert.match(after, /^Границы worker'а:/m);
    }

    const override = 'свой текст — допустимая однострочная замена';
    put(root, 'backslop.json', `${JSON.stringify({ ...cfg, agents: { stepOverrides: { '4': override } } }, null, 2)}\n`);
    r = cli(root, ['init']);
    assert.equal(r.code, 0, r.err);
    const generated = read(root, 'AGENTS.md');
    assert.equal((generated.match(/<!-- backslop:start -->/g) ?? []).length, 1);
    assert.equal((generated.match(/<!-- backslop:end -->/g) ?? []).length, 1);
    r = cli(root, ['init']);
    assert.equal(r.code, 0, r.err);
    assert.equal(read(root, 'AGENTS.md'), generated, 'повторный init не дублирует границы');
  } finally {
    cleanup(root);
  }
});


test('init: шаг 4 называет команду из probe, без поля требование не остаётся молча', () => {
  for (const [lang, named, duty, missing] of [
    ['ru', 'потом проба — `npm run probe`.', /мутационной пробой/, /probe в backslop\.json не объявлен/],
    ['en', 'then run the probe — `npm run probe`.', /mutation probe/, /probe is not declared in backslop\.json/],
  ]) {
    const root = emptyRepo();
    try {
      let r = cli(root, ['init', '--lang', lang]);
      assert.equal(r.code, 0, r.err);
      assert.doesNotMatch(read(root, 'AGENTS.md'), duty, `${lang}: обязанности без инструмента в блоке нет`);
      assert.match(r.out, missing, `${lang}: init называет выпавшее требование, а не молчит`);

      const cfg = JSON.parse(read(root, 'backslop.json'));
      put(root, 'backslop.json', `${JSON.stringify({ ...cfg, probe: 'npm run probe' }, null, 2)}\n`);
      r = cli(root, ['init']);
      assert.equal(r.code, 0, r.err);
      const generated = read(root, 'AGENTS.md');
      assert.match(generated, duty, `${lang}: с объявленной пробой требование возвращается`);
      assert.ok(generated.includes(named), `${lang}: шаг 4 называет команду пробы`);
      assert.doesNotMatch(r.out, missing, `${lang}: объявленная проба пропажей не называется`);
      assert.equal(JSON.parse(read(root, 'backslop.json')).probe, 'npm run probe', 'повторный init сохраняет поле');
      r = cli(root, ['init']);
      assert.equal(r.code, 0, r.err);
      assert.equal(read(root, 'AGENTS.md'), generated, `${lang}: второй init с probe не растит файл`);
      assert.equal((read(root, 'AGENTS.md').match(/<!-- backslop:end -->/g) ?? []).length, 1, `${lang}: метка конца блока одна`);
    } finally {
      cleanup(root);
    }
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
    put(root, 'doc/backlog/queue/DFL-1-x.md', read(root, 'doc/backlog/queue/DFL-1-x.md').replace(/\*\*Область:\*\* .*/, '**Область:** [x](../../reference/README.md)').replace(/\[TODO[^\]]*\]/g, 'готово'));
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

// Windows-1251 bytes of a Cyrillic text: А–я sit at 0xC0–0xFF, ASCII passes as is.
const cp1251 = (text) => Buffer.from([...text].map((ch) => (/[А-я]/.test(ch) ? 0xC0 + ch.codePointAt(0) - 0x410 : ch.codePointAt(0))));

test('init refuses a non-UTF-8 AGENTS.md or rewritten .gitignore before any write', () => {
  const root = emptyRepo();
  try {
    const bytes = cp1251('# Проект\n\nПравила команды: не трогать prod.\n');
    writeFileSync(path.join(root, 'AGENTS.md'), bytes);
    let r = cli(root, ['init', '--lang', 'en', '--tools', 'none']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, /AGENTS\.md: not valid UTF-8 — convert it, then retry/);
    assert.ok(readFileSync(path.join(root, 'AGENTS.md')).equals(bytes), 'AGENTS.md bytes changed');
    assert.ok(!existsSync(path.join(root, 'backslop.json')), 'the refusal came after the first write');
    assert.ok(!existsSync(path.join(root, 'docs')), 'the refusal came after the first write');

    rmSync(path.join(root, 'AGENTS.md'));
    const ignore = cp1251('# кэш\nnode_modules/\n');
    writeFileSync(path.join(root, '.gitignore'), ignore);
    r = cli(root, ['init', '--lang', 'en', '--tools', 'none']);
    assert.equal(r.code, 0, r.err);
    assert.ok(readFileSync(path.join(root, '.gitignore')).equals(ignore), 'init without adapters leaves .gitignore alone');
    r = cli(root, ['init', '--tools', 'claude']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, /\.gitignore: not valid UTF-8/);
    assert.ok(readFileSync(path.join(root, '.gitignore')).equals(ignore), '.gitignore bytes changed');
    assert.ok(!existsSync(path.join(root, '.claude')), 'the refusal came after the first write');
  } finally {
    cleanup(root);
  }
});

test('a BOM-prefixed backslop.json loads: lint is green, help follows lang, init rewrites it without BOM', () => {
  const root = emptyRepo();
  try {
    let r = cli(root, ['init', '--lang', 'en', '--tools', 'none']);
    assert.equal(r.code, 0, r.err);
    put(root, 'backslop.json', `\uFEFF${read(root, 'backslop.json')}`);
    r = cli(root, ['lint']);
    assert.equal(r.code, 0, r.err);
    r = cli(root, ['help']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /^backslop — a file-based backlog/, 'help fell back to Russian');
    r = cli(root, ['init']);
    assert.equal(r.code, 0, r.err);
    assert.equal(readFileSync(path.join(root, 'backslop.json'))[0], 0x7B, 'the rewritten config starts with a BOM');
  } finally {
    cleanup(root);
  }
});

test('init: markers quoted in prose are not the block; a marker line twice is refused', () => {
  const root = emptyRepo();
  try {
    let r = cli(root, ['init', '--lang', 'en', '--tools', 'none']);
    assert.equal(r.code, 0, r.err);
    const rendered = read(root, 'AGENTS.md');
    const prose = 'The managed block sits between `<!-- backslop:start -->` and `<!-- backslop:end -->`.';
    put(root, 'AGENTS.md', `${prose}\n\n${rendered}`);
    r = cli(root, ['init']);
    assert.equal(r.code, 0, r.err);
    const agents = read(root, 'AGENTS.md');
    assert.equal(agents, `${prose}\n\n${rendered}`, 'the prose line is kept and one rendered block remains');
    assert.equal(agents.split('\n').filter((l) => l === '<!-- backslop:start -->').length, 1);
    assert.equal(agents.split('\n').filter((l) => l === '<!-- backslop:end -->').length, 1);

    const twice = `${rendered}\n${rendered}`;
    put(root, 'AGENTS.md', twice);
    const config = read(root, 'backslop.json');
    r = cli(root, ['init']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, /AGENTS\.md: a backslop block marker stands on its own line more than once — fix it manually/);
    assert.equal(read(root, 'AGENTS.md'), twice);
    assert.equal(read(root, 'backslop.json'), config);
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

test('init: a repeated --dir spelling the stored docs differently is not a conflict', () => {
  const root = emptyRepo();
  try {
    for (const dir of ['docs/', 'docs/', './docs']) {
      const r = cli(root, ['init', '--dir', dir, '--tools', 'none']);
      assert.equal(r.code, 0, `--dir ${dir}: ${r.err}`);
    }
    assert.equal(JSON.parse(read(root, 'backslop.json')).docs, 'docs');
    let r = cli(root, ['init', '--dir', 'doc']);
    assert.equal(r.code, 1, 'another directory still conflicts with the config');
    assert.match(r.err, /docs = «docs»/);
    r = cli(root, ['init', '--dir', 'docs/../docs']);
    assert.equal(r.code, 1, 'a .. segment passed because it normalises to the stored docs');
    assert.match(r.err, /^✖ --dir “docs\/\.\.\/docs”: expected a relative path inside the project/);
    put(root, 'backslop.json', read(root, 'backslop.json').replace('"docs": "docs"', '"docs": "./docs"'));
    for (const dir of ['./docs', 'docs', 'docs/']) {
      r = cli(root, ['init', '--dir', dir, '--tools', 'none']);
      assert.equal(r.code, 0, `stored ./docs, --dir ${dir}: ${r.err}`);
    }
    assert.equal(JSON.parse(read(root, 'backslop.json')).docs, './docs', 'init rewrote the stored spelling');
  } finally {
    cleanup(root);
  }
});

// Команду пробы проекта называют и managed-блок, и скилл цикла задачи — из одного источника,
// `agents-probe.md` в подстановке `{{probeRule}}`.
test('init: шаг 4 скилла называет команду пробы проекта; поля probe нет — нет и предложения', () => {
  const root = emptyRepo();
  try {
    put(root, 'backslop.json', `${JSON.stringify({ prefix: 'BS', docs: 'docs', gates: [], lang: 'ru', tools: [] }, null, 2)}\n`);
    assert.equal(cli(root, ['init', '--tools', 'claude']).code, 0);
    const bare = read(root, '.claude/skills/backslop-task/SKILL.md');
    assert.doesNotMatch(bare, /потом проба —/, 'нечего исполнять — требования в скилле нет');
    assert.ok(!bare.includes('{{'), 'пустая подстановка не оставляет {{…}} читателю');

    put(root, 'backslop.json', `${JSON.stringify({ prefix: 'BS', docs: 'docs', gates: [], lang: 'ru', tools: [], probe: 'npm run probe' }, null, 2)}\n`);
    assert.equal(cli(root, ['init', '--tools', 'claude']).code, 0);
    assert.match(read(root, '.claude/skills/backslop-task/SKILL.md'), /сначала коммит, потом проба — `npm run probe`\./);
  } finally {
    cleanup(root);
  }
});

// Фронтматтер adapter output читает гейт потребителя: значение с «: » уезжает закавыченным, а
// снятие кавычек в `splitFrontmatter` держит `.mdc` от второго слоя: его даёт cursorOutput.
function frontmatterValue(text, key) {
  const line = text.split('\n').find((l) => l.startsWith(`${key}: `));
  assert.ok(line !== undefined, `строки «${key}: » во фронтматтере нет`);
  return line.slice(key.length + 2);
}

test('init: значение description в adapter outputs закавычено, а Cursor не кавычит его дважды', () => {
  const root = emptyRepo();
  try {
    const r = cli(root, ['init', '--tools', 'claude,cursor,codex']);
    assert.equal(r.code, 0, r.err);
    const claude = frontmatterValue(read(root, '.claude/skills/backslop-task/SKILL.md'), 'description');
    assert.ok(claude.startsWith('"'), 'плоский скаляр с «: » внутри YAML-мэппингом не разбирается');
    assert.ok(JSON.parse(claude).includes(': '), 'кавычки стоят ровно из-за «: » в тексте');
    assert.equal(frontmatterValue(read(root, '.agents/skills/backslop-task/SKILL.md'), 'description'), claude);
    const cursor = frontmatterValue(read(root, '.cursor/rules/backslop-task.mdc'), 'description');
    assert.equal(JSON.parse(cursor), JSON.parse(claude), 'в .mdc уезжает текст, а не экранированные кавычки');
  } finally {
    cleanup(root);
  }
});

test('init --tools cursor: a malformed quoted description in a skill template is refused by name', () => {
  const tool = toolCopy((dir) => {
    const file = path.join(dir, 'templates', 'skills', 'backslop-task', 'SKILL.md');
    writeFileSync(file, readFileSync(file, 'utf8').replace(/^description: .*$/m, 'description: "unterminated'));
  });
  const root = emptyRepo();
  try {
    const r = toolCli(tool, ['init', '--tools', 'cursor'], { cwd: root });
    assert.equal(r.code, 1, r.out);
    assert.equal(r.err, '✖ шаблон templates/skills/backslop-task/SKILL.md: description во фронтматтере — не JSON-строка\n');
  } finally {
    cleanup(tool);
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

test('init: a rerun with --tools and --lang rewrites both fields of an existing config', () => {
  const root = emptyRepo();
  try {
    assert.equal(cli(root, ['init']).code, 0);
    const r = cli(root, ['init', '--tools', 'cursor', '--lang', 'en']);
    assert.equal(r.code, 0, r.err);
    assert.equal(JSON.parse(read(root, 'backslop.json')).lang, 'en');
    assert.deepEqual(JSON.parse(read(root, 'backslop.json')).tools, ['cursor']);
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
    put(root, 'docs/archive/BS-1-english/result.md', '# BS-1 · Result\n\n**Closed 2026-09-03.** Completed.\n');
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

test('init --tools none: an unmarked file at a shipped skill path is left byte for byte and named foreign', () => {
  const rel = '.claude/skills/backslop-batch/references/measurements.md';
  const root = emptyRepo();
  try {
    assert.equal(cli(root, ['init', '--tools', 'none']).code, 0);
    put(root, rel, 'my own file, no marker\n');
    const r = cli(root, ['init', '--tools', 'none']);
    assert.equal(r.code, 0, r.err);
    assert.equal(read(root, rel), 'my own file, no marker\n');
    assert.match(r.err, /оставлены как есть: \.claude\/skills\/backslop-batch\/references\/measurements\.md/);
  } finally {
    cleanup(root);
  }
});

// ADR-016: на symlink проверяются только корни выбранных adapter'ов, и ссылка там — отказ, куда
// бы ни вела; корни невыбранных не проверяются и не чистятся.
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

test('init: an unselected adapter behind a link below its root or with a file root is skipped', { skip: process.platform === 'win32' }, () => {
  const root = emptyRepo();
  const shared = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-shared-')));
  try {
    put(shared, 'SKILL.md', '<!-- backslop:generated -->\n# shared\n');
    mkdirSync(path.join(root, '.claude/skills'), { recursive: true });
    symlinkSync(shared, path.join(root, '.claude/skills/backslop-task'));
    put(root, '.cursor/rules', 'a file, not a directory\n');
    for (const args of [['init', '--tools', 'codex'], ['init'], ['init', '--tools', 'none']]) {
      const r = cli(root, args);
      assert.equal(r.code, 0, `${args.join(' ')}: ${r.err}`);
    }
    assert.equal(read(shared, 'SKILL.md'), '<!-- backslop:generated -->\n# shared\n', 'backslop cleaned through the link');
    assert.equal(read(root, '.cursor/rules'), 'a file, not a directory\n');
  } finally {
    cleanup(shared);
    cleanup(root);
  }
});

test('init: an unselected adapter with a directory on an owned path is skipped', () => {
  const root = emptyRepo();
  try {
    mkdirSync(path.join(root, '.claude/skills/backslop-task/SKILL.md'), { recursive: true });
    for (const args of [['init', '--tools', 'none'], ['init'], ['init', '--tools', 'cursor']]) {
      const r = cli(root, args);
      assert.equal(r.code, 0, `${args.join(' ')}: ${r.err}`);
    }
    assert.ok(statSync(path.join(root, '.claude/skills/backslop-task/SKILL.md')).isDirectory());
  } finally {
    cleanup(root);
  }
});

test('init refuses a file where it needs a directory and a directory where it needs a file, before any write', () => {
  for (const [shape, args, why] of [
    [(root) => put(root, 'docs', 'x\n'), [], /^✖ docs is a file, expected a directory/],
    [(root) => put(root, 'docs/backlog', 'x\n'), [], /^✖ docs\/backlog is a file, expected a directory/],
    [(root) => mkdirSync(path.join(root, 'AGENTS.md')), [], /^✖ AGENTS\.md is a directory, expected a file/],
    [(root) => mkdirSync(path.join(root, '.gitignore')), [], /^✖ \.gitignore is a directory, expected a file/],
    [(root) => mkdirSync(path.join(root, 'docs/README.md'), { recursive: true }), [], /^✖ docs\/README\.md is not a file/],
    [(root) => put(root, '.cursor/rules', 'x\n'), ['--tools', 'cursor'], /^✖ \.cursor\/rules is a file, expected a directory/],
    [(root) => put(root, '.cursor', 'x\n'), ['--tools', 'cursor'], /^✖ \.cursor is a file, expected a directory/],
  ]) {
    const root = emptyRepo();
    try {
      shape(root);
      const r = cli(root, ['init', '--lang', 'en', ...(args.length ? args : ['--tools', 'none'])]);
      assert.equal(r.code, 1, `${why}: ${r.out}`);
      assert.match(r.err, why);
      assert.doesNotMatch(r.err, /EEXIST|EISDIR|ENOTDIR|node:fs|\n\s+at /, `${why}: a stack`);
      assert.equal(existsSync(path.join(root, 'backslop.json')), false, `${why}: the config was written`);
    } finally {
      cleanup(root);
    }
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

// Охрана ownedPath (lib/adapters.js) — единственное, что держит init и cleanupAdapters от файлов
// по ту сторону ссылки; symlink выше — про CLAUDE.md при tools: [], adapter-путь его не проходит.
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

// Маркер под корнем harness признаётся по любому пути: снятие и предикат владения читают одно
// правило, иначе файл, который mv, archive и lint не видят, оставался бы навсегда.
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

// ADR-015: only the marker makes a file ours, so an unmarked one at a shipped path is foreign.
test('init --tools claude: чужой файл без маркера на пути owned output не переписывается и назван предупреждением', () => {
  const root = emptyRepo();
  try {
    assert.equal(cli(root, ['init', '--tools', 'claude']).code, 0);
    const rel = '.claude/skills/backslop-batch/references/measurements.md';
    assert.match(read(root, rel), /<!-- backslop:generated -->/);
    put(root, rel, '# мой файл на этом пути\n');
    const r = cli(root, ['init', '--tools', 'claude']);
    assert.equal(r.code, 0, r.err);
    assert.equal(read(root, rel), '# мой файл на этом пути\n', 'файл без маркера — не owned, не переписан');
    assert.match(r.err, /не переписаны: \.claude\/skills\/backslop-batch\/references\/measurements\.md/);
    const lint = cli(root, ['lint']);
    assert.equal(lint.code, 1);
    assert.match(lint.err, /measurements\.md: на пути adapter output claude чужой файл без маркера/);
  } finally {
    cleanup(root);
  }
});

test('init --tools cursor: a user rule without the marker at a skill path is kept and named foreign', () => {
  const rel = '.cursor/rules/backslop-task.mdc';
  const root = emptyRepo();
  try {
    assert.equal(cli(root, ['init', '--tools', 'none']).code, 0);
    put(root, rel, 'my own cursor rule, no marker\n');
    const r = cli(root, ['init', '--tools', 'cursor']);
    assert.equal(r.code, 0, r.err);
    assert.equal(read(root, rel), 'my own cursor rule, no marker\n');
    assert.equal(r.err, '⚠ на путях adapter outputs лежат файлы без маркера <!-- backslop:generated --> — не переписаны: '
      + '.cursor/rules/backslop-task.mdc; скилл backslop на этом пути не установлен — убери или переименуй файл и повтори init, либо сними adapter\n');
  } finally {
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

test('init --tools в корне самого backslop — отказ до записи; --tools none и чужой каталог — как прежде', () => {
  const tool = toolCopy();
  const root = emptyRepo();
  try {
    const r = toolCli(tool, ['init', '--tools', 'claude']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, /--tools claude: .* — репозиторий самого backslop \(templates\/ — каталог запущенного инструмента\), adapter outputs здесь не раскладываются/);
    for (const rel of ['backslop.json', 'CLAUDE.md', '.claude', 'docs', 'AGENTS.md']) {
      assert.ok(!existsSync(path.join(tool, rel)), `отказ до записи: ${rel} не создан`);
    }
    assert.equal(toolCli(tool, ['init', '--tools', 'none']).code, 0, 'self-host без adapter\'ов раскладывается');
    const again = toolCli(tool, ['init', '--tools', 'cursor,codex']);
    assert.equal(again.code, 1, again.out);
    assert.deepEqual(JSON.parse(read(tool, 'backslop.json')).tools, [], 'отказ не трогает конфиг');
    assert.equal(toolCli(tool, ['init', '--tools', 'claude'], { cwd: root }).code, 0, 'стенд в своём каталоге');
    assert.ok(existsSync(path.join(root, 'CLAUDE.md')));
  } finally {
    cleanup(tool);
    cleanup(root);
  }
});

// Lines of a text that end in a bare LF: a CRLF file keeps none.
const bareLf = (text) => text.split('\n').slice(0, -1).filter((line) => !line.endsWith('\r')).length;

test('init keeps a CRLF AGENTS.md and .gitignore CRLF, an LF pair LF, and a rerun changes no byte', () => {
  const crlf = emptyRepo();
  const lf = emptyRepo();
  const files = ['AGENTS.md', '.gitignore'];
  try {
    put(crlf, 'AGENTS.md', '# Project\r\n\r\nOwn rules\r\n');
    put(crlf, '.gitignore', 'node_modules\r\n');
    put(lf, 'AGENTS.md', '# Project\n\nOwn rules\n');
    put(lf, '.gitignore', 'node_modules\n');
    for (const root of [crlf, lf]) {
      const r = cli(root, ['init', '--lang', 'en', '--tools', 'claude']);
      assert.equal(r.code, 0, r.err);
    }
    for (const rel of files) {
      const text = read(crlf, rel);
      assert.match(text, /backslop:start/, `${rel}: no managed block`);
      assert.equal(bareLf(text), 0, `${rel}: an LF line in a CRLF file`);
      assert.ok(text.endsWith('\r\n'), `${rel}: the last line lost its CRLF`);
      assert.ok(!read(lf, rel).includes('\r'), `${rel}: a CR in an LF file`);
    }
    const before = files.map((rel) => readFileSync(path.join(crlf, rel)));
    const r = cli(crlf, ['init', '--lang', 'en', '--tools', 'claude']);
    assert.equal(r.code, 0, r.err);
    files.forEach((rel, i) => assert.ok(readFileSync(path.join(crlf, rel)).equals(before[i]), `${rel} changed on rerun`));
  } finally {
    cleanup(crlf);
    cleanup(lf);
  }
});

test('init renders LF adapter outputs from a CRLF checkout of the tool; a CRLF AGENTS.md stays put', () => {
  const tool = toolCopy((dir) => {
    for (const [, abs] of srcFiles(path.join(dir, 'templates'), '', ['.md'])) {
      writeFileSync(abs, readFileSync(abs, 'utf8').replace(/\n/g, '\r\n'));
    }
  });
  const root = emptyRepo();
  try {
    assert.ok(read(tool, 'templates/en/skills/backslop-batch/SKILL.md').includes('\r\n'), 'the copy is not CRLF');
    put(root, 'AGENTS.md', '# Project\r\n\r\nOwn rules\r\n');
    let r = toolCli(tool, ['init', '--lang', 'en', '--tools', 'cursor'], { cwd: root });
    assert.equal(r.code, 0, r.err);
    const rules = srcFiles(path.join(root, '.cursor', 'rules'), '', ['.md', '.mdc']);
    assert.ok(rules.some(([rel]) => rel === 'backslop-batch.mdc'), 'no backslop-batch.mdc');
    for (const [rel, abs] of rules) assert.ok(!readFileSync(abs, 'utf8').includes('\r'), `${rel} carries a CR`);
    assert.equal(bareLf(read(root, 'AGENTS.md')), 0, 'AGENTS.md got an LF line');
    const before = readFileSync(path.join(root, 'AGENTS.md'));
    r = toolCli(tool, ['init', '--lang', 'en', '--tools', 'cursor'], { cwd: root });
    assert.equal(r.code, 0, r.err);
    assert.ok(readFileSync(path.join(root, 'AGENTS.md')).equals(before), 'AGENTS.md changed on rerun');
  } finally {
    cleanup(tool);
    cleanup(root);
  }
});
