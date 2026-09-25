// Механические шаги посева настоящим процессом: что команда находит с уликой и что она
// отказывается решать за агента.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { cleanup, cli, gitAll, makeProject, put, read, run } from './helpers.mjs';

test('seed --scan: кандидаты из package.json, Makefile и CI — каждый с путём-уликой', () => {
  const root = makeProject();
  try {
    put(root, 'package.json', `${JSON.stringify({
      name: 'shop', scripts: { test: 'node --test', lint: 'eslint .', start: 'node .' },
    }, null, 2)}\n`);
    put(root, 'Makefile', 'all: check\n\ncheck:\n\tmake test\n\ndeploy:\n\t./deploy.sh\n');
    put(root, '.github/workflows/ci.yml', [
      'jobs:', '  build:', '    steps:',
      '      - run: npm ci',
      '      - name: gates', '        run: |', '          npm test', '          npm run lint', '',
    ].join('\n'));
    put(root, '.gitlab-ci.yml', 'gates:\n  script:\n    - dotnet test\n');
    put(root, 'src/Orders/Orders.csproj', '<Project />\n');
    put(root, 'pyproject.toml', '[tool.ruff]\nline-length = 120\n');
    // Выход сборки и окружения в инвентаризацию не идут.
    put(root, '.venv/lib/app/main.py', 'print(1)\n');
    put(root, 'dist/index.js', '// bundle\n');
    put(root, 'src/Orders/obj/Debug/Orders.csproj', '<Project />\n');
    put(root, 'bin/Release/app.dll', 'x\n');
    put(root, 'bin/cli', '#!/bin/sh\n');

    const r = cli(root, ['seed', '--scan', '--json']);
    assert.equal(r.code, 0, r.err);
    const { gates, subsystems } = JSON.parse(r.out);
    const has = (list, command, evidence) => assert.ok(
      list.some((c) => c.command === command && c.evidence === evidence),
      `ожидался «${command}» с уликой «${evidence}», найдено: ${list.map((c) => `${c.command} @ ${c.evidence}`).join(' | ')}`,
    );

    has(gates, 'npm run test', 'package.json → scripts.test');
    has(gates, 'npm run lint', 'package.json → scripts.lint');
    assert.ok(!gates.some((c) => c.command === 'npm run start'), 'start не проверка, в кандидаты не идёт');
    has(gates, 'make check', 'Makefile:3');
    assert.ok(!gates.some((c) => c.command === 'make deploy'), 'deploy не проверка');
    // Однострочный шаг CI и блок `run: |` — оба с номером своей строки.
    has(gates, 'npm ci', '.github/workflows/ci.yml:4');
    has(gates, 'npm test', '.github/workflows/ci.yml:7');
    has(gates, 'npm run lint', '.github/workflows/ci.yml:8');
    has(gates, 'dotnet test', '.gitlab-ci.yml:3');
    has(gates, 'dotnet build src/Orders/Orders.csproj', 'src/Orders/Orders.csproj');
    has(gates, 'ruff', 'pyproject.toml:1');

    assert.ok(subsystems.some((s) => s.name === 'Orders' && s.evidence === 'src/Orders'), JSON.stringify(subsystems));
    assert.ok(subsystems.some((s) => s.evidence === 'src/Orders/Orders.csproj'), JSON.stringify(subsystems));
    assert.ok(subsystems.some((s) => s.evidence === 'bin/cli'), 'скрипт в bin/ — точка входа');
    for (const skipped of ['.venv', 'dist/', 'obj/', 'bin/Release']) {
      assert.ok(!JSON.stringify({ gates, subsystems }).includes(skipped), `${skipped} в инвентаризацию не идёт`);
    }
  } finally {
    cleanup(root);
  }
});

function scanJson(root) {
  const r = cli(root, ['seed', '--scan', '--json']);
  assert.equal(r.code, 0, r.err);
  return JSON.parse(r.out);
}

