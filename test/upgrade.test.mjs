// Обновление проекта: форма пина в cli, перепись гейтов, выжимка CHANGELOG, а также upgrade,
// migrate и changelog настоящим процессом. Источник релизов — локальный git-репозиторий с
// тегами: ls-remote читает его так же, как GitHub, а сеть тестам не нужна.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseCli } from '../lib/config.js';
import { changelogSince } from '../lib/changelog.js';
import { listReleaseTags, rewriteGates } from '../lib/upgrade.js';
import { TOOL_VERSION } from '../lib/version.js';
import { BIN, cleanup, cli, makeProject, put, read } from './helpers.mjs';

function releasesRepo(tags) {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-src-')));
  const g = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 'test@example.com');
  g('config', 'user.name', 'test');
  for (const tag of tags) {
    writeFileSync(path.join(dir, 'release.txt'), `${tag}\n`);
    g('add', '-A');
    g('commit', '-qm', tag);
    g('tag', tag);
  }
  return dir;
}

function setConfig(root, patch) {
  const cfg = JSON.parse(read(root, 'backslop.json'));
  put(root, 'backslop.json', `${JSON.stringify({ ...cfg, ...patch }, null, 2)}\n`);
}

const config = (root) => JSON.parse(read(root, 'backslop.json'));

test('parseCli: GitHub и exact npm pin сохраняют npx-флаги; другие формы пина не несут', () => {
  const pinned = parseCli('npx github:me/proj#v0.1.0');
  assert.equal(pinned.pin, '0.1.0');
  assert.equal(pinned.repoUrl, 'https://github.com/me/proj.git');
  assert.equal(pinned.withPin('0.2.0'), 'npx github:me/proj#v0.2.0');
  assert.equal(parseCli('npx github:me/proj').pin, null);
  assert.equal(parseCli('npx github:me/proj.git#1.0.0').pin, '1.0.0');
  assert.equal(parseCli('backslop'), null);
  assert.equal(parseCli('node bin/backslop.js'), null);
  const npm = parseCli('npx --yes -q backslop@01.2.3');
  assert.equal(npm.pin, '1.2.3');
  assert.equal(npm.repoUrl, null, 'npm-форма не выдумывает источник тегов');
  assert.equal(npm.withPin('v2.0.0'), 'npx --yes -q backslop@2.0.0');
  assert.equal(parseCli('npx backslop').pin, null);
  assert.equal(parseCli('npx backslop').repoUrl, null);
  assert.equal(parseCli('npx backslop').withPin('0.2.0'), 'npx backslop@0.2.0');
  assert.equal(parseCli('npx --yes backslop@latest').pin, null);
  assert.equal(parseCli('npx --yes backslop@latest').withPin('2.0.0'), 'npx --yes backslop@2.0.0');
  const flagged = parseCli('npx --yes -q github:me/proj#v01.2.3');
  assert.equal(flagged.pin, '1.2.3', 'пин нормализуется');
  assert.equal(flagged.withPin('v0.2.0'), 'npx --yes -q github:me/proj#v0.2.0', 'флаги npx сохраняются');
});

test('upgrade npm-пина: теги только из explicit source, флаги и gates сохраняются', () => {
  const root = makeProject({ git: false });
  const src = releasesRepo(['v0.2.0', 'v0.3.0']);
  try {
    setConfig(root, { cli: 'npx --yes -q backslop@0.2.0', gates: ['npx --yes -q backslop@0.2.0 lint', 'npm test'], version: '0.2.0' });
    let r = cli(root, ['upgrade', '--pin-only']);
    assert.equal(r.code, 1);
    assert.match(r.err, /источник релизов .*source/);
    assert.equal(config(root).cli, 'npx --yes -q backslop@0.2.0');

    setConfig(root, { source: src });
    r = cli(root, ['upgrade', '--pin-only']);
    assert.equal(r.code, 0, r.err);
    assert.equal(config(root).cli, 'npx --yes -q backslop@0.3.0');
    assert.deepEqual(config(root).gates, ['npx --yes -q backslop@0.3.0 lint', 'npm test']);
  } finally {
    cleanup(root);
    rmSync(src, { recursive: true, force: true });
  }
});

test('rewriteGates: меняется только команда, начинающаяся со старого cli', () => {
  assert.deepEqual(
    rewriteGates(['npx github:me/proj#v0.1.0 lint', 'npm test', 'npx github:me/proj#v0.1.0'], 'npx github:me/proj#v0.1.0', 'npx github:me/proj#v0.2.0'),
    ['npx github:me/proj#v0.2.0 lint', 'npm test', 'npx github:me/proj#v0.2.0'],
  );
  assert.deepEqual(rewriteGates(['npx github:me/proj#v0.1.0x lint'], 'npx github:me/proj#v0.1.0', 'npx github:me/proj#v0.2.0'),
    ['npx github:me/proj#v0.1.0x lint'], 'подстрока без пробела — другая команда');
});

