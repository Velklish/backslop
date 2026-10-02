// Moving to the archive as a real process: links are fixed across the repository's markdown,
// except foreign code; result.md appears as a stub; a repeat is refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { SECTION, cleanup, cli, escapeRe, gitAll, makeProject, put, read, ru, ruCard, ruOutcome, ruRe, ruResult, run } from './helpers.mjs';

// The slug of the context heading: what an incoming link with a fragment points at.
const ANCHOR = SECTION.context.toLowerCase();

function seed(root) {
  put(root, 'docs/backlog/active/BS-1-a.md', ruCard('BS-1', 'A', { area: '[Reference](../../reference/README.md)', taken: '2026-09-01' }, [
    ['context', 'Neighbour [BS-2](../queue/BS-2-b.md), archive [BS-3](../../archive/BS-3-c/task.md), code [x](../../../lib/x.js).'],
  ]));
  put(root, 'docs/backlog/queue/BS-2-b.md', `${ruCard('BS-2', 'B', { order: 10 })}\nSee [BS-1](../active/BS-1-a.md#${ANCHOR}).\n`);
  put(root, 'docs/archive/BS-3-c/task.md', '# BS-3 · C\n\nSee [BS-1](../../backlog/active/BS-1-a.md).\n');
  put(root, 'docs/archive/BS-3-c/result.md', ruResult('BS-3', '2026-08-01', 'Done.'));
  put(root, 'docs/reference/README.md', '# Reference\n\nTask [BS-1](../backlog/active/BS-1-a.md).\n');
  put(root, 'README.md', 'Read [BS-1](docs/backlog/active/BS-1-a.md)\n');
  put(root, 'CHANGELOG.md', '## Unreleased\n\n- **Closed** [BS-1](docs/backlog/active/BS-1-a.md)\n');
  put(root, 'node_modules/pkg/README.md', 'Foreign: [BS-1](../../docs/backlog/active/BS-1-a.md)\n');
  put(root, 'lib/x.js', '// code\n');
  gitAll(root);
}

test('archive: a move with outgoing and incoming links fixed, result.md as a stub', () => {
  const root = makeProject();
  try {
    seed(root);
    const statusBefore = run(root, ['status', '--short']).stdout;
    const dry = cli(root, ['archive', '1', '--dry-run']);
    assert.equal(dry.code, 0, dry.err);
    assert.ok(existsSync(path.join(root, 'docs/backlog/active/BS-1-a.md')), 'dry-run moves nothing');
    assert.ok(!existsSync(path.join(root, 'docs/archive/BS-1-a')));
    // A sorted list, not a count: it catches a lost path and an extra one. The touched-docs block
    // is cut off by its heading, else it would enter deepEqual once the seed commit is `BS-1: …`.
    const before = dry.out.split(ru('documentation touched by {id} — copy what belongs into “Documentation in the same pass”:', { id: 'BS-1' }))[0];
    const listed = before.split('\n').filter((l) => l.startsWith('    ')).map((l) => l.slice(4));
    assert.deepEqual(listed.sort(), [
      'CHANGELOG.md',
      'README.md',
      'docs/archive/BS-1-a/task.md',
      'docs/archive/BS-3-c/task.md',
      'docs/backlog/queue/BS-2-b.md',
      'docs/reference/README.md',
    ]);
    assert.match(dry.out, new RegExp(`^ {2}${ruRe('would update links in {changed} files', { changed: listed.length }).source}$`, 'm'));
    assert.doesNotMatch(dry.out, /^✔/m, 'a dry run prints no success line');
    assert.match(dry.out, new RegExp(`^ {2}${ruRe('--dry-run: nothing was written').source}$`, 'm'));
    assert.equal(run(root, ['status', '--short']).stdout, statusBefore, 'a dry run leaves the tree as it was');

    const r = cli(root, ['archive', 'BS-1']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /^ {4}docs\/backlog\/queue\/BS-2-b\.md$/m, 'the link list sits at column 4');
    assert.ok(!existsSync(path.join(root, 'docs/backlog/active/BS-1-a.md')));
    const task = read(root, 'docs/archive/BS-1-a/task.md');
    assert.match(task, /\(\.\.\/\.\.\/reference\/README\.md\)/);
    assert.match(task, /\(\.\.\/\.\.\/backlog\/queue\/BS-2-b\.md\)/);
    assert.match(task, /\(\.\.\/BS-3-c\/task\.md\)/);
    assert.match(task, /\(\.\.\/\.\.\/\.\.\/lib\/x\.js\)/);
    assert.match(read(root, 'docs/backlog/queue/BS-2-b.md'), new RegExp(`\\(\\.\\./\\.\\./archive/BS-1-a/task\\.md#${ANCHOR}\\)`));
    assert.match(read(root, 'docs/archive/BS-3-c/task.md'), /\(\.\.\/BS-1-a\/task\.md\)/);
    assert.match(read(root, 'docs/reference/README.md'), /\(\.\.\/archive\/BS-1-a\/task\.md\)/);
    assert.match(read(root, 'README.md'), /\(docs\/archive\/BS-1-a\/task\.md\)/);
    assert.match(read(root, 'CHANGELOG.md'), /\(docs\/archive\/BS-1-a\/task\.md\)/);
    assert.match(read(root, 'node_modules/pkg/README.md'), /backlog\/active\/BS-1-a\.md/, 'foreign code is not touched');
    const result = read(root, 'docs/archive/BS-1-a/result.md');
    assert.match(result, new RegExp(`^${escapeRe(ruResult('BS-1', 'DATE')).trimEnd().replace('DATE', '\\d{4}-\\d{2}-\\d{2}')}`));
    assert.match(result, /BS-N/);

    const again = cli(root, ['archive', '1']);
    assert.equal(again.code, 1);
    assert.match(again.err, ruRe('{id} is already archived: {rel} — fold it into a journal line with {cli} fold {id}', { id: 'BS-1' }));
    const missing = cli(root, ['archive', '42']);
    assert.equal(missing.code, 1);
    assert.match(missing.err, ruRe('task {id} was not found in any status directory', { id: 'BS-42' }));
  } finally {
    cleanup(root);
  }
});

