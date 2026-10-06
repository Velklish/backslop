// The lint gates: a green project and a red probe per gate. A probe mutates the green project;
// without it a gate cannot be told from an idle one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadProject, parseCli } from '../lib/config.js';
import { lintProject } from '../lib/lint.js';
import { livePinFiles } from '../lib/mdwalk.js';
import { rewriteProsePins } from '../lib/upgrade.js';
import { ANY, FIELD, KILLED, REPO, SECTION, cleanup, cli, escapeRe, gitAll, killedRe, makeProject, put, read, resultTemplateParagraphs, ru, ruCard, ruExpand, ruOutcome, ruOutcomeWord, ruRe, ruResult, ruResultHeading, ruHeadRe, run, toolCli, toolCopy } from './helpers.mjs';
import { TOOL_VERSION } from '../lib/version.js';
import { msg } from '../lib/i18n.js';
import { formatCost } from '../lib/tasks.js';

const AREA = '[x](../../reference/README.md)';
const ANCHOR = SECTION.context.toLowerCase();
const DEFERRED_BODY = '- **Reason:** no runner\n- **Return condition:** a runner appears';
const ONE = 'One concept, one name.';
const closed = (id, date = '2026-08-01') => ruResult(id, date, `${ruOutcome('completed')}.`);
const STAMP = ruResult('BS-4', '2026-08-01').split('\n\n')[1].trim();
const findingLine = (id) => ru('Finding discovered while working on {id}.', { id });
const EVIDENCE_STUB = ru('Evidence: [TODO: file path or command output]');

function seedGreen(root) {
  put(root, 'docs/README.md', [
    '# Documentation', '',
    '| Document | Topic | Status |', '|---|---|---|',
    '| [backlog/](backlog/README.md) | tracker | Live |',
    '| [adr/adr-001-process.md](adr/adr-001-process.md) | process | Accepted |',
    '',
  ].join('\n'));
  put(root, 'docs/adr/adr-001-process.md', '# ADR-001: Process\n\n**Status:** Accepted\n');
  put(root, 'docs/backlog/queue/BS-1-a.md', ruCard('BS-1', 'A', { order: 10, area: AREA }));
  put(root, 'docs/backlog/active/BS-2-b.md', ruCard('BS-2', 'B', { area: AREA, taken: '2026-09-01' }));
  put(root, 'docs/backlog/deferred/BS-3-c.md', ruCard('BS-3', 'C', { area: AREA }, [['deferred', DEFERRED_BODY]]));
  put(root, 'docs/backlog/triage/BS-2.1-d.md', `${ruCard('BS-2.1', 'D')}\n${findingLine('BS-2')}\n`);
  // The finding BS-4.1 is triaged into deferred/; the closed parent BS-4 does not redden it.
  put(root, 'docs/backlog/deferred/BS-4.1-f.md', ruCard('BS-4.1', 'E', { area: AREA }, [['deferred', DEFERRED_BODY]]));
  put(root, 'docs/archive/BS-4-e/task.md', ruCard('BS-4', 'D'));
  put(root, 'docs/archive/BS-4-e/result.md', closed('BS-4'));
  put(root, 'docs/reference/README.md', `# ${SECTION.context}\n\n${ONE}\n\nExample:\n\n\`\`\`\nno fence\n\`\`\`\n`);
  put(root, 'docs/quoting.md', ['# Quotes', '',
    '<!-- quote:reference/README.md -->', '', '```', ONE, '```', '', '<!-- /quote -->', '',
    // A quote of a piece of documentation: a fence inside it is part of the text, not a wrapper.
    '<!-- quote:reference/README.md -->', '', 'Example:', '', '```', 'no fence', '```', '', '<!-- /quote -->', ''].join('\n'));
  put(root, 'CHANGELOG.md', '## Unreleased\n\n- **One** — the new revision\n\n## v0.1.0\n\n- **One** — the earlier revision, BS-4\n');
  put(root, 'README.md', 'See [docs](docs/README.md)\n');
}

const problems = (root) => lintProject(loadProject(root)).errors.map((p) => `${p.file}: ${p.msg}`);
const warnings = (root) => lintProject(loadProject(root)).warnings.map((p) => `${p.file}: ${p.msg}`);

// An error line "<file>: <message>" in the Russian of a `lang: ru` project: as text, as a pattern
// source, as a pattern.
const errLine = (file, en, params) => `${file}: ${ru(en, params)}`;
const errSrc = (file, en, params) => `${escapeRe(`${file}: `)}${ruRe(en, params).source}`;
const errRe = (file, en, params) => new RegExp(errSrc(file, en, params));
const exactRe = (file, en, params) => new RegExp(`^${errSrc(file, en, params)}$`);
const atLine = (lineNo) => ru('line {lineNo}', { lineNo });
const noErrorsRe = (count) => ruRe('lint: no errors{tail}', count === undefined ? {} : { tail: ru(', warnings {warnings}', { warnings: count }) });

const BROKEN = 'broken link {href} (line {line})';
const NO_ANCHOR = 'link {href}: {where} has no anchor “{fragment}” — no heading or id by that name (line {line})';
const NO_LABEL = 'link [{text}] uses the label “{label}”, and there is no declaration “[{label}]: …” (line {line})';
const DIR_LINK = 'link [{text}]({href}) points to a directory while its text names a task — point it at the task file or its journal line (line {line})';
const JOURNAL_MISS = 'link {href} points at a journal line that does not exist — anchor “{anchor}” belongs to no entry (line {line})';
const QUOTE_MISSING = 'quote points at a missing file {href}';
const LINK_OUT = 'a symlink leading out of the project — the tasks in it are not read; point the link inside the project or replace it with a directory';
const QUOTE_DIFF = 'quote no longer matches {href}: “{first}”';
const QUOTE_OPEN = 'quote block “quote:{href}” is not closed by “/quote”';
const QUOTE_CLOSER = 'line {line}: “/quote” closes no quote block';
const QUOTE_MARKER = 'line {line}: the quote marker does not parse';
const HEAD_NAMES = 'heading names {heading}, but filename names {id}';
const TODO_LINE = 'line {line}: the [TODO] placeholder remains';
const MINOR_NO_COST = 'minor entry has no “{label}” field: critical, major or minor; a hypothesis carries “(hypothesis)”';
const NO_AREA = 'has no “{label}” field naming the reference section this task belongs to';
const AREA_EMPTY = '“{label}” is empty: name the reference section';
const AREA_INCOMPLETE = '“{label}” is incomplete: the [TODO] placeholder from new remains';
const NO_ORDER = 'queue task has no “{field}” field — queue position is not set';
const DUP_FIELD = 'field “{field}” occurs more than once on lines {lines}';
const SECTION_INCOMPLETE = '“{section}” section is incomplete: [TODO] remains';
const DEFERRED_MISSING = 'deferred task has no “## {section}” section with a reason and return condition';
const DUP_ENTRY = 'line {line}: entry title “{title}” already exists in section “{section}” (line {prev}) — keep one revision';
const ADR_NAME = 'name does not match adr-NNN-<slug>.md';
const FINDING_PARENT = 'finding {id} sits in triage/ while task {parentId} is closed — triage it (approver)';
const ORDER_OUTSIDE = 'card in {status}/ has “{field}” — only a queue/ card has it; delete the line';
const PREV_IN_QUEUE = 'queue/ card has “{field}” — the place it left queue/ with, dropped on entering; delete the line';
const PARENT_NUMBER = '“{field}” names {named}, but the file name has the number {number} — fix the field or the file name';
const LAYOUT_OLDER = 'layout is older than the tool: v{stamp} < v{version} — run {cli} upgrade';
const UNPINNED = 'an unpinned cli fetches a fresh version on every run — run {cli} upgrade';
const REACH = 'reachability of journal revisions from HEAD was not checked: {why}';
const PIN_DIFFERS = '{at}: pin {pin} differs from cli — expected {expected}; {cli} upgrade rewrites it';
const PIN_TOOL = 'line {line}: pin {pin} — the tool is on v{version}';
const PKG_VERSION = 'package.json version v{version} differs from the {config} stamp v{stamp} — npm run release -- X.Y.Z --bump updates both';
const BYTE = 'byte {code} at offset {at} (line {line}): {why} — write it as an escape sequence (\\u00{hex})';
const NUL_WHY = ru('NUL makes the file binary to git and grep, and searching it finds nothing');
const CONTROL_WHY = ru('an invisible control byte: neither an editor nor the output shows it');
const NO_OUTCOME = 'result.md names no outcome word — completed, rejected, or merged into {prefix}-N — in its first paragraph or heading: a bare “Closed” or an “Outcome:” marker is not an outcome, folding would read either as “completed”, and with no word at all it would write “—”';

function probe(name, mutate, expect) {
  test(`lint: ${name}`, () => {
    const root = makeProject({ git: false });
    try {
      seedGreen(root);
      mutate(root);
      const found = problems(root);
      assert.ok(found.some((p) => expect.test(p)), `expected /${expect.source}/, found: ${found.join(' | ') || 'nothing'}`);
    } finally {
      cleanup(root);
    }
  });
}

function greenProbe(name, mutate) {
  test(`lint: ${name}`, () => {
    const root = makeProject({ git: false });
    try {
      seedGreen(root);
      mutate(root);
      assert.deepEqual(problems(root), []);
    } finally {
      cleanup(root);
    }
  });
}

test('lint: a green project has no errors, the CLI exits 0', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    assert.deepEqual(problems(root), []);
    const r = cli(root, ['lint']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, noErrorsRe());
    assert.equal(r.err, '', 'a green lint is silent in stderr too');
  } finally {
    cleanup(root);
  }
});

test('lint: an unknown flag is refused like in every other command', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    for (const args of [['--bogus'], ['--json'], ['--nope', '--json', 'foo']]) {
      const r = cli(root, ['lint', ...args]);
      assert.equal(r.code, 1, `${args.join(' ')}: ${r.out}`);
      assert.match(r.err, new RegExp(`^✖ ${ruRe('unknown option “{flag}”; see the command’s --help for its flags', { flag: args[0] }).source}`), args.join(' '));
      assert.doesNotMatch(r.out, noErrorsRe(), `${args.join(' ')}: lint ran anyway`);
    }
    assert.equal(cli(root, ['lint']).code, 0);
  } finally {
    cleanup(root);
  }
});

test('lint: EN project accepts RU metadata and reports errors in English', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    put(root, 'backslop.json', '{"prefix":"BS","docs":"docs","gates":[],"lang":"en","tools":[]}\n');
    put(root, 'docs/archive/BS-4-e/result.md', '# Result\n\n[TODO]\n');
    const r = cli(root, ['lint']);
    assert.equal(r.code, 1);
    assert.match(r.err, /result is incomplete/);
    assert.doesNotMatch(r.err, /\p{Script=Cyrillic}/u);
  } finally { cleanup(root); }
});

probe('1. a broken link in docs', (root) => put(root, 'docs/note.md', '[missing](reference/none.md)\n'), errRe('docs/note.md', BROKEN, { href: 'reference/none.md' }));
probe('1. a broken link in the root README', (root) => put(root, 'README.md', '[missing](docs/none.md)\n'), errRe('README.md', BROKEN));
test('lint: 1. a link whose target differs only in letter case is an error on any filesystem', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    put(root, 'backslop.json', '{"prefix":"BS","docs":"docs","gates":[],"lang":"en","tools":[]}\n');
    put(root, 'docs/note.md', '[overview](reference/readme.md)\n');
    const r = cli(root, ['lint']);
    assert.equal(r.code, 1);
    assert.match(r.err, /docs\/note\.md: link target differs in case: docs\/reference\/README\.md \(link reference\/readme\.md, line 1\)/);
    assert.match(r.err, /lint: errors 1\b/);
  } finally {
    cleanup(root);
  }
});
test('lint: 1. balanced parentheses and every URI scheme pass; a BOM hides no first-line link', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    put(root, 'docs/reference/foo(1).md', '# Foo\n');
    const links = '[foo](reference/foo(1).md) [ftp](ftp://host/f.txt) [file](file:///etc/hosts) [tel](tel:+123) '
      + '[up](HTTPS://example.com) [proto](//cdn.example.com/a.png)\n';
    put(root, 'docs/note.md', links);
    put(root, 'README.md', links.replace('reference/', 'docs/reference/'));
    assert.deepEqual(problems(root), []);
    put(root, 'docs/bom.md', '\uFEFF[missing]: reference/nope.md\n');
    put(root, 'docs/fence.md', '\uFEFF```\nexample\n```\n\nSee [missing](reference/nope.md).\n');
    assert.deepEqual(problems(root), [
      errLine('docs/bom.md', BROKEN, { href: 'reference/nope.md', line: 1 }),
      errLine('docs/fence.md', BROKEN, { href: 'reference/nope.md', line: 5 }),
    ]);
  } finally {
    cleanup(root);
  }
});
probe('1. an upper-case .MD file is walked', (root) => put(root, 'docs/NOTE.MD', '[missing](reference/nope.md)\n'), errRe('docs/NOTE.MD', BROKEN, { href: 'reference/nope.md' }));
test('lint: 1, 8, 13. a git failure while finding the repository root refuses instead of resolving blind', { skip: process.platform === 'win32' }, () => {
  const root = makeProject();
  const shim = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-git-shim-')));
  try {
    seedGreen(root);
    const real = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
    writeFileSync(path.join(shim, 'git'), `#!/bin/sh\nfor a in "$@"; do [ "$a" = "$KILL_ON" ] && kill -9 $$; done\nexec "${real}" "$@"\n`, { mode: 0o755 });
    assert.equal(cli(root, ['lint']).code, 0);
    for (const [arg, cause] of [
      ['--is-inside-work-tree', killedRe('git rev-parse --is-inside-work-tree')],
      ['--show-prefix', killedRe('git rev-parse --show-prefix')],
    ]) {
      const r = cli(root, ['lint'], { env: { KILL_ON: arg, PATH: `${shim}${path.delimiter}${process.env.PATH}` } });
      assert.equal(r.code, 1, `${arg}: ${r.out}`);
      assert.match(r.err, cause);
    }
  } finally {
    cleanup(root);
    rmSync(shim, { recursive: true, force: true });
  }
});

test('lint: 1, 10, 13. a root markdown symlink into the project is read; one leading outside is not', { skip: process.platform === 'win32' }, () => {
  const root = makeProject({ git: false });
  const outside = mkdtempSync(path.join(os.tmpdir(), 'backslop-lint-outside-'));
  try {
    seedGreen(root);
    seedLog(root);
    rmSync(path.join(root, 'README.md'));
    put(root, 'notes/README.md', '[broken](docs/none.md) [log](docs/archive/LOG.md#bs-55)\n\n<!-- quote:docs/none.md -->\ntext\n<!-- /quote -->\n');
    symlinkSync(path.join(root, 'notes', 'README.md'), path.join(root, 'README.md'));
    writeFileSync(path.join(outside, 'OUT.md'), '[broken](docs/none.md)\n');
    symlinkSync(path.join(outside, 'OUT.md'), path.join(root, 'OUT.md'));
    assert.deepEqual(problems(root), [
      errLine('README.md', BROKEN, { href: 'docs/none.md', line: 1 }),
      errLine('README.md', JOURNAL_MISS, { href: 'docs/archive/LOG.md#bs-55', anchor: 'bs-55', line: 1 }),
      errLine('README.md', TRACKER_LINK, { line: 1, token: 'docs/archive/LOG.md#bs-55' }),
      errLine('README.md', QUOTE_MISSING, { href: 'docs/none.md' }),
    ]);
  } finally {
    cleanup(root);
    rmSync(outside, { recursive: true, force: true });
  }
});
probe('1. a link with a task number points at a directory', (root) => put(root, 'docs/backlog/queue/BS-1-a.md', `${read(root, 'docs/backlog/queue/BS-1-a.md')}\n**Finding.** [BS-2.1](../triage) — a card\n`), errRe('BS-1-a.md', DIR_LINK, { text: 'BS-2.1', href: '../triage' }));
probe('1. a reference-style link with a task number points at a directory', (root) => put(root, 'docs/backlog/queue/BS-1-a.md', `${read(root, 'docs/backlog/queue/BS-1-a.md')}\n**Finding.** [BS-2.1][f] — a card\n\n[f]: ../triage\n`), errRe('BS-1-a.md', DIR_LINK, { text: 'BS-2.1', href: '../triage' }));
probe('1. a link with a task number to a directory in generated adapter output', (root) => {
  assert.equal(cli(root, ['init', '--tools', 'claude']).code, 0);
  put(root, '.claude/skills/backslop-task/SKILL.md', `${read(root, '.claude/skills/backslop-task/SKILL.md')}\nSee [BS-2](../../../docs/backlog/triage)\n`);
}, errRe('.claude/skills/backslop-task/SKILL.md', DIR_LINK, { text: 'BS-2', href: '../../../docs/backlog/triage' }));
probe('1. the number in the text of a directory link — in a code span too', (root) => put(root, 'README.md', 'See [`BS-2.1` · finding](docs/backlog/triage/)\n'), errRe('README.md', DIR_LINK, { text: '`BS-2.1` · finding', href: 'docs/backlog/triage/' }));
greenProbe('1. an unclosed bracket with a number before a directory link is not link text', (root) => put(root, 'docs/backlog/queue/BS-1-a.md', `${read(root, 'docs/backlog/queue/BS-1-a.md')}\nA half-open interval [0, 1) — see BS-2.1. The layout — [backlog/](../triage).\n`));
greenProbe('1. a directory without a number in the text and a card with a number are legal targets', (root) => put(root, 'docs/backlog/queue/BS-1-a.md', `${read(root, 'docs/backlog/queue/BS-1-a.md')}\n[triage/](../triage) and **Finding.** [BS-2.1](../triage/BS-2.1-d.md)\n`));
probe('1. a broken link in a backslop skill', (root) => {
  assert.equal(cli(root, ['init', '--tools', 'claude']).code, 0);
  put(root, '.claude/skills/backslop-task/SKILL.md', '<!-- backslop:generated -->\n[missing](../none.md)\n');
}, errRe('SKILL.md', BROKEN));
probe('adapter: no Claude stub', (root) => {
  const cfg = JSON.parse(read(root, 'backslop.json'));
  put(root, 'backslop.json', `${JSON.stringify({ ...cfg, tools: ['claude'] }, null, 2)}\n`);
}, errRe('CLAUDE.md', 'Claude stub is missing — run {cli} init'));
probe('1. a broken link in a Cursor rule is checked separately', (root) => {
  assert.equal(cli(root, ['init', '--tools', 'cursor']).code, 0);
  put(root, '.cursor/rules/backslop-task.mdc', '<!-- backslop:generated -->\n[missing](backslop-task/references/none.md)\n');
}, errRe('backslop-task.mdc', BROKEN));
probe('adapter output is missing', (root) => {
  assert.equal(cli(root, ['init', '--tools', 'claude']).code, 0);
  rmSync(path.join(root, '.claude/skills/backslop-task/SKILL.md'));
}, ruRe('generated output for adapter {tool} is missing — run {cli} init', { tool: 'claude' }));