test('changelogSince: секции строго после since и не позже to, без «Не выпущено»', () => {
  const text = '# Changelog\n\n## Не выпущено\n\n- **x**\n\n## v0.3.0 — 2026-10-01\n\n- **три**\n\n## v0.2.0 — 2026-09-03\n\n- **два**\n\n## v0.1.0 — 2026-09-03\n\n- **один**\n';
  assert.equal(changelogSince(text, '0.1.0', '0.2.0'), '## v0.2.0 — 2026-09-03\n- **два**');
  assert.match(changelogSince(text, '0.1.0', null), /три[\s\S]*два/);
  assert.doesNotMatch(changelogSince(text, '0.1.0', null), /один|Не выпущено/);
  assert.equal(changelogSince(text, '0.3.0', null), '');
});

test('listReleaseTags: теги локального репозитория как у GitHub', () => {
  const src = releasesRepo(['v0.1.0', 'v0.2.0', 'not-a-release']);
  try {
    assert.deepEqual(listReleaseTags(src).sort(), ['0.1.0', '0.2.0']);
  } finally {
    rmSync(src, { recursive: true, force: true });
  }
});

test('upgrade --dry-run показывает план и ничего не пишет; --pin-only переставляет пин, lint предупреждает', () => {
  const root = makeProject({ git: false });
  const src = releasesRepo(['v0.1.0', 'v0.2.0']);
  try {
    setConfig(root, { cli: 'npx github:me/proj#v0.1.0', gates: ['npx github:me/proj#v0.1.0 lint', 'npm test'], version: '0.1.0', source: src });
    const before = read(root, 'backslop.json');
    let r = cli(root, ['upgrade', '--dry-run']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /v0\.1\.0 → v0\.2\.0/);
    assert.match(r.out, /npx github:me\/proj#v0\.2\.0/);
    assert.equal(read(root, 'backslop.json'), before);

    r = cli(root, ['upgrade', '--pin-only']);
    assert.equal(r.code, 0, r.err);
    const cfg = config(root);
    assert.equal(cfg.cli, 'npx github:me/proj#v0.2.0');
    assert.deepEqual(cfg.gates, ['npx github:me/proj#v0.2.0 lint', 'npm test']);
    assert.equal(cfg.version, '0.1.0', 'штамп ставит только новая версия через migrate/init');

    r = cli(root, ['lint']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.err, /пин в cli v0\.2\.0 расходится со штампом v0\.1\.0/);

    setConfig(root, { version: '0.2.0' });
    r = cli(root, ['upgrade']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /уже на v0\.2\.0/);
    r = cli(root, ['upgrade', '--to', 'v9.9.9']);
    assert.equal(r.code, 1);
    assert.match(r.err, /тега v9\.9\.9/);
    r = cli(root, ['upgrade', '--to', 'v0.1.0']);
    assert.equal(r.code, 1);
    assert.match(r.err, /старше v0\.2\.0/);
    assert.equal(config(root).cli, 'npx github:me/proj#v0.2.0', 'отказ ничего не переставил');
  } finally {
    cleanup(root);
    rmSync(src, { recursive: true, force: true });
  }
});

test('upgrade целиком: migrate и init новой версией, штамп и скиллы, выжимка CHANGELOG', () => {
  const root = makeProject({ git: false });
  const src = releasesRepo(['v0.1.0', `v${TOOL_VERSION}`]);
  try {
    setConfig(root, { cli: `node "${BIN}"`, gates: [`node "${BIN}" lint`], version: '0.0.9', source: src, tools: ['claude'] });
    rmSync(path.join(root, 'docs', 'README.md'));
    const r = cli(root, ['upgrade']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.err, /пин не меняется/);
    assert.match(r.out, /→ node .*backslop\.js" migrate/);
    assert.match(r.out, /→ node .*backslop\.js" init/);
    assert.match(r.out, /## v0\.1\.0/);
    assert.equal(config(root).version, TOOL_VERSION);
    assert.ok(existsSync(path.join(root, '.claude/skills/backslop-task/SKILL.md')));
    const lint = cli(root, ['lint']);
    assert.equal(lint.code, 0, lint.err);
    assert.doesNotMatch(lint.err, /штамп/);
  } finally {
    cleanup(root);
    rmSync(src, { recursive: true, force: true });
  }
});

test('upgrade без источника релизов отказывает; migrate и changelog в одиночку', () => {
  const root = makeProject({ git: false, stamp: false });
  try {
    setConfig(root, { cli: 'node bin/backslop.js' });
    let r = cli(root, ['upgrade']);
    assert.equal(r.code, 1);
    assert.match(r.err, /обновлять нечего/);

    r = cli(root, ['migrate', '--dry-run']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /мигрировать нечего/);
    assert.equal(config(root).version, undefined);
    r = cli(root, ['migrate']);
    assert.equal(r.code, 0, r.err);
    assert.equal(config(root).version, TOOL_VERSION);
    assert.match(r.out, /штамп версии: не было → v/);

    r = cli(root, ['changelog', '--since', 'v0.0.1']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /## v0\.1\.0/);
    r = cli(root, ['changelog', '--since', 'v99.0.0']);
    assert.match(r.out, /записей после v99\.0\.0 и до v\d+\.\d+\.\d+ нет/);
    r = cli(root, ['changelog', '--since', 'latest']);
    assert.equal(r.code, 1);
  } finally {
    cleanup(root);
  }
});

// Полный путь пользователя: форма npx, перепись пина, запуск новой версии тем самым cli.
// Сеть подменяет шим `npx` в PATH: он отбрасывает спеку и запускает локальный bin.
function npxShim() {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-npx-')));
  const shim = path.join(dir, 'npx');
  writeFileSync(shim, `#!/bin/sh\nshift\nexec "${process.execPath}" "${BIN}" "$@"\n`);
  chmodSync(shim, 0o755);
  return dir;
}

test('upgrade по форме npx: пробный запуск до пина, пин и гейты, скиллы новой версией', { skip: process.platform === 'win32' }, () => {
  const root = makeProject({ git: false, stamp: false });
  const src = releasesRepo(['v0.1.0', `v${TOOL_VERSION}`]);
  const shim = npxShim();
  try {
    setConfig(root, { cli: 'npx github:me/proj', gates: ['npx github:me/proj lint', 'npm test'], source: src, tools: ['claude'] });
    rmSync(path.join(root, 'docs', 'README.md'));
    const env = { PATH: `${shim}${path.delimiter}${process.env.PATH}` };
    let r = cli(root, ['upgrade'], { env });
    assert.equal(r.code, 0, r.err);
    const lines = r.out.split('\n').filter((l) => l.startsWith('  → '));
    assert.match(lines[0], /version$/, 'первым идёт пробный запуск новой версии');
    assert.match(lines[1], /migrate$/);
    assert.match(lines[2], /init$/);
    const cfg = config(root);
    assert.equal(cfg.cli, `npx github:me/proj#v${TOOL_VERSION}`);
    assert.deepEqual(cfg.gates, [`npx github:me/proj#v${TOOL_VERSION} lint`, 'npm test']);
    assert.equal(cfg.version, TOOL_VERSION);
    assert.match(read(root, '.claude/skills/backslop-task/SKILL.md'), new RegExp(`npx github:me/proj#v${TOOL_VERSION.replace(/\./g, '\\.')}`));
    r = cli(root, ['lint'], { env });
    assert.equal(r.code, 0, r.err);
    assert.doesNotMatch(r.err, /⚠/);

    // Сбой после пина: init отказывает на маркере без пары — upgrade говорит, как довести.
    setConfig(root, { cli: 'npx github:me/proj#v0.1.0', version: '0.1.0' });
    put(root, 'AGENTS.md', '<!-- backslop:start -->\nбез пары\n');
    r = cli(root, ['upgrade'], { env });
    assert.equal(r.code, 1);
    assert.match(r.err, /Пин уже v\d+\.\d+\.\d+: доведи руками/);
    assert.equal(config(root).cli, `npx github:me/proj#v${TOOL_VERSION}`);
  } finally {
    cleanup(root);
    rmSync(src, { recursive: true, force: true });
    rmSync(shim, { recursive: true, force: true });
  }
});

test('upgrade: сбой пробного запуска не трогает пин; init и migrate отказывают на штампе новее себя', { skip: process.platform === 'win32' }, () => {
  const root = makeProject({ git: false });
  const src = releasesRepo([`v${TOOL_VERSION}`]);
  const broken = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-npx-')));
  writeFileSync(path.join(broken, 'npx'), '#!/bin/sh\nexit 3\n');
  chmodSync(path.join(broken, 'npx'), 0o755);
  try {
    setConfig(root, { cli: 'npx github:me/proj#v0.1.0', version: '0.1.0', source: src });
    const r = cli(root, ['upgrade'], { env: { PATH: `${broken}${path.delimiter}${process.env.PATH}` } });
    assert.match(r.err, /кодом 3/);
    assert.equal(r.code, 1);
    assert.match(r.err, /Пин и штамп не тронуты/);
    assert.equal(config(root).cli, 'npx github:me/proj#v0.1.0');
    assert.equal(config(root).version, '0.1.0');

    setConfig(root, { version: '9.9.9' });
    assert.match(cli(root, ['init']).err, /штамп v9\.9\.9 новее инструмента/);
    assert.match(cli(root, ['migrate']).err, /штамп v9\.9\.9 новее инструмента/);
    assert.equal(config(root).version, '9.9.9', 'штамп новее себя не затирается');
  } finally {
    cleanup(root);
    rmSync(src, { recursive: true, force: true });
    rmSync(broken, { recursive: true, force: true });
  }
});

test('changelog без --since: только секции до --to', () => {
  const root = makeProject({ git: false });
  try {
    const r = cli(root, ['changelog', '--to', 'v0.1.0']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /## v0\.1\.0/);
    assert.doesNotMatch(r.out, /## v0\.2\.0/);
    assert.match(cli(root, ['changelog', '--to', 'v0.0.1']).out, /^записей до v0\.0\.1 нет\n$/);
  } finally {
    cleanup(root);
  }
});