test('archive: a finding with a sub-ID moves into a directory with a dot in the number', () => {
  const root = makeProject();
  try {
    put(root, 'docs/backlog/queue/BS-4-d.md', ruCard('BS-4', 'D', { order: 10 }));
    put(root, 'docs/backlog/triage/BS-4.2-e.md', '# BS-4.2 · E\n\nParent [BS-4](../queue/BS-4-d.md).\n');
    gitAll(root);
    const r = cli(root, ['archive', '4.2']);
    assert.equal(r.code, 0, r.err);
    assert.match(read(root, 'docs/archive/BS-4.2-e/task.md'), /\(\.\.\/\.\.\/backlog\/queue\/BS-4-d\.md\)/);
    assert.ok(existsSync(path.join(root, 'docs/archive/BS-4.2-e/result.md')));
  } finally {
    cleanup(root);
  }
});

test('archive: a file from the flat docs/backlog/ moves, with outgoing and incoming links rewritten', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Reference\n');
    cli(root, ['new', 'a', '--queue']);
    put(root, 'docs/backlog/queue/BS-1-a.md', ruCard('BS-1', 'a', { order: 10, area: '[x](../../reference/README.md)' }));
    put(root, 'docs/backlog/BS-5-flat.md', `${ruCard('BS-5', 'Flat', { area: '[x](../reference/README.md)' })}\nSee [BS-1](queue/BS-1-a.md) and [the archive](../archive/README.md).\n`);
    put(root, 'ROADMAP.md', '# Roadmap\n\n[BS-5](docs/backlog/BS-5-flat.md)\n');
    gitAll(root);

    const r = cli(root, ['archive', '5']);
    assert.equal(r.code, 0, r.err);
    assert.ok(!existsSync(path.join(root, 'docs/backlog/BS-5-flat.md')));
    const archived = read(root, 'docs/archive/BS-5-flat/task.md');
    assert.match(archived, /\(\.\.\/\.\.\/reference\/README\.md\)/);
    assert.match(archived, /\(\.\.\/\.\.\/backlog\/queue\/BS-1-a\.md\)/);
    assert.match(archived, /\[the archive\]\(\.\.\/README\.md\)/);
    assert.match(read(root, 'ROADMAP.md'), /\(docs\/archive\/BS-5-flat\/task\.md\)/);
    assert.ok(existsSync(path.join(root, 'docs/archive/BS-5-flat/result.md')));
    put(root, 'docs/archive/BS-5-flat/result.md', ruResult('BS-5', '2026-09-06', `${ruOutcome('completed')}: moved over.`));
    const lint = cli(root, ['lint']);
    assert.equal(lint.code, 0, lint.err);
  } finally {
    cleanup(root);
  }
});

