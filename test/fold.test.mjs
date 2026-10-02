// Folding into a journal line by a real process: the directory goes, the body goes to the draft,
// links go to the line anchor. A hybrid is checked too — folded entries beside unfolded ones.
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ANY, KILLED, SECTION, cleanup, cli, escapeRe, gitAll, makeProject, put, read, resultTemplateParagraphs, ru, ruCard, ruExpand, ruHeadRe, ruOutcome, ruOutcomeWord, ruRe, ruResult, ruResultHeading, run } from './helpers.mjs';
import { TOOL_VERSION } from '../lib/version.js';
import { outcomeWordMissing } from '../lib/log.js';
import { git, gitCause, today } from '../lib/util.js';

const REF_AREA = '[x](../../reference/README.md)';
const ANCHOR = SECTION.context.toLowerCase();
const RESULT_BODY = 'One-line summary.';
const SUMMARY = 'folded tasks {entries}, lines appended to {log} {lines}, files with updated links {changed}, links into the folded left unrewritten {missed}';
const KEPT = 'the commit message draft is on stdout; committing it is optional: the body is already in history — the revision is recorded in the journal line, and {cli} show {id} reads it from there. A squash or reset --soft across that revision drops it, and then without the draft the task body is lost. {note}';
const LOST_ONE = 'the commit message draft is on stdout: commit the fold together with it, otherwise the task body is lost. {note}';
const LOST_MANY = 'the commit message draft is on stdout and carries the bodies of tasks that are not in history: commit the fold together with it, otherwise those bodies are lost. {note}';
const LOST = new RegExp(`${ruRe(LOST_ONE).source}|${ruRe(LOST_MANY).source}`);
const BODY_GONE = '{dirRel}: the body is not in git history — the text goes with the directory; {cli} fold --embed-missing would have kept it in the commit message draft';
const NO_BODY_FILE = 'no body file in {rev} — printing the commit message: the fold draft keeps the body there, and this task\'s sections are taken from it';
const BODY_HEAD = '{id}: the body does not open with “# {id} · …” — the message holds no body, or git\'s cleanup (commit.cleanup=strip) took its headings; printed as found';
const ALREADY_FOLDED = '{id} is already folded into the journal: {rel}';
const NO_REPO = new RegExp(escapeRe(ru('no git repository — the body of a folded task can only be read from history').split(' — ')[0]));
const NOT_COMMITTED = '{dirRel}: the directory is not committed ({detail}) — history holds a different revision, and the recorded revision would promise text it does not contain. Commit the directory and retry, or fold this task alone: {cli} fold {id}';
const UNSAVED = '{dirRel}: attachments are not saved in git history, and folding would delete them with the directory: {unsaved}. Move the files out of the directory and link them from result.md, then fold again';
const unsavedRe = (file) => ruRe(UNSAVED, { unsaved: `${ANY}${file}${ANY}` });
const KEY_DIFFERS = '{detail}: the file differs from its revision {at} — the recorded revision would promise text it does not contain. {fix}, or fold this task alone: {cli} fold {id}';
const differsRe = (file) => new RegExp(`${escapeRe(ru(KEY_DIFFERS, { detail: file, at: '\0' }).split('\0')[0])}[0-9a-f]{10}`);
const DIFFERS_ANY = new RegExp(escapeRe(ru(KEY_DIFFERS, { detail: '\0', at: '\0' }).split('\0')[1]));
const KEY_HASH = '{detail}: the directory files cannot be checked against revision {at} — git hash-object: {cause}. Deleting the directory without checking the body against history has no backing: restore the files in the working tree and retry, or fold this task alone: {cli} fold {id}';
const HASH_PARTS = ru(KEY_HASH, { detail: 'docs/archive/BS-1-alpha', at: '\0', cause: '\0' }).split('\0');
const HASH_OBJECT_FAILED = new RegExp(`${escapeRe(HASH_PARTS[0])}[0-9a-f]{10}${escapeRe(HASH_PARTS[1])}.*notes\\.txt`);
const AREA_STUB = ru('[TODO: section]({reference})', { reference: '' }).slice(0, -2);
const BROKEN = ruHeadRe('broken link {href} (line {line})').source;
const taken = (id, source) => ru('{blockerId} is taken: {source}', { blockerId: id, source });
const activeAlpha = () => ruCard('BS-1', 'Alpha', { area: REF_AREA, taken: '2026-09-01' }, [['context', 'task text']]);
const completed = (summary) => `${ruOutcome('completed')}. ${summary}`;

// A closed task in the archive: a directory with the definition and a written result,
// plus a neighbour’s link to it.
function closed(root, { id = 'BS-1', slug = 'alpha', title = 'Alpha', date = '2026-09-03', outcome = `${ruOutcome('completed')}.` } = {}) {
  put(root, `docs/archive/${id}-${slug}/task.md`, ruCard(id, title, { area: REF_AREA }, [['context', 'task text']]));
  put(root, `docs/archive/${id}-${slug}/result.md`, ruResult(id, date, `${outcome} ${RESULT_BODY}`));
}

function logLines(root) {
  return read(root, 'docs/archive/LOG.md').split('\n').filter((l) => l.startsWith('- <a id='));
}