// The repro lines of the link gate, each appended alone to docs/README.md, where it is line 8.
const appendReadme = (line) => (root) => {
  put(root, 'docs/img.png', '');
  put(root, 'docs/README.md', `${read(root, 'docs/README.md')}\n${line}\n`);
};
probe('1. a missing anchor in another file', appendReadme('[a](reference/README.md#no-such-heading)'),
  exactRe('docs/README.md', NO_ANCHOR, { href: 'reference/README.md#no-such-heading', where: 'docs/reference/README.md', fragment: 'no-such-heading', line: 8 }));
probe('1. a missing anchor in the same file', appendReadme('[b](#no-such-section)'),
  exactRe('docs/README.md', NO_ANCHOR, { href: '#no-such-section', where: 'docs/README.md', fragment: 'no-such-section', line: 8 }));
probe('1. a reference link whose label has no declaration', appendReadme('[c][nolabel]'),
  exactRe('docs/README.md', NO_LABEL, { text: 'c', label: 'nolabel', line: 8 }));
probe('1. an HTML link to a missing file', appendReadme('<a href="missing-html.md">d</a>'),
  exactRe('docs/README.md', BROKEN, { href: 'missing-html.md', line: 8 }));
probe('1. a badge whose outer destination is missing', appendReadme('[![badge](img.png)](missing-badge.md)'),
  exactRe('docs/README.md', BROKEN, { href: 'missing-badge.md', line: 8 }));
probe('1. an adapter output link to a missing anchor', (root) => {
  assert.equal(cli(root, ['init', '--tools', 'claude']).code, 0);
  put(root, '.claude/skills/backslop-task/SKILL.md', '<!-- backslop:generated -->\n[x](../../../docs/README.md#no-such)\n');
}, new RegExp(`${errSrc('SKILL.md', NO_ANCHOR, { href: '../../../docs/README.md#no-such', where: 'docs/README.md', fragment: 'no-such', line: 2 })}$`));
greenProbe('1. links in a fenced example or an HTML comment are not read', (root) => put(root, 'docs/note.md', [
  '```', '[f](fenced.md) [c][nolabel] [a](#nowhere)', '```', '',
  '<!-- [c](comment.md#x) <a href="gone.md">g</a>', '[x][nolabel] -->', '',
  // A fence closes only on its own character, at least as long as the opening run.
  '~~~~', '```', '[n](nested.md)', '~~~', '```', '[m](still-code.md)', '~~~~', '',
  `[ok](#${ANCHOR}) \`[s](span.md)\``, '', `## ${SECTION.context}`, '',
].join('\n')));

greenProbe('1. #top and a source-view line after ?plain=1 need no heading', (root) => put(root, 'docs/note.md',
  '[t](#top) [T](reference/README.md#TOP) [l](reference/README.md?plain=1#L3) [r](reference/README.md?a=1&plain=1#L1-L2)\n'));
probe('1. a line fragment without ?plain=1 is a heading anchor', (root) => put(root, 'docs/note.md', '[l](reference/README.md#L3)\n'),
  errRe('docs/note.md', NO_ANCHOR, { href: 'reference/README.md#L3', where: 'docs/reference/README.md', fragment: 'L3', line: 1 }));
greenProbe('1. a fence in a blockquote or a list item holds no link and no declaration', (root) => put(root, 'docs/note.md',
  '> ```\n> [l]: x.md\n> [x][nolabel] [b](none.md#x)\n> ```\n\n- ```\n  [y][nolabel]\n  ```\n'));
greenProbe('1. a declaration in a blockquote or a list item resolves its label', (root) => put(root, 'docs/note.md',
  `> [l]: reference/README.md\n\nSee [t][l], [u][m] and [v][n].\n\n- [m]: reference/README.md\n\n1. [n]: reference/README.md#${ANCHOR}\n`));

test('lint: 1. a repeated heading takes -1, -2 in document order: #x-1 resolves, #x-2 does not', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    put(root, 'docs/dup.md', '# X\n\n## X\n\n```\n# X\n```\n');
    put(root, 'docs/note.md', '[0](dup.md#x) [1](dup.md#x-1) [2](dup.md#x-2) [u](dup.md#X-1) [e](dup.md#%78-1)\n');
    assert.deepEqual(problems(root), [
      errLine('docs/note.md', NO_ANCHOR, { href: 'dup.md#x-2', where: 'docs/dup.md', fragment: 'x-2', line: 1 }),
    ]);
  } finally {
    cleanup(root);
  }
});

test('lint: 1. anchors are read from the target file, outside docs/ and outside the gate set', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    put(root, 'README.md', `# ${SECTION.context}\n\nSee [docs](docs/README.md)\n`);
    put(root, 'notes/guide.md', `## ${SECTION.verification} <a name="setup"></a>\n\n<span id="faq"></span>\n`);
    put(root, 'notes/code.js', '// line\n');
    put(root, 'docs/note.md', [
      `[r](../README.md#${ANCHOR}) [g](../notes/guide.md#${SECTION.verification.toLowerCase()}) [s](../notes/guide.md#setup)`,
      '[f](../notes/guide.md#faq) [l](../notes/code.js#L1)',
      `[r2](../README.md#${SECTION.evidence.toLowerCase()}) [g2](../notes/guide.md#${SECTION.evidence.toLowerCase()})`, '',
    ].join('\n'));
    assert.deepEqual(problems(root), [
      errLine('docs/note.md', NO_ANCHOR, { href: `../README.md#${SECTION.evidence.toLowerCase()}`, where: 'README.md', fragment: SECTION.evidence.toLowerCase(), line: 3 }),
      errLine('docs/note.md', NO_ANCHOR, { href: `../notes/guide.md#${SECTION.evidence.toLowerCase()}`, where: 'notes/guide.md', fragment: SECTION.evidence.toLowerCase(), line: 3 }),
    ]);
  } finally {
    cleanup(root);
  }
});

test('lint: 1. gate 1 prints what it read; Markdown files without one link are an error', () => {
  const root = makeProject({ git: false });
  try {
    put(root, 'docs/README.md', '# Documentation\n');
    let r = cli(root, ['lint']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, new RegExp(`^✖ docs: ${ruRe('gate 1 read nothing: {files} Markdown files and not one link — a walk that reads no link does not prove a clean tree; check the docs field in {config} and link the documents from the index', { files: 3 }).source}`, 'm'));
    assert.match(r.out, new RegExp(`^ {2}${ruRe('gate 1: files {files}, links {links}, local {local}, anchors checked {anchors}', { files: 3, links: 0, local: 0, anchors: 0 }).source}$`, 'm'));
    seedGreen(root);
    put(root, 'docs/note.md', `[a](reference/README.md#${ANCHOR}) [e](https://example.com) <https://example.org>\n`);
    r = cli(root, ['lint']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, new RegExp(`^ {2}${ruRe('gate 1: files {files}, links {links}, local {local}, anchors checked {anchors}', { files: 16, links: 10, local: 8, anchors: 1 }).source}$`, 'm'));
  } finally {
    cleanup(root);
  }
});

probe('2. the heading does not match the name', (root) => put(root, 'docs/backlog/triage/BS-9-x.md', '# BS-8 · Not that one\n'), ruRe(HEAD_NAMES, { heading: 'BS-8' }));
probe('2. the heading is not in the form', (root) => put(root, 'docs/backlog/triage/BS-9-x.md', 'No heading\n'), ruRe('first line is not “# {id} · Title”'));
probe('2. a finding without a parent', (root) => put(root, 'docs/backlog/triage/BS-7.1-x.md', '# BS-7.1 · Orphan\n'), ruRe('finding {id} has no parent {parent}', { parent: 'BS-7' }));
probe('2. a foreign file in a status directory', (root) => put(root, 'docs/backlog/queue/notes.md', '# notes\n'), ruRe('name does not match {prefix}-N[.k]-<slug>.md', { prefix: 'BS' }));
probe('3. a file outside a status directory', (root) => put(root, 'docs/backlog/BS-9-x.md', '# BS-9 · X\n'), ruRe('file is outside a status directory: tasks belong in one of {dirs}'));
probe('3. a directory that is not a status', (root) => mkdirSync(path.join(root, 'docs/backlog/done')), ruRe('directory is not a status; statuses are {statuses}'));
test('lint: 3. a status directory symlinked inside the project is a status; one leading outside is not followed', { skip: process.platform === 'win32' }, () => {
  const root = makeProject({ git: false });
  const outside = mkdtempSync(path.join(os.tmpdir(), 'backslop-lint-outside-'));
  try {
    seedGreen(root);
    renameSync(path.join(root, 'docs/backlog/queue'), path.join(root, 'store-queue'));
    symlinkSync(path.join(root, 'store-queue'), path.join(root, 'docs/backlog/queue'));
    assert.deepEqual(problems(root), []);
    unlinkSync(path.join(root, 'docs/backlog/queue'));
    renameSync(path.join(root, 'store-queue'), path.join(outside, 'queue'));
    symlinkSync(path.join(outside, 'queue'), path.join(root, 'docs/backlog/queue'));
    assert.ok(problems(root).some((p) => exactRe('docs/backlog/queue', LINK_OUT).test(p)), problems(root).join(' | '));
    assert.ok(!problems(root).some((p) => errRe('docs/backlog/queue', 'file is outside a status directory: tasks belong in one of {dirs}').test(p)), 'a link is no file');
  } finally {
    cleanup(root);
    rmSync(outside, { recursive: true, force: true });
  }
});
probe('3. no status directory', (root) => rmSync(path.join(root, 'docs/backlog/deferred'), { recursive: true }), ruRe('status directory is missing — create it empty'));
probe('3. no minor directory', (root) => rmSync(path.join(root, 'docs/backlog/minor'), { recursive: true }), errRe('docs/backlog/minor', 'status directory is missing — create it empty'));
probe('4. minor without a cost', (root) => put(root, 'docs/backlog/minor/BS-1.1-m.md', ruCard('BS-1.1', 'M', { parent: 'BS-1' })), ruRe(MINOR_NO_COST, { label: FIELD.cost }));
probe('4. the cost is unreadable', (root) => put(root, 'docs/backlog/minor/BS-1.1-m.md', ruCard('BS-1.1', 'M', { cost: 'expensive' })), ruRe('“{label}” is unreadable: critical, major or minor; a hypothesis is “major (hypothesis)”', { label: FIELD.cost }));
probe('4. major in minor without a hypothesis', (root) => put(root, 'docs/backlog/minor/BS-1.1-m.md', ruCard('BS-1.1', 'M', { cost: 'major' })), ruRe('“{label}” {level} without the “hypothesis” mark: with evidence such a finding is fixed now, not queued for a batch — fix it or {cli} mv N.k triage', { label: FIELD.cost, level: 'major' }));
probe('4. the cost is repeated', (root) => put(root, 'docs/backlog/minor/BS-1.1-m.md', `${ruCard('BS-1.1', 'M', { cost: 'minor' })}- **${FIELD.cost}:** minor\n`), ruRe(DUP_FIELD, { field: FIELD.cost }));
probe('5. a foreign file in the minor/ of a batch', (root) => put(root, 'docs/archive/BS-4-e/minor/notes.md', '# notes\n'), errRe('archive/BS-4-e/minor/notes.md', 'minor/ of a batch holds only entry files {prefix}-N[.k]-<slug>.md', { prefix: 'BS' }));
probe('5. a directory in the minor/ of a batch', (root) => mkdirSync(path.join(root, 'docs/archive/BS-4-e/minor/BS-4.9-x.md'), { recursive: true }), errRe('archive/BS-4-e/minor/BS-4.9-x.md', 'minor/ of a batch holds only entry files {prefix}-N[.k]-<slug>.md', { prefix: 'BS' }));
probe('2. an entry in the minor/ of a batch with a foreign heading', (root) => put(root, 'docs/archive/BS-4-e/minor/BS-4.1-m.md', '# BS-4.2 · Not that one\n'), errRe('archive/BS-4-e/minor/BS-4.1-m.md', HEAD_NAMES, { heading: 'BS-4.2' }));
// The second door into minor/ is closed from the same side as new --minor:
// the Evidence section is required.
const MINOR_NO_EVIDENCE = 'minor entry has no “## {heading}” section or it is empty: the entry goes to a batch without review — write the evidence: a path with a line, a command with its output and exit code, or a measurement with a number';
probe('4. minor without an Evidence section', (root) => put(root, 'docs/backlog/minor/BS-1.1-m.md', ruCard('BS-1.1', 'M', { cost: 'minor' }, [['context', 'history']])), errRe('BS-1.1-m.md', MINOR_NO_EVIDENCE, { heading: SECTION.evidence }));
probe('4. minor with an empty Evidence', (root) => put(root, 'docs/backlog/minor/BS-1.1-m.md', `${ruCard('BS-1.1', 'M', { cost: 'minor' })}\n## ${SECTION.evidence}\n\n## ${SECTION.context}\n\nhistory\n`), errRe('BS-1.1-m.md', MINOR_NO_EVIDENCE, { heading: SECTION.evidence }));
probe('4. Evidence in minor/ as a stub', (root) => put(root, 'docs/backlog/minor/BS-1.1-m.md', ruCard('BS-1.1', 'M', { cost: 'minor' }, [['evidence', `${findingLine('BS-1')}\n${EVIDENCE_STUB}`]])), errRe('BS-1.1-m.md', SECTION_INCOMPLETE, { section: SECTION.evidence, of: 'evidence' }));
probe('4. a stub outside Area in minor/', (root) => put(root, 'docs/backlog/minor/BS-1.1-m.md', ruCard('BS-1.1', 'M', { cost: 'minor' }, [['evidence', 'Evidence: [TODO: path]']])), errRe('BS-1.1-m.md', TODO_LINE, { line: 7 }));
probe('4. a queue without an order', (root) => put(root, 'docs/backlog/queue/BS-1-a.md', ruCard('BS-1', 'A')), ruRe(NO_ORDER, { field: FIELD.order }));
probe('4. the order is not a number', (root) => put(root, 'docs/backlog/queue/BS-1-a.md', ruCard('BS-1', 'A', { order: 'high' })), ruRe('“{field}” is not an integer', { field: FIELD.order }));
probe('4. two queue files with one order', (root) => put(root, 'docs/backlog/queue/BS-5-f.md', ruCard('BS-5', 'E', { order: 10 })), errRe('BS-5-f.md', '“{field}” {rank} is already used by {first} — reorder with {cli} mv N queue --top | --after M', { field: FIELD.order, rank: 10, first: 'docs/backlog/queue/BS-1-a.md' }));
probe('4. a duplicate field in one file with RU/EN aliases', (root) => put(root, 'docs/backlog/queue/BS-1-a.md', `${ruCard('BS-1', 'A', { order: 10 })}- **Order:** 20\n`), errRe('BS-1-a.md', DUP_FIELD, { field: FIELD.order, lines: '3, 4' }));
probe('4. the Previous order in the queue does not replace the Order', (root) => put(root, 'docs/backlog/queue/BS-1-a.md', ruCard('BS-1', 'A', { previousOrder: 10, area: AREA })), errRe('BS-1-a.md', NO_ORDER, { field: FIELD.order }));
probe('4. a duplicate Previous order with RU/EN aliases', (root) => put(root, 'docs/backlog/active/BS-2-b.md', `${ruCard('BS-2', 'B', { area: AREA, taken: '2026-09-01', previousOrder: 20 })}- **Previous order:** 30\n`), errRe('BS-2-b.md', DUP_FIELD, { field: FIELD.previousOrder, lines: '5, 6' }));
probe('4. a triaged task without an Area', (root) => put(root, 'docs/backlog/queue/BS-1-a.md', ruCard('BS-1', 'A', { order: 10 })), errRe('BS-1-a.md', NO_AREA, { label: FIELD.area }));
probe('4. the Area is empty', (root) => put(root, 'docs/backlog/active/BS-2-b.md', ruCard('BS-2', 'B', { area: '', taken: '2026-09-01' })), errRe('BS-2-b.md', AREA_EMPTY, { label: FIELD.area }));
probe('4. in progress without a date', (root) => put(root, 'docs/backlog/active/BS-2-b.md', ruCard('BS-2', 'B')), ruRe('active task has no “{field}: YYYY-MM-DD” date', { field: FIELD.taken }));
probe('4. deferred without a section', (root) => put(root, 'docs/backlog/deferred/BS-3-c.md', ruCard('BS-3', 'C')), ruRe(DEFERRED_MISSING, { section: SECTION.deferred }));
probe('4. deferred with [TODO]', (root) => put(root, 'docs/backlog/deferred/BS-3-c.md', ruCard('BS-3', 'C', {}, [['deferred', '- **Reason:** [TODO]']])), ruRe(SECTION_INCOMPLETE, { section: SECTION.deferred }));
probe('4. a second Deferred section', (root) => put(root, 'docs/backlog/deferred/BS-3-c.md', ruCard('BS-3', 'C', { area: AREA }, [['deferred', '- **Reason:** done\n- **Return condition:** done'], ['deferred', '- **Reason:** second\n- **Return condition:** second']])), ruRe('“{section}” section occurs {sections} times — keep one', { section: SECTION.deferred, sections: 2 }));
probe('4. a stub in any backlog file', (root) => put(root, 'docs/backlog/queue/BS-5-todo.md', '# BS-5 · Stub\n\n- [TODO]\n'), errRe('docs/backlog/queue/BS-5-todo.md', TODO_LINE, { line: 3 }));
probe('4. the canonical evidence of a finding', (root) => put(root, 'docs/backlog/queue/BS-5-finding.md', `# BS-5 · Finding\n\n${findingLine('BS-1')}\n${EVIDENCE_STUB}\n${ru('Quote a file inside a “<!-- quote:path --> … <!-- /quote -->” block rather than by line number: numbers drift silently, the block is guarded by lint. If unverified, state it as an assumption.')}\n`), errRe('BS-5-finding.md', TODO_LINE, { line: 4 }));
probe('4. a field with a colon outside the bold', (root) => put(root, 'docs/backlog/queue/BS-6-reason.md', '# BS-6 · Reason\n\n- **Reason**: [TODO]\n'), errRe('BS-6-reason.md', TODO_LINE, { line: 3 }));
test('lint: 4. a placeholder value after a field name that starts with [TODO is a placeholder', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    put(root, 'docs/backlog/queue/BS-6-name.md', '# BS-6 · Name\n\n- [TODO] note: [TODO: step]\n- [TODO]: [TODO]\n');
    assert.deepEqual(problems(root).filter((p) => ruRe(TODO_LINE).test(p)), [
      errLine('docs/backlog/queue/BS-6-name.md', TODO_LINE, { line: 3 }),
      errLine('docs/backlog/queue/BS-6-name.md', TODO_LINE, { line: 4 }),
    ]);
  } finally {
    cleanup(root);
  }
});
probe('4. placeholder in a numbered item', (root) => put(root, 'docs/backlog/queue/BS-5-num.md', '# BS-5 · N\n\n1. [TODO]\n2) [TODO: command]\n'), errRe('BS-5-num.md', TODO_LINE, { line: 4 }));
probe('4. placeholder in a task-list box', (root) => put(root, 'docs/backlog/queue/BS-5-box.md', '# BS-5 · B\n\n- [ ] [TODO]\n'), errRe('BS-5-box.md', TODO_LINE, { line: 3 }));
probe('4. placeholder in a checked task-list box', (root) => put(root, 'docs/backlog/queue/BS-5-done.md', '# BS-5 · D\n\n- [x] [TODO: step]\n'), errRe('BS-5-done.md', TODO_LINE, { line: 3 }));
probe('4. placeholder in a table cell', (root) => put(root, 'docs/backlog/queue/BS-5-table.md', '# BS-5 · T\n\n| a | b |\n|---|---|\n| done | [TODO] |\n'), errRe('BS-5-table.md', TODO_LINE, { line: 5 }));