// The branches of moveFile (lib/tasks.js) are indistinguishable by exit code; the trace in the
// index tells them apart — a rename for `git mv`, a deletion and an untracked file for renameSync.
test('archive: a file in the git index moves through git mv, not by rename', () => {
  const root = makeProject();
  try {
    put(root, 'docs/backlog/active/BS-1-a.md', ruCard('BS-1', 'A', { taken: '2026-09-01' }, [['context', 'text']]));
    gitAll(root);
    assert.equal(run(root, ['status', '--porcelain']).stdout, '', 'the snapshot is clean — the move will be seen alone');
    const r = cli(root, ['archive', '1']);
    assert.equal(r.code, 0, r.err);
    assert.match(
      run(root, ['status', '--porcelain']).stdout,
      /^R.? +docs\/backlog\/active\/BS-1-a\.md -> docs\/archive\/BS-1-a\/task\.md$/m,
    );
    assert.equal(r.err, '', 'a file in the index — no warning about the fallback to renameSync');
  } finally {
    cleanup(root);
  }
});

test('archive: a file outside the git index moves by rename and warns, with or without a repository', () => {
  // A repository, but the file is not in the index: `moveFile` branches on whether the file is
  // tracked, not on a repository being there, and that is common — a task created, not committed.
  for (const { label, git, assertNoRenameInIndex } of [
    { label: 'untracked file in a repo', git: true, assertNoRenameInIndex: true },
    { label: 'no git repository', git: false, assertNoRenameInIndex: false },
  ]) {
    const root = makeProject({ git });
    try {
      put(root, 'docs/backlog/active/BS-1-a.md', ruCard('BS-1', 'A', { taken: '2026-09-01' }, [['context', 'text']]));
      const r = cli(root, ['archive', '1']);
      assert.equal(r.code, 0, `${label}: ${r.err}`);
      assert.match(r.err, ruRe('file is not tracked by git — moved without git mv'), label);
      if (assertNoRenameInIndex) {
        assert.equal(run(root, ['status', '--porcelain']).stdout.match(/^R/m), null, `${label}: no rename in the index`);
      }
      assert.ok(existsSync(path.join(root, 'docs/archive/BS-1-a/task.md')), label);
    } finally {
      cleanup(root);
    }
  }
});

test('archive: a root incoming link to a moved file is rewritten and stays a root link', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Reference\n');
    put(root, 'docs/backlog/active/BS-3-gamma.md', ruCard('BS-3', 'Gamma', { area: '[x](../../reference/README.md)', taken: '2026-09-01' }));
    put(root, 'docs/ROADMAP.md', '# Roadmap\n\nRoot: [BS-3](/docs/backlog/active/BS-3-gamma.md#summary), path: [gamma](backlog/active/BS-3-gamma.md).\n');
    gitAll(root);
    const r = cli(root, ['archive', '3']);
    assert.equal(r.code, 0, r.err);
    assert.equal(read(root, 'docs/ROADMAP.md'), '# Roadmap\n\nRoot: [BS-3](/docs/archive/BS-3-gamma/task.md#summary), path: [gamma](archive/BS-3-gamma/task.md).\n');
    assert.doesNotMatch(cli(root, ['lint']).err, ruRe('broken link {href} (line {line})'));
  } finally {
    cleanup(root);
  }
});

test('archive: a card linking to itself points at task.md after the move', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Reference\n');
    put(root, 'docs/backlog/active/BS-3-gamma.md', `${ruCard('BS-3', 'Gamma', { area: '[x](../../reference/README.md)', taken: '2026-09-01' })}\n`
      + '## Context\n\nSee [self](BS-3-gamma.md#context), [query](./BS-3-gamma.md?plain=1) and [root](/docs/backlog/active/BS-3-gamma.md).\n');
    gitAll(root);
    const r = cli(root, ['archive', '3']);
    assert.equal(r.code, 0, r.err);
    assert.match(read(root, 'docs/archive/BS-3-gamma/task.md'),
      /See \[self\]\(task\.md#context\), \[query\]\(task\.md\?plain=1\) and \[root\]\(\/docs\/archive\/BS-3-gamma\/task\.md\)\./);
    put(root, 'docs/archive/BS-3-gamma/result.md', ruResult('BS-3', '2026-09-02', `${ruOutcome('completed')}.`));
    const lint = cli(root, ['lint']);
    assert.equal(lint.code, 0, lint.err);
  } finally {
    cleanup(root);
  }
});