test('fold N: the directory goes, the journal line is in place, the neighbour’s link leads to the anchor', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Reference\n');
    closed(root);
    put(root, 'docs/ROADMAP.md', `# Roadmap\n\nSee [BS-1](archive/BS-1-alpha/task.md#${ANCHOR}) and [summary](archive/BS-1-alpha/result.md).\n`);
    put(root, 'README.md', 'Root: [BS-1](docs/archive/BS-1-alpha/task.md)\n');
    gitAll(root);

    const r = cli(root, ['fold', '1']);
    assert.equal(r.code, 0, r.err);
    assert.ok(!existsSync(path.join(root, 'docs/archive/BS-1-alpha')), 'the task directory is gone');

    assert.equal(logLines(root).length, 1);
    assert.match(logLines(root)[0], new RegExp(`^- <a id="bs-1"><\\/a>\`BS-1-alpha\` · 2026-09-03 · ${ruOutcomeWord('completed')} · \`[0-9a-f]{10}\` · Alpha$`));

    // The anchor of the vanished file is replaced whole: `#<heading>` means nothing in the journal.
    assert.match(read(root, 'docs/ROADMAP.md'), /\[BS-1\]\(archive\/LOG\.md#bs-1\)/);
    assert.match(read(root, 'docs/ROADMAP.md'), /\[summary\]\(archive\/LOG\.md#bs-1\)/);
    assert.match(read(root, 'README.md'), /\(docs\/archive\/LOG\.md#bs-1\)/);

    // The draft is whole on stdout, the diagnostics on stderr: `fold N | git commit -F -` must
    // get a message without the report lines.
    assert.match(r.out, /^BS-1: Alpha\n/);
    assert.match(r.out, /--- docs\/archive\/BS-1-alpha\/task\.md ---/);
    assert.match(r.out, /--- docs\/archive\/BS-1-alpha\/result\.md ---/);
    assert.match(r.out, /task text/);
    assert.match(r.out, /One-line summary/);
    assert.doesNotMatch(r.out, ruHeadRe(SUMMARY));
    assert.match(r.err, ruRe(SUMMARY, { entries: 1 }));
    assert.doesNotMatch(r.err, /⚠/, 'a successful fold is a report, not a warning');
    assert.match(r.err, /^ {4}docs\/ROADMAP\.md$/m);
  } finally {
    cleanup(root);
  }
});

test('fold N: a rooted link and a directory with a slash lead to the anchor, a link past the body is named in the summary', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Reference\n');
    closed(root);
    put(root, 'docs/archive/BS-1-alpha/notes.md', '# Notes\n');
    put(root, 'docs/ROADMAP.md', `# Roadmap\n\nRoot: [BS-1](/docs/archive/BS-1-alpha/task.md#${ANCHOR}), directory: [alpha](archive/BS-1-alpha/), notes: [n](archive/BS-1-alpha/notes.md).\n`);
    gitAll(root);

    const r = cli(root, ['fold', '1']);
    assert.equal(r.code, 0, r.err);
    const roadmap = read(root, 'docs/ROADMAP.md');
    assert.match(roadmap, /\[BS-1\]\(\/docs\/archive\/LOG\.md#bs-1\)/, 'the rooted link stayed rooted');
    assert.match(roadmap, /\[alpha\]\(archive\/LOG\.md#bs-1\)/);
    assert.match(r.err, new RegExp(`${ruRe(SUMMARY, { changed: 1, missed: 1 }).source}\\n`));
    assert.match(r.err, ruRe('these links lead into a folded directory past task.md, result.md and batch entries — there is nothing to point them at; fix them by hand'));
    assert.match(r.err, / {2}docs\/ROADMAP\.md: archive\/BS-1-alpha\/notes\.md\n/);

    // The named link is the only broken one: gate 1 sees it, the rewritten ones it does not.
    const lint = cli(root, ['lint']);
    assert.match(lint.err, new RegExp(`${BROKEN}archive\\/BS-1-alpha\\/notes\\.md`));
    assert.doesNotMatch(lint.err, new RegExp(`${BROKEN}\\/docs\\/archive\\/BS-1-alpha|${BROKEN}archive\\/BS-1-alpha\\/[\\s)]`));
  } finally {
    cleanup(root);
  }
});

test('fold N: HTML, badge destinations and contained definitions point at the journal line', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Reference\n');
    closed(root);
    put(root, 'ROADMAP.md', [
      '# Roadmap',
      '',
      `<a href="docs/archive/BS-1-alpha/task.md#${ANCHOR}">alpha</a>`,
      `[![inner](docs/archive/BS-1-alpha/task.md#${ANCHOR})](docs/archive/BS-1-alpha/task.md#${ANCHOR})`,
      'See [quoted][q] and [listed][l].',
      '',
      `> [q]: docs/archive/BS-1-alpha/task.md#${ANCHOR}`,
      `- [l]: docs/archive/BS-1-alpha/task.md#${ANCHOR}`,
      '',
    ].join('\n'));
    gitAll(root);

    const r = cli(root, ['fold', '1']);
    assert.equal(r.code, 0, r.err);
    assert.equal(read(root, 'ROADMAP.md'), [
      '# Roadmap',
      '',
      '<a href="docs/archive/LOG.md#bs-1">alpha</a>',
      '[![inner](docs/archive/LOG.md#bs-1)](docs/archive/LOG.md#bs-1)',
      'See [quoted][q] and [listed][l].',
      '',
      '> [q]: docs/archive/LOG.md#bs-1',
      '- [l]: docs/archive/LOG.md#bs-1',
      '',
    ].join('\n'));
    const lint = cli(root, ['lint']);
    assert.equal(lint.code, 0, lint.err);
  } finally {
    cleanup(root);
  }
});

test('fold N: a body with a revision — the draft is optional, show N finds the body; without a revision — it is required', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Reference\n');
    closed(root);
    gitAll(root);
    const kept = cli(root, ['fold', '1']);
    assert.equal(kept.code, 0, kept.err);
    assert.match(logLines(root)[0], / · `[0-9a-f]{10}` · Alpha$/, 'the fixture gives exactly a line with a revision');
    assert.match(kept.err, ruRe(KEPT));
    assert.match(kept.err, ruRe(KEPT, { id: 'BS-1' }));
    assert.doesNotMatch(kept.err, ruRe(LOST_ONE));
    // The draft intro says the same as stderr: with a revision the draft is a copy.
    assert.match(kept.out, new RegExp(`^${ruRe('Folded into the {anchor} line. The task body is below as a copy: the journal line names revision {rev}, and {cli} show {id} reads it from there.', { anchor: 'docs/archive/LOG.md#bs-1', id: 'BS-1' }).source}$`, 'm'));
    assert.doesNotMatch(kept.out, ruRe('Folded into the {anchor} line. The task body is below: it is no longer in the tree, and this message is its only storage.'));
    // The card’s measurement: the fold is committed without the draft, and the body is still found.
    gitAll(root, 'a fold without the draft');
    const shown = cli(root, ['show', '1']);
    assert.equal(shown.code, 0, shown.err);
    assert.match(shown.out, /task text/);
    assert.match(shown.out, /One-line summary/);

    // The acceptance move: archive N and result.md without a commit — no revision,
    // the draft is the only storage.
    put(root, 'docs/backlog/active/BS-2-beta.md', ruCard('BS-2', 'Beta', { area: REF_AREA, taken: '2026-09-01' }, [['context', 'beta text']]));
    gitAll(root, 'beta taken');
    assert.equal(cli(root, ['archive', '2']).code, 0);
    put(root, 'docs/archive/BS-2-beta/result.md', ruResult('BS-2', '2026-09-04', completed('Beta summary.')));
    const draftOnly = cli(root, ['fold', '2']);
    assert.equal(draftOnly.code, 0, draftOnly.err);
    assert.match(logLines(root)[1], / · — · Beta$/, 'the fixture gives exactly a line without a revision');
    assert.match(draftOnly.err, ruRe(LOST_ONE));
    assert.doesNotMatch(draftOnly.err, ruRe(KEPT));
    assert.match(draftOnly.out, new RegExp(`^${ruRe('Folded into the {anchor} line. The task body is below: it is no longer in the tree, and this message is its only storage.', { anchor: 'docs/archive/LOG.md#bs-2' }).source}$`, 'm'));
  } finally {
    cleanup(root);
  }
});

test('fold N: refusals — an empty result.md, a task outside the archive, an already folded task', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Reference\n');
    closed(root);
    put(root, 'docs/backlog/queue/BS-2-live.md', ruCard('BS-2', 'Live', { order: 10 }));
    gitAll(root);

    put(root, 'docs/archive/BS-1-alpha/result.md', '');
    let r = cli(root, ['fold', '1']);
    assert.equal(r.code, 1);
    assert.match(r.err, ruRe('{dirRel}/result.md is empty: folding carries the body into git, and an empty result goes with it'));
    assert.ok(existsSync(path.join(root, 'docs/archive/BS-1-alpha')), 'the refusal does not touch the directory');
    assert.ok(!existsSync(path.join(root, 'docs/archive/LOG.md')), 'the refusal does not create the journal');

    r = cli(root, ['fold', '2']);
    assert.equal(r.code, 1);
    assert.match(r.err, ruRe('{id} sits in {status}/ — folding closes an archived task: run {cli} archive {id} first', { status: 'queue' }));

    r = cli(root, ['fold', '42']);
    assert.equal(r.code, 1);
    assert.match(r.err, ruRe('task {id} was not found in any status directory or the archive'));

    closed(root);
    assert.equal(cli(root, ['fold', '1']).code, 0);
    r = cli(root, ['fold', '1']);
    assert.equal(r.code, 1);
    assert.match(r.err, ruRe(ALREADY_FOLDED));
  } finally {
    cleanup(root);
  }
});

test('fold N: a result.md without an outcome word — a refusal before any write, with the same text as gate 5; the bulk form reads a bare "Closed"', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Reference\n');
    put(root, 'docs/backlog/active/BS-1-alpha.md', activeAlpha());
    gitAll(root, 'alpha taken');
    assert.equal(cli(root, ['archive', '1']).code, 0);
    put(root, 'docs/archive/BS-1-alpha/result.md', ruResult('BS-1', '2026-09-24', ruExpand('{Refusal}: moot.')));
    const r = cli(root, ['fold', '1']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, new RegExp(escapeRe(`docs/archive/BS-1-alpha/${outcomeWordMissing('BS')}`)));
    assert.equal(r.out, '', 'no draft');
    assert.ok(existsSync(path.join(root, 'docs/archive/BS-1-alpha/task.md')), 'the directory is in place');
    assert.ok(!existsSync(path.join(root, 'docs/archive/LOG.md')), 'no line in the journal');
    const lint = cli(root, ['lint']);
    assert.match(lint.err, new RegExp(escapeRe(`docs/archive/BS-1-alpha: ${outcomeWordMissing('BS')}`)), 'gate 5 says the same');

    // The bulk fold still reads an old entry by the fallback.
    gitAll(root, 'alpha closed');
    const bulk = cli(root, ['fold']);
    assert.equal(bulk.code, 0, bulk.err);
    assert.match(logLines(root)[0], new RegExp(`^- <a id="bs-1"><\\/a>\`BS-1-alpha\` · 2026-09-24 · ${ruOutcomeWord('completed')} · `));
  } finally {
    cleanup(root);
  }
});

test('fold N: a result.md template stub refuses as a paragraph, one shown in code does not', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Reference\n');
    closed(root);
    gitAll(root);
    for (const lang of ['ru', 'en']) {
      for (const p of resultTemplateParagraphs(lang, { id: 'BS-1', date: '2026-09-03' })) {
        put(root, 'docs/archive/BS-1-alpha/result.md', `${ruResultHeading('BS-1')}\n\n${p}\n`);
        const r = cli(root, ['fold', '1']);
        assert.equal(r.code, 1, `${lang}: ${p}`);
        assert.match(r.err, ruRe('{dirRel}/result.md is still a stub: it contains [TODO] — write the outcome and the verification'));
      }
    }
    put(root, 'docs/archive/BS-1-alpha/result.md', ruResult('BS-1', '2026-09-03', `${ruOutcome('completed')}: \`[TODO: outcome]\` in prose — a story about a stub.`));
    const r = cli(root, ['fold', '1']);
    assert.equal(r.code, 0, r.err);
    assert.ok(!existsSync(path.join(root, 'docs/archive/BS-1-alpha')), 'folded');
  } finally {
    cleanup(root);
  }
});

test('fold N: archive N of the same task after the fold refuses, it does not create a second directory', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Reference\n');
    closed(root);
    gitAll(root);
    assert.equal(cli(root, ['fold', '1']).code, 0);
    const r = cli(root, ['archive', '1']);
    assert.equal(r.code, 1);
    assert.match(r.err, ruRe(ALREADY_FOLDED));
  } finally {
    cleanup(root);
  }
});

test('fold N: an unsaved attachment refuses the fold and stays on disk; committed, show N lists it by path', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Reference\n');
    put(root, 'docs/backlog/active/BS-1-alpha.md', activeAlpha());
    gitAll(root, 'alpha taken');
    assert.equal(cli(root, ['archive', '1']).code, 0);
    put(root, 'docs/archive/BS-1-alpha/result.md', ruResult('BS-1', '2026-09-03', completed('Summary.')));
    put(root, 'docs/archive/BS-1-alpha/measurements.md', 'p95 = 12 ms\n');
    put(root, 'docs/archive/BS-1-alpha/img/diagram.svg', '<svg/>\n');

    const refused = cli(root, ['fold', '1']);
    assert.equal(refused.code, 1, refused.out);
    assert.match(refused.err, ruRe(UNSAVED));
    assert.doesNotMatch(UNSAVED, /commit/i, 'the acceptance recipe forbids a commit between archive and fold');
    assert.match(refused.err, /docs\/archive\/BS-1-alpha\/measurements\.md/);
    assert.match(refused.err, /docs\/archive\/BS-1-alpha\/img\/diagram\.svg/);
    assert.equal(refused.out, '', 'no draft is printed before the refusal');
    assert.ok(existsSync(path.join(root, 'docs/archive/BS-1-alpha/measurements.md')), 'the attachment stays on disk');
    assert.ok(!existsSync(path.join(root, 'docs/archive/LOG.md')), 'the refusal writes no journal');

    gitAll(root, 'alpha closed with attachments');
    const folded = cli(root, ['fold', '1']);
    assert.equal(folded.code, 0, folded.err);
    assert.match(logLines(root)[0], / · `[0-9a-f]{10}` · Alpha$/, 'fixture: the line names a revision');
    gitAll(root, 'fold');
    const shown = cli(root, ['show', '1']);
    assert.equal(shown.code, 0, shown.err);
    assert.match(shown.out, /task text/);
    assert.match(shown.out, /^docs\/archive\/BS-1-alpha\/measurements\.md$/m);
    assert.match(shown.out, /^docs\/archive\/BS-1-alpha\/img\/diagram\.svg$/m);
    assert.doesNotMatch(shown.out, /p95 = 12 ms|<svg/, 'attachments are listed by path, not printed');
    assert.match(shown.err, new RegExp(`^ {2}attachments are listed by path|^ {2}${ruHeadRe('attachments are listed by path: git show {rev}:./<path> prints one').source}`, 'm'));
    assert.doesNotMatch(shown.err, /⚠/, 'the header and the attachment hint are notes');
  } finally {
    cleanup(root);
  }
});