test('seed --scan: bin/ lists scripts by extension or shebang, not build output beside them', () => {
  const root = makeProject();
  try {
    for (const name of ['app.dll', 'app.exe', 'app.pdb', 'app.deps.json', 'app.runtimeconfig.json']) put(root, `bin/${name}`, 'x\n');
    put(root, 'bin/tool', '\u007fELF\n');
    put(root, 'bin/cli', '#!/bin/sh\n');
    put(root, 'bin/cli.js', 'x\n');
    put(root, 'bin/run.dev.sh', 'x\n');
    const listed = scanJson(root).subsystems.map((s) => s.evidence).sort();
    assert.deepEqual(listed, ['bin/cli', 'bin/cli.js', 'bin/run.dev.sh']);
  } finally {
    cleanup(root);
  }
});

test('seed --scan: every YAML block scalar indicator reads the block body as commands', () => {
  const root = makeProject();
  try {
    put(root, '.github/workflows/ci.yml', [
      'jobs:', '  build:', '    steps:',
      '      - run: >-', '          npm test',
      '      - run: |+', '          npm run lint',
      '      - run: >+', '          npm run check',
      '      - run: |2', '          npm run build', '',
    ].join('\n'));
    const commands = scanJson(root).gates.map((g) => `${g.command} @ ${g.evidence}`);
    assert.deepEqual(commands, [
      'npm test @ .github/workflows/ci.yml:5',
      'npm run lint @ .github/workflows/ci.yml:7',
      'npm run check @ .github/workflows/ci.yml:9',
      'npm run build @ .github/workflows/ci.yml:11',
    ]);
  } finally {
    cleanup(root);
  }
});

test('seed --scan: linked worktrees are not walked, a submodule is', () => {
  const root = makeProject();
  try {
    put(root, 'src/Orders/Orders.csproj', '<Project />\n');
    gitAll(root, 'init');
    run(root, ['worktree', 'add', '-q', '.claude/worktrees/w1', '-b', 'w1']);
    run(root, ['worktree', 'add', '-q', 'copies/w2', '-b', 'w2']);
    put(root, 'libs/Shared/Shared.csproj', '<Project />\n');
    put(root, 'libs/.git', 'gitdir: ../.git/modules/libs\n');
    const { gates, subsystems } = scanJson(root);
    const all = JSON.stringify({ gates, subsystems });
    assert.ok(!all.includes('worktrees/w1') && !all.includes('copies/w2'), all);
    assert.ok(gates.some((g) => g.command === 'dotnet build src/Orders/Orders.csproj'), all);
    assert.ok(gates.some((g) => g.command === 'dotnet build libs/Shared/Shared.csproj'), all);
  } finally {
    cleanup(root);
  }
});

