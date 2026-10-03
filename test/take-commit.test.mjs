import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { REPO } from './helpers.mjs';

const LAYERS = [['en', ['en']], ['ru', []]];
const raw = (layer, ...rel) => readFileSync(path.join(REPO, 'templates', ...layer, ...rel), 'utf8').split('\n');
const count = (text, token) => text.split(token).length - 1;
const spans = (sentence) => sentence.match(/`[^`]+`/g);
const RESET = '`reset --soft`';
const EMPTY = '`git rev-list <take>..HEAD`';
const PARENT = '`<take>^`';
const HEAD = '`<head>`';
// The Russian words are spelled by code point: a test source holds no Cyrillic character.
const cp = (hex) => hex.split(' ').map((h) => String.fromCodePoint(parseInt(h, 16))).join('');
const WORDS = {
  en: { alone: 'took this task alone', silent: 'prints nothing', several: 'took several tasks' },
  ru: {
    alone: cp('43e 434 43d 430 20 44d 442 430 20 437 430 434 430 447 430'),
    silent: cp('43d 438 447 435 433 43e 20 43d 435 20 43f 435 447 430 442 430 435 442'),
    several: cp('43d 435 441 43a 43e 43b 44c 43a 438 445 20 437 430 434 430 447'),
  },
};

// The checks name code spans, which both layers share, so no Russian literal is spelled.
function clauses(layer, which) {
  const text = which === 'block'
    ? raw(layer, 'agents-section.md').find((line) => line.startsWith('7. '))
    : raw(layer, 'skills', 'backslop-batch', 'SKILL.md').find((line) => line.startsWith('4. ') && line.includes('../backslop-task/SKILL.md#'));
  assert.ok(text, `${layer} ${which}: the step is found`);
  const sentences = text.split('. ');
  const squash = sentences.filter((s) => s.includes(PARENT));
  const kept = sentences.filter((s) => s.includes(HEAD));
  assert.equal(squash.length, 1, `${layer} ${which}: one sentence sends the reset to the parent of the take commit`);
  assert.equal(kept.length, 1, `${layer} ${which}: one sentence sends the reset to the head before the integration`);
  return { text, squash: squash[0], kept: kept[0], order: [sentences.indexOf(squash[0]), sentences.indexOf(kept[0])] };
}

for (const which of ['block', 'skill']) {
  test(`take commit: ${which} squashes a one-task take only when nothing follows it, and keeps every other take`, () => {
    for (const [lang, layer] of LAYERS) {
      const { squash, kept, order } = clauses(layer, which);
      assert.ok(squash.includes(EMPTY) && squash.includes(RESET), `${lang}: the squash sentence names the empty rev-list and the reset`);
      assert.ok(!squash.includes(HEAD), `${lang}: the squash sentence does not send the reset to the head`);
      assert.ok(kept.includes(RESET) && !kept.includes(PARENT) && !kept.includes(EMPTY), `${lang}: the keep sentence resets to the head, not to the parent of the take`);
      assert.ok(order[0] < order[1], `${lang}: the squash rule comes before the keep rule`);
      const w = WORDS[lang];
      assert.ok(squash.includes(w.alone), `${lang}: the squash sentence names the one-task predicate: ${w.alone}`);
      assert.ok(squash.includes(w.silent), `${lang}: the squash sentence names the empty-output predicate: ${w.silent}`);
      assert.ok(!kept.includes(w.alone) && !kept.includes(w.silent), `${lang}: the keep sentence carries neither predicate of the squash`);
      assert.ok(kept.includes(w.several), `${lang}: the keep sentence names the several-task take: ${w.several}`);
      assert.equal(count(squash, PARENT) + count(kept, HEAD), 2, `${lang}: each target is named once`);
    }
  });

  test(`take commit: both layers of the ${which} carry the same code spans in the squash and keep sentences`, () => {
    const [en, ru] = LAYERS.map(([, layer]) => clauses(layer, which));
    assert.deepEqual(spans(ru.squash), spans(en.squash), 'squash sentence');
    assert.deepEqual(spans(ru.kept), spans(en.kept), 'keep sentence');
  });
}

test('take commit: step 4 of backslop-batch keeps the base of gates --base apart and names the take commit by active/', () => {
  for (const [lang, layer] of LAYERS) {
    const { text } = clauses(layer, 'skill');
    assert.ok(text.includes('`gates --base`'), `${lang}: step 4 keeps the base of gates --base apart from the reset`);
    assert.ok(text.includes('`active/`'), `${lang}: step 4 names the take commit by the move into active/`);
    assert.ok(text.includes('`AGENTS.md`'), `${lang}: step 4 points to the block as the owner of the rule`);
    assert.equal(count(text, RESET), 3, `${lang}: a reset for the squash, one for the keep, one in the fold clause`);
  }
});