test('fold N: an attachment committed in HEAD does not block a fold without revision; a changed one does', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Reference\n');
    closed(root);
    put(root, 'docs/archive/BS-1-alpha/notes.txt', 'attachment\n');
    gitAll(root);
    put(root, 'docs/archive/BS-1-alpha/notes.txt', 'attachment, edited\n');
    const changed = cli(root, ['fold', '1']);
    assert.equal(changed.code, 1, changed.out);
    assert.match(changed.err, unsavedRe('docs/archive/BS-1-alpha/notes.txt'));

    put(root, 'docs/archive/BS-1-alpha/notes.txt', 'attachment\n');
    put(root, 'docs/archive/BS-1-alpha/result.md', ruResult('BS-1', '2026-09-03', completed('Summary after review.')));
    const r = cli(root, ['fold', '1']);
    assert.equal(r.code, 0, r.err);
    assert.match(logLines(root)[0], / · — · Alpha$/, 'fixture: the uncommitted result.md leaves the line without a revision');
    assert.equal(run(root, ['cat-file', '-t', 'HEAD:docs/archive/BS-1-alpha/notes.txt']).stdout.trim(), 'blob');
  } finally {
    cleanup(root);
  }
});

test('fold N: a file git ignores in a task directory is not an attachment; an unignored stray file still is', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Reference\n');
    put(root, '.git/info/exclude', '.DS_Store\n');
    closed(root);
    gitAll(root);
    put(root, 'docs/archive/BS-1-alpha/.DS_Store', 'finder\n');
    put(root, 'docs/archive/BS-1-alpha/stray.txt', 'stray\n');
    const refused = cli(root, ['fold', '1']);
    assert.equal(refused.code, 1, refused.out);
    assert.match(refused.err, unsavedRe('docs/archive/BS-1-alpha/stray.txt'));
    assert.doesNotMatch(refused.err, /\.DS_Store/, 'the ignored file is not named');

    rmSync(path.join(root, 'docs/archive/BS-1-alpha/stray.txt'));
    const r = cli(root, ['fold', '1']);
    assert.equal(r.code, 0, r.err);
    assert.match(logLines(root)[0], / · `[0-9a-f]{10}` · Alpha$/);
  } finally {
    cleanup(root);
  }
});

test('fold N: in a task directory ignored as a whole an ignored file still counts; outside a repository every file does', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Reference\n');
    put(root, '.gitignore', 'docs/archive/BS-1-alpha/\n');
    put(root, '.git/info/exclude', '.DS_Store\n');
    gitAll(root);
    closed(root);
    put(root, 'docs/archive/BS-1-alpha/.DS_Store', 'finder\n');
    const r = cli(root, ['fold', '1']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, unsavedRe('docs/archive/BS-1-alpha/.DS_Store'));
    assert.ok(existsSync(path.join(root, 'docs/archive/BS-1-alpha/.DS_Store')), 'the file stays on disk');
  } finally {
    cleanup(root);
  }
  const bare = makeProject({ git: false });
  try {
    put(bare, 'docs/reference/README.md', '# Reference\n');
    closed(bare);
    put(bare, 'docs/archive/BS-1-alpha/.DS_Store', 'finder\n');
    const r = cli(bare, ['fold', '1']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, unsavedRe('docs/archive/BS-1-alpha/.DS_Store'));
  } finally {
    cleanup(bare);
  }
});

test('fold N: a task directory ignored as a whole still counts its files once archive N has staged task.md', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Reference\n');
    put(root, '.gitignore', 'docs/archive/BS-1-alpha/\n');
    put(root, 'docs/backlog/active/BS-1-alpha.md', activeAlpha());
    gitAll(root, 'alpha taken');
    assert.equal(cli(root, ['archive', '1']).code, 0);
    assert.match(run(root, ['status', '--porcelain']).stdout, /^R {2}.* -> docs\/archive\/BS-1-alpha\/task\.md$/m, 'fixture: task.md is staged');
    put(root, 'docs/archive/BS-1-alpha/result.md', ruResult('BS-1', '2026-09-03', completed('Summary.')));
    put(root, 'docs/archive/BS-1-alpha/notes.txt', 'notes\n');

    const r = cli(root, ['fold', '1']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, unsavedRe('docs/archive/BS-1-alpha/notes.txt'));
    assert.ok(existsSync(path.join(root, 'docs/archive/BS-1-alpha/notes.txt')), 'the attachment stays on disk');
  } finally {
    cleanup(root);
  }
});

test('fold --embed-missing: an attachment beside a committed task.md in an ignored directory still refuses', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Reference\n');
    put(root, '.gitignore', 'docs/archive/BS-1-alpha/\n');
    closed(root);
    run(root, ['add', '-f', 'docs/archive/BS-1-alpha/task.md']);
    gitAll(root);
    put(root, 'docs/archive/BS-1-alpha/scan.png', 'png bytes\n');
    assert.equal(run(root, ['status', '--porcelain']).stdout, '', 'fixture: result.md and scan.png are ignored, the tree is clean');

    const r = cli(root, ['fold', '--embed-missing']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, unsavedRe('docs/archive/BS-1-alpha/scan.png'));
    assert.ok(existsSync(path.join(root, 'docs/archive/BS-1-alpha/scan.png')), 'the attachment stays on disk');
    assert.ok(!existsSync(path.join(root, 'docs/archive/LOG.md')), 'the refusal writes no journal');
  } finally {
    cleanup(root);
  }
});

test('fold: a bulk fold, --older-than selects by closing date, --dry-run writes nothing', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Reference\n');
    closed(root, { id: 'BS-1', slug: 'alpha', title: 'Alpha', date: '2026-01-10' });
    closed(root, { id: 'BS-2', slug: 'beta', title: 'Beta', date: '2026-05-10', outcome: `${ruOutcome('rejected')}.` });
    closed(root, { id: 'BS-3', slug: 'gamma', title: 'Gamma', date: '2026-09-10', outcome: `${ruOutcome('merged', 'BS-1')}.` });
    gitAll(root);

    const dry = cli(root, ['fold', '--dry-run']);
    assert.equal(dry.code, 0, dry.err);
    assert.match(dry.out, ruRe('fold the archive into the journal: {entries} tasks', { entries: 3 }));
    assert.match(dry.err, new RegExp(`^ {2}${ruRe('--dry-run: {entries} tasks would be folded, nothing was written', { entries: 3 }).source}$`, 'm'));
    assert.doesNotMatch(dry.err, /⚠/, 'a dry run is a report, not a warning');
    assert.ok(existsSync(path.join(root, 'docs/archive/BS-1-alpha')), '--dry-run does not touch the directories');
    assert.ok(!existsSync(path.join(root, 'docs/archive/LOG.md')), '--dry-run does not create the journal');

    const older = cli(root, ['fold', '--older-than', '2026-06-01']);
    assert.equal(older.code, 0, older.err);
    // The bulk draft carries no bodies: no reason to commit it for them, they are in history.
    assert.match(older.err.trimEnd().split('\n').at(-1), new RegExp(`^ {2}${ruRe('the commit message draft is on stdout and carries no task bodies: the journal line names the revision that holds the body, and {cli} show N reads it from there').source}$`));
    assert.doesNotMatch(older.err, LOST);
    assert.ok(!existsSync(path.join(root, 'docs/archive/BS-1-alpha')));
    assert.ok(!existsSync(path.join(root, 'docs/archive/BS-2-beta')));
    assert.ok(existsSync(path.join(root, 'docs/archive/BS-3-gamma')), 'a fresh task stays a directory');

    // The body revision: the directories are committed, so the line names a commit, not a dash.
    const lines = logLines(root);
    assert.equal(lines.length, 2);
    assert.match(lines[0], new RegExp(`^- <a id="bs-1"><\\/a>\`BS-1-alpha\` · 2026-01-10 · ${ruOutcomeWord('completed')} · \`[0-9a-f]{10}\` · Alpha$`));
    assert.match(lines[1], new RegExp(` · ${ruOutcomeWord('rejected')} · `));

    // A hybrid: folded entries and an unfolded directory live side by side, lint is green.
    const lint = cli(root, ['lint']);
    assert.equal(lint.code, 0, lint.err);

    const rest = cli(root, ['fold']);
    assert.equal(rest.code, 0, rest.err);
    assert.match(logLines(root)[2], new RegExp(` · ${ruOutcomeWord('merged', 'BS-1')} · `));

    const empty = cli(root, ['fold']);
    assert.equal(empty.code, 0, empty.err);
    assert.match(empty.err, ruRe('nothing to fold: the archive has no unfolded directories'));
  } finally {
    cleanup(root);
  }
});

