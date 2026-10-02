// Merging two CHANGELOG revisions by heading, with subgroups and a base. The command is a real
// process on git: it reads the revisions through `git show <ref>:./CHANGELOG.md`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CONFLICT_MARK, mergeChangelog } from '../lib/merge-changelog.js';
import { KILLED, cleanup, cli, escapeRe, gitAll, makeProject, put, read, ru, ruHeadRe, ruRe, run } from './helpers.mjs';

const NO_UNRELEASED = ruRe('{changelog} on the --ours side has no unreleased section (a “## …” heading that does not start with a version, or a top section whose version has no tag)');
const ENTRIES = 'entries: ours {ours}, theirs {theirs}, merged {merged}';
const REMOVED = 'removed relative to --base: {title}';
const LEFT_MARKS = '{marks} {mark} mark(s) left in the result — the conflict is not closed: pick a revision and remove the mark';
const UNRESOLVED = 'the unreleased section on the {side} side carries an unresolved {mark} mark: close the previous merge before merging on top of it';
const CANNOT_READ = 'cannot read {ref}:{changelog} — {cause}';

const OURS = `# Changelog

## Unreleased

- **First ours** — body ours

- **Shared** — the same revision

## v0.1.0 — 2026-01-01

- **Old** — released
`;

const THEIRS = `# Changelog

## Unreleased

- **Shared** — the same revision

- **First theirs** — body theirs

## v0.1.0 — 2026-01-01

- **Old** — released
`;

test('merge-changelog: entries of both sides, a matching entry once, released sections from ours', () => {
  const { text, report } = mergeChangelog(OURS, THEIRS);
  assert.equal(text, `# Changelog

## Unreleased

- **First ours** — body ours

- **Shared** — the same revision

- **First theirs** — body theirs

## v0.1.0 — 2026-01-01

- **Old** — released
`);
  assert.deepEqual(report.onlyOurs, ['First ours']);
  assert.deepEqual(report.onlyTheirs, ['First theirs']);
  assert.deepEqual(report.conflicts, []);
  assert.equal(report.merged, 3);
});

test('merge-changelog: a bold subgroup keeps the entry’s membership and the subgroup order', () => {
  const ours = `# Changelog

## Unreleased

**For the user:**

- **Button** — ours

**For agents:**

- **Rule** — ours
`;
  const theirs = `# Changelog

## Unreleased

**For the user:**

- **Form** — theirs

**For the operator:**

- **Metric** — theirs
`;
  const { text } = mergeChangelog(ours, theirs);
  assert.equal(text, `# Changelog

## Unreleased

**For the user:**

- **Button** — ours

- **Form** — theirs

**For agents:**

- **Rule** — ours

**For the operator:**

- **Metric** — theirs
`);
});

test('merge-changelog: diverged bodies of one heading — both revisions under the mark', () => {
  const ours = '# Changelog\n\n## Unreleased\n\n- **One** — revision ours\n';
  const theirs = '# Changelog\n\n## Unreleased\n\n- **One** — revision theirs\n';
  const { text, report } = mergeChangelog(ours, theirs);
  assert.deepEqual(report.conflicts, ['One']);
  assert.equal(text, `# Changelog

## Unreleased

${CONFLICT_MARK} One -->
- **One** — revision ours

- **One** — revision theirs
`);
});

test('merge-changelog: with --base an entry removed by a side is removed, without a base it stays', () => {
  const base = '# Changelog\n\n## Unreleased\n\n- **Shared** — body\n- **Removed** — body\n';
  const ours = '# Changelog\n\n## Unreleased\n\n- **Shared** — body\n- **Removed** — body\n';
  const theirs = '# Changelog\n\n## Unreleased\n\n- **Shared** — body\n';
  const withBase = mergeChangelog(ours, theirs, base);
  assert.deepEqual(withBase.report.dropped, ['Removed']);
  assert.doesNotMatch(withBase.text, /Removed/);
  const noBase = mergeChangelog(ours, theirs);
  assert.deepEqual(noBase.report.dropped, []);
  assert.deepEqual(noBase.report.onlyOurs, ['Removed']);
  assert.match(noBase.text, /- \*\*Removed\*\*/);

  // The reverse direction: the entry is in the base and in theirs, ours removed it.
  const reverse = mergeChangelog(theirs, ours, base);
  assert.deepEqual(reverse.report.dropped, ['Removed']);
  assert.deepEqual(reverse.report.onlyTheirs, []);
  assert.doesNotMatch(reverse.text, /Removed/);
});

test('merge-changelog: a last block removed by --base does not take the blank line before the next section', () => {
  const tail = '## v0.1.0 — 2026-01-01\n\n- **Old** — released\n';
  const ours = `# Changelog\n\n## Unreleased\n\n${tail}`;
  const theirs = `# Changelog\n\n## Unreleased\n\n- **New** — body\n- **Removed** — body\n\n${tail}`;
  const base = `# Changelog\n\n## Unreleased\n\n- **Removed** — body\n\n${tail}`;
  const merged = mergeChangelog(ours, theirs, base);
  assert.deepEqual(merged.report.dropped, ['Removed']);
  assert.equal(merged.text, `# Changelog\n\n## Unreleased\n\n- **New** — body\n\n${tail}`);

  // The same spacing on the ours side: theirs removed the entry, and in ours it stood last.
  const oursLast = `# Changelog\n\n## Unreleased\n\n- **Shared** — body\n- **Removed** — body\n\n${tail}`;
  const theirsLast = `# Changelog\n\n## Unreleased\n\n- **Shared** — body\n\n${tail}`;
  const reverse = mergeChangelog(oursLast, theirsLast, base);
  assert.deepEqual(reverse.report.dropped, ['Removed']);
  assert.equal(reverse.text, theirsLast);
});

test('merge-changelog: only the first unreleased section merges', () => {
  const ours = '# Changelog\n\n## Unreleased\n\n- **One** — ours\n\n## v0.1.0\n\n- **Released** — ours\n';
  const theirs = '# Changelog\n\n## Unreleased\n\n- **Two** — theirs\n\n## v0.1.0\n\n- **Released** — theirs\n';
  const { text } = mergeChangelog(ours, theirs);
  assert.match(text, /- \*\*One\*\* — ours/);
  assert.match(text, /- \*\*Two\*\* — theirs/);
  assert.match(text, /- \*\*Released\*\* — ours/, 'the released section is taken from ours whole');
  assert.doesNotMatch(text, /- \*\*Released\*\* — theirs/);
});

test('merge-changelog: without an unreleased section in ours — a refusal', () => {
  assert.throws(() => mergeChangelog('# Changelog\n\n## v0.1.0\n\n- **One** — ours\n', THEIRS), NO_UNRELEASED);
});

