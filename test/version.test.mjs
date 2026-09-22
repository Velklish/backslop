// Версии: разбор, сравнение, выбор старшей.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOL_VERSION, compareVersions, latestVersion, normalizeVersion, parseVersion } from '../lib/version.js';
import { MIGRATIONS } from '../lib/migrate.js';

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

// Миграция со `since` выше инструмента ничем не ловится в рантайме: `migrate` сравнивает
// штамп проекта только с `since`, и такая запись печатается должной при каждом запуске, а
// отметиться применённой не может — штамп не пишется при from === TOOL_VERSION. Разойтись
// числа могут только здесь, в dev-дереве между коммитом миграции и бампом версии, поэтому
// сторожит их тест, а не проверка в команде.
test('у каждой миграции since не выше версии инструмента', () => {
  for (const m of MIGRATIONS) {
    assert.ok(compareVersions(m.since, TOOL_VERSION) <= 0,
      `миграция «${m.title.ru}»: since ${m.since} выше инструмента ${TOOL_VERSION} — подними версию до коммита`);
  }
});
