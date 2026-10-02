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