test('archive: a --range without .. is refused before the move, and the range form still works', () => {
  const root = makeProject();
  try {
    put(root, 'docs/backlog/active/BS-1-a.md', ruCard('BS-1', 'A', { area: '[x](../../README.md)', taken: '2026-09-01' }));
    gitAll(root, 'task');
    put(root, 'docs/reference/old.md', '# old\n');
    gitAll(root, 'old');
    put(root, 'docs/reference/new.md', '# new\n');
    gitAll(root, 'new');
    const r = cli(root, ['archive', '1', '--range', 'HEAD~1']);
    assert.equal(r.code, 1, r.err);
    assert.match(r.err, ruRe('--range {range}: expects a range <base>..HEAD — a single revision reads the whole history up to it', { range: 'HEAD~1' }));
    assert.ok(existsSync(path.join(root, 'docs/backlog/active/BS-1-a.md')), 'the task stays in place');
    const ok = cli(root, ['archive', '1', '--range', 'HEAD~1..HEAD', '--dry-run']);
    assert.equal(ok.code, 0, ok.err);
    assert.match(ok.out + ok.err, /docs\/reference\/new\.md/);
    assert.doesNotMatch(ok.out + ok.err, /docs\/reference\/old\.md/);
  } finally {
    cleanup(root);
  }
});

test('archive: the result stub names the gates command through the project cli', () => {
  for (const lang of ['ru', 'en']) {
    const root = makeProject();
    try {
      seed(root);
      const cfg = { ...JSON.parse(read(root, 'backslop.json')), lang, cli: 'npx backslop@1.2.3' };
      put(root, 'backslop.json', `${JSON.stringify(cfg, null, 2)}\n`);
      const r = cli(root, ['archive', '1']);
      assert.equal(r.code, 0, `${lang}: ${r.err}`);
      const result = read(root, 'docs/archive/BS-1-a/result.md');
      assert.ok(result.includes('`npx backslop@1.2.3 gates`'), `${lang}: result.md names the project cli`);
      assert.ok(!result.includes('`backslop gates`'), `${lang}: no bare backslop command`);
    } finally {
      cleanup(root);
    }
  }
});

test('archive: incoming HTML, badge destinations and contained definitions move with the task', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Reference\n');
    put(root, 'docs/backlog/active/BS-1-alpha.md', ruCard('BS-1', 'Alpha', { taken: '2026-09-01' }, [['context', 'text']]));
    put(root, 'ROADMAP.md', [
      '# Roadmap',
      '',
      `<a href='docs/backlog/active/BS-1-alpha.md#${ANCHOR}'>alpha</a>`,
      `[![inner](docs/backlog/active/BS-1-alpha.md#${ANCHOR})](docs/backlog/active/BS-1-alpha.md#${ANCHOR})`,
      'See [quoted][q] and [listed][l].',
      '',
      `> [q]: docs/backlog/active/BS-1-alpha.md#${ANCHOR}`,
      `- [l]: docs/backlog/active/BS-1-alpha.md#${ANCHOR}`,
      '',
    ].join('\n'));
    gitAll(root);

    const r = cli(root, ['archive', '1']);
    assert.equal(r.code, 0, r.err);
    assert.equal(read(root, 'ROADMAP.md'), [
      '# Roadmap',
      '',
      `<a href='docs/archive/BS-1-alpha/task.md#${ANCHOR}'>alpha</a>`,
      `[![inner](docs/archive/BS-1-alpha/task.md#${ANCHOR})](docs/archive/BS-1-alpha/task.md#${ANCHOR})`,
      'See [quoted][q] and [listed][l].',
      '',
      `> [q]: docs/archive/BS-1-alpha/task.md#${ANCHOR}`,
      `- [l]: docs/archive/BS-1-alpha/task.md#${ANCHOR}`,
      '',
    ].join('\n'));
    put(root, 'docs/archive/BS-1-alpha/result.md', ruResult('BS-1', '2026-09-03', `${ruOutcome('completed')}. Summary.`));
    const lint = cli(root, ['lint']);
    assert.equal(lint.code, 0, lint.err);
  } finally {
    cleanup(root);
  }
});
