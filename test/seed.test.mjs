// The mechanical steps of seeding as a real process: what the command finds with evidence and
// what it refuses to decide for the agent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { FIELD, cleanup, cli, gitAll, makeProject, put, read, ru, ruRe, run } from './helpers.mjs';

test('seed --scan: candidates from package.json, Makefile and CI — each with an evidence path', () => {
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
    // Build output and environments do not go into the inventory.
    put(root, '.venv/lib/app/main.py', 'print(1)\n');
    put(root, 'dist/index.js', '// bundle\n');
    put(root, 'src/Orders/obj/Debug/Orders.csproj', '<Project />\n');
    put(root, 'bin/Release/app.dll', 'x\n');
    put(root, 'bin/cli', '#!/bin/sh\n');

    const r = cli(root, ['seed', '--scan', '--json']);
    assert.equal(r.code, 0, r.err);
    const { gates, subsystems, total } = JSON.parse(r.out);
    assert.equal(total, subsystems.length, 'total counts the subsystem candidates');
    const has = (list, command, evidence) => assert.ok(
      list.some((c) => c.command === command && c.evidence === evidence),
      `expected “${command}” with evidence “${evidence}”, found: ${list.map((c) => `${c.command} @ ${c.evidence}`).join(' | ')}`,
    );

    has(gates, 'npm run test', 'package.json → scripts.test');
    has(gates, 'npm run lint', 'package.json → scripts.lint');
    assert.ok(!gates.some((c) => c.command === 'npm run start'), 'start is not a check, not a candidate');
    has(gates, 'make check', 'Makefile:3');
    assert.ok(!gates.some((c) => c.command === 'make deploy'), 'deploy is not a check');
    // A one-line CI step and a `run: |` block — both with the number of their own line.
    has(gates, 'npm ci', '.github/workflows/ci.yml:4');
    has(gates, 'npm test', '.github/workflows/ci.yml:7');
    has(gates, 'npm run lint', '.github/workflows/ci.yml:8');
    has(gates, 'dotnet test', '.gitlab-ci.yml:3');
    has(gates, 'dotnet build src/Orders/Orders.csproj', 'src/Orders/Orders.csproj');
    has(gates, 'ruff', 'pyproject.toml:1');

    assert.ok(subsystems.some((s) => s.name === 'Orders' && s.evidence === 'src/Orders'), JSON.stringify(subsystems));
    assert.ok(subsystems.some((s) => s.evidence === 'src/Orders/Orders.csproj'), JSON.stringify(subsystems));
    assert.ok(subsystems.some((s) => s.evidence === 'bin/cli'), 'a script in bin/ is an entry point');
    for (const skipped of ['.venv', 'dist/', 'obj/', 'bin/Release']) {
      assert.ok(!JSON.stringify({ gates, subsystems }).includes(skipped), `${skipped} does not go into the inventory`);
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
    assert.match(r.err, ruRe('{rel}: the path holds ", $, `, \\ or % — no dotnet command offered, quote the path by hand', { rel: "Bob's$Lib/Lib.csproj" }));
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

test('seed --scan: the human output names the evidence of every item', () => {
  const root = makeProject();
  try {
    put(root, 'package.json', '{"name":"shop","scripts":{"test":"node --test"}}\n');
    const r = cli(root, ['seed', '--scan']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, ruRe('gate candidates {gates}, subsystem candidates {subsystems}', { gates: 1 }));
    assert.match(r.out, /npm run test — package\.json → scripts\.test/);
  } finally {
    cleanup(root);
  }
});

test('seed --queue-reference: a task per row without a section, a repeat creates no duplicates', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', [
      '# Reference', '',
      '| Section | About |', '|---|---|',
      '| [01. Layout and formats](01-layout.md) | what init lays down |',
      '| [Order intake](orders-api.md) | the HTTP contour |',
      '| [External link](https://example.com/x.md) | not a section |', '',
    ].join('\n'));
    put(root, 'docs/reference/01-layout.md', '# 01. Layout\n');

    const first = cli(root, ['seed', '--queue-reference']);
    assert.equal(first.code, 0, first.err);
    assert.match(first.out, ruRe('seed --queue-reference: tasks created {created}, skipped as already seeded {skipped}', { created: 1 }));
    const queue = readdirSync(path.join(root, 'docs/backlog/queue'));
    assert.deepEqual(queue, ['BS-1-describe-orders-api.md'], 'the ready section and the external link are skipped');
    assert.match(read(root, 'docs/backlog/queue/BS-1-describe-orders-api.md'), new RegExp(`^# BS-1 · ${ru('Reference')}: Order intake\\n`));

    // The area of the created task is known, but the remaining fields still wait for the author
    // and are red by lint.
    assert.ok(read(root, 'docs/backlog/queue/BS-1-describe-orders-api.md').includes(`- **${FIELD.area}:** ${ru('[{label}](../../reference/README.md) — section `{href}` is not written yet', { label: 'Order intake', href: 'orders-api.md' })}\n`));
    const lint = cli(root, ['lint']);
    assert.match(lint.err, /BS-1-describe-orders-api/, 'the shared gate sees the unfilled fields of the seeded task');
    // One of the errors is the link of the table itself to a section not written yet: it is
    // the reason for the task, and whoever writes the section clears it.
    assert.match(lint.err, new RegExp(`docs/reference/README\\.md: ${ruRe('broken link {href} (line {line})', { href: 'orders-api.md' }).source}`));
    assert.match(lint.err, ruRe('lint: errors {errors}{tail}', { errors: 5 }));

    const again = cli(root, ['seed', '--queue-reference']);
    assert.equal(again.code, 0, again.err);
    assert.match(again.out, ruRe('seed --queue-reference: tasks created {created}, skipped as already seeded {skipped}', { created: 0, skipped: 1 }));
    assert.deepEqual(readdirSync(path.join(root, 'docs/backlog/queue')), queue, 'a repeated seed creates no second file');
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
    assert.doesNotMatch(scope, /\p{Script=Cyrillic}/u);
  } finally {
    cleanup(root);
  }
});

