// A temporary project for command checks: git with backslop.json and the status directories, built
// by hand rather than by `init`, so an `init` defect does not redden other checks. Real processes.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOL_VERSION } from '../lib/version.js';
import { RU, msg } from '../lib/i18n.js';
import { renderOutcome } from '../lib/log.js';
import { TEMPLATES_DIR, renderTemplate, templateRel } from '../lib/templates.js';

export const BIN = fileURLToPath(new URL('../bin/backslop.js', import.meta.url));
export const REPO = fileURLToPath(new URL('..', import.meta.url));

// stamp: false — a project without the stamp, like the old layout. By default the stamp is set and
// `cli` is defaultCli() at the same version: else a lint warning breaks empty-stderr asserts.
export function makeProject({ docs = 'docs', git = true, stamp = true } = {}) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-proj-')));
  const cfg = { prefix: 'BS', docs, gates: [], lang: 'ru', tools: [] };
  if (stamp) cfg.version = TOOL_VERSION;
  writeFileSync(path.join(root, 'backslop.json'), `${JSON.stringify(cfg, null, 2)}\n`);
  for (const d of ['backlog/triage', 'backlog/queue', 'backlog/active', 'backlog/deferred', 'backlog/minor', 'archive', 'adr', 'reference']) {
    mkdirSync(path.join(root, docs, d), { recursive: true });
  }
  writeFileSync(path.join(root, docs, 'README.md'), '# Documentation\n\n| Document | Topic | Status |\n|---|---|---|\n| [backlog/](backlog/README.md) | tracker | Live |\n');
  writeFileSync(path.join(root, docs, 'backlog', 'README.md'), '# Backlog\n');
  writeFileSync(path.join(root, docs, 'archive', 'README.md'), '# Archive\n');
  if (git) {
    run(root, ['init', '-q', '-b', 'main']);
    run(root, ['config', 'user.email', 'test@example.com']);
    run(root, ['config', 'user.name', 'test']);
    // Pin against the global config: without renames `git mv` is indistinguishable from renameSync
    // in status, and an unsigned-commit failure breaks the fixture on the first snapshot.
    run(root, ['config', 'status.renames', 'true']);
    run(root, ['config', 'commit.gpgsign', 'false']);
  }
  return root;
}

// The git exit code is checked: a swallowed failure would leave a file out of the index, and the
// `git mv` branch check would quietly become a `renameSync` branch check.
export function run(root, args) {
  const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  if (r.status !== 0) {
    const why = (r.stderr ?? '').trim() || (r.stdout ?? '').trim() || r.error?.message || `exit code ${r.status}`;
    throw new Error(`git ${args.join(' ')}: ${why}`);
  }
  return r;
}

export function gitAll(root, message = 'snapshot') {
  run(root, ['add', '-A']);
  run(root, ['commit', '-qm', message]);
}

export function cli(root, args, { cwd = root, env = {} } = {}) {
  return runBin(BIN, args, cwd, env);
}

