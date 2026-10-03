// Parsing and rewriting markdown links: every form that broke on a manual file move, plus those
// that must not be touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {
  EXTERNAL, anchorReader, anchorsOf, checkLinks, directoryLinks, hasAnchor, linksOf, normalizeHrefTarget, relativeLinks,
  rewriteFoldedLinks, repoPrefix, rewriteIncomingLinks, rewriteMovedLinks, slugOf, splitHref, uniqueSlugs,
} from '../lib/links.js';
import { SECTION, cleanup, cli, escapeRe, gitAll, makeProject, put, read, ru, ruCard, ruOutcome, ruRe, ruResult, run } from './helpers.mjs';

// The slug of the context heading, as an incoming link with a fragment spells it.
const ANCHOR = SECTION.context.toLowerCase();
const FOLD_SUMMARY = 'folded tasks {entries}, lines appended to {log} {lines}, files with updated links {changed}, links into the folded left unrewritten {missed}';

const FROM = 'docs/backlog/active';
const TO = 'docs/archive/BS-42-move-breaks-links';

const ENCODED = '[a](a%20b.md) [b](<a b.md>) [c](a%20b.md#x) [d](a%2Db.md) [e](%c3%a9.md)';

// Gate 1 problems of a file as `{ href, real }`: `real` is the real spelling of a case mismatch.
const broken = (file, root) => checkLinks(file, root).problems.map(({ href, real = null }) => ({ href, real }));

test('moved file: link targets are recomputed from the new directory or left as written', () => {
  for (const [label, before, after, to = TO] of [
    ['same depth outside the move', '[10](../../reference/10-validation.md)', '[10](../../reference/10-validation.md)'],
    ['archive sibling', '[BS-7](../../archive/BS-7-x/task.md)', '[BS-7](../BS-7-x/task.md)'],
    ['same depth outside docs', '[lint.js](../../../lib/lint.js)', '[lint.js](../../../lib/lint.js)'],
    ['file next to the old place', '[BS-41](BS-41-x.md)', '[BS-41](../../backlog/active/BS-41-x.md)'],
    ['neighbouring status directory', '[BS-40](../queue/BS-40-y.md)', '[BS-40](../../backlog/queue/BS-40-y.md)'],
    ['anchor kept', '[r](../queue/BS-40-y.md#summary)', '[r](../../backlog/queue/BS-40-y.md#summary)'],
    ['title kept', '[r](../queue/BS-40-y.md "Title")', '[r](../../backlog/queue/BS-40-y.md "Title")'],
    ['angle brackets kept', '[r](<../queue/BS-40-y.md>)', '[r](<../../backlog/queue/BS-40-y.md>)'],
    ['reference-style definition',
      'See [queue][q].\n\n[q]: ../queue/BS-40-y.md\n', 'See [queue][q].\n\n[q]: ../../backlog/queue/BS-40-y.md\n'],
    ['external addresses and anchors untouched',
      '[gh](https://github.com/x), [mail](mailto:a@b) and [section](#summary)', '[gh](https://github.com/x), [mail](mailto:a@b) and [section](#summary)'],
    ['root path untouched', '[k](/docs/README.md)', '[k](/docs/README.md)'],
    ['query kept', '[q](../queue/BS-40-y.md?plain=1)', '[q](../../backlog/queue/BS-40-y.md?plain=1)'],
    ['encoding alone never triggers a rewrite', ENCODED, ENCODED, FROM],
  ]) {
    assert.equal(rewriteMovedLinks(before, FROM, to), after, label);
  }
});

const OLD = 'docs/backlog/active/BS-42-x.md';
const NEW = 'docs/archive/BS-42-x/task.md';

test('incoming links: only the link to the moved file is rewritten; anchor and root form kept', () => {
  for (const [text, fileDir, expected] of [
    ['[BS-42](BS-42-x.md)', 'docs/backlog/active', '[BS-42](../../archive/BS-42-x/task.md)'],
    ['[BS-42](../backlog/active/BS-42-x.md)', 'docs/reference', '[BS-42](../archive/BS-42-x/task.md)'],
    ['[BS-42](../../backlog/active/BS-42-x.md)', 'docs/archive/BS-30-y', '[BS-42](../BS-42-x/task.md)'],
    ['[BS-42](docs/backlog/active/BS-42-x.md)', '', '[BS-42](docs/archive/BS-42-x/task.md)'],
    ['[BS-42](BS-42-x.md#summary) and [BS-41](BS-41-y.md)', 'docs/backlog/active',
      '[BS-42](../../archive/BS-42-x/task.md#summary) and [BS-41](BS-41-y.md)'],
    ['[BS-42](/docs/backlog/active/BS-42-x.md#summary) and [BS-41](/docs/backlog/active/BS-41-y.md)', 'docs',
      '[BS-42](/docs/archive/BS-42-x/task.md#summary) and [BS-41](/docs/backlog/active/BS-41-y.md)'],
    ['See [the task][t].\n\n[t]: </docs/backlog/active/BS-42-x.md>\n', '',
      'See [the task][t].\n\n[t]: </docs/archive/BS-42-x/task.md>\n'],
  ]) {
    assert.equal(rewriteIncomingLinks(text, fileDir, OLD, NEW), expected);
  }
});

test('parsing: code blocks, spans and external addresses give no links', () => {
  const text = [
    'A live [a](a.md) and an external [gh](https://x.y).',
    '',
    '```',
    '[example](example.md)',
    '```',
    '',
    '````md',
    '```',
    '[nested](nested.md)',
    '```',
    '````',
    '',
    '1. Item:',
    '',
    '   ```json',
    '   [indented](indented.md)',
    '   ```',
    '',
    'A span `[quoted](span.md)` and an anchor [i](#top).',
    'A heading [b](b.md "title") and brackets [c](<c d.md>).',
  ].join('\n');
  assert.deepEqual(relativeLinks(text), ['a.md', 'b.md', 'c d.md']);
});