test('seed --scan: a .NET path with spaces is double-quoted, one with $ or a quote gets a warning instead', () => {
  const root = makeProject();
  try {
    put(root, 'My Service/My Service.csproj', '<Project />\n');
    put(root, "A&B/Lib.csproj", '<Project />\n');
    put(root, "Bob's$Lib/Lib.csproj", '<Project />\n');
    const r = cli(root, ['seed', '--scan', '--json']);
    assert.equal(r.code, 0, r.err);
    const commands = JSON.parse(r.out).gates.map((g) => g.command);
    assert.ok(commands.includes('dotnet build "My Service/My Service.csproj"'), commands.join(' | '));
    assert.ok(commands.includes('dotnet test "A&B/Lib.csproj"'), commands.join(' | '));
    assert.ok(!commands.some((c) => c.includes('Bob')), commands.join(' | '));
    assert.match(r.err, /Bob's\$Lib\/Lib\.csproj: в пути есть ", \$, `, \\ или % — команду dotnet не предлагаю/);
  } finally {
    cleanup(root);
  }
});

test('seed --scan: an unreadable extensionless file in bin/ is skipped, not a crash', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, () => {
  const root = makeProject();
  try {
    put(root, 'bin/locked', '#!/bin/sh\n');
    chmodSync(path.join(root, 'bin/locked'), 0);
    put(root, 'bin/cli', '#!/bin/sh\n');
    assert.deepEqual(scanJson(root).subsystems.map((s) => s.evidence), ['bin/cli']);
  } finally {
    cleanup(root);
  }
});

test('seed --scan: человеческий вывод называет улику каждого пункта', () => {
  const root = makeProject();
  try {
    put(root, 'package.json', '{"name":"shop","scripts":{"test":"node --test"}}\n');
    const r = cli(root, ['seed', '--scan']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /кандидатов в gates 1/);
    assert.match(r.out, /npm run test — package\.json → scripts\.test/);
  } finally {
    cleanup(root);
  }
});

test('seed --queue-reference: задача на строку без раздела, повтор дублей не плодит', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', [
      '# Справочник', '',
      '| Раздел | О чём |', '|---|---|',
      '| [01. Раскладка и форматы](01-layout.md) | что кладёт init |',
      '| [Приём заказов](orders-api.md) | HTTP-контур |',
      '| [Внешняя ссылка](https://example.com/x.md) | не раздел |', '',
    ].join('\n'));
    put(root, 'docs/reference/01-layout.md', '# 01. Раскладка\n');

    const first = cli(root, ['seed', '--queue-reference']);
    assert.equal(first.code, 0, first.err);
    assert.match(first.out, /заведено задач 1/);
    const queue = readdirSync(path.join(root, 'docs/backlog/queue'));
    assert.deepEqual(queue, ['BS-1-describe-orders-api.md'], 'готовый раздел и внешняя ссылка пропущены');
    assert.match(read(root, 'docs/backlog/queue/BS-1-describe-orders-api.md'), /^# BS-1 · Справочник: Приём заказов\n/);

    // Область заводимой задачи известна, но оставшиеся поля пока ждут автора
    // и красны по lint.
    assert.match(read(root, 'docs/backlog/queue/BS-1-describe-orders-api.md'), /- \*\*Область:\*\* \[Приём заказов\]\(\.\.\/\.\.\/reference\/README\.md\) — раздел `orders-api\.md` ещё не написан\n/);
    const lint = cli(root, ['lint']);
    assert.match(lint.err, /BS-1-describe-orders-api/, 'общий гейт видит незаполненные поля посеянной задачи');
    // Одна из ошибок — ссылка самой таблицы на ещё не написанный раздел: она и есть
    // причина задачи, и гасит её тот, кто раздел напишет.
    assert.match(lint.err, /docs\/reference\/README\.md: битая ссылка orders-api\.md/);
    assert.match(lint.err, /lint: ошибок 5/);

    const again = cli(root, ['seed', '--queue-reference']);
    assert.equal(again.code, 0, again.err);
    assert.match(again.out, /заведено задач 0, пропущено как уже посеянные 1/);
    assert.deepEqual(readdirSync(path.join(root, 'docs/backlog/queue')), queue, 'повторный посев второго файла не создаёт');
  } finally {
    cleanup(root);
  }
});

function makeEnProject() {
  const root = makeProject();
  const cfg = JSON.parse(read(root, 'backslop.json'));
  put(root, 'backslop.json', `${JSON.stringify({ ...cfg, lang: 'en' }, null, 2)}\n`);
  return root;
}

const queued = (root) => readdirSync(path.join(root, 'docs/backlog/queue')).filter((n) => n !== '.gitkeep').sort();

test('seed --queue-reference: an English project gets an English Scope', () => {
  const root = makeEnProject();
  try {
    put(root, 'docs/reference/README.md', '# Reference\n\n| Section | About |\n|---|---|\n| [Orders API](orders-api.md) | HTTP |\n');
    const r = cli(root, ['seed', '--queue-reference']);
    assert.equal(r.code, 0, r.err);
    const scope = read(root, 'docs/backlog/queue/BS-1-describe-orders-api.md').split('\n').find((l) => l.startsWith('- **Scope:**'));
    assert.equal(scope, '- **Scope:** [Orders API](../../reference/README.md) — section `orders-api.md` is not written yet');
    assert.doesNotMatch(scope, /[\u0400-\u04FF]/);
  } finally {
    cleanup(root);
  }
});