// The rank kept by leaving the queue: these directories have no Order field and need none.
greenProbe('4. the Previous order outside queue/ does not redden the fields gate', (root) => {
  put(root, 'docs/backlog/active/BS-2-b.md', ruCard('BS-2', 'B', { area: AREA, taken: '2026-09-01', previousOrder: 20 }));
  put(root, 'docs/backlog/deferred/BS-3-c.md', ruCard('BS-3', 'C', { area: AREA, previousOrder: 30 }, [['deferred', DEFERRED_BODY]]));
});

greenProbe('4. text about TODO inside a filled value does not redden the backlog', (root) => put(root, 'docs/backlog/queue/BS-1-a.md', `${ruCard('BS-1', 'A', { order: 10, area: 'filled in; the [TODO] check must not search a substring' })}\n| a | b |\n|---|---|\n| filled in; [TODO] inside | 1. [TODO] in the text |\n`));
greenProbe('4. a section heading inside a fenced example is not a duplicate', (root) => put(root, 'docs/backlog/deferred/BS-3-c.md', `${ruCard('BS-3', 'C', { area: AREA }, [['deferred', DEFERRED_BODY]])}\n\`\`\`markdown\n## ${SECTION.deferred}\n- **Reason:** example\n\`\`\`\n`));

probe('4. a fenced-only section heading does not replace the section', (root) => put(root, 'docs/backlog/deferred/BS-3-c.md', `${ruCard('BS-3', 'C', { area: AREA })}\n\`\`\`markdown\n## ${SECTION.deferred}\n- **Reason:** example\n\`\`\`\n`), ruRe(DEFERRED_MISSING, { section: SECTION.deferred }));
probe('5. an archive without result.md', (root) => rmSync(path.join(root, 'docs/archive/BS-4-e/result.md')), ruRe('result.md with the closing date is missing'));
probe('5. the result is not finished', (root) => put(root, 'docs/archive/BS-4-e/result.md', `${ruResultHeading('BS-4')}\n\n${STAMP} [TODO: outcome]\n`), ruRe('result is incomplete: [TODO] remains'));
// The line scan of docs/backlog/** does not count a template line as a stub; a probe on a bare
// `- [TODO]` would not tell a working gate from an idle one.
for (const lang of ['ru', 'en']) {
  const paragraphs = resultTemplateParagraphs(lang);
  assert.ok(paragraphs.length > 0 && paragraphs.every((p) => p.includes('[TODO')), `the result.md template (${lang}) has no stubs — the probe would be idle`);
  paragraphs.forEach((p, i) => {
    probe(`5. paragraph ${i + 1} of the result.md template (${lang}) is the only stub`, (root) => put(root, 'docs/archive/BS-4-e/result.md', `${ruResultHeading('BS-4')}\n\n${p}\n`), errRe('BS-4-e/result.md', 'result is incomplete: [TODO] remains'));
  });
}
greenProbe('5. a stub shown in code is a story about it, not the stub itself', (root) => put(root, 'docs/archive/BS-4-e/result.md', [
  ruResultHeading('BS-4'), '',
  `${STAMP} ${ruOutcome('completed')}: the gate used to redden on \`[TODO: outcome]\` in prose, while \`\`[TODO\`\` in a code span is an example.`, '',
  '```', `${STAMP} [TODO: outcome]`, '```', '',
].join('\n')));
// An outcome is a vocabulary word: the fold would read a bare “Closed” as completed, and a
// rejection would turn into a completion.
for (const [label, first] of [
  ['a bare “done”', ruExpand(`${STAMP} {Done}.`)],
  ['a refusal noun', ruExpand(`${STAMP} {Refusal}: moot.`)],
  ['a duplicate', ruExpand(`${STAMP} {Duplicate} BS-2.`)],
  ['merged into a branch', ruExpand(`${STAMP} {Merged.1} {into} main.`)],
  ['English “done”', '**Closed 2026-08-01.** Done.'],
]) {
  probe(`5. the first paragraph of result.md without an outcome word: ${label}`, (root) => put(root, 'docs/archive/BS-4-e/result.md', `${ruResultHeading('BS-4')}\n\n${first}\n\n${ruExpand(`**${SECTION.verification}.** {Rejected.0} a hypothesis about the cache.`)}\n`),
    errRe('archive/BS-4-e', NO_OUTCOME, { prefix: 'BS' }));
}
test('lint: 5. a vocabulary outcome word in the first paragraph or heading — any outcome and both languages', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    for (const first of ['**{Closed.0} 2026-08-01.** {Completed.0}.', '**{Closed.0} 2026-08-01.** {Rejected.0}: moot.', '**{Closed.0} 2026-08-01.** {Rejected.4}.', '**{Closed.0} 2026-08-01.** {Merged.0} {into} BS-2.', '**Closed 2026-08-01.** Completed.', '**Closed 2026-08-01.** Rejected.', '**Closed 2026-08-01.** Merged into BS-2.']) {
      put(root, 'docs/archive/BS-4-e/result.md', `${ruResultHeading('BS-4')}\n\n${ruExpand(first)}\n`);
      assert.deepEqual(problems(root), [], first);
    }
    // The outcome in the heading of an old archive is read by the fold — the gate reads it too.
    for (const heading of ['# BS-4 — {result} ({rejected.4} 2026-08-13)', '# BS-4 — {result}: {rejected.0}']) {
      put(root, 'docs/archive/BS-4-e/result.md', `${ruExpand(heading)}\n\nA defect description without an outcome word.\n`);
      assert.deepEqual(problems(root), [], heading);
    }
  } finally {
    cleanup(root);
  }
});
probe('5. an archive directory not matching the pattern', (root) => put(root, 'docs/archive/old-stuff/task.md', '# x\n'), errRe('old-stuff', 'name does not match {prefix}-N[.k]-<slug>', { prefix: 'BS' }));
probe('6. a number mentioned without a file in docs', (root) => put(root, 'docs/backlog/queue/BS-1-a.md', `${read(root, 'docs/backlog/queue/BS-1-a.md')}\nWe will do it in BS-99.\n`), ruRe('mentions {id}, but no task file exists in statuses or archive', { id: 'BS-99' }));
probe('6. a number mentioned without a file in CHANGELOG', (root) => put(root, 'CHANGELOG.md', '## Unreleased\n\n- **One** — new\n\n## v0.1.0\n\n- **Closed** BS-2.7\n'), errRe('CHANGELOG.md', 'mentions {id}, but no task file exists in statuses or archive', { id: 'BS-2.7' }));
greenProbe('6. a number mentioned inside a code block is an example, not a reference', (root) => put(root, 'docs/archive/BS-4-e/task.md', `${read(root, 'docs/archive/BS-4-e/task.md')}\n` + 'Sample output:\n\n```\n  10  BS-77 · Example\n```\n\nAnd in prose `BS-4` is a link.\n'));

probe('7. a duplicate entry title in a CHANGELOG section', (root) => put(root, 'CHANGELOG.md', '## Unreleased\n\n- **One** — once\n- **One** — twice\n'), ruRe(DUP_ENTRY, { title: 'One' }));
test('lint: 7. a CHANGELOG code fence neither resets the section nor adds entries', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    put(root, 'CHANGELOG.md', '## 1.0.0\n\n- **Alpha** — one\n\n```\n## 0.9.0\n```\n\n- **Alpha** — two\n');
    assert.deepEqual(problems(root), [errLine('CHANGELOG.md', DUP_ENTRY, { line: 9, title: 'Alpha', section: '1.0.0', prev: 3 })]);
    put(root, 'CHANGELOG.md', '## 1.0.0\n\n- **Entry format** — real\n\n```\n- **Entry format** — example\n- **Entry format** — example\n```\n');
    assert.deepEqual(problems(root), []);
  } finally {
    cleanup(root);
  }
});
probe('8. an ADR without a row in the table', (root) => put(root, 'docs/adr/adr-002-orphan.md', '# ADR-002: Orphan\n'), errRe('adr-002-orphan.md', 'not linked from {readme} — the ADR index is maintained manually'));
probe('8. an ADR row inside an HTML comment is not a row', (root) => put(root, 'docs/README.md', read(root, 'docs/README.md').replace(
  '| [adr/adr-001-process.md](adr/adr-001-process.md) | process | Accepted |', '<!-- | [adr/adr-001-process.md](adr/adr-001-process.md) | process | Accepted | -->')),
errRe('adr-001-process.md', 'not linked from {readme} — the ADR index is maintained manually', { readme: 'README.md' }));
probe('8. an ADR number is taken twice', (root) => put(root, 'docs/adr/adr-001-again.md', '# ADR-001: Again\n'), ruRe('ADR number {number} is already used by {name}', { number: 1 }));
probe('8. an ADR file with an upper-case .MD extension is name-checked', (root) => put(root, 'docs/adr/adr-002-x.MD', '# ADR-002: X\n'), errRe('docs/adr/adr-002-x.MD', ADR_NAME));
test('lint: 8. an ADR file name is checked even when no ADR is named correctly', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    rmSync(path.join(root, 'docs/adr/adr-001-process.md'));
    put(root, 'docs/adr/ADR-001-process.md', '# ADR-001: Process\n\n**Status:** Accepted\n');
    put(root, 'docs/README.md', read(root, 'docs/README.md').replaceAll('adr/adr-001-process.md', 'adr/ADR-001-process.md'));
    assert.deepEqual(problems(root), [errLine('docs/adr/ADR-001-process.md', ADR_NAME)]);
    assert.equal(cli(root, ['lint']).code, 1);
  } finally {
    cleanup(root);
  }
});
probe('8. an ADR file name not matching the pattern', (root) => put(root, 'docs/adr/decision.md', '# x\n'), errRe('decision.md', ADR_NAME));
test('lint: 8. an ADR row linked from the root, with ?query or with a %-escape counts as its row', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    for (const href of ['/docs/adr/adr-001-process.md', 'adr/adr-001-process.md?plain=1', 'adr/adr-001-process%2Emd']) {
      put(root, 'docs/README.md', read(root, 'docs/README.md').replace(/\(\/?[^)]*adr-001-process[^)]*\)/, `(${href})`));
      assert.ok(read(root, 'docs/README.md').includes(`(${href})`), 'the ADR row carries the href form');
      assert.deepEqual(problems(root), [], href);
    }
  } finally {
    cleanup(root);
  }
});
test('lint: 8. a [TODO] line left in an ADR is an error; a fence, a sentence and a code span are not', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    put(root, 'docs/adr/adr-001-process.md', [
      '# ADR-001: Process', '', '**Status:** Accepted', '**Deciders:** [TODO]', '',
      '## Context', '', '[TODO: what required a decision.]', '', '- [TODO]', '',
      '```', '[TODO]', '```', '', 'A [TODO] inside a sentence and `[TODO]` in a code span are text.', '',
    ].join('\n'));
    assert.deepEqual(problems(root), [
      errLine('docs/adr/adr-001-process.md', TODO_LINE, { line: 4 }),
      errLine('docs/adr/adr-001-process.md', TODO_LINE, { line: 8 }),
      errLine('docs/adr/adr-001-process.md', TODO_LINE, { line: 10 }),
    ]);
    const r = cli(root, ['lint']);
    assert.equal(r.code, 1);
  } finally {
    cleanup(root);
  }
});