test('parsing: a fence with a deep indent in a nested list is still code; an unclosed fence blanks to the end', () => {
  assert.deepEqual(relativeLinks('- item\n  - subitem:\n\n      ```\n      [a](a.md)\n      ```\n\n[b](b.md)\n'), ['b.md']);
  assert.deepEqual(relativeLinks('```\n[a](a.md)\n\ntext [b](b.md)\n'), []);
  assert.deepEqual(relativeLinks('~~~\n```\n[a](a.md)\n~~~\n[b](b.md)\n'), ['b.md']);
});

test('parsing: a footnote is not a link definition; a definition after a heading is a definition', () => {
  assert.deepEqual(relativeLinks('Text[^1].\n\n[^1]: The footnote.\n'), []);
  assert.deepEqual(relativeLinks('# Heading\n[a]: a.md\n'), ['a.md']);
});

test('folding: a root target and a directory with a slash reach resolve as a root-based path, the link form is kept', () => {
  const seen = [];
  const resolve = (target, href) => {
    seen.push([target, href]);
    return target === 'docs/archive/BS-1-x' || target === 'docs/archive/BS-1-x/task.md'
      ? { path: 'docs/archive/LOG.md', anchor: 'bs-1' }
      : null;
  };
  const text = [
    '[k](/docs/archive/BS-1-x/task.md#context) [d](../archive/BS-1-x/) [u](<../archive/BS-1-x/> "directory")',
    '[o](../archive/BS-1-x/notes.md) [gh](https://x.y/docs/archive/BS-1-x/task.md) [i](#summary)',
    '',
    '[r]: /docs/archive/BS-1-x/',
  ].join('\n');
  assert.equal(rewriteFoldedLinks(text, 'docs/backlog', resolve), [
    '[k](/docs/archive/LOG.md#bs-1) [d](../archive/LOG.md#bs-1) [u](<../archive/LOG.md#bs-1> "directory")',
    '[o](../archive/BS-1-x/notes.md) [gh](https://x.y/docs/archive/BS-1-x/task.md) [i](#summary)',
    '',
    '[r]: /docs/archive/LOG.md#bs-1',
  ].join('\n'));
  // An unrecognised target reaches resolve as written: the fold's summary names the link by it.
  assert.deepEqual(seen.find(([, href]) => href.endsWith('notes.md')), ['docs/archive/BS-1-x/notes.md', '../archive/BS-1-x/notes.md']);
  assert.ok(!seen.some(([, href]) => /^(https?:|#)/.test(href)), 'an external address and an anchor do not reach resolve');
});

test('parsing: a reference-style definition only at the start of a paragraph', () => {
  assert.deepEqual(relativeLinks('[a]: a.md\n[a2]: a2.md\n\ntext\n[b]: b.md\n[c]: c.md\n'), ['a.md', 'a2.md']);
  assert.deepEqual(relativeLinks('First line of a paragraph,\n[Note]: an explanation\n'), []);
});

test('broken links of a file: the target resolves from its directory, the anchor against its headings', () => {
  const sb = mkdtempSync(path.join(os.tmpdir(), 'backslop-links-'));
  try {
    mkdirSync(path.join(sb, 'docs', 'reference'), { recursive: true });
    writeFileSync(path.join(sb, 'docs', 'reference', 'README.md'), `# ${ru('Reference')}\n`);
    const file = path.join(sb, 'docs', 'note.md');
    writeFileSync(file, `[j](reference/README.md#${ANCHOR}) [m](reference/missing.md) [v](https://x.y) [k](/docs/reference/README.md?plain=1#${ru('Reference').toLowerCase()}) [n](/nope.md)\n`);
    assert.deepEqual(checkLinks(file, sb), {
      counts: { links: 5, local: 4, anchors: 2 },
      problems: [
        { kind: 'anchor', line: 1, href: `reference/README.md#${ANCHOR}`, fragment: ANCHOR, target: 'docs/reference/README.md' },
        { kind: 'missing', line: 1, href: 'reference/missing.md' },
        { kind: 'missing', line: 1, href: '/nope.md' },
      ],
    });
  } finally {
    rmSync(sb, { recursive: true, force: true });
  }
});

test('directory links: only an existing directory counts; text from the source; code and file paths do not', () => {
  const sb = mkdtempSync(path.join(os.tmpdir(), 'backslop-links-'));
  try {
    mkdirSync(path.join(sb, 'docs', 'triage'), { recursive: true });
    writeFileSync(path.join(sb, 'docs', 'triage', 'BS-5-x.md'), '# BS-5 · X\n');
    const file = path.join(sb, 'docs', 'note.md');
    for (const [label, note, expected] of [
      ['inline links, spans and fences', '[a](triage) [f](triage/BS-5-x.md) [n](none) [`BS-5`](triage/#x) [v](https://x.y) [k](/docs/triage) `[s](triage)`\n\n```\n[f](triage)\n```\n', [
        { text: 'a', href: 'triage', line: 1 },
        { text: '`BS-5`', href: 'triage/#x', line: 1 },
        { text: 'k', href: '/docs/triage', line: 1 },
      ]],
      ['reference-style: full, collapsed and shortcut forms, label case-insensitive', [
        'Full [BS-5][f], case [`BS-6`][F], collapsed [BS-7][] and shortcut [BS-8].',
        'File [BS-9][card], inline [a](triage/BS-5-x.md), span `[BS-10][f]`, checkbox [x] without a definition.',
        '',
        '[f]: triage',
        '[bs-7]: <triage/>',
        '[BS-8]: /docs/triage#x',
        '[card]: triage/BS-5-x.md',
        '',
        'Paragraph',
        '[late]: triage',
        '',
        '```',
        '[code]: triage',
        '```',
        '[Late] and [code].',
      ].join('\n'), [
        { text: 'BS-5', href: 'triage', line: 1 },
        { text: '`BS-6`', href: 'triage', line: 1 },
        { text: 'BS-7', href: 'triage/', line: 1 },
        { text: 'BS-8', href: '/docs/triage#x', line: 1 },
      ]],
      ['text from the nearest bracket; a path through a file is neither a directory nor a refusal', 'A half-interval [0, 1) — see BS-5. Templates — [templates/](triage).\nAlso [half-interval — BS-5,\nand [directory](triage/).\n[BS-5](triage/BS-5-x.md/x)\n', [
        { text: 'templates/', href: 'triage', line: 1 },
        { text: 'directory', href: 'triage/', line: 3 },
      ]],
    ]) {
      writeFileSync(file, note);
      assert.deepEqual(directoryLinks(file, sb), expected, label);
    }
  } finally {
    rmSync(sb, { recursive: true, force: true });
  }
});

test('splitHref and normalizeHrefTarget: one cut at # or ?, decoded, / from the project root', () => {
  assert.deepEqual(splitHref('a.md?plain=1#x'), { target: 'a.md', rest: '?plain=1#x' });
  assert.deepEqual(splitHref('a.md#x?y'), { target: 'a.md', rest: '#x?y' });
  assert.deepEqual(splitHref('a.md'), { target: 'a.md', rest: '' });
  assert.equal(normalizeHrefTarget('docs', 'adr/adr-001-process%2Emd'), 'docs/adr/adr-001-process.md');
  assert.equal(normalizeHrefTarget('docs', '/docs/adr/../README.md'), 'docs/README.md');
  assert.equal(normalizeHrefTarget('docs/reference', '../../README.md'), 'README.md');
  assert.equal(normalizeHrefTarget('', 'docs/a b.md'), 'docs/a b.md');
  assert.equal(normalizeHrefTarget('docs', 'a%E0%A4%A.md'), null, 'a malformed escape resolves to nothing');
});

test('rewrites: a percent-encoded link moves and stays encoded; a malformed escape is never decoded', () => {
  assert.equal(rewriteMovedLinks('[q](../queue/BS-40%20y.md#a) [m](../queue/100%.md)', FROM, TO),
    '[q](../../backlog/queue/BS-40%20y.md#a) [m](../../backlog/queue/100%.md)');
  assert.equal(rewriteIncomingLinks('[i](BS-42%2Dx.md?plain=1#a) [p](BS-42-x.md) [m](BS-42%-x.md)', FROM, OLD, NEW),
    '[i](../../archive/BS-42-x/task.md?plain=1#a) [p](../../archive/BS-42-x/task.md) [m](BS-42%-x.md)');
  assert.equal(rewriteIncomingLinks('[s](my%20docs/a.md) [r](/my%20docs/a.md)', '', 'my docs/a.md', 'my docs/b c.md'),
    '[s](my%20docs/b%20c.md) [r](/my%20docs/b%20c.md)');
  const resolve = (target) => (target === 'my docs/archive/BS-1-x' ? { path: 'my docs/archive/LOG.md', anchor: 'bs-1' } : null);
  assert.equal(rewriteFoldedLinks('[f](../archive/BS-1-x/) [g](../archive/BS-1-x%/)', 'my docs/backlog', resolve),
    '[f](../archive/LOG.md#bs-1) [g](../archive/BS-1-x%/)');
  assert.equal(rewriteFoldedLinks('[e](my%20docs/archive/BS-1-x/)', '', resolve), '[e](my%20docs/archive/LOG.md#bs-1)');
  const seen = [];
  const hitAll = (target) => { seen.push(target); return { path: 'my docs/archive/LOG.md', anchor: 'bs-1' }; };
  assert.equal(rewriteFoldedLinks('[t](../archive/BS-1-x/task%.md)', 'my docs/backlog', hitAll), '[t](../archive/BS-1-x/task%.md)');
  assert.deepEqual(seen, ['my docs/archive/BS-1-x/task%.md'], 'resolve sees the raw path of a malformed escape');
});

test('lint resolves an encoded hash in an existing path segment', () => {
  const root = makeProject();
  try {
    put(root, 'docs/topic#one.md', '# Heading\n');
    put(root, 'docs/links.md', '[one](topic%23one.md#heading)\n');
    const r = cli(root, ['lint']);
    assert.equal(r.code, 0, r.err);
  } finally {
    cleanup(root);
  }
});

test('lint resolves an encoded question mark in an existing path segment', { skip: process.platform === 'win32' }, () => {
  // Windows filenames cannot contain a question mark.
  const root = makeProject();
  try {
    put(root, 'docs/topic?two.md', '# Heading\n');
    put(root, 'docs/links.md', '[two](topic%3Ftwo.md#heading)\n');
    const r = cli(root, ['lint']);
    assert.equal(r.code, 0, r.err);
  } finally {
    cleanup(root);
  }
});

test('rewrites keep hash and question mark encoded within path segments', () => {
  assert.equal(rewriteMovedLinks('[x](../queue/topic%23one.md#heading)', FROM, TO),
    '[x](../../backlog/queue/topic%23one.md#heading)');
  assert.equal(rewriteIncomingLinks('[x](topic%23one.md?plain=1#heading)', 'docs',
    'docs/topic#one.md', 'docs/archive/topic#one.md'), '[x](archive/topic%23one.md?plain=1#heading)');
  assert.equal(rewriteIncomingLinks('[x](topic%3Ftwo.md#heading)', 'docs',
    'docs/topic?two.md', 'docs/archive/topic?two.md'), '[x](archive/topic%3Ftwo.md#heading)');
});

test('mv keeps a working encoded hash link in the moved card', () => {
  const root = makeProject();
  try {
    put(root, 'docs/backlog/queue/topic#one.md', '# Heading\n');
    assert.equal(cli(root, ['new', 'linked', '--queue', '--title', 'Linked']).code, 0);
    const card = 'docs/backlog/queue/BS-1-linked.md';
    put(root, card, `${read(root, card)}\n[topic](topic%23one.md#heading)\n`);
    gitAll(root);
    const r = cli(root, ['mv', '1', 'active']);
    assert.equal(r.code, 0, r.err);
    const moved = 'docs/backlog/active/BS-1-linked.md';
    assert.match(read(root, moved), /\[topic\]\(\.\.\/queue\/topic%23one\.md#heading\)/);
    assert.deepEqual(broken(path.join(root, moved), root), []);
    const archived = cli(root, ['archive', '1']);
    assert.equal(archived.code, 0, archived.err);
    const task = 'docs/archive/BS-1-linked/task.md';
    assert.match(read(root, task), /\[topic\]\(\.\.\/\.\.\/backlog\/queue\/topic%23one\.md#heading\)/);
    assert.deepEqual(broken(path.join(root, task), root), []);
  } finally {
    cleanup(root);
  }
});

test('fold names a link with a malformed escape into the folded directory and leaves it as written', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Reference\n');
    put(root, 'docs/archive/BS-1-alpha/task.md', ruCard('BS-1', 'Alpha', { area: '[x](../../reference/README.md)' }, [['context', 'text']]));
    put(root, 'docs/archive/BS-1-alpha/result.md', ruResult('BS-1', '2026-09-03', `${ruOutcome('completed')}. Summary.`));
    put(root, 'docs/ROADMAP.md', '# Roadmap\n\n[t](archive/BS-1-alpha/task%.md) [ok](archive/BS-1-alpha/task.md)\n');
    gitAll(root);
    const r = cli(root, ['fold', '1']);
    assert.equal(r.code, 0, r.err);
    assert.equal(read(root, 'docs/ROADMAP.md'), '# Roadmap\n\n[t](archive/BS-1-alpha/task%.md) [ok](archive/LOG.md#bs-1)\n');
    assert.match(r.err, new RegExp(`${ruRe(FOLD_SUMMARY, { missed: 1 }).source}\\n`));
    assert.match(r.err, / {2}docs\/ROADMAP\.md: archive\/BS-1-alpha\/task%\.md\n/);
  } finally {
    cleanup(root);
  }
});

test('root links under a repository prefix start at the repository root', () => {
  const P = 'pkg/a/';
  assert.equal(normalizeHrefTarget('docs', '/pkg/a/docs/README.md', P), 'docs/README.md');
  assert.equal(normalizeHrefTarget('docs', '/docs/README.md', P), '../../docs/README.md');
  assert.equal(normalizeHrefTarget('docs', 'README.md', P), 'docs/README.md', 'a relative link ignores the prefix');
  assert.equal(
    rewriteIncomingLinks('[t](/pkg/a/docs/backlog/queue/BS-1-x.md#a) [o](/docs/backlog/queue/BS-1-x.md)', 'docs', 'docs/backlog/queue/BS-1-x.md', 'docs/archive/BS-1-x/task.md', P),
    '[t](/pkg/a/docs/archive/BS-1-x/task.md#a) [o](/docs/backlog/queue/BS-1-x.md)',
  );
  const resolve = (target) => (target === 'docs/archive/BS-1-x/task.md' ? { path: 'docs/archive/LOG.md', anchor: 'bs-1' } : null);
  assert.equal(
    rewriteFoldedLinks('[t](/pkg/a/docs/archive/BS-1-x/task.md) [o](/docs/archive/BS-1-x/task.md)', 'docs', resolve, P),
    '[t](/pkg/a/docs/archive/LOG.md#bs-1) [o](/docs/archive/BS-1-x/task.md)',
  );
});

function makeMonorepo() {
  const top = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-mono-')));
  run(top, ['init', '-q', '-b', 'main']);
  run(top, ['config', 'user.email', 'test@example.com']);
  run(top, ['config', 'user.name', 'test']);
  run(top, ['config', 'commit.gpgsign', 'false']);
  const root = path.join(top, 'pkg', 'a');
  mkdirSync(root, { recursive: true });
  const r = cli(root, ['init', '--lang', 'ru', '--tools', 'none']);
  assert.equal(r.code, 0, r.err);
  return { top, root };
}

test('monorepo: gates 1, 8, 13 and seed resolve a root link from the repository root', () => {
  const { top, root } = makeMonorepo();
  try {
    assert.equal(repoPrefix(root), 'pkg/a/');
    assert.equal(repoPrefix(top), '');
    put(root, 'docs/note.md', [
      '[a](/pkg/a/docs/README.md)', '[b](/docs/README.md)',
      '[j](/pkg/a/docs/archive/LOG.md#bs-9)', '',
    ].join('\n'));
    put(root, 'docs/adr/adr-002-x.md', '# ADR-002: X\n\n**Status:** Accepted\n');
    put(root, 'docs/README.md', `${read(root, 'docs/README.md')}| [ADR-002](/pkg/a/docs/adr/adr-002-x.md) | x | Accepted |\n`);
    const r = cli(root, ['lint']);
    assert.equal(r.code, 1, r.out);
    const errors = r.err.split('\n').filter((l) => l.startsWith('✖ docs/'));
    assert.deepEqual(errors, [
      `✖ docs/note.md: ${ru('broken link {href} (line {line})', { href: '/docs/README.md', line: 2 })}`,
      `✖ docs/note.md: ${ru('link {href} points at a journal line that does not exist — anchor “{anchor}” belongs to no entry (line {line})', { href: '/pkg/a/docs/archive/LOG.md#bs-9', anchor: 'bs-9', line: 3 })}`,
      `✖ docs/note.md: ${ru('line {line}: tracker link {token} — documentation outlives the task record; write the contract, the rationale, or the measurement itself with its version and date', { line: 3, token: '/pkg/a/docs/archive/LOG.md#bs-9' })}`,
    ]);

    put(root, 'docs/reference/01-x.md', '# X\n');
    put(root, 'docs/reference/README.md', '# Reference\n\n| Section | About |\n|---|---|\n| [X](/pkg/a/docs/reference/01-x.md) | x |\n');
    const seed = cli(root, ['seed', '--queue-reference']);
    assert.equal(seed.code, 0, seed.err);
    assert.match(seed.out, ruRe('seed --queue-reference: tasks created {created}, skipped as already seeded {skipped}', { created: 0, skipped: 0 }), 'seed reads the row by the same rule');
  } finally {
    cleanup(top);
  }
});

test('monorepo: mv, archive and fold keep a root link rooted at the repository root', () => {
  const { top, root } = makeMonorepo();
  try {
    put(root, 'docs/reference/README.md', '# Reference\n');
    assert.equal(cli(root, ['new', 'alpha', '--queue', '--title', 'Alpha']).code, 0);
    put(root, 'docs/ROADMAP.md', `# Roadmap\n\n[BS-1](/pkg/a/docs/backlog/queue/BS-1-alpha.md#${ANCHOR})\n`);
    gitAll(top);
    let r = cli(root, ['mv', '1', 'active']);
    assert.equal(r.code, 0, r.err);
    assert.match(read(root, 'docs/ROADMAP.md'), new RegExp(`\\(/pkg/a/docs/backlog/active/BS-1-alpha\\.md#${ANCHOR}\\)`));
    r = cli(root, ['archive', '1']);
    assert.equal(r.code, 0, r.err);
    assert.match(read(root, 'docs/ROADMAP.md'), new RegExp(`\\(/pkg/a/docs/archive/BS-1-alpha/task\\.md#${ANCHOR}\\)`));
    put(root, 'docs/archive/BS-1-alpha/result.md', ruResult('BS-1', '2026-09-03', `${ruOutcome('completed')}. A one-line summary.`));
    gitAll(top);
    r = cli(root, ['fold', '1']);
    assert.equal(r.code, 0, r.err);
    assert.match(read(root, 'docs/ROADMAP.md'), /\[BS-1\]\(\/pkg\/a\/docs\/archive\/LOG\.md#bs-1\)/);
  } finally {
    cleanup(top);
  }
});

test('mv: incoming HTML href and both badge destinations move with the task', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Reference\n');
    put(root, 'docs/backlog/queue/BS-1-alpha.md',
      ruCard('BS-1', 'Alpha', { order: 10, area: '[x](../../reference/README.md)' }, [['context', 'text']]));
    put(root, 'ROADMAP.md', [
      '# Roadmap',
      '',
      `<a href="docs/backlog/queue/BS-1-alpha.md#${ANCHOR}">alpha</a>`,
      `[![inner](docs/backlog/queue/BS-1-alpha.md#${ANCHOR})](docs/backlog/queue/BS-1-alpha.md#${ANCHOR})`,
      '[query](<docs/backlog/queue/BS-1-alpha.md?key=`value`>)',
      '',
    ].join('\n'));
    gitAll(root);

    const r = cli(root, ['mv', '1', 'active']);
    assert.equal(r.code, 0, r.err);
    assert.equal(read(root, 'ROADMAP.md'), [
      '# Roadmap',
      '',
      `<a href="docs/backlog/active/BS-1-alpha.md#${ANCHOR}">alpha</a>`,
      `[![inner](docs/backlog/active/BS-1-alpha.md#${ANCHOR})](docs/backlog/active/BS-1-alpha.md#${ANCHOR})`,
      '[query](<docs/backlog/active/BS-1-alpha.md?key=`value`>)',
      '',
    ].join('\n'));
    const lint = cli(root, ['lint']);
    assert.equal(lint.code, 0, lint.err);
  } finally {
    cleanup(root);
  }
});

test('mv: a bare destination with a backtick suffix keeps its distinct unmoved filename', () => {
  const root = makeProject();
  const backup = 'docs/backlog/queue/BS-1-alpha.md`backup`';
  try {
    put(root, 'docs/reference/README.md', '# Reference\n');
    put(root, 'docs/backlog/queue/BS-1-alpha.md',
      ruCard('BS-1', 'Alpha', { order: 10, area: '[x](../../reference/README.md)' }, [['context', 'text']]));
    put(root, backup, 'backup\n');
    put(root, 'docs/ROADMAP.md',
      '[task](backlog/queue/BS-1-alpha.md) [backup](backlog/queue/BS-1-alpha.md`backup`)\n');
    gitAll(root);

    const r = cli(root, ['mv', '1', 'active']);
    assert.equal(r.code, 0, r.err);
    assert.equal(read(root, backup), 'backup\n');
    assert.equal(read(root, 'docs/ROADMAP.md'),
      '[task](backlog/active/BS-1-alpha.md) [backup](backlog/queue/BS-1-alpha.md`backup`)\n');
  } finally {
    cleanup(root);
  }
});

test('mv: incoming reference declarations behind quote or list markers move with the task', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Reference\n');
    put(root, 'docs/backlog/queue/BS-1-alpha.md',
      ruCard('BS-1', 'Alpha', { order: 10, area: '[x](../../reference/README.md)' }, [['context', 'text']]));
    put(root, 'ROADMAP.md', [
      '# Roadmap',
      '',
      'See [quoted][q] and [listed][l].',
      '',
      `> [q]: docs/backlog/queue/BS-1-alpha.md#${ANCHOR}`,
      `- [l]: docs/backlog/queue/BS-1-alpha.md#${ANCHOR}`,
      '',
    ].join('\n'));
    gitAll(root);

    const r = cli(root, ['mv', '1', 'active']);
    assert.equal(r.code, 0, r.err);
    assert.equal(read(root, 'ROADMAP.md'), [
      '# Roadmap',
      '',
      'See [quoted][q] and [listed][l].',
      '',
      `> [q]: docs/backlog/active/BS-1-alpha.md#${ANCHOR}`,
      `- [l]: docs/backlog/active/BS-1-alpha.md#${ANCHOR}`,
      '',
    ].join('\n'));
    const lint = cli(root, ['lint']);
    assert.equal(lint.code, 0, lint.err);
  } finally {
    cleanup(root);
  }
});

test('mv, archive and fold refuse before any write when git fails to name the repository root', { skip: process.platform === 'win32' }, () => {
  const root = makeProject();
  const shim = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-git-shim-')));
  try {
    put(root, 'docs/reference/README.md', '# Reference\n');
    assert.equal(cli(root, ['new', 'alpha', '--queue', '--title', 'Alpha']).code, 0);
    put(root, 'docs/archive/BS-2-beta/task.md', ruCard('BS-2', 'Beta', { area: '[x](../../reference/README.md)' }));
    put(root, 'docs/archive/BS-2-beta/result.md', ruResult('BS-2', '2026-09-03', `${ruOutcome('completed')}. Summary.`));
    put(root, 'docs/ROADMAP.md', '# Roadmap\n\n[a](backlog/queue/BS-1-alpha.md) [b](archive/BS-2-beta/task.md)\n');
    gitAll(root);
    const real = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
    writeFileSync(path.join(shim, 'git'), `#!/bin/sh\nfor a in "$@"; do [ "$a" = --show-prefix ] && kill -9 $$; done\nexec "${real}" "$@"\n`, { mode: 0o755 });
    const env = { PATH: `${shim}${path.delimiter}${process.env.PATH}` };
    for (const args of [['mv', '1', 'active'], ['archive', '1'], ['fold', '2']]) {
      const r = cli(root, args, { env });
      assert.equal(r.code, 1, `${args.join(' ')}: ${r.out}`);
      assert.match(r.err, new RegExp(escapeRe(`git rev-parse --show-prefix: ${ru('killed by {signal}', { signal: 'SIGKILL' })}`)));
      assert.equal(run(root, ['status', '--porcelain']).stdout, '', `${args.join(' ')} left the tree unchanged`);
    }
  } finally {
    cleanup(root);
    rmSync(shim, { recursive: true, force: true });
  }
});

test('broken links: a target that differs only in letter case is reported with its real spelling', () => {
  const sb = mkdtempSync(path.join(os.tmpdir(), 'backslop-links-'));
  try {
    mkdirSync(path.join(sb, 'docs', 'reference'), { recursive: true });
    writeFileSync(path.join(sb, 'docs', 'reference', 'README.md'), '# Reference\n');
    const file = path.join(sb, 'docs', 'note.md');
    writeFileSync(file, '[ok](reference/README.md) [a](reference/readme.md#top) [b](/DOCS/reference/README.md) [c](Reference/)\n');
    assert.deepEqual(broken(file, sb), [
      { href: 'reference/readme.md#top', real: 'docs/reference/README.md' },
      { href: '/DOCS/reference/README.md', real: 'docs/reference/README.md' },
      { href: 'Reference/', real: 'docs/reference' },
    ]);
  } finally {
    rmSync(sb, { recursive: true, force: true });
  }
});

test('broken links: a bare destination keeps balanced parentheses, and so does the rewrite', () => {
  const sb = mkdtempSync(path.join(os.tmpdir(), 'backslop-links-'));
  try {
    mkdirSync(path.join(sb, 'docs', 'reference'), { recursive: true });
    writeFileSync(path.join(sb, 'docs', 'reference', 'foo(1).md'), '# Foo\n');
    const file = path.join(sb, 'docs', 'README.md');
    writeFileSync(file, '[foo](reference/foo(1).md) [t](reference/foo(1).md "title") [gone](reference/bar(2).md)\n');
    assert.deepEqual(relativeLinks('[foo](reference/foo(1).md)'), ['reference/foo(1).md']);
    assert.deepEqual(broken(file, sb), [{ href: 'reference/bar(2).md', real: null }]);
    assert.equal(rewriteMovedLinks('[f](../queue/foo(1).md)', FROM, TO), '[f](../../backlog/queue/foo(1).md)');
    assert.equal(
      rewriteIncomingLinks('[f](foo(1).md#a)', FROM, `${FROM}/foo(1).md`, NEW),
      '[f](../../archive/BS-42-x/task.md#a)',
    );
  } finally {
    rmSync(sb, { recursive: true, force: true });
  }
});

test('broken links: a leading BOM hides neither a first-line definition nor a first-line fence', () => {
  const sb = mkdtempSync(path.join(os.tmpdir(), 'backslop-links-'));
  try {
    mkdirSync(path.join(sb, 'docs', 'triage'), { recursive: true });
    const file = path.join(sb, 'docs', 'NOTE.md');
    writeFileSync(file, '\uFEFF[missing]: reference/nope.md\n');
    assert.deepEqual(broken(file, sb), [{ href: 'reference/nope.md', real: null }]);
    writeFileSync(file, '\uFEFF```\nexample\n```\n\nSee [missing](reference/nope.md).\n');
    assert.deepEqual(broken(file, sb), [{ href: 'reference/nope.md', real: null }]);
    writeFileSync(file, '\uFEFF[BS-5]: triage\n\nSee [BS-5].\n');
    assert.deepEqual(directoryLinks(file, sb), [{ text: 'BS-5', href: 'triage', line: 3 }]);
  } finally {
    rmSync(sb, { recursive: true, force: true });
  }
});

test('external hrefs: any URI scheme, a drive letter, //host and #anchor are neither checked nor rewritten', () => {
  const text = '[ftp](ftp://host/f.txt) [file](file:///etc/hosts) [tel](tel:+123) [up](HTTPS://example.com) '
    + '[proto](//cdn.example.com/a.png) [drive](C:/docs/x.md) [a](#top) [r](/docs/x.md) [q](x.md?plain=1)';
  assert.deepEqual(relativeLinks(text), ['/docs/x.md', 'x.md?plain=1']);
  assert.ok(EXTERNAL.test('mailto:a@b') && !EXTERNAL.test('/docs/x.md') && !EXTERNAL.test('x.md'));
  const external = text.split(' [r]')[0];
  assert.equal(rewriteMovedLinks(external, FROM, TO), external);
});

test('parser: every link form with its line; code spans, fences and HTML comments hold none', () => {
  const text = [
    '[a](a.md) [t](t.md "title") [b](<b c.md>) ![i](i.png) [![badge](img.png)](outer.md)',
    '[full][Ref] [ref][] [ref] [none][missing] [x] <a href="h.md">h</a> <https://e.org>',
    '',
    '[ref]: first.md',
    '[REF]: second.md',
    '',
    '`[s](span.md)` <!-- [c](comment.md) [y][missing] --> an unclosed <!-- is text',
    '[after](after.md)',
    '',
    '````', '```', '[n](nested.md)', '```', '````',
  ].join('\n');
  assert.deepEqual(linksOf(text).map(({ form, href, line }) => [form, href, line]), [
    ['inline', 'a.md', 1], ['inline', 't.md', 1], ['inline', 'b c.md', 1], ['image', 'i.png', 1],
    ['inline', 'outer.md', 1], ['image', 'img.png', 1],
    ['reference', 'first.md', 2], ['reference', 'first.md', 2], ['reference', 'first.md', 2], ['unresolved', null, 2],
    ['html', 'h.md', 2], ['autolink', 'https://e.org', 2],
    ['definition', 'first.md', 4], ['definition', 'second.md', 5],
    ['inline', 'after.md', 8],
  ]);
  assert.deepEqual(linksOf('[none][missing]\n')[0], { line: 1, text: 'none', form: 'unresolved', href: null, label: 'missing' });
  // A label that is wholly a code span is still the written label, not an empty one.
  assert.deepEqual(linksOf('See [the config][`cfg`].\n\n[`cfg`]: config.md\n')[0],
    { line: 1, text: 'the config', form: 'reference', href: 'config.md', label: '`cfg`' });
  // A fence behind `>` or a list marker is code: nothing in it is a link or a declaration.
  assert.deepEqual(linksOf('> ```\n> [l]: x.md\n> [x][nolabel]\n> ```\n\n- ```\n  [y](y.md)\n  ```\n\n> ```\nlazy [z](z.md)\n'),
    [{ line: 11, text: 'z', form: 'inline', href: 'z.md' }]);
});

test('parser: a declaration behind blockquote markers or a list marker; a lazy line declares nothing', () => {
  const text = '> [g]: guide.md\n\nSee [t][g], [u][h], [x][n] and [y][lazy].\n\n- [h]: h.md\n\n> quote\n[lazy]: lazy.md\n\n1. [n]: n.md\n';
  assert.deepEqual(linksOf(text).map(({ form, href, line }) => [form, href, line]), [
    ['definition', 'guide.md', 1],
    ['reference', 'guide.md', 3], ['reference', 'h.md', 3], ['reference', 'n.md', 3], ['unresolved', null, 3],
    ['definition', 'h.md', 5], ['definition', 'n.md', 10],
  ]);
});

test('parser: inside an open fence a quote or list marker is code, so `> ```` does not close it', () => {
  for (const marker of ['> ', '- ']) {
    const text = ['```markdown', `${marker}\`\`\``, `${marker}code [c](inner.md)`, `${marker}\`\`\``, '```', '', '[x](gone.md)', '', '## After', ''].join('\n');
    assert.deepEqual(linksOf(text), [{ line: 7, text: 'x', form: 'inline', href: 'gone.md' }], marker);
    assert.deepEqual([...anchorsOf(text)], ['after'], marker);
  }
});

test('parser: a fence closes only on its own character, at least as long as the opening run', () => {
  assert.deepEqual(relativeLinks('~~~~\n```\n[a](a.md)\n~~~\n[b](b.md)\n~~~~\n[c](c.md)\n'), ['c.md']);
  assert.deepEqual(relativeLinks('````\n```\n[a](a.md)\n````\n[b](b.md)\n'), ['b.md']);
});

test('anchors: GitHub slugs as gitlab.ati.st renders them, duplicate suffixes, explicit ids', () => {
  for (const [heading, slug] of [['A — B', 'a--b'], ['a  --  b', 'a------b'], ['Über Straße 2.0 (beta)', 'über-straße-20-beta']]) {
    assert.equal(slugOf(heading), slug, heading);
  }
  // Each heading and its id as the gitlab.ati.st Markdown API rendered them.
  const rendered = [
    ['_emph_ and *star* word', 'emph-and-star-word'], ['![logo](l.png) Title', 'logo-title'], ['Tom &amp; Jerry', 'tom--jerry'],
    ['`<a>` tag', 'a-tag'], ['snake_case name', 'snake_case-name'], ['foo_bar_', 'foo_bar_'], ['__init__ method', 'init-method'],
    ['a \\_b\\_ c', 'a-_b_-c'], ['x&nbsp;y', 'xy'], ['&#169; c &lt;tag&gt;', '-c-tag'], ['**bold** _it_ ~~del~~', 'bold-it-del'],
    ['1. Links', '1-links'], ['Result<T, E>', 'resultt-e'], ['See <https://x.y>', 'see-httpsxy'],
    ['Tag <b>bold</b> and <br/> end', 'tag-bold-and--end'], ['Less < than > more', 'less--than--more'],
  ];
  assert.deepEqual([...anchorsOf(rendered.map(([h]) => `## ${h}`).join('\n'))], rendered.map(([, id]) => id));
  assert.deepEqual([...anchorsOf('# &#99999999; &bogus; x\n')], ['99999999-bogus-x']);
  // Setext headings and headings in a blockquote or a list item, as gitlab.ati.st gave their ids.
  const nested = [
    'Line one', 'Line two', '===', '', 'Text', '  ---', '', '- Foo', '  ---', '', '1. Bar', '   ===', '',
    '- item', '---', '', 'Para', '', '---', '', '> quoted', '> ===', '', '1. ## Numbered *h*', '', '>> ## Deep', '',
    '    ## indented code', '', '| a | b |', '|---|---|', '',
  ].join('\n');
  assert.deepEqual([...anchorsOf(nested)], ['line-one-line-two', 'text', 'foo', 'bar', 'quoted', 'numbered-h', 'deep']);
  assert.deepEqual([...anchorsOf('> ```\n> # Setup\n> ```\n\n- ```\n  # Build\n  ```\n')], []);
  assert.deepEqual(uniqueSlugs(['x', 'x', 'x-1', 'x']), ['x', 'x-1', 'x-1-1', 'x-2']);
  // A non-ASCII (Cyrillic) heading word: its slug lowercases the capital next to the Latin ü.
  const ELKA = String.fromCodePoint(0x401, 0x43b, 0x43a, 0x430);
  const text = [
    `# ${ELKA} Ü \`code\` [link](x.md)`, '## Title ##', '## Title', '### ![logo](l.png) <b>Bold</b> `<a>` tag',
    '```', '# In a fence', '```', '<!--', '# In a comment', '-->',
    '<a name="named"></a> <span id="spanned"></span> `<b id="coded">`', '#no-space',
  ].join('\n');
  assert.deepEqual([...anchorsOf(text)], [`${ELKA.toLowerCase()}-ü-code-link`, 'title', 'title-1', 'logo-bold-a-tag', 'spanned', 'named']);
  const anchors = anchorsOf('# Über uns\n');
  assert.ok(hasAnchor(anchors, 'über-uns') && hasAnchor(anchors, '%C3%BCber-uns') && hasAnchor(anchors, 'Über-Uns'));
  assert.ok(!hasAnchor(anchors, 'uber-uns') && !hasAnchor(anchors, '%E0%A4%A'));
});

test('checkLinks: a non-Markdown target, a target outside the project and a skipped target keep their fragment', () => {
  const top = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-links-')));
  try {
    const root = path.join(top, 'proj');
    mkdirSync(path.join(root, 'docs'), { recursive: true });
    writeFileSync(path.join(top, 'OUT.md'), '# Out\n');
    writeFileSync(path.join(root, 'docs', 'code.js'), '');
    writeFileSync(path.join(root, 'docs', 'LOG.md'), '# Log\n');
    const file = path.join(root, 'docs', 'note.md');
    writeFileSync(file, '[c](code.js#L10) [o](../../OUT.md#nope) [l](LOG.md#nope) [s](#nope) [h](#here) [d](.#x)\n\n## Here\n');
    const { counts, problems } = checkLinks(file, root, '', anchorReader(root), (rel) => rel === 'docs/LOG.md');
    assert.deepEqual(counts, { links: 6, local: 6, anchors: 2 });
    assert.deepEqual(problems, [{ kind: 'anchor', line: 1, href: '#nope', fragment: 'nope', target: null }]);
  } finally {
    rmSync(top, { recursive: true, force: true });
  }
});

test('anchors: a named entity that stands for punctuation or a symbol drops out of the slug', () => {
  // Ids as the gitlab.ati.st Markdown API rendered these headings.
  const rendered = [['A &mdash; B', 'a--b'], ['Copy &copy; x &hellip; y', 'copy--x--y']];
  assert.deepEqual([...anchorsOf(rendered.map(([h]) => `## ${h}`).join('\n'))], rendered.map(([, id]) => id));
});
