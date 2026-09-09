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

// BS-19: четыре проверки формы в loadConfig, которые до сих пор можно было вырезать при зелёном
// npm test. Базовый конфиг валиден, каждый случай портит ровно одно поле.
test('config: prefix, docs, cli и gates проверяются формой', () => {
  const root = makeProject({ git: false });
  const setConfig = (patch) => put(root, 'backslop.json', `${JSON.stringify({ prefix: 'BS', docs: 'docs', gates: [], ...patch }, null, 2)}\n`);
  try {
    setConfig({ prefix: 'bs' });
    assert.throws(() => loadConfig(root), /prefix «bs»/);
    setConfig({ prefix: 'TOOLONG7' });
    assert.throws(() => loadConfig(root), /prefix «TOOLONG7»/);

    setConfig({ docs: '' });
    assert.throws(() => loadConfig(root), /docs «» — нужен относительный путь/);
    setConfig({ docs: '/etc' });
    assert.throws(() => loadConfig(root), /docs «\/etc»/);
    setConfig({ docs: '../снаружи' });
    assert.throws(() => loadConfig(root), /docs «\.\.\/снаружи»/);

    setConfig({ cli: '   ' });
    assert.throws(() => loadConfig(root), /cli — непустая строка команды/);

    setConfig({ gates: 'lint' });
    assert.throws(() => loadConfig(root), /gates — список строк-команд/);
    setConfig({ gates: ['lint', 7] });
    assert.throws(() => loadConfig(root), /gates — список строк-команд/);
  } finally { cleanup(root); }
});