test('lint: 8. an ADR made by adr fails until every placeholder line of the template is written', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    assert.equal(cli(root, ['adr', 'fresh', '--title', 'Fresh']).code, 0);
    put(root, 'docs/README.md', read(root, 'docs/README.md').replace('| process | Accepted |\n', '| process | Accepted |\n| [adr/adr-002-fresh.md](adr/adr-002-fresh.md) | fresh | Proposed |\n'));
    const text = read(root, 'docs/adr/adr-002-fresh.md');
    const todoLines = text.split('\n').map((line, i) => (line.includes('[TODO') ? i + 1 : 0)).filter(Boolean);
    assert.equal(todoLines.length, 5);
    assert.deepEqual(problems(root), todoLines.map((line) => errLine('docs/adr/adr-002-fresh.md', TODO_LINE, { line })));
    put(root, 'docs/adr/adr-002-fresh.md', text.split('\n').map((line) => (line.includes('[TODO') ? 'Written.' : line)).join('\n'));
    assert.deepEqual(problems(root), []);
  } finally {
    cleanup(root);
  }
});

test('lint: a finding under a closed parent stays a warning for the approver', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    put(root, 'docs/archive/BS-2-b/task.md', ruCard('BS-2', 'B'));
    put(root, 'docs/archive/BS-2-b/result.md', closed('BS-2'));
    put(root, 'docs/archive/BS-007-old/task.md', ruCard('BS-007', 'Old'));
    put(root, 'docs/archive/BS-007-old/result.md', closed('BS-007'));
    put(root, 'docs/backlog/triage/BS-007.1-x.md', ruCard('BS-007.1', 'Finding'));
    rmSync(path.join(root, 'docs/backlog/active/BS-2-b.md'));
    assert.deepEqual(problems(root), []);
    assert.ok(warnings(root).some((w) => errRe('BS-007.1-x.md', FINDING_PARENT, { id: 'BS-007.1', parentId: 'BS-007' }).test(w)), warnings(root).join(' | '));
    assert.ok(warnings(root).some((w) => errRe('BS-2.1-d.md', FINDING_PARENT, { id: 'BS-2.1', parentId: 'BS-2' }).test(w)), warnings(root).join(' | '));
    const r = cli(root, ['lint']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.err, ruRe(FINDING_PARENT));
  } finally {
    cleanup(root);
  }
});

test('lint: gate 9 takes no evidence from Parent — a triage finding under an archived N.M with N open gets no warning', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    put(root, 'docs/archive/BS-1.1-g/task.md', ruCard('BS-1.1', 'G'));
    put(root, 'docs/archive/BS-1.1-g/result.md', closed('BS-1.1'));
    put(root, 'docs/backlog/triage/BS-1.2-h.md', `${ruCard('BS-1.2', 'H', { parent: 'BS-1.1' })}\n${findingLine('BS-1.1')}\n`);
    assert.deepEqual(problems(root), []);
    assert.ok(!warnings(root).some((w) => /BS-1\.2/.test(w)), warnings(root).join(' | '));
    const r = cli(root, ['lint']);
    assert.equal(r.code, 0, r.err);
    assert.doesNotMatch(r.err, /BS-1\.2/);
  } finally {
    cleanup(root);
  }
});

test('lint: 9. a Parent field that names another number than the file name is a warning', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    put(root, 'docs/backlog/triage/BS-2.1-d.md', `${ruCard('BS-2.1', 'D', { parent: 'BS-3' })}\n${findingLine('BS-2')}\n`);
    put(root, 'docs/backlog/triage/BS-2.2-e.md', ruCard('BS-2.2', 'E', { parent: 'BS-2.1' }));
    put(root, 'docs/backlog/triage/BS-2.3-f.md', ruCard('BS-2.3', 'F', { parent: 'BS-002' }));
    put(root, 'docs/backlog/triage/BS-2.4-g.md', ruCard('BS-2.4', 'G', { parent: 'BS-4.1' }));
    assert.deepEqual(problems(root), []);
    const found = warnings(root);
    assert.ok(found.some((w) => errRe('BS-2.1-d.md', PARENT_NUMBER, { field: FIELD.parent, named: 'BS-3', number: 'BS-2' }).test(w)), found.join(' | '));
    assert.ok(found.some((w) => errRe('BS-2.4-g.md', PARENT_NUMBER, { field: FIELD.parent, named: 'BS-4.1', number: 'BS-2' }).test(w)), found.join(' | '));
    assert.equal(found.filter((w) => ruRe(PARENT_NUMBER).test(w)).length, 2, found.join(' | '));
    const r = cli(root, ['lint']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.err, ruRe(PARENT_NUMBER));
  } finally {
    cleanup(root);
  }
});

test('lint: 4. an Order outside queue/ and a Previous order inside it are warnings', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    put(root, 'docs/backlog/active/BS-2-b.md', ruCard('BS-2', 'B', { area: AREA, taken: '2026-09-01', order: 30 }));
    put(root, 'docs/backlog/deferred/BS-3-c.md', ruCard('BS-3', 'C', { area: AREA, previousOrder: 20 }, [['deferred', DEFERRED_BODY]]));
    put(root, 'docs/backlog/queue/BS-1-a.md', ruCard('BS-1', 'A', { order: 10, previousOrder: 5, area: AREA }));
    assert.deepEqual(problems(root), []);
    const found = warnings(root);
    assert.ok(found.some((w) => errRe('BS-2-b.md', ORDER_OUTSIDE, { status: 'active', field: FIELD.order }).test(w)), found.join(' | '));
    assert.ok(found.some((w) => errRe('BS-1-a.md', PREV_IN_QUEUE, { field: FIELD.previousOrder }).test(w)), found.join(' | '));
    assert.equal(found.length, 2, found.join(' | '));
    const r = cli(root, ['lint']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.err, ruRe(ORDER_OUTSIDE));
  } finally {
    cleanup(root);
  }
});

test('lint: 4. mv leaves no stray Order or Previous order: a round trip out of queue/ and back is silent', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    assert.equal(cli(root, ['mv', '1', 'active']).code, 0);
    assert.match(read(root, 'docs/backlog/active/BS-1-a.md'), new RegExp(`\\*\\*${FIELD.previousOrder}:\\*\\* 10`));
    assert.deepEqual(warnings(root), []);
    assert.equal(cli(root, ['mv', '1', 'triage']).code, 0);
    assert.deepEqual(warnings(root), []);
    assert.equal(cli(root, ['mv', '1', 'queue', '--restore']).code, 0);
    assert.deepEqual(warnings(root), []);
    assert.equal(cli(root, ['mv', '1', 'deferred']).code, 0);
    assert.equal(cli(root, ['mv', '1', 'queue']).code, 0);
    assert.deepEqual(warnings(root), []);
  } finally {
    cleanup(root);
  }
});

test('lint: an empty or unfilled Area in minor/ is a warning, not an error', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    put(root, 'docs/backlog/minor/BS-1.1-m.md', ruCard('BS-1.1', 'M', { area: '', cost: 'minor' }, [['evidence', 'lib/a.js:1']]));
    put(root, 'docs/backlog/minor/BS-1.2-n.md', ruCard('BS-1.2', 'N', { cost: formatCost('major', true) }, [['evidence', 'presumably leaking']]));
    put(root, 'docs/backlog/minor/BS-1.3-o.md', `${ruCard('BS-1.3', 'O', { area: AREA, cost: 'critical (hypothesis)' })}\n## Evidence\n\npresumably leaks\n`);
    put(root, 'docs/backlog/minor/BS-1.4-p.md', ruCard('BS-1.4', 'P', { area: '[TODO: section](../../reference/README.md)', cost: 'minor' }, [['evidence', 'lib/b.js:2']]));
    assert.deepEqual(problems(root), []);
    assert.ok(warnings(root).some((w) => errRe('BS-1.4-p.md', AREA_INCOMPLETE, { label: FIELD.area }).test(w)), warnings(root).join(' | '));
    assert.ok(warnings(root).some((w) => errRe('BS-1.1-m.md', AREA_EMPTY, { label: FIELD.area }).test(w)), warnings(root).join(' | '));
    assert.ok(warnings(root).some((w) => errRe('BS-1.2-n.md', NO_AREA, { label: FIELD.area }).test(w)), warnings(root).join(' | '));
    assert.ok(!warnings(root).some((w) => /BS-1\.3-o\.md/.test(w)), warnings(root).join(' | '));
    const r = cli(root, ['lint']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, noErrorsRe(3));
  } finally {
    cleanup(root);
  }
});

test('lint: an entry closed as a batch is known to mentions and is not an orphan', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    put(root, 'docs/archive/BS-4-e/minor/BS-4.2-m.md', ruCard('BS-4.2', 'Closed as a batch', { cost: 'minor' }));
    put(root, 'docs/archive/BS-4-e/task.md', `${read(root, 'docs/archive/BS-4-e/task.md')}\n${ruExpand('See BS-4.2 — {closed.0} {batch} BS-4.\n')}`);
    assert.deepEqual(problems(root), []);
    assert.deepEqual(warnings(root), []);
  } finally {
    cleanup(root);
  }
});

test('lint: version warnings do not redden the gate', () => {
  const root = makeProject({ git: false, stamp: false });
  try {
    seedGreen(root);
    const setConfig = (patch) => put(root, 'backslop.json', `${JSON.stringify({ ...JSON.parse(read(root, 'backslop.json')), ...patch }, null, 2)}\n`);
    assert.ok(warnings(root).some((w) => errRe('backslop.json', 'version stamp is missing — run {cli} upgrade or init').test(w)), warnings(root).join(' | '));
    setConfig({ version: '0.0.1' });
    assert.ok(warnings(root).some((w) => ruRe(LAYOUT_OLDER, { stamp: '0.0.1' }).test(w)), warnings(root).join(' | '));
    setConfig({ version: TOOL_VERSION, cli: 'npx github:me/proj#v0.0.1' });
    assert.ok(warnings(root).some((w) => ruRe('cli pin v{pin} differs from version stamp v{stamp} — run {cli} upgrade', { pin: '0.0.1' }).test(w)), warnings(root).join(' | '));
    setConfig({ version: TOOL_VERSION, cli: `npx github:me/proj#v${TOOL_VERSION}` });
    assert.deepEqual(warnings(root), []);
    setConfig({ version: '9.9.9' });
    assert.ok(warnings(root).some((w) => ruRe('version stamp is newer than the tool: v{stamp} > v{version} — update the installation or cli pin', { stamp: '9.9.9' }).test(w)), warnings(root).join(' | '));
    setConfig({ version: TOOL_VERSION, cli: 'npx github:me/proj' });
    assert.ok(warnings(root).some((w) => ruRe(UNPINNED).test(w)), warnings(root).join(' | '));
    setConfig({ version: TOOL_VERSION, cli: 'npx backslop' });
    assert.ok(warnings(root).some((w) => ruRe(UNPINNED).test(w)), warnings(root).join(' | '));
    setConfig({ version: TOOL_VERSION, cli: 'npx backslop@latest' });
    assert.ok(warnings(root).some((w) => ruRe(UNPINNED).test(w)), warnings(root).join(' | '));
    setConfig({ version: TOOL_VERSION, cli: 'backslop' });
    assert.deepEqual(warnings(root), [], 'a global installation carries no pin and does not warn');
    setConfig({ version: '0.0.1', cli: 'backslop' });
    const r = cli(root, ['lint']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.err, new RegExp(`⚠ ${errSrc('backslop.json', LAYOUT_OLDER)}`));
    assert.match(r.out, noErrorsRe(1));
  } finally {
    cleanup(root);
  }
});

test('lint: the CLI prints every error and exits 1', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    put(root, 'docs/note.md', '[missing](none.md)\n');
    const r = cli(root, ['lint']);
    assert.equal(r.code, 1);
    assert.match(r.err, errRe('docs/note.md', BROKEN, { href: 'none.md' }));
    assert.match(r.err, ruRe('lint: errors {errors}{tail}', { errors: 1 }));
  } finally {
    cleanup(root);
  }
});

greenProbe('a number with leading zeros — the file form is kept, the comparison is numeric', (root) => {
  put(root, 'docs/archive/BS-007-old/task.md', ruCard('BS-007', 'Old'));
  put(root, 'docs/archive/BS-007-old/result.md', closed('BS-007'));
  put(root, 'docs/backlog/queue/BS-1-a.md', `${read(root, 'docs/backlog/queue/BS-1-a.md')}\nDone in BS-007, which is also BS-7.\n`);
});
probe('2. a number is taken twice in different spellings', (root) => put(root, 'docs/backlog/triage/BS-004-e2.md', '# BS-004 · Duplicate\n'), ruRe('number {id} is already used by {rel}', { id: 'BS-004', rel: 'docs/archive/BS-4-e/task.md' }));

// 11. The release gate works only in the tool's own tree, so its probes, like the parity ones, run
// on a tool copy: an ordinary fixture has no version of its own.
function bumpPackage(dir, version) {
  put(dir, 'package.json', `${JSON.stringify({ ...JSON.parse(read(dir, 'package.json')), version }, null, 2)}\n`);
}

test('lint: 11. a fresh tool copy — the release gate is silent', () => {
  let project;
  try {
    project = toolProject(() => {});
    assert.equal(project.code, 0, project.err);
  } finally { if (project) cleanup(project.dir); }
});

probe('adapter output — a directory at an owned path, where init refuses', (root) => {
  assert.equal(cli(root, ['init', '--tools', 'claude']).code, 0);
  rmSync(path.join(root, '.claude/skills/backslop-task/SKILL.md'));
  mkdirSync(path.join(root, '.claude/skills/backslop-task/SKILL.md'));
}, errRe('SKILL.md', 'owned adapter output is not a file — init refuses on it'));
// ADR-040: ownership is the marker alone, so an unmarked file at a template path is foreign.
// The copy adds the template to both layers, since the parity gate runs there too.
toolProbe('adapter output without the marker — a foreign file at an owned path of the selected adapter', (dir) => {
  put(dir, 'templates/skills/backslop-task/references/extra.md', '# extra\n');
  put(dir, 'templates/en/skills/backslop-task/references/extra.md', '# extra\n');
  // `init --tools` refuses in the tool root;
  // in self-host an adapter is chosen by editing the config.
  put(dir, 'backslop.json', `${JSON.stringify({ ...JSON.parse(read(dir, 'backslop.json')), tools: ['claude'] }, null, 2)}\n`);
  const r = toolCli(dir, ['init']);
  assert.equal(r.code, 0, r.err);
  put(dir, '.claude/skills/backslop-task/references/extra.md', '# my file at this path\n');
}, errRe('extra.md', 'a foreign file without the {marker} marker sits at the {tool} adapter output path — init does not overwrite it: remove or rename the file and run {cli} init, or deselect the adapter', { tool: 'claude' }));

toolProbe('11. the package.json version differs from the stamp', (dir) => bumpPackage(dir, '9.9.9'), ruRe(PKG_VERSION, { version: '9.9.9', config: 'backslop.json', stamp: TOOL_VERSION }));

toolProbe('11. no CHANGELOG section for the released version', (dir) => {
  bumpPackage(dir, '9.9.9');
  put(dir, 'backslop.json', `${JSON.stringify({ ...JSON.parse(read(dir, 'backslop.json')), version: '9.9.9' }, null, 2)}\n`);
  put(dir, 'CHANGELOG.md', '# Changelog\n\n## Unreleased\n\n- **One** — it was\n');
}, ruRe('no “## v{version}” section — the released version has no entry', { version: '9.9.9' }));

toolProbe('11. a fenced "## v<version>" example is not the released section', (dir) => {
  bumpPackage(dir, '9.9.9');
  put(dir, 'backslop.json', `${JSON.stringify({ ...JSON.parse(read(dir, 'backslop.json')), version: '9.9.9' }, null, 2)}\n`);
  put(dir, 'CHANGELOG.md', '# Changelog\n\n## Unreleased\n\n- **One** — the heading looks like\n\n  ```md\n  ## v9.9.9\n  ```\n\n```md\n## v9.9.9 — 2026-01-01\n```\n');
}, ruRe('no “## v{version}” section — the released version has no entry', { version: '9.9.9' }));

toolProbe('11. a stale pin in the README prose', (dir) => put(dir, 'README.md', 'Install `npx github:Velklish/backslop#v0.2.0`\n'), errRe('README.md', PIN_TOOL, { line: 1, pin: 'github:Velklish/backslop#v0.2.0', version: TOOL_VERSION }));