test('seed --queue-reference: two rows sharing a basename get two tasks, a re-run adds none', () => {
  const root = makeEnProject();
  try {
    put(root, 'docs/reference/README.md', [
      '# Reference', '', '| Section | About |', '|---|---|',
      '| [API service](api/README.md) | http |',
      '| [Worker service](worker/README.md) | jobs |', '',
    ].join('\n'));
    const first = cli(root, ['seed', '--queue-reference']);
    assert.equal(first.code, 0, first.err);
    assert.match(first.out, /tasks created 2, skipped as already seeded 0/);
    assert.match(first.err, /slug describe-readme: api\/README\.md and worker\/README\.md are different files/);
    assert.deepEqual(queued(root), ['BS-1-describe-api-readme.md', 'BS-2-describe-worker-readme.md']);
    assert.match(read(root, 'docs/backlog/queue/BS-2-describe-worker-readme.md'), /section `worker\/README\.md` is not written yet/);

    const again = cli(root, ['seed', '--queue-reference']);
    assert.equal(again.code, 0, again.err);
    assert.match(again.out, /tasks created 0, skipped as already seeded 2/);
    assert.deepEqual(queued(root), ['BS-1-describe-api-readme.md', 'BS-2-describe-worker-readme.md']);
  } finally {
    cleanup(root);
  }
});

test('seed --queue-reference: a task seeded under the basename slug still counts as seeded', () => {
  const root = makeEnProject();
  try {
    put(root, 'docs/reference/README.md', '# Reference\n\n| Section | About |\n|---|---|\n| [API service](api/README.md) | http |\n');
    assert.equal(cli(root, ['seed', '--queue-reference']).code, 0);
    assert.deepEqual(queued(root), ['BS-1-describe-readme.md']);
    put(root, 'docs/reference/README.md', `${read(root, 'docs/reference/README.md')}| [Worker service](worker/README.md) | jobs |\n`);
    const r = cli(root, ['seed', '--queue-reference']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /tasks created 1, skipped as already seeded 1/);
    assert.deepEqual(queued(root), ['BS-1-describe-readme.md', 'BS-2-describe-worker-readme.md']);
  } finally {
    cleanup(root);
  }
});

test('seed --queue-reference: a code span in the row label does not hide the seeded task', () => {
  const root = makeEnProject();
  try {
    put(root, 'docs/reference/README.md', '# Reference\n\n| Section | About |\n|---|---|\n| [The `api` service](api/README.md) | http |\n');
    assert.equal(cli(root, ['seed', '--queue-reference']).code, 0);
    const again = cli(root, ['seed', '--queue-reference']);
    assert.equal(again.code, 0, again.err);
    assert.match(again.out, /tasks created 0, skipped as already seeded 1/);
    assert.deepEqual(queued(root), ['BS-1-describe-readme.md']);
  } finally {
    cleanup(root);
  }
});

test('seed --queue-reference: a folded task with the row title or a Scope without a link span counts as seeded', () => {
  const root = makeEnProject();
  try {
    put(root, 'docs/reference/README.md', '# Reference\n\n| Section | About |\n|---|---|\n| [Orders](orders.md) | http |\n| [Billing](billing.md) | jobs |\n');
    put(root, 'docs/archive/LOG.md', '# Log\n\n- <a id="bs-1"></a>`BS-1-describe-orders` · 2026-09-01 · completed · — · Reference: Orders\n');
    put(root, 'docs/backlog/queue/BS-2-describe-billing.md', '# BS-2 · Reference: Billing\n\n- **Order:** 10\n- **Scope:** [Billing](../../reference/README.md)\n');
    const r = cli(root, ['seed', '--queue-reference']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /tasks created 0, skipped as already seeded 2/);
    assert.equal(r.err, '');
  } finally {
    cleanup(root);
  }
});

