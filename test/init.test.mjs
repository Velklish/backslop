// init and the end-to-end cycle: layout → lint → new → mv → archive → lint; a repeated init
// breaks nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { PROBE_WORDS, REPO, cleanup, cli, escapeRe, put, read, ru, ruCard, ruLineRe, ruOutcome, ruRe, ruResult, ruTemplate, ruTemplateLines, ruTextRe, ruTwinLine, toolCli, toolCopy, FIELD } from './helpers.mjs';
import { RU } from '../lib/i18n.js';
import { isOwnedAdapterFile } from '../lib/adapter-ownership.js';
import { TOOL_VERSION } from '../lib/version.js';
import { srcFiles } from '../lib/mdwalk.js';
import { frontmatterField } from '../lib/frontmatter.js';

const CYRILLIC = /\p{Script=Cyrillic}/u;
const MARKERS = '{label} must not contain the backslop:start or backslop:end markers: it sits inside the block, and a marker there would copy a block boundary into the block text';
const BACKTICK = '{label} must not contain a backtick: the template puts it in a code span, and a backtick inside closes it';
const FOREIGN_LINK = '{message} — backslop neither writes nor removes files through a foreign link. Replace the harness root with a plain directory or deselect the {tool} adapter: --tools without it, or --tools none if no other adapters are selected';
const NOT_OVERWRITTEN = 'files without the {marker} marker sit at adapter output paths and were not overwritten: {foreign}; the backslop skill is not installed there — remove or rename the file and rerun init, or deselect the adapter';
const LEFT_AS_IS = 'files without the {marker} marker sit at adapter output paths and were left as is: {foreign}';
const MEASUREMENTS = '.claude/skills/backslop-batch/references/measurements.md';

// The Russian side of the owner-talk checks, read from the Russian templates: the item label, its
// sentences, and the phrase the skills use to point at it.
const OWNER_TWIN = ruTwinLine('agents-section.md', 'Talking to the owner.');
const OWNER_LABEL = OWNER_TWIN.match(/^\*\*([^*]+?)\.?\*\*/)[1];
const OWNER_BATCH_LINE = ruTemplateLines('skills/backslop-batch/SKILL.md').find((line) => line.includes(`«${OWNER_LABEL}»`));
const OWNER_AT = OWNER_BATCH_LINE.indexOf(`«${OWNER_LABEL}»`);
const OWNER_RU = {
  item: OWNER_TWIN.match(/^\*\*[^*]+\*\*/)[0],
  rule: OWNER_TWIN.replace(/^\*\*[^*]+\*\*\s*/, '').split(/(?<=\.)\s+/).map((sentence) => ruTextRe(sentence, { prefix: 'BS' })),
  link: OWNER_BATCH_LINE.slice(OWNER_BATCH_LINE.lastIndexOf(' ', OWNER_AT - 2) + 1, OWNER_BATCH_LINE.indexOf('AGENTS.md', OWNER_AT) + 'AGENTS.md'.length),
};

// Block sentences the Russian skill must not restate: the first sentence of steps 2, 3 and 6.
const SKILL_RESTATES_RU = new RegExp(['Reverse a previous decision by clean removal', 'An undocumented change is incomplete', 'has a named next step']
  .map((anchor) => ruTextRe(ruTwinLine('agents-section.md', anchor).replace(/^\d+\. \*\*[^*]+\*\*\s*/, '').split(/(?<=\.)\s+/)[0], { docs: 'docs' }).source)
  .join('|'));

// The Russian probe text, read from the Russian templates.
const RU_SKILL = ruTemplateLines('skills/backslop-task/SKILL.md').join('\n');
const PROBE_RU = {
  named: ruTemplate('agents-probe.md', { probe: 'npm run probe' }).trim().split(': ')[1],
  duty: new RegExp(escapeRe(ruTemplate('agents-probe.md', { probe: 'x' }).split(':')[0])),
  afterBreakage: RU_SKILL.split('{{probeManual}} ')[1].split(':')[0],
  verified: (() => {
    const [, before, after] = RU_SKILL.match(/(\S+ \S+)\{\{probeVerified\}\}(\S* \S+ \S+)/);
    return `${before}${ruTemplate('probe/verified.md').trim()}${after}`;
  })(),
  none: PROBE_WORDS,
};

function emptyRepo() {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-init-')));
  spawnSync('git', ['-C', root, 'init', '-q', '-b', 'main']);
  spawnSync('git', ['-C', root, 'config', 'user.email', 'test@example.com']);
  spawnSync('git', ['-C', root, 'config', 'user.name', 'test']);
  return root;
}

const EXPECTED = [
  'backslop.json', 'AGENTS.md',
  'docs/README.md', 'docs/GLOSSARY.md', 'docs/ROLES.md', 'docs/reference/README.md',
  'docs/adr/adr-001-process.md', 'docs/backlog/README.md', 'docs/archive/README.md',
  'docs/backlog/triage/.gitkeep', 'docs/backlog/queue/.gitkeep', 'docs/backlog/active/.gitkeep', 'docs/backlog/deferred/.gitkeep', 'docs/backlog/minor/.gitkeep',
];

