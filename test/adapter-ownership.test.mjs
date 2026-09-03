import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  GENERATED_MARKER, cursorRel, hasGeneratedMarker, isAdapterRel, isOwnedAdapterFile, markGenerated,
} from '../lib/adapter-ownership.js';
import { repoMarkdown } from '../lib/mdwalk.js';

function scratch() {
  return mkdtempSync(path.join(os.tmpdir(), 'backslop-own-'));
}

function put(dir, rel, text) {
  const abs = path.join(dir, ...rel.split('/'));
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, text);
  return abs;
}

test('cursorRel: SKILL.md становится mdc, references остаются каталогом', () => {
  assert.equal(cursorRel('backslop-task/SKILL.md'), '.cursor/rules/backslop-task.mdc');
  assert.equal(cursorRel('backslop-batch/references/measurements.md'), '.cursor/rules/backslop-batch/references/measurements.md');
});

test('hasGeneratedMarker: только позиция markGenerated, не цитата в теле', () => {
  const dir = scratch();
  try {
    const owned = put(dir, 'owned.md', markGenerated('# skill\n'));
    const quoted = put(dir, 'quoted.md', `# note\n\nмаркер ${GENERATED_MARKER} в тексте\n`);
    const cursor = put(dir, 'rule.mdc', markGenerated('---\ndescription: "x"\nalwaysApply: false\n---\n\n# rule\n'));
    assert.equal(hasGeneratedMarker(owned), true);
    assert.equal(hasGeneratedMarker(quoted), false);
    assert.equal(hasGeneratedMarker(cursor), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('isOwnedAdapterFile: цитата маркера в docs не владеет файлом; adapter path + маркер — владеет', () => {
  const dir = scratch();
  try {
    const docs = put(dir, 'docs/adr.md', `# ADR\n\nцитата ${GENERATED_MARKER}\n`);
    const skill = put(dir, '.claude/skills/other/note.md', markGenerated('# note\n'));
    assert.equal(isAdapterRel('docs/adr.md'), false);
    assert.equal(isOwnedAdapterFile('docs/adr.md', docs), false);
    assert.equal(isOwnedAdapterFile('.claude/skills/other/note.md', skill), true);
    assert.equal(isOwnedAdapterFile('.claude/skills/backslop-task/SKILL.md', put(dir, 'missing.md', '# x\n')), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('repoMarkdown: docs с цитатой маркера остаются в обходе', () => {
  const dir = scratch();
  try {
    put(dir, 'docs/GLOSSARY.md', `# Глоссарий\n\nowned output: \`${GENERATED_MARKER}\`\n`);
    put(dir, '.claude/skills/backslop-task/SKILL.md', markGenerated('# skill\n'));
    const rels = repoMarkdown(dir).map(([rel]) => rel).sort();
    assert.deepEqual(rels, ['docs/GLOSSARY.md']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
