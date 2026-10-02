// Versions: parsing, comparison, picking the newest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOL_VERSION, compareVersions, latestVersion, normalizeVersion } from '../lib/version.js';
import { MIGRATIONS } from '../lib/migrate.js';
import { ruRe } from './helpers.mjs';

test('parsing and normalisation: with and without v, junk is null', () => {
  assert.equal(normalizeVersion('1.2'), null);
  assert.equal(normalizeVersion('v1.2.3-beta'), null);
  assert.equal(normalizeVersion('10.0.7'), '10.0.7');
  assert.equal(normalizeVersion(' v0.1.0 '), '0.1.0');
  assert.equal(normalizeVersion('latest'), null);
});

test('comparison by numbers, not by strings; the newest of a list', () => {
  assert.equal(compareVersions('0.10.0', '0.9.0'), 1);
  assert.equal(compareVersions('v1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('0.1.0', '0.1.1'), -1);
  assert.throws(() => compareVersions('x', '1.0.0'), ruRe('version does not parse: “{raw}”', { raw: 'x' }));
  assert.equal(latestVersion(['v0.1.0', 'v0.10.0', 'v0.9.0', 'v0.2.0']), '0.10.0');
  assert.equal(latestVersion([]), null);
});

// A migration whose `since` is above the tool version is not caught at runtime: it would print as
// due forever (no stamp is written at from === TOOL_VERSION). Only a dev tree can diverge so.
test('every migration has a since not above the tool version', () => {
  for (const m of MIGRATIONS) {
    assert.ok(compareVersions(m.since, TOOL_VERSION) <= 0,
      `migration “${m.title('ru')}”: since ${m.since} is above the tool ${TOOL_VERSION} — raise the version before the commit`);
  }
});
