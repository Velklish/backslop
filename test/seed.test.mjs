// Механические шаги посева настоящим процессом: что команда находит с уликой и что она
// отказывается решать за агента.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { cleanup, cli, makeProject, put, read } from './helpers.mjs';

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

    // Область заводимой задачи известна — это раздел строки; заглушка оставила бы гейт 4 красным.
    assert.match(read(root, 'docs/backlog/queue/BS-1-describe-orders-api.md'), /- \*\*Область:\*\* \[Приём заказов\]\(\.\.\/\.\.\/reference\/README\.md\) — раздел `orders-api\.md` ещё не написан\n/);
    const lint = cli(root, ['lint']);
    assert.doesNotMatch(lint.err, /BS-1-describe-orders-api/, 'посеянная задача гейтов не красит');
    // Единственная ошибка — ссылка самой таблицы на ещё не написанный раздел: она и есть
    // причина задачи, и гасит её тот, кто раздел напишет.
    assert.match(lint.err, /docs\/reference\/README\.md: битая ссылка orders-api\.md/);
    assert.match(lint.err, /lint: ошибок 1/);

    const again = cli(root, ['seed', '--queue-reference']);
    assert.equal(again.code, 0, again.err);
    assert.match(again.out, /заведено задач 0, пропущено как уже посеянные 1/);
    assert.deepEqual(readdirSync(path.join(root, 'docs/backlog/queue')), queue, 'повторный посев второго файла не создаёт');
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