test('fold: nothing to fold reports on stderr and leaves stdout, the message draft, empty', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Reference\n');
    gitAll(root);
    for (const args of [['fold'], ['fold', '--dry-run']]) {
      const r = cli(root, args);
      assert.equal(r.code, 0, r.err);
      assert.equal(r.out, '', `${args.join(' ')}: stdout carries no report line`);
      assert.match(r.err, ruRe('nothing to fold: the archive has no unfolded directories'));
      assert.doesNotMatch(r.err, /⚠/);
    }
  } finally {
    cleanup(root);
  }
});

// A commit with a given date: the fold day and the revision date would coincide otherwise,
// and the check would be vacuous.
function commitOn(root, date, message) {
  run(root, ['add', '-A']);
  const env = { ...process.env, GIT_AUTHOR_DATE: `${date}T12:00:00`, GIT_COMMITTER_DATE: `${date}T12:00:00` };
  const r = spawnSync('git', ['-C', root, 'commit', '-qm', message], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
}

test('fold: without a date in result.md the line takes the date of the body revision’s commit, the fold day — only without a revision', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Reference\n');
    put(root, '.gitignore', 'docs/archive/BS-3-gamma/\n');
    for (const [id, slug] of [['BS-1', 'alpha'], ['BS-2', 'beta'], ['BS-3', 'gamma']]) {
      put(root, `docs/archive/${id}-${slug}/task.md`, ruCard(id, slug, {}, [['context', 'text']]));
      put(root, `docs/archive/${id}-${slug}/result.md`, `${ruResultHeading(id)}\n\n${ruOutcome('completed')} without a date.\n`);
    }
    commitOn(root, '2026-02-03', 'closing');

    const older = cli(root, ['fold', '--older-than', '2026-03-01']);
    assert.equal(older.code, 0, older.err);
    assert.ok(existsSync(path.join(root, 'docs/archive/BS-3-gamma')), 'without a revision the age is unknown — --older-than does not take it');
    const lines = logLines(root);
    assert.equal(lines.length, 2);
    for (const line of lines) assert.match(line, new RegExp(` · 2026-02-03 · ${ruOutcomeWord('completed')} · \`[0-9a-f]{10}\` · `));

    const rest = cli(root, ['fold']);
    assert.equal(rest.code, 0, rest.err);
    assert.match(logLines(root)[2], new RegExp(`^- <a id="bs-3"></a>\`BS-3-gamma\` · ${today()} · ${ruOutcomeWord('completed')} · — · `), 'without a revision — the fold day');
  } finally {
    cleanup(root);
  }
});

test('fold: a bulk fold writes the lines by closing date, equal dates — by number', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Reference\n');
    closed(root, { id: 'BS-1', slug: 'alpha', title: 'Alpha', date: '2026-05-10' });
    closed(root, { id: 'BS-2', slug: 'beta', title: 'Beta', date: '2026-01-10' });
    closed(root, { id: 'BS-3', slug: 'gamma', title: 'Gamma', date: '2026-05-10' });
    put(root, 'docs/archive/BS-4-delta/task.md', ruCard('BS-4', 'Delta', {}, [['context', 'text']]));
    put(root, 'docs/archive/BS-4-delta/result.md', `${ruResultHeading('BS-4')}\n\n${ruOutcome('completed')}, the date comes from the commit.\n`);
    commitOn(root, '2026-03-15', 'closing');

    const r = cli(root, ['fold']);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(logLines(root).map((l) => l.match(/^- <a id="([^"]+)"><\/a>`[^`]+` · (\S+) ·/).slice(1).join(' ')), [
      'bs-2 2026-01-10', 'bs-4 2026-03-15', 'bs-1 2026-05-10', 'bs-3 2026-05-10',
    ]);
    // The draft lists the tasks in the same order as the journal.
    const listed = r.out.split('\n').filter((l) => l.startsWith('- docs/archive/')).map((l) => l.split(' ')[1]);
    assert.deepEqual(listed, ['docs/archive/BS-2-beta', 'docs/archive/BS-4-delta', 'docs/archive/BS-1-alpha', 'docs/archive/BS-3-gamma']);
  } finally {
    cleanup(root);
  }
});

test('fold: a body outside history — goes with the directory by default, rides in the draft with --embed-missing', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Reference\n');
    // The body is not in history and never will be: the directory is under .gitignore, the tree
    // is clean — that is what the flag exists for. An uncommitted directory is a refusal, no drop.
    put(root, '.gitignore', 'docs/archive/BS-1-alpha/\ndocs/archive/BS-2-beta/\n');
    gitAll(root);
    closed(root, { id: 'BS-1', slug: 'alpha', title: 'Alpha' });
    assert.equal(run(root, ['status', '--porcelain', '--', 'docs/archive/BS-1-alpha']).stdout, '', 'the tree is clean for the directory');
    assert.equal(run(root, ['log', '-1', '--format=%H', '--', 'docs/archive/BS-1-alpha/task.md']).stdout.trim(), '', 'no revision holds the body');

    const dropped = cli(root, ['fold']);
    assert.equal(dropped.code, 0, dropped.err);
    assert.match(dropped.err, ruRe(BODY_GONE));
    assert.match(dropped.err, /--embed-missing/);
    assert.doesNotMatch(dropped.out, /task text/, 'the default does not keep the body');
    // A dropped body cannot be retrieved by anything: the last line does not promise show N for it.
    assert.match(dropped.err.trimEnd().split('\n').at(-1), new RegExp(`^ {2}${ruRe('the commit message draft is on stdout and carries no task bodies: the lines with “—” ({dropped} tasks) lost their bodies with the directories, kept neither in the draft nor in history{rest}', { dropped: 1, rest: '' }).source}$`));
    assert.doesNotMatch(dropped.err, new RegExp(`${LOST.source}|show N`), 'without --embed-missing the draft has no bodies, and the dropped one is not in history either');
    assert.match(logLines(root)[0], / · — · Alpha$/, 'such an entry has no commit');

    closed(root, { id: 'BS-2', slug: 'beta', title: 'Beta' });
    const kept = cli(root, ['fold', '--embed-missing']);
    assert.equal(kept.code, 0, kept.err);
    assert.doesNotMatch(kept.err, ruRe(BODY_GONE));
    assert.match(kept.out, /--- docs\/archive\/BS-2-beta\/task\.md ---/);
    assert.match(kept.out, /task text/);
    assert.match(kept.out, /--- docs\/archive\/BS-2-beta\/result\.md ---/);
    assert.match(kept.err, ruRe(LOST_MANY));

    const single = cli(root, ['fold', '1', '--embed-missing']);
    assert.equal(single.code, 1);
    assert.match(single.err, ruRe('--embed-missing cannot be combined with a task number: folding a single task always puts the body into the message draft'));
  } finally {
    cleanup(root);
  }
});

test('fold --embed-missing: an attachment outside history refuses the bulk fold before any write', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Reference\n');
    put(root, '.gitignore', 'docs/archive/BS-1-alpha/\n');
    gitAll(root);
    closed(root, { id: 'BS-1', slug: 'alpha', title: 'Alpha' });
    put(root, 'docs/archive/BS-1-alpha/scan.png', 'png bytes\n');
    const r = cli(root, ['fold', '--embed-missing']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, unsavedRe('docs/archive/BS-1-alpha/scan.png'));
    assert.ok(existsSync(path.join(root, 'docs/archive/BS-1-alpha/scan.png')), 'the attachment stays on disk');
    assert.ok(!existsSync(path.join(root, 'docs/archive/LOG.md')), 'the refusal writes no journal');
  } finally {
    cleanup(root);
  }
});

test('show N: bodies embedded by bulk fold --embed-missing are found in the commit body, each task printing only its own sections', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Reference\n');
    put(root, '.gitignore', 'docs/archive/BS-1-alpha/\ndocs/archive/BS-2-beta/\n');
    gitAll(root);
    closed(root, { id: 'BS-1', slug: 'alpha', title: 'Alpha' });
    closed(root, { id: 'BS-2', slug: 'beta', title: 'Beta' });
    // A worker commit named after the task holds no body and must not stand in for the fold commit.
    put(root, 'docs/notes.md', 'work\n');
    gitAll(root, 'BS-1: worker commit without the body');
    const folded = cli(root, ['fold', '--embed-missing']);
    assert.equal(folded.code, 0, folded.err);
    assert.match(logLines(root)[0], / · — · Alpha$/, 'fixture: the body lives only in the message');
    assert.match(folded.out.split('\n\n')[1], /BS-1, BS-2/, 'the intro names the lines without a revision');
    const draft = path.join(root, '.git', 'BACKSLOP_DRAFT');
    writeFileSync(draft, folded.out);
    run(root, ['add', '-A']);
    run(root, ['commit', '-q', '-F', draft]);

    const one = cli(root, ['show', '1']);
    assert.equal(one.code, 0, one.err);
    assert.match(one.err, new RegExp(`^ {2}${ruRe(NO_BODY_FILE).source}`, 'm'));
    assert.doesNotMatch(one.err, /⚠/, 'reading the body from the message is the normal route');
    assert.match(one.out, /^--- docs\/archive\/BS-1-alpha\/task\.md ---$/m);
    assert.match(one.out, /^# BS-1 · Alpha$/m);
    assert.match(one.out, /^--- docs\/archive\/BS-1-alpha\/result\.md ---$/m);
    assert.doesNotMatch(one.out, new RegExp(`BS-2|worker commit|${ruHeadRe('fold the archive into the journal: {entries} tasks').source}`), 'only the task\'s own sections are printed');
    const two = cli(root, ['show', '2']);
    assert.equal(two.code, 0, two.err);
    assert.match(two.out, /^# BS-2 · Beta$/m);
    assert.match(two.out, /^--- docs\/archive\/BS-2-beta\/result\.md ---$/m);
    assert.doesNotMatch(two.out, /BS-1/, 'only the task\'s own sections are printed');
  } finally {
    cleanup(root);
  }
});

