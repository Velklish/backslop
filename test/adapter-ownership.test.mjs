import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  GENERATED_MARKER, hasGeneratedMarker, isOwnedAdapterFile, markGenerated,
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

test('hasGeneratedMarker: only the markGenerated position owns a file, whatever the line ends and BOM', () => {
  const crlfFrontmatter = markGenerated('---\r\ndescription: "x"\r\nalwaysApply: false\r\n---\r\n\r\n# rule\r\n');
  const rows = [
    { name: 'LF plain', text: markGenerated('# skill\n'), expect: true },
    { name: 'LF frontmatter', text: markGenerated('---\ndescription: "x"\nalwaysApply: false\n---\n\n# rule\n'), expect: true },
    { name: 'quoted in the body', text: `# note\n\nмаркер ${GENERATED_MARKER} в тексте\n`, expect: false },
    { name: 'CRLF plain', text: markGenerated('# skill\r\n\r\nтекст\r\n'), expect: true },
    { name: 'CRLF frontmatter', text: crlfFrontmatter, expect: true },
    { name: 'CRLF after the marker', text: markGenerated('# skill\n').replace(/\n/g, '\r\n'), expect: true },
    { name: 'BOM plain', text: `\uFEFF${markGenerated('# skill\n')}`, expect: true },
    { name: 'BOM frontmatter', text: `\uFEFF${markGenerated('---\ndescription: "x"\n---\n\n# rule\n')}`, expect: true },
    { name: 'BOM, quoted in the body', text: `\uFEFF# note\n\n${GENERATED_MARKER}\n`, expect: false },
    { name: 'bare marker ends the file', text: GENERATED_MARKER, expect: true },
    { name: 'marker glued to text', text: `${GENERATED_MARKER}# skill\n`, expect: false },
  ];
  const dir = scratch();
  try {
    rows.forEach(({ name, text, expect }, i) => {
      assert.equal(hasGeneratedMarker(put(dir, `${i}.md`, text)), expect, name);
    });
    // Маркер лёг после CRLF-фронтматтера, а не перед ним: перед ним он владел бы файлом,
    // стоя не в своей позиции, и cursor rule уехал бы с испорченной шапкой.
    assert.match(crlfFrontmatter, /^---\r\n[\s\S]*?\r\n---\r\n<!-- backslop:generated -->/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('isOwnedAdapterFile: цитата маркера в docs не владеет файлом; adapter path + маркер — владеет', () => {
  const dir = scratch();
  try {
    const docs = put(dir, 'docs/adr.md', `# ADR\n\nцитата ${GENERATED_MARKER}\n`);
    const skill = put(dir, '.claude/skills/other/note.md', markGenerated('# note\n'));
    assert.equal(isOwnedAdapterFile('docs/marked.md', put(dir, 'docs/marked.md', markGenerated('# x\n'))), false);
    assert.equal(isOwnedAdapterFile('docs/adr.md', docs), false);
    assert.equal(isOwnedAdapterFile('.claude/skills/other/note.md', skill), true);
    assert.equal(isOwnedAdapterFile('.claude/skills/backslop-task/SKILL.md', put(dir, 'unmarked.md', '# x\n')), false);
    assert.equal(isOwnedAdapterFile('.claude/skills/backslop-task/SKILL.md', path.join(dir, 'missing.md')), false);
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
