import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderProjectTemplate } from '../lib/templates.js';
import { cleanup, gitAll, put, read, run, cli, toolCli, toolCopy } from './helpers.mjs';

const OWNED = ['docs/backlog/README.md', 'docs/archive/README.md', 'docs/ROLES.md', 'docs/archive/LOG.md'];
const OLD_CLI = 'npx github:Velklish/backslop#v0.20.0';
const NEW_CLI = 'npx --no-install backslop';
const ENTRIES = `- <a id="bs-1"></a>\`BS-1-old\` · 2026-01-01 · completed · — · ${OLD_CLI}\r\n\r\n`;

for (const lang of ['en', 'ru']) {
  for (const edited of [false, true]) {
    test(`migrate: same-version cli change ${lang}, ${edited ? 'edited files stay' : 'owned files redraw'}`, () => {
      const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-cli-')));
      const tool = toolCopy((dir) => {
        const pkg = JSON.parse(read(dir, 'package.json'));
        put(dir, 'package.json', JSON.stringify({ ...pkg, version: '0.20.0' }));
      });
      try {
        run(root, ['init', '-q', '-b', 'main']);
        run(root, ['config', 'user.email', 'test@example.com']);
        run(root, ['config', 'user.name', 'test']);
        const init = toolCli(tool, ['init', '--lang', lang, '--tools', 'none', '--cli', OLD_CLI], { cwd: root });
        assert.equal(init.code, 0, init.err);
        for (const rel of OWNED) {
          let text = read(root, rel).trimEnd() + (edited ? '\n\nAn own rule.' : '');
          if (rel.endsWith('/LOG.md')) text = text.replaceAll('\n', '\r\n') + '\r\n\r\n' + ENTRIES;
          else text += '\n';
          put(root, rel, text);
        }
        gitAll(root, 'old render');
        const before = OWNED.map((rel) => read(root, rel));
        const cfg = JSON.parse(read(root, 'backslop.json'));
        put(root, 'backslop.json', JSON.stringify({ ...cfg, cli: NEW_CLI }, null, 2) + '\n');
        const dry = toolCli(tool, ['migrate', '--dry-run'], { cwd: root });
        assert.equal(dry.code, 0, dry.err);
        assert.deepEqual(OWNED.map((rel) => read(root, rel)), before, 'dry-run writes nothing');
        const migrated = toolCli(tool, ['migrate'], { cwd: root });
        assert.equal(migrated.code, 0, migrated.err);
        for (const [i, rel] of OWNED.entries()) {
          if (edited) assert.equal(read(root, rel), before[i], `${rel} keeps its own rule`);
          else {
            const vars = { cli: NEW_CLI, prefix: 'BS', docs: 'docs', project: path.basename(root) };
            const render = renderProjectTemplate({ lang }, rel, vars);
            const expected = rel.endsWith('/LOG.md')
              ? render.trimEnd().replaceAll('\n', '\r\n') + '\r\n\r\n' + ENTRIES : render;
            assert.equal(read(root, rel), expected, `${rel} follows the configured cli`);
          }
        }
        assert.equal(JSON.parse(read(root, 'backslop.json')).version, '0.20.0');
        const after = OWNED.map((rel) => read(root, rel));
        assert.equal(toolCli(tool, ['migrate'], { cwd: root }).code, 0);
        assert.deepEqual(OWNED.map((rel) => read(root, rel)), after, 'repeat is idempotent');
      } finally {
        cleanup(root);
        cleanup(tool);
      }
    });
  }
}

for (const command of ['backslop', NEW_CLI]) {
  for (const edit of ['inline approval prose', 'blank former cli']) {
    test(`migrate: committed ${edit} stays with cli ${command}`, () => {
      const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-approval-')));
      try {
        run(root, ['init', '-q', '-b', 'main']);
        run(root, ['config', 'user.email', 'test@example.com']);
        run(root, ['config', 'user.name', 'test']);
        const init = cli(root, ['init', '--lang', 'en', '--tools', 'none', '--cli', 'backslop']);
        assert.equal(init.code, 0, init.err);
        const rel = 'docs/ROLES.md';
        const original = read(root, rel);
        const replacement = edit === 'inline approval prose'
          ? '`backslop upgrade` only after owner approval, or `npx --no-install backslop upgrade`' : '`   upgrade`';
        const edited = original.replace('`backslop upgrade`', replacement);
        assert.notEqual(edited, original);
        put(root, rel, edited);
        gitAll(root, 'manual approval rule');
        const cfg = JSON.parse(read(root, 'backslop.json'));
        put(root, 'backslop.json', JSON.stringify({ ...cfg, cli: command }, null, 2) + '\n');
        const before = readFileSync(path.join(root, rel));
        const snapshot = OWNED.map((file) => readFileSync(path.join(root, file)));
        const dry = cli(root, ['migrate', '--dry-run']);
        assert.equal(dry.code, 0, dry.err);
        assert.deepEqual(OWNED.map((file) => readFileSync(path.join(root, file))), snapshot);
        const migrated = cli(root, ['migrate']);
        assert.equal(migrated.code, 0, migrated.err);
        assert.deepEqual(readFileSync(path.join(root, rel)), before, 'committed manual edit keeps every byte');
      } finally {
        cleanup(root);
      }
    });
  }
}
