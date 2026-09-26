// Находки ревью перед публикацией: CRLF и BOM, корневые ссылки и сноски, атомарность mv,
// дубль номера, длинный status --json через пайп, справка и версия.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BIN, cleanup, cli, gitAll, makeProject, put, read } from './helpers.mjs';

test('CRLF и BOM: заголовок читается, lint зелёный, mv сохраняет переводы строк', () => {
  const root = makeProject();
  try {
    put(root, 'docs/backlog/queue/BS-1-crlf.md', '﻿# BS-1 · Виндовый файл\r\n\r\n- **Порядок:** 10\r\n- **Область:** [x](../../README.md)\r\n\r\n## Контекст\r\n\r\nтекст\r\n');
    put(root, 'docs/README.md', '# Документация\r\n\r\n| Документ | Тема | Статус |\r\n|---|---|---|\r\n');
    gitAll(root);
    let r = cli(root, ['status', '--json']);
    assert.equal(JSON.parse(r.out).queue[0].title, 'Виндовый файл');
    r = cli(root, ['lint']);
    assert.equal(r.code, 0, r.err);
    assert.equal(r.err, '', 'зелёный lint молчит и в stderr');
    r = cli(root, ['mv', '1', 'deferred']);
    assert.equal(r.code, 0, r.err);
    const moved = read(root, 'docs/backlog/deferred/BS-1-crlf.md');
    assert.ok(moved.startsWith('\uFEFF') && !moved.slice(1).includes('\uFEFF'), 'a rewrite keeps the one BOM');
    assert.ok(!/[^\r]\n/.test(moved), 'все переводы строк остались CRLF');
    assert.match(moved, /\r\n## Отложено\r\n\r\n- \*\*Отложена:\*\*/);
    assert.doesNotMatch(moved, /Порядок/);
  } finally {
    cleanup(root);
  }
});

test('lint: корневая ссылка резолвится от корня проекта, сноска — не ссылка; archive корневую не трогает', () => {
  const root = makeProject();
  try {
    put(root, 'docs/note.md', 'См. [индекс](/docs/README.md) и сноску[^1].\n\n[^1]: Пояснение сноски.\n');
    put(root, 'docs/backlog/queue/BS-1-a.md', '# BS-1 · А\n\n- **Порядок:** 10\n- **Область:** [x](../../README.md)\n\n[корень](/docs/README.md)\n');
    gitAll(root);
    let r = cli(root, ['lint']);
    assert.equal(r.code, 0, r.err);
    r = cli(root, ['archive', '1']);
    assert.equal(r.code, 0, r.err);
    assert.match(read(root, 'docs/archive/BS-1-a/task.md'), /\(\/docs\/README\.md\)/);
    put(root, 'docs/note2.md', '[нет](/docs/nope.md)\n');
    r = cli(root, ['lint']);
    assert.match(r.err, /note2\.md: битая ссылка \/docs\/nope\.md/);
  } finally {
    cleanup(root);
  }
});

test('mv --after на чужую задачу отказывает до переноса; дубль номера — отказ с обоими путями', () => {
  const root = makeProject();
  try {
    put(root, 'docs/backlog/queue/BS-1-a.md', '# BS-1 · А\n\n- **Порядок:** 10\n');
    put(root, 'docs/backlog/triage/BS-2-b.md', '# BS-2 · Б\n');
    gitAll(root);
    let r = cli(root, ['mv', '2', 'queue', '--after', '7']);
    assert.equal(r.code, 1);
    assert.ok(existsSync(path.join(root, 'docs/backlog/triage/BS-2-b.md')), 'файл остался на месте');
    assert.ok(!existsSync(path.join(root, 'docs/backlog/queue/BS-2-b.md')));
    assert.doesNotMatch(read(root, 'docs/backlog/triage/BS-2-b.md'), /Порядок/);

    put(root, 'docs/backlog/triage/BS-1-dup.md', '# BS-1 · Дубль\n');
    r = cli(root, ['mv', '1', 'active']);
    assert.equal(r.code, 1);
    assert.match(r.err, /занят дважды/);
    assert.match(r.err, /queue\/BS-1-a\.md/);
    assert.match(r.err, /triage\/BS-1-dup\.md/);
    assert.ok(existsSync(path.join(root, 'docs/backlog/queue/BS-1-a.md')));
    r = cli(root, ['new', 'f', '--parent', '1']);
    assert.equal(r.code, 1);
    assert.match(r.err, /занят дважды/);
  } finally {
    cleanup(root);
  }
});

// Свой лимит: прямой `node --test <файл>` не получает --test-timeout из npm test, а регрессия
// «exitCode вместо process.exit» (bin/backslop.js) вешала бы тест, а не красила.
test('status --json доезжает целиком через пайп, который читают с задержкой', { timeout: 20000 }, async () => {
  const root = makeProject({ git: false });
  try {
    const title = 'Длинный заголовок, чтобы вывод перерос буфер пайпа '.repeat(4);
    for (let i = 1; i <= 400; i += 1) {
      put(root, `docs/backlog/queue/BS-${i}-t.md`, `# BS-${i} · ${title}\n\n- **Порядок:** ${i * 10}\n`);
    }
    const child = spawn(process.execPath, [BIN, 'status', '--json'], { cwd: root });
    await new Promise((resolve) => { setTimeout(resolve, 400); });
    const chunks = [];
    for await (const chunk of child.stdout) chunks.push(chunk);
    const out = Buffer.concat(chunks).toString('utf8');
    const code = await new Promise((resolve) => { child.on('close', resolve); });
    assert.equal(code, 0);
    assert.ok(out.length > 65536, `вывод ${out.length} байт — не перерос буфер, проба холостая`);
    assert.equal(JSON.parse(out).queue.length, 400);
  } finally {
    cleanup(root);
  }
});

test('<command> --help and -h print the help outside a project too', () => {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-noproj-')));
  try {
    for (const args of [['new', '--help'], ['lint', '--help'], ['status', '-h'], ['init', '-h'], ['mv', '1', 'queue', '--help']]) {
      const r = cli(dir, args);
      assert.equal(r.code, 0, `${args.join(' ')}: ${r.err}`);
      assert.match(r.out, /Commands:/, args.join(' '));
      assert.match(r.out, /Команды:/, args.join(' '));
    }
    assert.ok(!existsSync(path.join(dir, 'backslop.json')), 'init -h initialised the directory');
  } finally {
    cleanup(dir);
  }
});

test('help, version, --help у команды, неизвестная команда', () => {
  const root = makeProject({ git: false });
  try {
    let r = cli(root, ['help']);
    assert.equal(r.code, 0);
    assert.match(r.out, /четырнадцать гейтов/);
    assert.match(r.out, /mv <N…> <triage\|queue\|active\|deferred\|minor>/);
    assert.match(r.out, /в minor — только с уликой: раздел «Улика» или --evidence/);
    assert.match(r.out, /archive <N\.k> --into <M>/);
    assert.match(r.out, /--minor --evidence "…" \[--cost <уровень>\] \[--hypothesis\]/);
    assert.match(r.out, /--evidence обязателен с --minor/);
    r = cli(root, ['version']);
    assert.match(r.out, /^backslop \d+\.\d+\.\d+\n$/);
    r = cli(root, ['-v']);
    assert.equal(r.code, 0);
    assert.match(r.out, /^backslop \d+\.\d+\.\d+\n$/);
    r = cli(root, ['help']);
    assert.match(r.out, /\n {2}version \| --version \| -v {28}версия backslop\n {2}help \| --help \| -h \| <команда> --help {15}эта справка\n/);
    assert.match(r.out, /\n {2}show <N> {44}напечатать тело свёрнутой задачи \(stdout\) из ревизии/);
    r = cli(root, ['new', '--help']);
    assert.equal(r.code, 0);
    assert.match(r.out, /Команды:/);
    r = cli(root, ['frobnicate']);
    assert.equal(r.code, 1);
    assert.match(r.err, /неизвестная команда/);

    // Строка mv в справке и usage самой команды учат одному: разойдясь, они называют разные
    // флаги позиции, а справка — первое, куда смотрит человек. Проверяются обе половины.
    const flags = /mv <N…> <triage\|queue\|active\|deferred\|minor> \[--top \| --after M \| --restore\]/;
    assert.match(cli(root, ['help']).out, flags);
    put(root, 'backslop.json', read(root, 'backslop.json').replace('"lang": "ru"', '"lang": "en"'));
    r = cli(root, ['help']);
    assert.equal(r.code, 0);
    assert.match(r.out, /change status with git mv/);
    assert.match(r.out, flags);
  } finally {
    cleanup(root);
  }
});