// `release --bump` renames the unreleased section to `## vX.Y.Z — <date>` before the tag.
const BUMPED = (body) => `# Changelog\n\n## v0.2.0 — 2026-02-01\n\n${body}\n## v0.1.0 — 2026-01-01\n\n- **Old** — released\n`;
const UNBUMPED = (body) => `# Changelog\n\n## Unreleased\n\n${body}\n## v0.1.0 — 2026-01-01\n\n- **Old** — released\n`;
const onlyFirstTagged = (version) => version === '0.1.0';
const headings = (text) => text.match(/^## .+$/gm);
const entries = (text) => [...text.matchAll(/^- \*\*(.+?)\*\*/gm)].map((m) => m[1]);

test('merge-changelog: the top untagged version section merges after a bump on either side', () => {
  const v2 = 'v0.2.0 — 2026-02-01';
  const bumpedHeadings = [`## ${v2}`, '## v0.1.0 — 2026-01-01'];
  const rows = [
    {
      name: 'both sides and the base bumped',
      ours: BUMPED('- **Own ours** — body\n- **Shared** — body\n- **Removed** — body\n'),
      theirs: BUMPED('- **Shared** — body\n- **Own theirs** — body\n'),
      base: BUMPED('- **Shared** — body\n- **Removed** — body\n'),
      section: { ours: v2, theirs: v2, base: v2 },
      extra: { onlyTheirs: ['Own theirs'], dropped: ['Removed'], headings: bumpedHeadings },
    },
    {
      name: 'ours bumped, theirs cut before the bump',
      ours: BUMPED('- **Own ours** — body\n- **Shared** — body\n'),
      theirs: UNBUMPED('- **Shared** — body\n- **Own theirs** — body\n'),
      base: null,
      section: { ours: v2, theirs: 'Unreleased', base: null },
      extra: { headings: bumpedHeadings },
    },
    {
      name: 'only theirs bumped',
      ours: UNBUMPED('- **Own ours** — body\n- **Shared** — body\n'),
      theirs: BUMPED('- **Shared** — body\n- **Own theirs** — body\n'),
      base: null,
      section: { ours: 'Unreleased', theirs: v2, base: null },
      extra: { theirs: 2 },
    },
  ];
  for (const { name, ours, theirs, base, section, extra } of rows) {
    const { text, report } = mergeChangelog(ours, theirs, base, 'ru', onlyFirstTagged);
    assert.deepEqual(report.section, section, name);
    assert.deepEqual(entries(text), ['Own ours', 'Shared', 'Own theirs', 'Old'], name);
    const { headings: expectedHeadings, ...fields } = extra;
    if (expectedHeadings) assert.deepEqual(headings(text), expectedHeadings, name);
    for (const [key, value] of Object.entries(fields)) assert.deepEqual(report[key], value, `${name}: report.${key}`);
  }
});

test('merge-changelog: the top version section with a tag is released — a refusal', () => {
  const tagged = (version) => ['0.1.0', '0.2.0'].includes(version);
  assert.throws(() => mergeChangelog(BUMPED('- **One** — ours\n'), THEIRS, null, 'ru', tagged), NO_UNRELEASED);
});

test('merge-changelog: a Keep a Changelog heading `## [1.2.3] - date` is a version, merged only while untagged', () => {
  const kac = (body) => `# Changelog\n\n## [1.2.3] - 2026-01-01\n\n${body}\n## [1.2.2] - 2025-12-01\n\n- **Old** — released\n`;
  const asked = [];
  const onlyOldTagged = (version) => {
    asked.push(version);
    return version === '1.2.2';
  };
  const ours = kac('- **Ours** — o\n');
  const theirs = kac('- **Theirs** — t\n');
  const { text, report } = mergeChangelog(ours, theirs, null, 'en', onlyOldTagged);
  assert.deepEqual(report.section, { ours: '[1.2.3] - 2026-01-01', theirs: '[1.2.3] - 2026-01-01', base: null });
  assert.ok(asked.includes('1.2.3'), `the tag check got ${asked.join(', ')}`);
  assert.deepEqual(headings(text), ['## [1.2.3] - 2026-01-01', '## [1.2.2] - 2025-12-01']);
  assert.deepEqual(entries(text).sort(), ['Old', 'Ours', 'Theirs']);
  assert.throws(() => mergeChangelog(ours, theirs, null, 'en', () => true), /has no unreleased section/);
});

test('merge-changelog: a version in the middle of a heading leaves the section unreleased', () => {
  const after = (body) => `# Changelog\n\n## Unreleased (after v0.1.0)\n\n${body}\n## v0.1.0 — 2026-01-01\n\n- **Old** — released\n`;
  const { text, report } = mergeChangelog(after('- **Ours** — o\n'), after('- **Theirs** — t\n'), null, 'en', () => true);
  assert.deepEqual(report.section, { ours: 'Unreleased (after v0.1.0)', theirs: 'Unreleased (after v0.1.0)', base: null });
  assert.deepEqual(headings(text), ['## Unreleased (after v0.1.0)', '## v0.1.0 — 2026-01-01']);
  assert.deepEqual(entries(text).sort(), ['Old', 'Ours', 'Theirs']);
});

test('merge-changelog: theirs has no unreleased section — the report says its entries were not read', () => {
  const root = makeProject();
  try {
    put(root, 'CHANGELOG.md', '# Changelog\n\n## v0.1.0 — 2026-01-01\n\n- **Old** — released\n');
    gitAll(root, 'release 0.1.0');
    run(root, ['tag', 'v0.1.0']);
    run(root, ['checkout', '-qb', 'worker']);
    put(root, 'CHANGELOG.md', '# Changelog\n\n## v0.1.0 — 2026-01-01\n\n- **Old** — released\n- **Entry in the released** — body\n');
    gitAll(root, 'worker');
    run(root, ['checkout', '-q', 'main']);
    put(root, 'CHANGELOG.md', UNBUMPED('- **Own ours** — body\n'));
    gitAll(root, 'ours');

    const r = cli(root, ['merge-changelog', '--ours=main', '--theirs=worker', '--out=CHANGELOG.md']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.err, ruRe(ENTRIES, { ours: 1, theirs: 0, merged: 1 }));
    assert.match(r.err, ruRe('theirs has no unreleased section — its entries were not read'));
    assert.doesNotMatch(read(root, 'CHANGELOG.md'), /Entry in the released/);
  } finally {
    cleanup(root);
  }
});

test('merge-changelog: the command checks the section version against the repository tags', () => {
  const root = makeProject();
  try {
    put(root, 'CHANGELOG.md', '# Changelog\n\n## v0.1.0 — 2026-01-01\n\n- **Old** — released\n');
    gitAll(root, 'release 0.1.0');
    run(root, ['tag', 'v0.1.0']);
    put(root, 'CHANGELOG.md', BUMPED('- **Shared** — body\n'));
    gitAll(root, 'bump 0.2.0');
    const bump = run(root, ['rev-parse', 'HEAD']).stdout.trim();
    run(root, ['checkout', '-qb', 'worker']);
    put(root, 'CHANGELOG.md', BUMPED('- **Shared** — body\n- **Own theirs** — body\n'));
    gitAll(root, 'worker');
    run(root, ['checkout', '-q', 'main']);

    let r = cli(root, ['merge-changelog', '--ours=main', '--theirs=worker', `--base=${bump}`, '--out=CHANGELOG.md']);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(entries(read(root, 'CHANGELOG.md')), ['Shared', 'Own theirs', 'Old']);
    for (const side of ['ours', 'theirs', 'base']) {
      assert.match(r.err, ruRe('unreleased section in {side} — “{title}”: the version has no tag', { side, title: 'v0.2.0 — 2026-02-01' }));
    }

    // A tag without `v` releases the version too.
    run(root, ['checkout', '--', 'CHANGELOG.md']);
    run(root, ['tag', '0.2.0']);
    r = cli(root, ['merge-changelog', '--ours=main', '--theirs=worker', '--out=CHANGELOG.md']);
    assert.equal(r.code, 1);
    assert.match(r.err, NO_UNRELEASED);
    assert.deepEqual(entries(read(root, 'CHANGELOG.md')), ['Shared', 'Old'], 'a refusal does not touch --out');
  } finally {
    cleanup(root);
  }
});

test('merge-changelog: the command reads the revisions from git and writes to --out, the report to stderr', () => {
  const root = makeProject();
  try {
    put(root, 'CHANGELOG.md', OURS);
    gitAll(root, 'ours');
    run(root, ['checkout', '-qb', 'worker']);
    put(root, 'CHANGELOG.md', THEIRS);
    gitAll(root, 'theirs');
    run(root, ['checkout', '-q', 'main']);

    const r = cli(root, ['merge-changelog', '--ours=main', '--theirs=worker', '--out=CHANGELOG.md']);
    assert.equal(r.code, 0, r.err);
    assert.match(read(root, 'CHANGELOG.md'), /- \*\*First theirs\*\* — body theirs/);
    assert.match(read(root, 'CHANGELOG.md'), /- \*\*First ours\*\* — body ours/);
    assert.match(r.err, ruRe(ENTRIES, { ours: 2, theirs: 2, merged: 3 }));
    assert.match(r.err, ruRe('only in theirs: {title}', { title: 'First theirs' }));
    assert.equal(r.out, '', 'with --out the data goes to the file, stdout is empty');
  } finally {
    cleanup(root);
  }
});

test('merge-changelog: a BOM CHANGELOG on both sides and on disk keeps exactly one BOM', () => {
  const root = makeProject();
  try {
    put(root, 'CHANGELOG.md', `﻿${OURS}`);
    gitAll(root, 'ours');
    run(root, ['checkout', '-qb', 'worker']);
    put(root, 'CHANGELOG.md', `﻿${THEIRS}`);
    gitAll(root, 'theirs');
    run(root, ['checkout', '-q', 'main']);

    for (let i = 0; i < 2; i += 1) {
      const r = cli(root, ['merge-changelog', '--ours=main', '--theirs=worker', '--out=CHANGELOG.md']);
      assert.equal(r.code, 0, r.err);
      const bytes = readFileSync(path.join(root, 'CHANGELOG.md'));
      assert.deepEqual([...bytes.subarray(0, 4)], [0xef, 0xbb, 0xbf, 0x23], `run ${i + 1}: one BOM, then "#"`);
    }
  } finally {
    cleanup(root);
  }
});

test('merge-changelog: a CHANGELOG.md over 1 MiB is read from git, not cut off by ENOBUFS', () => {
  const root = makeProject();
  try {
    const history = '- **Old entry** — a long history of released versions\n'.repeat(20_000);
    put(root, 'CHANGELOG.md', `${OURS}${history}`);
    gitAll(root, 'ours');
    run(root, ['checkout', '-qb', 'worker']);
    put(root, 'CHANGELOG.md', `${THEIRS}${history}`);
    gitAll(root, 'theirs');
    run(root, ['checkout', '-q', 'main']);
    assert.ok(Buffer.byteLength(read(root, 'CHANGELOG.md')) > 1 << 20, 'the file is larger than the default spawnSync buffer');

    const r = cli(root, ['merge-changelog', '--ours=main', '--theirs=worker', '--out=CHANGELOG.md']);
    assert.equal(r.code, 0, r.err);
    assert.match(read(root, 'CHANGELOG.md'), /- \*\*First theirs\*\* — body theirs/);
    assert.equal(read(root, 'CHANGELOG.md').split('- **Old entry**').length - 1, 20_000);
  } finally {
    cleanup(root);
  }
});

test('merge-changelog: --base is read by the command and removes an entry the side lost', () => {
  const root = makeProject();
  try {
    put(root, 'CHANGELOG.md', '# Changelog\n\n## Unreleased\n\n- **Shared** — body\n\n- **Removed** — body\n');
    gitAll(root, 'base');
    const base = run(root, ['rev-parse', 'HEAD']).stdout.trim();
    run(root, ['checkout', '-qb', 'worker']);
    put(root, 'CHANGELOG.md', '# Changelog\n\n## Unreleased\n\n- **Shared** — body\n\n- **Own at worker** — body\n');
    gitAll(root, 'worker removed Removed');
    run(root, ['checkout', '-q', 'main']);

    const r = cli(root, ['merge-changelog', `--ours=${base}`, '--theirs=worker', `--base=${base}`, '--out=CHANGELOG.md']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.err, ruRe(REMOVED, { title: 'Removed' }));
    assert.doesNotMatch(read(root, 'CHANGELOG.md'), /Removed/);
    assert.match(read(root, 'CHANGELOG.md'), /- \*\*Own at worker\*\*/);
  } finally {
    cleanup(root);
  }
});

test('merge-changelog: stdout routing without --out', () => {
  const root = makeProject();
  try {
    put(root, 'CHANGELOG.md', OURS);
    gitAll(root, 'ours');
    const r = cli(root, ['merge-changelog', '--ours=HEAD', '--theirs=HEAD']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /^# Changelog\n/);
    assert.doesNotMatch(r.out, ruHeadRe(ENTRIES), 'the report does not get into the data');
    assert.match(r.err, new RegExp(`^ {2}${ruHeadRe(ENTRIES).source}`, 'm'), 'the report is an unmarked stderr note');
  } finally {
    cleanup(root);
  }
});

test('merge-changelog: refusals — a missing --theirs, an unreadable ref', () => {
  const root = makeProject();
  try {
    put(root, 'CHANGELOG.md', OURS);
    gitAll(root, 'ours');
    const rows = [
      { argv: ['--ours=HEAD'], err: ruRe('both --ours <ref> and --theirs <ref> are required: two CHANGELOG.md revisions from git') },
      { argv: ['--ours=HEAD', '--theirs=no-such-branch'], err: ruRe(CANNOT_READ, { ref: 'no-such-branch', changelog: 'CHANGELOG.md' }) },
    ];
    for (const { argv, err } of rows) {
      const r = cli(root, ['merge-changelog', ...argv]);
      assert.equal(r.code, 1, argv.join(' '));
      assert.match(r.err, err);
    }
  } finally {
    cleanup(root);
  }
});

test('merge-changelog: git killed by a signal on a revision or on the tags — the refusal names the signal, not "code null"', { skip: process.platform === 'win32' }, () => {
  const root = makeProject();
  const shim = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-git-shim-')));
  try {
    put(root, 'CHANGELOG.md', OURS);
    gitAll(root, 'ours');
    const real = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
    const env = { PATH: `${shim}${path.delimiter}${process.env.PATH}` };
    for (const [arg, cause] of [['*:./CHANGELOG.md', ruRe(CANNOT_READ, { ref: 'HEAD', changelog: 'CHANGELOG.md', cause: KILLED })], ['tag', ruRe('cannot read the tag list — {cause}', { cause: KILLED })]]) {
      writeFileSync(path.join(shim, 'git'), `#!/bin/sh\nfor a in "$@"; do case "$a" in ${arg}) kill -9 $$;; esac; done\nexec "${real}" "$@"\n`, { mode: 0o755 });
      const r = cli(root, ['merge-changelog', '--ours=HEAD', '--theirs=HEAD'], { env });
      assert.equal(r.code, 1, r.out);
      assert.match(r.err, cause);
      assert.doesNotMatch(r.err, new RegExp(escapeRe(ru('exit code {status}', { status: null }))));
    }
  } finally {
    cleanup(root);
    rmSync(shim, { recursive: true, force: true });
  }
});

// A section with `### …`, a bullet without a bold heading and entries on both sides of it — the
// shape on which the merge duplicated a heading, invented a body divergence and reflowed the file.
const HEAD_OURS = `# Changelog

## Unreleased

### Added

- **Shared added** — body
- Bullet without a bold heading whose continuation
  runs indented.
- **Own at ours** — body ours

### Fixed

- **New at ours** — body ours
- **Old shared** — body
`;

const HEAD_THEIRS = `# Changelog

## Unreleased

### Added

- **Shared added** — body
- Bullet without a bold heading whose continuation
  runs indented.
- **Own at theirs** — body theirs

### Fixed

- **New at theirs** — body theirs
- **Old shared** — body
`;

// "−0 lines" of the card: the result is ours plus insertions only, i.e. every line of ours lies in
// it in the same order. A greedy pass is a correct subsequence check.
function insertionsOver(oursText, mergedText) {
  const ours = oursText.split('\n');
  const merged = mergedText.split('\n');
  let i = 0;
  for (const line of merged) if (i < ours.length && line === ours[i]) i += 1;
  assert.equal(i, ours.length, 'a line of ours vanished from the result');
  return merged.length - ours.length;
}

test('merge-changelog: a ### heading is an entry boundary, not its body', () => {
  const { text, report } = mergeChangelog(HEAD_OURS, HEAD_THEIRS);
  assert.deepEqual(report.conflicts, [], 'the entry bodies of the sides match — no divergence');
  assert.equal((text.match(/^### Added$/gm) ?? []).length, 1);
  assert.equal((text.match(/^### Fixed$/gm) ?? []).length, 1);
  assert.equal((text.match(/- \*\*Shared added\*\*/g) ?? []).length, 1);
  assert.equal((text.match(/^- Bullet without a bold heading/gm) ?? []).length, 1);
  // A bullet without a bold heading is a block of its own: it pulls neither itself nor the tail
  // of the section with its heading into the body of the neighbouring entry.
  assert.doesNotMatch(text, /- \*\*Shared added\*\* — body\n- Bullet[\s\S]*### Fixed[\s\S]*\n- \*\*Shared added\*\*/);
});

test('merge-changelog: an additive merge only adds lines and leaves the layout alone', () => {
  const { text } = mergeChangelog(HEAD_OURS, HEAD_THEIRS);
  const added = insertionsOver(HEAD_OURS, text);
  assert.equal(added, 3, 'two entries of theirs and one blank for them — and not a line more');
  const blanks = (s) => (s.match(/^$/gm) ?? []).length;
  assert.equal(blanks(text), blanks(HEAD_OURS) + 1, 'blank lines do not multiply');
});

test('merge-changelog: an entry’s position is kept — the new on top', () => {
  const { text } = mergeChangelog(HEAD_OURS, HEAD_THEIRS);
  const fixed = text.slice(text.indexOf('### Fixed'));
  // In theirs the entry stood first in its section — it stands first here too, above the entry
  // of ours that claims the same place: the side being merged in is the new one.
  assert.match(fixed, /### Fixed\n\n- \*\*New at theirs\*\* — body theirs\n- \*\*New at ours\*\* — body ours\n- \*\*Old shared\*\*/);
  // And the entry that stood after the shared bullet in theirs stays right after it.
  assert.match(text, /runs indented\.\n- \*\*Own at theirs\*\* — body theirs\n\n- \*\*Own at ours\*\* — body ours/);
});

test('merge-changelog: the self-check refuses and the file is not handed over', () => {
  // One bold subgroup on the two sides under different headings would stand twice in the result —
  // the merge refuses instead of handing over a file with a grown structure.
  const ours = '# Changelog\n\n## Unreleased\n\n### Added\n\n**For agents:**\n\n- **One** — ours\n';
  const theirs = '# Changelog\n\n## Unreleased\n\n### Fixed\n\n**For agents:**\n\n- **Two** — theirs\n';
  assert.throws(() => mergeChangelog(ours, theirs), new RegExp(`${ruHeadRe('the merge failed its own check and the file was not handed over: {fails}').source}.*${ruRe('heading “{title}” occurs {n} times in the section, at most {limit} on either side', { title: '**For agents:**', n: 2 }).source}`, 's'));
});

test('merge-changelog: an unclosed conflict mark — a non-zero exit code', () => {
  const root = makeProject();
  try {
    put(root, 'CHANGELOG.md', '# Changelog\n\n## Unreleased\n\n- **One** — revision ours\n');
    gitAll(root, 'ours');
    run(root, ['checkout', '-qb', 'worker']);
    put(root, 'CHANGELOG.md', '# Changelog\n\n## Unreleased\n\n- **One** — revision theirs\n');
    gitAll(root, 'theirs');
    run(root, ['checkout', '-q', 'main']);

    const r = cli(root, ['merge-changelog', '--ours=main', '--theirs=worker', '--out=CHANGELOG.md']);
    assert.equal(r.code, 1, 'an unclosed conflict is not a success');
    assert.match(r.err, ruRe(LEFT_MARKS, { marks: 1, mark: CONFLICT_MARK }));
    assert.match(read(root, 'CHANGELOG.md'), /<!-- backslop:conflict One -->/, 'the file is written all the same — to be sorted out');
  } finally {
    cleanup(root);
  }
});

test('merge-changelog: a mark line in the unreleased section of either side is refused', () => {
  // A mark line left in a revision is an open conflict: the second revision would vanish over it
  // as a duplicate, so the merge refuses with a reason.
  const marked = `# Changelog\n\n## Unreleased\n\n<!-- backslop:conflict One -->\n- **One** — revision ours\n\n- **One** — revision theirs\n`;
  assert.throws(() => mergeChangelog(marked, THEIRS), ruRe(UNRESOLVED, { side: '--ours', mark: CONFLICT_MARK }));
  assert.throws(() => mergeChangelog(OURS, marked), ruRe(UNRESOLVED, { side: '--theirs', mark: CONFLICT_MARK }));
});

test('merge-changelog: the mark name in prose is not a mark — code spans, an indented code block', () => {
  // A CHANGELOG that wrote about the mark carries its name; a mark is a line that opens with it
  // at column one, as `conflictEntry` writes it.
  const rows = [
    {
      name: 'a code span in a released section',
      entry: '',
      released: '\n## v0.1.0 — 2026-01-01\n\n- **Merge by the command** — leaves both revisions under the mark `<!-- backslop:conflict … -->`, when the bodies diverged\n',
    },
    { name: 'a code span in the merged section', entry: '- **Merge by the command** — both revisions under the mark `<!-- backslop:conflict … -->`\n', released: '' },
    { name: 'an indented code block in the merged section', entry: '- **Merge by the command** — sample output:\n\n      <!-- backslop:conflict One -->\n\n', released: '' },
  ];
  for (const { name, entry, released } of rows) {
    const ours = `# Changelog\n\n## Unreleased\n\n${entry}- **Own at ours** — body ours\n${released}`;
    const theirs = `# Changelog\n\n## Unreleased\n\n${entry}- **Own at theirs** — body theirs\n${released}`;
    const { text, report } = mergeChangelog(ours, theirs);
    assert.equal(report.marks, 0, name);
    assert.deepEqual(report.conflicts, [], name);
    assert.match(text, /- \*\*Own at theirs\*\* — body theirs/, name);
    assert.equal(insertionsOver(ours, text), 2, name);
  }
});

test('merge-changelog: the mark name in prose leaves the command exit code 0', () => {
  const root = makeProject();
  try {
    const released = '## v0.1.0 — 2026-01-01\n\n- **Merge** — both revisions under the mark `<!-- backslop:conflict … -->`\n';
    put(root, 'CHANGELOG.md', `# Changelog\n\n## Unreleased\n\n- **Own at ours** — body\n\n${released}`);
    gitAll(root, 'ours');
    run(root, ['checkout', '-qb', 'worker']);
    put(root, 'CHANGELOG.md', `# Changelog\n\n## Unreleased\n\n- **Own at theirs** — body\n\n${released}`);
    gitAll(root, 'theirs');
    run(root, ['checkout', '-q', 'main']);

    const r = cli(root, ['merge-changelog', '--ours=main', '--theirs=worker', '--out=CHANGELOG.md']);
    assert.equal(r.code, 0, r.err);
    assert.doesNotMatch(r.err, ruRe(UNRESOLVED));
    assert.doesNotMatch(r.err, ruRe(LEFT_MARKS));
  } finally {
    cleanup(root);
  }
});

test('merge-changelog: a repeated block in ours — the refusal names the repeat, not lost lines', () => {
  const ours = '# Changelog\n\n## Unreleased\n\n- Repeated bullet without a heading\n- Repeated bullet without a heading\n';
  assert.throws(() => mergeChangelog(ours, ours), (e) => {
    assert.match(e.message, ruRe('the ours side carries a repeated block and the second occurrence was dropped: {blocks}', { blocks: ru('“{name}”', { name: 'Repeated bullet without a heading' }) }));
    return true;
  });
});

test('merge-changelog: a one-sided bullet without a heading is named in the report on a line of its own', () => {
  const root = makeProject();
  try {
    put(root, 'CHANGELOG.md', '# Changelog\n\n## Unreleased\n\n- **Entry** — body\n- A bullet both sides have\n');
    gitAll(root, 'ours');
    run(root, ['checkout', '-qb', 'worker']);
    put(root, 'CHANGELOG.md', '# Changelog\n\n## Unreleased\n\n- **Entry** — body\n- A bullet both sides have\n- A neighbour track’s bullet that arrived alone\n');
    gitAll(root, 'theirs');
    run(root, ['checkout', '-q', 'main']);

    const r = cli(root, ['merge-changelog', '--ours=main', '--theirs=worker', '--out=CHANGELOG.md']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.err, ruRe('only in theirs, bullet with no bold heading: {what}', { what: 'A neighbour track’s bullet that arrived alone' }));
    // It is not in the entry count: an entry is identified by its heading, a bullet by its text.
    assert.match(r.err, ruRe(ENTRIES, { ours: 1, theirs: 1, merged: 1 }));
    assert.match(read(root, 'CHANGELOG.md'), /- A neighbour track’s bullet that arrived alone/);
  } finally {
    cleanup(root);
  }
});

test('merge-changelog: a dropped repeat is named in the report even when the refusal did not come', () => {
  const root = makeProject();
  try {
    // The base removes an entry, so the merge is not additive and the third invariant is silent.
    // The line of content vanishes all the same — the report has to say so, not a refusal.
    put(root, 'CHANGELOG.md', '# Changelog\n\n## Unreleased\n\n- **Shared** — body\n- **Removed** — body\n- A bullet that will repeat\n');
    gitAll(root, 'base');
    const base = run(root, ['rev-parse', 'HEAD']).stdout.trim();
    run(root, ['checkout', '-qb', 'worker']);
    put(root, 'CHANGELOG.md', '# Changelog\n\n## Unreleased\n\n- **Shared** — body\n- A bullet that will repeat\n');
    gitAll(root, 'worker removed Removed');
    run(root, ['checkout', '-q', 'main']);
    put(root, 'CHANGELOG.md', '# Changelog\n\n## Unreleased\n\n- **Shared** — body\n- **Removed** — body\n- A bullet that will repeat\n- A bullet that will repeat\n');
    gitAll(root, 'ours with a repeat');

    const r = cli(root, ['merge-changelog', '--ours=main', '--theirs=worker', `--base=${base}`, '--out=CHANGELOG.md']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.err, ruRe(REMOVED, { title: 'Removed' }));
    assert.match(r.err, ruRe('repeated block in ours, the second occurrence dropped: {what}', { what: 'A bullet that will repeat' }));
  } finally {
    cleanup(root);
  }
});

test('merge-changelog: a repeat in theirs is named too — in the shared seen it is indistinguishable from one that came from ours', () => {
  const root = makeProject();
  try {
    put(root, 'CHANGELOG.md', '# Changelog\n\n## Unreleased\n\n- **Shared** — body\n');
    gitAll(root, 'ours');
    run(root, ['checkout', '-qb', 'worker']);
    put(root, 'CHANGELOG.md', '# Changelog\n\n## Unreleased\n\n- **Shared** — body\n- The worker’s own bullet\n- The worker’s own bullet\n');
    gitAll(root, 'theirs with a repeat');
    run(root, ['checkout', '-q', 'main']);

    const r = cli(root, ['merge-changelog', '--ours=main', '--theirs=worker', '--out=CHANGELOG.md']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.err, ruRe('repeated block in theirs, the second occurrence dropped: {what}', { what: 'The worker’s own bullet' }));
    assert.equal((read(root, 'CHANGELOG.md').match(/- The worker’s own bullet/g) ?? []).length, 1);
  } finally {
    cleanup(root);
  }
});

const SECTIONED = (unreleased) => `# Changelog\n\n## Unreleased\n\n${unreleased}## v0.1.0\n\n- **Old** — released\n`;
const ADDED_FIXED = SECTIONED('### Added\n\n- **A1** — added\n\n### Fixed\n\n- **F1** — fixed\n\n');

test('merge-changelog: a theirs-only heading arrives with its subgroup between the ours headings', () => {
  const theirs = SECTIONED('### Added\n\n- **A1** — added\n\n### Changed\n\n**For workspace users:**\n\n- **C1** — changed\n\n### Fixed\n\n- **F1** — fixed\n\n');
  const { text, report } = mergeChangelog(ADDED_FIXED, theirs, null, 'en');
  assert.equal(text, theirs);
  assert.deepEqual(report.placed, [
    { heading: '### Changed', subgroup: null, before: '### Fixed' },
    { heading: '### Changed', subgroup: '**For workspace users:**' },
  ]);
});

test('merge-changelog: a theirs-only subgroup under a non-last ours heading stays under it', () => {
  const theirs = SECTIONED('### Added\n\n- **A1** — added\n\n**For agents:**\n\n- **A2** — added\n\n### Fixed\n\n- **F1** — fixed\n\n');
  const { text, report } = mergeChangelog(ADDED_FIXED, theirs, null, 'en');
  assert.equal(text, theirs);
  assert.deepEqual(report.placed, [{ heading: '### Added', subgroup: '**For agents:**' }]);
});

test('merge-changelog: a theirs-only heading with no preceding container goes to the end of the section', () => {
  const theirs = SECTIONED('### Security\n\n- **S1** — security\n\n### Added\n\n- **A1** — added\n\n### Fixed\n\n- **F1** — fixed\n\n');
  const { text, report } = mergeChangelog(ADDED_FIXED, theirs, null, 'en');
  assert.equal(text, SECTIONED('### Added\n\n- **A1** — added\n\n### Fixed\n\n- **F1** — fixed\n\n### Security\n\n- **S1** — security\n\n'));
  assert.deepEqual(report.placed, [{ heading: '### Security', subgroup: null, before: null }]);
});

test('merge-changelog: a heading theirs repeats and ours lacks is placed once, from its nearest instance', () => {
  const ours = SECTIONED('### Fixed\n\n- **F1** — fixed\n- **C0** — changed\n\n');
  const theirs = SECTIONED('### Changed\n\n- **C0** — changed\n\n### Fixed\n\n- **F1** — fixed\n\n### Changed\n\n- **C1** — changed\n\n');
  const { text, report } = mergeChangelog(ours, theirs, null, 'en');
  assert.equal(text, SECTIONED('### Fixed\n\n- **F1** — fixed\n- **C0** — changed\n\n### Changed\n\n- **C1** — changed\n\n'));
  assert.deepEqual(report.placed, [{ heading: '### Changed', subgroup: null, before: null }]);
});

test('merge-changelog: heading-less theirs content goes to the top group of the section', () => {
  const plain = SECTIONED('- **N1** — no heading\n\n### Added\n\n- **A1** — added\n\n### Fixed\n\n- **F1** — fixed\n\n');
  let merged = mergeChangelog(ADDED_FIXED, plain, null, 'en');
  assert.equal(merged.text, plain);
  assert.deepEqual(merged.report.placed, [{ heading: null, subgroup: null }]);

  const subgroup = SECTIONED('**For agents:**\n\n- **G1** — no heading\n\n### Added\n\n- **A1** — added\n\n### Fixed\n\n- **F1** — fixed\n\n');
  merged = mergeChangelog(ADDED_FIXED, subgroup, null, 'en');
  assert.equal(merged.text, subgroup, 'with no heading-less container in ours the subgroup opens the section');
  assert.deepEqual(merged.report.placed, [{ heading: null, subgroup: '**For agents:**' }]);

  const ours = SECTIONED('- **N1** — no heading\n\n### Added\n\n- **A1** — added\n\n');
  const theirs = SECTIONED('- **N1** — no heading\n\n**For agents:**\n\n- **G1** — no heading\n\n### Added\n\n- **A1** — added\n\n');
  assert.equal(mergeChangelog(ours, theirs, null, 'en').text, theirs, 'after the last heading-less container of ours');
});

test('merge-changelog: the command names each placement on stderr, in all four forms', () => {
  const root = makeProject();
  try {
    put(root, 'CHANGELOG.md', ADDED_FIXED);
    gitAll(root, 'ours');
    run(root, ['checkout', '-qb', 'worker']);
    put(root, 'CHANGELOG.md', SECTIONED('- **N1** — no heading\n\n### Security\n\n- **S1** — security\n\n### Added\n\n- **A1** — added\n\n### Changed\n\n**For workspace users:**\n\n- **C1** — changed\n\n### Fixed\n\n- **F1** — fixed\n\n'));
    gitAll(root, 'theirs');
    run(root, ['checkout', '-q', 'main']);
    run(root, ['checkout', '-qb', 'security']);
    put(root, 'CHANGELOG.md', SECTIONED('### Security\n\n- **S1** — security\n\n### Added\n\n- **A1** — added\n\n### Fixed\n\n- **F1** — fixed\n\n'));
    gitAll(root, 'theirs with a leading heading only');
    run(root, ['checkout', '-q', 'main']);

    let r = cli(root, ['merge-changelog', '--ours=main', '--theirs=worker', '--out=CHANGELOG.md']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.err, ruRe('entries without a heading added at the top of {section}', { section: '## Unreleased' }));
    // The theirs-only N1 is placed first, so it anchors ### Security, and not the section end.
    assert.match(r.err, ruRe('heading {heading} added before {before}', { heading: '### Security', before: '### Added' }));
    assert.match(r.err, ruRe('heading {heading} added before {before}', { heading: '### Changed', before: '### Fixed' }));
    assert.match(r.err, ruRe('subgroup {subgroup} added under {heading}', { subgroup: '**For workspace users:**', heading: '### Changed' }));
    assert.equal(read(root, 'CHANGELOG.md').match(/^### Changed$/gm)?.length, 1);

    r = cli(root, ['merge-changelog', '--ours=main', '--theirs=security']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.err, ruRe('heading {heading} added at the end of {section}', { heading: '### Security', section: '## Unreleased' }));
  } finally {
    cleanup(root);
  }
});

test('merge-changelog: an indented bold line stays in the entry body', () => {
  const entry = (tail) => SECTIONED(`- **A** — first line\n  **Note.**\n  ${tail}\n\n`);
  const same = mergeChangelog(entry('tail of A'), entry('tail of A'), null, 'en');
  assert.deepEqual(same.report.conflicts, []);
  assert.equal(same.text, entry('tail of A'));

  const diverged = mergeChangelog(entry('tail of A'), entry('tail of A CHANGED'), null, 'en');
  assert.deepEqual(diverged.report.conflicts, ['A'], 'a body divergence past the bold line is a conflict');
  assert.match(diverged.text, /tail of A CHANGED/);
});

test('merge-changelog: a diverging tail after an indented bold line is a conflict for the command', () => {
  const root = makeProject();
  try {
    put(root, 'CHANGELOG.md', SECTIONED('- **A** — first line\n  **Note:**\n  tail of A\n\n'));
    gitAll(root, 'base');
    const base = run(root, ['rev-parse', 'HEAD']).stdout.trim();
    run(root, ['checkout', '-qb', 'worker']);
    put(root, 'CHANGELOG.md', SECTIONED('- **A** — first line\n  **Note:**\n  tail of A\n  theirs-only tail\n\n'));
    gitAll(root, 'theirs');
    run(root, ['checkout', '-q', 'main']);

    const r = cli(root, ['merge-changelog', '--ours=main', '--theirs=worker', `--base=${base}`, '--out=CHANGELOG.md']);
    assert.equal(r.code, 1, r.err);
    assert.match(read(root, 'CHANGELOG.md'), /^<!-- backslop:conflict A -->$/m);
    assert.match(read(root, 'CHANGELOG.md'), /theirs-only tail/);
  } finally {
    cleanup(root);
  }
});

const CRLF = (text) => text.replace(/\n/g, '\r\n');
const onlyCrlf = (text) => text.includes('\r\n') && !/(^|[^\r])\n/.test(text);

test('merge-changelog: CRLF revisions give a CRLF result in --out and in stdout', () => {
  const root = makeProject();
  try {
    run(root, ['config', 'core.autocrlf', 'false']);
    put(root, 'CHANGELOG.md', CRLF(OURS));
    gitAll(root, 'ours');
    run(root, ['checkout', '-qb', 'worker']);
    put(root, 'CHANGELOG.md', CRLF(THEIRS));
    gitAll(root, 'theirs');
    run(root, ['checkout', '-q', 'main']);

    let r = cli(root, ['merge-changelog', '--ours=main', '--theirs=worker', '--out=merged.md']);
    assert.equal(r.code, 0, r.err);
    assert.ok(onlyCrlf(read(root, 'merged.md')), JSON.stringify(read(root, 'merged.md')));
    assert.match(read(root, 'merged.md'), /- \*\*First theirs\*\* — body theirs\r\n/);
    r = cli(root, ['merge-changelog', '--ours=main', '--theirs=worker']);
    assert.equal(r.code, 0, r.err);
    assert.ok(onlyCrlf(r.out), JSON.stringify(r.out));
  } finally {
    cleanup(root);
  }
});

test('merge-changelog: an existing --out file keeps its line endings over the ours revision', () => {
  const root = makeProject();
  try {
    put(root, 'CHANGELOG.md', OURS);
    gitAll(root, 'ours');
    run(root, ['checkout', '-qb', 'worker']);
    put(root, 'CHANGELOG.md', THEIRS);
    gitAll(root, 'theirs');
    run(root, ['checkout', '-q', 'main']);
    // core.autocrlf=true checks the LF blob out as CRLF, as on a Windows clone.
    run(root, ['config', 'core.autocrlf', 'true']);
    rmSync(path.join(root, 'CHANGELOG.md'));
    run(root, ['checkout', '--', 'CHANGELOG.md']);
    assert.ok(onlyCrlf(read(root, 'CHANGELOG.md')), 'the checkout is CRLF on disk');

    const r = cli(root, ['merge-changelog', '--ours=main', '--theirs=worker', '--out=CHANGELOG.md']);
    assert.equal(r.code, 0, r.err);
    assert.ok(onlyCrlf(read(root, 'CHANGELOG.md')), JSON.stringify(read(root, 'CHANGELOG.md')));
    assert.match(read(root, 'CHANGELOG.md'), /- \*\*First theirs\*\* — body theirs\r\n/);
  } finally {
    cleanup(root);
  }
});

test('merge-changelog: an empty or blank --base is refused with the usage text', () => {
  const root = makeProject();
  try {
    put(root, 'CHANGELOG.md', OURS);
    gitAll(root, 'ours');
    for (const args of [['--base='], ['--base', ''], ['--base=  ']]) {
      const r = cli(root, ['merge-changelog', '--ours=HEAD', '--theirs=HEAD', ...args]);
      assert.equal(r.code, 1, JSON.stringify(args));
      assert.match(r.err, ruRe('--base is empty: pass --base <ref>, the merge-base revision, or drop the flag'));
      assert.equal(r.out, '', 'nothing is merged');
    }
  } finally {
    cleanup(root);
  }
});

test('merge-changelog: --out creates missing directories, and an fs failure is one ✖ line', () => {
  const root = makeProject();
  try {
    put(root, 'CHANGELOG.md', OURS);
    gitAll(root, 'ours');
    let r = cli(root, ['merge-changelog', '--ours=HEAD', '--theirs=HEAD', '--out=missing/dir/x.md']);
    assert.equal(r.code, 0, r.err);
    assert.equal(read(root, 'missing/dir/x.md'), OURS);

    mkdirSync(path.join(root, 'outdir'));
    // A file where a directory should be: the code is the platform's, EEXIST on macOS.
    for (const [out, code] of [['outdir', 'EISDIR'], ['CHANGELOG.md/x.md', '(ENOTDIR|EEXIST)']]) {
      r = cli(root, ['merge-changelog', '--ours=HEAD', '--theirs=HEAD', `--out=${out}`]);
      assert.equal(r.code, 1, out);
      assert.equal(r.err.match(/✖/g)?.length, 1, r.err);
      assert.match(r.err, new RegExp(`${escapeRe(ru('cannot write --out {file}: {cause}', { file: path.join(root, out), cause: '\0' }).split('\0')[0])}${code}`));
      assert.doesNotMatch(r.err, /^\s+at /m, 'no stack');
    }
  } finally {
    cleanup(root);
  }
});

test('merge-changelog: a relative --out resolves against the cwd, and written: names it from the cwd', () => {
  const root = makeProject();
  try {
    put(root, 'CHANGELOG.md', OURS);
    gitAll(root, 'ours');
    mkdirSync(path.join(root, 'sub', 'dir'), { recursive: true });
    const r = cli(root, ['merge-changelog', '--ours=HEAD', '--theirs=HEAD', '--out=merged.md'], { cwd: path.join(root, 'sub', 'dir') });
    assert.equal(r.code, 0, r.err);
    assert.equal(read(root, 'sub/dir/merged.md'), OURS);
    assert.ok(!existsSync(path.join(root, 'merged.md')), 'nothing lands at the project root');
    assert.match(r.err, new RegExp(`${escapeRe(ru('written: {out}', { out: 'merged.md' }))}$`, 'm'));
  } finally {
    cleanup(root);
  }
});

// With no released section below, the file ends in the unreleased section, and the blank line at
// its end belongs to the last block: it must not travel into the middle of the result.
const ENDING_BLANK = (names) => `# Changelog

## Unreleased

${names.map((n) => `- **${n}** — body`).join('\n\n')}

`;

test('merge-changelog: a blank line ending the last section stays one gap when an entry lands after it', () => {
  const base = ENDING_BLANK(['Alpha']);
  const { text } = mergeChangelog(ENDING_BLANK(['Alpha', 'Gamma']), ENDING_BLANK(['Alpha', 'Beta']), base, 'en');
  assert.equal(text, ENDING_BLANK(['Alpha', 'Beta', 'Gamma']));
});

test('merge-changelog: a blank line ending the section of ours is kept when theirs adds nothing', () => {
  const ours = ENDING_BLANK(['Alpha', 'Gamma']);
  assert.equal(mergeChangelog(ours, ENDING_BLANK(['Alpha']), ENDING_BLANK(['Alpha']), 'en').text, ours);
});

// The same gap with sub-headings: the entry that carries the file's trailing blank line sits before
// another container, and one blank line is what separates it from the next heading.
const ENDING_GROUPS = (groups) => `# Changelog

## Unreleased

${groups.map(([heading, names]) => `${heading ? `### ${heading}\n\n` : ''}${names.map((n) => `- **${n}** — body`).join('\n\n')}\n\n`).join('')}`;

test('merge-changelog: the trailing blank line of ours stays one gap before a heading container of theirs', () => {
  const ours = ENDING_GROUPS([[null, ['Alpha']]]);
  const theirs = ENDING_GROUPS([[null, ['Alpha']], ['Fixed', ['Beta']]]);
  assert.equal(mergeChangelog(ours, theirs, ours, 'en').text, theirs);
});

test('merge-changelog: the trailing blank line of theirs stays one gap when its entry lands before a container of ours', () => {
  const ours = ENDING_GROUPS([['Added', ['Alpha']], ['Fixed', ['Gamma']]]);
  const theirs = ENDING_GROUPS([['Added', ['Alpha', 'Beta']]]);
  const base = ENDING_GROUPS([['Added', ['Alpha']]]);
  assert.equal(mergeChangelog(ours, theirs, base, 'en').text, ENDING_GROUPS([['Added', ['Alpha', 'Beta']], ['Fixed', ['Gamma']]]));
});

test('merge-changelog: the last entry of ours followed by an entry of theirs in one container keeps one gap', () => {
  const ours = ENDING_GROUPS([['Added', ['Alpha', 'Beta']]]);
  const theirs = ENDING_GROUPS([['Added', ['Beta', 'Gamma']]]);
  assert.equal(mergeChangelog(ours, theirs, ENDING_GROUPS([['Added', ['Beta']]]), 'en').text, ENDING_GROUPS([['Added', ['Alpha', 'Beta', 'Gamma']]]));
});

test('merge-changelog: an empty heading container after the last entry leaves one gap before its heading', () => {
  const ours = '# Changelog\n\n## Unreleased\n\n### Added\n\n- **Alpha** — body\n\n### Removed\n\n';
  const theirs = '# Changelog\n\n## Unreleased\n\n### Added\n\n- **Alpha** — body\n\n- **Beta** — body\n\n';
  const base = '# Changelog\n\n## Unreleased\n\n### Added\n\n- **Alpha** — body\n\n';
  assert.equal(mergeChangelog(ours, theirs, base, 'en').text,
    '# Changelog\n\n## Unreleased\n\n### Added\n\n- **Alpha** — body\n\n- **Beta** — body\n\n### Removed\n\n');
});

test('mergeChangelog: a ** inside a code span does not end the entry title', () => {
  const entry = (name) => `- **\`when\`: \`**/\` ${name}** — body ${name}\n`;
  const { report } = mergeChangelog(`# Changelog\n\n## Unreleased\n\n${entry('ours')}`, `# Changelog\n\n## Unreleased\n\n${entry('theirs')}`);
  assert.deepEqual([report.onlyOurs, report.onlyTheirs, report.conflicts], [['`when`: `**/` ours'], ['`when`: `**/` theirs'], []]);
});