test('lint: 11. a stale release pin with a .git suffix or without v in README', () => {
  let project;
  try {
    project = toolProject((dir) => put(dir, 'README.md', 'Install `npx github:Velklish/backslop.git#v0.2.0` or `npx github:Velklish/backslop#0.2.0`\n'));
    assert.equal(project.code, 1, project.out);
    assert.match(project.err, errRe('README.md', PIN_TOOL, { line: 1, pin: 'github:Velklish/backslop.git#v0.2.0', version: TOOL_VERSION }));
    assert.match(project.err, errRe('README.md', PIN_TOOL, { line: 1, pin: 'github:Velklish/backslop#0.2.0', version: TOOL_VERSION }));
  } finally { if (project) cleanup(project.dir); }
});

toolProbe('11. a stale npm pin in the AGENTS.md prose', (dir) => put(dir, 'AGENTS.md', `${read(dir, 'AGENTS.md')}\nThe release is installed as \`npx backslop@0.2.0\`.\n`), errRe('AGENTS.md', PIN_TOOL, { pin: 'backslop@0.2.0', version: TOOL_VERSION }));

// A `templates` link to the running tool's own directory wakes the self-host gates.
test('lint: 11. a malformed package.json is a gate error, and the other gates still report', { skip: process.platform === 'win32' }, () => {
  for (const [lang, parsed] of [['ru', new RegExp(`^✖ .*package\\.json: ${ruRe('cannot be parsed: {message}', { message: `${ANY}JSON` }).source}`, 'm')], ['en', /^✖ .*package\.json: cannot be parsed: .*JSON/m]]) {
    const root = makeProject({ git: false });
    try {
      seedGreen(root);
      put(root, 'backslop.json', `${JSON.stringify({ ...JSON.parse(read(root, 'backslop.json')), lang }, null, 2)}\n`);
      symlinkSync(path.join(REPO, 'templates'), path.join(root, 'templates'), 'dir');
      put(root, 'package.json', '{ "version": "0.11.0", }\n');
      put(root, 'docs/stray.md', '[x](nowhere.md)\n');
      const r = cli(root, ['lint']);
      assert.equal(r.code, 1, `${lang}: ${r.out}`);
      assert.match(r.err, parsed, lang);
      assert.match(r.err, /stray\.md: .*nowhere\.md/, `${lang}: the links gate still reports`);
      assert.match(r.err, new RegExp(`^✖ ${escapeRe(lang === 'ru' ? ru('lint: errors {errors}{tail}', { errors: 2, tail: '' }) : 'lint: errors 2')}\\b`, 'm'), lang);
      assert.doesNotMatch(r.err, /SyntaxError|lintReleaseVersions/, lang);
    } finally {
      cleanup(root);
    }
  }
});

// The parity gate works only in the tool's own tree, so the probe runs on a copy (toolCopy): an
// ordinary fixture with a `templates/` directory does not wake the gate.
function toolProject(mutate) {
  const dir = toolCopy();
  assert.equal(toolCli(dir, ['init', '--lang', 'ru']).code, 0, 'the tool copy lays itself out');
  mutate(dir);
  return { dir, ...toolCli(dir, ['lint']) };
}

function toolProbe(name, mutate, re) {
  test(`lint: ${name}`, () => {
    let project;
    try {
      project = toolProject(mutate);
      assert.equal(project.code, 1, project.out);
      assert.match(project.err, re);
    } finally { if (project) cleanup(project.dir); }
  });
}

test('lint: template parity: renaming the canonical skill does not switch the gate off', () => {
  let project;
  try {
    project = toolProject((dir) => {
      for (const layer of ['skills', 'en/skills']) {
        renameSync(path.join(dir, 'templates', ...layer.split('/'), 'backslop-task'),
          path.join(dir, 'templates', ...layer.split('/'), 'backslop-tsk'));
      }
    });
    assert.equal(project.code, 1, project.out);
    assert.match(project.err, ruRe('{file} frontmatter name is {name}, expected {skill}', { file: 'skills/backslop-tsk/SKILL.md', name: 'backslop-task', skill: 'backslop-tsk' }));
  } finally { if (project) cleanup(project.dir); }
});

test('lint: 11. the release gate is alive after renaming the canonical skill', () => {
  let project;
  try {
    project = toolProject((dir) => {
      for (const layer of ['skills', 'en/skills']) {
        renameSync(path.join(dir, 'templates', ...layer.split('/'), 'backslop-task'),
          path.join(dir, 'templates', ...layer.split('/'), 'backslop-tsk'));
      }
      put(dir, 'package.json', `${JSON.stringify({ ...JSON.parse(read(dir, 'package.json')), version: '9.9.9' }, null, 2)}\n`);
    });
    assert.equal(project.code, 1, project.out);
    assert.match(project.err, ruRe(PKG_VERSION, { version: '9.9.9', config: 'backslop.json', stamp: TOOL_VERSION }));
  } finally { if (project) cleanup(project.dir); }
});

// 14. A non-printable byte: the gate judges tracked files,
// so the tool copy gets a git index.
test('lint: 14. a byte below 0x09 in a tracked tool source is an error with the file, offset and line', () => {
  let red;
  let green;
  try {
    red = toolProject((dir) => {
      put(dir, 'lib/probe.js', 'const a = 1;\nconst key = `a\u0000b`;\n');
      put(dir, 'bin/probe.txt', 'ab\u0001c\n');
      run(dir, ['init', '-q']);
      run(dir, ['add', '-A']);
    });
    assert.equal(red.code, 1, red.out);
    assert.match(red.err, errRe('lib/probe.js', BYTE, { code: '0x00', at: 27, line: 2, why: NUL_WHY, hex: '00' }));
    assert.match(red.err, errRe('bin/probe.txt', BYTE, { code: '0x01', at: 2, line: 1, why: CONTROL_WHY, hex: '01' }));
    assert.doesNotMatch(red.err, /0x01[^\n]*git/, 'only NUL mentions git: git does not count the other bytes as binary');
    assert.equal(red.err.match(new RegExp(`: ${ruHeadRe(BYTE).source}0x`, 'g')).length, 2, 'the tool copy carries no other such bytes');

    green = toolProject((dir) => {
      put(dir, 'lib/probe.js', 'const a = 1;\n\tconst key = `a\\u0000b`;\n');
      put(dir, 'docs/untracked.md', 'not in the index \u0001\n');
      run(dir, ['init', '-q']);
      run(dir, ['add', '-A', '--', 'lib', 'bin', 'templates', 'package.json']);
    });
    assert.equal(green.code, 0, green.err);
    assert.doesNotMatch(green.err, new RegExp(`${ruHeadRe(BYTE).source}0x|${ruRe('non-printable bytes were not checked: {message}').source}`));
  } finally {
    if (red) cleanup(red.dir);
    if (green) cleanup(green.dir);
  }
});

test('lint: 14. a foreign project is not judged by the byte gate — its docs/** and test/** may be binary', () => {
  const root = makeProject();
  try {
    seedGreen(root);
    put(root, 'lib/probe.js', 'const key = `a\u0000b`;\n');
    put(root, 'docs/logo.png', '\u0089PNG\r\n\u001a\n\u0000\u0000');
    gitAll(root);
    assert.deepEqual(problems(root), []);
  } finally {
    cleanup(root);
  }
});

// 12. Template placeholders: a placeholder with no key in vars. The probe goes both ways, else the
// gate is indistinguishable from an idle one: red without green proves only that it can complain.
function withSlot(dir, name) {
  for (const rel of ['templates/brief.md', 'templates/en/brief.md']) {
    put(dir, rel, `${read(dir, rel)}\n{{${name}}}\n`);
  }
}

test('lint: 12. a template slot without a key in vars reddens the gate, with a key it does not', () => {
  let red;
  let green;
  try {
    red = toolProject((dir) => withSlot(dir, 'budget'));
    assert.equal(red.code, 1, red.out);
    assert.match(red.err, ruRe('templates/{layer}{rel} placeholder {{{name}}} has no key in vars', { layer: '', rel: 'brief.md', name: 'budget' }));
    assert.match(red.err, ruRe('templates/{layer}{rel} placeholder {{{name}}} has no key in vars', { layer: 'en/', rel: 'brief.md', name: 'budget' }));

    green = toolProject((dir) => {
      withSlot(dir, 'budget');
      put(dir, 'lib/templates.js', read(dir, 'lib/templates.js')
        .replace("[/^brief\\.md$/, ['autonomy',", "[/^brief\\.md$/, ['autonomy', 'budget',"));
    });
    assert.equal(green.code, 0, green.err);
  } finally {
    if (red) cleanup(red.dir);
    if (green) cleanup(green.dir);
  }
});

toolProbe('template parity: a missing English layer is an error, not silence', (dir) => rmSync(path.join(dir, 'templates', 'en'), { recursive: true }), ruRe('templates/en/ is missing'));

test('lint: template parity and slot errors follow an en project language', () => {
  const dir = toolCopy();
  try {
    assert.equal(toolCli(dir, ['init', '--lang', 'en']).code, 0);
    rmSync(path.join(dir, 'templates', 'en', 'skills', 'backslop-batch', 'SKILL.md'));
    put(dir, 'templates/brief.md', `${read(dir, 'templates/brief.md')}{{budget}}\n`);
    const r = toolCli(dir, ['lint']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, /templates\/skills\/backslop-batch\/SKILL\.md has no en source templates\/en\/skills\/backslop-batch\/SKILL\.md/);
    assert.match(r.err, /templates\/brief\.md placeholder \{\{budget\}\} has no key in vars/);
  } finally { cleanup(dir); }
});

test('lint: a foreign templates/ does not wake the parity gate', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    put(root, 'templates/skills/own-skill/SKILL.md', '{{cli}}\n');
    const r = cli(root, ['lint']);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(problems(root), []);
  } finally {
    cleanup(root);
  }
});

test('lint: 4. the Area placeholder from new is an error in a task past triage', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    assert.equal(cli(root, ['new', 'queued', '--queue']).code, 0);
    const found = problems(root);
    assert.ok(found.some((p) => errRe('queued.md', AREA_INCOMPLETE, { label: FIELD.area }).test(p)), found.join(' | ') || 'nothing');
  } finally {
    cleanup(root);
  }
});

// A card made by the regular command must pass the gate before triage: its stubs in triage/ are not
// checked at all. The same card in queue/ is triaged — every stub reddens.
test('lint: 4. a card from new passes the gate in triage/, in queue/ every stub reddens', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    assert.equal(cli(root, ['new', 'placeholders', '--title', 'Stubs']).code, 0);
    assert.deepEqual(problems(root), []);
    assert.equal(cli(root, ['mv', '5', 'queue']).code, 0);
    const found = problems(root);
    const todoLines = read(root, 'docs/backlog/queue/BS-5-placeholders.md')
      .split('\n').map((line, i) => (line.includes('[TODO') ? i + 1 : 0)).filter(Boolean);
    assert.ok(todoLines.length >= 4, `the new card has ${todoLines.length} stubs`);
    for (const line of todoLines) {
      assert.ok(found.some((p) => p === errLine('docs/backlog/queue/BS-5-placeholders.md', TODO_LINE, { line })),
        `line ${line} did not redden: ${found.join(' | ') || 'nothing'}`);
    }
  } finally {
    cleanup(root);
  }
});

greenProbe('10. a quote in docs/archive is a snapshot of the moment, and one shown in a fence is not a block', (root) => {
  // A closed task quotes what the file no longer holds: it must not be reddened.
  put(root, 'docs/archive/BS-4-e/task.md', `${ruCard('BS-4', 'D')}\n<!-- quote:../reference/README.md -->\n\nwhat the file does not hold\n\n<!-- /quote -->\n`);
  // A block form shown inside a fence is an example, not a quote.
  put(root, 'docs/howto.md', ['# How to quote', '', '```markdown', '<!-- quote:reference/none.md -->', 'anything', '<!-- /quote -->', '```', ''].join('\n'));
});
test('lint: 10. quote:before keeps the snapshot before the edit but does not hide block errors', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    put(root, 'docs/quoting.md', [
      '# Quotes', '',
      '<!-- quote:before:reference/README.md -->', '',
      'the state before the edit', '',
      '<!-- /quote -->', '',
    ].join('\n'));
    assert.deepEqual(problems(root), []);
    put(root, 'docs/quoting.md', '<!-- quote:before:reference/missing.md -->\n\nthe state before the edit\n\n<!-- /quote -->\n');
    assert.ok(problems(root).some((p) => errRe('quoting.md', QUOTE_MISSING, { href: 'reference/missing.md' }).test(p)), problems(root).join(' | '));
  } finally {
    cleanup(root);
  }
});

probe('10. a second marker closes an unclosed block with an error', (root) => put(root, 'docs/quoting.md', `<!-- quote:reference/README.md -->\n\n${ONE}\n\n<!-- quote:reference/README.md -->\n\n${ONE}\n\n<!-- /quote -->\n`), errRe('quoting.md', QUOTE_OPEN));
probe('10. the quote diverged from the file', (root) => put(root, 'docs/reference/README.md', `# ${SECTION.context}\n\nOne concept, two names.\n`), errRe('quoting.md', QUOTE_DIFF, { href: 'reference/README.md' }));
probe('10. a quote points at a missing file', (root) => put(root, 'docs/quoting.md', '<!-- quote:reference/none.md -->\n\ntext\n\n<!-- /quote -->\n'), errRe('quoting.md', QUOTE_MISSING, { href: 'reference/none.md' }));
probe('10. a quote block is not closed', (root) => put(root, 'docs/quoting.md', `<!-- quote:reference/README.md -->\n\n${ONE}\n`), errRe('quoting.md', QUOTE_OPEN));
probe('10. the message of a diverged fenced quote names its first text line, not the fence', (root) => put(root, 'docs/reference/README.md', `# ${SECTION.context}\n\nOne concept, two names.\n`), exactRe('docs/quoting.md', QUOTE_DIFF, { href: 'reference/README.md', first: ONE }));
probe('10. a spaced opener is a quote block', (root) => put(root, 'docs/quoting.md', '<!-- quote: reference/README.md -->\n\nnot the text\n\n<!-- /quote -->\n'), errRe('quoting.md', QUOTE_DIFF, { href: 'reference/README.md', first: 'not the text' }));
probe('10. a spaced quote:before opener still checks the target', (root) => put(root, 'docs/quoting.md', '<!-- quote: before: reference/none.md -->\n\ntext\n\n<!-- /quote -->\n'), errRe('quoting.md', QUOTE_MISSING, { href: 'reference/none.md' }));
probe('10. a closer with no open block', (root) => put(root, 'docs/quoting.md', `${read(root, 'docs/quoting.md')}\n<!-- /quote -->\n`), errRe('quoting.md', QUOTE_CLOSER, { line: 21 }));
probe('10. a quote marker that does not parse', (root) => put(root, 'docs/quoting.md', '<!-- quote reference/README.md -->\n\ntext\n'), errRe('quoting.md', QUOTE_MARKER, { line: 1 }));
test('lint: 10. a quote marker inside inline code or mid-prose is prose', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    put(root, 'docs/howto-inline.md', '# Q\n\nClose a block with `<!-- /quote -->`; open it with `<!-- quote:<path> -->`.\n\nWrap it in a “<!-- quote:path --> … <!-- /quote -->” block.\n\n`<!-- quote -->`\n');
    assert.deepEqual(problems(root), []);
  } finally {
    cleanup(root);
  }
});
test('lint: 10. a finding card fresh from new passes the quote gate', () => {
  const root = makeProject();
  try {
    seedGreen(root);
    assert.equal(cli(root, ['new', 'finding', '--parent', '1']).code, 0);
    assert.ok(!problems(root).some((p) => [QUOTE_MISSING, QUOTE_DIFF, QUOTE_OPEN, QUOTE_CLOSER, QUOTE_MARKER].some((en) => ruRe(en).test(p))), problems(root).join(' | '));
  } finally {
    cleanup(root);
  }
});