test('init: a ROLES.md of the project\'s own is kept and named in a warning, backslop\'s own is not', () => {
  const root = emptyRepo();
  try {
    writeFileSync(path.join(root, 'package.json'), '{ "name": "demo" }\n');
    mkdirSync(path.join(root, 'docs'));
    writeFileSync(path.join(root, 'docs', 'ROLES.md'), '# Our roles\n\nWho signs off a release.\n');
    let r = cli(root, ['init', '--lang', 'en']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.err, /docs\/ROLES\.md: a file of your own sits where backslop lays its roles document, and the block and the backlog README point to it — rename it, fix the links to it and run .* init/);
    assert.equal(readFileSync(path.join(root, 'docs', 'ROLES.md'), 'utf8'), '# Our roles\n\nWho signs off a release.\n', 'the file is untouched');
    renameSync(path.join(root, 'docs', 'ROLES.md'), path.join(root, 'docs', 'OUR-ROLES.md'));
    r = cli(root, ['init']);
    assert.equal(r.code, 0, r.err);
    assert.doesNotMatch(r.err, /roles document/, 'a file laid by init is backslop\'s own');
    assert.match(readFileSync(path.join(root, 'docs', 'ROLES.md'), 'utf8'), /^# Roles\n/, 'the rename and init lay backslop\'s file');
    assert.equal(cli(root, ['migrate']).code, 0);
    assert.equal(cli(root, ['lint']).code, 0, 'the advice of the warning ends in a green lint');
    assert.match(readFileSync(path.join(root, 'docs', 'OUR-ROLES.md'), 'utf8'), /Who signs off a release/, 'the renamed file is kept');
  } finally {
    cleanup(root);
  }
});

test('init: layout, lint green, an end-to-end task cycle, a repeated init is idempotent', () => {
  const root = emptyRepo();
  try {
    writeFileSync(path.join(root, 'package.json'), '{ "name": "@me/demo-app" }\n');
    let r = cli(root, ['init']);
    assert.equal(r.code, 0, r.err);
    for (const rel of EXPECTED) assert.ok(existsSync(path.join(root, rel)), `no ${rel}`);
    assert.ok(!existsSync(path.join(root, 'docs/ROADMAP.md')), 'init laid down docs/ROADMAP.md');
    const cfg = JSON.parse(read(root, 'backslop.json'));
    assert.deepEqual(cfg, {
      prefix: 'BS', docs: 'docs', cli: `npx github:Velklish/backslop#v${TOOL_VERSION}`,
      gates: [`npx github:Velklish/backslop#v${TOOL_VERSION} lint`], version: TOOL_VERSION,
      lang: 'ru', tools: [],
    });
    assert.match(read(root, 'docs/README.md'), new RegExp(`^${ruLineRe('docs/README.md', 'documentation', { project: 'demo-app' }).source}\\n`));
    assert.match(read(root, 'docs/adr/adr-001-process.md'), /\*\*Date:\*\* \d{4}-\d{2}-\d{2}\n/);
    assert.doesNotMatch(read(root, 'docs/backlog/README.md'), /\{\{/);
    assert.ok(!existsSync(path.join(root, 'CLAUDE.md')));
    assert.ok(!existsSync(path.join(root, '.claude/skills/backslop-task/SKILL.md')));
    const agents = read(root, 'AGENTS.md');
    assert.equal((agents.match(/<!-- backslop:start -->/g) ?? []).length, 1);
    assert.match(agents, /npx github:Velklish\/backslop#v\d+\.\d+\.\d+ status/);
    assert.match(agents, ruLineRe('agents-section.md', 'Skills (when an adapter is selected)'));

    r = cli(root, ['lint']);
    assert.equal(r.code, 0, r.err + r.out);

    r = cli(root, ['status']);
    assert.match(r.out, new RegExp(`${ru('Queue')} \\(0\\)`));
    r = cli(root, ['new', 'first-task', '--queue', '--title', 'First task']);
    assert.equal(r.code, 0, r.err);
    r = cli(root, ['mv', '1', 'active']);
    assert.equal(r.code, 0, r.err);
    spawnSync('git', ['-C', root, 'add', '-A']);
    spawnSync('git', ['-C', root, 'commit', '-qm', 'seed']);
    r = cli(root, ['archive', '1']);
    assert.equal(r.code, 0, r.err);
    r = cli(root, ['lint']);
    assert.equal(r.code, 1, 'a result.md with [TODO] keeps lint red');
    assert.match(r.err, ruRe('result is incomplete: [TODO] remains'));
    put(root, 'docs/archive/BS-1-first-task/result.md', ruResult('BS-1', '2026-09-03', `${ruOutcome('completed')}.`));
    r = cli(root, ['lint']);
    assert.equal(r.code, 0, r.err);

    // A repeat: docs untouched, the config the same, the block replaced with the same text.
    const agentsBefore = read(root, 'AGENTS.md');
    put(root, 'docs/GLOSSARY.md', '# My glossary\n');
    put(root, 'docs/backlog/README.md', '# My tracking rules\n');
    put(root, 'AGENTS.md', `# Project header\n\n${agentsBefore.replace('<!-- backslop:start -->', '<!-- backslop:start -->\nSPOILED')}`);
    r = cli(root, ['init']);
    assert.equal(r.code, 0, r.err);
    assert.equal(read(root, 'docs/GLOSSARY.md'), '# My glossary\n', 'docs are not overwritten');
    assert.equal(read(root, 'docs/backlog/README.md'), '# My tracking rules\n', 'the tracking rules are redrawn by migrate, not by init');
    const agentsAfter = read(root, 'AGENTS.md');
    assert.equal(agentsAfter, `# Project header\n\n${agentsBefore}`, 'the block is replaced between the markers, the header is kept');
    assert.equal((agentsAfter.match(/<!-- backslop:end -->/g) ?? []).length, 1);
    assert.match(r.out, ruRe('init: {docs}/ (prefix {prefix}), files created {created}, left unchanged {skipped}'));
  } finally {
    cleanup(root);
  }
});

test('init: a BOM-prefixed package.json gives its name to docs/README.md', () => {
  const root = emptyRepo();
  try {
    writeFileSync(path.join(root, 'package.json'), '\uFEFF{"name":"foo-pkg","scripts":{"test":"node t.js"}}\n');
    const r = cli(root, ['init', '--tools', 'none', '--lang', 'en']);
    assert.equal(r.code, 0, r.err);
    assert.match(read(root, 'docs/README.md'), /^# foo-pkg documentation\n/);
  } finally {
    cleanup(root);
  }
});

// The first init does not call loadConfig, and a marker in `--cli` or `--dir` is caught by its
// own check — before the first write. The check is shared: a class of fields, not one.
test('init: --cli with a block marker — a refusal before the first write', () => {
  for (const [flag, value, why] of [
    ['--cli', 'node bin/backslop.js <!-- backslop:end -->', new RegExp(`^✖ --cli must not contain the backslop:start or backslop:end markers: .* \\/ ${ruRe(MARKERS, { label: '--cli' }).source}`, 'm')],
    ['--dir', 'docs <!-- backslop:end -->', new RegExp(`^✖ --dir must not contain the backslop:start or backslop:end markers: .* \\/ ${ruRe(MARKERS, { label: '--dir' }).source}`, 'm')],
    ['--dir', 'docs`', new RegExp(`^✖ --dir must not contain a backtick: .* \\/ ${ruRe(BACKTICK, { label: '--dir' }).source}`, 'm')],
  ]) {
    const root = emptyRepo();
    try {
      const r = cli(root, ['init', flag, value]);
      assert.equal(r.code, 1, `${flag} “${value}”: a refusal was expected`);
      assert.match(r.err, why);
      assert.equal(existsSync(path.join(root, 'backslop.json')), false, 'the config is not written');
      assert.equal(existsSync(path.join(root, 'AGENTS.md')), false, 'the block is not written');
    } finally {
      cleanup(root);
    }
  }
});

test('init refuses --cli and --dir values that later commands would refuse, before any write', () => {
  for (const args of [['--cli', ''], ['--cli', '  '], ['--dir', '../x'], ['--dir', 'a\\..\\b'], ['--dir', 'docs/../x'], ['--dir', 'C:\\x'], ['--dir', 'C:/x'], ['--dir', '\\\\server\\x']]) {
    const root = emptyRepo();
    try {
      const r = cli(root, ['init', '--lang', 'en', '--tools', 'none', ...args]);
      assert.equal(r.code, 1, `${args.join(' ')}: ${r.out}`);
      assert.match(r.err, /^✖ (--cli must be a non-empty command string|--dir “.*”: expected a relative path inside the project)$/m, args.join(' '));
      assert.doesNotMatch(r.err, /\n\s+at /, `${args.join(' ')}: a stack`);
      assert.equal(existsSync(path.join(root, 'backslop.json')), false, `${args.join(' ')}: the config was written`);
      assert.equal(existsSync(path.join(root, 'AGENTS.md')), false, `${args.join(' ')}: the block was written`);
    } finally {
      cleanup(root);
    }
  }
});

test('init --dir with ".." inside a name passes init and every later command', () => {
  for (const dir of ['my..docs', 'docs..v2']) {
    const root = emptyRepo();
    try {
      let r = cli(root, ['init', '--dir', dir, '--tools', 'none', '--lang', 'en']);
      assert.equal(r.code, 0, r.err);
      assert.equal(JSON.parse(read(root, 'backslop.json')).docs, dir);
      r = cli(root, ['lint']);
      assert.equal(r.code, 0, `${dir}: ${r.err}`);
      r = cli(root, ['init']);
      assert.equal(r.code, 0, `${dir}: ${r.err}`);
    } finally {
      cleanup(root);
    }
  }
});

test('init: agents.stepOverrides replaces a step in the RU and EN block and survives a repeat', () => {
  for (const [lang, override, escaped, oldStep] of [
    ['ru', 'Run gates with `npm run probe` and keep the tree snapshot.', 'Run gates with \\`npm run probe\\` and keep the tree snapshot\\.', ruTextRe(ruTemplateLines('agents-section.md').find((line) => line.startsWith('4. **')).match(/^4\. \*\*[^*]*?\./)[0])],
    ['en', 'Run gates with `npm run probe` and keep the tree snapshot.', 'Run gates with \\`npm run probe\\` and keep the tree snapshot\\.', /4\. \*\*Gates before reporting\./],
  ]) {
    const root = emptyRepo();
    try {
      let r = cli(root, ['init', '--lang', lang]);
      assert.equal(r.code, 0, r.err);
      const cfg = JSON.parse(read(root, 'backslop.json'));
      put(root, 'backslop.json', `${JSON.stringify({ ...cfg, agents: { stepOverrides: { '4': override } } }, null, 2)}\n`);

      r = cli(root, ['init']);
      assert.equal(r.code, 0, r.err);
      const generated = read(root, 'AGENTS.md');
      assert.ok(generated.includes(`4. ${escaped}`), `${lang}: the value is substituted as escaped text`);
      assert.doesNotMatch(generated, oldStep);

      r = cli(root, ['init']);
      assert.equal(r.code, 0, r.err);
      assert.equal(read(root, 'AGENTS.md'), generated, `${lang}: a repeated init does not lose the override`);
    } finally {
      cleanup(root);
    }
  }
});

test('init: an override value stays text — no link definition opens, and brackets without one pass', () => {
  const root = emptyRepo();
  try {
    let r = cli(root, ['init']);
    assert.equal(r.code, 0, r.err);
    const cfg = JSON.parse(read(root, 'backslop.json'));
    // The link target outside the block: an override inside the block must not shift it.
    put(root, 'AGENTS.md', `# Project\n\nThe policy is described in [policy].\n\n[policy]: /original\n\n${read(root, 'AGENTS.md')}`);
    put(root, 'backslop.json', `${JSON.stringify({ ...cfg, agents: { stepOverrides: { '4': '[policy]: /changed', '5': '[policy]', '6': 'see the [gates] table and the gates field' } } }, null, 2)}\n`);

    r = cli(root, ['init']);
    assert.equal(r.code, 0, r.err);
    const agents = read(root, 'AGENTS.md');
    const block = agents.slice(agents.indexOf('<!-- backslop:start -->'), agents.indexOf('<!-- backslop:end -->'));
    assert.match(block, /^4\. \\\[policy\\\]\\: \\\/changed$/m, 'the step text stayed visible text');
    assert.match(block, /^5\. \\\[policy\\\]$/m, 'the neighbouring step did not become a link');
    assert.match(block, /^6\. see the \\\[gates\\\] table and the gates field$/m, 'brackets without a definition stay escaped text');
    // A list item marker is not part of the block, so it is stripped before the check: otherwise
    // the check would look at lines that never start with "[".
    const defs = agents.split('\n')
      .map((l) => l.replace(/^ {0,3}(?:[-*+]|\d{1,9}[.)]) +/, ''))
      .filter((l) => /^ {0,3}\[[^\]\\]*\]:/.test(l));
    assert.deepEqual(defs, ['[policy]: /original'], 'no link definition appeared in the block, the outer one did not change');
  } finally {
    cleanup(root);
  }
});

test('init refuses a stepOverrides value with a line break or a block marker and leaves AGENTS.md unchanged', () => {
  const root = emptyRepo();
  try {
    let r = cli(root, ['init']);
    assert.equal(r.code, 0, r.err);
    const cfg = JSON.parse(read(root, 'backslop.json'));
    const before = read(root, 'AGENTS.md');
    for (const [override, why] of [
      ['own text\n5. false step', ruRe('{label} must be a single-line value without line breaks: a second line becomes a separate paragraph inside the block')],
      ['own text <!-- backslop:end -->', ruRe('{config}: agents.stepOverrides[{step}] — inline text without markup: the “<” character is not allowed')],
    ]) {
      put(root, 'backslop.json', `${JSON.stringify({ ...cfg, agents: { stepOverrides: { '4': override } } }, null, 2)}\n`);
      r = cli(root, ['init']);
      assert.equal(r.code, 1, JSON.stringify(override));
      assert.match(r.err, why);
      assert.equal(read(root, 'AGENTS.md'), before, `${JSON.stringify(override)}: the refusal changed AGENTS.md`);
    }
  } finally {
    cleanup(root);
  }
});


test('init: the block tells a worker to commit, names the triage commit and the boundary bans, and has one commit subject', () => {
  for (const [lang, step4, step7, boundary, oldSubject] of [
    ['ru', ruLineRe('agents-section.md', 'nothing stays uncommitted.', { prefix: 'BS' }),
      ruLineRe('agents-section.md', 'a separate commit with the subject', { prefix: 'BS' }),
      ruLineRe('agents-section.md', 'Worker boundaries:', { prefix: 'BS' }), new RegExp(`${RU.parserWords.closed} —`)],
    ['en', /^4\. .*Commit to your branch with the `BS-N:` prefix before reporting; nothing stays uncommitted\./m,
      /^7\. .*a separate commit with the subject `BS: triage after BS-N`.*`[^`]+ lint` is green on the final commit; then push\.$/m,
      /^Worker boundaries: .*only with `[^`]+ new`; never edit, move or archive an existing task file \(no `mv`, no `archive`\); do not touch `docs\/archive\/`;/m, /closed —/],
  ]) {
    const root = emptyRepo();
    try {
      const r = cli(root, ['init', '--lang', lang]);
      assert.equal(r.code, 0, r.err);
      const agents = read(root, 'AGENTS.md');
      const block = agents.slice(agents.indexOf('<!-- backslop:start -->'), agents.indexOf('<!-- backslop:end -->'));
      assert.match(block, step4, `${lang}: step 4 tells the worker to commit`);
      assert.match(block, step7, `${lang}: step 7 names the triage commit, lint and push`);
      assert.match(block, boundary, `${lang}: the boundary line names new, the edit/move/archive ban and archive/`);
      assert.doesNotMatch(block, oldSubject, `${lang}: one commit subject form`);
    } finally {
      cleanup(root);
    }
  }
});

test('init: the block names gates --base and the Windows shell, and the skill points to the block instead of restating it', () => {
  for (const [lang, base, windows, gone, keepGoing, skillWindows] of [
    ['ru', ruLineRe('agents-section.md', '--require-clean --base <base>'), ruLineRe('agents-section.md', 'On Windows, run this recipe in Git Bash.'),
      SKILL_RESTATES_RU, /`--keep-going`/, ruLineRe('skills/backslop-task/SKILL.md', 'On Windows, run this recipe in Git Bash.')],
    ['en', /^4\. .*`[^`]+ gates --require-clean --base <base>`, where `<base>` is the commit before the task was taken/m, /^5\. .*On Windows, run this recipe in Git Bash\.$/m,
      /Real failures|simply called|three tasks/, /`--keep-going`/, /On Windows, run this recipe in Git Bash\./],
  ]) {
    const root = emptyRepo();
    try {
      const r = cli(root, ['init', '--lang', lang, '--tools', 'claude']);
      assert.equal(r.code, 0, r.err);
      const agents = read(root, 'AGENTS.md');
      const block = agents.slice(agents.indexOf('<!-- backslop:start -->'), agents.indexOf('<!-- backslop:end -->'));
      assert.match(block, base, `${lang}: step 4 names the --base invocation`);
      assert.match(block, windows, `${lang}: step 5 puts the Windows note after the draft recipe`);
      const skill = read(root, '.claude/skills/backslop-task/SKILL.md');
      assert.match(skill, keepGoing, `${lang}: the skill names --keep-going`);
      assert.match(skill, skillWindows, `${lang}: the skill carries the Windows note`);
      assert.doesNotMatch(skill, gone, `${lang}: no history section, no alias sentence`);
      assert.doesNotMatch(skill, /`backslop (?:status|mv|new|gates|archive|fold|lint|adr)[ `]/, `${lang}: every runnable command is spelled with the configured cli`);
    } finally {
      cleanup(root);
    }
  }
});

test('init: the block carries the owner-talk rule in full and each skill links to it without restating it', () => {
  for (const [lang, item, rule, link] of [
    ['ru', OWNER_RU.item, OWNER_RU.rule, OWNER_RU.link],
    ['en', '**Talking to the owner.**', [/what is asked, why, and what each answer changes/, /no term or abbreviation you coined yourself/i, /only after they confirm it/, /number and its title, `BS-N — <title>`, never by the number alone: the title goes at the first mention in a message, in every heading and in every table row; later mentions in the same paragraph may use the number alone/, /each list item counts as a paragraph\./],
      '*Talking to the owner* in the backslop section of AGENTS.md'],
  ]) {
    const root = emptyRepo();
    try {
      const r = cli(root, ['init', '--lang', lang, '--tools', 'claude']);
      assert.equal(r.code, 0, r.err);
      const agents = read(root, 'AGENTS.md');
      const block = agents.slice(agents.indexOf('<!-- backslop:start -->'), agents.indexOf('<!-- backslop:end -->'));
      assert.ok(block.includes(item), `${lang}: the block has the owner-talk item`);
      for (const re of rule) assert.match(block, re, `${lang}: the item states ${re}`);
      for (const [file, links] of [['backslop-task/SKILL.md', 2], ['backslop-batch/SKILL.md', 2], ['backslop-seed/SKILL.md', 4], ['backslop-seed/references/adr-backfill.md', 3], ['backslop-seed/references/glossary.md', 1]]) {
        const text = read(root, `.claude/skills/${file}`);
        assert.equal(text.split(link).length - 1, links, `${lang}: ${file} links to the owner-talk item at each owner-facing line`);
        for (const re of rule) assert.doesNotMatch(text, re, `${lang}: ${file} does not restate ${re}`);
      }
    } finally {
      cleanup(root);
    }
  }
});

test('init: step 4 names the trimmed probe command, and without the field init names the missing duty', () => {
  for (const [lang, probe, named, duty, missing] of [
    ['ru', 'npm run probe', PROBE_RU.named, PROBE_RU.duty, ruRe('probe is not declared in {config}: the block carries no mutation-probe requirement and the skill asks for a hand-made check without a command — declare the command in probe or describe the probe in a section of your own outside the block')],
    ['en', 'npm run probe', 'then run the probe — `npm run probe`.', /mutation probe/, /probe is not declared in backslop\.json: the block carries no mutation-probe requirement and the skill asks for a hand-made check without a command/],
    ['ru', '  npm run probe  ', PROBE_RU.named, PROBE_RU.duty, ruRe('probe is not declared in {config}: the block carries no mutation-probe requirement and the skill asks for a hand-made check without a command — declare the command in probe or describe the probe in a section of your own outside the block')],
  ]) {
    const root = emptyRepo();
    try {
      let r = cli(root, ['init', '--lang', lang]);
      assert.equal(r.code, 0, `${lang} "${probe}": ${r.err}`);
      assert.doesNotMatch(read(root, 'AGENTS.md'), duty, `${lang} "${probe}": no probe duty in the block without a probe command`);
      assert.match(r.out, missing, `${lang} "${probe}": init names the dropped duty instead of staying silent`);

      const cfg = JSON.parse(read(root, 'backslop.json'));
      put(root, 'backslop.json', `${JSON.stringify({ ...cfg, probe }, null, 2)}\n`);
      r = cli(root, ['init']);
      assert.equal(r.code, 0, `${lang} "${probe}": ${r.err}`);
      const generated = read(root, 'AGENTS.md');
      assert.match(generated, duty, `${lang} "${probe}": a declared probe brings the duty back`);
      assert.ok(generated.includes(named), `${lang} "${probe}": step 4 names the probe command`);
      assert.doesNotMatch(r.out, missing, `${lang} "${probe}": a declared probe is not reported missing`);
      assert.equal(JSON.parse(read(root, 'backslop.json')).probe, probe, `${lang} "${probe}": a rerun of init keeps the field as written`);
      r = cli(root, ['init']);
      assert.equal(r.code, 0, `${lang} "${probe}": ${r.err}`);
      assert.equal(read(root, 'AGENTS.md'), generated, `${lang} "${probe}": a second init with probe does not grow the file`);
      assert.equal((read(root, 'AGENTS.md').match(/<!-- backslop:end -->/g) ?? []).length, 1, `${lang} "${probe}": one block end marker`);
    } finally {
      cleanup(root);
    }
  }
});

test('init: a custom --prefix and --dir lay out the tree, and new and lint work under that prefix', () => {
  const root = emptyRepo();
  try {
    let r = cli(root, ['init', '--prefix', 'DFL', '--dir', 'doc']);
    assert.equal(r.code, 0, r.err);
    assert.ok(existsSync(path.join(root, 'doc/backlog/README.md')));
    assert.match(read(root, 'doc/archive/README.md'), ruLineRe('docs/archive/README.md', 'directory with two files', { prefix: 'DFL' }));
    assert.match(read(root, 'AGENTS.md'), ruLineRe('agents-section.md', 'task prefix:', { prefix: 'DFL' }));

    r = cli(root, ['new', 'x', '--queue']);
    assert.ok(existsSync(path.join(root, 'doc/backlog/queue/DFL-1-x.md')));
    put(root, 'doc/backlog/queue/DFL-1-x.md', read(root, 'doc/backlog/queue/DFL-1-x.md').replace(new RegExp(`\\*\\*${FIELD.area}:\\*\\* .*`), `**${FIELD.area}:** [x](../../reference/README.md)`).replace(/\[TODO[^\]]*\]/g, 'done'));
    r = cli(root, ['lint']);
    assert.equal(r.code, 0, r.err);
  } finally {
    cleanup(root);
  }
});

test('init: the process ADR points to the tool-owned READMEs and lint is green under --dir', () => {
  for (const args of [[], ['--dir', 'doc']]) {
    const root = emptyRepo();
    try {
      const docs = args.length ? 'doc' : 'docs';
      const r = cli(root, ['init', '--lang', 'en', ...args]);
      assert.equal(r.code, 0, r.err);
      const adr = read(root, `${docs}/adr/adr-001-process.md`);
      assert.match(adr, /\]\(\.\.\/backlog\/README\.md\)/);
      assert.match(adr, /\]\(\.\.\/archive\/README\.md\)/);
      assert.doesNotMatch(adr, /archive\/<id>/);
      assert.equal(cli(root, ['lint']).code, 0, args.join(' '));
    } finally {
      cleanup(root);
    }
  }
});

test('init: the rendered seed skill spells every command with the pinned cli and has no roadmap', () => {
  const spelled = {
    'SKILL.md': ['`node bs.js init`', '`node bs.js seed --scan`', '`node bs.js seed --queue-reference`', '`node bs.js lint`'],
    'references/adr-backfill.md': ['`node bs.js adr <slug> --title', '`node bs.js lint`'],
  };
  for (const lang of ['en', 'ru']) {
    const root = emptyRepo();
    try {
      const r = cli(root, ['init', '--lang', lang, '--tools', 'claude', '--cli', 'node bs.js']);
      assert.equal(r.code, 0, r.err);
      for (const rel of ['SKILL.md', 'references/adr-backfill.md', 'references/inventory.md', 'references/glossary.md']) {
        const text = read(root, `.claude/skills/backslop-seed/${rel}`);
        assert.doesNotMatch(text, /`backslop (adr|new|lint|status|init|seed)\b/, `${lang} ${rel}`);
        assert.doesNotMatch(text, /`(adr <slug>|seed --|new <slug>)/, `${lang} ${rel}: a command without the cli prefix`);
        assert.doesNotMatch(text, /roadmap/i, `${lang} ${rel}`);
        for (const command of spelled[rel] ?? []) assert.ok(text.includes(command), `${lang} ${rel}: ${command}`);
        const template = readFileSync(path.join(REPO, 'templates', lang === 'en' ? 'en' : '', 'skills/backslop-seed', rel), 'utf8');
        assert.equal(text.split('node bs.js').length, template.split('{{cli}}').length, `${lang} ${rel}: a cli placeholder lost its prefix`);
      }
    } finally {
      cleanup(root);
    }
  }
});

test('init: a cli with a quote and a backslash leaves every skill description a valid JSON string', () => {
  for (const lang of ['en', 'ru']) {
    const root = emptyRepo();
    try {
      const r = cli(root, ['init', '--lang', lang, '--tools', 'claude,cursor,codex', '--cli', 'node "C:\\Users\\me\\backslop.js"']);
      assert.equal(r.code, 0, r.err);
      for (const rel of ['.claude/skills', '.agents/skills']) {
        for (const skill of ['backslop-seed', 'backslop-task', 'backslop-batch']) {
          const description = frontmatterField(read(root, `${rel}/${skill}/SKILL.md`), 'description');
          assert.ok(description, `${lang} ${rel}/${skill}: description`);
        }
      }
      for (const skill of ['backslop-seed', 'backslop-task', 'backslop-batch']) {
        const rule = read(root, `.cursor/rules/${skill}.mdc`);
        assert.ok(frontmatterField(rule, 'description'), `${lang} .cursor/rules/${skill}.mdc: description`);
      }
    } finally {
      cleanup(root);
    }
  }
});

test('init: the en glossary defines EN as the code identifier and the seed reference does not restate it', () => {
  const root = emptyRepo();
  try {
    const r = cli(root, ['init', '--lang', 'en', '--tools', 'claude']);
    assert.equal(r.code, 0, r.err);
    const glossary = read(root, 'docs/GLOSSARY.md');
    assert.match(glossary, /EN is the identifier in code/);
    assert.doesNotMatch(glossary, /English text/);
    const reference = read(root, '.claude/skills/backslop-seed/references/glossary.md');
    assert.doesNotMatch(reference, /English text/);
    assert.match(reference, /\| booking \| Reservation \|/);
    assert.doesNotMatch(reference, /^## After seeding$/m);
  } finally {
    cleanup(root);
  }
});

test('init keeps the header of an existing AGENTS.md and a user CLAUDE.md', () => {
  const root = emptyRepo();
  try {
    put(root, 'AGENTS.md', '# My project\n\nProject rules.\n');
    put(root, 'CLAUDE.md', 'Something of my own\n');
    const r = cli(root, ['init']);
    assert.equal(r.code, 0, r.err);
    assert.match(read(root, 'AGENTS.md'), /^# My project\n\nProject rules\.\n\n<!-- backslop:start -->/);
    assert.equal(read(root, 'CLAUDE.md'), 'Something of my own\n');
  } finally {
    cleanup(root);
  }
});

test('init refuses a --prefix that differs from the prefix in the config', () => {
  const root = emptyRepo();
  try {
    let r = cli(root, ['init', '--prefix', 'DFL']);
    assert.equal(r.code, 0, r.err);
    r = cli(root, ['init', '--prefix', 'ZZ']);
    assert.equal(r.code, 1);
    assert.match(r.err, /prefix = «DFL»/);
  } finally {
    cleanup(root);
  }
});

// Windows-1251 bytes: U+0410–U+044F sit at 0xC0–0xFF (the code point minus 0x350), ASCII as is. The
// texts are built from code points: the test needs bytes that are not UTF-8, not Cyrillic words.
const cp1251 = (...codePoints) => Buffer.from(codePoints.map((cp) => (cp >= 0x410 ? cp - 0x350 : cp)));

test('init refuses a non-UTF-8 AGENTS.md or rewritten .gitignore before any write', () => {
  const root = emptyRepo();
  try {
    const bytes = cp1251(0x23, 0x20, 0x41F, 0x440, 0x43E, 0x435, 0x43A, 0x442, 0x0A);
    writeFileSync(path.join(root, 'AGENTS.md'), bytes);
    let r = cli(root, ['init', '--lang', 'en', '--tools', 'none']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, /AGENTS\.md: not valid UTF-8 — convert it, then retry/);
    assert.ok(readFileSync(path.join(root, 'AGENTS.md')).equals(bytes), 'AGENTS.md bytes changed');
    assert.ok(!existsSync(path.join(root, 'backslop.json')), 'the refusal came after the first write');
    assert.ok(!existsSync(path.join(root, 'docs')), 'the refusal came after the first write');

    rmSync(path.join(root, 'AGENTS.md'));
    const ignore = cp1251(0x23, 0x20, 0x43A, 0x44D, 0x448, 0x0A, ...Buffer.from('node_modules/\n'));
    writeFileSync(path.join(root, '.gitignore'), ignore);
    r = cli(root, ['init', '--lang', 'en', '--tools', 'none']);
    assert.equal(r.code, 0, r.err);
    assert.ok(readFileSync(path.join(root, '.gitignore')).equals(ignore), 'init without adapters leaves .gitignore alone');
    r = cli(root, ['init', '--tools', 'claude']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, /\.gitignore: not valid UTF-8/);
    assert.ok(readFileSync(path.join(root, '.gitignore')).equals(ignore), '.gitignore bytes changed');
    assert.ok(!existsSync(path.join(root, '.claude')), 'the refusal came after the first write');
  } finally {
    cleanup(root);
  }
});

test('a BOM-prefixed backslop.json loads: lint is green, help follows lang, init rewrites it without BOM', () => {
  const root = emptyRepo();
  try {
    let r = cli(root, ['init', '--lang', 'en', '--tools', 'none']);
    assert.equal(r.code, 0, r.err);
    put(root, 'backslop.json', `\uFEFF${read(root, 'backslop.json')}`);
    r = cli(root, ['lint']);
    assert.equal(r.code, 0, r.err);
    r = cli(root, ['help']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /^backslop — a file-based backlog/, 'help fell back to Russian');
    r = cli(root, ['init']);
    assert.equal(r.code, 0, r.err);
    assert.equal(readFileSync(path.join(root, 'backslop.json'))[0], 0x7B, 'the rewritten config starts with a BOM');
  } finally {
    cleanup(root);
  }
});

test('init: markers quoted in prose are not the block; a marker line twice is refused', () => {
  const root = emptyRepo();
  try {
    let r = cli(root, ['init', '--lang', 'en', '--tools', 'none']);
    assert.equal(r.code, 0, r.err);
    const rendered = read(root, 'AGENTS.md');
    const prose = 'The managed block sits between `<!-- backslop:start -->` and `<!-- backslop:end -->`.';
    put(root, 'AGENTS.md', `${prose}\n\n${rendered}`);
    r = cli(root, ['init']);
    assert.equal(r.code, 0, r.err);
    const agents = read(root, 'AGENTS.md');
    assert.equal(agents, `${prose}\n\n${rendered}`, 'the prose line is kept and one rendered block remains');
    assert.equal(agents.split('\n').filter((l) => l === '<!-- backslop:start -->').length, 1);
    assert.equal(agents.split('\n').filter((l) => l === '<!-- backslop:end -->').length, 1);

    const twice = `${rendered}\n${rendered}`;
    put(root, 'AGENTS.md', twice);
    const config = read(root, 'backslop.json');
    r = cli(root, ['init']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, /AGENTS\.md: a backslop block marker stands on its own line more than once — fix it manually/);
    assert.equal(read(root, 'AGENTS.md'), twice);
    assert.equal(read(root, 'backslop.json'), config);
  } finally {
    cleanup(root);
  }
});

test('init: inside an already initialized project — a refusal with the root path', () => {
  const root = emptyRepo();
  try {
    let r = cli(root, ['init']);
    assert.equal(r.code, 0, r.err);
    const sub = path.join(root, 'src');
    put(root, 'src/keep.txt', '');
    r = cli(root, ['init'], { cwd: sub });
    assert.equal(r.code, 1);
    assert.match(r.err, ruRe('project is already initialized above at {existingRoot}; run init there or create a separate {config}'));
    assert.ok(!existsSync(path.join(sub, 'backslop.json')));
  } finally {
    cleanup(root);
  }
});

test('init normalises --dir docs/ to docs', () => {
  const root = emptyRepo();
  try {
    const r = cli(root, ['init', '--dir', 'docs/']);
    assert.equal(r.code, 0, r.err);
    assert.equal(JSON.parse(read(root, 'backslop.json')).docs, 'docs');
    assert.doesNotMatch(read(root, 'AGENTS.md'), /docs\/\//);
  } finally {
    cleanup(root);
  }
});

test('init with tools=[] keeps a user CLAUDE.md symlink to AGENTS.md', { skip: process.platform === 'win32' }, () => {
  const root = emptyRepo();
  try {
    put(root, 'AGENTS.md', '# Project\n');
    symlinkSync('AGENTS.md', path.join(root, 'CLAUDE.md'));
    const r = cli(root, ['init']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, new RegExp(`CLAUDE\\.md: ${ru('not selected')}`));
    assert.ok(lstatSync(path.join(root, 'CLAUDE.md')).isSymbolicLink(), 'CLAUDE.md is no longer a symlink');
    assert.equal(readlinkSync(path.join(root, 'CLAUDE.md')), 'AGENTS.md');
  } finally {
    cleanup(root);
  }
});

test('init: a repeated --dir spelling the stored docs differently is not a conflict', () => {
  const root = emptyRepo();
  try {
    for (const dir of ['docs/', 'docs/', './docs']) {
      const r = cli(root, ['init', '--dir', dir, '--tools', 'none']);
      assert.equal(r.code, 0, `--dir ${dir}: ${r.err}`);
    }
    assert.equal(JSON.parse(read(root, 'backslop.json')).docs, 'docs');
    let r = cli(root, ['init', '--dir', 'doc']);
    assert.equal(r.code, 1, 'another directory still conflicts with the config');
    assert.match(r.err, /docs = «docs»/);
    r = cli(root, ['init', '--dir', 'docs/../docs']);
    assert.equal(r.code, 1, 'a .. segment passed because it normalises to the stored docs');
    assert.match(r.err, new RegExp(`^✖ ${ruRe('--dir “{dir}”: expected a relative path inside the project', { dir: 'docs/../docs' }).source}`), 'a ru project answers in Russian');
    put(root, 'backslop.json', read(root, 'backslop.json').replace('"docs": "docs"', '"docs": "./docs"'));
    for (const dir of ['./docs', 'docs', 'docs/']) {
      r = cli(root, ['init', '--dir', dir, '--tools', 'none']);
      assert.equal(r.code, 0, `stored ./docs, --dir ${dir}: ${r.err}`);
    }
    assert.equal(JSON.parse(read(root, 'backslop.json')).docs, './docs', 'init rewrote the stored spelling');
  } finally {
    cleanup(root);
  }
});

// Probe text renders through `probeSlots` only with `probe`; without it the skill carries just the
// command-free sentence of `probe/manual.md`, and the block, the brief and the result stub nothing.
test('init: probe text in the block, the skill, the brief and the result stub only with the probe field', () => {
  const NONE_EN = /probe|mutation/i;
  const passage = (lang, file) => {
    const text = readFileSync(path.join(REPO, 'templates', ...(lang === 'en' ? ['en'] : []), 'probe', file), 'utf8').trim();
    assert.ok(text.length > 10, `${lang}: probe/${file} is not empty`);
    return text;
  };
  for (const [lang, named, rule, afterBreakage, verified] of [
    ['ru', PROBE_RU.named, new RegExp(escapeRe(PROBE_RU.named.split(',')[0]), 'g'), PROBE_RU.afterBreakage, PROBE_RU.verified],
    ['en', 'commit first, then run the probe — `npm run probe`.', /after the commit|commit first/g, 'Run gates on an unchanged tree', 'numerical gates, mutation probe and live run'],
  ]) {
    const root = emptyRepo();
    const NONE = lang === 'ru' ? PROBE_RU.none : NONE_EN;
    try {
      const cfg = { prefix: 'BS', docs: 'docs', gates: [], lang, tools: [] };
      put(root, 'backslop.json', `${JSON.stringify(cfg, null, 2)}\n`);
      assert.equal(cli(root, ['init', '--tools', 'claude']).code, 0);
      assert.equal(cli(root, ['new', 'a', '--queue']).code, 0);
      const skill = () => read(root, '.claude/skills/backslop-task/SKILL.md');
      const bare = skill();
      assert.doesNotMatch(read(root, 'AGENTS.md'), NONE, `${lang}: the block carries no probe text`);
      const manual = passage(lang, 'manual.md');
      assert.ok(bare.includes(`${manual} ${afterBreakage}`), `${lang}: step 4 of the skill carries the command-free sentence`);
      assert.doesNotMatch(bare.replace(manual, ''), NONE, `${lang}: the skill carries no other probe text`);
      assert.ok(!bare.includes('{{'), `${lang}: an empty slot leaves no {{…}} to the reader`);
      const brief = cli(root, ['brief', '1', '--track', 'x']);
      assert.equal(brief.code, 0, brief.err);
      assert.doesNotMatch(brief.out, NONE, `${lang}: the brief carries no probe text`);
      assert.equal(cli(root, ['archive', '1']).code, 0);
      assert.doesNotMatch(read(root, `docs/archive/BS-1-a/result.md`), NONE, `${lang}: the result stub carries no probe text`);

      put(root, 'backslop.json', `${JSON.stringify({ ...cfg, probe: 'npm run probe' }, null, 2)}\n`);
      assert.equal(cli(root, ['init', '--tools', 'claude']).code, 0);
      const full = skill();
      assert.ok(full.includes(named), `${lang}: step 4 of the skill names the probe command`);
      assert.ok(!full.includes(manual), `${lang}: a declared probe drops the command-free sentence`);
      assert.ok(full.includes(`${named} ${passage(lang, 'breakage.md')} ${afterBreakage}`), `${lang}: breakage stands between the rule and the next sentence of step 4`);
      assert.ok(full.includes(`\n\n   ${passage(lang, 'second.md')}\n\n5. `), `${lang}: the second probe stays inside item 4, before item 5`);
      assert.ok(full.includes(verified), `${lang}: the acceptance step names the probe among the verification`);
      assert.match(read(root, 'AGENTS.md'), NONE, `${lang}: the block has its probe step back`);
      assert.equal(cli(root, ['new', 'b', '--queue']).code, 0);
      const declared = cli(root, ['brief', '2', '--track', 'x']);
      assert.equal(declared.code, 0, declared.err);
      assert.equal((declared.out.match(rule) ?? []).length, 1, `${lang}: the brief states commit first once`);
      const sentence = passage(lang, '../agents-probe.md').replace('{{probe}}', 'npm run probe');
      const bullet = passage(lang, 'bullet.md').replace('{{probeRule}}', ` ${sentence}`);
      assert.ok(declared.out.includes(`\n${bullet}\n`), `${lang}: the brief carries the probe bullet whole`);
      assert.ok(declared.out.includes(passage(lang, 'result.md')), `${lang}: the result contents of the brief name the probe`);
      assert.equal(cli(root, ['archive', '2']).code, 0);
      assert.match(read(root, 'docs/archive/BS-2-b/result.md'), NONE, `${lang}: the result stub asks for the probe`);
    } finally {
      cleanup(root);
    }
  }
});

// The frontmatter of an adapter output is read by the consumer's gate: a value with “: ” goes out
// quoted, and `splitFrontmatter` unquoting keeps `.mdc` from a second layer: cursorOutput gives it.
function frontmatterValue(text, key) {
  const line = text.split('\n').find((l) => l.startsWith(`${key}: `));
  assert.ok(line !== undefined, `no “${key}: ” line in the frontmatter`);
  return line.slice(key.length + 2);
}

test('init: the description value in adapter outputs is quoted, and Cursor does not quote it twice', () => {
  const root = emptyRepo();
  try {
    const r = cli(root, ['init', '--tools', 'claude,cursor,codex']);
    assert.equal(r.code, 0, r.err);
    const claude = frontmatterValue(read(root, '.claude/skills/backslop-task/SKILL.md'), 'description');
    assert.ok(claude.startsWith('"'), 'a flat scalar with “: ” inside does not parse as a YAML mapping');
    assert.ok(JSON.parse(claude).includes(': '), 'the quotes stand exactly because of “: ” in the text');
    assert.equal(frontmatterValue(read(root, '.agents/skills/backslop-task/SKILL.md'), 'description'), claude);
    const cursor = frontmatterValue(read(root, '.cursor/rules/backslop-task.mdc'), 'description');
    assert.equal(JSON.parse(cursor), JSON.parse(claude), 'the .mdc carries the text, not escaped quotes');
  } finally {
    cleanup(root);
  }
});

test('init --tools cursor: a malformed quoted description in a skill template is refused by name', () => {
  const tool = toolCopy((dir) => {
    const file = path.join(dir, 'templates', 'skills', 'backslop-task', 'SKILL.md');
    writeFileSync(file, readFileSync(file, 'utf8').replace(/^description: .*$/m, 'description: "unterminated'));
  });
  const root = emptyRepo();
  try {
    const r = toolCli(tool, ['init', '--tools', 'cursor'], { cwd: root });
    assert.equal(r.code, 1, r.out);
    assert.equal(r.err, `✖ ${ru('template {template}: the frontmatter description is not a valid JSON string', { template: 'templates/skills/backslop-task/SKILL.md' })}\n`);
  } finally {
    cleanup(tool);
    cleanup(root);
  }
});

test('init: adapters have the canonical layout; deselect removes only owned outputs', () => {
  const root = emptyRepo();
  try {
    let r = cli(root, ['init', '--tools', 'codex,cursor,claude']);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(JSON.parse(read(root, 'backslop.json')).tools, ['claude', 'cursor', 'codex']);
    assert.equal(read(root, 'CLAUDE.md'), '@AGENTS.md\n');
    assert.ok(existsSync(path.join(root, '.claude/skills/backslop-task/SKILL.md')));
    assert.ok(existsSync(path.join(root, '.agents/skills/backslop-task/SKILL.md')));
    const cursor = read(root, '.cursor/rules/backslop-batch.mdc');
    assert.match(cursor, /^---\ndescription: ".+"\nalwaysApply: false\n---\n<!-- backslop:generated -->\n\n# backslop-batch/m);
    assert.match(cursor, /\(backslop-batch\/references\/measurements\.md\)/);
    assert.ok(existsSync(path.join(root, '.cursor/rules/backslop-batch/references/measurements.md')));
    assert.match(cursor, /\(backslop-batch\/references\/merge-changelog\.md\)/);
    assert.ok(existsSync(path.join(root, '.cursor/rules/backslop-batch/references/merge-changelog.md')));
    assert.ok(existsSync(path.join(root, '.claude/skills/backslop-batch/references/merge-changelog.md')));
    assert.equal(cli(root, ['lint']).code, 0);

    r = cli(root, ['init', '--tools', 'none']);
    assert.equal(r.code, 0, r.err);
    assert.ok(!existsSync(path.join(root, 'CLAUDE.md')), 'the exact generated stub is removed');
    r = cli(root, ['init', '--tools', 'claude,cursor,codex']);
    assert.equal(r.code, 0, r.err);

    put(root, '.claude/skills/backslop-task/custom.md', 'custom quotes <!-- backslop:generated -->\n');
    put(root, '.cursor/rules/custom.mdc', 'custom\n');
    put(root, '.agents/skills/custom/SKILL.md', 'custom\n');
    put(root, 'CLAUDE.md', 'custom Claude instructions\n');
    r = cli(root, ['init', '--tools', 'none']);
    assert.equal(r.code, 0, r.err);
    assert.ok(!existsSync(path.join(root, '.claude/skills/backslop-task/SKILL.md')));
    assert.ok(!existsSync(path.join(root, '.cursor/rules/backslop-task.mdc')));
    assert.ok(!existsSync(path.join(root, '.agents/skills/backslop-task/SKILL.md')));
    assert.equal(read(root, '.claude/skills/backslop-task/custom.md'), 'custom quotes <!-- backslop:generated -->\n');
    assert.equal(read(root, '.cursor/rules/custom.mdc'), 'custom\n');
    assert.equal(read(root, '.agents/skills/custom/SKILL.md'), 'custom\n');
    assert.equal(read(root, 'CLAUDE.md'), 'custom Claude instructions\n');
  } finally {
    cleanup(root);
  }
});

for (const tool of ['claude', 'cursor', 'codex']) {
  test(`init: adapter ${tool} materialises without the neighbours’ outputs`, () => {
    const root = emptyRepo();
    try {
      const r = cli(root, ['init', '--tools', tool]);
      assert.equal(r.code, 0, r.err);
      assert.equal(existsSync(path.join(root, '.claude/skills/backslop-task/SKILL.md')), tool === 'claude');
      assert.equal(existsSync(path.join(root, '.cursor/rules/backslop-task.mdc')), tool === 'cursor');
      assert.equal(existsSync(path.join(root, '.agents/skills/backslop-task/SKILL.md')), tool === 'codex');
      assert.equal(existsSync(path.join(root, 'CLAUDE.md')), tool === 'claude');
      assert.equal(cli(root, ['lint']).code, 0);
    } finally { cleanup(root); }
  });
}

test('init: unknown, empty and repeated adapter ids are rejected', () => {
  for (const tools of ['vscode', '', 'claude,claude']) {
    const root = emptyRepo();
    try {
      const r = cli(root, ['init', '--tools', tools]);
      assert.equal(r.code, 1);
      assert.match(r.err, /claude, cursor, codex/);
    } finally { cleanup(root); }
  }
});

test('init: a rerun with --tools and --lang rewrites both fields of an existing config', () => {
  const root = emptyRepo();
  try {
    assert.equal(cli(root, ['init']).code, 0);
    const r = cli(root, ['init', '--tools', 'cursor', '--lang', 'en']);
    assert.equal(r.code, 0, r.err);
    assert.equal(JSON.parse(read(root, 'backslop.json')).lang, 'en');
    assert.deepEqual(JSON.parse(read(root, 'backslop.json')).tools, ['cursor']);
  } finally {
    cleanup(root);
  }
});

test('init --lang en: the CLI and the generated tree are English, mixed metadata is read', () => {
  const root = emptyRepo();
  const cyrillic = CYRILLIC;
  try {
    let r = cli(root, ['init', '--lang', 'en', '--tools', 'cursor']);
    assert.equal(r.code, 0, r.err);
    assert.doesNotMatch(r.out + r.err, cyrillic);
    for (const rel of [
      'docs/README.md', 'docs/GLOSSARY.md', 'docs/backlog/README.md', 'AGENTS.md',
      '.cursor/rules/backslop-task.mdc', '.cursor/rules/backslop-batch.mdc',
    ]) {
      assert.doesNotMatch(read(root, rel), cyrillic, rel);
    }
    r = cli(root, ['new', 'english', '--queue', '--title', 'English task']);
    assert.equal(r.code, 0, r.err);
    assert.match(read(root, 'docs/backlog/queue/BS-1-english.md'), /- \*\*Order:\*\* 10/);
    r = cli(root, ['mv', '1', 'active']);
    assert.equal(r.code, 0, r.err);
    r = cli(root, ['mv', '1', 'deferred']);
    assert.equal(r.code, 0, r.err);
    r = cli(root, ['mv', '1', 'queue']);
    assert.equal(r.code, 0, r.err);
    r = cli(root, ['adr', 'english-decision']);
    assert.equal(r.code, 0, r.err);
    put(root, 'docs/adr/adr-002-english-decision.md', read(root, 'docs/adr/adr-002-english-decision.md').replace(/\[TODO[^\]]*\]/g, 'Written.'));
    put(root, 'docs/README.md', read(root, 'docs/README.md').replace(
      '| [adr/adr-001-process.md](adr/adr-001-process.md) | Tasks and decisions are managed with backslop | Accepted |',
      '| [adr/adr-001-process.md](adr/adr-001-process.md) | Tasks and decisions are managed with backslop | Accepted |\n| [adr/adr-002-english-decision.md](adr/adr-002-english-decision.md) | English decision | Proposed |',
    ));
    put(root, 'docs/backlog/triage/BS-2-russian.md', ruCard('BS-2', 'Russian task', { created: '2026-09-03' }));
    const json = JSON.parse(cli(root, ['status', '--json']).out);
    assert.equal(json.triage[0].created, '2026-09-03');
    assert.match(cli(root, ['status']).out, /^Active/m);
    spawnSync('git', ['-C', root, 'add', '-A']);
    spawnSync('git', ['-C', root, 'commit', '-qm', 'seed']);
    r = cli(root, ['archive', '1']);
    assert.equal(r.code, 0, r.err);
    put(root, 'docs/archive/BS-1-english/result.md', '# BS-1 · Result\n\n**Closed 2026-09-03.** Completed.\n');
    r = cli(root, ['lint']);
    assert.equal(r.code, 0, r.err + r.out);
  } finally {
    cleanup(root);
  }
});

test('init again: the version stamp is moved, a mismatch with the cli pin is named', () => {
  const root = emptyRepo();
  try {
    let r = cli(root, ['init']);
    assert.equal(r.code, 0, r.err);
    const cfg = JSON.parse(read(root, 'backslop.json'));
    put(root, 'backslop.json', `${JSON.stringify({ ...cfg, version: '0.0.1', cli: 'npx github:Velklish/backslop#v0.0.1' }, null, 2)}\n`);
    r = cli(root, ['init']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, ruRe('version stamp: v{from} → v{version}', { from: '0.0.1' }));
    assert.match(r.err, ruRe('cli is pinned to v{pin}, but layout was generated by v{version}: run {cli} upgrade or update cli in {config}', { pin: '0.0.1' }));
    const after = JSON.parse(read(root, 'backslop.json'));
    assert.equal(after.version, TOOL_VERSION);
    assert.equal(after.cli, 'npx github:Velklish/backslop#v0.0.1', 'init does not touch the pin — that is the upgrade’s move');
  } finally {
    cleanup(root);
  }
});

test('init on a project with its own docs/README.md: ADR-001 is created, the table row is a hint', () => {
  const root = emptyRepo();
  try {
    put(root, 'docs/README.md', '# My docs\n');
    const r = cli(root, ['init']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, ruRe('{docs}/README.md already existed: link {adrRel} from it (a row in its table is the usual place), otherwise lint fails', { docs: 'docs', adrRel: 'adr/adr-001-process.md' }));
    assert.equal(read(root, 'docs/README.md'), '# My docs\n');
  } finally {
    cleanup(root);
  }
});

test('init in a project with its own ADRs: the process ADR gets the next number, a repeat does not duplicate', () => {
  const root = emptyRepo();
  try {
    put(root, 'docs/adr/adr-001-architecture.md', '# ADR-001: Architecture\n\n**Status:** Accepted\n');
    put(root, 'docs/adr/adr-002-storage.md', '# ADR-002: Storage\n\n**Status:** Accepted\n');
    put(root, 'docs/README.md', '# Documentation\n\n| Document | Topic | Status |\n|---|---|---|\n');
    let r = cli(root, ['init']);
    assert.equal(r.code, 0, r.err);
    assert.ok(!existsSync(path.join(root, 'docs/adr/adr-001-process.md')));
    assert.match(read(root, 'docs/adr/adr-003-process.md'), new RegExp(`^${ruLineRe('docs/adr/adr-001-process.md', 'Tasks and decisions are managed with backslop', { adrNumber: '003' }).source}\\n`));
    assert.match(r.out, /adr\/adr-003-process\.md/);
    r = cli(root, ['init']);
    assert.equal(r.code, 0, r.err);
    assert.ok(!existsSync(path.join(root, 'docs/adr/adr-004-process.md')));
    assert.doesNotMatch(r.out, /adr-004/);
  } finally {
    cleanup(root);
  }
});

test('init --tools none: an unmarked file at the current template path stays and is named by a warning', () => {
  const tool = toolCopy((dir) => put(dir, 'templates/skills/backslop-task/references/extra.md', '# extra\n'));
  const root = emptyRepo();
  try {
    assert.equal(toolCli(tool, ['init', '--tools', 'none'], { cwd: root }).code, 0);
    put(root, '.claude/skills/backslop-task/references/extra.md', 'a foreign file\n');
    put(root, '.claude/skills/backslop-task/mine.md', 'a foreign file\n');
    const r = toolCli(tool, ['init', '--tools', 'none'], { cwd: root });
    assert.equal(r.code, 0, r.err);
    assert.equal(read(root, '.claude/skills/backslop-task/references/extra.md'), 'a foreign file\n');
    assert.equal(read(root, '.claude/skills/backslop-task/mine.md'), 'a foreign file\n');
    assert.match(r.err, /\.claude\/skills\/backslop-task\/references\/extra\.md/);
  } finally {
    cleanup(tool);
    cleanup(root);
  }
});

test('init --tools none: an unmarked file at a shipped skill path is left byte for byte and named foreign', () => {
  const rel = '.claude/skills/backslop-batch/references/measurements.md';
  const root = emptyRepo();
  try {
    assert.equal(cli(root, ['init', '--tools', 'none']).code, 0);
    put(root, rel, 'my own file, no marker\n');
    const r = cli(root, ['init', '--tools', 'none']);
    assert.equal(r.code, 0, r.err);
    assert.equal(read(root, rel), 'my own file, no marker\n');
    assert.match(r.err, ruRe(LEFT_AS_IS, { foreign: MEASUREMENTS }));
  } finally {
    cleanup(root);
  }
});

// Only the roots of the selected adapters are checked for a symlink, and a link there is a refusal
// wherever it leads; the roots of unselected ones are not checked.
test('init: a symlink at a harness root — a refusal only for the selected adapter, before the first write', () => {
  const root = emptyRepo();
  const shared = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-shared-')));
  try {
    symlinkSync(shared, path.join(root, '.claude'));
    put(shared, 'skills/backslop-task/SKILL.md', '<!-- backslop:generated -->\n# behind the link\n');
    const r = cli(root, ['init', '--tools', 'claude']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, ruRe('adapter path contains a symlink: {link}', { link: '.claude' }));
    assert.match(r.err, ruRe(FOREIGN_LINK, { tool: 'claude' }), 'the refusal names the remedy — deselect the adapter');
    assert.ok(!existsSync(path.join(root, 'backslop.json')), 'the config is not written');
    assert.ok(!existsSync(path.join(root, 'docs')), 'the docs skeleton is not laid out');

    // An unselected adapter behind a link: init passes, the file behind the link is not removed.
    for (const args of [['init'], ['init', '--tools', 'none'], ['init', '--tools', 'cursor']]) {
      const ok = cli(root, args);
      assert.equal(ok.code, 0, `${args.join(' ')}: ${ok.err}`);
    }
    assert.equal(read(shared, 'skills/backslop-task/SKILL.md'), '<!-- backslop:generated -->\n# behind the link\n', 'backslop does not remove through a link');
    assert.ok(existsSync(path.join(root, '.cursor/rules/backslop-task.mdc')));

    // A link into the project at a selected root — the same refusal: the link target is not
    // told apart.
    unlinkSync(path.join(root, '.claude'));
    mkdirSync(path.join(root, 'inner'));
    symlinkSync(path.join(root, 'inner'), path.join(root, '.claude'));
    const inner = cli(root, ['init', '--tools', 'claude']);
    assert.equal(inner.code, 1, inner.out);
    assert.match(inner.err, ruRe('adapter path contains a symlink: {link}', { link: '.claude' }));
    assert.deepEqual(JSON.parse(read(root, 'backslop.json')).tools, ['cursor'], 'a refusal before the config is written');
    assert.ok(!existsSync(path.join(root, 'inner', 'skills')), 'something was written behind the link');

    // An existing config with claude in tools: a bare init neither changes the set nor heals it —
    // --tools does.
    const root2 = emptyRepo();
    const shared2 = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-shared-')));
    try {
      assert.equal(cli(root2, ['init', '--tools', 'claude']).code, 0);
      rmSync(path.join(root2, '.claude'), { recursive: true, force: true });
      symlinkSync(shared2, path.join(root2, '.claude'));
      const bare = cli(root2, ['init']);
      assert.equal(bare.code, 1, bare.out);
      assert.match(bare.err, ruRe(FOREIGN_LINK, { tool: 'claude' }));
      assert.equal(cli(root2, ['init', '--tools', 'none']).code, 0);
    } finally {
      cleanup(shared2);
      cleanup(root2);
    }
  } finally {
    cleanup(shared);
    cleanup(root);
  }
});

test('init: an unselected adapter behind a link below its root or with a file root is skipped', { skip: process.platform === 'win32' }, () => {
  const root = emptyRepo();
  const shared = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-shared-')));
  try {
    put(shared, 'SKILL.md', '<!-- backslop:generated -->\n# shared\n');
    mkdirSync(path.join(root, '.claude/skills'), { recursive: true });
    symlinkSync(shared, path.join(root, '.claude/skills/backslop-task'));
    put(root, '.cursor/rules', 'a file, not a directory\n');
    for (const args of [['init', '--tools', 'codex'], ['init'], ['init', '--tools', 'none']]) {
      const r = cli(root, args);
      assert.equal(r.code, 0, `${args.join(' ')}: ${r.err}`);
    }
    assert.equal(read(shared, 'SKILL.md'), '<!-- backslop:generated -->\n# shared\n', 'backslop cleaned through the link');
    assert.equal(read(root, '.cursor/rules'), 'a file, not a directory\n');
  } finally {
    cleanup(shared);
    cleanup(root);
  }
});

test('init: an unselected adapter with a directory on an owned path is skipped', () => {
  const root = emptyRepo();
  try {
    mkdirSync(path.join(root, '.claude/skills/backslop-task/SKILL.md'), { recursive: true });
    for (const args of [['init', '--tools', 'none'], ['init'], ['init', '--tools', 'cursor']]) {
      const r = cli(root, args);
      assert.equal(r.code, 0, `${args.join(' ')}: ${r.err}`);
    }
    assert.ok(statSync(path.join(root, '.claude/skills/backslop-task/SKILL.md')).isDirectory());
  } finally {
    cleanup(root);
  }
});

test('init refuses a file where it needs a directory and a directory where it needs a file, before any write', () => {
  for (const [shape, args, why] of [
    [(root) => put(root, 'docs', 'x\n'), [], /^✖ docs is a file, expected a directory/],
    [(root) => put(root, 'docs/backlog', 'x\n'), [], /^✖ docs\/backlog is a file, expected a directory/],
    [(root) => mkdirSync(path.join(root, 'AGENTS.md')), [], /^✖ AGENTS\.md is a directory, expected a file/],
    [(root) => mkdirSync(path.join(root, '.gitignore')), [], /^✖ \.gitignore is a directory, expected a file/],
    [(root) => mkdirSync(path.join(root, 'docs/README.md'), { recursive: true }), [], /^✖ docs\/README\.md is not a file/],
    [(root) => put(root, '.cursor/rules', 'x\n'), ['--tools', 'cursor'], /^✖ \.cursor\/rules is a file, expected a directory/],
    [(root) => put(root, '.cursor', 'x\n'), ['--tools', 'cursor'], /^✖ \.cursor is a file, expected a directory/],
  ]) {
    const root = emptyRepo();
    try {
      shape(root);
      const r = cli(root, ['init', '--lang', 'en', ...(args.length ? args : ['--tools', 'none'])]);
      assert.equal(r.code, 1, `${why}: ${r.out}`);
      assert.match(r.err, why);
      assert.doesNotMatch(r.err, /EEXIST|EISDIR|ENOTDIR|node:fs|\n\s+at /, `${why}: a stack`);
      assert.equal(existsSync(path.join(root, 'backslop.json')), false, `${why}: the config was written`);
    } finally {
      cleanup(root);
    }
  }
});

test('init: the .gitignore block follows the selected adapters; tools none removes the set, self-host creates no file', () => {
  const root = emptyRepo();
  try {
    let r = cli(root, ['init', '--tools', 'none']);
    assert.equal(r.code, 0, r.err);
    assert.ok(!existsSync(path.join(root, '.gitignore')), 'without adapters .gitignore is not created');

    r = cli(root, ['init', '--tools', 'claude,cursor']);
    assert.equal(r.code, 0, r.err);
    const block = read(root, '.gitignore');
    assert.match(block, /^# backslop:start$/m);
    assert.match(block, /^\.claude\/skills\/backslop-\*$/m);
    assert.match(block, /^\.cursor\/rules\/backslop-\*$/m);
    assert.doesNotMatch(block, /^\.agents\/skills\/backslop-\*$/m);
    assert.match(block, /^\/CLAUDE\.md$/m);
    assert.match(block, /^# backslop:end$/m);
    assert.equal(block.startsWith('# backslop:start'), true, 'in an empty .gitignore the block is the whole file');

    // Foreign lines are kept, the block is replaced in place.
    put(root, '.gitignore', `node_modules/\n\n${block}`);
    r = cli(root, ['init', '--tools', 'codex']);
    assert.equal(r.code, 0, r.err);
    const next = read(root, '.gitignore');
    assert.match(next, /^node_modules\/$/m);
    assert.match(next, /^\.agents\/skills\/backslop-\*$/m);
    assert.doesNotMatch(next, /^\.claude\/skills\/backslop-\*$/m);
    assert.doesNotMatch(next, /^\/CLAUDE\.md$/m, 'the stub is removed together with the claude adapter');
    assert.equal((next.match(/# backslop:start/g) ?? []).length, 1);

    r = cli(root, ['init', '--tools', 'none']);
    assert.equal(r.code, 0, r.err);
    assert.doesNotMatch(read(root, '.gitignore'), /backslop-\*/, 'the removed adapters leave the block too');
    assert.match(read(root, '.gitignore'), /^node_modules\/$/m);
  } finally {
    cleanup(root);
  }
});

test('init: a user CLAUDE.md does not get into .gitignore', () => {
  const root = emptyRepo();
  try {
    put(root, 'CLAUDE.md', 'My instructions\n');
    const r = cli(root, ['init', '--tools', 'claude']);
    assert.equal(r.code, 0, r.err);
    assert.match(read(root, '.gitignore'), /^\.claude\/skills\/backslop-\*$/m);
    assert.doesNotMatch(read(root, '.gitignore'), /^\/CLAUDE\.md$/m);
    assert.equal(read(root, 'CLAUDE.md'), 'My instructions\n');
  } finally {
    cleanup(root);
  }
});

// A marker under the harness root makes a file ours at any path, so init removes it: otherwise
// a file that mv, archive and lint do not see would stay forever.
test('init removes a marked file outside backslop-* under the harness root and leaves an unmarked one', () => {
  const root = emptyRepo();
  try {
    assert.equal(cli(root, ['init', '--tools', 'claude']).code, 0);
    const marked = '.claude/skills/other/note.md';
    const plain = '.claude/skills/other/mine.md';
    put(root, marked, '<!-- backslop:generated -->\n# a foreign path, our marker\n');
    put(root, plain, '# without a marker\n');
    assert.equal(isOwnedAdapterFile(plain, path.join(root, plain)), false);
    const r = cli(root, ['init', '--tools', 'claude']);
    assert.equal(r.code, 0, r.err);
    assert.equal(existsSync(path.join(root, marked)), false, 'owned by the marker — removed');
    assert.equal(read(root, plain), '# without a marker\n', 'without a marker and outside the template paths — not a candidate, stays silently');
    assert.doesNotMatch(r.err, /other\/mine\.md/);
  } finally {
    cleanup(root);
  }
});

// ADR-040: only the marker makes a file ours, so an unmarked one at a shipped path is foreign.
test('init --tools claude: a foreign file without a marker at an owned output path is not overwritten and is named by a warning', () => {
  const root = emptyRepo();
  try {
    assert.equal(cli(root, ['init', '--tools', 'claude']).code, 0);
    const rel = '.claude/skills/backslop-batch/references/measurements.md';
    assert.match(read(root, rel), /<!-- backslop:generated -->/);
    put(root, rel, '# my file at this path\n');
    const r = cli(root, ['init', '--tools', 'claude']);
    assert.equal(r.code, 0, r.err);
    assert.equal(read(root, rel), '# my file at this path\n', 'a file without a marker is not owned, not overwritten');
    assert.match(r.err, ruRe(NOT_OVERWRITTEN, { foreign: MEASUREMENTS }));
    const lint = cli(root, ['lint']);
    assert.equal(lint.code, 1);
    assert.match(lint.err, new RegExp(`measurements\\.md: ${ruRe('a foreign file without the {marker} marker sits at the {tool} adapter output path — init does not overwrite it: remove or rename the file and run {cli} init, or deselect the adapter', { tool: 'claude' }).source}`));
  } finally {
    cleanup(root);
  }
});

test('init --tools cursor: a user rule without the marker at a skill path is kept and named foreign', () => {
  const rel = '.cursor/rules/backslop-task.mdc';
  const root = emptyRepo();
  try {
    assert.equal(cli(root, ['init', '--tools', 'none']).code, 0);
    put(root, rel, 'my own cursor rule, no marker\n');
    const r = cli(root, ['init', '--tools', 'cursor']);
    assert.equal(r.code, 0, r.err);
    assert.equal(read(root, rel), 'my own cursor rule, no marker\n');
    assert.equal(r.err, `⚠ ${ru(NOT_OVERWRITTEN, { marker: '<!-- backslop:generated -->', foreign: '.cursor/rules/backslop-task.mdc' })}\n`);
  } finally {
    cleanup(root);
  }
});

// A directory at an owned path: a write into it is a refusal in words, like removal, not an
// EISDIR stack.
test('init --tools claude: a directory at an owned output path — a refusal without a stack', () => {
  const root = emptyRepo();
  try {
    mkdirSync(path.join(root, '.claude/skills/backslop-task/SKILL.md'), { recursive: true });
    const r = cli(root, ['init', '--tools', 'claude']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, ruRe('owned adapter output is not a file: {outRel}', { outRel: '.claude/skills/backslop-task/SKILL.md' }));
    assert.doesNotMatch(r.err, /EISDIR|node:fs/);
  } finally {
    cleanup(root);
  }
});

// A file at a component of an owned output path — a refusal in words, not an ENOTDIR stack
// from mkdirSync.
test('init --tools claude: a file at a component of an owned output path — a refusal without a stack', () => {
  const root = emptyRepo();
  try {
    put(root, '.claude/skills/backslop-task', 'a file instead of a directory\n');
    const r = cli(root, ['init', '--tools', 'claude']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, ruRe('a file sits where the adapter output path needs a directory: {rel}', { rel: '.claude/skills/backslop-task/' }));
    assert.doesNotMatch(r.err, /ENOTDIR|EISDIR|node:fs/);
  } finally {
    cleanup(root);
  }
});

test('init --tools in the root of backslop itself — a refusal before any write; --tools none and a foreign directory — as before', () => {
  const tool = toolCopy();
  const root = emptyRepo();
  try {
    const r = toolCli(tool, ['init', '--tools', 'claude']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, ruRe('--tools {tools}: {root} is the backslop repository itself (templates/ is the running tool\'s directory), adapter outputs are not laid out here; set up a stand in a directory of its own and run init --tools {tools} there', { tools: 'claude' }));
    for (const rel of ['backslop.json', 'CLAUDE.md', '.claude', 'docs', 'AGENTS.md']) {
      assert.ok(!existsSync(path.join(tool, rel)), `a refusal before the write: ${rel} is not created`);
    }
    assert.equal(toolCli(tool, ['init', '--tools', 'none']).code, 0, 'self-host without adapters is laid out');
    const again = toolCli(tool, ['init', '--tools', 'cursor,codex']);
    assert.equal(again.code, 1, again.out);
    assert.deepEqual(JSON.parse(read(tool, 'backslop.json')).tools, [], 'a refusal does not touch the config');
    assert.equal(toolCli(tool, ['init', '--tools', 'claude'], { cwd: root }).code, 0, 'a stand in its own directory');
    assert.ok(existsSync(path.join(root, 'CLAUDE.md')));
  } finally {
    cleanup(tool);
    cleanup(root);
  }
});

// Lines of a text that end in a bare LF: a CRLF file keeps none.
const bareLf = (text) => text.split('\n').slice(0, -1).filter((line) => !line.endsWith('\r')).length;

test('init keeps a CRLF AGENTS.md and .gitignore CRLF, an LF pair LF, and a rerun changes no byte', () => {
  const crlf = emptyRepo();
  const lf = emptyRepo();
  const files = ['AGENTS.md', '.gitignore'];
  try {
    put(crlf, 'AGENTS.md', '# Project\r\n\r\nOwn rules\r\n');
    put(crlf, '.gitignore', 'node_modules\r\n');
    put(lf, 'AGENTS.md', '# Project\n\nOwn rules\n');
    put(lf, '.gitignore', 'node_modules\n');
    for (const root of [crlf, lf]) {
      const r = cli(root, ['init', '--lang', 'en', '--tools', 'claude']);
      assert.equal(r.code, 0, r.err);
    }
    for (const rel of files) {
      const text = read(crlf, rel);
      assert.match(text, /backslop:start/, `${rel}: no managed block`);
      assert.equal(bareLf(text), 0, `${rel}: an LF line in a CRLF file`);
      assert.ok(text.endsWith('\r\n'), `${rel}: the last line lost its CRLF`);
      assert.ok(!read(lf, rel).includes('\r'), `${rel}: a CR in an LF file`);
    }
    const before = files.map((rel) => readFileSync(path.join(crlf, rel)));
    const r = cli(crlf, ['init', '--lang', 'en', '--tools', 'claude']);
    assert.equal(r.code, 0, r.err);
    files.forEach((rel, i) => assert.ok(readFileSync(path.join(crlf, rel)).equals(before[i]), `${rel} changed on rerun`));
  } finally {
    cleanup(crlf);
    cleanup(lf);
  }
});

test('init renders LF adapter outputs from a CRLF checkout of the tool; a CRLF AGENTS.md stays put', () => {
  const tool = toolCopy((dir) => {
    for (const [, abs] of srcFiles(path.join(dir, 'templates'), '', ['.md'])) {
      writeFileSync(abs, readFileSync(abs, 'utf8').replace(/\n/g, '\r\n'));
    }
  });
  const root = emptyRepo();
  try {
    assert.ok(read(tool, 'templates/en/skills/backslop-batch/SKILL.md').includes('\r\n'), 'the copy is not CRLF');
    put(root, 'AGENTS.md', '# Project\r\n\r\nOwn rules\r\n');
    let r = toolCli(tool, ['init', '--lang', 'en', '--tools', 'cursor'], { cwd: root });
    assert.equal(r.code, 0, r.err);
    const rules = srcFiles(path.join(root, '.cursor', 'rules'), '', ['.md', '.mdc']);
    assert.ok(rules.some(([rel]) => rel === 'backslop-batch.mdc'), 'no backslop-batch.mdc');
    for (const [rel, abs] of rules) assert.ok(!readFileSync(abs, 'utf8').includes('\r'), `${rel} carries a CR`);
    assert.equal(bareLf(read(root, 'AGENTS.md')), 0, 'AGENTS.md got an LF line');
    const before = readFileSync(path.join(root, 'AGENTS.md'));
    r = toolCli(tool, ['init', '--lang', 'en', '--tools', 'cursor'], { cwd: root });
    assert.equal(r.code, 0, r.err);
    assert.ok(readFileSync(path.join(root, 'AGENTS.md')).equals(before), 'AGENTS.md changed on rerun');
  } finally {
    cleanup(tool);
    cleanup(root);
  }
});

test('init suggests the backslop-seed skill only when an adapter is selected', () => {
  const bare = emptyRepo();
  const withAdapter = emptyRepo();
  try {
    let r = cli(bare, ['init', '--lang', 'en']);
    assert.equal(r.code, 0, r.err);
    assert.doesNotMatch(r.out, /backslop-seed/, 'no skill is installed without an adapter');
    assert.match(r.out, /--tools/, 'the hint names the flag that installs the skills');
    r = cli(withAdapter, ['init', '--lang', 'en', '--tools', 'claude']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /backslop-seed/);
  } finally {
    cleanup(bare);
    cleanup(withAdapter);
  }
});

test('init flag errors follow --lang and stay bilingual only when the language is unknown', () => {
  const cyrillic = CYRILLIC;
  for (const [args, line] of [
    [['--lang', 'en', '--tools', 'bogus'], '✖ --tools “bogus”: a comma-separated list of claude, cursor, codex, or none'],
    [['--lang', 'en', '--prefix', 'x'], '✖ --prefix “x”: expected 2–6 uppercase Latin letters or digits, starting with a letter'],
    [['--lang', 'en', '--dir', '../x'], '✖ --dir “../x”: expected a relative path inside the project'],
  ]) {
    const root = emptyRepo();
    try {
      const r = cli(root, ['init', ...args]);
      assert.equal(r.code, 1, args.join(' '));
      assert.ok(r.err.split('\n').includes(line), `${args.join(' ')}: ${r.err}`);
      assert.doesNotMatch(r.err, cyrillic, `${args.join(' ')}: English only`);
      assert.equal(existsSync(path.join(root, 'backslop.json')), false, `${args.join(' ')}: the config was written`);
    } finally {
      cleanup(root);
    }
  }
  const root = emptyRepo();
  try {
    const r = cli(root, ['init', '--tools', 'bogus']);
    assert.equal(r.code, 1);
    assert.match(r.err, new RegExp(`^✖ --tools “bogus”: a comma-separated list of claude, cursor, codex, or none \\/ ${ruRe('--tools “{raw}”: a comma-separated list of claude, cursor, codex, or none', { raw: 'bogus' }).source}$`, 'm'));
  } finally {
    cleanup(root);
  }
});

test('init --cli with a backtick names the flag, in English with --lang en, and writes nothing', () => {
  const root = emptyRepo();
  try {
    const r = cli(root, ['init', '--lang', 'en', '--cli', 'a`b']);
    assert.equal(r.code, 1);
    assert.match(r.err, /^✖ --cli must not contain a backtick/m);
    assert.equal(existsSync(path.join(root, 'backslop.json')), false);
  } finally {
    cleanup(root);
  }
});

test('an en project with an invalid tools field fails in English only', () => {
  const root = emptyRepo();
  try {
    assert.equal(cli(root, ['init', '--lang', 'en']).code, 0);
    const cfg = JSON.parse(read(root, 'backslop.json'));
    writeFileSync(path.join(root, 'backslop.json'), `${JSON.stringify({ ...cfg, tools: ['vim'] }, null, 2)}\n`);
    const r = cli(root, ['status']);
    assert.equal(r.code, 1);
    assert.match(r.err, /^✖ backslop\.json: tools must be a unique array of claude, cursor, codex$/m);
  } finally {
    cleanup(root);
  }
});

test('init in a ru project: an empty adapter list prints the Russian none, and the success line starts with init:', () => {
  const root = emptyRepo();
  try {
    const r = cli(root, ['init', '--tools', 'none']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /^✔ init: docs\/ /m);
    assert.match(r.out, new RegExp(`^ {2}${escapeRe(ru('adapter outputs: none'))}$`, 'm'));
  } finally {
    cleanup(root);
  }
});

test('init in the tool repository does not advise --tools, which it refuses there', () => {
  const tool = toolCopy();
  try {
    const r = toolCli(tool, ['init', '--lang', 'en']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /^ {2}next: /m);
    assert.doesNotMatch(r.out, /--tools|backslop-seed/);
  } finally {
    cleanup(tool);
  }
});

function refusedBeforeWrite(shape, why) {
  const root = emptyRepo();
  try {
    shape(root);
    const r = cli(root, ['init', '--lang', 'en', '--tools', 'claude']);
    assert.equal(r.code, 1, `${why}: ${r.out}`);
    assert.match(r.err, why);
    assert.doesNotMatch(r.err, /EISDIR|node:fs|\n\s+at /, `${why}: a stack`);
    assert.equal(existsSync(path.join(root, 'backslop.json')), false, `${why}: the config was written`);
    assert.equal(existsSync(path.join(root, 'docs')), false, `${why}: the docs skeleton was laid out`);
  } finally {
    cleanup(root);
  }
}

test('init --tools claude refuses a bad owned output path or a CLAUDE.md directory before any write', () => {
  refusedBeforeWrite((root) => mkdirSync(path.join(root, '.claude/skills/backslop-task/SKILL.md'), { recursive: true }), /^✖ owned adapter output is not a file: \.claude\/skills\/backslop-task\/SKILL\.md/);
  refusedBeforeWrite((root) => mkdirSync(path.join(root, 'CLAUDE.md')), /^✖ CLAUDE\.md is a directory, expected a file/);
  refusedBeforeWrite((root) => put(root, '.claude/skills/backslop-task', 'a file instead of a directory\n'), /^✖ a file sits where the adapter output path needs a directory: \.claude\/skills\/backslop-task\/SKILL\.md/);
});

test('init --tools claude refuses a symlink on an owned output path before any write', { skip: process.platform === 'win32' }, () => {
  const shared = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-shared-')));
  try {
    refusedBeforeWrite((root) => {
      mkdirSync(path.join(root, '.claude/skills'), { recursive: true });
      symlinkSync(shared, path.join(root, '.claude/skills/backslop-task'));
    }, /^✖ adapter path contains a symlink: \.claude\/skills\/backslop-task/);
    refusedBeforeWrite((root) => symlinkSync(path.join(root, 'missing-target'), path.join(root, 'CLAUDE.md')), /^✖ adapter path contains a symlink: CLAUDE\.md/);
  } finally {
    cleanup(shared);
  }
});

test('init words an unreadable docs/backlog and writes nothing', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, () => {
  const root = emptyRepo();
  const backlog = path.join(root, 'docs/backlog');
  try {
    assert.equal(cli(root, ['init', '--lang', 'en']).code, 0);
    const config = read(root, 'backslop.json');
    chmodSync(backlog, 0o000);
    const r = cli(root, ['init']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, /docs\/backlog: the directory is not readable \(EACCES\) — init cannot lay out the skeleton in it; restore read access/);
    assert.doesNotMatch(r.err, /node:fs|\n\s+at /, 'a worded refusal, not a stack');
    assert.equal(read(root, 'backslop.json'), config, 'the refusal comes before the first write');
  } finally {
    chmodSync(backlog, 0o755);
    cleanup(root);
  }
});

test('init words a status link into a locked directory and writes nothing', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, () => {
  const root = emptyRepo();
  const locked = path.join(root, 'docs/locked');
  try {
    assert.equal(cli(root, ['init', '--lang', 'en']).code, 0);
    mkdirSync(path.join(locked, 'tasks'), { recursive: true });
    rmSync(path.join(root, 'docs/backlog/queue'), { recursive: true });
    symlinkSync(path.join(locked, 'tasks'), path.join(root, 'docs/backlog/queue'));
    const config = read(root, 'backslop.json');
    chmodSync(locked, 0o000);
    const r = cli(root, ['init']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, /docs\/locked: the directory is not readable \(EACCES\) — init cannot lay out the skeleton in it/);
    assert.doesNotMatch(r.err, /node:fs|\n\s+at /, 'a worded refusal, not a stack');
    assert.equal(read(root, 'backslop.json'), config, 'the refusal comes before the first write');
  } finally {
    chmodSync(locked, 0o755);
    cleanup(root);
  }
});