test('fold: a dropped body and a body in history in one fold — the last line names both cases', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Reference\n');
    put(root, '.gitignore', 'docs/archive/BS-1-alpha/\n');
    closed(root, { id: 'BS-2', slug: 'beta', title: 'Beta' });
    gitAll(root);
    closed(root, { id: 'BS-1', slug: 'alpha', title: 'Alpha' });
    const r = cli(root, ['fold']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.err.trimEnd().split('\n').at(-1), new RegExp(`^ {2}${ruRe('the commit message draft is on stdout and carries no task bodies: the lines with “—” ({dropped} tasks) lost their bodies with the directories, kept neither in the draft nor in history{rest}', { dropped: 1, rest: ru('; for lines with a revision {cli} show N reads the body', { cli: ANY }) }).source}$`));
  } finally {
    cleanup(root);
  }
});

test('fold: the bulk draft intro names the lines without a revision instead of claiming every body is in history', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Reference\n');
    closed(root, { id: 'BS-1', slug: 'alpha', title: 'Alpha' });
    gitAll(root);
    put(root, '.git/info/exclude', 'docs/archive/BS-5-delta/\n');
    closed(root, { id: 'BS-5', slug: 'delta', title: 'Delta' });
    const r = cli(root, ['fold']);
    assert.equal(r.code, 0, r.err);
    assert.match(logLines(root)[1], / · — · Delta$/, 'fixture: the excluded directory gets no revision');
    assert.doesNotMatch(r.out, ruRe('Task directories leave the tree; numbers and outcomes remain as journal lines. A task body sits in history — its journal line names the revision that {cli} show N reads it from.'), 'the draft claims no body in history for every line');
    const intro = r.out.split('\n\n')[1];
    assert.match(intro, ruRe('Task directories leave the tree; numbers and outcomes remain as journal lines. A line with a revision names the commit that {cli} show N reads the body from; the lines with “—” ({bare}) have none: {bodies}.', { bare: 'BS-5' }), 'the intro names the line without a revision');
    assert.match(intro, ruRe('their bodies left with the directories and are kept neither in this message nor in history'));
  } finally {
    cleanup(root);
  }
});

// An empty body revision comes for four reasons, and the owner chose the default "delete" for
// only one — a proven absence of the body. "Could not look into history" is not it.
test('fold: a bulk fold refuses an uncommitted directory and a project without git, it does not delete', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Reference\n');
    gitAll(root);
    // A move from the docs: archive N moved, the approver wrote result.md and did not commit.
    put(root, 'docs/backlog/active/BS-1-alpha.md', activeAlpha());
    gitAll(root, 'alpha taken');
    assert.equal(cli(root, ['archive', '1']).code, 0);
    put(root, 'docs/archive/BS-1-alpha/result.md', ruResult('BS-1', '2026-09-03', completed('Summary.')));

    const dirty = cli(root, ['fold']);
    assert.equal(dirty.code, 1, dirty.out);
    assert.match(dirty.err, ruRe(NOT_COMMITTED));
    assert.ok(existsSync(path.join(root, 'docs/archive/BS-1-alpha/result.md')), 'the refusal does not touch the directory');
    assert.ok(!existsSync(path.join(root, 'docs/archive/LOG.md')), 'the refusal does not create the journal');
    // The same task folds alone: the body goes to the message draft.
    const single = cli(root, ['fold', '1']);
    assert.equal(single.code, 0, single.err);
    assert.match(single.out, /task text/);

    // A project without git is not touched by a bulk fold at all: it prints no bodies, and
    // nothing backs up the deletion.
    const bare = makeProject({ git: false });
    try {
      put(bare, 'docs/reference/README.md', '# Reference\n');
      closed(bare, { id: 'BS-1', slug: 'alpha', title: 'Alpha' });
      const nogit = cli(bare, ['fold']);
      assert.equal(nogit.code, 1, nogit.out);
      assert.match(nogit.err, NO_REPO);
      assert.ok(existsSync(path.join(bare, 'docs/archive/BS-1-alpha/task.md')), 'the directory is in place');
      // Alone — it folds: the body is printed whole.
      const one = cli(bare, ['fold', '1']);
      assert.equal(one.code, 0, one.err);
      assert.match(one.out, /task text/);
    } finally {
      cleanup(bare);
    }
  } finally {
    cleanup(root);
  }
});

test('fold: the line’s revision is the last commit that touched the directory: show N prints a result.md written after archiving', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Reference\n');
    put(root, 'docs/backlog/active/BS-1-alpha.md', activeAlpha());
    gitAll(root, 'alpha taken');
    assert.equal(cli(root, ['archive', '1']).code, 0);
    put(root, 'docs/archive/BS-1-alpha/result.md', ruResult('BS-1', '2026-09-03', completed('Draft summary.')));
    gitAll(root, 'archiving alpha');
    put(root, 'docs/archive/BS-1-alpha/result.md', ruResult('BS-1', '2026-09-03', completed('Summary after review.')));
    gitAll(root, 'alpha summary after review');
    const reviewed = run(root, ['rev-parse', 'HEAD']).stdout.trim();
    // No result at all in the commit that last touched the definition.
    put(root, 'docs/archive/BS-2-beta/task.md', ruCard('BS-2', 'Beta', { area: REF_AREA }, [['context', 'beta definition']]));
    gitAll(root, 'beta definition only');
    put(root, 'docs/archive/BS-2-beta/result.md', ruResult('BS-2', '2026-09-04', completed('Beta summary.')));
    gitAll(root, 'beta summary');
    const late = run(root, ['rev-parse', 'HEAD']).stdout.trim();

    const r = cli(root, ['fold']);
    assert.equal(r.code, 0, r.err);
    const lines = logLines(root);
    assert.match(lines[0], new RegExp(` · \`${reviewed.slice(0, 10)}\` · Alpha$`));
    assert.match(lines[1], new RegExp(` · \`${late.slice(0, 10)}\` · Beta$`));
    gitAll(root, 'archive fold');

    const alpha = cli(root, ['show', '1']);
    assert.equal(alpha.code, 0, alpha.err);
    assert.match(alpha.out, /Summary after review/);
    assert.doesNotMatch(alpha.out, /Draft summary/);
    const beta = cli(root, ['show', '2']);
    assert.equal(beta.code, 0, beta.err);
    assert.match(beta.out, /--- docs\/archive\/BS-2-beta\/result\.md ---/);
    assert.match(beta.out, /Beta summary/);
  } finally {
    cleanup(root);
  }
});

// An edit that `git status` does not see: the directory is clean by status,
// but on disk it is not what the revision holds.
test('fold: a directory file differs from the revision under a clean git status — bulk refuses with the file name, single carries the body into the draft', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Reference\n');
    closed(root);
    gitAll(root);
    put(root, 'docs/archive/BS-1-alpha/result.md', ruResult('BS-1', '2026-09-03', completed('An edit past the index.')));
    run(root, ['update-index', '--assume-unchanged', 'docs/archive/BS-1-alpha/result.md']);
    assert.equal(run(root, ['status', '--porcelain']).stdout, '', 'git status does not see the edit');

    const bulk = cli(root, ['fold']);
    assert.equal(bulk.code, 1, bulk.out);
    assert.match(bulk.err, differsRe('docs/archive/BS-1-alpha/result.md'));
    assert.match(bulk.err, /\(assume-unchanged\)/, 'the index flag git reports is named');
    assert.ok(existsSync(path.join(root, 'docs/archive/BS-1-alpha/result.md')), 'the refusal does not touch the directory');
    assert.ok(!existsSync(path.join(root, 'docs/archive/LOG.md')), 'the refusal does not create the journal');

    const single = cli(root, ['fold', '1']);
    assert.equal(single.code, 0, single.err);
    assert.match(logLines(root)[0], / · — · Alpha$/, 'a revision that promises another text does not go into the line');
    assert.match(single.out, /An edit past the index/);
  } finally {
    cleanup(root);
  }
});

test('fold: a working tree with CRLF over an LF blob (core.autocrlf) — not a mismatch, the line gets a revision', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Reference\n');
    closed(root);
    gitAll(root);
    run(root, ['config', 'core.autocrlf', 'true']);
    rmSync(path.join(root, 'docs/archive/BS-1-alpha'), { recursive: true, force: true });
    run(root, ['checkout', '--', 'docs/archive/BS-1-alpha']);
    assert.match(read(root, 'docs/archive/BS-1-alpha/result.md'), /\r\n/, 'the fixture gives CRLF on disk');
    assert.equal(run(root, ['status', '--porcelain']).stdout, '');

    const r = cli(root, ['fold']);
    assert.equal(r.code, 0, r.err);
    assert.match(logLines(root)[0], / · `[0-9a-f]{10}` · Alpha$/);
  } finally {
    cleanup(root);
  }
});

test('fold: CRLF blobs that git calls clean under core.autocrlf get the revision instead of a refusal', () => {
  for (const mode of ['true', 'input']) {
    const root = makeProject();
    try {
      put(root, 'docs/reference/README.md', '# Reference\n');
      run(root, ['config', 'core.autocrlf', 'false']);
      closed(root);
      for (const name of ['task.md', 'result.md']) {
        const file = `docs/archive/BS-1-alpha/${name}`;
        put(root, file, read(root, file).replaceAll('\n', '\r\n'));
      }
      gitAll(root);
      run(root, ['config', 'core.autocrlf', mode]);
      assert.equal(run(root, ['status', '--porcelain', '--', 'docs/archive/BS-1-alpha']).stdout, '', `${mode}: git calls the directory clean`);

      const r = cli(root, ['fold']);
      assert.equal(r.code, 0, `${mode}: ${r.err}`);
      assert.match(logLines(root)[0], / · `[0-9a-f]{10}` · Alpha$/, `${mode}: the line carries the revision`);
    } finally {
      cleanup(root);
    }
  }
});

