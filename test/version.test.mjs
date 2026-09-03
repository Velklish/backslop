// Версии: разбор, сравнение, выбор старшей.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOL_VERSION, compareVersions, latestVersion, normalizeVersion, parseVersion } from '../lib/version.js';

test('версия инструмента — из package.json, форма X.Y.Z', () => {
  assert.match(TOOL_VERSION, /^\d+\.\d+\.\d+$/);
});

test('разбор и нормализация: с v и без, мусор — null', () => {
  assert.deepEqual(parseVersion('v1.2.3'), [1, 2, 3]);
  assert.deepEqual(parseVersion('10.0.7'), [10, 0, 7]);
  assert.equal(parseVersion('1.2'), null);
  assert.equal(parseVersion('v1.2.3-beta'), null);
  assert.equal(normalizeVersion(' v0.1.0 '), '0.1.0');
  assert.equal(normalizeVersion('latest'), null);
});

test('сравнение по числам, а не по строкам; старшая из списка', () => {
  assert.equal(compareVersions('0.10.0', '0.9.0'), 1);
  assert.equal(compareVersions('v1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('0.1.0', '0.1.1'), -1);
  assert.throws(() => compareVersions('x', '1.0.0'), /не разбирается: «x»/);
  assert.equal(latestVersion(['v0.1.0', 'v0.10.0', 'v0.9.0', 'junk', 'v0.2.0']), '0.10.0');
  assert.equal(latestVersion(['junk']), null);
});
