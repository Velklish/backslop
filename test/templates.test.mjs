import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TEMPLATES_DIR, templateParity } from '../lib/templates.js';
import { cleanup, put } from './helpers.mjs';

test('template parity: состав и placeholders совпадают', () => {
  assert.ok(existsSync(path.join(TEMPLATES_DIR, 'en')), 'templates/en/ обязателен в репозитории инструмента');
  assert.deepEqual(templateParity(), []);
});

test('template parity: называет missing, extra и mismatch placeholders', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'backslop-templates-'));
  try {
    put(root, 'task.md', '{{id}} {{title}}\n');
    put(root, 'only-ru.md', 'ru\n');
    put(root, 'repeat.md', '{{cli}}\n');
    put(root, 'en/task.md', '{{id}}\n');
    put(root, 'en/only-en.md', 'en\n');
    put(root, 'en/repeat.md', '{{cli}} and again {{cli}}\n');
    assert.deepEqual(templateParity(root), [
      'templates/en/only-ru.md is missing',
      'templates/en/only-en.md has no source counterpart',
      'templates/en/task.md placeholders differ: id != id, title',
    ]);
  } finally { cleanup(root); }
});