test('fold: a mismatch git confirms without an index flag names line-ending normalisation, not assume-unchanged', { skip: process.platform === 'win32' }, () => {
  const root = makeProject();
  const shim = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-git-shim-')));
  try {
    put(root, 'docs/reference/README.md', '# Reference\n');
    run(root, ['config', 'core.autocrlf', 'false']);
    closed(root);
    const file = 'docs/archive/BS-1-alpha/result.md';
    put(root, file, read(root, file).replaceAll('\n', '\r\n'));
    gitAll(root);
    run(root, ['config', 'core.autocrlf', 'true']);
    // git's second opinion, `git diff --quiet`, reports a difference: the mismatch is real.
    const real = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
    writeFileSync(path.join(shim, 'git'), `#!/bin/sh\n[ "$3" = "diff" ] && exit 1\nexec "${real}" "$@"\n`, { mode: 0o755 });

    const r = cli(root, ['fold'], { env: { PATH: `${shim}${path.delimiter}${process.env.PATH}` } });
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, differsRe('docs/archive/BS-1-alpha/result.md'));
    assert.doesNotMatch(r.err, /assume-unchanged|skip-worktree/, 'no index flag is set, so none is named');
    assert.match(r.err, /git add --renormalize docs\/archive\/BS-1-alpha/);
    assert.ok(!existsSync(path.join(root, 'docs/archive/LOG.md')), 'the refusal writes no journal');

    // git reads core.autocrlf as a boolean too: `yes` wins over an `input` in a lower scope.
    run(root, ['config', 'core.autocrlf', 'yes']);
    writeFileSync(path.join(shim, 'global.gitconfig'), '[core]\n\tautocrlf = input\n');
    const yes = cli(root, ['fold'], { env: { PATH: `${shim}${path.delimiter}${process.env.PATH}`, GIT_CONFIG_GLOBAL: path.join(shim, 'global.gitconfig') } });
    assert.equal(yes.code, 1, yes.out);
    assert.match(yes.err, /git add --renormalize docs\/archive\/BS-1-alpha/, 'core.autocrlf=yes names the remedy');
  } finally {
    cleanup(root);
    rmSync(shim, { recursive: true, force: true });
  }
});

test('fold N: a CRLF journal stays CRLF', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Reference\n');
    run(root, ['config', 'core.autocrlf', 'false']);
    closed(root, { id: 'BS-1', slug: 'alpha', title: 'Alpha' });
    closed(root, { id: 'BS-2', slug: 'beta', title: 'Beta' });
    gitAll(root);
    assert.equal(cli(root, ['fold', '1']).code, 0);
    put(root, 'docs/archive/LOG.md', read(root, 'docs/archive/LOG.md').replaceAll('\n', '\r\n'));
    gitAll(root, 'CRLF journal');

    const r = cli(root, ['fold', '2']);
    assert.equal(r.code, 0, r.err);
    const text = read(root, 'docs/archive/LOG.md');
    assert.match(text, /\r\n- <a id="bs-2">/, 'fixture: the line is appended');
    assert.doesNotMatch(text, /(?<!\r)\n/, 'every line of the journal ends in CRLF');
    assert.match(run(root, ['ls-files', '--eol', 'docs/archive/LOG.md']).stdout, /w\/crlf/);
  } finally {
    cleanup(root);
  }
});

test('fold: an uncommitted result.md under status.showUntrackedFiles=no — a "directory not committed" refusal, not a drop', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Reference\n');
    put(root, 'docs/archive/BS-1-alpha/task.md', ruCard('BS-1', 'Alpha', { area: REF_AREA }, [['context', 'task text']]));
    gitAll(root);
    run(root, ['config', 'status.showUntrackedFiles', 'no']);
    put(root, 'docs/archive/BS-1-alpha/result.md', ruResult('BS-1', '2026-09-03', completed('A summary outside history.')));
    assert.equal(run(root, ['status', '--porcelain']).stdout, '', 'a plain git status does not show the new file');

    const r = cli(root, ['fold']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, ruRe(NOT_COMMITTED));
    assert.ok(existsSync(path.join(root, 'docs/archive/BS-1-alpha/result.md')), 'the refusal does not touch the directory');
  } finally {
    cleanup(root);
  }
});

test('fold: a directory file that git hash-object cannot read — the refusal names the cause, not a mismatch', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Reference\n');
    closed(root);
    put(root, 'docs/archive/BS-1-alpha/notes.txt', 'attachment\n');
    gitAll(root);
    run(root, ['update-index', '--assume-unchanged', 'docs/archive/BS-1-alpha/notes.txt']);
    rmSync(path.join(root, 'docs/archive/BS-1-alpha/notes.txt'));
    assert.equal(run(root, ['status', '--porcelain']).stdout, '', 'git status does not see the deletion');

    const r = cli(root, ['fold']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, HASH_OBJECT_FAILED);
    assert.doesNotMatch(r.err, DIFFERS_ANY);
    assert.ok(existsSync(path.join(root, 'docs/archive/BS-1-alpha/result.md')), 'the refusal does not touch the directory');
  } finally {
    cleanup(root);
  }
});

test('fold: the numbers of the folded are taken — new and new --parent do not reuse them, lint is quiet about the mention', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Reference\n');
    closed(root, { id: 'BS-7', slug: 'seven', title: 'Seven' });
    gitAll(root);
    assert.equal(cli(root, ['fold', '7']).code, 0);

    const next = cli(root, ['new', 'eight', '--queue']);
    assert.equal(next.code, 0, next.err);
    assert.match(next.out, /BS-8: /);

    const child = cli(root, ['new', 'finding', '--parent', '7']);
    assert.equal(child.code, 0, child.err);
    assert.match(child.out, /BS-7\.1: /);

    put(root, 'docs/ROADMAP.md', '# Roadmap\n\nBS-7 is closed, BS-8 is live.\n');
    put(root, 'docs/backlog/queue/BS-8-eight.md', read(root, 'docs/backlog/queue/BS-8-eight.md').replace(AREA_STUB, 'Reference'));
    const lint = cli(root, ['lint']);
    assert.doesNotMatch(lint.err, new RegExp(`${ruHeadRe('mentions {id}, but no task file exists in statuses or archive').source}BS-7`));
  } finally {
    cleanup(root);
  }
});

test('fold: a batch goes with its minor entries, the archive count does not count them', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Reference\n');
    closed(root, { id: 'BS-1', slug: 'batch', title: 'Batch' });
    put(root, 'docs/archive/BS-1-batch/minor/BS-1.1-finding.md', ruCard('BS-1.1', 'Finding', { cost: 'minor' }));
    gitAll(root);

    const r = cli(root, ['fold', '1']);
    assert.equal(r.code, 0, r.err);
    const lines = logLines(root);
    assert.equal(lines.length, 2);
    assert.match(lines[1], new RegExp(`^- <a id="bs-1\\.1"><\\/a>\`BS-1\\.1-finding\` · 2026-09-03 · ${ruOutcomeWord('batched', 'BS-1')} · `));
    assert.match(r.out, /--- docs\/archive\/BS-1-batch\/minor\/BS-1\.1-finding\.md ---/);

    const status = JSON.parse(cli(root, ['status', '--json']).out);
    assert.equal(status.archive, 1, 'a batch entry does not count as a closed task');
    assert.equal(cli(root, ['lint']).code, 0);
  } finally {
    cleanup(root);
  }
});

test('fold N: batch entries go to the journal and the draft in numeric order', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Reference\n');
    closed(root, { id: 'BS-1', slug: 'batch', title: 'Batch' });
    for (const sub of [11, 2, 10, 1, 3]) {
      put(root, `docs/archive/BS-1-batch/minor/BS-1.${sub}-finding-${sub}.md`, ruCard(`BS-1.${sub}`, `Finding ${sub}`, { cost: 'minor' }));
    }
    gitAll(root);
    const r = cli(root, ['fold', '1']);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(logLines(root).map((l) => l.match(/^- <a id="([^"]+)">/)[1]), ['bs-1', 'bs-1.1', 'bs-1.2', 'bs-1.3', 'bs-1.10', 'bs-1.11']);
    const sections = r.out.split('\n').map((l) => l.match(/^--- .*\/minor\/(BS-[\d.]+)-/)?.[1]).filter(Boolean);
    assert.deepEqual(sections, ['BS-1.1', 'BS-1.2', 'BS-1.3', 'BS-1.10', 'BS-1.11']);
  } finally {
    cleanup(root);
  }
});

test('fold N: a directory named like an entry in the batch minor/ is skipped, not read', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Reference\n');
    closed(root, { id: 'BS-1', slug: 'batch', title: 'Batch' });
    put(root, 'docs/archive/BS-1-batch/minor/BS-1.2-finding.md', ruCard('BS-1.2', 'Finding', { cost: 'minor' }));
    gitAll(root);
    mkdirSync(path.join(root, 'docs/archive/BS-1-batch/minor/BS-1.1-dir-entry.md'));
    const lint = cli(root, ['lint']);
    assert.equal(lint.code, 1, lint.out);
    assert.match(lint.err, new RegExp(`BS-1\\.1-dir-entry\\.md.*${ruHeadRe('minor/ of a batch holds only entry files {prefix}-N[.k]-<slug>.md').source}`));

    const r = cli(root, ['fold', '1']);
    assert.equal(r.code, 0, r.err);
    assert.doesNotMatch(r.err, /EISDIR|\n\s+at /, 'no stack trace');
    assert.deepEqual(logLines(root).map((l) => l.match(/^- <a id="([^"]+)">/)[1]), ['bs-1', 'bs-1.2']);
  } finally {
    cleanup(root);
  }
});