// Five err() branches that could still be cut out while npm test stayed green.
const DIR_IN_STATUS = 'directory inside a status directory: each task must be one file';
probe('2. a directory instead of a task file in a status directory', (root) => mkdirSync(path.join(root, 'docs/backlog/queue/sub')), ruRe(DIR_IN_STATUS));
// A directory named like a task file: scanTasks read it as a file and fell over with EISDIR
// before the gate.
probe('2. a directory named like a task file in a status directory', (root) => mkdirSync(path.join(root, 'docs/backlog/queue/BS-9-sub.md')), errRe('BS-9-sub.md', DIR_IN_STATUS));
probe('2. a symlink to a directory named like a task file — the same diagnostic', (root) => {
  mkdirSync(path.join(root, 'docs/shared'));
  symlinkSync(path.join(root, 'docs/shared'), path.join(root, 'docs/backlog/queue/BS-9-sub.md'));
}, errRe('BS-9-sub.md', DIR_IN_STATUS));
probe('2. a dangling link named like a task file in a status directory', (root) => {
  symlinkSync(path.join(root, 'docs/nowhere.md'), path.join(root, 'docs/backlog/queue/BS-9-sub.md'));
}, errRe('BS-9-sub.md', 'dangling symlink in a status directory: a task is a file, and the link points to nothing'));
probe('3. no backlog directory', (root) => rmSync(path.join(root, 'docs/backlog'), { recursive: true }), ruRe('backlog directory is missing — run {cli} init'));
probe('5. a stray file in the archive', (root) => put(root, 'docs/archive/NOTES.txt', 'a note\n'), ruRe('archive may contain only task directories, README.md, and {log}'));
test('lint: 5. an archive task directory symlinked inside the project is a task directory', { skip: process.platform === 'win32' }, () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    renameSync(path.join(root, 'docs/archive/BS-4-e'), path.join(root, 'store-BS-4-e'));
    symlinkSync(path.join(root, 'store-BS-4-e'), path.join(root, 'docs/archive/BS-4-e'));
    assert.deepEqual(problems(root), []);
  } finally {
    cleanup(root);
  }
});
probe('5. an archive directory without task.md', (root) => rmSync(path.join(root, 'docs/archive/BS-4-e/task.md')), ruRe('task.md specification is missing'));
probe('8. an ADR exists but the documentation index does not', (root) => rmSync(path.join(root, 'docs/README.md')), ruRe('documentation index is missing while ADRs exist'));

// 13. The closed-tasks journal: an entry parses, the anchor equals the number, a link to an anchor
// leads to an entry — one probe each; reachability of the revision from HEAD is checked below.
const LOG_GREEN = [
  '# Journal of closed tasks',
  '',
  'One line per task.',
  '',
  `- <a id="bs-5"></a>\`BS-5-folded\` · 2026-08-02 · ${ruOutcomeWord('completed')} · \`abcdef1234\` · Folded`,
  '',
].join('\n');

function seedLog(root) {
  put(root, 'docs/archive/LOG.md', LOG_GREEN);
  put(root, 'ROADMAP.md', '# Roadmap\n\nClosed [BS-5](docs/archive/LOG.md#bs-5).\n');
}

test('lint: the closed-tasks journal next to the archive directory is green', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    seedLog(root);
    assert.deepEqual(problems(root), []);
    assert.ok(warnings(root).some((w) => errRe('LOG.md', REACH).test(w)), warnings(root).join(' | '));
  } finally {
    cleanup(root);
  }
});

probe('13. a journal line does not parse', (root) => {
  seedLog(root);
  put(root, 'docs/archive/LOG.md', LOG_GREEN.replace('· 2026-08-02 ·', '· yesterday ·'));
}, errRe('LOG.md', 'line {line} looks like a journal entry but does not parse: “{raw}”', { line: 5 }));

probe('13. the line anchor does not match the number', (root) => {
  seedLog(root);
  put(root, 'docs/archive/LOG.md', LOG_GREEN.replace('id="bs-5"', 'id="bs-50"'));
}, errRe('LOG.md', 'line {line}: anchor “{anchor}” does not match the number — incoming links point at “{expected}”', { line: 5, anchor: 'bs-50' }));

probe('13. a link points to an anchor the journal does not have', (root) => {
  seedLog(root);
  put(root, 'docs/ROADMAP.md', '# Roadmap\n\nClosed [BS-5](archive/LOG.md#bs-55).\n');
}, errRe('ROADMAP.md', JOURNAL_MISS, { href: 'archive/LOG.md#bs-55', anchor: 'bs-55' }));

probe('13. a link from a root file to a missed anchor', (root) => {
  seedLog(root);
  put(root, 'README.md', 'See [BS-5](docs/archive/LOG.md#bs-55)\n');
}, errRe('README.md', JOURNAL_MISS, { href: 'docs/archive/LOG.md#bs-55', anchor: 'bs-55' }));
greenProbe('13. a journal link inside an HTML comment is not read', (root) => {
  seedLog(root);
  put(root, 'ROADMAP.md', '# Roadmap\n\nClosed [BS-5](docs/archive/LOG.md#bs-5). <!-- [x](docs/archive/LOG.md#bs-99) -->\n');
});
test('lint: 1. the adapter pass checks anchors into the journal, which gate 13 does not walk', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    seedLog(root);
    assert.equal(cli(root, ['init', '--tools', 'claude']).code, 0);
    put(root, '.claude/skills/backslop-task/SKILL.md',
      '<!-- backslop:generated -->\n[ok](../../../docs/archive/LOG.md#bs-5) [gone](../../../docs/archive/LOG.md#bs-999)\n');
    assert.deepEqual(problems(root).filter((p) => p.startsWith('.claude/skills/backslop-task/')), [
      errLine('.claude/skills/backslop-task/SKILL.md', NO_ANCHOR, { href: '../../../docs/archive/LOG.md#bs-999', where: 'docs/archive/LOG.md', fragment: 'bs-999', line: 2 }),
    ]);
  } finally {
    cleanup(root);
  }
});

test('lint: 13. the journal anchor is checked behind ?query and a %-escape; a malformed escape does not throw', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    seedLog(root);
    put(root, 'ROADMAP.md', '# Roadmap\n\n[BS-5](docs/archive/LOG.md?plain=1#bs-5) [q](docs/archive/LOG.md?plain=1#bs-99) [e](docs/archive/LOG%2Emd#bs-9) [m](a%E0%A4%A.md#bs-5)\n');
    assert.deepEqual(problems(root), [
      errLine('ROADMAP.md', BROKEN, { href: 'a%E0%A4%A.md#bs-5', line: 3 }),
      errLine('ROADMAP.md', JOURNAL_MISS, { href: 'docs/archive/LOG.md?plain=1#bs-99', anchor: 'bs-99', line: 3 }),
      errLine('ROADMAP.md', JOURNAL_MISS, { href: 'docs/archive/LOG%2Emd#bs-9', anchor: 'bs-9', line: 3 }),
    ]);
  } finally {
    cleanup(root);
  }
});

// A closed task committed between `archive N` and `fold N`:
// that commit becomes the revision of the journal line.
function foldCommitted(root) {
  put(root, 'docs/archive/BS-5-folded/task.md', ruCard('BS-5', 'Folded', { area: AREA }));
  put(root, 'docs/archive/BS-5-folded/result.md', closed('BS-5', '2026-08-02'));
  gitAll(root, 'BS-5: acceptance before the fold');
  const r = cli(root, ['fold', '5']);
  assert.equal(r.code, 0, r.err);
  assert.match(read(root, 'docs/archive/LOG.md'), /· `[0-9a-f]{10}` · Folded/, 'the line names the revision');
  return r.out;
}

test('lint: 13. the journal line revision is not reachable from HEAD — squash dropped the commit between archive and fold', () => {
  const root = makeProject();
  try {
    seedGreen(root);
    gitAll(root, 'base');
    const base = run(root, ['rev-parse', 'HEAD']).stdout.trim();
    const draft = foldCommitted(root);
    assert.deepEqual(problems(root), [], 'before the squash the line revision is in the HEAD history');
    run(root, ['add', '-A']);
    run(root, ['reset', '-q', '--soft', base]);
    run(root, ['commit', '-q', '-m', draft]);
    const line = read(root, 'docs/archive/LOG.md').split('\n').findIndex((l) => l.startsWith('- <a id="bs-5">')) + 1;
    const found = problems(root);
    assert.ok(found.some((p) => errRe('LOG.md', 'line {line}: revision {commit} is not reachable from HEAD — show will not find the body through it; such a revision is left by a commit that a squash or rebase dropped after folding', { line }).test(p)), found.join(' | ') || 'nothing');
  } finally {
    cleanup(root);
  }
});

test('lint: 13. a shallow clone — reachability of journal revisions is not checked, a warning instead of an error', () => {
  const root = makeProject();
  const clone = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-shallow-')));
  try {
    seedGreen(root);
    gitAll(root, 'base');
    foldCommitted(root);
    gitAll(root, 'BS-5: closed');
    run(root, ['clone', '-q', '--depth', '1', `file://${root}`, clone]);
    assert.deepEqual(problems(clone).filter((p) => p.startsWith('docs/archive/LOG.md')), [], 'the revision is absent from a shallow clone, and that is no argument against the line');
    assert.ok(warnings(clone).some((w) => errRe('LOG.md', REACH, { why: ru('the clone is shallow and lacks older commits') }).test(w)), warnings(clone).join(' | '));
  } finally {
    cleanup(root);
    cleanup(clone);
  }
});

test('lint: 13. a failed git rev-list warns with the signal name or the first stderr line only', { skip: process.platform === 'win32' }, () => {
  const root = makeProject();
  const bin = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-git-shim-')));
  try {
    seedGreen(root);
    gitAll(root, 'base');
    foldCommitted(root);
    const real = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
    for (const { label, shim, expect, forbid } of [
      { label: 'killed by a signal', shim: 'kill -9 $$', expect: new RegExp(`${errSrc('LOG.md', REACH, { why: KILLED })}$`, 'm'), forbid: /git null/ },
      { label: 'multi-line stderr', shim: "{ printf 'fatal: first\\nsecond\\n' >&2; exit 128; }", expect: new RegExp(`${errSrc('LOG.md', REACH, { why: 'fatal: first' })}$`, 'm'), forbid: /second/ },
    ]) {
      writeFileSync(path.join(bin, 'git'), `#!/bin/sh\nfor a in "$@"; do [ "$a" = rev-list ] && ${shim}; done\nexec "${real}" "$@"\n`, { mode: 0o755 });
      const r = cli(root, ['lint'], { env: { PATH: `${bin}${path.delimiter}${process.env.PATH}` } });
      assert.equal(r.code, 0, `${label}: a warning does not fail the gate: ${r.err}`);
      assert.match(r.err, expect, label);
      assert.doesNotMatch(r.err, forbid, label);
    }
  } finally {
    cleanup(root);
    rmSync(bin, { recursive: true, force: true });
  }
});

probe('2. a number is taken by both an archive directory and a journal line', (root) => {
  put(root, 'docs/archive/LOG.md', LOG_GREEN.replace('bs-5', 'bs-4').replace('BS-5-folded', 'BS-4-e'));
}, ruRe('number {id} is already used by {rel}', { id: 'BS-4' }));

test('lint: a layout directory that is a file is a gate error naming the path, not a stack', () => {
  for (const rel of ['docs/backlog', 'docs/backlog/queue', 'docs/adr', 'docs/archive/BS-4-e/minor', 'docs/archive']) {
    const root = makeProject({ git: false });
    try {
      seedGreen(root);
      rmSync(path.join(root, ...rel.split('/')), { recursive: true, force: true });
      put(root, rel, 'x\n');
      const r = cli(root, ['lint']);
      assert.equal(r.code, 1, `${rel}: ${r.out}`);
      assert.ok(r.err.split('\n').includes(`✖ ${rel}: ${ru('a file, expected a directory')}`), `${rel}: ${r.err}`);
      assert.doesNotMatch(r.err, /ENOTDIR|node:fs|\n\s+at /, `${rel}: a stack`);
    } finally {
      cleanup(root);
    }
  }
});

test('lint: a stale pin in a gate command or probe is an error naming gates[i]', () => {
  const root = makeProject({ git: false });
  const V = TOOL_VERSION;
  try {
    seedGreen(root);
    const setConfig = (patch) => put(root, 'backslop.json', `${JSON.stringify({ ...JSON.parse(read(root, 'backslop.json')), ...patch }, null, 2)}\n`);
    const now = `npx github:me/proj#v${V}`;
    setConfig({ cli: now, version: V, lang: 'en', gates: [`${now} lint`, { command: `cd . && ${now} lint && npx github:me/proj#v0.1.0 gates`, when: ['docs/**'] }] });
    assert.ok(problems(root).includes(`backslop.json: gates[1]: pin github:me/proj#v0.1.0 differs from cli — expected github:me/proj#v${V}; ${now} upgrade rewrites it`), problems(root).join(' | '));
    const r = cli(root, ['lint']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, /backslop\.json: gates\[1\]: pin/);

    setConfig({ gates: [`${now} lint`], probe: 'npx github:me/proj#v0.1.0 status' });
    assert.ok(problems(root).some((p) => p.startsWith('backslop.json: probe: pin github:me/proj#v0.1.0 differs from cli')), problems(root).join(' | '));
    setConfig({ probe: `${now} status` });
    assert.deepEqual(problems(root), []);
  } finally {
    cleanup(root);
  }
});

