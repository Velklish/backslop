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
