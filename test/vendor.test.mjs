import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { cleanup, cli, put, read, toolCli, toolCopy } from './helpers.mjs';
import { TEMPLATES_DIR } from '../lib/templates.js';
import { srcFiles } from '../lib/mdwalk.js';

const VENDOR = path.join(TEMPLATES_DIR, 'vendor');
const TOOLS = ['claude', 'cursor', 'codex'];
const SKILLS = { humanizer: 'backslop-humanizer', 'technical-documentation': 'backslop-techdoc' };

function emptyRepo() {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-vendor-')));
  spawnSync('git', ['-C', root, 'init', '-q', '-b', 'main']);
  return root;
}

// SOURCE.md read as a record: upstream, commit, copy date, modified files, sha256 by file.
function sourceRecord(text) {
  const section = (title) => text.split(/^## /m).find((s) => s.startsWith(`${title}\n`)) ?? '';
  const bullets = section('Modifications').split('\n').filter((l) => l.startsWith('- '));
  return {
    url: text.match(/^Copied from <(https:\/\/[^>]+)>/m)?.[1],
    sha: text.match(/at commit `([0-9a-f]{40})`/)?.[1],
    date: text.match(/^- Copy date: (\d{4}-\d{2}-\d{2})$/m)?.[1],
    bullets,
    modified: new Set(bullets.map((l) => l.match(/^- `([^`]+)`/)?.[1])),
    hashes: new Map([...section('Upstream files').matchAll(/^\| `([^`]+)` \| `([0-9a-f]{64})` \|$/gm)].map((m) => [m[1], m[2]])),
  };
}

// A CRLF checkout (autocrlf) is folded back to upstream's LF before hashing or comparing.
function readLF(file) {
  return readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

function sha256(file) {
  return createHash('sha256').update(readLF(file)).digest('hex');
}

function vendorFiles(dir) {
  const files = srcFiles(dir, '', ['.md']).map(([rel]) => rel);
  if (existsSync(path.join(dir, 'LICENSE'))) files.push('LICENSE');
  return files.filter((rel) => rel !== 'SOURCE.md').sort();
}

test('self-host: every vendored skill carries LICENSE and a SOURCE.md that its unmodified files match', () => {
  const dirs = readdirSync(VENDOR, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  assert.deepEqual(dirs, Object.keys(SKILLS).sort(), 'the vendored skills');
  for (const name of dirs) {
    const dir = path.join(VENDOR, name);
    assert.ok(existsSync(path.join(dir, 'LICENSE')), `vendor/${name}: LICENSE is missing`);
    assert.ok(existsSync(path.join(dir, 'SOURCE.md')), `vendor/${name}: SOURCE.md is missing`);
    const src = sourceRecord(readLF(path.join(dir, 'SOURCE.md')));
    assert.ok(src.url, `vendor/${name}: SOURCE.md has no https upstream URL`);
    assert.ok(src.sha, `vendor/${name}: SOURCE.md has no 40-hex commit sha`);
    assert.ok(src.date, `vendor/${name}: SOURCE.md has no copy date`);
    assert.ok(src.bullets.length, `vendor/${name}: SOURCE.md has no modification list`);
    assert.deepEqual([...src.hashes.keys()].sort(), vendorFiles(dir), `vendor/${name}: the sha256 table and the files differ`);
    for (const rel of src.modified) assert.ok(src.hashes.has(rel), `vendor/${name}: modified ${rel} is not an upstream file`);
    for (const [rel, hash] of src.hashes) {
      if (src.modified.has(rel)) continue;
      assert.equal(sha256(path.join(dir, ...rel.split('/'))), hash, `vendor/${name}/${rel} differs from upstream`);
    }
    const skill = readLF(path.join(dir, 'SKILL.md'));
    assert.match(skill, new RegExp(`^---\\r?\\nname: ${SKILLS[name]}\\r?\\n`), `vendor/${name}: the frontmatter name is not ${SKILLS[name]}`);
  }
});

const HUMANIZER_DESCRIPTION = [
  'Rewrite AI-sounding text so it reads like the writer without changing what it says.',
  'Use when editing or reviewing prose for AI tells: not-X-but-Y contrasts, one-line',
  'closers, staged openers, forced triads, dashes everywhere, inflated claims, sales',
  'language, stock AI words, bold labels, or filler. Based on Wikipedia\'s "Signs of AI writing."',
].join('\n');

// The humanizer `description: |` line with its indented block, up to the next key.
const DESCRIPTION_BLOCK = /^description: \|\n(?: {2}.*\n)+/m;

function mdcDescription(text) {
  return JSON.parse(text.match(/^---\ndescription: (".*")\nalwaysApply: false\n---\n/)[1]);
}

// Paths of both vendored skills under each adapter, as the adapters lay them out.
function outputs(skill) {
  return {
    claude: [`.claude/skills/${skill}/SKILL.md`, `.claude/skills/${skill}/LICENSE`, `.claude/skills/${skill}/SOURCE.md`],
    codex: [`.agents/skills/${skill}/SKILL.md`, `.agents/skills/${skill}/LICENSE`, `.agents/skills/${skill}/SOURCE.md`],
    cursor: [`.cursor/rules/${skill}.mdc`, `.cursor/rules/${skill}/LICENSE`, `.cursor/rules/${skill}/SOURCE.md`],
  };
}

for (const lang of ['ru', 'en']) {
  test(`init --lang ${lang}: the adapters lay out both vendored skills with LICENSE and SOURCE.md, --tools none removes them`, () => {
    const root = emptyRepo();
    try {
      let r = cli(root, ['init', '--lang', lang, '--tools', TOOLS.join(',')]);
      assert.equal(r.code, 0, r.err);
      for (const [name, skill] of Object.entries(SKILLS)) {
        const vendorLicense = readLF(path.join(VENDOR, name, 'LICENSE'));
        for (const tool of TOOLS) {
          const [main, license, source] = outputs(skill)[tool];
          assert.equal(read(root, license), vendorLicense, `${license} is not the upstream notice verbatim`);
          assert.match(read(root, source), /^<!-- backslop:generated -->\n# Source\n/, `${source} is not marked`);
          if (tool !== 'cursor') assert.match(read(root, main), new RegExp(`^---\\nname: ${skill}\\n[\\s\\S]*?\\n---\\n<!-- backslop:generated -->\\n`));
        }
      }
      assert.equal(mdcDescription(read(root, '.cursor/rules/backslop-humanizer.mdc')), HUMANIZER_DESCRIPTION);
      const techdoc = read(root, '.cursor/rules/backslop-techdoc.mdc');
      const description = mdcDescription(techdoc);
      assert.ok(description.startsWith('Audit, write, and improve developer documentation using Google\'s Developer'), description);
      assert.ok(description.endsWith('For marketing or landing-page copy, see storybrand-messaging.'), description);
      assert.ok(!description.includes("''"), 'a doubled single quote is left in the description');
      assert.match(techdoc, /\]\(backslop-techdoc\/references\/document-types\.md\)/);
      assert.ok(existsSync(path.join(root, '.cursor/rules/backslop-techdoc/references/document-types.md')));
      r = cli(root, ['lint']);
      assert.equal(r.code, 0, r.err + r.out);

      put(root, '.claude/skills/backslop-humanizer/LICENSE', 'edited\n');
      put(root, '.agents/skills/backslop-techdoc/references/release-notes.md', '<!-- backslop:generated -->\nedited\n');
      r = cli(root, ['init', '--lang', lang, '--tools', TOOLS.join(',')]);
      assert.equal(r.code, 0, r.err);
      assert.equal(read(root, '.claude/skills/backslop-humanizer/LICENSE'), readLF(path.join(VENDOR, 'humanizer', 'LICENSE')));
      assert.match(read(root, '.agents/skills/backslop-techdoc/references/release-notes.md'), /^<!-- backslop:generated -->\n# /);

      r = cli(root, ['init', '--tools', 'none']);
      assert.equal(r.code, 0, r.err);
      for (const skill of Object.values(SKILLS)) {
        for (const dir of [`.claude/skills/${skill}`, `.agents/skills/${skill}`, `.cursor/rules/${skill}`, `.cursor/rules/${skill}.mdc`]) {
          assert.ok(!existsSync(path.join(root, dir)), `${dir} is left after --tools none`);
        }
      }
      r = cli(root, ['lint']);
      assert.equal(r.code, 0, r.err + r.out);
    } finally {
      cleanup(root);
    }
  });
}

test('init keeps a foreign LICENSE in a vendored skill directory and does not come to own it on a rerun', () => {
  const root = emptyRepo();
  try {
    put(root, '.claude/skills/backslop-humanizer/LICENSE', 'my licence\n');
    for (let run = 0; run < 2; run += 1) {
      const r = cli(root, ['init', '--lang', 'en', '--tools', 'claude']);
      assert.equal(r.code, 0, r.err);
      assert.match(r.err + r.out, /\.claude\/skills\/backslop-humanizer\/LICENSE/, 'the foreign LICENSE is not named');
      assert.equal(read(root, '.claude/skills/backslop-humanizer/LICENSE'), 'my licence\n', `run ${run + 1} overwrote the LICENSE`);
      assert.ok(!existsSync(path.join(root, '.claude/skills/backslop-humanizer/SOURCE.md')), 'SOURCE.md would own the LICENSE');
      assert.ok(!existsSync(path.join(root, '.claude/skills/backslop-humanizer/SKILL.md')), 'the skill ships without its licence');
    }
    const r = cli(root, ['init', '--tools', 'none']);
    assert.equal(r.code, 0, r.err);
    assert.equal(read(root, '.claude/skills/backslop-humanizer/LICENSE'), 'my licence\n');
  } finally {
    cleanup(root);
  }
});

test('init keeps a foreign SOURCE.md in a vendored skill directory and writes no LICENSE beside it', () => {
  const root = emptyRepo();
  try {
    put(root, '.claude/skills/backslop-humanizer/SOURCE.md', '# my notes\n');
    for (let run = 0; run < 2; run += 1) {
      const r = cli(root, ['init', '--lang', 'en', '--tools', 'claude']);
      assert.equal(r.code, 0, r.err);
      assert.match(r.err + r.out, /\.claude\/skills\/backslop-humanizer\/SOURCE\.md/, 'the foreign SOURCE.md is not named');
      assert.equal(read(root, '.claude/skills/backslop-humanizer/SOURCE.md'), '# my notes\n', `run ${run + 1} overwrote SOURCE.md`);
      assert.ok(!existsSync(path.join(root, '.claude/skills/backslop-humanizer/LICENSE')), 'a LICENSE no marker owns is written');
      assert.ok(!existsSync(path.join(root, '.claude/skills/backslop-humanizer/SKILL.md')), 'the skill ships without its licence');
      assert.match(r.err + r.out, /not laid out at all, so it never ships without its licence: claude backslop-humanizer/);
    }
    const r = cli(root, ['init', '--tools', 'none']);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(readdirSync(path.join(root, '.claude/skills/backslop-humanizer')), ['SOURCE.md']);
  } finally {
    cleanup(root);
  }
});

test('init removes a LICENSE left by a vendored skill the tool no longer ships, with its SOURCE.md', () => {
  const root = emptyRepo();
  try {
    let r = cli(root, ['init', '--lang', 'en', '--tools', 'claude']);
    assert.equal(r.code, 0, r.err);
    put(root, '.claude/skills/backslop-gone/SOURCE.md', '<!-- backslop:generated -->\n# Source\n');
    put(root, '.claude/skills/backslop-gone/LICENSE', 'MIT\n');
    put(root, '.claude/skills/backslop-kept/LICENSE', 'MIT\n');
    r = cli(root, ['init', '--lang', 'en', '--tools', 'claude']);
    assert.equal(r.code, 0, r.err);
    assert.ok(!existsSync(path.join(root, '.claude/skills/backslop-gone')), 'the stale vendored directory is left');
    assert.equal(read(root, '.claude/skills/backslop-kept/LICENSE'), 'MIT\n', 'a LICENSE without a marked SOURCE.md is removed');
  } finally {
    cleanup(root);
  }
});

test('lint: the adapter pass checks the links and the LICENSE of the laid-out vendored skills', () => {
  const root = emptyRepo();
  try {
    let r = cli(root, ['init', '--lang', 'en', '--tools', 'cursor']);
    assert.equal(r.code, 0, r.err);
    const rel = '.cursor/rules/backslop-techdoc/references/api-reference.md';
    put(root, rel, read(root, rel).replace('](voice-and-words.md)', '](missing.md)'));
    unlinkSync(path.join(root, '.cursor/rules/backslop-humanizer/LICENSE'));
    put(root, '.gitignore', '');
    r = cli(root, ['lint']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err + r.out, /\.cursor\/rules\/backslop-techdoc\/references\/api-reference\.md: broken link missing\.md/);
    assert.match(r.err + r.out, /\.cursor\/rules\/backslop-humanizer\/LICENSE: generated output for adapter cursor is missing/);
  } finally {
    cleanup(root);
  }
});

test('init --tools cursor refuses a vendored description form it does not decode, naming the file', () => {
  const file = ['templates', 'vendor', 'humanizer', 'SKILL.md'];
  const tool = toolCopy();
  const original = readLF(path.join(tool, ...file));
  const root = emptyRepo();
  const cases = [
    ['>', '>'], ['|-', '|-'], ['|2', '|2'], ["'Rewrite AI-sounding text", "'Rewrite AI-sounding text"],
    ['>\n  Rewrite AI-sounding text\n  so it reads like the writer', '>'],
    ['Rewrite AI-sounding text\n  so it reads like the writer', 'a scalar continued on the next line'],
  ];
  const prefix = '✖ template templates/vendor/humanizer/SKILL.md: the frontmatter description is written as ';
  try {
    for (const [value, form] of cases) {
      writeFileSync(path.join(tool, ...file), original.replace(DESCRIPTION_BLOCK, `description: ${value}\n`));
      const r = toolCli(tool, ['init', '--lang', 'en', '--tools', 'cursor'], { cwd: root });
      assert.equal(r.code, 1, `${form}: ${r.out}`);
      assert.ok(r.err.startsWith(`${prefix}${form}; only`), r.err);
    }
  } finally {
    cleanup(tool);
    cleanup(root);
  }
});

test('init --tools cursor keeps a template description that starts and ends with a single quote', () => {
  const text = "'Quoted' at the start and 'at the end'";
  const tool = toolCopy((dir) => {
    const file = path.join(dir, 'templates', 'en', 'skills', 'backslop-task', 'SKILL.md');
    writeFileSync(file, readLF(file).replace(/^description: .*$/m, `description: ${JSON.stringify(text)}`));
  });
  const root = emptyRepo();
  try {
    const r = toolCli(tool, ['init', '--lang', 'en', '--tools', 'cursor'], { cwd: root });
    assert.equal(r.code, 0, r.err);
    assert.equal(mdcDescription(read(root, '.cursor/rules/backslop-task.mdc')), text);
  } finally {
    cleanup(tool);
    cleanup(root);
  }
});

test('init --tools cursor reads a vendored double-quoted description once, keeping its single quotes', () => {
  const text = "'Quoted' at the start and 'at the end'";
  const tool = toolCopy((dir) => {
    const file = path.join(dir, 'templates', 'vendor', 'humanizer', 'SKILL.md');
    writeFileSync(file, readLF(file).replace(DESCRIPTION_BLOCK, `description: ${JSON.stringify(text)}\n`));
  });
  const root = emptyRepo();
  try {
    const r = toolCli(tool, ['init', '--lang', 'en', '--tools', 'cursor'], { cwd: root });
    assert.equal(r.code, 0, r.err);
    assert.equal(mdcDescription(read(root, '.cursor/rules/backslop-humanizer.mdc')), text);
  } finally {
    cleanup(tool);
    cleanup(root);
  }
});

test('init lays out a vendored LICENSE from a CRLF checkout of the tool with LF line endings', () => {
  const tool = toolCopy((dir) => {
    const file = path.join(dir, 'templates', 'vendor', 'humanizer', 'LICENSE');
    writeFileSync(file, readLF(file).replace(/\n/g, '\r\n'));
  });
  const root = emptyRepo();
  try {
    const r = toolCli(tool, ['init', '--lang', 'en', '--tools', 'claude'], { cwd: root });
    assert.equal(r.code, 0, r.err);
    assert.equal(read(root, '.claude/skills/backslop-humanizer/LICENSE'), readLF(path.join(VENDOR, 'humanizer', 'LICENSE')));
  } finally {
    cleanup(tool);
    cleanup(root);
  }
});

test('init --tools cursor skips a whole vendored skill whose LICENSE is foreign and lays out the rest', () => {
  const root = emptyRepo();
  try {
    put(root, '.cursor/rules/backslop-techdoc/LICENSE', 'my licence\n');
    const r = cli(root, ['init', '--lang', 'en', '--tools', 'cursor']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.err + r.out, /not laid out at all, so it never ships without its licence: cursor backslop-techdoc/);
    assert.ok(!existsSync(path.join(root, '.cursor/rules/backslop-techdoc.mdc')), 'the rule ships without its licence');
    assert.deepEqual(readdirSync(path.join(root, '.cursor/rules/backslop-techdoc')), ['LICENSE']);
    assert.ok(existsSync(path.join(root, '.cursor/rules/backslop-humanizer.mdc')), 'the other vendored skill is skipped');
    assert.ok(existsSync(path.join(root, '.cursor/rules/backslop-humanizer/LICENSE')));
  } finally {
    cleanup(root);
  }
});