test('show N: the body as files from the line’s revision, otherwise by the BS-N: title, otherwise a refusal', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Reference\n');
    // The usual move: the card moves by `archive N` and is committed as a rename — the diff holds
    // no content, only `git show <rev>:<path>` shows the body.
    put(root, 'docs/backlog/active/BS-1-alpha.md', activeAlpha());
    gitAll(root, 'alpha taken');
    assert.equal(cli(root, ['archive', '1']).code, 0);
    put(root, 'docs/archive/BS-1-alpha/result.md', ruResult('BS-1', '2026-09-03', completed('One-line summary.')));
    gitAll(root, 'BS-1: alpha closed');
    assert.match(run(root, ['show', '--stat', 'HEAD']).stdout, /=> archive\/BS-1-alpha\/task\.md/, 'the fixture gives exactly a move');
    assert.doesNotMatch(run(root, ['show', 'HEAD']).stdout, /task text/, 'the commit holds no body — else the test is green by construction');

    assert.equal(cli(root, ['fold', '1']).code, 0);
    const byRev = cli(root, ['show', '1']);
    assert.equal(byRev.code, 0, byRev.err);
    assert.match(byRev.out, /--- docs\/archive\/BS-1-alpha\/task\.md ---/);
    assert.match(byRev.out, /--- docs\/archive\/BS-1-alpha\/result\.md ---/);
    assert.match(byRev.out, /task text/);
    assert.match(byRev.out, /One-line summary/);
    // The definition before the result: alphabetical order would be the other way round.
    assert.ok(byRev.out.indexOf('/task.md ---') < byRev.out.indexOf('/result.md ---'));
    assert.match(byRev.err, new RegExp(`BS-1 · 2026-09-03 · ${ruOutcomeWord('completed')}`));

    // A line without a revision: the body went into the commit message, and the commit is found
    // by its title.
    closed(root, { id: 'BS-2', slug: 'beta', title: 'Beta' });
    assert.equal(cli(root, ['fold', '2']).code, 0);
    assert.match(logLines(root)[1], / · — · Beta$/);
    gitAll(root, 'BS-2: the beta body in the message');
    const bySubject = cli(root, ['show', '2']);
    assert.equal(bySubject.code, 0, bySubject.err);
    assert.match(bySubject.out, /BS-2: the beta body in the message/);

    // No commit with such a title — a refusal in words, not an empty output.
    closed(root, { id: 'BS-3', slug: 'gamma', title: 'Gamma' });
    assert.equal(cli(root, ['fold', '3']).code, 0);
    gitAll(root, 'without a number in the title');
    const none = cli(root, ['show', '3']);
    assert.equal(none.code, 1);
    assert.match(none.err, ruRe('{id}: the {logRel} line names no commit, no commit message holds a section of its body, and history holds no commit whose subject starts with “{id}: ” — the body cannot be retrieved', { id: 'BS-3' }));

    put(root, 'docs/backlog/queue/BS-4-live.md', ruCard('BS-4', 'Live', { order: 10 }));
    const live = cli(root, ['show', '4']);
    assert.equal(live.code, 1);
    assert.match(live.err, ruRe('{id} is not folded — its body sits in the tree: {rel}'));
  } finally {
    cleanup(root);
  }
});

test('show N: a body from a commit message is printed without the diff — an acceptance commit over 1 MiB does not crash the command', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Reference\n');
    gitAll(root);
    closed(root, { id: 'BS-2', slug: 'beta', title: 'Beta' });
    const folded = cli(root, ['fold', '2']);
    assert.equal(folded.code, 0, folded.err);
    assert.match(logLines(root)[0], / · — · Beta$/, 'the body rides only in the message');
    const draft = path.join(root, '.git', 'BACKSLOP_DRAFT');
    writeFileSync(draft, folded.out);
    put(root, 'docs/bulk.txt', 'a line of the bulk rewrite\n'.repeat(60_000));
    run(root, ['add', '-A']);
    run(root, ['commit', '-q', '-F', draft]);
    assert.ok(Number(run(root, ['cat-file', '-s', 'HEAD:docs/bulk.txt']).stdout) > 1 << 20, 'the added file, and with it the commit diff, is larger than the default spawnSync buffer');

    const r = cli(root, ['show', '2']);
    assert.equal(r.code, 0, r.err);
    assert.doesNotMatch(r.out, /^BS-2: Beta$/m, 'the task sections of the message are printed, not its subject');
    assert.match(r.out, /^--- docs\/archive\/BS-2-beta\/task\.md ---$/m);
    assert.match(r.out, /task text/);
    assert.match(r.out, /^--- docs\/archive\/BS-2-beta\/result\.md ---$/m);
    assert.doesNotMatch(r.out, /^diff --git/m, 'the message is printed, not the commit with its diff');
    assert.doesNotMatch(r.out, /bulk rewrite/);
    assert.match(r.err, ruRe(NO_BODY_FILE));
  } finally {
    cleanup(root);
  }
});

test('show N: a fold draft committed under commit.cleanup=strip keeps its headings', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Reference\n');
    gitAll(root);
    closed(root, { id: 'BS-2', slug: 'beta', title: 'Beta' });
    const folded = cli(root, ['fold', '2']);
    assert.equal(folded.code, 0, folded.err);
    assert.match(logLines(root)[0], / · — · Beta$/, 'fixture: the body lives only in the message');
    assert.match(folded.err, /git commit --cleanup=verbatim -F/, 'the fold note names the verbatim commit');
    const draft = path.join(root, '.git', 'BACKSLOP_DRAFT');
    writeFileSync(draft, folded.out);
    run(root, ['add', '-A']);
    run(root, ['-c', 'commit.cleanup=strip', 'commit', '-q', '-F', draft]);

    const r = cli(root, ['show', '2']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /^# BS-2 · Beta$/m);
    assert.match(r.out, new RegExp(`^## ${SECTION.context}$`, 'm'));
    assert.match(r.out, new RegExp(`^${ruResultHeading('BS-2')}$`, 'm'));
    assert.doesNotMatch(r.out, /^>/m, 'the body marker is stripped back');
    assert.doesNotMatch(r.err, ruRe(BODY_HEAD), 'an intact body raises no heading warning');
  } finally {
    cleanup(root);
  }
});

test('show N: a fold commit written before the body marker prints its body as it is', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Reference\n');
    gitAll(root);
    const oldDraft = (id, slug, title) => [
      `${id}: ${title}`, '',
      ru('Folded into the {anchor} line. The task body is below: it is no longer in the tree, and this message is its only storage.', { anchor: `docs/archive/LOG.md#${id.toLowerCase()}` }), '',
      `--- docs/archive/${id}-${slug}/task.md ---`, '',
      ruCard(id, title, { area: REF_AREA }, [['context', '> a quote from the discussion\n\ntask text']]).trimEnd(), '',
      `--- docs/archive/${id}-${slug}/result.md ---`, '',
      ruResult(id, '2026-09-03', completed(RESULT_BODY)).trimEnd(), '',
    ].join('\n');
    const draft = path.join(root, '.git', 'OLD_DRAFT');

    closed(root, { id: 'BS-2', slug: 'beta', title: 'Beta' });
    assert.equal(cli(root, ['fold', '2']).code, 0);
    writeFileSync(draft, oldDraft('BS-2', 'beta', 'Beta'));
    run(root, ['add', '-A']);
    run(root, ['commit', '-q', '-F', draft]);
    const r = cli(root, ['show', '2']);
    assert.equal(r.code, 0, r.err);
    assert.ok(r.out.includes(ruCard('BS-2', 'Beta', { area: REF_AREA }, [['context', '> a quote from the discussion\n\ntask text']])), r.out);
    assert.ok(r.out.includes(ruResult('BS-2', '2026-09-03', completed(RESULT_BODY))), r.out);
    assert.doesNotMatch(r.err, ruRe(BODY_HEAD));

    // The same format under git's cleanup lost its headings: printed as found, with a warning.
    closed(root, { id: 'BS-3', slug: 'gamma', title: 'Gamma' });
    assert.equal(cli(root, ['fold', '3']).code, 0);
    writeFileSync(draft, oldDraft('BS-3', 'gamma', 'Gamma'));
    run(root, ['add', '-A']);
    run(root, ['-c', 'commit.cleanup=strip', 'commit', '-q', '-F', draft]);
    const stripped = cli(root, ['show', '3']);
    assert.equal(stripped.code, 0, stripped.err);
    assert.match(stripped.out, /task text/);
    assert.doesNotMatch(stripped.out, /^# BS-3/m, 'fixture: the cleanup took the headings');
    assert.match(stripped.err, ruRe(BODY_HEAD, { id: 'BS-3' }));
  } finally {
    cleanup(root);
  }
});

test('git: output over 1 MiB is read — the buffer ceiling is set explicitly, not by the spawnSync default', () => {
  const root = makeProject();
  try {
    put(root, 'docs/bulk.txt', 'x'.repeat(3 << 20));
    gitAll(root);
    const r = git(root, ['cat-file', 'blob', 'HEAD:docs/bulk.txt']);
    assert.equal(r.error, undefined, r.error?.message);
    assert.equal(r.status, 0);
    assert.equal(r.stdout.length, 3 << 20);
  } finally {
    cleanup(root);
  }
});