test('seed --queue-reference: a folded task for another file with the basename slug is a collision', () => {
  const root = makeEnProject();
  try {
    put(root, 'docs/reference/README.md', '# Reference\n\n| Section | About |\n|---|---|\n| [Worker service](worker/README.md) | jobs |\n');
    put(root, 'docs/archive/LOG.md', '# Log\n\n- <a id="bs-1"></a>`BS-1-describe-readme` · 2026-09-01 · completed · — · Reference: API service\n');
    const first = cli(root, ['seed', '--queue-reference']);
    assert.equal(first.code, 0, first.err);
    assert.match(first.out, /tasks created 1, skipped as already seeded 0/);
    assert.match(first.err, /slug describe-readme is taken by the task BS-1 for another file; the task for worker\/README\.md took slug describe-worker-readme/);
    assert.deepEqual(queued(root), ['BS-2-describe-worker-readme.md']);
    const again = cli(root, ['seed', '--queue-reference']);
    assert.equal(again.code, 0, again.err);
    assert.match(again.out, /tasks created 0, skipped as already seeded 1/);
    assert.deepEqual(queued(root), ['BS-2-describe-worker-readme.md']);
  } finally {
    cleanup(root);
  }
});

test('seed --queue-reference: a folded task titled in the other language counts as seeded', () => {
  const root = makeEnProject();
  try {
    put(root, 'docs/reference/README.md', '# Reference\n\n| Section | About |\n|---|---|\n| [X ](x.md) | x |\n');
    put(root, 'docs/archive/LOG.md', '# Log\n\n- <a id="bs-1"></a>`BS-1-describe-x` · 2026-09-01 · completed · — · Справочник: X\n');
    const r = cli(root, ['seed', '--queue-reference']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /tasks created 0, skipped as already seeded 1/);
  } finally {
    cleanup(root);
  }
});

test('seed --queue-reference: a row linking an existing section with ?query or a %-escape creates no task', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', [
      '# Reference', '',
      '| Section | About |', '|---|---|',
      '| [Layout](01-layout.md?plain=1) | layout |',
      '| [Lint](03%2Dlint.md#gates) | gates |',
      '| [Rooted](/docs/reference/01-layout.md) | layout |', '',
    ].join('\n'));
    put(root, 'docs/reference/01-layout.md', '# Layout\n');
    put(root, 'docs/reference/03-lint.md', '# Lint\n');
    const r = cli(root, ['seed', '--queue-reference']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /заведено задач 0, пропущено как уже посеянные 0/);
    assert.equal(r.err, '', 'no row is taken for an unwritten section');
    assert.deepEqual(readdirSync(path.join(root, 'docs/backlog/queue')).filter((n) => n !== '.gitkeep'), []);
  } finally {
    cleanup(root);
  }
});

test('seed: без reference/README.md и без режима — отказ, а не тихая работа', () => {
  const root = makeProject();
  try {
    const none = cli(root, ['seed']);
    assert.equal(none.code, 1);
    assert.match(none.err, /ровно один режим/);
    assert.equal(cli(root, ['seed', '--scan', '--queue-reference']).code, 1, 'два режима сразу — тоже отказ');
    const json = cli(root, ['seed', '--queue-reference', '--json']);
    assert.equal(json.code, 1, '--json есть только у --scan');
    assert.match(json.err, /--json есть только у --scan/);

    const missing = cli(root, ['seed', '--queue-reference']);
    assert.equal(missing.code, 1);
    assert.match(missing.err, /docs\/reference\/README\.md/);
    assert.ok(!existsSync(path.join(root, 'docs/backlog/queue/BS-1-describe-x.md')));
  } finally {
    cleanup(root);
  }
});
