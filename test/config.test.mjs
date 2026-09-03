import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../lib/config.js';
import { cleanup, makeProject, put } from './helpers.mjs';

test('config: legacy projects read as ru with no adapters', () => {
  const root = makeProject({ git: false });
  try {
    const cfg = loadConfig(root);
    assert.equal(cfg.lang, 'ru');
    assert.deepEqual(cfg.tools, []);
  } finally { cleanup(root); }
});

test('config: legacy Claude output materializes missing tools as claude', () => {
  const root = makeProject({ git: false });
  try {
    put(root, '.claude/skills/backslop-task/SKILL.md', '# legacy\n');
    assert.deepEqual(loadConfig(root).tools, ['claude']);
    put(root, 'backslop.json', '{"prefix":"BS","docs":"docs","gates":[],"tools":[]}\n');
    assert.deepEqual(loadConfig(root).tools, [], 'явное пустое поле сильнее файла на диске');
  } finally { cleanup(root); }
});

test('config: top level must be an object', () => {
  const root = makeProject({ git: false });
  try {
    put(root, 'backslop.json', '[]\n');
    assert.throws(() => loadConfig(root), /верхний уровень должен быть объектом/);
    put(root, 'backslop.json', 'null\n');
    assert.throws(() => loadConfig(root), /верхний уровень должен быть объектом/);
  } finally { cleanup(root); }
});

test('config: lang and tools reject unknown or duplicate ids', () => {
  const root = makeProject({ git: false });
  try {
    put(root, 'backslop.json', '{"prefix":"BS","docs":"docs","gates":[],"lang":"de"}\n');
    assert.throws(() => loadConfig(root), /lang/);
    put(root, 'backslop.json', '{"prefix":"BS","docs":"docs","gates":[],"tools":["vscode"]}\n');
    assert.throws(() => loadConfig(root), /claude, cursor, codex/);
    put(root, 'backslop.json', '{"prefix":"BS","docs":"docs","gates":[],"tools":["codex","codex"]}\n');
    assert.throws(() => loadConfig(root), /без повторов/);
  } finally { cleanup(root); }
});