test('seed --queue-reference prints a \u2714 line per task and the number another branch holds', () => {
  const root = makeEnProject();
  try {
    gitAll(root, 'init');
    run(root, ['checkout', '-q', '-b', 'other']);
    assert.equal(cli(root, ['new', 'held']).code, 0);
    gitAll(root, 'BS-1: held');
    run(root, ['checkout', '-q', 'main']);
    put(root, 'docs/reference/README.md', '# Reference\n\n| Section | About |\n|---|---|\n| [API](api.md) | a |\n| [Worker](worker.md) | w |\n');
    const r = cli(root, ['seed', '--queue-reference']);
    assert.equal(r.code, 0, r.err);
    assert.equal(r.out, [
      '\u2714 BS-2: docs/backlog/queue/BS-2-describe-api.md',
      '  BS-1 is taken: branch other',
      '\u2714 BS-3: docs/backlog/queue/BS-3-describe-worker.md',
      '\u2714 seed --queue-reference: tasks created 2, skipped as already seeded 0',
      '',
    ].join('\n'));
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
    put(root, 'docs/archive/LOG.md', `# Log\n\n- <a id="bs-1"></a>\`BS-1-describe-x\` · 2026-09-01 · completed · — · ${ru('Reference')}: X\n`);
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
    assert.match(r.out, ruRe('seed --queue-reference: tasks created {created}, skipped as already seeded {skipped}', { created: 0, skipped: 0 }));
    assert.equal(r.err, '', 'no row is taken for an unwritten section');
    assert.deepEqual(readdirSync(path.join(root, 'docs/backlog/queue')).filter((n) => n !== '.gitkeep'), []);
  } finally {
    cleanup(root);
  }
});

test('seed: without reference/README.md and without a mode — a refusal, not quiet work', () => {
  const root = makeProject();
  try {
    const none = cli(root, ['seed']);
    assert.equal(none.code, 1);
    assert.match(none.err, ruRe('exactly one mode is required: {cli} seed --scan [--json] | --queue-reference'));
    assert.equal(cli(root, ['seed', '--scan', '--queue-reference']).code, 1, 'two modes at once is a refusal too');
    const json = cli(root, ['seed', '--queue-reference', '--json']);
    assert.equal(json.code, 1, '--json belongs to --scan only');
    assert.match(json.err, ruRe('--json belongs to --scan only: --queue-reference creates files rather than printing a list'));

    const missing = cli(root, ['seed', '--queue-reference']);
    assert.equal(missing.code, 1);
    assert.match(missing.err, /docs\/reference\/README\.md/);
    assert.ok(!existsSync(path.join(root, 'docs/backlog/queue/BS-1-describe-x.md')));
  } finally {
    cleanup(root);
  }
});