test('lint: a suffixed pin in gates, probe or a live file is an error that says it is not the cli pin', () => {
  const root = makeProject({ git: false });
  const V = TOOL_VERSION;
  try {
    seedGreen(root);
    const now = `npx github:me/proj#v${V}`;
    const setConfig = (patch) => put(root, 'backslop.json', `${JSON.stringify({ ...JSON.parse(read(root, 'backslop.json')), ...patch }, null, 2)}\n`);
    setConfig({ cli: now, version: V, lang: 'en', gates: [`${now} lint`, 'npx github:me/proj#v0.1.0-rc.1 gates'], probe: 'npx github:me/proj#v0.1.0x status' });
    put(root, 'docs/README.md', `${read(root, 'docs/README.md')}\nRun npx github:me/proj#v0.1.0-rc.1 lint.\n`);
    const found = problems(root);
    const tail = `it is not the cli pin ${now.slice(4)}; upgrade leaves it, fix it by hand`;
    assert.ok(found.includes(`backslop.json: gates[1]: pin github:me/proj#v0.1.0-rc.1 has a suffix — ${tail}`), found.join(' | '));
    assert.ok(found.includes(`backslop.json: probe: pin github:me/proj#v0.1.0x has a suffix — ${tail}`), found.join(' | '));
    assert.ok(found.some((p) => /^docs\/README\.md: line \d+: pin github:me\/proj#v0\.1\.0-rc\.1 has a suffix — /.test(p)), found.join(' | '));
    assert.equal(cli(root, ['lint']).code, 1);
    setConfig({ gates: [`${now} lint`], probe: `${now} status` });
    put(root, 'docs/README.md', read(root, 'docs/README.md').replace('#v0.1.0-rc.1', `#v${V}`));
    assert.deepEqual(problems(root), []);
  } finally {
    cleanup(root);
  }
});

test('lint: a stale pin with a .git suffix or without v in gates[i] or probe is an error too', () => {
  const root = makeProject({ git: false });
  const V = TOOL_VERSION;
  try {
    seedGreen(root);
    const setConfig = (patch) => put(root, 'backslop.json', `${JSON.stringify({ ...JSON.parse(read(root, 'backslop.json')), ...patch }, null, 2)}\n`);
    const now = `npx github:me/proj#v${V}`;
    setConfig({ cli: now, version: V, lang: 'en', gates: ['npx github:me/proj.git#v0.1.0 lint'], probe: 'npx github:me/proj#0.1.0 status' });
    const found = problems(root);
    assert.ok(found.includes(`backslop.json: gates[0]: pin github:me/proj.git#v0.1.0 differs from cli — expected github:me/proj#v${V}; ${now} upgrade rewrites it`), found.join(' | '));
    assert.ok(found.some((p) => p.startsWith('backslop.json: probe: pin github:me/proj#0.1.0 differs from cli')), found.join(' | '));
  } finally {
    cleanup(root);
  }
});

test('lint: a stale pin in a file upgrade skips names a hand edit as the remedy', { skip: process.platform === 'win32' }, () => {
  const root = makeProject({ git: false });
  const shared = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-shared-')));
  try {
    seedGreen(root);
    const now = `npx github:me/proj#v${TOOL_VERSION}`;
    put(root, 'backslop.json', `${JSON.stringify({ ...JSON.parse(read(root, 'backslop.json')), cli: now, lang: 'en' }, null, 2)}\n`);
    writeFileSync(path.join(shared, 'package.json'), '{"scripts":{"l":"npx github:me/proj#v0.1.0 lint"}}\n');
    symlinkSync(shared, path.join(root, 'vendor'));
    writeFileSync(path.join(root, 'docs', 'NOTES.md'), Buffer.concat([Buffer.from([0xC7, 0xE0, 0xEC]), Buffer.from(': `npx github:me/proj#v0.1.0 lint`\n')]));
    put(root, 'docs/reference/README.md', `${read(root, 'docs/reference/README.md')}\nRun \`npx github:me/proj#v0.1.0 status\`.\n`);
    put(root, 'misc/notes.md', 'Run `npx github:me/proj#v0.1.0 status`.\n');
    symlinkSync(path.join(root, 'misc', 'notes.md'), path.join(root, 'NOTES.md'));
    const found = problems(root);
    assert.ok(found.some((p) => p.startsWith('NOTES.md: line 1:') && p.endsWith('upgrade does not rewrite it (the path goes through the symlink NOTES.md) — edit it by hand')), found.join(' | '));
    assert.ok(found.some((p) => p.startsWith('vendor/package.json: line 1: pin github:me/proj#v0.1.0 differs from cli') && p.endsWith('upgrade does not rewrite it (the path goes through the symlink vendor) — edit it by hand')), found.join(' | '));
    assert.ok(found.some((p) => p.startsWith('docs/NOTES.md: line 1:') && p.endsWith('upgrade does not rewrite it (the file is not UTF-8) — edit it by hand')), found.join(' | '));
    assert.ok(found.some((p) => p.startsWith('docs/reference/README.md:') && p.endsWith(`${now} upgrade rewrites it`)), found.join(' | '));
  } finally {
    cleanup(root);
    rmSync(shared, { recursive: true, force: true });
  }
});

function setConfig(root, patch) {
  put(root, 'backslop.json', `${JSON.stringify({ ...JSON.parse(read(root, 'backslop.json')), ...patch }, null, 2)}\n`);
}

test('lint: a live pin that differs from cli is an error naming the file and line, green once fixed', () => {
  const root = makeProject({ git: false });
  const V = TOOL_VERSION;
  try {
    seedGreen(root);
    setConfig(root, { cli: `npx github:me/proj#v${V}`, version: V });
    put(root, 'package.json', `{"scripts":{"lint:backslop":"npx github:me/proj#v0.1.0 lint"}}\n`);
    put(root, '.github/workflows/ci.yml', `steps:\n  - run: npx github:me/proj#v0.1.0 init\n`);
    assert.ok(problems(root).some((p) => p.startsWith('package.json:')), problems(root).join(' | '));
    assert.ok(problems(root).some((p) => p.startsWith('.github/workflows/ci.yml:')), problems(root).join(' | '));
    put(root, 'package.json', `{"scripts":{"lint:backslop":"npx github:me/proj#v${V} lint"}}\n`);
    put(root, '.github/workflows/ci.yml', `steps:\n  - run: npx github:me/proj#v${V} init\n`);
    assert.deepEqual(problems(root), []);

    put(root, 'docs/archive/README.md', '# Archive\n\nThe move is done by `npx github:me/proj#v0.1.0 archive N`.\n');
    assert.ok(problems(root).some((p) => errRe('docs/archive/README.md', PIN_DIFFERS, { at: atLine(3), pin: 'github:me/proj#v0.1.0' }).test(p)), problems(root).join(' | '));
    put(root, 'docs/archive/README.md', `# Archive\n\nThe move is done by \`npx github:me/proj#v${V} archive N\`.\n`);
    assert.deepEqual(problems(root), []);

    // The npm form of a pin is compared the same way.
    setConfig(root, { cli: `npx backslop@${V}`, version: V });
    put(root, 'docs/ROADMAP.md', 'Installed with `npx backslop@0.3.0`.\n');
    assert.ok(problems(root).some((p) => errRe('docs/ROADMAP.md', PIN_DIFFERS, { at: atLine(1), pin: 'backslop@0.3.0' }).test(p)), problems(root).join(' | '));
    put(root, 'docs/ROADMAP.md', `Installed with \`npx backslop@${V}\`.\n`);
    put(root, 'docs/archive/README.md', '# Archive\n');
    assert.deepEqual(problems(root), []);
  } finally {
    cleanup(root);
  }
});

test('lint: a stale pin in history files or quoted as card evidence is not drift', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    setConfig(root, { cli: `npx github:me/proj#v${TOOL_VERSION}`, version: TOOL_VERSION });
    // Records of a moment are not instructions: their versions are not drift.
    put(root, 'CHANGELOG.md', '## Unreleased\n\n- **One** — it was `npx github:me/proj#v0.1.0`\n');
    put(root, 'docs/adr/adr-001-process.md', '# ADR-001: Process\n\n**Status:** Accepted\n\nAt `npx github:me/proj#v0.1.0`.\n');
    put(root, 'docs/archive/BS-4-e/task.md', `${ruCard('BS-4', 'D')}\nRan with \`npx github:me/proj#v0.1.0 lint\`.\n`);
    assert.deepEqual(problems(root), []);

    // A task card quotes the pin as the evidence of the moment — nothing to warn about.
    put(root, 'docs/backlog/queue/BS-1-a.md', `${ruCard('BS-1', 'A', { order: 10, area: AREA })}\nMeasured on \`npx github:me/proj#v0.1.0\`.\n`);
    assert.deepEqual(problems(root), []);
  } finally {
    cleanup(root);
  }
});

test('lint: an unpinned cli leaves a stale prose pin silent', () => {
  const root = makeProject({ git: false });
  const V = TOOL_VERSION;
  try {
    seedGreen(root);
    put(root, 'docs/notes.md', 'Installed with `npx backslop@0.3.0`.\n');
    setConfig(root, { cli: `npx backslop@${V}`, version: V });
    assert.ok(problems(root).some((p) => p.startsWith(`docs/notes.md: ${atLine(1)}:`)), 'a pinned cli sees the stale pin');
    // A cli without a pin has nothing to compare with: self-host and a global install stay silent.
    setConfig(root, { cli: 'node bin/backslop.js', version: V });
    assert.deepEqual(problems(root), []);
    assert.deepEqual(warnings(root), []);
    setConfig(root, { cli: 'npx backslop', version: V });
    assert.deepEqual(problems(root), [], 'npx with no pin');
  } finally {
    cleanup(root);
  }
});

test('lint: a pin in a journal entry is a record of its moment, the LOG.md header stays live', () => {
  const root = makeProject({ git: false });
  const V = TOOL_VERSION;
  const old = 'npx github:me/proj#v0.1.0';
  const now = `npx github:me/proj#v${V}`;
  try {
    seedGreen(root);
    put(root, 'backslop.json', `${JSON.stringify({ ...JSON.parse(read(root, 'backslop.json')), cli: now, version: V }, null, 2)}\n`);
    const entry = `- <a id="bs-6"></a>\`BS-6-y\` · 2026-09-01 · completed · — · Measured with \`${old} lint\``;
    put(root, 'docs/archive/LOG.md', `# Log\n\nBodies: \`${now} show N\`.\n\n${entry}\n`);
    assert.deepEqual(problems(root), []);
    assert.deepEqual(rewriteProsePins(root, 'docs', 'BS', parseCli(now), V), []);

    put(root, 'docs/archive/LOG.md', `# Log\n\nBodies: \`${old} show N\`.\n\n${entry}\n`);
    assert.equal(problems(root).length, 1, problems(root).join(' | '));
    assert.match(problems(root)[0], new RegExp(`^${errSrc('docs/archive/LOG.md', PIN_DIFFERS, { at: atLine(3), pin: 'github:me/proj#v0.1.0' })}`));
    assert.deepEqual(rewriteProsePins(root, 'docs', 'BS', parseCli(now), V), ['docs/archive/LOG.md']);
    assert.equal(read(root, 'docs/archive/LOG.md'), `# Log\n\nBodies: \`${now} show N\`.\n\n${entry}\n`);
    assert.deepEqual(problems(root), []);
  } finally {
    cleanup(root);
  }
});

test('lint: a prose pin in the other forms parseCli accepts, .git suffix or no v, is checked too', () => {
  const root = makeProject({ git: false });
  const V = TOOL_VERSION;
  try {
    seedGreen(root);
    put(root, 'backslop.json', `${JSON.stringify({ ...JSON.parse(read(root, 'backslop.json')), cli: `npx github:me/proj#v${V}`, version: V }, null, 2)}\n`);
    put(root, 'docs/ROADMAP.md', 'Run `npx github:me/proj.git#v0.1.0 lint` or `npx github:me/proj#0.1.0 lint`.\n');
    const found = problems(root);
    assert.ok(found.some((p) => errRe('docs/ROADMAP.md', PIN_DIFFERS, { at: atLine(1), pin: 'github:me/proj.git#v0.1.0' }).test(p)), found.join(' | '));
    assert.ok(found.some((p) => errRe('docs/ROADMAP.md', PIN_DIFFERS, { at: atLine(1), pin: 'github:me/proj#0.1.0' }).test(p)), found.join(' | '));
    put(root, 'docs/ROADMAP.md', `Run \`npx github:me/proj.git#v${V} lint\` or \`npx github:me/proj#${V} lint\`.\n`);
    assert.deepEqual(problems(root), [], 'the current version in another form is no drift');
  } finally {
    cleanup(root);
  }
});

test('lint: an upper-case CHANGELOG.MD or card file stays a record of its moment for the pin gate and upgrade', () => {
  const root = makeProject({ git: false });
  const V = TOOL_VERSION;
  const old = 'npx github:me/proj#v0.1.0';
  try {
    seedGreen(root);
    put(root, 'backslop.json', `${JSON.stringify({ ...JSON.parse(read(root, 'backslop.json')), cli: `npx github:me/proj#v${V}`, version: V }, null, 2)}\n`);
    rmSync(path.join(root, 'CHANGELOG.md'));
    const changelog = `## Unreleased\n\n- **Old** — ran \`${old}\`\n`;
    put(root, 'CHANGELOG.MD', changelog);
    put(root, 'docs/notes/BS-7-x.MD', `Measured on \`${old}\`.\n`);
    // A lower-case prefix is no card, so the file stays live; its own name avoids an APFS clash.
    put(root, 'docs/notes/bs-8-y.md', `Run \`${old} lint\`.\n`);
    const live = livePinFiles(root, 'docs', 'BS').map(([rel]) => rel);
    assert.ok(!live.includes('CHANGELOG.MD') && !live.includes('docs/notes/BS-7-x.MD'), live.join(' '));
    assert.ok(live.includes('docs/notes/bs-8-y.md'), live.join(' '));
    assert.equal(problems(root).length, 1, problems(root).join(' | '));
    assert.match(problems(root)[0], new RegExp(`^${errSrc('docs/notes/bs-8-y.md', PIN_DIFFERS, { at: atLine(1), pin: 'github:me/proj#v0.1.0' })}`));
    assert.deepEqual(rewriteProsePins(root, 'docs', 'BS', parseCli(`npx github:me/proj#v${V}`), `v${V}`), ['docs/notes/bs-8-y.md']);
    assert.equal(read(root, 'CHANGELOG.MD'), changelog);
    assert.equal(read(root, 'docs/notes/BS-7-x.MD'), `Measured on \`${old}\`.\n`);
  } finally {
    cleanup(root);
  }
});

// Gate 8 reads each ADR's status line and the index rows that link ADRs.

const ADR = 'docs/adr/adr-001-process.md';
const adrWith = (root, status) => put(root, ADR, `# ADR-001: Process\n\n${status}\n**Date:** 2026-09-01\n`);
const fold = msg('ru', 'fold the decision into the ADR that governs the question now, then delete the replaced file');
const replacedStatus = (text) => `${ADR}: ${msg('ru', 'line {line}: “{text}” — an ADR holds a current decision, Proposed or Accepted; {fold}', { line: 3, text, fold })}`;

function adrProbe(name, mutate, expected) {
  test(`lint: 8. ${name}`, () => {
    const root = makeProject({ git: false });
    try {
      seedGreen(root);
      mutate(root);
      const found = problems(root);
      assert.ok(found.includes(expected(root)), `expected ${expected(root)}, found: ${found.join(' | ') || 'nothing'}`);
    } finally {
      cleanup(root);
    }
  });
}

for (const status of ['Superseded', 'Superseded in part', 'Deprecated', 'Rejected']) {
  adrProbe(`a status of ${status} is refused`, (root) => adrWith(root, `**Status:** ${status}`), () => replacedStatus(`**Status:** ${status}`));
}
adrProbe('an ADR without a status line is refused', (root) => put(root, ADR, '# ADR-001: Process\n\n**Date:** 2026-09-01\n'),
  () => `${ADR}: ${msg('ru', 'no status line — an ADR states “**Status:** Proposed” or “**Status:** Accepted”')}`);
adrProbe('a status line naming another ADR by its number is a chain', (root) => adrWith(root, '**Status:** Accepted, refines ADR-007'),
  () => `${ADR}: ${msg('ru', 'line {line}: “{text}” names another ADR, which marks a chain; {fold}', { line: 3, text: '**Status:** Accepted, refines ADR-007', fold })}`);
adrProbe('a status line linking another ADR file is a chain', (root) => {
  put(root, 'docs/adr/adr-002-next.md', '# ADR-002: Next\n\n**Status:** Accepted\n');
  put(root, 'docs/README.md', `${read(root, 'docs/README.md')}| [adr/adr-002-next.md](adr/adr-002-next.md) | next | Accepted |\n`);
  adrWith(root, '- **Status:** Accepted, partly replaced by [the next one](adr-002-next.md)');
}, () => `${ADR}: ${msg('ru', 'line {line}: “{text}” names another ADR, which marks a chain; {fold}', {
  line: 3, text: '- **Status:** Accepted, partly replaced by [the next one](adr-002-next.md)', fold,
})}`);
adrProbe('a Status cell that differs from the file is refused', (root) => put(root, 'docs/README.md', read(root, 'docs/README.md').replace('| Accepted |', '| Proposed |')),
  () => `docs/README.md: ${msg('ru', 'line {line}: the Status cell “{cell}” of {adr} differs from its status line “{status}” — write the word of the file', {
    line: 6, cell: 'Proposed', adr: ADR, status: 'Accepted',
  })}`);
adrProbe('an ADR listed in two rows is refused', (root) => put(root, 'docs/README.md', read(root, 'docs/README.md').replace(/^(\| \[adr\/.*)$/m, '$1\n$1')),
  () => `docs/README.md: ${msg('ru', 'line {line}: {adr} is listed again (first at line {prev}) — keep one row per ADR', { line: 7, adr: ADR, prev: 6 })}`);

greenProbe('8. a Proposed ADR with a Proposed row is green', (root) => {
  adrWith(root, '**Status:** Proposed');
  put(root, 'docs/README.md', read(root, 'docs/README.md').replace('| Accepted |', '| Proposed |'));
});
greenProbe('8. the list-item form of the status line is green', (root) => adrWith(root, '- **Status:** Accepted'));
greenProbe('8. the Russian label of the status line is green', (root) => adrWith(root, `- **${msg('ru', 'Status')}:** Accepted (2026-09-01)`));
greenProbe('8. a status line inside a code block does not count, the one after it does', (root) => put(root, ADR,
  '# ADR-001: Process\n\n```\n**Status:** Superseded\n```\n\n**Status:** Accepted\n'));
greenProbe('8. a prose link to an ADR is not a second row', (root) => put(root, 'docs/README.md', `${read(root, 'docs/README.md')}\nSee [the process ADR](adr/adr-001-process.md).\n`));

const adrTable = (header, cell) => (root) => put(root, 'docs/README.md', `${read(root, 'docs/README.md').replace(/^\| \[adr\/.*\n/m, '')}
| ADR | ${header} |
|---|---|
| [adr/adr-001-process.md](adr/adr-001-process.md) | ${cell} |
`);
greenProbe('8. an index table without a Status column is not compared', adrTable('Topic', 'Whatever'));
greenProbe('8. a bold Russian Status header is read, and a matching cell is green', adrTable(`**${msg('ru', 'Status')}**`, 'Accepted'));
adrProbe('a bold Russian Status header with a differing cell is refused', adrTable(`**${msg('ru', 'Status')}**`, 'Proposed'),
  () => `docs/README.md: ${msg('ru', 'line {line}: the Status cell “{cell}” of {adr} differs from its status line “{status}” — write the word of the file', {
    line: 9, cell: 'Proposed', adr: ADR, status: 'Accepted',
  })}`);
greenProbe('8. a status line naming the ADR itself is not a chain', (root) => adrWith(root, '**Status:** Accepted (ADR-001, revised 2026-09-01)'));

test('lint: 8. an English project names the status errors in English', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    put(root, 'backslop.json', `${JSON.stringify({ ...JSON.parse(read(root, 'backslop.json')), lang: 'en' }, null, 2)}\n`);
    adrWith(root, '**Status:** Superseded by ADR-002');
    const found = problems(root);
    const expected = `${ADR}: line 3: “**Status:** Superseded by ADR-002” — an ADR holds a current decision, Proposed or Accepted; `
      + 'fold the decision into the ADR that governs the question now, then delete the replaced file';
    assert.ok(found.includes(expected), found.join(' | '));
  } finally {
    cleanup(root);
  }
});

// 15. Documentation without the tracker: three classes inside the set, gate 6 outside it.
const OUTLIVES = 'documentation outlives the task record; write the contract, the rationale, or the measurement itself with its version and date';
const TASK_ID = `line {line}: task id {token} — ${OUTLIVES}`;
const TRACKER_LINK = `line {line}: tracker link {token} — ${OUTLIVES}`;
const TRACKER_URL = `line {line}: tracker URL {token} into this repository — ${OUTLIVES}`;
const gate15 = (file, key, line, token) => `${file}: ${msg('ru', key, { line, token })}`;
const exactly = (text) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

probe('15. a task id in prose of the reference', (root) => put(root, 'docs/reference/README.md', '# Reference\n\nDecided in BS-2.\n'),
  exactly(gate15('docs/reference/README.md', TASK_ID, 3, 'BS-2')));
probe('15. a task id inside a fenced block of an ADR', (root) => put(root, 'docs/adr/adr-001-process.md', '# ADR-001: Process\n\n**Status:** Accepted\n\n```\nBS-1.2\n```\n'),
  exactly(gate15('docs/adr/adr-001-process.md', TASK_ID, 6, 'BS-1.2')));
probe('15. a task id in the root README', (root) => put(root, 'README.md', 'See [docs](docs/README.md), from `BS-007`.\n'),
  exactly(gate15('README.md', TASK_ID, 1, 'BS-007')));
greenProbe('15. a placeholder <prefix>-N is no task id', (root) => put(root, 'docs/note.md', 'A card is `<prefix>-N` or BS-N; see [docs](README.md).\n'));

probe('15. a link to a journal line is a tracker link', (root) => put(root, 'docs/note.md', '[closed](archive/LOG.md#bs-4)\n'),
  exactly(gate15('docs/note.md', TRACKER_LINK, 1, 'archive/LOG.md#bs-4')));
probe('15. a reference declaration into a status directory is a tracker link', (root) => put(root, 'docs/note.md', 'See [the queue][q].\n\n[q]: backlog/queue/BS-1-a.md\n'),
  exactly(gate15('docs/note.md', TRACKER_LINK, 3, 'backlog/queue/BS-1-a.md')));
greenProbe('15. the backlog rules file is linkable, with a fragment too', (root) => put(root, 'docs/note.md', '[rules](backlog/README.md) [part](backlog/README.md#backlog)\n'));
greenProbe('15. the archive rules file is linkable', (root) => {
  put(root, 'docs/archive/README.md', '# Archive\n');
  put(root, 'docs/note.md', '[rules](archive/README.md)\n');
});

probe('15. the unreleased CHANGELOG section is documentation', (root) => put(root, 'CHANGELOG.md', '## Unreleased\n\n- **One** — BS-1\n\n## v0.1.0\n\n- **One** — BS-4\n'),
  exactly(gate15('CHANGELOG.md', TASK_ID, 3, 'BS-1')));
greenProbe('15. a released CHANGELOG section stays with gate 6 and a known task is green there', (root) => put(root, 'CHANGELOG.md', '## Unreleased\n\n- **One** — new\n\n## v0.1.0\n\n- **One** — BS-1\n'));
test('lint: 15. at the CHANGELOG boundary each mention is reported once, by its own gate', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    put(root, 'CHANGELOG.md', '## Unreleased\n\n- **One** — BS-98\n\n## v0.1.0\n\n- **One** — BS-99\n');
    assert.deepEqual(problems(root), [
      `CHANGELOG.md: ${msg('ru', 'mentions {id}, but no task file exists in statuses or archive', { id: 'BS-99' })}`,
      gate15('CHANGELOG.md', TASK_ID, 3, 'BS-98'),
    ]);
  } finally {
    cleanup(root);
  }
});

