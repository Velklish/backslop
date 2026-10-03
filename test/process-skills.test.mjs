import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { PROBE_WORDS, REPO, ruTwinLine } from './helpers.mjs';

const LAYERS = [['en', ['en']], ['ru', []]];
const template = (layer, ...rel) => readFileSync(path.join(REPO, 'templates', ...layer, ...rel), 'utf8');

test('skills: the acceptance recipe of backslop-task commits the draft with --cleanup=verbatim', () => {
  for (const [lang, layer] of LAYERS) {
    const text = template(layer, 'skills', 'backslop-task', 'SKILL.md');
    assert.ok(text.includes('git commit --cleanup=verbatim -F "$(git rev-parse --git-dir)/BACKSLOP_DRAFT"'), `${lang}: the recipe names the flag`);
    assert.doesNotMatch(text, /git commit -F/, `${lang}: no commit of the draft without the flag`);
  }
});

test('skills: the acceptance recipe of backslop-task carries the attachment branch: squash, fold, commit the draft', () => {
  for (const [lang, layer] of LAYERS) {
    const text = template(layer, 'skills', 'backslop-task', 'SKILL.md');
    const branch = text.split('\n').find((line) => line.includes('git commit -m "{{prefix}}-N: '));
    assert.ok(branch, `${lang}: the recipe has no squash commit for an attachment`);
    const squash = branch.indexOf('git commit -m "{{prefix}}-N: ');
    const fold = branch.indexOf('{{cli}} fold N >', squash);
    const draft = branch.indexOf('git commit --cleanup=verbatim -F', fold);
    assert.ok(fold !== -1 && draft !== -1, `${lang}: the attachment branch does not run the fold and commit the draft after the squash`);
  }
  // Code points spell the Russian clause: Cyrillic lives in templates/ only.
  const ruWords = [
    [1092, 1072, 1081, 1083, 44], [1082, 1086, 1090, 1086, 1088, 1099, 1081], 'git',
    [1080, 1075, 1085, 1086, 1088, 1080, 1088, 1091, 1077, 1090, 44],
    [1074, 1083, 1086, 1078, 1077, 1085, 1080, 1077, 1084], [1085, 1077],
    [1089, 1095, 1080, 1090, 1072, 1077, 1090, 1089, 1103, 44], [1077, 1089, 1083, 1080], 'git',
    [1085, 1077], [1080, 1075, 1085, 1086, 1088, 1080, 1088, 1091, 1077, 1090],
    [1089, 1072, 1084], [1082, 1072, 1090, 1072, 1083, 1086, 1075],
    [1079, 1072, 1076, 1072, 1095, 1080]
  ];
  const ignoreRule = {
    en: 'a file that git ignores is not one, unless git ignores the task directory itself',
    ru: ruWords.map((word) => (typeof word === 'string' ? word : String.fromCodePoint(...word))).join(' '),
  };
  for (const [lang, layer] of LAYERS) {
    const branch = template(layer, 'skills', 'backslop-task', 'SKILL.md').split('\n').find((line) => line.includes('git commit -m "{{prefix}}-N: '));
    assert.ok(branch.includes(ignoreRule[lang]), `${lang}: the branch must say a file git ignores is not an attachment unless the task directory is ignored`);
  }
  assert.match(template(['en'], 'skills', 'backslop-task', 'SKILL.md'), /Do not commit between steps 1 and 3\*\* \(except in the attachment branch below\)/, 'the no-commit rule names its exception');
});

test('skills: the batch skill names the probe only with the probe field, in the brief sentence', () => {
  const rel = 'skills/backslop-batch/SKILL.md';
  const anchor = 'The brief text is assembled by a command';
  for (const [lang, layer] of LAYERS) {
    const text = template(layer, ...rel.split('/'));
    const line = lang === 'ru' ? ruTwinLine(rel, anchor) : text.split('\n').find((l) => l.includes(anchor));
    assert.ok(line, `${lang}: the brief sentence is found`);
    const [fixed, declared] = line.split('`probe`');
    assert.doesNotMatch(fixed, PROBE_WORDS, `${lang}: the fixed sections list no probe`);
    assert.match(declared, PROBE_WORDS, `${lang}: the probe items come with the probe field`);
    assert.doesNotMatch(text.replace(line, ''), PROBE_WORDS, `${lang}: the rest of the skill, the review table included, names no probe`);
  }
});

test('seed: the Russian adr-backfill reference puts the survey wording in a parenthesis', () => {
  const line = ruTwinLine('skills/backslop-seed/references/adr-backfill.md', 'Show the owner the complete list of candidates');
  assert.match(line, /\([^()]*AGENTS\.md\)/, 'the pointer to the owner-talk wording is a parenthesis, one voice per sentence');
});

test('templates: lint fails without the link to an ADR, not without a table row', () => {
  // Code points spell the Russian for "without the link": Cyrillic lives in templates/ only.
  const word = (...codes) => String.fromCodePoint(...codes);
  const bez = word(1073, 1077, 1079);
  const link = word(1089, 1089, 1099, 1083, 1082, 1080);
  const withoutLink = new RegExp(`${bez} ${link},? \`\\{\\{cli\\}\\} lint\``);
  for (const [rel, anchor] of [['docs/README.md', 'Create a new ADR with'], ['skills/backslop-seed/references/adr-backfill.md', 'in the same pass; without']]) {
    const en = template(['en'], ...rel.split('/')).split('\n').find((line) => line.includes(anchor));
    assert.match(en, /without the link, `\{\{cli\}\} lint` fails/, `en ${rel}: the claim is about the link`);
    assert.doesNotMatch(en, /without (the row|it)/, `en ${rel}: no claim about a row`);
    assert.match(ruTwinLine(rel, anchor), withoutLink, `ru ${rel}: the claim is about the link`);
  }
});
