// The new, mv, status and adr commands as real processes in a temporary project.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FIELD, KILLED, RU_COMMANDS, SECTION, changelogTool, cleanup, cli, escapeRe, fieldRe, gitAll, killedRe, makeProject, put, read, ru, ruCard, ruOutcome, ruRe, ruResult, run, toolCli } from './helpers.mjs';
import { markGenerated } from '../lib/adapter-ownership.js';
import { loadProject } from '../lib/config.js';
import { toPosix } from '../lib/util.js';
import { listReleaseTags } from '../lib/upgrade.js';

// Gate 4 requires an "Area" on a task outside triage/: fixtures that bring lint to green fill the
// stubs from `new` with this helper: the stub check of gate 4 sees them across the whole backlog.
function fillArea(root, rel) {
  const text = read(root, rel).replace(new RegExp(`\\*\\*${FIELD.area}:\\*\\* .*`), `**${FIELD.area}:** [x](../../README.md)`);
  put(root, rel, text
    .replace(/^\s*-\s*\[TODO[^\]]*\](?:\([^)]*\))?\s*$/gm, '- done')
    .replace(/^\s*\[TODO[^\]]*\]\s*$/gm, 'done'));
}

// A non-ASCII directory name built from code points: the test is about git quoting such paths.
const NON_ASCII_DIR = String.fromCodePoint(0x434, 0x43e, 0x43a, 0x438);
const found = (id) => ru('Finding discovered while working on {id}.', { id });
const EVIDENCE_STUB = ru('Evidence: [TODO: file path or command output]');
const taken = (id, source) => ru('{blockerId} is taken: {source}', { blockerId: id, source });
const TAKEN_ANY = new RegExp(`${ruRe('{blockerId} is taken: {source}').source}|is taken`);
const NO_REPO = new RegExp(escapeRe(ru('no git repository — the body of a folded task can only be read from history').split(' — ')[0]));
const extraRe = (extra) => new RegExp(`^✖ ${escapeRe(ru('extra argument “{extra}”: the command takes no positional arguments; quote a value with spaces', { extra }).split(':')[0])}`);
const flagRefusal = (en, flag) => `✖ ${ru(en, { flag })}\n`;
const NO_EVIDENCE = ruRe('{ids}: no evidence for minor/ — the “Evidence” section is missing, empty, or a [TODO] placeholder, and the entry goes to a batch without review.');
const READY_REASON = ru('- **Reason:** [TODO]').replace('[TODO]', 'already reviewed');
const READY_RETURN = ru('- **Return condition:** [TODO: what must happen before this returns to the queue]').replace(/\[TODO.*\]/, 'return after the check');
const AREA = '[x](../../README.md)';
const ANCHOR = SECTION.context.toLowerCase();
const CYRILLIC = /\p{Script=Cyrillic}/u;
const TOUCHED = ru('documentation touched by {id} — copy what belongs into “Documentation in the same pass”:', { id: '\0' }).split('\0')[0];
const rankOf = (root, n) => read(root, `docs/backlog/queue/BS-${n}.md`).match(fieldRe('order', ' (\\d+)'))[1];
const DISCARDED = ruRe('{id}: saved position {dropped} discarded — --restore would have put it back');