test('git: a refusal without an exit code names the cause — a launch error or a signal, not "code null"', () => {
  const root = makeProject();
  try {
    put(root, 'docs/bulk.txt', 'x'.repeat(1 << 20));
    gitAll(root);
    const overflow = git(root, ['cat-file', 'blob', 'HEAD:docs/bulk.txt'], { maxBuffer: 1024 });
    assert.equal(overflow.status, null, 'the fixture gives exactly status null');
    assert.match(gitCause(overflow), /ENOBUFS/);
    assert.equal(gitCause({ status: null, signal: 'SIGKILL', stderr: '' }), KILLED);
    assert.equal(gitCause({ status: null, signal: 'SIGKILL', stderr: '' }, 'en'), 'killed by SIGKILL');
    assert.equal(gitCause({ status: 128, stderr: 'fatal: bad object\n' }), 'fatal: bad object');
    assert.equal(gitCause({ status: 1, stderr: '' }, 'en'), 'exit code 1');
  } finally {
    cleanup(root);
  }
});

test('show N: git killed while reading the message — the refusal names the signal, not "code null"', { skip: process.platform === 'win32' }, () => {
  const root = makeProject();
  const shim = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-git-shim-')));
  try {
    put(root, 'docs/reference/README.md', '# Reference\n');
    gitAll(root);
    closed(root, { id: 'BS-2', slug: 'beta', title: 'Beta' });
    assert.equal(cli(root, ['fold', '2']).code, 0);
    gitAll(root, 'BS-2: the beta body in the message');
    const real = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
    writeFileSync(path.join(shim, 'git'), `#!/bin/sh\nfor a in "$@"; do [ "$a" = "--format=%B" ] && kill -9 $$; done\nexec "${real}" "$@"\n`, { mode: 0o755 });

    const r = cli(root, ['show', '2'], { env: { PATH: `${shim}${path.delimiter}${process.env.PATH}` } });
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, ruRe('git show {rev}: {cause} — the commit named by the {logRel} line is not readable in this clone', { cause: KILLED }));
    assert.doesNotMatch(r.err, new RegExp(escapeRe(ru('exit code {status}', { status: null }))));
  } finally {
    cleanup(root);
    rmSync(shim, { recursive: true, force: true });
  }
});

// A project in a repository subdirectory: `ls-tree` without `--full-name` gives paths from the
// current directory, `<rev>:<path>` without `./` — from the git root; they agree at the root only.
test('show N: a project in a repository subdirectory — the body is read, not declared missing', () => {
  const top = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-nested-show-')));
  try {
    run(top, ['init', '-q', '-b', 'main']);
    run(top, ['config', 'user.email', 'test@example.com']);
    run(top, ['config', 'user.name', 'test']);
    run(top, ['config', 'commit.gpgsign', 'false']);
    run(top, ['config', 'status.renames', 'true']);
    const root = path.join(top, 'sub');
    put(root, 'backslop.json', `${JSON.stringify({ prefix: 'BS', docs: 'docs', gates: [], version: TOOL_VERSION, lang: 'ru', tools: [] }, null, 2)}\n`);
    for (const dir of ['triage', 'queue', 'active', 'deferred', 'minor']) put(root, `docs/backlog/${dir}/.gitkeep`, '');
    put(root, 'docs/archive/README.md', '# Archive\n');
    put(root, 'docs/reference/README.md', '# Reference\n');
    put(root, 'docs/backlog/active/BS-1-alpha.md', activeAlpha());
    gitAll(top, 'alpha taken');
    assert.equal(cli(root, ['archive', '1']).code, 0);
    put(root, 'docs/archive/BS-1-alpha/result.md', ruResult('BS-1', '2026-09-03', completed('One-line summary.')));
    // The commit title deliberately has NO task number: else a fallback to printing the whole
    // commit would pass through the title search and hide the defect of reading by path.
    gitAll(top, 'alpha closed');
    assert.equal(cli(root, ['fold', '1']).code, 0);
    gitAll(top, 'alpha fold');

    const r = cli(root, ['show', '1']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /--- docs\/archive\/BS-1-alpha\/task\.md ---/);
    assert.match(r.out, /task text/);
    assert.match(r.out, /One-line summary/);
    assert.doesNotMatch(r.err, ruRe(NO_BODY_FILE), 'the body is in the revision — there is nothing to explain');
  } finally {
    rmSync(top, { recursive: true, force: true });
  }
});

test('migrate: creates the journal and removes no archive directory', () => {
  const root = makeProject({ stamp: false });
  try {
    put(root, 'docs/reference/README.md', '# Reference\n');
    closed(root);
    gitAll(root);
    const r = cli(root, ['migrate']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, ruRe('closed task journal docs/archive/LOG.md'));
    assert.ok(existsSync(path.join(root, 'docs/archive/LOG.md')));
    assert.ok(existsSync(path.join(root, 'docs/archive/BS-1-alpha/task.md')), 'the upgrade does not wipe what has accumulated');
    assert.equal(logLines(root).length, 0, 'the new journal is empty');
  } finally {
    cleanup(root);
  }
});

// The number of a folded task is not visible in file names: it stands as a line inside the
// journal. Without reading it a worker would issue a number already closed on another branch.
test('fold: the numbers of folded tasks of a foreign worktree and a foreign branch are taken', () => {
  const root = makeProject();
  const wt = path.join(mkdtempSync(path.join(os.tmpdir(), 'backslop-wt-')), 'worker');
  const git = (...args) => run(root, args);
  try {
    put(root, 'docs/reference/README.md', '# Reference\n');
    closed(root, { id: 'BS-1', slug: 'alpha', title: 'Alpha' });
    gitAll(root);
    git('worktree', 'add', '-q', wt, '-b', 'worker');
    // The fold runs in a foreign worktree, not committed yet — the number is counted from disk.
    assert.equal(cli(wt, ['fold', '1'], { cwd: wt }).code, 0);
    closed(wt, { id: 'BS-3', slug: 'three', title: 'Three' });
    assert.equal(cli(wt, ['fold', '3'], { cwd: wt }).code, 0);
    let r = cli(root, ['new', 'b']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /BS-4: /, 'BS-3 is taken by the uncommitted journal line in the worktree');
    assert.match(r.out, new RegExp(`${escapeRe(taken('BS-3', 'worktree '))}.+[\\\\/]worker \\(worker\\)$`, 'm'));

    // The worktree is removed, the branch with the folded BS-2 stays — counted from its tree.
    run(wt, ['add', '-A']);
    run(wt, ['commit', '-qm', 'worker: the fold and the second task']);
    closed(wt, { id: 'BS-5', slug: 'five', title: 'Five' });
    assert.equal(cli(wt, ['fold', '5'], { cwd: wt }).code, 0);
    run(wt, ['add', '-A']);
    run(wt, ['commit', '-qm', 'worker: the fifth']);
    git('worktree', 'remove', '--force', wt);
    r = cli(root, ['new', 'c']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /BS-6: /, 'BS-5 is taken by a journal line on the branch worker');
    assert.match(r.out, new RegExp(escapeRe(taken('BS-5', ru('branch {branch}', { branch: 'worker' })))));
  } finally {
    rmSync(path.dirname(wt), { recursive: true, force: true });
    cleanup(root);
  }
});

test('fold N: a failed git rm prints one error line that carries the cause and the recovery', { skip: process.platform === 'win32' }, () => {
  const root = makeProject();
  const shim = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-git-shim-')));
  try {
    put(root, 'docs/reference/README.md', '# Reference\n');
    closed(root);
    gitAll(root);
    const real = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
    writeFileSync(path.join(shim, 'git'), `#!/bin/sh\nfor a in "$@"; do [ "$a" = rm ] && { echo "rm refused" >&2; exit 1; }; done\nexec "${real}" "$@"\n`, { mode: 0o755 });
    const r = cli(root, ['fold', '1'], { env: { PATH: `${shim}${path.delimiter}${process.env.PATH}` } });
    assert.equal(r.code, 1);
    const errors = r.err.split('\n').filter((l) => l.startsWith('✖'));
    assert.equal(errors.length, 1, r.err);
    assert.match(errors[0], new RegExp(`^✖ ${ruRe('git rm failed: {cause} — task directories were not removed, the journal is untouched; sort the tree out and retry', { cause: 'rm refused' }).source}$`));
    assert.ok(existsSync(path.join(root, 'docs/archive/BS-1-alpha/task.md')), 'the task directory stays');
  } finally {
    cleanup(root);
    rmSync(shim, { recursive: true, force: true });
  }
});

test('fold N: an unreadable directory of the link walk refuses before the directory goes and the journal grows', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, () => {
  const root = makeProject();
  const locked = path.join(root, 'src', 'locked');
  try {
    put(root, 'docs/reference/README.md', '# Reference\n');
    closed(root);
    gitAll(root);
    mkdirSync(locked, { recursive: true });
    chmodSync(locked, 0o000);
    let r = cli(root, ['fold', '1']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, /src\/locked/);
    assert.ok(existsSync(path.join(root, 'docs/archive/BS-1-alpha/task.md')), 'the task directory is still there');
    assert.ok(!existsSync(path.join(root, 'docs/archive/LOG.md')), 'no journal was written');
    chmodSync(locked, 0o755);
    r = cli(root, ['fold', '1']);
    assert.equal(r.code, 0, r.err);
    assert.equal(logLines(root).length, 1);
  } finally {
    chmodSync(locked, 0o755);
    cleanup(root);
  }
});

test('fold N: a symlinked alias of the archive in the link walk does not read a removed file', { skip: process.platform === 'win32' }, () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Reference\n');
    closed(root);
    symlinkSync(path.join(root, 'docs', 'archive'), path.join(root, 'aa-alias'));
    gitAll(root);
    const r = cli(root, ['fold', '1']);
    assert.equal(r.code, 0, r.err);
    assert.equal(logLines(root).length, 1);
  } finally {
    cleanup(root);
  }
});