// Class 3 needs a repository: an origin for the URL.
function gitGreen(origin) {
  const root = makeProject();
  seedGreen(root);
  if (origin) run(root, ['remote', 'add', 'origin', origin]);
  gitAll(root, 'green');
  return root;
}

for (const [form, origin, url] of [
  ['GitHub https', 'https://github.com/Owner/Proj.git', 'https://github.com/owner/proj/blob/release/1.0/docs/archive/LOG.md#bs-4'],
  ['GitLab scp', 'git@gitlab.example.com:group/sub/proj.git', 'https://gitlab.example.com/group/sub/proj/-/tree/main/docs/backlog/queue'],
]) {
  test(`lint: 15. a URL into this repository's tracker is refused, origin in the ${form} form`, () => {
    const root = gitGreen(origin);
    try {
      put(root, 'docs/note.md', `Measured [there](${url}); the tool itself: https://github.com/other/proj/blob/main/docs/archive/LOG.md\n`);
      assert.deepEqual(problems(root), [gate15('docs/note.md', TRACKER_URL, 1, url)]);
    } finally {
      cleanup(root);
    }
  });
}

test('lint: 15. without an origin remote the URL class is skipped with a note on stdout', () => {
  const root = gitGreen(null);
  try {
    put(root, 'docs/note.md', 'See https://github.com/owner/proj/blob/main/docs/archive/LOG.md\n');
    assert.deepEqual(problems(root), []);
    const r = cli(root, ['lint']);
    assert.equal(r.code, 0, r.err);
    assert.ok(r.out.includes(msg('ru', 'gate 15: no origin remote — tracker URLs into this repository were not checked')), r.out);
    assert.equal(r.err, '');
  } finally {
    cleanup(root);
  }
});

test('lint: 15. a documented output or config location is not judged, tracked or not', () => {
  const root = gitGreen('https://github.com/owner/proj.git');
  try {
    put(root, 'docs/note.md', [
      'Coverage goes to `coverage/coverage-final.json` and the log to `logs/app.log`;',
      'see also `dist/stats.json` and `.vscode/settings.json`.',
      '',
    ].join('\n'));
    assert.deepEqual(problems(root), []);
  } finally {
    cleanup(root);
  }
});

test('lint: 15. an English project names the class and the token in English', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    put(root, 'backslop.json', `${JSON.stringify({ ...JSON.parse(read(root, 'backslop.json')), lang: 'en' }, null, 2)}\n`);
    put(root, 'docs/note.md', 'From BS-2: [card](backlog/active/BS-2-b.md)\n');
    assert.deepEqual(problems(root), [
      `docs/note.md: line 1: task id BS-2 — ${OUTLIVES}`,
      `docs/note.md: line 1: tracker link backlog/active/BS-2-b.md — ${OUTLIVES}`,
    ]);
  } finally {
    cleanup(root);
  }
});

for (const lang of ['en', 'ru']) {
  test(`lint: 15. a fresh init --lang ${lang} project is green`, () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'backslop-fresh-'));
    try {
      run(root, ['init', '-q', '-b', 'main']);
      assert.equal(cli(root, ['init', '--lang', lang, '--tools', 'none']).code, 0);
      const r = cli(root, ['lint']);
      assert.equal(r.code, 0, r.err);
    } finally {
      cleanup(root);
    }
  });
}

test('lint: 15. an unknown id in prose of the set is reported by gate 15 alone, not by gate 6', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    put(root, 'docs/reference/README.md', `${read(root, 'docs/reference/README.md')}\nDecided in BS-99.\n`);
    assert.deepEqual(problems(root), [gate15('docs/reference/README.md', TASK_ID, 11, 'BS-99')]);
  } finally {
    cleanup(root);
  }
});

const gate6Changelog = () => `CHANGELOG.md: ${msg('ru', 'mentions {id}, but no task file exists in statuses or archive', { id: 'BS-99' })}`;
for (const [name, text, tag, expected] of [
  ['a versioned top CHANGELOG section with its tag is released and stays with gate 6',
    '## v0.2.0 — 2026-10-01\n\n- **One** — BS-99\n', true, () => gate6Changelog()],
  ['a versioned top CHANGELOG section is released in a clone without its tag, and stays with gate 6',
    '## v0.2.0 — 2026-10-01\n\n- **One** — BS-99\n', false, () => gate6Changelog()],
  ['the same top CHANGELOG section titled Unreleased goes to gate 15 in a clone without tags',
    '## Unreleased\n\n- **One** — BS-99\n', false, () => gate15('CHANGELOG.md', TASK_ID, 3, 'BS-99')],
  ['a CHANGELOG section titled Unreleased with a version later in its title is the unreleased one',
    '## Unreleased (after v0.1.0)\n\n- **One** — BS-99\n', false, () => gate15('CHANGELOG.md', TASK_ID, 3, 'BS-99')],
  ['the unversioned CHANGELOG section below a versioned one is the unreleased one',
    '## v0.2.0 — 2026-10-01\n\n- **One** — BS-1\n\n## Unreleased\n\n- **Two** — BS-99\n', false,
    () => gate15('CHANGELOG.md', TASK_ID, 7, 'BS-99')],
]) {
  test(`lint: 15. ${name}`, () => {
    const root = gitGreen(null);
    try {
      put(root, 'CHANGELOG.md', text);
      gitAll(root, 'changelog');
      if (tag) run(root, ['tag', 'v0.2.0']);
      assert.deepEqual(problems(root), [expected()]);
    } finally {
      cleanup(root);
    }
  });
}

test('lint: 15. a blob URL path is read after a local ref, so a nested backlog/ is no tracker', () => {
  const root = gitGreen('https://github.com/owner/proj.git');
  try {
    put(root, 'docs/note.md', 'See https://github.com/owner/proj/blob/main/examples/docs/backlog/x.md\n');
    assert.deepEqual(problems(root), []);
  } finally {
    cleanup(root);
  }
});

for (const [kind, refOf] of [
  ['a commit sha', (root) => run(root, ['rev-parse', 'HEAD']).stdout.trim()],
  ['a tag', (root) => (run(root, ['tag', 'v1.0']), 'v1.0')],
  ['a remote branch', (root) => (run(root, ['update-ref', 'refs/remotes/origin/release/2.0', 'HEAD']), 'release/2.0')],
]) {
  test(`lint: 15. a blob URL ref that is ${kind} is read before the path, so a nested backlog/ is no tracker`, () => {
    const root = gitGreen('https://github.com/owner/proj.git');
    try {
      const url = `https://github.com/owner/proj/blob/${refOf(root)}/examples/docs/backlog/x.md`;
      put(root, 'docs/note.md', `See ${url}\n`);
      assert.deepEqual(problems(root), []);
    } finally {
      cleanup(root);
    }
  });
}

test('lint: 1. a link whose target differs only in Unicode normalization is an error on any filesystem', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    put(root, 'backslop.json', '{"prefix":"BS","docs":"docs","gates":[],"lang":"en","tools":[]}\n');
    put(root, 'docs/café.md', '# Cafe\n');
    put(root, 'docs/naïve.md', '# Naive\n');
    put(root, 'docs/note-a.md', '[c](café.md)\n');
    put(root, 'docs/note-b.md', '[n](naïve.md)\n');
    const r = cli(root, ['lint']);
    assert.equal(r.code, 1);
    assert.match(r.err, /docs\/note-a\.md: link target differs in Unicode normalization: docs\/café\.md \(link café\.md, line 1\)/);
    assert.match(r.err, /docs\/note-b\.md: link target differs in Unicode normalization: docs\/naïve\.md \(link naïve\.md, line 1\)/);
    assert.match(r.err, /lint: errors 2\b/);
  } finally {
    cleanup(root);
  }
});

test('lint: 7. an entry title holds a literal ** inside a code span and is compared whole', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    const entry = (name) => `- **\`when\`: \`**/\` ${name}** — text\n`;
    put(root, 'CHANGELOG.md', `## Unreleased\n\n${entry('one')}${entry('two')}`);
    assert.deepEqual(problems(root), []);
    put(root, 'CHANGELOG.md', `## Unreleased\n\n${entry('one')}${entry('one')}`);
    assert.deepEqual(problems(root), [errLine('CHANGELOG.md', DUP_ENTRY, { line: 4, title: '`when`: `**/` one', section: 'Unreleased', prev: 3 })]);
  } finally {
    cleanup(root);
  }
});

test('lint: 11. a pin with a pre-release tail in README is reported whole; other suffixes are not read', () => {
  let project;
  try {
    project = toolProject((dir) => put(dir, 'README.md', [
      'Try `npx github:Velklish/backslop#v0.1.0-rc.1`, `npx github:Velklish/backslop#v0.1.0x` or `npx backslop@0.1.0.1`;',
      'install `npx backslop@0.2.0`, `npx backslop@0.3.0-beta.2` or `npx backslop@0.3.0-rc-1`.',
      '',
    ].join('\n')));
    assert.equal(project.code, 1, project.out);
    assert.equal(project.err.match(new RegExp(ruRe(PIN_TOOL).source, 'g')).length, 4, project.err);
    for (const [line, pin] of [[1, 'github:Velklish/backslop#v0.1.0-rc.1'], [2, 'backslop@0.2.0'], [2, 'backslop@0.3.0-beta.2'], [2, 'backslop@0.3.0-rc-1']]) {
      assert.match(project.err, errRe('README.md', PIN_TOOL, { line, pin, version: TOOL_VERSION }));
    }
  } finally { if (project) cleanup(project.dir); }
});

test('lint: 7. a long unclosed entry line with many backticks is read in linear time', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    put(root, 'CHANGELOG.md', `## Unreleased\n\n- **${'`a'.repeat(40)}\n`);
    const r = spawnSync(process.execPath, [path.join(REPO, 'bin', 'backslop.js'), 'lint'], { cwd: root, encoding: 'utf8', timeout: 10000 });
    assert.equal(r.error, undefined, 'lint did not finish in 10 s');
    assert.equal(r.status, 0, r.stderr);
  } finally {
    cleanup(root);
  }
});

test('lint: a status directory leading out of the project is reported by gate 3 alone: gates 2, 4 and 6 do not read behind it', { skip: process.platform === 'win32' }, () => {
  const root = makeProject({ git: false });
  const outside = mkdtempSync(path.join(os.tmpdir(), 'backslop-lint-outside-'));
  try {
    seedGreen(root);
    put(root, 'docs/backlog/active/BS-2-b.md', `${read(root, 'docs/backlog/active/BS-2-b.md')}\nDepends on BS-1.\n`);
    renameSync(path.join(root, 'docs/backlog/queue'), path.join(outside, 'queue'));
    put(outside, 'queue/notes.md', '# notes\n');
    put(outside, 'queue/BS-7-x.md', `${ruCard('BS-7', 'X')}\n[TODO]\n`);
    symlinkSync(path.join(outside, 'queue'), path.join(root, 'docs/backlog/queue'));
    assert.deepEqual(problems(root), [errLine('docs/backlog/queue', LINK_OUT)]);
  } finally {
    cleanup(root);
    rmSync(outside, { recursive: true, force: true });
  }
});

test('lint: a status directory leading out of the project is not read by gates 1, 10 and 13 either', { skip: process.platform === 'win32' }, () => {
  const root = makeProject({ git: false });
  const outside = mkdtempSync(path.join(os.tmpdir(), 'backslop-lint-outside-'));
  try {
    seedGreen(root);
    put(root, 'docs/archive/LOG.md', '# Archive log\n');
    renameSync(path.join(root, 'docs/backlog/queue'), path.join(outside, 'queue'));
    put(outside, 'queue/notes.md', [
      '[broken](nope.md)', '[journal](../../archive/LOG.md#bs-99)', '',
      '<!-- quote:../../reference/README.md -->', '```text', 'stale text', '```', '<!-- /quote -->', '',
    ].join('\n'));
    symlinkSync(path.join(outside, 'queue'), path.join(root, 'docs/backlog/queue'));
    assert.deepEqual(problems(root), [errLine('docs/backlog/queue', LINK_OUT)]);
    const r = cli(root, ['lint']);
    assert.equal(r.code, 1);
    assert.doesNotMatch(r.err, /nope\.md|bs-99|stale text/);
  } finally {
    cleanup(root);
    rmSync(outside, { recursive: true, force: true });
  }
});

test('lint: the outputs of a vendored skill that init skipped for a foreign LICENSE are not called missing', () => {
  const root = makeProject({ git: false });
  try {
    seedGreen(root);
    put(root, '.cursor/rules/backslop-techdoc/LICENSE', 'mine\n');
    assert.equal(cli(root, ['init', '--tools', 'cursor']).code, 0);
    const found = problems(root);
    assert.equal(found.length, 1, found.join(' | '));
    assert.match(found[0], errRe('LICENSE', 'a foreign file without the {marker} marker sits at the {tool} adapter output path — init does not overwrite it: remove or rename the file and run {cli} init, or deselect the adapter'));
  } finally {
    cleanup(root);
  }
});