// --no-warnings is appended to the inherited NODE_OPTIONS: Node warnings (NO_COLOR against
// FORCE_COLOR, Experimental) would redden empty-stderr asserts with output that is not ours.
function runBin(bin, args, cwd, env) {
  const nodeOptions = `${process.env.NODE_OPTIONS ?? ''} --no-warnings`.trim();
  const r = spawnSync(process.execPath, [bin, ...args], { cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', NODE_OPTIONS: nodeOptions, ...env } });
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
}

// A tool copy in mkdtemp — for self-host probes (template parity, gate 11) and a foreign template
// set. Probes put CHANGELOG.md themselves; `mutate` edits the copy before the first run.
export function toolCopy(mutate = () => {}) {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-tool-')));
  for (const rel of ['bin', 'lib', 'templates', 'package.json']) {
    cpSync(path.join(REPO, rel), path.join(dir, rel), { recursive: true });
  }
  mutate(dir);
  return dir;
}

// A tool copy with a fixture CHANGELOG.md: changelog probes read these sections, not the real
// history. Sections: Unreleased, v<TOOL_VERSION>, v0.2.0, v0.1.0, newest first.
export function changelogTool() {
  return toolCopy((dir) => writeFileSync(path.join(dir, 'CHANGELOG.md'), [
    '# Changelog\n', '## Unreleased\n', '- **Unreleased entry** — not released yet.\n',
    `## v${TOOL_VERSION} — 2026-01-03\n`, '- **Current entry** — the current version.\n',
    '## v0.2.0 — 2026-01-02\n', '- **Second entry** — the second version.\n',
    '## v0.1.0 — 2026-01-01\n', '- **First entry** — the first version.\n',
  ].join('\n')));
}

// A command of the tool copy `tool`; `cwd` is the project it runs in, the copy itself by default
// (self-host). The environment is the same as in `cli`.
export function toolCli(tool, args, { cwd = tool, env = {} } = {}) {
  return runBin(path.join(tool, 'bin', 'backslop.js'), args, cwd, env);
}

export function read(root, rel) {
  return readFileSync(path.join(root, ...rel.split('/')), 'utf8');
}

export function put(root, rel, text) {
  const abs = path.join(root, ...rel.split('/'));
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, text);
}

export function cleanup(root) {
  rmSync(root, { recursive: true, force: true });
}

// The paragraphs of the `result.md` template after the heading, with the id and date filled in as
// `archive` lays them. The stub probe runs on them, not on an invented line.
export function resultTemplateParagraphs(lang, { id = 'BS-4', date = '2026-08-01' } = {}) {
  const text = renderTemplate(templateRel(lang, 'result.md'), { id, date, prefix: id.split('-')[0], cli: 'backslop', probeVerified: '' });
  return text.trim().split(/\n\s*\n/).slice(1);
}

// The Russian expectations of the suite: the text of a `lang: ru` project comes from
// templates/i18n/ru.mjs through the lookup the code uses, never from a literal in a test.
export const FIELD = RU.fieldNames;
export const SECTION = RU.sectionNames;

export function ru(en, params = {}) {
  if (!Object.hasOwn(RU.messages, en)) throw new Error(`no ru entry: ${en}`);
  return msg('ru', en, params);
}

export function escapeRe(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// A placeholder value that matches any text in `ruRe`.
export const ANY = '\uE000';

// The Russian message as a regular expression that matches it literally; a placeholder without a
// param, or with `ANY`, matches any text.
export function ruRe(en, params = {}, flags = '') {
  const filled = { ...params };
  for (const [, name] of en.matchAll(/\{([A-Za-z_$][\w$]*)\}/g)) filled[name] ??= ANY;
  return new RegExp(escapeRe(ru(en, filled)).replaceAll(ANY, '[\\s\\S]*?'), flags);
}

// A task card of a `lang: ru` project: the `# ID · title` line, the header fields under their
// Russian names (`fields` keyed as fieldNames), then sections as [sectionNames key, body] pairs.
export function ruCard(id, title, fields = {}, sections = []) {
  let text = `# ${id} · ${title}\n`;
  const head = Object.entries(fields).map(([key, value]) => `- **${FIELD[key]}:** ${value}`);
  if (head.length) text += `\n${head.join('\n')}\n`;
  for (const [key, body] of sections) text += `\n## ${SECTION[key]}\n\n${body}\n`;
  return text;
}

// The outcome word of a `lang: ru` result.md or journal line, capitalised as a sentence opens;
// kind: completed | rejected | merged | batched.
export function ruOutcome(kind, target = null) {
  const word = renderOutcome(kind, target, 'ru');
  return word[0].toUpperCase() + word.slice(1);
}

// A result.md of a `lang: ru` project: the heading and the "Closed <date>." stamp come from the
// Russian template, `rest` follows the stamp in the first paragraph.
export function ruResult(id, date, rest = '') {
  const [heading, closed] = renderTemplate(templateRel('ru', 'result.md'), { id, date, prefix: id.split('-')[0], cli: 'backslop', probeVerified: '' }).split('\n\n');
  return `${heading}\n\n${closed.match(/^\*\*.+?\.\*\*/)[0]}${rest ? ` ${rest}` : ''}\n`;
}

// A Russian template as the code renders it, for the given placeholder values.
export function ruTemplate(rel, vars = {}) {
  return renderTemplate(templateRel('ru', rel), vars);
}

// The line of templates/<rel> that is the Russian twin of the English line holding `en`; the two
// layers keep their lines aligned.
export function ruTwinLine(rel, en) {
  const read = (...parts) => readFileSync(path.join(TEMPLATES_DIR, ...parts, ...rel.split('/')), 'utf8').split('\n');
  const [enLines, ruLines] = [read('en'), read()];
  if (enLines.length !== ruLines.length) throw new Error(`${rel}: the Russian twin has a different line count`);
  const i = enLines.findIndex((line) => line.includes(en));
  if (i === -1) throw new Error(`${rel}: no English line holds “${en}”`);
  return ruLines[i];
}

// A Russian template text as a regular expression: every `{{placeholder}}` matches any text, or
// the literal text `fill` gives for it.
export function ruTextRe(text, fill = {}) {
  return new RegExp(escapeRe(text).replace(/\\\{\\\{([A-Za-z]+)\\\}\\\}/g, (_, name) => (name in fill ? escapeRe(fill[name]) : '[\\s\\S]*?')));
}

// The Russian twin of a template line as a regular expression: the line where templates/en/<rel>
// holds `en`.
export function ruLineRe(rel, en, fill = {}) {
  return ruTextRe(ruTwinLine(rel, en), fill);
}

// The raw lines of a Russian template file, placeholders unfilled.
export function ruTemplateLines(rel) {
  return readFileSync(path.join(TEMPLATES_DIR, ...rel.split('/')), 'utf8').split('\n');
}

// The regular-expression source of a bold task header label, `- **<Russian field name>:**`.
export const fieldSrc = (key) => `- \\*\\*${FIELD[key]}:\\*\\*`;

// A header field line of a `lang: ru` task as a regular expression; `valueSrc` follows the label.
export function fieldRe(key, valueSrc = '', flags = '') {
  return new RegExp(fieldSrc(key) + valueSrc, flags);
}

// The "Commands:" heading line of the Russian `help` text.
export const RU_COMMANDS = RU.help('0').split('\n').find((line) => line.endsWith(':'));

// "<command>: killed by SIGKILL" in the project language, as a regular expression.
export function killedRe(command) {
  return new RegExp(escapeRe(`${command}: ${ru('killed by {signal}', { signal: 'SIGKILL' })}`));
}

export const KILLED = ru('killed by {signal}', { signal: 'SIGKILL' });

// The text of the Russian message `en` up to its first placeholder, as a regular expression.
export function ruHeadRe(en) {
  const filled = Object.fromEntries([...en.matchAll(/\{([A-Za-z_$][\w$]*)\}/g)].map(([, name]) => [name, '\0']));
  return new RegExp(escapeRe(ru(en, filled).split('\0')[0]));
}

// The outcome word of a `lang: ru` journal line, as the journal prints it (lower case).
export function ruOutcomeWord(kind, target = null) {
  return renderOutcome(kind, target, 'ru');
}

// The result heading line of the Russian result.md template, for the given task id.
export function ruResultHeading(id) {
  return ruTemplate('result.md', { id, date: '2026-01-01', prefix: id.split('-')[0], cli: 'backslop', probeVerified: '' }).split('\n')[0];
}

// The spellings a parser word’s regular-expression source stands for: alternatives split,
// one-letter classes spread, the lookbehind guards and `\s+` reduced to what they match in text.
function spellings(source) {
  const plain = source.replace(/\(\?<!(?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)/g, '').replaceAll('\\s+', ' ');
  return plain.split('|').flatMap((alternative) => {
    const m = alternative.match(/^(.*)\[([^\]]+)\](.*)$/);
    return m ? [...m[2]].map((c) => m[1] + c + m[3]) : [alternative];
  });
}

const PARSER_WORDS = Object.fromEntries(Object.entries(RU.parserWords).filter(([key]) => key !== 'workerBoundaries').map(([key, source]) => [key, spellings(source)]));

// Code-point built inputs: Russian forms that look like vocabulary words but are not (the masculine
// "rejected", "withdrawal", "outcomes", "refusal", "duplicate", "done"); no vocabulary holds them.
const LOOKALIKES = {
  rejectedMasculine: String.fromCodePoint(0x43E, 0x442, 0x43A, 0x43B, 0x43E, 0x43D, 0x451, 0x43D),
  withdrawnNoun: String.fromCodePoint(0x441, 0x43D, 0x44F, 0x442, 0x438, 0x435),
  outcomePlural: String.fromCodePoint(0x438, 0x441, 0x445, 0x43E, 0x434, 0x44B),
  byRefusal: String.fromCodePoint(0x43E, 0x442, 0x43A, 0x430, 0x437, 0x43E, 0x43C),
  refusal: String.fromCodePoint(0x43E, 0x442, 0x43A, 0x430, 0x437),
  duplicate: String.fromCodePoint(0x434, 0x443, 0x431, 0x43B, 0x44C),
  done: String.fromCodePoint(0x433, 0x43E, 0x442, 0x43E, 0x432, 0x43E),
};

// Fills the `{word}` tokens of a Russian test text from `RU.parserWords`; the token forms are
// described in the module map, section Tests.
export function ruExpand(text) {
  return text.replace(/\{([A-Za-z]+)(?:\.(\d))?(-)?\}/g, (token, name, index, cut) => {
    const key = name[0].toLowerCase() + name.slice(1);
    let word;
    if (key === 'with') word = PARSER_WORDS.rejected[4].split(' ')[1];
    else if (key in LOOKALIKES) word = LOOKALIKES[key];
    else if (PARSER_WORDS[key]) word = PARSER_WORDS[key][Number(index ?? 0)];
    else throw new Error(`unknown ruExpand token: ${token}`);
    if (cut) word = word.slice(0, -1);
    return name[0] === name[0].toUpperCase() ? word[0].toUpperCase() + word.slice(1) : word;
  });
}

// The words of the probe in the Russian layer, as stems of the name `probeVerified` spells out; a
// short stem takes at most two more letters, so that it does not match an unrelated longer word.
const PROBE_STEMS = ruTemplate('probe/verified.md').match(/\p{L}+/gu).map((w) => w.slice(0, Math.max(4, w.length - 3)));
export const PROBE_WORDS = new RegExp(`probe|mutation|${PROBE_STEMS.map((s) => (s.length > 5 ? `${s}\\p{L}*` : `${s}\\p{L}{0,2}(?!\\p{L})`)).join('|')}`, 'iu');