test('new: a task goes to triage by default, to the queue with an order, a finding with a sub-ID', () => {
  const root = makeProject();
  try {
    let r = cli(root, ['new', 'first', '--title', 'First']);
    assert.equal(r.code, 0, r.err);
    assert.ok(existsSync(path.join(root, 'docs/backlog/triage/BS-1-first.md')));
    assert.match(read(root, 'docs/backlog/triage/BS-1-first.md'), /^# BS-1 · First\n/);

    r = cli(root, ['new', 'second', '--queue']);
    assert.equal(r.code, 0, r.err);
    assert.match(read(root, 'docs/backlog/queue/BS-2-second.md'), fieldRe('order', ' 10\\n'));
    r = cli(root, ['new', 'third', '--queue']);
    assert.match(read(root, 'docs/backlog/queue/BS-3-third.md'), fieldRe('order', ' 20\\n'));
    r = cli(root, ['new', 'urgent', '--queue', '--top']);
    assert.equal(r.code, 0, r.err);
    assert.match(read(root, 'docs/backlog/queue/BS-4-urgent.md'), fieldRe('order', ' 5\\n'));

    r = cli(root, ['new', 'finding', '--parent', '2']);
    assert.equal(r.code, 0, r.err);
    const finding = read(root, 'docs/backlog/triage/BS-2.1-finding.md');
    assert.match(finding, /^# BS-2\.1 · finding\n/);
    assert.match(finding, new RegExp(escapeRe(found('BS-2'))));
    r = cli(root, ['new', 'finding-two', '--parent', 'BS-2']);
    assert.ok(existsSync(path.join(root, 'docs/backlog/triage/BS-2.2-finding-two.md')));

    r = cli(root, ['new', 'orphan', '--parent', '99']);
    assert.equal(r.code, 1);
    assert.match(r.err, ruRe('task {id} was not found in any status directory'));
    r = cli(root, ['new', 'Bad_Slug']);
    assert.equal(r.code, 1);
    assert.match(r.err, /slug/);
    r = cli(root, ['new', 'x', '--top']);
    assert.equal(r.code, 1);
  } finally {
    cleanup(root);
  }
});

test('new: a fractional parent accepts a finding and keeps the link in the Parent field', () => {
  const root = makeProject();
  try {
    put(root, 'docs/backlog/triage/BS-007-root.md', '# BS-007 · Root\n');
    put(root, 'docs/backlog/triage/BS-007.1-finding.md', '# BS-007.1 · Finding\n');
    const r = cli(root, ['new', 'child', '--parent', '7.1']);
    assert.equal(r.code, 0, r.err);
    const child = read(root, 'docs/backlog/triage/BS-007.2-child.md');
    assert.match(child, /^# BS-007\.2 · child\n/);
    assert.match(child, fieldRe('parent', ' BS-007\\.1\\n'));
    assert.match(child, new RegExp(`${escapeRe(found('BS-007.1'))}\\n${escapeRe(EVIDENCE_STUB)}\\n`));
    fillArea(root, 'docs/backlog/triage/BS-007.2-child.md');
    // The stub gate does not look into triage/: the entry waits there for review, nobody fills it.
    let lint = cli(root, ['lint']);
    assert.equal(lint.code, 0, lint.err);
    // A reviewed finding is no triage/ entry any more: an unfilled evidence line reddens the gate.
    assert.equal(cli(root, ['mv', '7.2', 'queue']).code, 0);
    lint = cli(root, ['lint']);
    assert.equal(lint.code, 1, 'an unfilled evidence line of a reviewed finding must redden lint');
    assert.match(lint.err, new RegExp(`BS-007\\.2-child\\.md: ${ruRe('line {line}: the [TODO] placeholder remains').source}`));
    put(root, 'docs/backlog/queue/BS-007.2-child.md', read(root, 'docs/backlog/queue/BS-007.2-child.md')
      .replace(EVIDENCE_STUB, `${SECTION.evidence}: check output`));
    lint = cli(root, ['lint']);
    assert.equal(lint.code, 0, lint.err);
  } finally {
    cleanup(root);
  }
});

test('new: the number and sub-ID count the files of a foreign worktree and the commits of a foreign branch, the output names the source', () => {
  const root = makeProject();
  const wt = path.join(mkdtempSync(path.join(os.tmpdir(), 'backslop-wt-')), 'worker');
  const git = (...args) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  try {
    cli(root, ['new', 'a', '--queue']);
    gitAll(root);
    assert.equal(git('worktree', 'add', '-q', wt, '-b', 'worker').status, 0);

    // The files in the foreign worktree are not committed yet — counted from disk.
    let r = cli(root, ['new', 'b'], { cwd: wt });
    assert.equal(r.code, 0, r.err);
    r = cli(root, ['new', 'f', '--parent', '1'], { cwd: wt });
    assert.equal(r.code, 0, r.err);
    assert.ok(existsSync(path.join(wt, 'docs/backlog/triage/BS-1.1-f.md')));
    r = cli(root, ['new', 'c']);
    assert.equal(r.code, 0, r.err);
    assert.ok(existsSync(path.join(root, 'docs/backlog/triage/BS-3-c.md')), 'BS-2 is taken by the worktree');
    assert.match(r.out, new RegExp(`${escapeRe(taken('BS-2', 'worktree '))}.*worker \\(worker\\)`));
    r = cli(root, ['new', 'g', '--parent', '1']);
    assert.equal(r.code, 0, r.err);
    assert.ok(existsSync(path.join(root, 'docs/backlog/triage/BS-1.2-g.md')), 'BS-1.1 is taken by the worktree');
    assert.match(r.out, new RegExp(escapeRe(taken('BS-1.1', 'worktree '))));

    // The worktree is removed, the branch stays — counted from the branch tree.
    spawnSync('git', ['-C', wt, 'add', '-A'], { encoding: 'utf8' });
    spawnSync('git', ['-C', wt, 'commit', '-qm', 'worker'], { encoding: 'utf8' });
    assert.equal(git('worktree', 'remove', '--force', wt).status, 0);
    rmSync(path.join(root, 'docs/backlog/triage/BS-3-c.md'));
    rmSync(path.join(root, 'docs/backlog/triage/BS-1.2-g.md'));
    r = cli(root, ['new', 'd']);
    assert.equal(r.code, 0, r.err);
    assert.ok(existsSync(path.join(root, 'docs/backlog/triage/BS-3-d.md')), 'BS-2 is taken by the branch');
    assert.match(r.out, new RegExp(escapeRe(taken('BS-2', ru('branch {branch}', { branch: 'worker' })))));
    r = cli(root, ['new', 'h', '--parent', '1']);
    assert.equal(r.code, 0, r.err);
    assert.ok(existsSync(path.join(root, 'docs/backlog/triage/BS-1.2-h.md')), 'BS-1.1 is taken by the branch');
    // A free number without foreign ones — no message about the source.
    r = cli(root, ['new', 'e']);
    assert.equal(r.code, 0, r.err);
    assert.ok(existsSync(path.join(root, 'docs/backlog/triage/BS-4-e.md')));
    assert.doesNotMatch(r.out, ruRe('{blockerId} is taken: {source}'));
  } finally {
    cleanup(root);
    rmSync(path.dirname(wt), { recursive: true, force: true });
  }
});

// BS-1 committed on main, BS-2 committed only on branch `worker`; `new c` then runs on main.
function takenOnWorker(repo, project, docs = 'docs') {
  put(project, 'backslop.json', `${JSON.stringify({ ...JSON.parse(read(project, 'backslop.json')), lang: 'en' }, null, 2)}\n`);
  assert.equal(cli(project, ['new', 'a']).code, 0);
  gitAll(repo, 'BS-1: a');
  run(repo, ['checkout', '-q', '-b', 'worker']);
  assert.equal(cli(project, ['new', 'b']).code, 0);
  gitAll(repo, 'BS-2: b');
  run(repo, ['checkout', '-q', 'main']);
  const r = cli(project, ['new', 'c']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(readdirSync(path.join(project, docs, 'backlog', 'triage')).sort(), ['BS-1-a.md', 'BS-3-c.md']);
  assert.match(r.out, /BS-2 is taken: branch worker/);
}

test('new: a project in a repository subdirectory sees the numbers taken on another branch', () => {
  const root = makeProject();
  try {
    const project = path.join(root, 'pkg', 'a');
    mkdirSync(project, { recursive: true });
    for (const name of ['backslop.json', 'docs']) renameSync(path.join(root, name), path.join(project, name));
    takenOnWorker(root, project);
  } finally {
    cleanup(root);
  }
});

test('new: a non-ASCII docs directory sees the numbers taken on another branch', () => {
  const root = makeProject({ docs: NON_ASCII_DIR });
  try {
    // Pinned against a global core.quotePath=false, which would hide the quoted listing.
    run(root, ['config', 'core.quotePath', 'true']);
    takenOnWorker(root, root, NON_ASCII_DIR);
  } finally {
    cleanup(root);
  }
});

test('new: a committed predecessor on the only branch is not named as taken elsewhere', () => {
  const root = makeProject();
  try {
    assert.equal(cli(root, ['new', 'alpha', '--queue']).code, 0);
    assert.equal(cli(root, ['new', 'alpha-finding', '--parent', '1']).code, 0);
    gitAll(root);
    let r = cli(root, ['new', 'beta', '--queue']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /✔ BS-2: /);
    assert.doesNotMatch(r.out, TAKEN_ANY);
    r = cli(root, ['new', 'beta-finding', '--parent', '1']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /✔ BS-1\.2: /);
    assert.doesNotMatch(r.out, TAKEN_ANY);
  } finally {
    cleanup(root);
  }
});

test('new: a git call that fails while scanning other worktrees and branches refuses instead of numbering blind', { skip: process.platform === 'win32' }, () => {
  const root = makeProject();
  const shim = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-git-shim-')));
  try {
    put(root, 'docs/archive/LOG.md', '# Log\n');
    assert.equal(cli(root, ['new', 'a']).code, 0);
    gitAll(root, 'BS-1: a');
    run(root, ['branch', 'worker']);
    const real = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
    writeFileSync(path.join(shim, 'git'), `#!/bin/sh\nfor a in "$@"; do [ "$a" = "$KILL_ON" ] && kill -9 $$; done\nexec "${real}" "$@"\n`, { mode: 0o755 });
    const cases = [
      ['--is-inside-work-tree', killedRe('git rev-parse --is-inside-work-tree')],
      ['--show-toplevel', killedRe('git rev-parse --show-toplevel')],
      ['worktree', killedRe('git worktree list --porcelain')],
      ['for-each-ref', new RegExp(`git for-each-ref .*: ${escapeRe(KILLED)}`)],
      ['ls-tree', new RegExp(`git ls-tree .*: ${escapeRe(KILLED)}`)],
      ['show', killedRe('git show main:docs/archive/LOG.md')],
    ];
    for (const [arg, cause] of cases) {
      const r = cli(root, ['new', 'c'], { env: { KILL_ON: arg, PATH: `${shim}${path.delimiter}${process.env.PATH}` } });
      assert.equal(r.code, 1, `${arg}: ${r.out}`);
      assert.match(r.err, cause);
      assert.deepEqual(readdirSync(path.join(root, 'docs/backlog/triage')), ['BS-1-a.md'], `${arg}: no file`);
    }
  } finally {
    cleanup(root);
    rmSync(shim, { recursive: true, force: true });
  }
});

test('show and fold: a git failure other than "not a repository" refuses with the cause', { skip: process.platform === 'win32' }, () => {
  const root = makeProject();
  const shim = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-git-shim-')));
  try {
    put(root, 'docs/reference/README.md', '# Reference\n');
    for (const [n, slug] of [[1, 'alpha'], [2, 'beta']]) {
      put(root, `docs/archive/BS-${n}-${slug}/task.md`, ruCard(`BS-${n}`, slug, { area: '[x](../../reference/README.md)' }, [['context', 'text']]));
      put(root, `docs/archive/BS-${n}-${slug}/result.md`, ruResult(`BS-${n}`, '2026-09-03', `${ruOutcome('completed')}. Summary.`));
    }
    gitAll(root);
    assert.equal(cli(root, ['fold', '1']).code, 0);
    gitAll(root, 'fold');
    const real = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
    writeFileSync(path.join(shim, 'git'), `#!/bin/sh\nfor a in "$@"; do [ "$a" = "$KILL_ON" ] && kill -9 $$; done\nexec "${real}" "$@"\n`, { mode: 0o755 });
    const env = (arg) => ({ env: { KILL_ON: arg, PATH: `${shim}${path.delimiter}${process.env.PATH}` } });

    let r = cli(root, ['show', '1'], env('rev-parse'));
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, killedRe('git rev-parse --is-inside-work-tree'));
    assert.doesNotMatch(r.err, NO_REPO);

    r = cli(root, ['fold', '2'], env('ls-files'));
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, killedRe('git ls-files --error-unmatch'));
    assert.ok(existsSync(path.join(root, 'docs/archive/BS-2-beta/task.md')), 'the directory stays');
    assert.doesNotMatch(read(root, 'docs/archive/LOG.md'), /bs-2/, 'the journal is untouched');
  } finally {
    cleanup(root);
    rmSync(shim, { recursive: true, force: true });
  }
});

test('archive --range: a git failure other than "not a repository" refuses with the cause, the card stays', { skip: process.platform === 'win32' }, () => {
  const root = makeProject();
  const shim = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-git-shim-')));
  try {
    put(root, 'docs/reference/README.md', '# Reference\n');
    put(root, 'docs/backlog/active/BS-1-a.md', ruCard('BS-1', 'A', { area: '[x](../../reference/README.md)', taken: '2026-09-01' }));
    gitAll(root, 'base');
    put(root, 'docs/reference/README.md', '# Reference\n\nedit\n');
    gitAll(root, 'BS-1: docs');
    const real = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
    writeFileSync(path.join(shim, 'git'), `#!/bin/sh\nfor a in "$@"; do [ "$a" = rev-parse ] && kill -9 $$; done\nexec "${real}" "$@"\n`, { mode: 0o755 });

    const r = cli(root, ['archive', '1', '--range', 'HEAD~1..HEAD'], { env: { PATH: `${shim}${path.delimiter}${process.env.PATH}` } });
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, killedRe('git rev-parse --is-inside-work-tree'));
    assert.doesNotMatch(r.err, NO_REPO);
    assert.ok(existsSync(path.join(root, 'docs/backlog/active/BS-1-a.md')), 'the card is not moved');
  } finally {
    cleanup(root);
    rmSync(shim, { recursive: true, force: true });
  }
});

test('new: without a git binary the number comes from the working tree', { skip: process.platform === 'win32' }, () => {
  const root = makeProject();
  const empty = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-no-git-')));
  try {
    const r = cli(root, ['new', 'a'], { env: { PATH: empty } });
    assert.equal(r.code, 0, r.err);
    assert.ok(existsSync(path.join(root, 'docs/backlog/triage/BS-1-a.md')));
  } finally {
    cleanup(root);
    rmSync(empty, { recursive: true, force: true });
  }
});

test('new: a translated "not a git repository" is still no repository', { skip: process.platform === 'win32' }, () => {
  const root = makeProject({ git: false });
  const shim = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-git-shim-')));
  try {
    writeFileSync(path.join(shim, 'git'), '#!/bin/sh\nif [ "$LC_ALL" = C ]; then echo "fatal: not a git repository" >&2; else echo "fatal: kein Git-Repository gefunden" >&2; fi\nexit 128\n', { mode: 0o755 });
    const r = cli(root, ['new', 'a'], { env: { LC_ALL: 'ru_RU.UTF-8', PATH: `${shim}${path.delimiter}${process.env.PATH}` } });
    assert.equal(r.code, 0, r.err);
    assert.ok(existsSync(path.join(root, 'docs/backlog/triage/BS-1-a.md')));
  } finally {
    cleanup(root);
    rmSync(shim, { recursive: true, force: true });
  }
});

test('new/adr: a --title value with a leading dash is accepted, the name of a known flag is refused with a --title= hint', () => {
  const root = makeProject();
  try {
    let r = cli(root, ['new', 'strategy-flag', '--title', '--strategy on spawn and review', '--queue']);
    assert.equal(r.code, 0, r.err);
    assert.match(read(root, 'docs/backlog/queue/BS-1-strategy-flag.md'), /^# BS-1 · --strategy on spawn and review\n/);
    r = cli(root, ['new', 'dash', '--title', '-x']);
    assert.equal(r.code, 0, r.err);
    assert.match(read(root, 'docs/backlog/triage/BS-2-dash.md'), /^# BS-2 · -x\n/);
    r = cli(root, ['adr', 'flag', '--title', '--flag as a title']);
    assert.equal(r.code, 0, r.err);
    assert.match(read(root, 'docs/adr/adr-001-flag.md'), /^# ADR-001: --flag as a title\n/);
    r = cli(root, ['new', 'ambiguous', '--title', '--queue']);
    assert.equal(r.code, 1);
    assert.match(r.err, /--title=/);
    assert.ok(!existsSync(path.join(root, 'docs/backlog/triage/BS-3-ambiguous.md')));
    r = cli(root, ['new', 'explicit', '--title=--queue']);
    assert.equal(r.code, 0, r.err);
    assert.match(read(root, 'docs/backlog/triage/BS-3-explicit.md'), /^# BS-3 · --queue\n/);
  } finally {
    cleanup(root);
  }
});

test('new/adr: a blank or whitespace-only --title falls back to the slug', () => {
  const root = makeProject();
  try {
    for (const [title, slug, n] of [['', 'a', 1], ['   ', 'b', 2]]) {
      const r = cli(root, ['new', slug, '--queue', '--title', title]);
      assert.equal(r.code, 0, r.err);
      assert.match(read(root, `docs/backlog/queue/BS-${n}-${slug}.md`), new RegExp(`^# BS-${n} · ${slug}\n`));
    }
    for (const [title, slug, n] of [['', 'x', 1], ['  ', 'y', 2]]) {
      const r = cli(root, ['adr', slug, '--title', title]);
      assert.equal(r.code, 0, r.err);
      assert.match(read(root, `docs/adr/adr-00${n}-${slug}.md`), new RegExp(`^# ADR-00${n}: ${slug}\n`));
    }
    const r = cli(root, ['status']);
    assert.doesNotMatch(r.out, new RegExp(`untitled|${escapeRe(ru('(untitled)', { of: 'adr' }))}`));
  } finally {
    cleanup(root);
  }
});

test('new/adr: -h and --help given as an option value are the value, not a help request', () => {
  const root = makeProject();
  try {
    let r = cli(root, ['new', 'x', '--title', '-h']);
    assert.equal(r.code, 0, r.err);
    assert.match(read(root, 'docs/backlog/triage/BS-1-x.md'), /^# BS-1 · -h\n/);
    r = cli(root, ['new', 'y', '--title', '--help']);
    assert.equal(r.code, 0, r.err);
    assert.match(read(root, 'docs/backlog/triage/BS-2-y.md'), /^# BS-2 · --help\n/);
    r = cli(root, ['new', 'z', '--parent', '1', '--minor', '--evidence', '--help']);
    assert.equal(r.code, 0, r.err);
    assert.match(read(root, 'docs/backlog/minor/BS-1.1-z.md'), new RegExp(`Evidence: --help|${SECTION.evidence}: --help`));
    r = cli(root, ['adr', 'x', '--title', '-h']);
    assert.equal(r.code, 0, r.err);
    assert.match(read(root, 'docs/adr/adr-001-x.md'), /^# ADR-001: -h\n/);
    assert.doesNotMatch(r.out, new RegExp(`${RU_COMMANDS}|Commands:`), 'help printed instead of creating the ADR');
    r = cli(root, ['new', '--help']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, new RegExp(RU_COMMANDS));
  } finally {
    cleanup(root);
  }
});

test('an extra positional is refused with exit 1 and named; mv and brief take several', () => {
  const root = makeProject();
  try {
    let r = cli(root, ['new', 'ee', '--title', 'My', 'Title']);
    assert.equal(r.code, 1, r.out);
    assert.equal(r.err, `✖ ${ru('extra argument “{extra}”: at most {limit} positional argument{s}; quote a value with spaces', { extra: 'Title', limit: 1, s: '' })}\n`);
    assert.deepEqual(readdirSync(path.join(root, 'docs/backlog/triage')), [], 'the task was created anyway');
    for (const [args, extra] of [
      [['lint', 'extra'], 'extra'], [['status', 'bogus'], 'bogus'], [['gates', 'extra', '--dry-run'], 'extra'],
      [['init', 'extra-positional'], 'extra-positional'], [['new', 'a', '--', '--queue'], '--queue'],
      [['adr', 'x', 'extra'], 'extra'], [['show', '1', '2'], '2'], [['archive', '1', '999', '--dry-run'], '999'],
      [['tracks', 'x'], 'x'], [['seed', '--scan', 'x'], 'x'], [['changelog', 'x'], 'x'], [['merge-changelog', 'x'], 'x'],
      [['upgrade', 'x'], 'x'], [['migrate', 'x'], 'x'], [['links', 'x', '--external'], 'x'],
      [['hook', 'stop', 'extra'], 'extra'],
    ]) {
      r = cli(root, args);
      assert.equal(r.code, 1, `${args.join(' ')}: ${r.out}`);
      assert.match(r.err, extraRe(extra), args.join(' '));
    }
    r = cli(root, ['fold', '1', '2']);
    assert.equal(r.code, 1);
    assert.equal(r.err, `✖ ${ru('a single task number is expected: bulk folding is the same command without a number')}\n`);
    r = cli(root, ['status', 'bogus', '--help']);
    assert.equal(r.code, 1, 'an extra positional wins over --help, as an unknown flag does');
    assert.equal(cli(root, ['new', 'a']).code, 0);
    assert.equal(cli(root, ['new', 'b']).code, 0);
    r = cli(root, ['mv', '1', '2', 'queue']);
    assert.equal(r.code, 0, r.err);
    r = cli(root, ['brief', '1', '2']);
    assert.equal(r.code, 0, r.err);
    r = cli(root, ['new', 'beta', '--help']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, new RegExp(RU_COMMANDS));
    assert.ok(!existsSync(path.join(root, 'docs/backlog/triage/BS-3-beta.md')), 'new --help created a task');
  } finally {
    cleanup(root);
  }
});

test('argv refusals speak the project language, and both languages outside a project', () => {
  const root = makeProject();
  try {
    let r = cli(root, ['status', '--bogus']);
    assert.equal(r.code, 1);
    assert.equal(r.err, flagRefusal('unknown option “{flag}”; see the command’s --help for its flags', '--bogus'));
    r = cli(root, ['new', 'x', '--title']);
    assert.equal(r.code, 1);
    assert.equal(r.err, flagRefusal('{flag} needs a value', '--title'));
    r = cli(root, ['new', 'x', '--queue=yes']);
    assert.equal(r.code, 1);
    assert.equal(r.err, flagRefusal('{flag} takes no value', '--queue'));
    r = cli(root, ['status', '--help=1']);
    assert.equal(r.code, 1);
    assert.equal(r.err, flagRefusal('{flag} takes no value', '--help'));
    r = cli(root, ['new', 'x', '--title', '--queue']);
    assert.equal(r.code, 1);
    assert.match(r.err, new RegExp(`^✖ ${ruRe('{flag}: a flag of this command stands where its value should be; a value that starts with a dash goes in the form {flag}=…', { flag: '--title' }).source}\\n$`));
    put(root, 'backslop.json', `${JSON.stringify({ ...JSON.parse(read(root, 'backslop.json')), lang: 'en' }, null, 2)}\n`);
    r = cli(root, ['status', '--bogus']);
    assert.equal(r.err, '✖ unknown option “--bogus”; see the command’s --help for its flags\n');
    r = cli(root, ['status', 'bogus']);
    assert.equal(r.err, '✖ extra argument “bogus”: the command takes no positional arguments; quote a value with spaces\n');
    r = cli(root, ['status', '--bogus'], { cwd: path.dirname(root) });
    assert.equal(r.code, 1);
    assert.equal(r.err, `✖ unknown option “--bogus”; see the command’s --help for its flags / ${ru('unknown option “{flag}”; see the command’s --help for its flags', { flag: '--bogus' })}\n`);
    assert.doesNotMatch(r.err, /To specify a positional argument/, 'Node’s hint about -- is gone');
  } finally {
    cleanup(root);
  }
});

test('new: dates are the machine’s local calendar date, not UTC', () => {
  const root = makeProject({ git: false });
  try {
    assert.equal(cli(root, ['new', 'east'], { env: { TZ: 'Etc/GMT-14' } }).code, 0);
    assert.equal(cli(root, ['new', 'west'], { env: { TZ: 'Etc/GMT+12' } }).code, 0);
    const east = read(root, 'docs/backlog/triage/BS-1-east.md').match(fieldRe('created', ' (\\S+)'))[1];
    const west = read(root, 'docs/backlog/triage/BS-2-west.md').match(fieldRe('created', ' (\\S+)'))[1];
    assert.match(east, /^\d{4}-\d{2}-\d{2}$/);
    assert.notEqual(east, west, 'UTC+14 and UTC−12 are 26 hours apart and never fall on one day');
  } finally {
    cleanup(root);
  }
});

function threeQueued() {
  const root = makeProject();
  cli(root, ['new', 'a', '--queue']);
  cli(root, ['new', 'b', '--queue']);
  cli(root, ['new', 'c', '--queue']);
  gitAll(root);
  return root;
}

test('mv: queue → active sets the taken date and drops the order', () => {
  const root = threeQueued();
  try {
    const r = cli(root, ['mv', '1', 'active']);
    assert.equal(r.code, 0, r.err);
    assert.ok(!existsSync(path.join(root, 'docs/backlog/queue/BS-1-a.md')));
    const active = read(root, 'docs/backlog/active/BS-1-a.md');
    assert.match(active, fieldRe('taken', ' \\d{4}-\\d{2}-\\d{2}\\n'));
    assert.doesNotMatch(active, new RegExp(FIELD.order));
  } finally {
    cleanup(root);
  }
});

test('mv: a queued task is reordered by --top or --after; a bare move and --after itself are refused', () => {
  const root = threeQueued();
  try {
    // The task is already in the queue: --top/--after only change the "Order", the file stays put.
    let r = cli(root, ['mv', 'BS-3', 'queue', '--top']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, new RegExp(escapeRe(ru('{id}: queue/ “{field}” {rank}', { id: 'BS-3', field: FIELD.order, rank: 5 }))));
    assert.match(read(root, 'docs/backlog/queue/BS-3-c.md'), fieldRe('order', ' 5\\n'));
    assert.ok(existsSync(path.join(root, 'docs/backlog/queue/BS-3-c.md')));
    r = cli(root, ['mv', '3', 'queue']);
    assert.equal(r.code, 1);
    assert.match(r.err, ruRe('{id} is already in queue/; give a position: --top, --after M or --restore'));
    r = cli(root, ['mv', '3', 'queue', '--after', '3']);
    assert.equal(r.code, 1);
    assert.match(r.err, ruRe('--after {id}: a task cannot follow itself'));
    r = cli(root, ['mv', '3', 'triage']);
    assert.equal(r.code, 0, r.err);
    r = cli(root, ['mv', '3', 'queue', '--after', '2']);
    assert.equal(r.code, 0, r.err);
    assert.match(read(root, 'docs/backlog/queue/BS-3-c.md'), fieldRe('order', ' 30\\n'));
  } finally {
    cleanup(root);
  }
});

test('mv: deferred adds its section; a second move there is refused', () => {
  const root = threeQueued();
  try {
    let r = cli(root, ['mv', '2', 'deferred']);
    assert.equal(r.code, 0, r.err);
    const deferred = read(root, 'docs/backlog/deferred/BS-2-b.md');
    assert.match(deferred, new RegExp(`## ${SECTION.deferred}\\n\\n${escapeRe(ru('- **Deferred:** {date}', { date: '' }))}\\d{4}`));
    assert.doesNotMatch(deferred, new RegExp(FIELD.order));

    r = cli(root, ['mv', '2', 'deferred']);
    assert.equal(r.code, 1);
    assert.match(r.err, ruRe('{id} is already in {target}/', { target: 'deferred' }));
  } finally {
    cleanup(root);
  }
});

test('mv: an unknown status or an unknown task number is refused', () => {
  const root = threeQueued();
  try {
    let r = cli(root, ['mv', '2', 'done']);
    assert.equal(r.code, 1);
    r = cli(root, ['mv', '7', 'queue']);
    assert.equal(r.code, 1);
    assert.match(r.err, ruRe('task {id} was not found in any status directory'));
  } finally {
    cleanup(root);
  }
});

test('mv: an --after refusal names the task with its prefix', () => {
  const root = makeProject();
  try {
    cli(root, ['new', 'a', '--queue']);
    cli(root, ['new', 'b', '--queue']);
    cli(root, ['new', 'c']);
    put(root, 'docs/backlog/queue/BS-2-b.md', read(root, 'docs/backlog/queue/BS-2-b.md').replace(new RegExp(`${FIELD.order}:\\*\\* 20`), `${FIELD.order}:** x`));
    let r = cli(root, ['mv', '3', 'queue', '--after', '12']);
    assert.equal(r.code, 1);
    assert.match(r.err, ruRe('task {label} is not in the queue — --after expects a task from queue/', { label: 'BS-12' }));
    r = cli(root, ['mv', '3', 'queue', '--after', '2']);
    assert.equal(r.code, 1);
    assert.match(r.err, ruRe('queue task {label} has no integer “{field}” — fix it first', { label: 'BS-2' }));
  } finally {
    cleanup(root);
  }
});

test('mv: a ready "Deferred" section is not duplicated and a hint says to check it', () => {
  const root = makeProject();
  try {
    put(root, 'docs/backlog/queue/BS-1-ready.md', `${ruCard('BS-1', 'Ready', { order: 10, area: AREA })}\n## ${SECTION.deferred}\n\n${READY_REASON}\n${READY_RETURN}\n`);
    gitAll(root);
    const r = cli(root, ['mv', '1', 'deferred']);
    assert.equal(r.code, 0, r.err);
    const moved = read(root, 'docs/backlog/deferred/BS-1-ready.md');
    assert.equal((moved.match(new RegExp(`^## ${SECTION.deferred}$`, 'gm')) ?? []).length, 1);
    assert.ok(moved.includes(READY_REASON));
    assert.match(r.out, ruRe('section exists; check the reason and return condition'));
  } finally {
    cleanup(root);
  }
});

test('mv: a fenced-only section heading does not replace the real section', () => {
  const root = makeProject();
  try {
    put(root, 'docs/backlog/queue/BS-1-fenced.md', `${ruCard('BS-1', 'Fenced', { order: 10, area: AREA })}\n\`\`\`markdown\n## ${SECTION.deferred}\n${ru('- **Reason:** [TODO]').replace('[TODO]', 'example')}\n\`\`\`\n`);
    gitAll(root);
    const r = cli(root, ['mv', '1', 'deferred']);
    assert.equal(r.code, 0, r.err);
    const moved = read(root, 'docs/backlog/deferred/BS-1-fenced.md');
    assert.equal((moved.match(new RegExp(`^## ${SECTION.deferred}$`, 'gm')) ?? []).length, 2);
    assert.match(moved, new RegExp(`## ${SECTION.deferred}\\n\\n${escapeRe(ru('- **Deferred:** {date}', { date: '' }))}`));
  } finally {
    cleanup(root);
  }
});

test('mv: a duplicated field is read first, queue --top collapses it, active removes it whole', () => {
  const root = makeProject();
  try {
    put(root, 'docs/backlog/queue/BS-1-duplicate.md', `# BS-1 · Duplicate\n\n- **${FIELD.order}:** 30\n- **Order:** 25\n- **${FIELD.area}:** ${AREA}\n`);
    put(root, 'docs/backlog/queue/BS-2-second.md', ruCard('BS-2', 'Second', { order: 10, area: AREA }));
    put(root, 'docs/backlog/queue/BS-3-third.md', ruCard('BS-3', 'Third', { order: 20, area: AREA }));
    gitAll(root);

    let r = cli(root, ['status']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /\n\s+30  BS-1 · Duplicate/);
    assert.equal(cli(root, ['lint']).code, 1, 'lint must catch the duplicate before the command');

    r = cli(root, ['mv', '1', 'queue', '--top']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, new RegExp(escapeRe(ru('{id}: queue/ “{field}” {rank}', { id: 'BS-1', field: FIELD.order, rank: 5 }))));
    assert.equal(read(root, 'docs/backlog/queue/BS-1-duplicate.md'), ruCard('BS-1', 'Duplicate', { order: 5, area: AREA }));
    r = cli(root, ['status']);
    assert.match(r.out, /\n\s+5  BS-1 · Duplicate/);
    assert.equal(cli(root, ['lint']).code, 0);

    r = cli(root, ['mv', '1', 'active']);
    assert.equal(r.code, 0, r.err);
    const active = read(root, 'docs/backlog/active/BS-1-duplicate.md');
    assert.doesNotMatch(active, new RegExp(`(?:Order|${FIELD.order}):`));
    assert.equal(cli(root, ['lint']).code, 0);
  } finally {
    cleanup(root);
  }
});

test('mv: leaving the queue keeps the "Previous order", --restore puts the place back', () => {
  const root = makeProject();
  try {
    cli(root, ['new', 'a', '--queue']); // 10
    cli(root, ['new', 'b', '--queue']); // 20
    cli(root, ['new', 'c', '--queue']); // 30
    for (const n of ['1-a', '2-b', '3-c']) fillArea(root, `docs/backlog/queue/BS-${n}.md`);
    gitAll(root);

    // Leaving the queue: no active "Order", but the rank is not lost.
    let r = cli(root, ['mv', '2', 'active']);
    assert.equal(r.code, 0, r.err);
    const active = read(root, 'docs/backlog/active/BS-2-b.md');
    assert.doesNotMatch(active, fieldRe('order'));
    assert.match(active, fieldRe('previousOrder', ' 20\\n'));
    assert.equal(cli(root, ['lint']).code, 0, 'a saved rank outside queue/ does not redden the fields gate');

    // The place is free — the task takes exactly it, the saved number is removed.
    r = cli(root, ['mv', '2', 'queue', '--restore']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, ruRe('“{field}” {saved} restored', { field: FIELD.order, saved: 20 }));
    const back = read(root, 'docs/backlog/queue/BS-2-b.md');
    assert.match(back, fieldRe('order', ' 20\\n'));
    assert.doesNotMatch(back, new RegExp(FIELD.previousOrder));
    assert.equal(cli(root, ['lint']).code, 0);

    // The saved number is gone: a refusal, not a quiet placement at the end.
    r = cli(root, ['mv', '2', 'queue', '--restore']);
    assert.equal(r.code, 1);
    assert.match(r.err, ruRe('no “{label}” field on {missing} — no position was saved', { label: FIELD.previousOrder }));
    assert.match(read(root, 'docs/backlog/queue/BS-2-b.md'), fieldRe('order', ' 20\\n'));
  } finally {
    cleanup(root);
  }
});

test('mv --restore: a taken place — the nearest free one, a tight queue is renumbered', () => {
  const root = makeProject();
  try {
    cli(root, ['new', 'a', '--queue']); // 10
    cli(root, ['new', 'b', '--queue']); // 20
    cli(root, ['new', 'c', '--queue']); // 30
    for (const n of ['1-a', '2-b', '3-c']) fillArea(root, `docs/backlog/queue/BS-${n}.md`);
    gitAll(root);

    assert.equal(cli(root, ['mv', '2', 'active']).code, 0); // "Previous order" 20
    assert.equal(cli(root, ['mv', '3', 'queue', '--after', '1']).code, 0); // BS-3 took 20
    let r = cli(root, ['mv', '2', 'queue', '--restore']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, ruRe('saved position {saved} is taken — “{field}” {rank}', { saved: 20, field: FIELD.order, rank: 15 }));
    assert.match(read(root, 'docs/backlog/queue/BS-2-b.md'), fieldRe('order', ' 15\\n'));
    assert.equal(cli(root, ['lint']).code, 0);

    // No whole place between the neighbour and the taken rank — the queue is renumbered in steps
    // of 10, and the restored task stays ahead of the one that took its number.
    put(root, 'docs/backlog/queue/BS-1-a.md', ruCard('BS-1', 'a', { order: 10, area: AREA }));
    put(root, 'docs/backlog/queue/BS-2-b.md', ruCard('BS-2', 'b', { order: 11, area: AREA }));
    put(root, 'docs/backlog/active/BS-3-c.md', ruCard('BS-3', 'c', { previousOrder: 11, area: AREA, taken: '2026-09-01' }));
    rmSync(path.join(root, 'docs/backlog/queue/BS-3-c.md'));
    gitAll(root);
    r = cli(root, ['mv', '3', 'queue', '--restore']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, ruRe('queue renumbered in steps of 10: {renumbered} files'));
    const ranks = ['1-a', '3-c', '2-b'].map((n) => rankOf(root, n));
    assert.deepEqual(ranks, ['10', '20', '30']);
    assert.equal(cli(root, ['lint']).code, 0);
  } finally {
    cleanup(root);
  }
});

test('mv --restore: outside queue, with another flag and on a batch — refusals; a non-integer number — a refusal', () => {
  const root = makeProject();
  try {
    cli(root, ['new', 'a', '--queue']);
    cli(root, ['new', 'b', '--queue']);
    for (const n of ['1-a', '2-b']) fillArea(root, `docs/backlog/queue/BS-${n}.md`);
    gitAll(root);

    let r = cli(root, ['mv', '1', 'active', '--restore']);
    assert.equal(r.code, 1);
    assert.match(r.err, ruRe('--top, --after and --restore are only valid when moving to queue'));
    r = cli(root, ['mv', '1', 'queue', '--restore', '--top']);
    assert.equal(r.code, 1);
    assert.match(r.err, ruRe('{flags} cannot be used together: there is one position', { flags: `--top${ru(' and ')}--restore` }));
    r = cli(root, ['mv', '1', '2', 'queue', '--top']);
    assert.equal(r.code, 1);
    assert.match(r.err, ruRe('a batch has no single position: --top and --after take one number; --restore reads the number from each task header'));
    // A --restore batch is allowed, but without saved numbers it refuses whole, naming each task.
    r = cli(root, ['mv', '1', '2', 'queue', '--restore']);
    assert.equal(r.code, 1);
    assert.match(r.err, ruRe('no “{label}” field on {missing} — no position was saved', { label: FIELD.previousOrder, missing: 'BS-1, BS-2' }));
    for (const n of ['1-a', '2-b']) assert.ok(existsSync(path.join(root, `docs/backlog/queue/BS-${n}.md`)), 'a batch refusal moves no task');

    put(root, 'docs/backlog/active/BS-3-c.md', ruCard('BS-3', 'c', { previousOrder: 'high', area: AREA, taken: '2026-09-01' }));
    gitAll(root);
    r = cli(root, ['mv', '3', 'queue', '--restore']);
    assert.equal(r.code, 1);
    assert.match(r.err, ruRe('“{label}” on {broken} is not an integer', { label: FIELD.previousOrder, broken: 'BS-3' }));
    assert.ok(existsSync(path.join(root, 'docs/backlog/active/BS-3-c.md')), 'the refusal is visible before the move');
  } finally {
    cleanup(root);
  }
});

test('mv --restore: the outcome of a batch does not depend on the argument order', () => {
  // Saved numbers 10 and 11 on a tight, taken queue: whoever stood first decided how the
  // neighbours were renumbered. Both call forms must give one queue.
  const restore = (ids) => {
    const root = makeProject();
    try {
      put(root, 'docs/backlog/queue/BS-5-e.md', ruCard('BS-5', 'e', { order: 10, area: AREA }));
      put(root, 'docs/backlog/queue/BS-6-f.md', ruCard('BS-6', 'f', { order: 11, area: AREA }));
      put(root, 'docs/backlog/active/BS-1-a.md', ruCard('BS-1', 'a', { previousOrder: 10, area: AREA, taken: '2026-09-01' }));
      put(root, 'docs/backlog/active/BS-2-b.md', ruCard('BS-2', 'b', { previousOrder: 11, area: AREA, taken: '2026-09-01' }));
      gitAll(root);
      const r = cli(root, ['mv', ...ids, 'queue', '--restore']);
      assert.equal(r.code, 0, r.err);
      assert.equal(cli(root, ['lint']).code, 0);
      return ['1-a', '5-e', '2-b', '6-f'].map((n) => rankOf(root, n));
    } finally {
      cleanup(root);
    }
  };
  assert.deepEqual(restore(['1', '2']), ['5', '10', '20', '30']);
  assert.deepEqual(restore(['2', '1']), ['5', '10', '20', '30']);
});

test('mv --restore: a wide gap before a taken number does not lead a task ahead of its batch neighbour', () => {
  const root = makeProject();
  try {
    // Queue 7/12, batch 13, 10, 8, 13. BS-2 (10) finds its place taken and stands at 5; BS-3 (8)
    // with a free number behind it stands before it, not on its own 8.
    put(root, 'docs/backlog/queue/BS-5-e.md', ruCard('BS-5', 'e', { order: 7, area: AREA }));
    put(root, 'docs/backlog/queue/BS-6-f.md', ruCard('BS-6', 'f', { order: 12, area: AREA }));
    for (const [n, slug, saved] of [['1', 'a', 13], ['2', 'b', 10], ['3', 'c', 8], ['4', 'd', 13]]) {
      put(root, `docs/backlog/active/BS-${n}-${slug}.md`, ruCard(`BS-${n}`, slug, { previousOrder: saved, area: AREA, taken: '2026-09-01' }));
    }
    gitAll(root);

    const r = cli(root, ['mv', '1', '2', '3', '4', 'queue', '--restore']);
    assert.equal(r.code, 0, r.err);
    const rank = (n) => Number(rankOf(root, n));
    const batch = ['3-c', '2-b', '1-a', '4-d'];
    assert.deepEqual(batch.map(rank), [...batch.map(rank)].sort((a, b) => a - b), 'the batch stands in ascending order of the saved numbers 8, 10, 13, 13');
    assert.deepEqual(['3-c', '2-b', '5-e', '6-f', '1-a', '4-d'].map(rank), [2, 5, 10, 20, 30, 40]);
    assert.match(r.out, ruRe('saved position {saved} falls behind {id} from the same batch — “{field}” {rank}, ahead of it', { saved: 8, id: 'BS-2', field: FIELD.order, rank: 2 }));
    assert.match(r.out, ruRe('saved position {saved} is taken — “{field}” {rank}', { saved: 10, field: FIELD.order, rank: 5 }));
    assert.equal(cli(root, ['lint']).code, 0);
  } finally {
    cleanup(root);
  }
});

test('mv --restore: the renumbering summary counts files, not hits', () => {
  const root = makeProject();
  try {
    // Three tasks on one saved place with rank 1 taken: the first and the third renumber the
    // queue, and BS-4 lands in the renumbered ones twice in one call.
    put(root, 'docs/backlog/queue/BS-4-d.md', ruCard('BS-4', 'd', { order: 1, area: AREA }));
    for (const [n, slug] of [['1', 'a'], ['2', 'b'], ['3', 'c']]) {
      put(root, `docs/backlog/active/BS-${n}-${slug}.md`, ruCard(`BS-${n}`, slug, { previousOrder: 1, area: AREA, taken: '2026-09-01' }));
    }
    gitAll(root);

    const r = cli(root, ['mv', '1', '2', '3', 'queue', '--restore']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, ruRe('queue renumbered in steps of 10: {renumbered} files', { renumbered: 3 }));
    assert.deepEqual(['1-a', '2-b', '3-c', '4-d'].map((n) => rankOf(root, n)), ['10', '20', '30', '40']);
    assert.equal(cli(root, ['lint']).code, 0);
  } finally {
    cleanup(root);
  }
});

test('mv N queue without --restore: the dropped place is named aloud, in a batch — for each task', () => {
  const root = makeProject();
  try {
    put(root, 'docs/backlog/active/BS-1-a.md', ruCard('BS-1', 'a', { previousOrder: 20, area: AREA, taken: '2026-09-01' }));
    put(root, 'docs/backlog/active/BS-2-b.md', ruCard('BS-2', 'b', { previousOrder: 30, area: AREA, taken: '2026-09-01' }));
    put(root, 'docs/backlog/active/BS-3-c.md', ruCard('BS-3', 'c', { area: AREA, taken: '2026-09-01' }));
    gitAll(root);

    const r = cli(root, ['mv', '1', '2', '3', 'queue']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, ruRe('{id}: saved position {dropped} discarded — --restore would have put it back', { id: 'BS-1', dropped: 20 }));
    assert.match(r.out, ruRe('{id}: saved position {dropped} discarded — --restore would have put it back', { id: 'BS-2', dropped: 30 }));
    assert.equal(r.out.split('\n').filter((line) => DISCARDED.test(line)).length, 2, 'the command is silent about a task without a saved number');
    for (const n of ['1-a', '2-b', '3-c']) assert.doesNotMatch(read(root, `docs/backlog/queue/BS-${n}.md`), new RegExp(FIELD.previousOrder));
    assert.deepEqual(['1-a', '2-b', '3-c'].map((n) => rankOf(root, n)), ['10', '20', '30']);
    assert.equal(cli(root, ['lint']).code, 0);
  } finally {
    cleanup(root);
  }
});

test('mv: --top on a tight queue renumbers the neighbours, from triage and within the queue', () => {
  const rows = [
    { from: 'triage', target: '5', expect: { '5-e': 10, '4-d': 20, '3-c': 30, '2-b': 40, '1-a': 50 } },
    { from: 'queue', target: '1', expect: { '1-a': 10, '4-d': 20, '3-c': 30, '2-b': 40 } },
  ];
  for (const { from, target, expect } of rows) {
    const root = makeProject();
    try {
      cli(root, ['new', 'a', '--queue']); // 10
      cli(root, ['new', 'b', '--queue', '--top']); // 5
      cli(root, ['new', 'c', '--queue', '--top']); // 2
      cli(root, ['new', 'd', '--queue', '--top']); // 1
      if (from === 'triage') cli(root, ['new', 'e']);
      for (const n of ['1-a', '2-b', '3-c', '4-d']) fillArea(root, `docs/backlog/queue/BS-${n}.md`);
      if (from === 'triage') fillArea(root, 'docs/backlog/triage/BS-5-e.md');
      gitAll(root);
      const r = cli(root, ['mv', target, 'queue', '--top']);
      assert.equal(r.code, 0, `${from}: ${r.err}`);
      assert.match(r.out, ruRe('queue renumbered in steps of 10: {renumbered} files'), `${from}: the queue must be renumbered`);
      const ranks = Object.fromEntries(Object.keys(expect).map((n) => [n, Number(rankOf(root, n))]));
      assert.deepEqual(ranks, expect, `${from}: ranks after --top`);
      const lint = cli(root, ['lint']);
      assert.equal(lint.code, 0, `${from}: ${lint.err}`);
    } finally {
      cleanup(root);
    }
  }
});

const BOM = '﻿';
const withBom = (root, rel) => writeFileSync(path.join(root, rel), BOM + read(root, rel));
const startsWithBom = (root, rel) => readFileSync(path.join(root, rel)).subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]));

test('mv, renumbering and archive keep the UTF-8 BOM of a rewritten card', () => {
  const root = makeProject();
  try {
    cli(root, ['new', 'a', '--queue']); // 10
    cli(root, ['new', 'b', '--queue', '--top']); // 5
    cli(root, ['new', 'c', '--queue', '--top']); // 2
    cli(root, ['new', 'd', '--queue', '--top']); // 1
    for (const n of ['1-a', '2-b', '3-c', '4-d']) withBom(root, `docs/backlog/queue/BS-${n}.md`);
    gitAll(root);

    let r = cli(root, ['mv', '1', 'queue', '--top']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, ruRe('queue renumbered in steps of 10: {renumbered} files'));
    for (const n of ['1-a', '2-b', '3-c', '4-d']) assert.ok(startsWithBom(root, `docs/backlog/queue/BS-${n}.md`), `renumbered ${n} keeps the BOM`);
    r = cli(root, ['mv', '4', 'active']);
    assert.equal(r.code, 0, r.err);
    assert.ok(startsWithBom(root, 'docs/backlog/active/BS-4-d.md'), 'mv keeps the BOM');

    put(root, 'docs/backlog/active/BS-5-e.md', `${BOM}${ruCard('BS-5', 'E', { area: AREA, taken: '2026-09-01' })}\nSee [f](BS-6-f.md).\n`);
    put(root, 'docs/backlog/active/BS-6-f.md', `${BOM}${ruCard('BS-6', 'F', { area: AREA, taken: '2026-09-01' })}\nSee [e](BS-5-e.md).\n`);
    gitAll(root);
    r = cli(root, ['archive', '5']);
    assert.equal(r.code, 0, r.err);
    assert.match(read(root, 'docs/archive/BS-5-e/task.md'), /See \[f\]\(\.\.\/\.\.\/backlog\/active\/BS-6-f\.md\)/);
    assert.ok(startsWithBom(root, 'docs/archive/BS-5-e/task.md'), 'archive keeps the BOM of a card whose link it rewrote');
    assert.match(read(root, 'docs/backlog/active/BS-6-f.md'), /See \[e\]\(\.\.\/\.\.\/archive\/BS-5-e\/task\.md\)/);
    assert.ok(startsWithBom(root, 'docs/backlog/active/BS-6-f.md'), 'a neighbour whose incoming link was rewritten keeps its BOM');
  } finally {
    cleanup(root);
  }
});

test('init rewrites an owned adapter output with a BOM as the render, without the BOM', () => {
  const root = makeProject();
  try {
    assert.equal(cli(root, ['init', '--tools', 'claude']).code, 0);
    const rel = '.claude/skills/backslop-task/SKILL.md';
    const rendered = read(root, rel);
    withBom(root, rel);
    const r = cli(root, ['init', '--tools', 'claude']);
    assert.equal(r.code, 0, r.err);
    assert.ok(read(root, rel).startsWith('---'), 'the rewrite starts with the frontmatter');
    assert.equal(read(root, rel), rendered);
  } finally {
    cleanup(root);
  }
});

test('mv: a failed git ls-files refuses before touching the file; an untracked card still moves', { skip: process.platform === 'win32' }, () => {
  const root = makeProject();
  const shim = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-git-shim-')));
  try {
    cli(root, ['new', 'a', '--queue']);
    gitAll(root);
    const real = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
    writeFileSync(path.join(shim, 'git'), `#!/bin/sh\nfor a in "$@"; do [ "$a" = "$KILL_ON" ] && kill -9 $$; done\nexec "${real}" "$@"\n`, { mode: 0o755 });
    const r = cli(root, ['mv', '1', 'active'], { env: { KILL_ON: '--error-unmatch', PATH: `${shim}${path.delimiter}${process.env.PATH}` } });
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, killedRe('git ls-files --error-unmatch'));
    assert.doesNotMatch(r.err, ruRe('file is not tracked by git — moved without git mv'));
    assert.ok(existsSync(path.join(root, 'docs/backlog/queue/BS-1-a.md')), 'the card stays where it was');
    assert.ok(!existsSync(path.join(root, 'docs/backlog/active/BS-1-a.md')));
    assert.equal(run(root, ['status', '--porcelain']).stdout, '');

    cli(root, ['new', 'b', '--queue']);
    const untracked = cli(root, ['mv', '2', 'active']);
    assert.equal(untracked.code, 0, untracked.err);
    assert.match(untracked.err, ruRe('file is not tracked by git — moved without git mv'));
    assert.ok(existsSync(path.join(root, 'docs/backlog/active/BS-2-b.md')));
  } finally {
    cleanup(root);
    rmSync(shim, { recursive: true, force: true });
  }
});

test('status: the summary and --json have the same composition', () => {
  const root = makeProject();
  try {
    cli(root, ['new', 'a', '--queue', '--title', 'First']);
    cli(root, ['new', 'b', '--queue', '--title', 'Second']);
    cli(root, ['new', 'c', '--title', 'Idea']);
    cli(root, ['mv', '2', 'active']);
    let r = cli(root, ['status']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, new RegExp(`${ru('Active')} \\(1\\)\\n  BS-2 · Second — ${ru('taken')} \\d{4}`));
    assert.match(r.out, new RegExp(`${ru('Queue')} \\(1\\)\\n {4}10  BS-1 · First`));
    assert.match(r.out, /Triage \(1\)\n  BS-3 · Idea/);
    assert.match(r.out, new RegExp(`${ru('Archive')}: 0`));
    r = cli(root, ['status', '--json']);
    const s = JSON.parse(r.out);
    assert.equal(s.prefix, 'BS');
    assert.deepEqual(s.queue.map((q) => [q.id, q.order]), [['BS-1', 10]]);
    assert.equal(s.active[0].id, 'BS-2');
    assert.equal(s.triage[0].file, 'docs/backlog/triage/BS-3-c.md');
  } finally {
    cleanup(root);
  }
});

test('status: EN human output, JSON contract unchanged, RU metadata accepted', () => {
  const root = makeProject({ git: false });
  try {
    put(root, 'backslop.json', '{"prefix":"BS","docs":"docs","gates":[],"lang":"en","tools":[]}\n');
    put(root, 'docs/backlog/active/BS-1-mixed.md', ruCard('BS-1', 'Mixed', { created: '2026-09-01', taken: '2026-09-02' }));
    const human = cli(root, ['status']);
    assert.equal(human.code, 0, human.err);
    assert.match(human.out, /^Active \(1\)/);
    assert.match(human.out, /Queue \(0\)/);
    assert.match(human.out, /Archive: 0/);
    assert.doesNotMatch(human.out, CYRILLIC);
    const json = JSON.parse(cli(root, ['status', '--json']).out);
    assert.deepEqual(json.active[0], {
      id: 'BS-1', title: 'Mixed', file: 'docs/backlog/active/BS-1-mixed.md', created: '2026-09-01', taken: '2026-09-02',
    });
  } finally { cleanup(root); }
});

test('status --json: blank or missing created and taken are null, like area and cost', () => {
  const root = makeProject({ git: false });
  try {
    put(root, 'backslop.json', '{"prefix":"BS","docs":"docs","gates":[],"lang":"en","tools":[]}\n');
    put(root, 'docs/backlog/active/BS-1-a.md', '# BS-1 · A\n\n- **Created:**\n- **Taken:**\n');
    put(root, 'docs/backlog/triage/BS-2-b.md', '# BS-2 · B\n');
    put(root, 'docs/backlog/minor/BS-3-c.md', '# BS-3 · C\n\n- **Created:** 2026-09-01\n- **Cost:**\n');
    const r = cli(root, ['status', '--json']);
    assert.equal(r.code, 0, r.err);
    const s = JSON.parse(r.out);
    assert.equal(s.active[0].created, null);
    assert.equal(s.active[0].taken, null);
    assert.equal(s.triage[0].created, null);
    assert.deepEqual([s.minor[0].created, s.minor[0].area, s.minor[0].cost], ['2026-09-01', null, null]);
  } finally { cleanup(root); }
});

test('new and adr: a slug past the 255-byte file name is refused before anything is written', () => {
  const root = makeProject();
  try {
    put(root, 'docs/backlog/queue/BS-1-a.md', ruCard('BS-1', 'A', { order: 1 }));
    put(root, 'docs/backlog/queue/BS-2-b.md', ruCard('BS-2', 'B', { order: 2 }));
    gitAll(root);
    const slug = 'a'.repeat(300);
    for (const args of [['new', slug], ['new', slug, '--queue', '--top'], ['adr', slug]]) {
      const r = cli(root, args);
      assert.equal(r.code, 1, `${args.slice(2).join(' ')}: ${r.out}`);
      assert.match(r.err, new RegExp(`^✖ ${ruRe('slug is too long: the file name is {bytes} bytes, the file system limit is 255').source}`));
      assert.doesNotMatch(r.err, /ENAMETOOLONG|node:fs|\n\s+at /);
    }
    assert.equal(run(root, ['status', '--porcelain']).stdout, '', 'the queue was renumbered or a file was written');
    const over = cli(root, ['new', 'a'.repeat(256 - 'BS-3-.md'.length)]);
    assert.equal(over.code, 1, 'a 256-byte file name was accepted');
    assert.match(over.err, ruRe('slug is too long: the file name is {bytes} bytes, the file system limit is 255', { bytes: 256 }));
    const fits = cli(root, ['new', 'a'.repeat(255 - 'BS-3-.md'.length)]);
    assert.equal(fits.code, 0, fits.err);
  } finally {
    cleanup(root);
  }
});

test('adr: docs/adr as a file is refused by name, not with a stack', () => {
  const root = makeProject();
  try {
    rmSync(path.join(root, 'docs/adr'), { recursive: true });
    put(root, 'docs/adr', 'x\n');
    const r = cli(root, ['adr', 'x']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, new RegExp(`^✖ ${ruRe('{rel} is a file, expected a directory', { rel: 'docs/adr' }).source}`));
    assert.doesNotMatch(r.err, /ENOTDIR|node:fs|\n\s+at /);
  } finally {
    cleanup(root);
  }
});

test('adr: the next number and the reminder about the table', () => {
  const root = makeProject();
  try {
    let r = cli(root, ['adr', 'first', '--title', 'First decision']);
    assert.equal(r.code, 0, r.err);
    assert.match(read(root, 'docs/adr/adr-001-first.md'), /^# ADR-001: First decision\n/);
    assert.match(r.out, /docs\/README\.md/);
    r = cli(root, ['adr', 'second']);
    assert.ok(existsSync(path.join(root, 'docs/adr/adr-002-second.md')));
  } finally {
    cleanup(root);
  }
});

test('commands outside a project refuse with a hint about init', () => {
  const root = makeProject();
  try {
    const r = cli(root, ['status'], { cwd: path.dirname(root) });
    assert.equal(r.code, 1);
    assert.match(r.err, /backslop init/);
  } finally {
    cleanup(root);
  }
});

test('changelog and merge-changelog take the language from an otherwise invalid backslop.json', () => {
  const root = makeProject();
  const tool = changelogTool();
  try {
    put(root, 'backslop.json', '{"prefix":"bs","lang":"en"}\n');
    let r = toolCli(tool, ['changelog', '--since', '0.1.0', '--to', '0.2.0'], { cwd: root });
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /^## v0\.2\.0 /);
    r = cli(root, ['changelog', '--since', 'v99.0.0']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /^no entries after v99\.0\.0 and through v/);
    r = cli(root, ['changelog', '--since', 'bad']);
    assert.equal(r.code, 1);
    assert.equal(r.err, '✖ --since “bad”: expected X.Y.Z\n');
    r = cli(root, ['merge-changelog']);
    assert.equal(r.code, 1);
    assert.equal(r.err, '✖ both --ours <ref> and --theirs <ref> are required: two CHANGELOG.md revisions from git\n');
  } finally { cleanup(root); cleanup(tool); }
});

test('merge-changelog outside a project refuses in both languages', () => {
  const root = makeProject();
  try {
    const r = cli(root, ['merge-changelog'], { cwd: path.dirname(root) });
    assert.equal(r.code, 1);
    assert.match(r.err, /both --ours <ref> and --theirs <ref> are required/);
    assert.match(r.err, new RegExp(escapeRe(ru('both --ours <ref> and --theirs <ref> are required: two CHANGELOG.md revisions from git'))));
  } finally { cleanup(root); }
});

test('merge-changelog outside a project gives a git failure cause in each language', { skip: process.platform === 'win32' }, () => {
  const root = makeProject();
  const shim = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-git-shim-')));
  try {
    rmSync(path.join(root, 'backslop.json'));
    put(root, 'CHANGELOG.md', '# Changelog\n\n## Unreleased\n\n- **A** — a\n');
    gitAll(root, 'changelog');
    const real = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
    const env = { PATH: `${shim}${path.delimiter}${process.env.PATH}` };
    for (const [arg, en, ruText] of [
      ['*:./CHANGELOG.md', 'cannot read HEAD:CHANGELOG.md', ru('cannot read {ref}:{changelog} — {cause}', { ref: 'HEAD', changelog: 'CHANGELOG.md', cause: KILLED })],
      ['tag', 'cannot read the tag list', ru('cannot read the tag list — {cause}', { cause: KILLED })],
    ]) {
      writeFileSync(path.join(shim, 'git'), `#!/bin/sh\nfor a in "$@"; do case "$a" in ${arg}) kill -9 $$;; esac; done\nexec "${real}" "$@"\n`, { mode: 0o755 });
      const r = cli(root, ['merge-changelog', '--ours=HEAD', '--theirs=HEAD'], { env });
      assert.equal(r.code, 1, r.out);
      assert.equal(r.err, `✖ ${en} — killed by SIGKILL / ${ruText}\n`);
    }
  } finally {
    cleanup(root);
    rmSync(shim, { recursive: true, force: true });
  }
});

test('release-related CLI messages follow project lang without changing their flow', () => {
  const root = makeProject({ git: false });
  try {
    put(root, 'backslop.json', '{"prefix":"BS","docs":"docs","cli":"node bin/backslop.js","gates":[],"lang":"en","tools":[]}\n');
    let r = cli(root, ['migrate', '--dry-run']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /migration through v0\.10\.0: closed task journal docs\/archive\/LOG\.md \(--dry-run\)/);
    assert.doesNotMatch(r.out + r.err, CYRILLIC);
    r = cli(root, ['changelog', '--since', 'v99.0.0']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /no entries after v99\.0\.0/);
    r = cli(root, ['upgrade']);
    assert.equal(r.code, 1);
    assert.match(r.err, /there is nothing to update/);
    assert.doesNotMatch(r.err, CYRILLIC);
  } finally { cleanup(root); }
});

// A directory named like a task file in the flat docs/backlog/ is not a task for findFlatTask:
// else mv first moved the directory, then failed on the read — a touched tree, a manual rollback.
test('mv: a directory named like a task file in the flat docs/backlog/ — a refusal without a move and without a stack', () => {
  const root = makeProject();
  try {
    mkdirSync(path.join(root, 'docs/backlog/BS-9-sub.md'));
    const r = cli(root, ['mv', '9', 'queue']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, ruRe('task {id} was not found in any status directory', { id: 'BS-9' }));
    assert.doesNotMatch(r.err, /EISDIR|node:fs/);
    assert.ok(existsSync(path.join(root, 'docs/backlog/BS-9-sub.md')), 'the directory stayed in place');
    assert.ok(!existsSync(path.join(root, 'docs/backlog/queue/BS-9-sub.md')));
  } finally {
    cleanup(root);
  }
});

test('mv: a taken destination is refused before the first move of the batch', () => {
  const root = makeProject();
  try {
    put(root, 'docs/backlog/queue/BS-1-a.md', ruCard('BS-1', 'A', { order: 10 }));
    put(root, 'docs/backlog/queue/BS-2-b.md', ruCard('BS-2', 'B', { order: 20 }));
    gitAll(root);
    mkdirSync(path.join(root, 'docs/backlog/active/BS-2-b.md'), { recursive: true });
    const before = run(root, ['status', '--porcelain']).stdout;
    let r = cli(root, ['mv', '1', '2', 'active']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, new RegExp(`^✖ ${ruRe('{rel} already exists — {id} cannot move onto it', { rel: 'docs/backlog/active/BS-2-b.md', id: 'BS-2' }).source}`));
    assert.doesNotMatch(r.err, /EISDIR|node:fs|\n\s+at /);
    assert.equal(run(root, ['status', '--porcelain']).stdout, before, 'the batch moved something before the refusal');

    rmSync(path.join(root, 'docs/backlog/active'), { recursive: true });
    put(root, 'docs/backlog/active', 'x\n');
    r = cli(root, ['mv', '1', 'active']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, new RegExp(`^✖ ${ruRe('{rel} is a file, expected a directory', { rel: 'docs/backlog/active' }).source}`));
    assert.ok(existsSync(path.join(root, 'docs/backlog/queue/BS-1-a.md')));
  } finally {
    cleanup(root);
  }
});

test('mv: incoming links to the task are rewritten, as in archive', () => {
  const root = makeProject();
  try {
    cli(root, ['new', 'a', '--queue', '--title', 'A']);
    fillArea(root, 'docs/backlog/queue/BS-1-a.md');
    put(root, 'ROADMAP.md', '# Roadmap\n\nTask [BS-1](docs/backlog/queue/BS-1-a.md).\n');
    put(root, 'docs/backlog/triage/BS-2-b.md', `# BS-2 · B\n\nSee [BS-1](../queue/BS-1-a.md#${ANCHOR}).\n`);
    put(root, 'STATUS.md', 'In progress [BS-1](docs/backlog/queue/BS-1-a.md)\n');
    gitAll(root);
    const r = cli(root, ['mv', '1', 'active']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, ruRe('task links updated: {relinked}', { relinked: 'ROADMAP.md, STATUS.md, docs/backlog/triage/BS-2-b.md' }));
    assert.match(read(root, 'STATUS.md'), /\(docs\/backlog\/active\/BS-1-a\.md\)/);
    assert.match(read(root, 'ROADMAP.md'), /\(docs\/backlog\/active\/BS-1-a\.md\)/);
    assert.match(read(root, 'docs/backlog/triage/BS-2-b.md'), new RegExp(`\\(\\.\\./active/BS-1-a\\.md#${ANCHOR}\\)`));
    assert.equal(cli(root, ['lint']).code, 0);
  } finally {
    cleanup(root);
  }
});

test('mv: a card linking to itself still resolves after the move, relative and rooted', () => {
  const root = makeProject();
  try {
    cli(root, ['new', 'a', '--title', 'A']);
    fillArea(root, 'docs/backlog/triage/BS-1-a.md');
    put(root, 'docs/backlog/triage/BS-1-a.md', `${read(root, 'docs/backlog/triage/BS-1-a.md')}\n[self](BS-1-a.md#${ANCHOR}) [root](/docs/backlog/triage/BS-1-a.md)\n`);
    gitAll(root);
    const r = cli(root, ['mv', '1', 'queue']);
    assert.equal(r.code, 0, r.err);
    const card = read(root, 'docs/backlog/queue/BS-1-a.md');
    assert.match(card, new RegExp(`\\[self\\]\\(BS-1-a\\.md#${ANCHOR}\\) \\[root\\]\\(\\/docs\\/backlog\\/queue\\/BS-1-a\\.md\\)`));
    const lint = cli(root, ['lint']);
    assert.equal(lint.code, 0, lint.err);
  } finally {
    cleanup(root);
  }
});

test('mv: a percent-encoded link to the task moves with it and stays encoded', () => {
  const root = makeProject({ docs: 'my docs' });
  try {
    cli(root, ['new', 'link-probe']);
    fillArea(root, 'my docs/backlog/triage/BS-1-link-probe.md');
    put(root, 'ROADMAP.md', '[encoded](my%20docs/backlog/triage/BS-1-link-probe.md) and [angled](<my docs/backlog/triage/BS-1-link-probe.md>)\n');
    gitAll(root);
    assert.equal(cli(root, ['lint']).code, 0);
    const r = cli(root, ['mv', '1', 'queue']);
    assert.equal(r.code, 0, r.err);
    assert.equal(read(root, 'ROADMAP.md'),
      '[encoded](my%20docs/backlog/queue/BS-1-link-probe.md) and [angled](<my docs/backlog/queue/BS-1-link-probe.md>)\n');
    const lint = cli(root, ['lint']);
    assert.equal(lint.code, 0, lint.err);
  } finally {
    cleanup(root);
  }
});

test('mv: a file from the flat docs/backlog/ moves into a status directory with its outgoing links recalculated', () => {
  const root = makeProject();
  try {
    put(root, 'docs/reference/README.md', '# Reference\n');
    cli(root, ['new', 'a', '--queue']);
    fillArea(root, 'docs/backlog/queue/BS-1-a.md');
    put(root, 'docs/backlog/BS-5-flat.md', `${ruCard('BS-5', 'Flat', { area: '[x](../reference/README.md)' })}\nSee [BS-1](queue/BS-1-a.md) and [archive](../archive/README.md).\n`);
    put(root, 'ROADMAP.md', '# Roadmap\n\n[BS-5](docs/backlog/BS-5-flat.md)\n');
    gitAll(root);
    assert.equal(cli(root, ['lint']).code, 1, 'a flat file is a layout error');
    const r = cli(root, ['mv', '5', 'queue']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /BS-5: backlog\/ → queue\/ \(docs\/backlog\/queue\/BS-5-flat\.md\)/);
    assert.match(r.out, ruRe('outgoing links recalculated from the new directory'));
    const moved = read(root, 'docs/backlog/queue/BS-5-flat.md');
    assert.match(moved, /\(\.\.\/\.\.\/reference\/README\.md\)/);
    assert.match(moved, /\[BS-1\]\(BS-1-a\.md\)/);
    assert.match(moved, /\(\.\.\/\.\.\/archive\/README\.md\)/);
    assert.match(moved, fieldRe('order', ' 20\\n'));
    assert.match(read(root, 'ROADMAP.md'), /\(docs\/backlog\/queue\/BS-5-flat\.md\)/);
    assert.equal(cli(root, ['lint']).code, 0);
    // Between status directories the depth is the same: `../../reference/…` does not change, and
    // a link to the neighbour from the former directory gets `../queue/`.
    const again = cli(root, ['mv', '5', 'active']);
    assert.equal(again.code, 0, again.err);
    const active = read(root, 'docs/backlog/active/BS-5-flat.md');
    assert.match(active, /\(\.\.\/\.\.\/reference\/README\.md\)/);
    assert.match(active, /\[BS-1\]\(\.\.\/queue\/BS-1-a\.md\)/);
    assert.equal(cli(root, ['lint']).code, 0);
  } finally {
    cleanup(root);
  }
});

test('mv: generated adapter outputs are excluded from the repository-wide relink', () => {
  const root = makeProject();
  try {
    cli(root, ['new', 'a', '--queue']);
    const generated = markGenerated('[BS-1](../../../docs/backlog/queue/BS-1-a.md)\n');
    put(root, '.agents/skills/backslop-task/SKILL.md', generated);
    gitAll(root);
    const r = cli(root, ['mv', '1', 'active']);
    assert.equal(r.code, 0, r.err);
    assert.equal(read(root, '.agents/skills/backslop-task/SKILL.md'), generated);
  } finally {
    cleanup(root);
  }
});

test('mv: an unmarked file at an adapter path is project markdown, and its links move', () => {
  const root = makeProject();
  try {
    cli(root, ['new', 'a', '--queue']);
    put(root, '.agents/skills/backslop-task/SKILL.md', '[BS-1](../../../docs/backlog/queue/BS-1-a.md)\n');
    gitAll(root);
    const r = cli(root, ['mv', '1', 'active']);
    assert.equal(r.code, 0, r.err);
    assert.equal(read(root, '.agents/skills/backslop-task/SKILL.md'), '[BS-1](../../../docs/backlog/active/BS-1-a.md)\n');
  } finally {
    cleanup(root);
  }
});

test('new and mv on a number with leading zeros: a finding inherits the parent’s form, the argument is parsed as a number', () => {
  const root = makeProject();
  try {
    put(root, 'docs/backlog/queue/BS-007-padded.md', ruCard('BS-007', 'Padded', { order: 10 }));
    let r = cli(root, ['new', 'finding', '--parent', '7']);
    assert.equal(r.code, 0, r.err);
    assert.match(read(root, 'docs/backlog/triage/BS-007.1-finding.md'), new RegExp(`^# BS-007\\.1 · finding\\n[\\s\\S]*${escapeRe(found('BS-007'))}`));
    r = cli(root, ['mv', '7', 'active']);
    assert.equal(r.code, 0, r.err);
    assert.ok(existsSync(path.join(root, 'docs/backlog/active/BS-007-padded.md')));
    r = cli(root, ['new', 'next', '--queue']);
    assert.equal(r.code, 0, r.err);
    assert.ok(existsSync(path.join(root, 'docs/backlog/queue/BS-8-next.md')));
  } finally {
    cleanup(root);
  }
});

test('mv: a batch of numbers in one call; a refusal on any of them — all or nothing', () => {
  const root = makeProject();
  try {
    for (const slug of ['a', 'b', 'c']) assert.equal(cli(root, ['new', slug, '--queue']).code, 0);
    for (const n of [1, 2, 3]) fillArea(root, `docs/backlog/queue/BS-${n}-${'abc'[n - 1]}.md`);
    gitAll(root, 'queue');

    // A refusal on a nonexistent number in the middle of the batch moves no file.
    let r = cli(root, ['mv', '1', '99', '3', 'active']);
    assert.equal(r.code, 1);
    assert.match(r.err, /BS-99/);
    for (const n of [1, 2, 3]) assert.ok(existsSync(path.join(root, `docs/backlog/queue/BS-${n}-${'abc'[n - 1]}.md`)), `BS-${n} was touched by the refusal`);

    r = cli(root, ['mv', '1', '2', '3', 'active']);
    assert.equal(r.code, 0, r.err);
    for (const n of [1, 2, 3]) {
      const file = path.join(root, `docs/backlog/active/BS-${n}-${'abc'[n - 1]}.md`);
      assert.ok(existsSync(file), `BS-${n} did not move`);
      assert.match(read(root, `docs/backlog/active/BS-${n}-${'abc'[n - 1]}.md`), fieldRe('taken', ' \\d{4}-\\d{2}-\\d{2}\\n'));
      assert.doesNotMatch(read(root, `docs/backlog/active/BS-${n}-${'abc'[n - 1]}.md`), new RegExp(FIELD.order));
    }
    assert.equal((r.out.match(/→ active\//g) ?? []).length, 3, 'an ok line for each number');

    // Back to the queue as a batch: each has its own order, no duplicate.
    r = cli(root, ['mv', '1', '2', '3', 'queue']);
    assert.equal(r.code, 0, r.err);
    const ranks = [1, 2, 3].map((n) => rankOf(root, `${n}-${'abc'[n - 1]}`));
    assert.equal(new Set(ranks).size, 3, `the orders coincided: ${ranks.join(', ')}`);
    assert.equal(cli(root, ['lint']).code, 0);

    // The same number twice in a batch — a refusal before the move.
    r = cli(root, ['mv', '1', '1', 'active']);
    assert.equal(r.code, 1);
    assert.match(r.err, ruRe('{id} is named twice in the batch'));
    assert.ok(existsSync(path.join(root, 'docs/backlog/queue/BS-1-a.md')));
  } finally {
    cleanup(root);
  }
});

// The section of the touched-docs list: the command prints the move line above it, not in it.
function touchedList(out) {
  const at = out.indexOf(TOUCHED);
  return at === -1 ? '' : out.slice(at);
}

// The whole list, sorted: "three paths are there" would miss an extra one. Paths sit at column 4,
// the lines below the list at column 2.
function touchedPaths(out) {
  return touchedList(out).split('\n').slice(1).filter((l) => l.startsWith('    ')).map((l) => l.trim()).sort();
}

test('archive --range: prints the docs and CHANGELOG files changed by the task’s run', () => {
  const root = makeProject();
  try {
    put(root, 'docs/backlog/active/BS-1-a.md', ruCard('BS-1', 'A', { taken: '2026-09-01' }));
    put(root, 'docs/reference/README.md', '# Reference\n');
    gitAll(root, 'base');
    const head = run(root, ['rev-parse', 'HEAD']);
    assert.equal(head.status, 0, head.stderr);
    const base = head.stdout.trim();

    put(root, 'docs/reference/01-layout.md', '# 01. Layout\n');
    gitAll(root, 'a reference edit without a task number');
    put(root, 'CHANGELOG.md', '## Unreleased\n\n- **One** — BS-1\n');
    gitAll(root, 'BS-1: CHANGELOG entry');
    put(root, 'lib/x.js', '// code\n');
    gitAll(root, 'BS-1: code outside docs');
    put(root, 'docs/backlog/triage/BS-1.1-finding.md', '# BS-1.1 · Finding\n');
    gitAll(root, 'BS-1: a finding as a file');
    put(root, 'docs/ROADMAP.md', '# Roadmap\n');
    gitAll(root, 'run snapshot\n\nBS-1: the title of a squashed commit, in the body');

    const r = cli(root, ['archive', '1', '--range', `${base}..HEAD`, '--dry-run']);
    assert.equal(r.code, 0, r.err);
    assert.match(touchedList(r.out), /docs\/reference\/01-layout\.md/);
    assert.match(touchedList(r.out), /CHANGELOG\.md/);
    assert.doesNotMatch(touchedList(r.out), /lib\/x\.js/, 'outside docs and CHANGELOG — not printed');
    assert.doesNotMatch(touchedList(r.out), /docs\/backlog\//, 'tracker cards are not "documentation in the same pass"');

    // Without --range only the commits with the task prefix in the title remain.
    const byPrefix = cli(root, ['archive', '1', '--dry-run']);
    assert.equal(byPrefix.code, 0, byPrefix.err);
    assert.match(touchedList(byPrefix.out), /CHANGELOG\.md/);
    assert.doesNotMatch(touchedList(byPrefix.out), /docs\/reference\/01-layout\.md/);
    assert.doesNotMatch(touchedList(byPrefix.out), /docs\/ROADMAP\.md/, 'the title of a squashed commit in the body is not a title');
    assert.doesNotMatch(touchedList(byPrefix.out), /docs\/backlog\//, 'tracker cards are not "documentation in the same pass"');

    // An unresolvable revision — a refusal in git’s words, not an empty list.
    const broken = cli(root, ['archive', '1', '--range', 'nosuchref..HEAD', '--dry-run']);
    assert.equal(broken.code, 1);
    assert.match(broken.err, /--range nosuchref\.\.HEAD/);
    assert.equal(cli(root, ['archive', '1', '--range=', '--dry-run']).code, 1);
  } finally {
    cleanup(root);
  }
});

// A project in a subdirectory: `git log --name-only` prints paths from the toplevel
// (`sub/docs/…`), and the combined diff of a merge ignores `--relative` — the command cuts it.
test('archive --range: a project in a repository subdirectory — paths from the project root, for a merge commit too', () => {
  const top = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-nested-')));
  try {
    run(top, ['init', '-q', '-b', 'main']);
    run(top, ['config', 'user.email', 'test@example.com']);
    run(top, ['config', 'user.name', 'test']);
    run(top, ['config', 'commit.gpgsign', 'false']);
    // A non-ASCII name in the fixture: without the pin it would go NFD on a machine with
    // normalization off, and deepEqual with an NFC literal would redden for a foreign reason.
    run(top, ['config', 'core.precomposeunicode', 'true']);
    const root = path.join(top, 'sub');
    put(root, 'backslop.json', `${JSON.stringify({ prefix: 'BS', docs: 'docs', gates: [], lang: 'ru', tools: [] }, null, 2)}\n`);
    put(root, 'docs/backlog/active/BS-1-a.md', ruCard('BS-1', 'A', { taken: '2026-09-01' }));
    put(root, 'docs/reference/README.md', '# Reference\n');
    put(top, 'docs/reference/outer.md', '# outside the project\n');
    gitAll(top, 'base');
    const base = run(top, ['rev-parse', 'HEAD']).stdout.trim();
    run(top, ['checkout', '-q', '-b', 'feat']);
    put(root, 'docs/reference/branch-only.md', '# from the branch\n');
    gitAll(top, 'BS-1: an edit on the branch');
    run(top, ['checkout', '-q', 'main']);
    put(root, 'docs/reference/01-layout.md', '# 01. Layout\n');
    // A non-ASCII name: git quotes such paths (`core.quotePath`), and without an explicit off the
    // prefix would sit inside the quotes and the list would hold octal sequences.
    put(root, `docs/reference/${NON_ASCII_DIR}.md`, '# reference\n');
    put(root, 'CHANGELOG.md', '## Unreleased\n\n- **One** — BS-1\n');
    // A tracker card inside the range: the selection rests on a pathspec with the cwd prefix.
    put(root, 'docs/backlog/active/BS-1-a.md', `${ruCard('BS-1', 'A', { taken: '2026-09-01' })}\ncard edit\n`);
    put(top, 'docs/reference/outer.md', '# outside the project, an edit\n');
    gitAll(top, 'BS-1: project docs, a card and a file outside it');
    run(top, ['merge', '-q', '--no-ff', '--no-commit', 'feat']);
    put(root, 'docs/reference/merge-only.md', '# an edit during the merge\n');
    gitAll(top, 'Merge feat');

    const r = cli(root, ['archive', '1', '--range', `${base}..HEAD`, '--dry-run']);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(touchedPaths(r.out), [
      'CHANGELOG.md',
      'docs/reference/01-layout.md',
      'docs/reference/branch-only.md',
      'docs/reference/merge-only.md',
      `docs/reference/${NON_ASCII_DIR}.md`,
    ], 'paths from the project root, the non-ASCII name as is, the card and the file outside the project are not named, the merge commit’s prefix is cut');
  } finally {
    cleanup(top);
  }
});

// A merge commit: a branch file arrives through its commit in the range, and an edit made by the
// merge itself — only through `--cc`; without it `git log --name-only` is silent for a merge.
test('archive --range: a merge commit — a file from the branch and a file changed only by the merge are both named', () => {
  const root = makeProject();
  try {
    put(root, 'docs/backlog/active/BS-1-a.md', ruCard('BS-1', 'A', { taken: '2026-09-01' }));
    put(root, 'docs/reference/README.md', '# Reference\n');
    gitAll(root, 'base');
    const base = run(root, ['rev-parse', 'HEAD']).stdout.trim();
    run(root, ['checkout', '-q', '-b', 'feat']);
    put(root, 'docs/reference/branch-only.md', '# from the branch\n');
    gitAll(root, 'BS-1: an edit on the branch');
    run(root, ['checkout', '-q', 'main']);
    put(root, 'docs/reference/main-side.md', '# in main\n');
    gitAll(root, 'work in main');
    run(root, ['merge', '-q', '--no-ff', '--no-commit', 'feat']);
    put(root, 'docs/reference/merge-only.md', '# an edit during the merge\n');
    gitAll(root, 'Merge feat');

    const r = cli(root, ['archive', '1', '--range', `${base}..HEAD`, '--dry-run']);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(touchedPaths(r.out), [
      'docs/reference/branch-only.md',
      'docs/reference/main-side.md',
      'docs/reference/merge-only.md',
    ], 'a branch file — through its commit in the range; merge-only — the edit of the merge itself; nothing extra');

    // Without --range — only commits titled BS-N: the merge’s own edit is not there, because the
    // title of the merge commit does not name it.
    const byPrefix = cli(root, ['archive', '1', '--dry-run']);
    assert.equal(byPrefix.code, 0, byPrefix.err);
    assert.deepEqual(touchedPaths(byPrefix.out), ['docs/reference/branch-only.md']);
  } finally {
    cleanup(root);
  }
});

test('archive: the commits are selected by number, not by the form in the file name', () => {
  const root = makeProject();
  try {
    put(root, 'docs/backlog/active/BS-007-zero.md', ruCard('BS-007', 'Zeros', { area: AREA, taken: '2026-09-01' }));
    gitAll(root, 'base');
    put(root, 'docs/ROADMAP.md', '# Roadmap\n');
    gitAll(root, 'BS-7: a reference edit under a task with zeros');
    put(root, 'docs/GLOSSARY.md', '# Glossary\n');
    gitAll(root, 'BS-007: the same task, the number written with zeros');

    const r = cli(root, ['archive', '7', '--dry-run']);
    assert.equal(r.code, 0, r.err);
    assert.match(touchedList(r.out), /docs\/ROADMAP\.md/, 'the BS-7 commit belongs to the file BS-007-…');
    assert.match(touchedList(r.out), /docs\/GLOSSARY\.md/, '…and the BS-007 commit — to number 7');
  } finally {
    cleanup(root);
  }
});

test('new: the area links to reference/ at the status directory depth, or stays a placeholder without its README', () => {
  const rows = [
    { reference: true, statuses: ['triage', 'queue'] },
    { reference: false, statuses: ['queue'] },
  ];
  for (const { reference, statuses } of rows) {
    const label = reference ? 'with reference/README.md' : 'without reference/README.md';
    const root = makeProject();
    try {
      if (reference) put(root, 'docs/reference/README.md', '# Reference\n');
      const { dirs } = loadProject(root);
      // The depth comes from the layout, not from today’s coincidence of triage/ and queue/.
      for (const [i, status] of statuses.entries()) {
        assert.equal(cli(root, ['new', status, ...(status === 'queue' ? ['--queue'] : [])]).code, 0, `${label}: new in ${status}`);
        const rel = `docs/backlog/${status}/BS-${i + 1}-${status}.md`;
        const area = read(root, rel).match(fieldRe('area', ' (.+)$', 'm'))[1];
        if (!reference) {
          assert.equal(area, ru('[TODO: reference/ section]'), `${label}: ${rel}`);
          continue;
        }
        const href = area.match(/\(([^)]+)\)\s*$/)?.[1];
        assert.equal(href, `${toPosix(path.relative(dirs.statusDir[status], dirs.reference))}/README.md`, `${label}: ${rel}: area = ${area}`);
        assert.ok(existsSync(path.join(dirs.statusDir[status], ...href.split('/'))), `${label}: ${rel}: link ${href} must lead to a file`);
      }
      assert.doesNotMatch(cli(root, ['lint']).err, ruRe('broken link {href} (line {line})'), label);
    } finally {
      cleanup(root);
    }
  }
});

test('archive: a refusal on a broken --range comes before the move', () => {
  const root = makeProject();
  try {
    put(root, 'docs/backlog/active/BS-1-a.md', ruCard('BS-1', 'A', { area: AREA, taken: '2026-09-01' }));
    gitAll(root, 'base');
    const r = cli(root, ['archive', '1', '--range', 'nosuchref..HEAD']);
    assert.equal(r.code, 1);
    assert.ok(existsSync(path.join(root, 'docs/backlog/active/BS-1-a.md')), 'the card stayed in its directory');
    assert.ok(!existsSync(path.join(root, 'docs/archive/BS-1-a')), 'the archive directory was not created');
  } finally {
    cleanup(root);
  }
});

test('archive: --range in a project without git — a refusal, not a quiet empty list', () => {
  const root = makeProject({ git: false });
  try {
    put(root, 'docs/backlog/active/BS-1-a.md', ruCard('BS-1', 'A', { area: AREA, taken: '2026-09-01' }));
    const r = cli(root, ['archive', '1', '--range', 'HEAD~1..HEAD', '--dry-run']);
    assert.equal(r.code, 1);
    assert.match(r.err, /--range HEAD~1\.\.HEAD/);
    // Without the flag nobody asked for the list: the command works quietly.
    assert.equal(cli(root, ['archive', '1', '--dry-run']).code, 0);
  } finally {
    cleanup(root);
  }
});

test('new --minor: an N.k file in minor/ with a cost and a parent, an empty area; flag refusals', () => {
  const root = makeProject();
  try {
    cli(root, ['new', 'base', '--queue', '--title', 'Base']);
    let r = cli(root, ['new', 'leak', '--parent', '1', '--minor', '--title', 'Minor leak', '--evidence', 'lib/new.js:97 — the area is empty']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, ruRe('entry remains in minor/ until a batch: a batch is a card listing the numbers, closed with {cli} archive N.k --into M'));
    const minor = read(root, 'docs/backlog/minor/BS-1.1-leak.md');
    assert.match(minor, /^# BS-1\.1 · Minor leak\n/);
    assert.match(minor, fieldRe('area', ' \\n'));
    assert.match(minor, fieldRe('parent', ' BS-1\\n'));
    assert.match(minor, fieldRe('cost', ' minor\\n'));
    assert.match(minor, new RegExp(`## ${SECTION.evidence}\\n\\n${escapeRe(found('BS-1'))}\\n\\n${SECTION.evidence}: lib/new\\.js:97 — the area is empty\\n`));
    // A stub has nowhere to come from in minor/: the flag gives the evidence, the gate is mute.
    assert.doesNotMatch(minor, /\[TODO/);
    assert.doesNotMatch(minor, new RegExp(SECTION.work));

    r = cli(root, ['new', 'guess', '--parent', '1', '--minor', '--cost', 'major', '--hypothesis', '--evidence', 'presumably leaks at the peak']);
    assert.equal(r.code, 0, r.err);
    assert.match(read(root, 'docs/backlog/minor/BS-1.2-guess.md'), fieldRe('cost', ` major \\(${ru('hypothesis')}\\)\\n`));

    r = cli(root, ['new', 'a', '--minor']);
    assert.equal(r.code, 1);
    assert.match(r.err, ruRe('--minor is a finding: --parent N[.M] is required'));
    r = cli(root, ['new', 'a', '--parent', '1', '--minor', '--queue', '--evidence', 'x']);
    assert.equal(r.code, 1);
    assert.match(r.err, ruRe('--minor and --queue cannot be used together: a minor waits for a batch, not for the queue'));
    r = cli(root, ['new', 'a', '--parent', '1', '--cost', 'major']);
    assert.equal(r.code, 1);
    assert.match(r.err, ruRe('--cost, --hypothesis, and --evidence are only valid together with --minor'));
    r = cli(root, ['new', 'a', '--parent', '1', '--evidence', 'x']);
    assert.equal(r.code, 1);
    assert.match(r.err, ruRe('--cost, --hypothesis, and --evidence are only valid together with --minor'));
    r = cli(root, ['new', 'a', '--parent', '1', '--minor', '--cost', 'major', '--evidence', 'x']);
    assert.equal(r.code, 1);
    assert.match(r.err, ruRe('--cost {level} without --hypothesis: critical and major with evidence are fixed now, not queued for a batch; a hypothesis takes --hypothesis', { level: 'major' }));
    r = cli(root, ['new', 'a', '--parent', '1', '--minor', '--cost', 'huge', '--evidence', 'x']);
    assert.equal(r.code, 1);
    assert.match(r.err, ruRe('--cost {cost}: levels are {levels}', { cost: 'huge', levels: 'critical, major, minor' }));
    assert.ok(!existsSync(path.join(root, 'docs/backlog/minor/BS-1.3-a.md')));
  } finally {
    cleanup(root);
  }
});

test('new --minor without --evidence: refused before any write, the text says what evidence is (ru, en)', () => {
  const rows = [
    {
      lang: 'ru',
      base: ruCard('BS-1', 'Base', { order: 10, area: AREA }),
      refusal: [
        ruRe('--minor without --evidence: the entry goes to a batch without review, and no one completes it there.'),
        ruRe('  a path with a line          lib/new.js:97'),
        ruRe('  a command, output, and code “backslop lint” → exit 1, “the [TODO] placeholder remains”'),
        ruRe('  a measurement with a number 25 files out of 26 name the signature'),
        ruRe('Unverified does not excuse missing evidence — it makes it an assumption: --evidence "presumably …".'),
      ],
      evidence: 'lib/lint.js:294 → exit 1',
      card: new RegExp(`## ${SECTION.evidence}\\n\\n${escapeRe(found('BS-1'))}\\n\\n${SECTION.evidence}: lib/lint\\.js:294 → exit 1\\n`),
    },
    {
      lang: 'en',
      base: '# BS-1 · Base\n\n- **Order:** 10\n- **Scope:** [x](../../README.md)\n',
      refusal: [/--minor without --evidence/, /a path with a line/, /a command, output, and code/, /a measurement with a number/, /Unverified does not excuse missing evidence/],
      evidence: 'lib/lint.js:294 → exit 1',
      card: /## Evidence\n\nFinding discovered while working on BS-1\.\n\nEvidence: lib\/lint\.js:294 → exit 1\n/,
    },
  ];
  for (const { lang, base, refusal, evidence, card } of rows) {
    const root = makeProject();
    try {
      if (lang === 'en') put(root, 'backslop.json', `${JSON.stringify({ ...JSON.parse(read(root, 'backslop.json')), lang: 'en' }, null, 2)}\n`);
      put(root, 'docs/backlog/queue/BS-1-base.md', base);
      const minorDir = path.join(root, 'docs/backlog/minor');
      const before = readdirSync(minorDir).sort();

      let r = cli(root, ['new', 'probe', '--parent', '1', '--minor']);
      assert.equal(r.code, 1, lang);
      for (const re of refusal) assert.match(r.err, re, lang);
      assert.deepEqual(readdirSync(minorDir).sort(), before, `${lang}: the refusal comes before any write`);

      // An empty and a blank evidence is the same as none; a hypothesis is no exception.
      for (const extra of [['--evidence', ''], ['--evidence', '   '], ['--cost', 'major', '--hypothesis']]) {
        r = cli(root, ['new', 'probe', '--parent', '1', '--minor', ...extra]);
        assert.equal(r.code, 1, `${lang}: ${extra.join(' ')}`);
        assert.match(r.err, refusal[0], `${lang}: ${extra.join(' ')}`);
      }
      assert.deepEqual(readdirSync(minorDir).sort(), before, `${lang}: empty evidence writes nothing`);

      r = cli(root, ['new', 'probe', '--parent', '1', '--minor', '--evidence', evidence]);
      assert.equal(r.code, 0, `${lang}: ${r.err}`);
      const text = read(root, 'docs/backlog/minor/BS-1.1-probe.md');
      assert.match(text, card, lang);
      assert.doesNotMatch(text, /\[TODO/, lang);
      const lint = cli(root, ['lint']);
      assert.equal(lint.code, 0, `${lang}: a card from new --minor must not turn lint red: ${lint.err}`);
    } finally {
      cleanup(root);
    }
  }
});

test('mv N minor appends "Cost: minor"; status prints minor by area and returns them in JSON', () => {
  const root = makeProject();
  try {
    cli(root, ['new', 'base', '--queue', '--title', 'Base']);
    cli(root, ['new', 'idea', '--title', 'Idea']);
    let r = cli(root, ['mv', '2', 'minor', '--evidence', 'docs/backlog/README.md:15 — presumably']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, ruRe('“{field}: minor” added — adjust it if this is a hypothesis of a costlier finding', { field: FIELD.cost }));
    assert.match(read(root, 'docs/backlog/minor/BS-2-idea.md'), fieldRe('cost', ' minor\\n'));
    r = cli(root, ['mv', '2', 'minor']);
    assert.equal(r.code, 1);
    assert.match(r.err, ruRe('{id} is already in {target}/', { target: 'minor' }));

    cli(root, ['new', 'late', '--parent', '1', '--minor', '--title', 'Late', '--evidence', 'docs/backlog/README.md:13']);
    put(root, 'docs/backlog/minor/BS-1.1-late.md', ruCard('BS-1.1', 'Late', { area: '[02. CLI](../../reference/02-cli.md)', created: '2026-09-18', parent: 'BS-1', cost: 'minor' }));
    cli(root, ['new', 'early', '--parent', '1', '--minor', '--title', 'Early', '--evidence', 'docs/backlog/README.md:21']);
    put(root, 'docs/backlog/minor/BS-1.2-early.md', ruCard('BS-1.2', 'Early', { area: '[01. Layout](../../reference/01-layout.md)', created: '2026-09-18', parent: 'BS-1', cost: `major (${ru('hypothesis')})` }));
    r = cli(root, ['status']);
    assert.equal(r.code, 0, r.err);
    assert.ok(r.out.includes(`Minor (3)\n  [01. Layout] BS-1.2 · Early — major (${ru('hypothesis')})\n  [02. CLI] BS-1.1 · Late — minor\n  [${ru('no scope')}] BS-2 · Idea — minor\n${ru('Archive')}: 0`), r.out);
    const s = JSON.parse(cli(root, ['status', '--json']).out);
    assert.deepEqual(s.minor.map((m) => [m.id, m.area, m.cost]), [
      ['BS-1.2', '[01. Layout](../../reference/01-layout.md)', `major (${ru('hypothesis')})`],
      ['BS-1.1', '[02. CLI](../../reference/02-cli.md)', 'minor'],
      ['BS-2', null, 'minor'],
    ]);
    assert.equal(s.minor[2].file, 'docs/backlog/minor/BS-2-idea.md');
  } finally {
    cleanup(root);
  }
});

test('mv N.k minor: without evidence — a refusal before the move; with --evidence the setup stubs are removed, "Context" becomes "Evidence", lint is silent on the entry', () => {
  const root = makeProject();
  try {
    assert.equal(cli(root, ['new', 'base', '--queue', '--title', 'Base']).code, 0);
    assert.equal(cli(root, ['new', 'finding', '--parent', '1']).code, 0);
    const triage = 'docs/backlog/triage/BS-1.1-finding.md';
    const before = read(root, triage);

    let r = cli(root, ['mv', '1.1', 'minor']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, ruRe('{ids}: no evidence for minor/ — the “Evidence” section is missing, empty, or a [TODO] placeholder, and the entry goes to a batch without review.', { ids: 'BS-1.1' }));
    assert.match(r.err, ruRe('Give it with the flag: {cli} mv N minor --evidence "…" — a path with a line, a command with its output and exit code, or a measurement with a number.'));
    assert.equal(read(root, triage), before, 'a refusal before the move: the card is in place and untouched');

    r = cli(root, ['mv', '1.1', 'minor', '--evidence', 'lib/mv.js:95 → "Cost" appended, no "Evidence"']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, ruRe('placeholder-only sections removed: {sections}', { sections: ['work', 'outOfScope', 'verification'].map((k) => ru('“{name}”', { name: SECTION[k] })).join(', ') }));
    assert.match(r.out, ruRe('“Context” became “Evidence”'));
    const card = read(root, 'docs/backlog/minor/BS-1.1-finding.md');
    assert.match(card, new RegExp(`## ${SECTION.evidence}\\n\\n${escapeRe(found('BS-1'))}\\n${SECTION.evidence}: lib/mv\\.js:95 → "Cost" appended, no "Evidence"\\n`));
    assert.doesNotMatch(card, new RegExp(`\\[TODO|## ${SECTION.context}|## ${SECTION.work}|## ${SECTION.outOfScope}|## ${SECTION.verification}`));
    assert.match(card, fieldRe('cost', ' minor\\n'));
    assert.ok(card.endsWith('\n') && !card.endsWith('\n\n'), 'the file tail is one newline');
    assert.doesNotMatch(cli(root, ['lint']).err, /✖ docs\/backlog\/minor\/BS-1\.1/, 'a minor/ entry does not redden the gate');
  } finally {
    cleanup(root);
  }
});

test('mv N minor cuts a numbered item and a task box stub and blanks the placeholder cell of a row with written text', () => {
  const root = makeProject();
  try {
    const rows = '| a | b |\n|---|---|\n| done | [TODO] |\n\n1. [TODO]\n- [ ] [TODO]\n';
    put(root, 'docs/backlog/triage/BS-1-a.md', ruCard('BS-1', 'A', {}, [['context', 'measured'], ['work', rows.trimEnd()]]));
    const r = cli(root, ['mv', '1', 'minor', '--evidence', 'lib/x.js:1 — exit 1']);
    assert.equal(r.code, 0, r.err);
    const moved = read(root, 'docs/backlog/minor/BS-1-a.md');
    assert.ok(moved.includes(`## ${SECTION.work}\n\n| a | b |\n|---|---|\n| done |`), moved);
    assert.doesNotMatch(moved, /\[TODO|^1\. |^- \[ \]/m, 'no line that gate 4 rejects stays');
    assert.doesNotMatch(cli(root, ['lint']).err, /✖ docs\/backlog\/minor\/BS-1-a\.md/, 'a card that passes mv passes lint');
  } finally {
    cleanup(root);
  }
});

test('mv N minor cuts a stub of any section but Evidence, so a card that passes mv passes lint', () => {
  for (const [lang, notes, evidence] of [['ru', 'Notes', SECTION.evidence], ['en', 'Notes', 'Evidence']]) {
    const root = makeProject();
    try {
      put(root, 'backslop.json', `${JSON.stringify({ ...JSON.parse(read(root, 'backslop.json')), lang }, null, 2)}\n`);
      put(root, 'docs/backlog/triage/BS-1-a.md', `# BS-1 · A\n\n## ${evidence}\n\nmeasured\n\n## ${notes}\n\ndescription\n- [TODO]\n1. [TODO: x]\n`);
      const r = cli(root, ['mv', '1', 'minor']);
      assert.equal(r.code, 0, `${lang}: ${r.err}`);
      const moved = read(root, 'docs/backlog/minor/BS-1-a.md');
      assert.ok(moved.includes(`## ${notes}\n\ndescription\n`), `${lang}: ${moved}`);
      assert.doesNotMatch(moved, /\[TODO/, lang);
      assert.equal(cli(root, ['lint']).code, 0, `${lang}: lint after mv`);
    } finally {
      cleanup(root);
    }
  }
});

test('mv N minor cuts an all-placeholder Evidence table row and puts the evidence line after a blank line', () => {
  const root = makeProject();
  try {
    put(root, 'docs/backlog/triage/BS-1-a.md', `# BS-1 · A\n\n## ${SECTION.evidence}\n\n| file | result |\n|---|---|\n| [TODO] | [TODO] |\n`);
    const r = cli(root, ['mv', '1', 'minor', '--evidence', 'rc 1']);
    assert.equal(r.code, 0, r.err);
    const moved = read(root, 'docs/backlog/minor/BS-1-a.md');
    assert.ok(moved.endsWith(`|---|---|\n\n${SECTION.evidence}: rc 1\n`), moved);
    assert.doesNotMatch(moved, /\[TODO/);
  } finally {
    cleanup(root);
  }
});

test('mv N minor reads an Evidence stub by the gate 4 line rule: numbered item, task box, table cell', () => {
  const stubs = ['1. [TODO: command]', '- [ ] [TODO]', '| lib/x.js:1 | [TODO] |'];
  for (const stub of stubs) {
    const root = makeProject();
    try {
      const card = 'docs/backlog/triage/BS-1-a.md';
      put(root, card, `# BS-1 · A\n\n## ${SECTION.evidence}\n\n${stub}\n`);
      let r = cli(root, ['mv', '1', 'minor']);
      assert.equal(r.code, 1, `${stub}: ${r.out}`);
      assert.match(r.err, NO_EVIDENCE, stub);
      assert.ok(existsSync(path.join(root, card)), `${stub}: refused before the move`);
      r = cli(root, ['mv', '1', 'minor', '--evidence', 'rc 1 on the base']);
      assert.equal(r.code, 0, `${stub}: ${r.err}`);
      const moved = read(root, 'docs/backlog/minor/BS-1-a.md');
      assert.match(moved, new RegExp(`^${SECTION.evidence}: rc 1 on the base$`, 'm'), stub);
      assert.doesNotMatch(moved, /\[TODO/, `${stub}: the stub is replaced`);
      assert.equal(moved.includes('lib/x.js:1'), stub.startsWith('|'), `${stub}: a written cell survives`);
      assert.doesNotMatch(cli(root, ['lint']).err, /✖ docs\/backlog\/minor\/BS-1-a\.md/, stub);
    } finally {
      cleanup(root);
    }
  }
});

test('mv N minor keeps the written cells of every Evidence table row that has a placeholder cell', () => {
  const root = makeProject();
  try {
    const table = '| file | result |\n|---|---|\n| lib/x.js:1 | [TODO] |\n| lib/y.js:2 | [TODO] |\n';
    put(root, 'docs/backlog/triage/BS-1-a.md', `# BS-1 · A\n\n## ${SECTION.evidence}\n\n${table}`);
    const r = cli(root, ['mv', '1', 'minor', '--evidence', 'rc 1']);
    assert.equal(r.code, 0, r.err);
    const moved = read(root, 'docs/backlog/minor/BS-1-a.md');
    assert.ok(moved.includes('| lib/x.js:1 |') && moved.includes('| lib/y.js:2 |'), moved);
    assert.match(moved, new RegExp(`^${SECTION.evidence}: rc 1$`, 'm'));
    assert.doesNotMatch(cli(root, ['lint']).err, /✖ docs\/backlog\/minor\/BS-1-a\.md/);
  } finally {
    cleanup(root);
  }
});

test('mv N minor refuses when the only Evidence line has a [TODO field name and a placeholder value', () => {
  const root = makeProject();
  try {
    const card = 'docs/backlog/triage/BS-1-a.md';
    put(root, card, `# BS-1 · A\n\n## ${SECTION.evidence}\n\n- [TODO] note: [TODO: x]\n`);
    const r = cli(root, ['mv', '1', 'minor']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, NO_EVIDENCE);
    assert.ok(existsSync(path.join(root, card)), 'refused before the move');
  } finally {
    cleanup(root);
  }
});

test('mv N minor cuts a statement line with a [TODO field name and a placeholder value, keeps the written text', () => {
  const root = makeProject();
  try {
    put(root, 'docs/backlog/triage/BS-1-a.md', `# BS-1 · A\n\n## ${SECTION.evidence}\n\nmeasured\n\n## ${SECTION.work}\n\ndo it by hand\n- [TODO] note: [TODO: x]\n`);
    const r = cli(root, ['mv', '1', 'minor']);
    assert.equal(r.code, 0, r.err);
    const moved = read(root, 'docs/backlog/minor/BS-1-a.md');
    assert.match(moved, new RegExp(`## ${SECTION.work}\\n\\ndo it by hand\\n`));
    assert.doesNotMatch(moved, /\[TODO/);
  } finally {
    cleanup(root);
  }
});

test('mv N minor keeps a Scope that only starts with [TODO and blanks the placeholder from new', () => {
  const root = makeProject();
  try {
    assert.equal(cli(root, ['new', 'area-probe']).code, 0);
    assert.equal(cli(root, ['new', 'area-stub']).code, 0);
    const probe = 'docs/backlog/triage/BS-1-area-probe.md';
    put(root, probe, read(root, probe).replace(new RegExp(`- \\*\\*${FIELD.area}:\\*\\* .*`), `- **${FIELD.area}:** [TODO] owner decides; notes kept here`));
    const stub = 'docs/backlog/triage/BS-2-area-stub.md';
    put(root, stub, read(root, stub).replace(new RegExp(`- \\*\\*${FIELD.area}:\\*\\* .*`), `- **${FIELD.area}:** [TODO: section](../../reference/README.md)`));
    for (const id of ['1', '2']) assert.equal(cli(root, ['mv', id, 'minor', '--evidence', 'lib/mv.js:1']).code, 0);
    assert.match(read(root, 'docs/backlog/minor/BS-1-area-probe.md'), new RegExp(`^- \\*\\*${FIELD.area}:\\*\\* \\[TODO\\] owner decides; notes kept here$`, 'm'));
    assert.match(read(root, 'docs/backlog/minor/BS-2-area-stub.md'), new RegExp(`^- \\*\\*${FIELD.area}:\\*\\*[ \\t]*$`, 'm'));
  } finally {
    cleanup(root);
  }
});

test('mv N minor: written text stays, a ready "Evidence" needs no flag, the flag refusals', () => {
  const root = makeProject();
  try {
    put(root, 'docs/backlog/triage/BS-1-a.md', ruCard('BS-1', 'A', { area: '[TODO: section]' }, [['context', 'Why: measured lint → exit 1.'], ['work', '- [TODO]\n- fix the refusal'], ['outOfScope', '- [TODO]'], ['verification', '```\n[TODO] in the example\n```']]));
    put(root, 'docs/backlog/triage/BS-2-b.md', ruCard('BS-2', 'B', {}, [['context', 'history'], ['evidence', 'lib/x.js:1 — exit 1']]));
    put(root, 'docs/backlog/triage/BS-3-c.md', ruCard('BS-3', 'C', {}, [['context', '[TODO: where the task came from]']]));
    let r = cli(root, ['mv', '1', 'minor']);
    assert.equal(r.code, 0, r.err);
    assert.equal(read(root, 'docs/backlog/minor/BS-1-a.md'), ruCard('BS-1', 'A', { area: '', cost: 'minor' }, [['evidence', 'Why: measured lint → exit 1.'], ['work', '- fix the refusal'], ['verification', '```\n[TODO] in the example\n```']]));
    r = cli(root, ['mv', '2', 'minor']);
    assert.equal(r.code, 0, r.err);
    assert.equal(read(root, 'docs/backlog/minor/BS-2-b.md'), ruCard('BS-2', 'B', { cost: 'minor' }, [['context', 'history'], ['evidence', 'lib/x.js:1 — exit 1']]));
    assert.doesNotMatch(r.out, ruRe('“Context” became “Evidence”'));

    r = cli(root, ['mv', '3', 'queue', '--evidence', 'x']);
    assert.equal(r.code, 1);
    assert.match(r.err, ruRe('--evidence is only valid when moving to minor'));
    put(root, 'docs/backlog/triage/BS-4-d.md', ruCard('BS-4', 'D'));
    r = cli(root, ['mv', '3', '4', 'minor', '--evidence', 'x']);
    assert.equal(r.code, 1);
    assert.match(r.err, ruRe('--evidence takes one number: each entry has evidence of its own'));
    r = cli(root, ['mv', '3', '4', 'minor']);
    assert.equal(r.code, 1);
    assert.match(r.err, ruRe('{ids}: no evidence for minor/ — the “Evidence” section is missing, empty, or a [TODO] placeholder, and the entry goes to a batch without review.', { ids: 'BS-3, BS-4' }));
    assert.ok(existsSync(path.join(root, 'docs/backlog/triage/BS-3-c.md')) && existsSync(path.join(root, 'docs/backlog/triage/BS-4-d.md')), 'a batch — all or nothing');
    r = cli(root, ['mv', '3', 'minor', '--evidence', 'presumably leaks']);
    assert.equal(r.code, 0, r.err);
    assert.equal(read(root, 'docs/backlog/minor/BS-3-c.md'), ruCard('BS-3', 'C', { cost: 'minor' }, [['evidence', `${SECTION.evidence}: presumably leaks`]]));
  } finally {
    cleanup(root);
  }
});

test('mv N minor in an EN project: Context becomes Evidence, the evidence line is Evidence:', () => {
  const root = makeProject();
  try {
    put(root, 'backslop.json', `${JSON.stringify({ ...JSON.parse(read(root, 'backslop.json')), lang: 'en' }, null, 2)}\n`);
    put(root, 'docs/backlog/triage/BS-1-a.md', '# BS-1 · A\n\n## Context\n\nFinding discovered while working on BS-7.\nEvidence: [TODO: file path or command output]\n\n## Work to do\n\n- [TODO]\n');
    let r = cli(root, ['mv', '1', 'minor']);
    assert.equal(r.code, 1);
    assert.match(r.err, /BS-1: no evidence for minor\//);
    r = cli(root, ['mv', '1', 'minor', '--evidence', 'lib/mv.js:95 → exit 0']);
    assert.equal(r.code, 0, r.err);
    assert.equal(read(root, 'docs/backlog/minor/BS-1-a.md'), '# BS-1 · A\n\n- **Cost:** minor\n\n## Evidence\n\nFinding discovered while working on BS-7.\nEvidence: lib/mv.js:95 → exit 0\n');
  } finally {
    cleanup(root);
  }
});

test('archive N.k --into M: a minor moves into the batch’s archive minor/ without result.md, links are rewritten; refusals', () => {
  const root = makeProject();
  try {
    cli(root, ['new', 'base', '--queue', '--title', 'Base']);
    cli(root, ['new', 'leak', '--parent', '1', '--minor', '--title', 'Leak', '--evidence', 'lib/lint.js:294, exit 1']);
    cli(root, ['new', 'typo', '--parent', '1', '--minor', '--title', 'Typo', '--evidence', 'docs/GLOSSARY.md:12']);
    cli(root, ['new', 'batch', '--queue', '--title', 'Batch']);
    put(root, 'docs/notes.md', '# Notes\n\nSee [leak](backlog/minor/BS-1.1-leak.md).\n');
    gitAll(root);

    let r = cli(root, ['archive', '1.1', '--into', '2']);
    assert.equal(r.code, 1);
    assert.match(r.err, ruRe('batch {id} is still in {status}/ — close it first: {cli} archive {id}', { id: 'BS-2', status: 'queue' }));
    assert.ok(existsSync(path.join(root, 'docs/backlog/minor/BS-1.1-leak.md')));
    assert.ok(!existsSync(path.join(root, 'docs/archive/BS-2-batch')));

    assert.equal(cli(root, ['archive', '2']).code, 0);
    r = cli(root, ['archive', '1.1', '--into', 'BS-2', '--dry-run']);
    assert.equal(r.code, 0, r.err);
    assert.doesNotMatch(r.out, /^✔/m, 'a dry run prints no success line');
    assert.match(r.out, new RegExp(`^ {2}${ruRe('would update links in {changed} files', { changed: 1 }).source}$`, 'm'));
    assert.match(r.out, /^ {4}docs\/notes\.md$/m);
    assert.match(r.out.trimEnd().split('\n').at(-1), new RegExp(`^ {2}${ruRe('--dry-run: nothing was written').source}$`));
    assert.ok(existsSync(path.join(root, 'docs/backlog/minor/BS-1.1-leak.md')), 'the entry stays in minor/');
    r = cli(root, ['archive', '1.1', '--into', 'BS-2']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, ruRe('archive: {id} → batch {batchId} — files with updated links {changed}', { id: 'BS-1.1', batchId: 'BS-2', changed: 1 }));
    assert.match(r.out, ruRe('name the outcome of {id} in the result.md of batch {batchId}; the entry has no result.md of its own', { id: 'BS-1.1', batchId: 'BS-2' }));
    assert.ok(existsSync(path.join(root, 'docs/archive/BS-2-batch/minor/BS-1.1-leak.md')));
    assert.ok(!existsSync(path.join(root, 'docs/backlog/minor/BS-1.1-leak.md')));
    assert.ok(!existsSync(path.join(root, 'docs/archive/BS-1.1-leak')));
    assert.match(read(root, 'docs/notes.md'), /\(archive\/BS-2-batch\/minor\/BS-1\.1-leak\.md\)/);
    assert.match(run(root, ['status', '--porcelain']).stdout, /^R  docs\/backlog\/minor\/BS-1\.1-leak\.md -> docs\/archive\/BS-2-batch\/minor\/BS-1\.1-leak\.md$/m);

    r = cli(root, ['archive', '1', '--into', '2']);
    assert.equal(r.code, 1);
    assert.match(r.err, ruRe('{id} is not in minor/ ({rel}): --into closes minor entries by batch only; merge cards with {cli} archive N and a “merged into …” outcome in result.md', { id: 'BS-1' }));
    r = cli(root, ['archive', '1.2', '--into', '99']);
    assert.equal(r.code, 1);
    assert.match(r.err, ruRe('batch {intoId} was not found in any status directory or archive', { intoId: 'BS-99' }));
    r = cli(root, ['archive', '1.2', '--into', '1.2']);
    assert.equal(r.code, 1);
    assert.match(r.err, ruRe('{id} is a minor entry itself and cannot be a batch'));
    r = cli(root, ['archive', '1.2', '--into', '2', '--range', 'HEAD~1..HEAD']);
    assert.equal(r.code, 1);
    assert.match(r.err, ruRe('--range cannot be combined with --into: the batch accounts for the touched docs'));
    r = cli(root, ['archive', '1.1', '--into', '2']);
    assert.equal(r.code, 1);
    assert.match(r.err, new RegExp(escapeRe(ru('{id} is already archived: {rel} — fold it into a journal line with {cli} fold {id}', { id: 'BS-1.1', rel: '\0' }).split('\0')[0])));

    // An entry closed by a batch is known to the numbering and the summary: the next finding is
    // BS-1.3, the archive counts tasks.
    r = cli(root, ['new', 'next', '--parent', '1', '--minor', '--evidence', 'docs/reference/02-cli.md:12']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /BS-1\.3/);
    const s = JSON.parse(cli(root, ['status', '--json']).out);
    assert.equal(s.archive, 1);
    assert.deepEqual(s.minor.map((m) => m.id), ['BS-1.2', 'BS-1.3']);
  } finally {
    cleanup(root);
  }
});

test('upgrade: a source tag list over 1 MiB is read, not cut off by ENOBUFS', () => {
  const src = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-many-tags-')));
  try {
    run(src, ['init', '-q', '-b', 'main']);
    run(src, ['-c', 'user.email=t@e', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'one']);
    const sha = run(src, ['rev-parse', 'HEAD']).stdout.trim();
    const refs = Array.from({ length: 20_000 }, (_, i) => `${sha} refs/tags/v0.0.${i}\n`).join('');
    writeFileSync(path.join(src, '.git', 'packed-refs'), refs);
    assert.ok(refs.length > 1 << 20, 'the ls-remote output is larger than the default spawnSync buffer');
    assert.equal(listReleaseTags(src).length, 20_000);
  } finally {
    rmSync(src, { recursive: true, force: true });
  }
});

test('runnable hints in error messages name the project cli', () => {
  const root = makeProject();
  try {
    const cfg = JSON.parse(read(root, 'backslop.json'));
    put(root, 'backslop.json', `${JSON.stringify({ ...cfg, lang: 'en', cli: 'npx mybs' }, null, 2)}\n`);
    for (const command of ['new', 'adr', 'mv', 'archive', 'seed', 'brief']) {
      const r = cli(root, [command]);
      assert.equal(r.code, 1, command);
      assert.match(r.err, /npx mybs /, `${command}: ${r.err}`);
    }
    const r = cli(root, ['frob']);
    assert.equal(r.code, 1);
    assert.match(r.err, /see npx mybs help$/m);
    const hints = [
      [['new', 'a'], 0, 'out', /with npx mybs mv <N> queue$/m],
      [['mv', '1', 'bogus'], 1, 'err', /Close tasks with npx mybs archive$/m],
      [['new', 'y', '--parent', '1', '--minor', '--evidence', 'e'], 0, 'out', /closed with npx mybs archive N\.k --into M$/m],
      [['new', 'z', '--parent', '1'], 0, 'out', /npx mybs mv <N> queue$/m],
      [['mv', '1.2', 'minor'], 1, 'err', /Give it with the flag: npx mybs mv N minor --evidence/],
      [['archive', '1', '--into', '2'], 1, 'err', /merge cards with npx mybs archive N and/],
      [['new', 'q1', '--queue'], 0, 'out', /BS-2/],
      [['new', 'q2', '--queue'], 0, 'out', /BS-3/],
    ];
    for (const [args, code, stream, re] of hints) {
      const h = cli(root, args);
      assert.equal(h.code, code, `${args.join(' ')}: ${h.err}`);
      assert.match(h[stream], re, args.join(' '));
    }
    put(root, 'docs/backlog/minor/BS-1.1-y.md', read(root, 'docs/backlog/minor/BS-1.1-y.md').replace('**Cost:** minor', '**Cost:** major'));
    put(root, 'docs/backlog/queue/BS-3-q2.md', read(root, 'docs/backlog/queue/BS-3-q2.md').replace(/\*\*Order:\*\* \d+/, '**Order:** 10'));
    const lint = cli(root, ['lint']);
    assert.equal(lint.code, 1);
    assert.match(lint.err, /fix it or npx mybs mv N\.k triage$/m);
    assert.match(lint.err, /reorder with npx mybs mv N queue --top \| --after M$/m);
  } finally {
    cleanup(root);
  }
  const outside = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-noproj-')));
  try {
    const r = cli(outside, ['frob']);
    assert.equal(r.code, 1);
    assert.match(r.err, /backslop help$/m);
  } finally {
    cleanup(outside);
  }
});

test('mv: a failed git mv names the exit code in the project language', { skip: process.platform === 'win32' }, () => {
  const root = makeProject();
  const shim = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-git-shim-')));
  try {
    const cfg = JSON.parse(read(root, 'backslop.json'));
    put(root, 'backslop.json', `${JSON.stringify({ ...cfg, lang: 'en' }, null, 2)}\n`);
    assert.equal(cli(root, ['new', 'a']).code, 0);
    gitAll(root);
    const real = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
    writeFileSync(path.join(shim, 'git'), `#!/bin/sh\nfor a in "$@"; do [ "$a" = mv ] && exit 1; done\nexec "${real}" "$@"\n`, { mode: 0o755 });
    const r = cli(root, ['mv', '1', 'queue'], { env: { PATH: `${shim}${path.delimiter}${process.env.PATH}` } });
    assert.equal(r.code, 1);
    assert.match(r.err, /^✖ git mv -- .*: exit code 1$/m);
  } finally {
    cleanup(root);
    rmSync(shim, { recursive: true, force: true });
  }
});

test('mv in an en project quotes the Order field with English quotes', () => {
  const root = makeProject();
  try {
    const cfg = JSON.parse(read(root, 'backslop.json'));
    put(root, 'backslop.json', `${JSON.stringify({ ...cfg, lang: 'en' }, null, 2)}\n`);
    assert.equal(cli(root, ['new', 'one', '--queue']).code, 0);
    assert.equal(cli(root, ['new', 'two', '--queue']).code, 0);
    const r = cli(root, ['mv', '2', 'queue', '--top']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /^✔ BS-2: queue\/ “Order” \d+$/m);
  } finally {
    cleanup(root);
  }
});
