// Project upgrade: pin, gates, CHANGELOG summary and commands as processes; releases are a local
// git repo with tags, no network. The npx stand-in is a node script behind a per-platform launcher.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseCli } from '../lib/config.js';
import { changelogSince } from '../lib/changelog.js';
import { listReleaseTags, rewriteCommand, rewriteGates, rewriteProsePins, run as upgrade } from '../lib/upgrade.js';
import { CliError } from '../lib/util.js';
import { renderTemplate } from '../lib/templates.js';
import { LEGACY_README_LINES, LEGACY_ROADMAP } from '../lib/legacy-roadmap.js';
import { TOOL_VERSION } from '../lib/version.js';
import { BIN, cleanup, cli, gitAll, makeProject, put, read, run } from './helpers.mjs';

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

// Копия правил ведения у проекта на прежней версии: одна строка расходится с шаблоном этой.
const staleRules = (text) => text.replace(/^Операционный трекер .*$/m, 'Операционный трекер прежней версии.');

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

test('upgrade: pins with a .git suffix or without v move and take the canonical #vX.Y.Z form', () => {
  const form = parseCli('npx github:me/proj#v0.1.0');
  assert.deepEqual(rewriteGates(['npx github:me/proj.git#v0.1.0 lint', 'npx github:me/proj#0.1.0 status'], 'npx github:me/proj#v0.1.0', form, '0.2.0'),
    ['npx github:me/proj#v0.2.0 lint', 'npx github:me/proj#v0.2.0 status']);
  const root = makeProject({ git: false });
  try {
    put(root, 'docs/ROADMAP.md', 'Run `npx github:me/proj.git#v0.1.0 lint` or `npx github:me/proj#0.1.0 lint`.\n');
    assert.deepEqual(rewriteProsePins(root, 'docs', 'BS', form, '0.2.0'), ['docs/ROADMAP.md']);
    assert.equal(read(root, 'docs/ROADMAP.md'), 'Run `npx github:me/proj#v0.2.0 lint` or `npx github:me/proj#v0.2.0 lint`.\n');
  } finally {
    cleanup(root);
  }
});

test('upgrade npm-пина: теги только из explicit source, флаги и gates сохраняются', () => {
  const root = makeProject({ git: false });
  const src = releasesRepo(['v0.2.0', `v${TOOL_VERSION}`]);
  const shim = npxShim();
  try {
    const env = { PATH: `${shim}${path.delimiter}${process.env.PATH}` };
    setConfig(root, { cli: 'npx --yes -q backslop@0.2.0', gates: ['npx --yes -q backslop@0.2.0 lint', 'npm test'], version: '0.2.0' });
    let r = cli(root, ['upgrade', '--pin-only'], { env });
    assert.equal(r.code, 1);
    assert.match(r.err, /источник релизов .*source/);
    assert.equal(config(root).cli, 'npx --yes -q backslop@0.2.0');

    setConfig(root, { source: src });
    r = cli(root, ['upgrade', '--pin-only'], { env });
    assert.equal(r.code, 0, r.err);
    assert.ok(r.out.includes(`→ npx --yes -q backslop@${TOOL_VERSION} version`), 'проба новой версии идёт и при --pin-only');
    assert.equal(config(root).cli, `npx --yes -q backslop@${TOOL_VERSION}`);
    assert.deepEqual(config(root).gates, [`npx --yes -q backslop@${TOOL_VERSION} lint`, 'npm test']);
  } finally {
    cleanup(root);
    rmSync(src, { recursive: true, force: true });
    rmSync(shim, { recursive: true, force: true });
  }
});

test('rewriteGates: every pin of the cli spec in a command moves, a scoped entry keeps when', () => {
  const old = 'npx github:me/proj#v0.1.0';
  const form = parseCli(old);
  assert.deepEqual(
    rewriteGates([`${old} lint`, 'npm test', old, `cd . && ${old} lint && ${old} gates --dry-run`, 'npx --yes github:me/proj#v0.0.9 status'], old, form, '0.2.0'),
    ['npx github:me/proj#v0.2.0 lint', 'npm test', 'npx github:me/proj#v0.2.0', 'cd . && npx github:me/proj#v0.2.0 lint && npx github:me/proj#v0.2.0 gates --dry-run', 'npx --yes github:me/proj#v0.2.0 status'],
  );
  const floating = parseCli('npx github:me/proj');
  assert.deepEqual(rewriteGates(['npx github:me/proj lint && npx github:me/proj status', 'npx github:me/projx lint'], 'npx github:me/proj', floating, '0.2.0'),
    ['npx github:me/proj#v0.2.0 lint && npx github:me/proj#v0.2.0 status', 'npx github:me/projx lint'], 'a floating cli moves as a whole word only');
  assert.equal(rewriteCommand('npx --yes backslop@0.1.0 lint', 'npx --yes backslop@0.1.0', parseCli('npx --yes backslop@0.1.0'), '0.2.0'), 'npx --yes backslop@0.2.0 lint');
  // `pinRe` has no end boundary: a suffixed pin moves its version prefix and keeps the suffix.
  assert.deepEqual(rewriteGates(['npx github:me/proj#v0.1.0x lint', 'npx github:me/proj#v0.1.0-rc.1 lint'], old, form, '0.2.0'),
    ['npx github:me/proj#v0.2.0x lint', 'npx github:me/proj#v0.2.0-rc.1 lint']);
  // Запись с областью правится внутрь и сохраняет `when`, нетронутая возвращается той же ссылкой —
  // иначе число заменённых было бы числом записей с областью.
  const gates = [{ command: 'npx github:me/proj#v0.1.0 lint', when: ['docs/**'] }, { command: 'npm test', when: ['lib/**'] }];
  const next = rewriteGates(gates, old, form, '0.2.0');
  assert.deepEqual(next, [{ command: 'npx github:me/proj#v0.2.0 lint', when: ['docs/**'] }, { command: 'npm test', when: ['lib/**'] }]);
  assert.equal(next[1], gates[1], 'нетронутая запись — та же ссылка');
});

test('changelogSince: секции строго после since и не позже to, без «Не выпущено»', () => {
  const text = '# Changelog\n\n## Не выпущено\n\n- **x**\n\n## v0.3.0 — 2026-10-01\n\n- **три**\n\n## v0.2.0 — 2026-09-03\n\n- **два**\n\n## v0.1.0 — 2026-09-03\n\n- **один**\n';
  assert.equal(changelogSince(text, '0.1.0', '0.2.0'), '## v0.2.0 — 2026-09-03\n- **два**');
  assert.match(changelogSince(text, '0.1.0', '9.9.9'), /три[\s\S]*два/);
  assert.doesNotMatch(changelogSince(text, '0.1.0', '9.9.9'), /один|Не выпущено/);
  assert.equal(changelogSince(text, '0.3.0', '9.9.9'), '');
});

test('changelogSince: a section whose heading does not start with a version is not a release', () => {
  const text = '# Changelog\n\n## Unreleased (after v0.1.0)\n\n- **x**\n\n## [0.2.0] - 2026-09-03\n\n- **two**\n\n## v0.1.0 — 2026-09-01\n\n- **one**\n';
  assert.equal(changelogSince(text, null, '9.9.9'), '## [0.2.0] - 2026-09-03\n- **two**\n\n## v0.1.0 — 2026-09-01\n- **one**');
});

test('listReleaseTags: теги локального репозитория как у GitHub', () => {
  const src = releasesRepo(['v0.1.0', 'v0.2.0', 'not-a-release']);
  try {
    assert.deepEqual(listReleaseTags(src).sort(), ['0.1.0', '0.2.0']);
  } finally {
    rmSync(src, { recursive: true, force: true });
  }
});

test('upgrade resolves a relative source from the project root', () => {
  const mono = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-mono-')));
  try {
    run(mono, ['init', '-q', '-b', 'main']);
    const tool = path.join(mono, 'pkg', 'tool');
    mkdirSync(tool, { recursive: true });
    const g = (...a) => spawnSync('git', ['-C', tool, '-c', 'user.email=t@e', '-c', 'user.name=t', ...a], { encoding: 'utf8' });
    g('init', '-q', '-b', 'main');
    g('commit', '-q', '--allow-empty', '-m', 'r');
    g('tag', `v${TOOL_VERSION}`);
    const root = path.join(mono, 'pkg', 'a');
    mkdirSync(path.join(root, 'sub'), { recursive: true });
    put(root, 'backslop.json', `${JSON.stringify({ prefix: 'BS', docs: 'docs', cli: 'npx github:me/proj#v0.10.0', gates: [], version: '0.10.0', source: '../tool', lang: 'en', tools: [] }, null, 2)}\n`);
    const check = (cwd) => {
      const r = cli(root, ['upgrade', '--dry-run'], { cwd });
      assert.equal(r.code, 0, `${cwd}: ${r.err}`);
      assert.ok(r.out.includes(`v0.10.0 → v${TOOL_VERSION}`), r.out);
    };
    check(root);
    check(path.join(root, 'sub'));
    rmSync(path.join(mono, '.git'), { recursive: true, force: true });
    check(path.join(root, 'sub'));
  } finally {
    rmSync(mono, { recursive: true, force: true });
  }
});

test('upgrade --to is checked for form before the release source is read', () => {
  const root = makeProject();
  try {
    setConfig(root, { cli: 'npx github:me/proj#v0.10.0', source: path.join(root, 'no-such-repo'), lang: 'en' });
    const r = cli(root, ['upgrade', '--to', '1']);
    assert.equal(r.code, 1, r.out);
    assert.equal(r.err, '✖ --to “1”: expected X.Y.Z\n');
    assert.doesNotMatch(r.err, /ls-remote/);
  } finally {
    cleanup(root);
  }
});

test('upgrade: git ls-remote, оборванный сигналом, — отказ называет сигнал, а не «код null»', { skip: process.platform === 'win32' }, () => {
  const root = makeProject({ git: false });
  const src = releasesRepo(['v0.2.0', 'v0.3.0']);
  const shim = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-git-shim-')));
  try {
    setConfig(root, { cli: 'npx --yes -q backslop@0.2.0', source: src, version: '0.2.0' });
    const real = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
    writeFileSync(path.join(shim, 'git'), `#!/bin/sh\nfor a in "$@"; do [ "$a" = ls-remote ] && kill -9 $$; done\nexec "${real}" "$@"\n`, { mode: 0o755 });

    const r = cli(root, ['upgrade', '--dry-run'], { env: { PATH: `${shim}${path.delimiter}${process.env.PATH}` } });
    assert.equal(r.code, 1, r.out);
    assert.ok(r.err.includes(`git ls-remote --tags ${src}: оборван сигналом SIGKILL`), r.err);
    assert.doesNotMatch(r.err, /код null/);
    assert.equal(config(root).cli, 'npx --yes -q backslop@0.2.0');
  } finally {
    cleanup(root);
    rmSync(src, { recursive: true, force: true });
    rmSync(shim, { recursive: true, force: true });
  }
});

// The shell traps the SIGTERM of the cap and exits 0: spawnSync reports ETIMEDOUT with status 0.
test('upgrade: a step that hits the time cap stops the run even when the shell exits 0', { skip: process.platform === 'win32' }, async () => {
  const root = makeProject({ git: false });
  const src = releasesRepo(['v99.0.0']);
  const tool = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-trap-')));
  try {
    writeFileSync(path.join(tool, 'trap.sh'), "trap 'exit 0' TERM; sleep 5 & wait\n");
    setConfig(root, { cli: `sh "${path.join(tool, 'trap.sh')}"`, source: src, lang: 'en' });
    await assert.rejects(upgrade([], { cwd: root, timeout: 2000 }), (e) => {
      assert.ok(e instanceof CliError, e.stack);
      assert.match(e.message, /^step “sh ".*trap\.sh" version” — timed out after the 2-second cap\. Pin and version stamp were not changed/);
      return true;
    });
    assert.equal(config(root).version, TOOL_VERSION, 'the stamp is untouched');
  } finally {
    cleanup(root);
    rmSync(src, { recursive: true, force: true });
    rmSync(tool, { recursive: true, force: true });
  }
});

test('upgrade: a step killed by a signal names the signal, not an exit code', { skip: process.platform === 'win32' }, () => {
  const root = makeProject({ git: false });
  const src = releasesRepo(['v99.0.0']);
  const tool = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-killer-')));
  try {
    writeFileSync(path.join(tool, 'killer.sh'), 'kill -KILL $$\n');
    setConfig(root, { cli: `sh "${path.join(tool, 'killer.sh')}"`, source: src, lang: 'en' });
    const r = cli(root, ['upgrade']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, /step “sh ".*killer\.sh" version” — killed by signal SIGKILL\. Pin and version stamp were not changed/);
    assert.doesNotMatch(r.err, /code SIGKILL/);
  } finally {
    cleanup(root);
    rmSync(src, { recursive: true, force: true });
    rmSync(tool, { recursive: true, force: true });
  }
});

test('upgrade --dry-run shows the plan and writes nothing; --pin-only moves the pin', () => {
  const root = makeProject({ git: false });
  const V = TOOL_VERSION;
  const src = releasesRepo(['v0.1.0', `v${V}`]);
  const shim = npxShim();
  try {
    const env = { PATH: `${shim}${path.delimiter}${process.env.PATH}` };
    setConfig(root, { cli: 'npx github:me/proj#v0.1.0', gates: ['npx github:me/proj#v0.1.0 lint', 'npm test'], version: '0.1.0', source: src });
    const before = read(root, 'backslop.json');
    let r = cli(root, ['upgrade', '--dry-run'], { env });
    assert.equal(r.code, 0, r.err);
    assert.ok(r.out.includes(`v0.1.0 → v${V}`), r.out);
    assert.ok(r.out.includes(`npx github:me/proj#v${V}`), r.out);
    assert.equal(read(root, 'backslop.json'), before);

    r = cli(root, ['upgrade', '--pin-only'], { env });
    assert.equal(r.code, 0, r.err);
    const cfg = config(root);
    assert.equal(cfg.cli, `npx github:me/proj#v${V}`);
    assert.deepEqual(cfg.gates, [`npx github:me/proj#v${V} lint`, 'npm test']);
    assert.equal(cfg.version, '0.1.0', 'штамп ставит только новая версия через migrate/init');

    setConfig(root, { version: V });
    r = cli(root, ['upgrade'], { env });
    assert.equal(r.code, 0, r.err);
    assert.ok(r.out.includes(`уже на v${V}`), r.out);
    r = cli(root, ['upgrade', '--to', 'v9.9.9'], { env });
    assert.equal(r.code, 1);
    assert.match(r.err, /тега v9\.9\.9/);
    r = cli(root, ['upgrade', '--to', 'v0.1.0'], { env });
    assert.equal(r.code, 1);
    assert.ok(r.err.includes(`понижение v${V} → v0.1.0 не поддерживается`), r.err);
    assert.equal(config(root).cli, `npx github:me/proj#v${V}`, 'отказ ничего не переставил');
  } finally {
    cleanup(root);
    rmSync(src, { recursive: true, force: true });
    rmSync(shim, { recursive: true, force: true });
  }
});

test('upgrade целиком: migrate и init новой версией, штамп и скиллы, выжимка CHANGELOG', () => {
  const root = makeProject({ git: false });
  const src = releasesRepo(['v0.1.0', `v${TOOL_VERSION}`]);
  try {
    setConfig(root, { cli: `node "${BIN}"`, gates: [`node "${BIN}" lint`], version: '0.10.0', source: src, tools: ['claude'] });
    rmSync(path.join(root, 'docs', 'README.md'));
    const r = cli(root, ['upgrade']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.err, /пин не меняется/);
    assert.match(r.out, /→ node .*backslop\.js" migrate/);
    assert.match(r.out, /→ node .*backslop\.js" init/);
    assert.match(r.out, /## v0\.10\.1/);
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

test('upgrade without a release source refuses', () => {
  const root = makeProject({ git: false, stamp: false });
  try {
    setConfig(root, { cli: 'node bin/backslop.js' });
    const r = cli(root, ['upgrade']);
    assert.equal(r.code, 1);
    assert.match(r.err, /обновлять нечего/);
  } finally {
    cleanup(root);
  }
});

test('migrate without a stamp: every migration is due, the stamp goes from none to the tool version', () => {
  const root = makeProject({ git: false, stamp: false });
  try {
    setConfig(root, { cli: 'node bin/backslop.js' });
    let r = cli(root, ['migrate', '--dry-run']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /миграция до v0\.10\.0: журнал закрытых docs\/archive\/LOG\.md \(--dry-run\)/, 'без штампа проект считается старше любой миграции');
    assert.equal(config(root).version, undefined);
    r = cli(root, ['migrate']);
    assert.equal(r.code, 0, r.err);
    assert.equal(config(root).version, TOOL_VERSION);
    assert.match(r.out, /штамп версии: не было → v/);
  } finally {
    cleanup(root);
  }
});

// Правила ведения и архива принадлежат инструменту (ADR-048): migrate перерисовывает их, пока
// штамп ниже его версии, а проектный скелет docs не трогает.
test('migrate: правила ведения и архива перерисовываются из шаблона, проектные файлы docs — нет', () => {
  const root = makeProject({ git: false });
  try {
    setConfig(root, { cli: 'node bin/backslop.js', version: '0.10.0' });
    const vars = { cli: 'node bin/backslop.js', prefix: 'BS', project: path.basename(root) };
    const rules = ['docs/backlog/README.md', 'docs/archive/README.md'];
    const expected = Object.fromEntries(rules.map((rel) => [rel, renderTemplate(rel, vars)]));
    put(root, rules[0], staleRules(expected[rules[0]]));
    put(root, 'docs/GLOSSARY.md', '# Свой глоссарий\n');
    const index = read(root, 'docs/README.md');
    let r = cli(root, ['migrate', '--dry-run']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /правила ведения и архива из шаблона v\d+\.\d+\.\d+: перерисовать docs\/backlog\/README\.md, docs\/archive\/README\.md \(--dry-run\)/);
    assert.equal(read(root, rules[0]), staleRules(expected[rules[0]]), '--dry-run ничего не пишет');
    r = cli(root, ['migrate']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /перерисованы docs\/backlog\/README\.md, docs\/archive\/README\.md/);
    for (const rel of rules) assert.equal(read(root, rel), expected[rel], `${rel} не равен рендеру шаблона`);
    assert.equal(read(root, 'docs/GLOSSARY.md'), '# Свой глоссарий\n', 'проектный файл docs не перерисовывается');
    assert.equal(read(root, 'docs/README.md'), index, 'индекс docs не перерисовывается');

    // На своей версии правила не трогаются: перерисовку несёт только обновление.
    put(root, rules[1], '# Своя правка архива\n');
    r = cli(root, ['migrate']);
    assert.equal(r.code, 0, r.err);
    assert.equal(read(root, rules[1]), '# Своя правка архива\n');
    assert.doesNotMatch(r.out, /правила ведения/);
  } finally {
    cleanup(root);
  }
});

test('migrate: a rewritten rules file keeps its UTF-8 BOM', () => {
  const root = makeProject({ git: false });
  try {
    setConfig(root, { cli: 'node bin/backslop.js', version: '0.10.0' });
    const rel = 'docs/backlog/README.md';
    const expected = renderTemplate(rel, { cli: 'node bin/backslop.js', prefix: 'BS', project: path.basename(root) });
    put(root, rel, `﻿${staleRules(expected)}`);
    const r = cli(root, ['migrate']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /перерисованы docs\/backlog\/README\.md/);
    assert.equal(read(root, rel), `﻿${expected}`, 'the rewrite is the template render behind the kept BOM');
  } finally {
    cleanup(root);
  }
});

test('migrate: at the same version a BOM-carrying rules file equal to the render reads as the render', () => {
  const root = makeProject({ git: false });
  try {
    setConfig(root, { cli: 'node bin/backslop.js', version: '0.10.0' });
    const rel = 'docs/backlog/README.md';
    put(root, rel, `﻿${staleRules(read(root, rel))}`);
    let r = cli(root, ['migrate']);
    assert.equal(r.code, 0, r.err);
    r = cli(root, ['migrate']);
    assert.equal(r.code, 0, r.err);
    assert.doesNotMatch(r.out, /не совпадает/, 'BOM + the exact render is the render');
    assert.ok(read(root, rel).startsWith('﻿'), 'the BOM stays');
  } finally {
    cleanup(root);
  }
});

test('migrate: en-проект получает правила из en-шаблона, недостающий файл пары создаётся', () => {
  const root = makeProject({ git: false });
  try {
    setConfig(root, { cli: 'node bin/backslop.js', version: '0.10.0', lang: 'en' });
    rmSync(path.join(root, 'docs/archive/README.md'));
    const vars = { cli: 'node bin/backslop.js', prefix: 'BS', project: path.basename(root) };
    const r = cli(root, ['migrate']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /tracking and archive rules from the v\d+\.\d+\.\d+ template: rewritten docs\/backlog\/README\.md, docs\/archive\/README\.md — no git, uncommitted edits could not be checked/);
    for (const rel of ['docs/backlog/README.md', 'docs/archive/README.md']) {
      assert.equal(read(root, rel), renderTemplate(`en/${rel}`, vars), `${rel} не равен рендеру en-шаблона`);
    }
  } finally {
    cleanup(root);
  }
});

// Незакоммиченную правку перерисовка стёрла бы без следа в истории: отказ до первой записи.
test('migrate: незакоммиченная правка правил — отказ с именем файла, штамп и файлы не тронуты', () => {
  const root = makeProject();
  try {
    setConfig(root, { cli: 'node bin/backslop.js', version: '0.10.0' });
    gitAll(root);
    put(root, 'docs/backlog/README.md', '# Свои правила, не закоммичены\n');
    for (const args of [['migrate', '--dry-run'], ['migrate']]) {
      const r = cli(root, args);
      assert.equal(r.code, 1, `${args.join(' ')}: ожидался отказ`);
      assert.match(r.err, /docs\/backlog\/README\.md.*закоммить или откати правку, затем повтори/);
    }
    assert.equal(read(root, 'docs/backlog/README.md'), '# Свои правила, не закоммичены\n');
    assert.equal(config(root).version, '0.10.0', 'отказ не переставил штамп');

    gitAll(root, 'свои правила');
    const r = cli(root, ['migrate']);
    assert.equal(r.code, 0, r.err);
    assert.doesNotMatch(r.out, /no git|git нет/);
    assert.match(read(root, 'docs/backlog/README.md'), /^# Backlog\n\nОперационный трекер /);
  } finally {
    cleanup(root);
  }
});

test('migrate: the uncommitted-edit refusal names a non-ASCII path as it is, not C-quoted', () => {
  const root = makeProject({ docs: 'доки' });
  try {
    setConfig(root, { cli: 'node bin/backslop.js', version: '0.10.0' });
    gitAll(root);
    put(root, 'доки/backlog/README.md', '# Свои правила, не закоммичены\n');
    const r = cli(root, ['migrate']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, /доки\/backlog\/README\.md: незакоммиченная правка/);
    assert.doesNotMatch(r.err, /\\3\d\d/, 'no octal escapes');
  } finally {
    cleanup(root);
  }
});

test('migrate: файл пары за symlink не перерисовывается — предупреждение, общий файл цел', { skip: process.platform === 'win32' }, () => {
  const root = makeProject({ git: false });
  const shared = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-shared-')));
  try {
    setConfig(root, { cli: 'node bin/backslop.js', version: '0.10.0' });
    writeFileSync(path.join(shared, 'README.md'), '# Общий архив\n');
    rmSync(path.join(root, 'docs/archive/README.md'));
    symlinkSync(path.join(shared, 'README.md'), path.join(root, 'docs/archive/README.md'));
    const r = cli(root, ['migrate']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.err, /docs\/archive\/README\.md: путь идёт через symlink docs\/archive\/README\.md/);
    assert.equal(read(shared, 'README.md'), '# Общий архив\n', 'запись ушла за ссылку');
    assert.match(r.out, /перерисованы docs\/backlog\/README\.md(?!, docs\/archive)/);
  } finally {
    cleanup(root);
    rmSync(shared, { recursive: true, force: true });
  }
});

// A project laid out by `init` and committed, then switched to `lang: en` by a config edit.
function switchedToEn(edit = (root) => root) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-lang-')));
  run(root, ['init', '-q', '-b', 'main']);
  run(root, ['config', 'user.email', 'test@example.com']);
  run(root, ['config', 'user.name', 'test']);
  const r = cli(root, ['init', '--tools', 'none']);
  assert.equal(r.code, 0, r.err);
  edit(root);
  gitAll(root);
  setConfig(root, { lang: 'en' });
  return root;
}

test('migrate: a ru project switched to en redraws the untouched rules pair', () => {
  const root = switchedToEn();
  try {
    const vars = { cli: config(root).cli, prefix: 'BS', project: path.basename(root) };
    const r = cli(root, ['migrate']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /rewritten docs\/backlog\/README\.md, docs\/archive\/README\.md/);
    for (const rel of ['docs/backlog/README.md', 'docs/archive/README.md']) {
      assert.equal(read(root, rel), renderTemplate(`en/${rel}`, vars), `${rel} is not the en render`);
    }
    assert.equal(config(root).version, TOOL_VERSION);
  } finally {
    cleanup(root);
  }
});

test('migrate: an edited rules file keeps its local edits on a lang switch, with a note', () => {
  const root = switchedToEn((dir) => put(dir, 'docs/backlog/README.md', `${read(dir, 'docs/backlog/README.md')}\nСвоё правило.\n`));
  try {
    const edited = read(root, 'docs/backlog/README.md');
    const vars = { cli: config(root).cli, prefix: 'BS', project: path.basename(root) };
    const r = cli(root, ['migrate']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /docs\/backlog\/README\.md: matches neither the en nor the ru render — kept until the next version update/);
    assert.equal(read(root, 'docs/backlog/README.md'), edited);
    assert.equal(read(root, 'docs/archive/README.md'), renderTemplate('en/docs/archive/README.md', vars));
  } finally {
    cleanup(root);
  }
});

test('migrate: at its own version a rules file off by a pin is redrawn, off by CRLF left alone', () => {
  const root = switchedToEn((dir) => put(dir, 'docs/archive/README.md', read(dir, 'docs/archive/README.md').replaceAll('\n', '\r\n')));
  try {
    setConfig(root, { lang: 'ru' });
    const archive = read(root, 'docs/archive/README.md');
    let r = cli(root, ['migrate']);
    assert.equal(r.code, 0, r.err);
    assert.doesNotMatch(r.out, /не совпадает|перерисованы/);
    assert.equal(read(root, 'docs/archive/README.md'), archive, 'a CRLF-only difference is not rewritten');

    const cliNow = 'npx github:Velklish/backslop#v0.10.0';
    setConfig(root, { cli: cliNow });
    r = cli(root, ['migrate']);
    assert.equal(r.code, 0, r.err);
    assert.doesNotMatch(r.out, /не совпадает/);
    assert.match(r.out, /перерисованы docs\/backlog\/README\.md, docs\/archive\/README\.md/);
    const vars = { cli: cliNow, prefix: 'BS', project: path.basename(root) };
    for (const rel of ['docs/backlog/README.md', 'docs/archive/README.md']) {
      assert.equal(read(root, rel), renderTemplate(rel, vars), `${rel} is not the render with the cli pin`);
    }
  } finally {
    cleanup(root);
  }
});

test('upgrade pins a floating cli inside an init-rendered rules pair, with no note', () => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-float-')));
  const src = releasesRepo([`v${TOOL_VERSION}`]);
  const shim = npxShim();
  const now = `npx github:me/proj#v${TOOL_VERSION}`;
  try {
    const env = { PATH: `${shim}${path.delimiter}${process.env.PATH}` };
    let r = cli(root, ['init', '--lang', 'en', '--tools', 'none', '--cli', 'npx github:me/proj']);
    assert.equal(r.code, 0, r.err);
    setConfig(root, { source: src });
    r = cli(root, ['upgrade'], { env });
    assert.equal(r.code, 0, r.err);
    assert.doesNotMatch(r.out, /matches neither/);
    const vars = { cli: now, prefix: 'BS', project: path.basename(root) };
    for (const rel of ['docs/backlog/README.md', 'docs/archive/README.md']) {
      assert.equal(read(root, rel), renderTemplate(`en/${rel}`, vars), `${rel} keeps the floating cli`);
    }
  } finally {
    cleanup(root);
    rmSync(src, { recursive: true, force: true });
    rmSync(shim, { recursive: true, force: true });
  }
});

// Полный путь пользователя: форма npx, перепись пина, запуск новой версии тем самым cli.
// Сеть подменяет шим `npx` в PATH: он отбрасывает спеку и запускает локальный bin.
function npxShim(before = '') {
  // `before` is script code that runs first: it may exit or print on its own.
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-npx-')));
  const script = path.join(dir, 'npx.mjs');
  // Снимает флаги npx и спеку пакета, сколько бы их ни было: `npx --yes -q backslop@X version`
  // и `npx github:me/proj#vX version` оба должны дойти до локального bin как `version`.
  writeFileSync(script, `import { spawnSync } from 'node:child_process';
${before}const args = process.argv.slice(2);
while (args.length && args[0].startsWith('-')) args.shift();
args.shift();
process.exit(spawnSync(process.execPath, [${JSON.stringify(BIN)}, ...args], { stdio: 'inherit' }).status ?? 1);
`);
  // cmd.exe resolves `npx` through PATHEXT, so win32 gets `npx.cmd`.
  if (process.platform === 'win32') writeFileSync(path.join(dir, 'npx.cmd'), `@"${process.execPath}" "${script}" %*\r\n`);
  else writeFileSync(path.join(dir, 'npx'), `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, { mode: 0o755 });
  return dir;
}

test('upgrade по форме npx: пробный запуск до пина, пин и гейты, скиллы новой версией', () => {
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

// Пин пишется только после пробного запуска новой версии, и `--pin-only` пробу не сокращает:
// иначе проект остался бы с пином на команду, которая не поднимается.
test('upgrade: a failed probe run writes neither pin, gates nor stamp', () => {
  const root = makeProject({ git: false });
  const src = releasesRepo(['v0.1.0', `v${TOOL_VERSION}`]);
  const broken = npxShim('process.exit(3);\n');
  const old = { cli: 'npx github:me/proj#v0.1.0', gates: ['npx github:me/proj#v0.1.0 lint', 'npm test'], version: '0.1.0' };
  try {
    for (const argv of [['upgrade'], ['upgrade', '--pin-only']]) {
      const label = argv.join(' ');
      setConfig(root, { ...old, source: src });
      const r = cli(root, argv, { env: { PATH: `${broken}${path.delimiter}${process.env.PATH}` } });
      assert.equal(r.code, 1, `${label}: ${r.out}`);
      assert.match(r.err, / — код 3\. /, label);
      assert.match(r.err, /Пин и штамп не тронуты/, label);
      const cfg = config(root);
      assert.deepEqual({ cli: cfg.cli, gates: cfg.gates, version: cfg.version }, old, label);
    }
  } finally {
    cleanup(root);
    rmSync(src, { recursive: true, force: true });
    rmSync(broken, { recursive: true, force: true });
  }
});

test('init and migrate refuse a stamp newer than the tool', () => {
  const root = makeProject({ git: false });
  const head = `✖ штамп v9.9.9 новее инструмента v${TOOL_VERSION}: обнови установку или пин в cli`;
  try {
    setConfig(root, { version: '9.9.9' });
    for (const [command, tail] of [['init', 'старой версией раскладку не делаю'], ['migrate', 'назад формат не переводится']]) {
      const r = cli(root, [command]);
      assert.equal(r.code, 1, `${command}: ${r.out}`);
      assert.equal(r.err, `${head}, ${tail}\n`);
    }
    assert.equal(config(root).version, '9.9.9', 'штамп новее себя не затирается');
  } finally {
    cleanup(root);
  }
});

test('changelog CLI: --since and --to bounds, an empty summary', () => {
  const root = makeProject({ git: false });
  const rows = [
    { argv: ['--since', 'v0.0.1'], code: 0, match: /## v0\.1\.0/ },
    { argv: ['--since', 'v99.0.0'], code: 0, match: /^записей после v99\.0\.0 и до v\d+\.\d+\.\d+ нет\n$/ },
    { argv: ['--since', 'latest'], code: 1, match: /^✖ --since «latest»: нужна форма X\.Y\.Z\n$/ },
    { argv: ['--to', 'v0.1.0'], code: 0, match: /## v0\.1\.0/, doesNotMatch: /## v0\.2\.0/ },
    { argv: ['--to', 'v0.0.1'], code: 0, match: /^записей до v0\.0\.1 нет\n$/ },
  ];
  try {
    for (const row of rows) {
      const r = cli(root, ['changelog', ...row.argv]);
      const label = row.argv.join(' ');
      assert.equal(r.code, row.code, `${label}: ${r.err}`);
      const text = row.code === 0 ? r.out : r.err;
      assert.match(text, row.match, label);
      if (row.doesNotMatch) assert.doesNotMatch(text, row.doesNotMatch, label);
    }
  } finally {
    cleanup(root);
  }
});

// Пин живёт не только в конфиге: живая инструкция в docs зовёт его текстом команды.
test('upgrade: пин в прозе docs переставляется, записи о моменте — нет', () => {
  const root = makeProject({ git: false });
  const src = releasesRepo(['v0.1.0', `v${TOOL_VERSION}`]);
  const shim = npxShim();
  const old = 'npx github:me/proj#v0.1.0';
  const now = `npx github:me/proj#v${TOOL_VERSION}`;
  const seed = () => {
    setConfig(root, { cli: old, gates: [`${old} lint`], version: '0.1.0', source: src });
    put(root, 'docs/reference/README.md', `# Справочник\n\nПереезд делает \`${old} archive N\`.\n`);
    put(root, 'docs/GLOSSARY.md', `# Глоссарий\n\nСводку печатает \`${old} status\`.\n`);
    put(root, 'README.md', `Установка: \`${old} init\`.\n`);
    put(root, 'package.json', '{"scripts":{"lint:backslop":"' + old + ' lint"}}\n');
    put(root, 'fixture-package.json', '{"scripts":{"lint:backslop":"' + old + ' lint"}}\n');
    put(root, '.github/workflows/ci.yml', 'steps:\n  - run: ' + old + ' init\n');
    put(root, 'CHANGELOG.md', `## Не выпущено\n\n- **Было** — \`${old}\`\n`);
    put(root, 'docs/adr/adr-001-x.md', `# ADR-001: Х\n\nРешение принято при \`${old}\`.\n`);
    put(root, 'docs/archive/BS-1-x/task.md', `# BS-1 · Х\n\nГнали \`${old} lint\`.\n`);
    put(root, 'docs/backlog/queue/BS-2-card.md', `# BS-2 · Карточка\n\n- **Порядок:** 10\n\nПроверено на \`${old}\`.\n`);
    put(root, 'docs/ROADMAP.md', '# Roadmap\n\nОпечатка в пине: `npx github:me/proj#v0.1.09`.\n');
  };
  try {
    const env = { PATH: `${shim}${path.delimiter}${process.env.PATH}` };
    seed();
    let r = cli(root, ['upgrade', '--pin-only'], { env });
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /затем .* upgrade для живых пинов/);
    assert.ok(read(root, 'docs/reference/README.md').includes(old), '--pin-only прозу не трогает');

    // Прозу чинит следующий полный upgrade: поиск идёт по спеке, а не по литералу прежнего cli,
    // иначе отставшая на две версии проза не починилась бы никогда.
    r = cli(root, ['migrate'], { env });
    assert.equal(r.code, 0, r.err);
    r = cli(root, ['init'], { env });
    assert.equal(r.code, 0, r.err);
    assert.equal(config(root).version, TOOL_VERSION);
    r = cli(root, ['lint'], { env });
    assert.equal(r.code, 1, r.err);
    assert.match(r.err, /пин .*расходится с cli/);
    r = cli(root, ['upgrade'], { env });
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /пин в прозе: 6 файлов/);
    for (const rel of ['docs/reference/README.md', 'docs/GLOSSARY.md', 'README.md', 'package.json', '.github/workflows/ci.yml']) {
      assert.ok(read(root, rel).includes(now), `${rel}: пин не переставлен`);
      assert.ok(!read(root, rel).includes(old), `${rel}: остался старый пин`);
    }
    assert.ok(read(root, 'fixture-package.json').includes(old), 'fixture-package.json не является живым манифестом');
    for (const rel of ['CHANGELOG.md', 'docs/adr/adr-001-x.md', 'docs/archive/BS-1-x/task.md', 'docs/backlog/queue/BS-2-card.md']) {
      assert.ok(read(root, rel).includes(old), `${rel}: запись о моменте переписана, а не должна`);
    }
    // Номер захватывается целиком: из старого и нового не собирается мусорная версия.
    const roadmap = read(root, 'docs/ROADMAP.md');
    assert.ok(roadmap.includes(`npx github:me/proj#v${TOOL_VERSION}`), roadmap);
    assert.ok(!/#v\d+\.\d+\.\d+\d/.test(roadmap), `собрана мусорная версия: ${roadmap}`);
  } finally {
    cleanup(root);
    rmSync(src, { recursive: true, force: true });
    rmSync(shim, { recursive: true, force: true });
  }
});

test('upgrade leaves a pin in a journal entry, rewrites the LOG.md header, then says already on', () => {
  const root = makeProject({ git: false });
  const src = releasesRepo(['v0.1.0', `v${TOOL_VERSION}`]);
  const shim = npxShim();
  const old = 'npx github:me/proj#v0.1.0';
  const now = `npx github:me/proj#v${TOOL_VERSION}`;
  const entry = `- <a id="bs-6"></a>\`BS-6-y\` · 2026-09-01 · completed · — · Measured with \`${old} lint\``;
  try {
    const env = { PATH: `${shim}${path.delimiter}${process.env.PATH}` };
    setConfig(root, { cli: old, version: '0.1.0', source: src });
    put(root, 'docs/archive/LOG.md', `# Log\n\nBodies: \`${old} show N\`.\n\n${entry}\n`);
    let r = cli(root, ['upgrade'], { env });
    assert.equal(r.code, 0, r.err);
    assert.equal(read(root, 'docs/archive/LOG.md'), `# Log\n\nBodies: \`${now} show N\`.\n\n${entry}\n`);
    r = cli(root, ['upgrade'], { env });
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /уже на/);
  } finally {
    cleanup(root);
    rmSync(src, { recursive: true, force: true });
    rmSync(shim, { recursive: true, force: true });
  }
});

// An en consumer on an older pin: the rules pair differs from this template in more than the pin.
function pinnedConsumer(root, old, version, src) {
  setConfig(root, { cli: old, gates: [`${old} lint`], version, source: src, lang: 'en' });
  const vars = { cli: old, prefix: 'BS', project: path.basename(root) };
  const stale = (text) => text.replace(/^The operational tracker .*$/m, 'The tracker of an earlier version.');
  put(root, 'docs/backlog/README.md', stale(renderTemplate('en/docs/backlog/README.md', vars)));
  put(root, 'docs/archive/README.md', renderTemplate('en/docs/archive/README.md', vars));
}

test('migrate: a rules pair whose only uncommitted change is a moved pin is redrawn', () => {
  const root = makeProject();
  const old = 'npx github:me/proj#v0.10.0';
  const now = `npx github:me/proj#v${TOOL_VERSION}`;
  try {
    pinnedConsumer(root, old, '0.10.0', undefined);
    gitAll(root);
    const rules = ['docs/backlog/README.md', 'docs/archive/README.md'];
    for (const rel of rules) put(root, rel, read(root, rel).replaceAll(old, now));
    setConfig(root, { cli: now });
    const vars = { cli: now, prefix: 'BS', project: path.basename(root) };
    let r = cli(root, ['migrate']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /rewritten docs\/backlog\/README\.md/);
    for (const rel of rules) assert.equal(read(root, rel), renderTemplate(`en/${rel}`, vars), `${rel} is not the template render`);

    run(root, ['checkout', '--', ...rules]);
    setConfig(root, { version: '0.10.0' });
    for (const rel of rules) put(root, rel, read(root, rel).replaceAll(old, now));
    put(root, rules[0], `${read(root, rules[0])}\nMY LOCAL EDIT\n`);
    r = cli(root, ['migrate']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, /docs\/backlog\/README\.md: uncommitted edit/);
    assert.match(read(root, rules[0]), /MY LOCAL EDIT/);
    assert.equal(config(root).version, '0.10.0');
  } finally {
    cleanup(root);
  }
});

test('migrate: a moved pin in a CRLF checkout under core.autocrlf is still the only change', () => {
  const origin = makeProject();
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-crlf-')));
  const old = 'npx github:me/proj#v0.10.0';
  const now = `npx github:me/proj#v${TOOL_VERSION}`;
  try {
    pinnedConsumer(origin, old, '0.10.0', undefined);
    gitAll(origin);
    run(root, ['clone', '-q', '-c', 'core.autocrlf=true', origin, '.']);
    const rules = ['docs/backlog/README.md', 'docs/archive/README.md'];
    assert.ok(read(root, rules[0]).includes('\r\n'), 'the checkout has CRLF');
    for (const rel of rules) put(root, rel, read(root, rel).replaceAll(old, now));
    setConfig(root, { cli: now });
    const r = cli(root, ['migrate']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /rewritten docs\/backlog\/README\.md/);
  } finally {
    cleanup(origin);
    cleanup(root);
  }
});

test('upgrade from a pinned consumer with committed rules completes in one run', () => {
  const root = makeProject();
  const src = releasesRepo(['v0.10.0', `v${TOOL_VERSION}`]);
  const shim = npxShim();
  try {
    const env = { PATH: `${shim}${path.delimiter}${process.env.PATH}` };
    pinnedConsumer(root, 'npx github:me/proj#v0.10.0', '0.10.0', src);
    rmSync(path.join(root, 'docs', 'README.md'));
    gitAll(root);
    let r = cli(root, ['upgrade'], { env });
    assert.equal(r.code, 0, r.err);
    assert.doesNotMatch(r.err, /uncommitted edit/);
    const lines = r.out.split('\n').filter((l) => l.startsWith('  → ') || /^ {2}pin in prose/.test(l));
    assert.match(lines[1], /migrate$/);
    assert.match(lines[2], /init$/);
    assert.match(lines[3], /pin in prose/, 'prose pins move after migrate and init');
    assert.equal(config(root).version, TOOL_VERSION);
    assert.equal(config(root).cli, `npx github:me/proj#v${TOOL_VERSION}`);
    r = cli(root, ['lint'], { env });
    assert.equal(r.code, 0, r.err);
  } finally {
    cleanup(root);
    rmSync(src, { recursive: true, force: true });
    rmSync(shim, { recursive: true, force: true });
  }
});

test('upgrade refuses when the probed cli still runs an older version', () => {
  const root = makeProject({ git: false });
  const src = releasesRepo(['v0.10.0', `v${TOOL_VERSION}`]);
  const tool = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-old-tool-')));
  try {
    const marker = path.join(tool, 'ran.txt');
    writeFileSync(path.join(tool, 'old.cjs'), `if (process.argv[2] === 'version') console.log('backslop 0.10.0');\nelse { require('fs').writeFileSync(${JSON.stringify(marker)}, process.argv[2]); console.log('✔ migrate'); }\n`);
    setConfig(root, { cli: `node "${path.join(tool, 'old.cjs')}"`, version: '0.10.0', source: src, lang: 'en' });
    let r = cli(root, ['upgrade']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, /cli still runs v0\.10\.0, not v\d+\.\d+\.\d+ — update the installation, then retry/);
    assert.doesNotMatch(r.out, /✔ migrate|✔ upgrade/);
    assert.ok(!existsSync(marker), 'neither migrate nor init ran');
    assert.equal(config(root).version, '0.10.0');

    setConfig(root, { cli: `node "${BIN}"` });
    r = cli(root, ['upgrade', '--pin-only']);
    assert.equal(r.code, 0, r.err);
    assert.doesNotMatch(r.out, /pin updated/, 'a cli without a pin reports no pin update');
  } finally {
    cleanup(root);
    rmSync(src, { recursive: true, force: true });
    rmSync(tool, { recursive: true, force: true });
  }
});

// npx prints its install prompt on stdout: the first probe run must reach the terminal as is.
test('upgrade shows the first probe run and compares the version of a second one', () => {
  const root = makeProject({ git: false });
  const src = releasesRepo(['v0.1.0', `v${TOOL_VERSION}`]);
  const shim = npxShim(`import { existsSync, writeFileSync } from 'node:fs';
const seen = new URL('seen', import.meta.url);
if (!existsSync(seen)) {
  writeFileSync(seen, '');
  console.log('Need to install the following packages: Ok to proceed? (y)');
  console.log('backslop 0.1.0');
  process.exit(0);
}
`);
  try {
    setConfig(root, { cli: 'npx github:me/proj#v0.1.0', gates: [], version: '0.1.0', source: src, lang: 'en' });
    const r = cli(root, ['upgrade', '--pin-only'], { env: { PATH: `${shim}${path.delimiter}${process.env.PATH}` } });
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /→ npx github:me\/proj#v\S+ version\nNeed to install the following packages: Ok to proceed\? \(y\)\n/);
    assert.equal(r.out.match(/→ npx github:me\/proj#v\S+ version/g).length, 1, 'the second run prints nothing');
    assert.equal(config(root).cli, `npx github:me/proj#v${TOOL_VERSION}`);
  } finally {
    cleanup(root);
    rmSync(src, { recursive: true, force: true });
    rmSync(shim, { recursive: true, force: true });
  }
});

test('upgrade takes the lower of pin and stamp as the from-version', () => {
  const root = makeProject({ git: false });
  const src = releasesRepo(['v0.9.0', `v${TOOL_VERSION}`]);
  const shim = npxShim();
  const now = `npx github:me/proj#v${TOOL_VERSION}`;
  try {
    const env = { PATH: `${shim}${path.delimiter}${process.env.PATH}` };
    setConfig(root, { cli: now, gates: [`${now} lint`], version: '0.9.0', source: src, lang: 'en' });
    let r = cli(root, ['upgrade', '--dry-run'], { env });
    assert.equal(r.code, 0, r.err);
    assert.ok(r.out.includes(`upgrade: v0.9.0 → v${TOOL_VERSION} (cli pin v${TOOL_VERSION}, version stamp v0.9.0; source`), r.out);
    r = cli(root, ['upgrade'], { env });
    assert.equal(r.code, 0, r.err);
    assert.ok(r.out.includes(`→ ${now} changelog --since v0.9.0 --to v${TOOL_VERSION}`), r.out);
    assert.match(r.out, /## v0\.10\.0/, 'entries after the stamp are printed');
    assert.equal(config(root).version, TOOL_VERSION);
  } finally {
    cleanup(root);
    rmSync(src, { recursive: true, force: true });
    rmSync(shim, { recursive: true, force: true });
  }
});

test('upgrade moves every pin inside gate commands and probe', () => {
  const root = makeProject({ git: false });
  const src = releasesRepo(['v0.1.0', `v${TOOL_VERSION}`]);
  const shim = npxShim();
  const old = 'npx github:me/proj#v0.1.0';
  const now = `npx github:me/proj#v${TOOL_VERSION}`;
  try {
    const env = { PATH: `${shim}${path.delimiter}${process.env.PATH}` };
    setConfig(root, {
      cli: old, version: '0.1.0', source: src, lang: 'en', probe: `cd . && ${old} status`,
      gates: [`${old} lint && ${old} gates --dry-run`, { command: `cd . && ${old} lint`, when: ['docs/**'] }],
    });
    const r = cli(root, ['upgrade'], { env });
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /gates with the new pin: 2 of 2/);
    const cfg = config(root);
    assert.deepEqual(cfg.gates, [`${now} lint && ${now} gates --dry-run`, { command: `cd . && ${now} lint`, when: ['docs/**'] }]);
    assert.equal(cfg.probe, `cd . && ${now} status`);
    assert.ok(!read(root, 'backslop.json').includes('#v0.1.0'), read(root, 'backslop.json'));
  } finally {
    cleanup(root);
    rmSync(src, { recursive: true, force: true });
    rmSync(shim, { recursive: true, force: true });
  }
});

test('upgrade pins a floating cli already on the latest version', () => {
  const root = makeProject({ git: false });
  const src = releasesRepo([`v${TOOL_VERSION}`]);
  const shim = npxShim();
  try {
    const env = { PATH: `${shim}${path.delimiter}${process.env.PATH}` };
    setConfig(root, { cli: 'npx github:me/proj', gates: ['npx github:me/proj lint'], source: src, lang: 'en' });
    let r = cli(root, ['lint'], { env });
    assert.match(r.err, /an unpinned cli fetches a fresh version/);
    r = cli(root, ['upgrade'], { env });
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /→ npx github:me\/proj#v\d+\.\d+\.\d+ version/);
    assert.equal(config(root).cli, `npx github:me/proj#v${TOOL_VERSION}`);
    assert.deepEqual(config(root).gates, [`npx github:me/proj#v${TOOL_VERSION} lint`]);
    r = cli(root, ['lint'], { env });
    assert.doesNotMatch(r.err, /unpinned/);
  } finally {
    cleanup(root);
    rmSync(src, { recursive: true, force: true });
    rmSync(shim, { recursive: true, force: true });
  }
});

test('upgrade: the printed after-pin recovery sequence completes the run', () => {
  const root = makeProject({ git: false });
  const src = releasesRepo(['v0.1.0', `v${TOOL_VERSION}`]);
  const shim = npxShim();
  const old = 'npx github:me/proj#v0.1.0';
  const now = `npx github:me/proj#v${TOOL_VERSION}`;
  try {
    const env = { ...process.env, NO_COLOR: '1', PATH: `${shim}${path.delimiter}${process.env.PATH}` };
    setConfig(root, { cli: old, gates: [`${old} lint`], version: '0.1.0', source: src, lang: 'en' });
    rmSync(path.join(root, 'docs', 'README.md'));
    put(root, 'docs/reference/README.md', `# Reference\n\nRun \`${old} status\`.\n`);
    put(root, 'AGENTS.md', '<!-- backslop:start -->\nunpaired\n');
    let r = cli(root, ['upgrade'], { env });
    assert.equal(r.code, 1, r.out);
    const m = r.err.match(/Pin is already v\S+: finish manually with (.+ migrate) && (.+ init), then (.+ upgrade) for live pins/);
    assert.ok(m, r.err);
    put(root, 'AGENTS.md', '# Agents\n');
    for (const command of m.slice(1)) {
      const step = spawnSync(command, { cwd: root, shell: true, encoding: 'utf8', env });
      assert.equal(step.status, 0, `${command}: ${step.stderr}`);
    }
    assert.equal(config(root).version, TOOL_VERSION);
    assert.ok(read(root, 'docs/reference/README.md').includes(now), 'the prose pin moved');
    r = cli(root, ['lint'], { env });
    assert.equal(r.code, 0, r.err);
  } finally {
    cleanup(root);
    rmSync(src, { recursive: true, force: true });
    rmSync(shim, { recursive: true, force: true });
  }
});

test('upgrade skips a live file behind a symlink or not in UTF-8 and names it', { skip: process.platform === 'win32' }, () => {
  const root = makeProject({ git: false });
  const src = releasesRepo(['v0.1.0', `v${TOOL_VERSION}`]);
  const shim = npxShim();
  const shared = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-shared-')));
  const old = 'npx github:me/proj#v0.1.0';
  try {
    const env = { PATH: `${shim}${path.delimiter}${process.env.PATH}` };
    setConfig(root, { cli: old, gates: [`${old} lint`], version: '0.1.0', source: src, lang: 'en' });
    writeFileSync(path.join(shared, 'package.json'), `{"scripts":{"l":"${old} lint"}}\n`);
    symlinkSync(shared, path.join(root, 'vendor'));
    const notes = Buffer.concat([Buffer.from([0xC7, 0xE0, 0xEC, 0xE5, 0xF2, 0xEA, 0xE8]), Buffer.from(`: \`${old} lint\`\n`)]);
    writeFileSync(path.join(root, 'docs', 'NOTES.md'), notes);
    put(root, 'docs/reference/README.md', `# Reference\n\nRun \`${old} status\`.\n`);
    put(root, 'misc/notes.md', `Run \`${old} status\`.\n`);
    symlinkSync(path.join(root, 'misc', 'notes.md'), path.join(root, 'NOTES.md'));
    writeFileSync(path.join(root, 'docs', 'PLAIN.md'), Buffer.from([0xC7, 0xE0, 0xEC, 0xE5, 0xF2, 0xEA, 0xE8, 0x0A]));
    put(root, 'misc/plain.md', 'No pin here.\n');
    symlinkSync(path.join(root, 'misc', 'plain.md'), path.join(root, 'PLAIN-LINK.md'));
    const r = cli(root, ['upgrade'], { env });
    assert.equal(r.code, 0, r.err);
    assert.doesNotMatch(r.err, /PLAIN/, 'a skipped file without a stale pin is not named');
    assert.match(r.err, /vendor\/package\.json: the path goes through the symlink vendor — pin not rewritten/);
    assert.match(r.err, /NOTES\.md: the path goes through the symlink NOTES\.md — pin not rewritten/);
    assert.ok(read(root, 'misc/notes.md').includes(old), 'a root markdown symlink was written through');
    assert.match(r.err, /docs\/NOTES\.md: not valid UTF-8 — pin not rewritten/);
    assert.match(r.out, /pin in prose: 1 files/);
    assert.ok(read(shared, 'package.json').includes(old), 'a file outside the project was rewritten');
    assert.ok(readFileSync(path.join(root, 'docs', 'NOTES.md')).equals(notes), 'NOTES.md bytes changed');
    assert.ok(read(root, 'docs/reference/README.md').includes(`#v${TOOL_VERSION}`));
    const again = cli(root, ['upgrade'], { env });
    assert.equal(again.code, 0, again.err);
    assert.match(again.out, /already on/, 'a skipped file does not make every later upgrade rerun');
  } finally {
    cleanup(root);
    rmSync(src, { recursive: true, force: true });
    rmSync(shim, { recursive: true, force: true });
    rmSync(shared, { recursive: true, force: true });
  }
});

test('upgrade on the same version skips an unreadable live file and says already on', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, () => {
  const root = makeProject({ git: false });
  const src = releasesRepo(['v0.1.0', `v${TOOL_VERSION}`]);
  const locked = path.join(root, 'docs', 'LOCKED.md');
  try {
    setConfig(root, { cli: `npx github:me/proj#v${TOOL_VERSION}`, version: TOOL_VERSION, source: src, lang: 'en' });
    put(root, 'docs/LOCKED.md', 'Run `npx github:me/proj#v0.1.0 lint`.\n');
    chmodSync(locked, 0o000);
    const r = cli(root, ['upgrade']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /upgrade: project is already on v/);
  } finally {
    chmodSync(locked, 0o644);
    cleanup(root);
    rmSync(src, { recursive: true, force: true });
  }
});

test('migrate: a failing git status is a refusal, not "no git"', () => {
  const root = makeProject();
  const index = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-index-')));
  try {
    setConfig(root, { cli: 'node bin/backslop.js', version: '0.10.0', lang: 'en' });
    gitAll(root);
    put(root, 'docs/backlog/README.md', `${read(root, 'docs/backlog/README.md')}MY LOCAL EDIT\n`);
    const r = cli(root, ['migrate'], { env: { GIT_INDEX_FILE: index } });
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, /git status --porcelain -- docs\/backlog\/README\.md: fatal: /);
    assert.doesNotMatch(r.out, /no git/);
    assert.match(read(root, 'docs/backlog/README.md'), /MY LOCAL EDIT/);
    assert.equal(config(root).version, '0.10.0');
  } finally {
    cleanup(root);
    rmSync(index, { recursive: true, force: true });
  }
});

// A consumer on the v0.11 layout: today's init output with the old roadmap, its two docs/README.md
// lines and the old backlog README sentence, committed at stamp 0.11.0.
const OLD_PIN = 'npx github:me/proj#v0.11.0';
const OLD_BACKLOG = {
  ru: [' Закрытые задачи — [архив](../archive/README.md).', ' Куда движется проект в целом — [ROADMAP.md](../ROADMAP.md); закрытые задачи — [архив](../archive/README.md).'],
  en: [' For closed tasks, see the [archive](../archive/README.md).', ' For overall project direction, see [ROADMAP.md](../ROADMAP.md); for closed tasks, see the [archive](../archive/README.md).'],
};

function roadmapConsumer(lang, cliSpec = OLD_PIN, patch = {}) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-roadmap-')));
  run(root, ['init', '-q', '-b', 'main']);
  run(root, ['config', 'user.email', 'test@example.com']);
  run(root, ['config', 'user.name', 'test']);
  run(root, ['config', 'commit.gpgsign', 'false']);
  const r = cli(root, ['init', '--lang', lang, '--tools', 'none', '--cli', cliSpec]);
  assert.equal(r.code, 0, r.err);
  const fresh = read(root, 'docs/README.md');
  const render = (text) => text.replaceAll('{{project}}', path.basename(root)).replaceAll('{{cli}}', cliSpec);
  const { intro, introNow, row } = LEGACY_README_LINES[lang];
  const lines = fresh.split('\n');
  assert.equal(lines[2], render(introNow), 'line 3 of the template moved');
  assert.match(lines[7], /\[GLOSSARY\.md\]/, 'the glossary row moved');
  lines[2] = render(intro);
  lines.splice(8, 0, row);
  put(root, 'docs/README.md', lines.join('\n'));
  put(root, 'docs/ROADMAP.md', render(LEGACY_ROADMAP[lang]));
  const [now, then] = OLD_BACKLOG[lang];
  const backlog = read(root, 'docs/backlog/README.md');
  assert.ok(backlog.includes(now), 'the backlog README sentence moved');
  put(root, 'docs/backlog/README.md', backlog.replace(now, then));
  setConfig(root, { version: '0.11.0', ...patch });
  gitAll(root);
  return { root, fresh, old: read(root, 'docs/README.md'), roadmap: read(root, 'docs/ROADMAP.md') };
}

const ROADMAP_SAYS = {
  ru: {
    deleted: /^ {2}удалён docs\/ROADMAP\.md: совпадает с шаблоном прежних версий, ссылок на него не осталось$/m,
    edited: /^ {2}поправлен docs\/README\.md: сняты строки со ссылкой на ROADMAP\.md$/m,
    dry: /^ {2}удалить docs\/ROADMAP\.md: .* \(--dry-run\)\n {2}поправить docs\/README\.md: .* \(--dry-run\)$/m,
    differs: /docs\/ROADMAP\.md: оставлен — отличается от шаблона прежних версий и на него ссылаются docs\/README\.md; удали его сам или держи как проектный документ/,
    linked: /docs\/ROADMAP\.md: оставлен — на него ссылаются docs\/GLOSSARY\.md, docs\/README\.md; удали его сам/,
    dirty: /docs\/README\.md: незакоммиченная правка — migrate удалил бы или поправил файл/,
    symlink: /docs\/ROADMAP\.md: путь идёт через symlink docs\/ROADMAP\.md — файл не тронут/,
  },
  en: {
    deleted: /^ {2}deleted docs\/ROADMAP\.md: equals the template of earlier versions and nothing links it$/m,
    edited: /^ {2}edited docs\/README\.md: the ROADMAP\.md link lines removed$/m,
    dry: /^ {2}would delete docs\/ROADMAP\.md: .* \(--dry-run\)\n {2}would edit docs\/README\.md: .* \(--dry-run\)$/m,
    differs: /docs\/ROADMAP\.md: kept — differs from the template of earlier versions and is still linked from docs\/README\.md; delete it yourself or keep it as project content/,
    linked: /docs\/ROADMAP\.md: kept — is still linked from docs\/GLOSSARY\.md, docs\/README\.md; delete it yourself/,
    dirty: /docs\/README\.md: uncommitted edit — migrate would delete or edit the file/,
    symlink: /docs\/ROADMAP\.md: the path goes through the symlink docs\/ROADMAP\.md — file left alone/,
  },
};

const hasRoadmap = (root) => existsSync(path.join(root, 'docs', 'ROADMAP.md'));

for (const lang of ['ru', 'en']) {
  const says = ROADMAP_SAYS[lang];

  test(`roadmap migration (${lang}): an untouched copy goes with its two docs/README.md lines`, () => {
    const { root, fresh } = roadmapConsumer(lang);
    try {
      const r = cli(root, ['migrate']);
      assert.equal(r.code, 0, r.err);
      assert.match(r.out, says.deleted);
      assert.match(r.out, says.edited);
      assert.ok(!hasRoadmap(root));
      assert.equal(read(root, 'docs/README.md'), fresh);
      assert.doesNotMatch(read(root, 'docs/backlog/README.md'), /ROADMAP/);
      const lint = cli(root, ['lint']);
      assert.equal(lint.code, 0, lint.err);
    } finally {
      cleanup(root);
    }
  });

  test(`roadmap migration (${lang}): an edited copy stays with docs/README.md, and a warning names it`, () => {
    const { root, old } = roadmapConsumer(lang);
    try {
      put(root, 'docs/ROADMAP.md', `${read(root, 'docs/ROADMAP.md')}\nOwn goal.\n`);
      gitAll(root, 'own goal');
      const edited = read(root, 'docs/ROADMAP.md');
      const r = cli(root, ['migrate']);
      assert.equal(r.code, 0, r.err);
      assert.match(r.err, says.differs);
      assert.equal(read(root, 'docs/ROADMAP.md'), edited);
      assert.equal(read(root, 'docs/README.md'), old);
      const lint = cli(root, ['lint']);
      assert.equal(lint.code, 0, lint.err);
    } finally {
      cleanup(root);
    }
  });

  test(`roadmap migration (${lang}): a CRLF copy is deleted and docs/README.md keeps CRLF`, () => {
    const { root, fresh } = roadmapConsumer(lang);
    try {
      run(root, ['config', 'core.autocrlf', 'false']);
      for (const rel of ['docs/ROADMAP.md', 'docs/README.md']) put(root, rel, read(root, rel).replaceAll('\n', '\r\n'));
      gitAll(root, 'crlf');
      const r = cli(root, ['migrate']);
      assert.equal(r.code, 0, r.err);
      assert.ok(!hasRoadmap(root));
      assert.equal(read(root, 'docs/README.md'), fresh.replaceAll('\n', '\r\n'));
    } finally {
      cleanup(root);
    }
  });

  test(`roadmap migration (${lang}): a pristine copy another doc links stays; a link in code does not count`, () => {
    const { root, old, roadmap } = roadmapConsumer(lang);
    try {
      put(root, 'docs/GLOSSARY.md', `${read(root, 'docs/GLOSSARY.md')}\nSee [goals](ROADMAP.md).\n`);
      put(root, 'AGENTS.md', `${read(root, 'AGENTS.md')}\nShown, not linked: \`[goals](docs/ROADMAP.md)\`.\n`);
      gitAll(root, 'links');
      const r = cli(root, ['migrate']);
      assert.equal(r.code, 0, r.err);
      assert.match(r.err, says.linked);
      assert.doesNotMatch(r.err, /AGENTS\.md/);
      assert.equal(read(root, 'docs/ROADMAP.md'), roadmap);
      assert.equal(read(root, 'docs/README.md'), old);
    } finally {
      cleanup(root);
    }
  });

  test(`roadmap migration (${lang}): an uncommitted edit refuses before the first write`, () => {
    const { root } = roadmapConsumer(lang);
    try {
      put(root, 'docs/README.md', `${read(root, 'docs/README.md')}| [x](x.md) | Own row | Living |\n`);
      const before = run(root, ['status', '--porcelain']).stdout;
      for (const args of [['migrate', '--dry-run'], ['migrate']]) {
        const r = cli(root, args);
        assert.equal(r.code, 1, `${args.join(' ')}: ${r.out}`);
        assert.match(r.err, says.dirty);
      }
      assert.equal(run(root, ['status', '--porcelain']).stdout, before, 'something was written');
      assert.ok(hasRoadmap(root));
      assert.equal(config(root).version, '0.11.0');
    } finally {
      cleanup(root);
    }
  });

  test(`roadmap migration (${lang}): --dry-run prints the plan and writes nothing`, () => {
    const { root } = roadmapConsumer(lang);
    try {
      const r = cli(root, ['migrate', '--dry-run']);
      assert.equal(r.code, 0, r.err);
      assert.match(r.out, says.dry);
      assert.equal(run(root, ['status', '--porcelain']).stdout, '');
    } finally {
      cleanup(root);
    }
  });

  test(`roadmap migration (${lang}): after upgrade --pin-only the old pin in the copy still reads as untouched`, () => {
    const src = releasesRepo(['v0.11.0', `v${TOOL_VERSION}`]);
    const shim = npxShim();
    const { root } = roadmapConsumer(lang, OLD_PIN, { source: src });
    try {
      const env = { PATH: `${shim}${path.delimiter}${process.env.PATH}` };
      let r = cli(root, ['upgrade', '--pin-only'], { env });
      assert.equal(r.code, 0, r.err);
      assert.ok(read(root, 'docs/ROADMAP.md').includes(OLD_PIN), 'the prose pin moved');
      r = cli(root, ['migrate']);
      assert.equal(r.code, 0, r.err);
      assert.match(r.out, says.deleted);
      const readme = read(root, 'docs/README.md');
      assert.doesNotMatch(readme, /ROADMAP/);
      assert.ok(readme.split('\n')[2].includes(`npx github:me/proj#v${TOOL_VERSION} status`), readme);
    } finally {
      cleanup(root);
      rmSync(src, { recursive: true, force: true });
      rmSync(shim, { recursive: true, force: true });
    }
  });

  test(`roadmap migration (${lang}): a normal upgrade from an old pin deletes the copy before prose pins move`, () => {
    const src = releasesRepo(['v0.11.0', `v${TOOL_VERSION}`]);
    const shim = npxShim();
    const { root } = roadmapConsumer(lang, OLD_PIN, { source: src });
    try {
      const env = { PATH: `${shim}${path.delimiter}${process.env.PATH}` };
      const r = cli(root, ['upgrade'], { env });
      assert.equal(r.code, 0, r.err);
      assert.match(r.out, says.deleted);
      assert.ok(r.out.indexOf('ROADMAP.md') < r.out.search(/pin in prose|пин в прозе/), r.out);
      assert.ok(!hasRoadmap(root));
      assert.doesNotMatch(read(root, 'docs/README.md'), /ROADMAP/);
      const lint = cli(root, ['lint'], { env });
      assert.equal(lint.code, 0, lint.err);
    } finally {
      cleanup(root);
      rmSync(src, { recursive: true, force: true });
      rmSync(shim, { recursive: true, force: true });
    }
  });
}

test('roadmap migration: a copy already deleted leaves its two docs/README.md lines to drop', () => {
  const { root, fresh } = roadmapConsumer('en');
  try {
    rmSync(path.join(root, 'docs', 'ROADMAP.md'));
    gitAll(root, 'no roadmap');
    const r = cli(root, ['migrate']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, ROADMAP_SAYS.en.edited);
    assert.doesNotMatch(r.out, /deleted docs\/ROADMAP/);
    assert.equal(read(root, 'docs/README.md'), fresh);
    const lint = cli(root, ['lint']);
    assert.equal(lint.code, 0, lint.err);
  } finally {
    cleanup(root);
  }
});

test('roadmap migration: a cli with no pin compares the copy as plain text', () => {
  const { root, fresh } = roadmapConsumer('en', 'backslop');
  try {
    let r = cli(root, ['migrate', '--dry-run']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, ROADMAP_SAYS.en.dry);
    put(root, 'docs/ROADMAP.md', read(root, 'docs/ROADMAP.md').replace('backslop status', 'backslop@0.11.0 status'));
    gitAll(root, 'a pin by hand');
    r = cli(root, ['migrate']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.err, ROADMAP_SAYS.en.differs);
    assert.ok(hasRoadmap(root));
    assert.notEqual(read(root, 'docs/README.md'), fresh);
  } finally {
    cleanup(root);
  }
});

test('roadmap migration: a copy behind a symlink is left alone with a warning', { skip: process.platform === 'win32' }, () => {
  const { root, old } = roadmapConsumer('ru');
  const shared = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-shared-')));
  try {
    const text = read(root, 'docs/ROADMAP.md');
    writeFileSync(path.join(shared, 'ROADMAP.md'), text);
    rmSync(path.join(root, 'docs', 'ROADMAP.md'));
    symlinkSync(path.join(shared, 'ROADMAP.md'), path.join(root, 'docs', 'ROADMAP.md'));
    gitAll(root, 'shared roadmap');
    const r = cli(root, ['migrate']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.err, ROADMAP_SAYS.ru.symlink);
    assert.equal(read(shared, 'ROADMAP.md'), text);
    assert.equal(read(root, 'docs/README.md'), old);
  } finally {
    cleanup(root);
    rmSync(shared, { recursive: true, force: true });
  }
});

test('roadmap migration: a copy and docs/README.md whose only uncommitted change is a moved pin are clean', () => {
  const { root, fresh } = roadmapConsumer('en');
  const now = `npx github:me/proj#v${TOOL_VERSION}`;
  const movePins = () => {
    for (const rel of ['docs/ROADMAP.md', 'docs/README.md']) put(root, rel, read(root, rel).replaceAll(OLD_PIN, now));
    setConfig(root, { cli: now });
  };
  try {
    movePins();
    let r = cli(root, ['migrate']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, ROADMAP_SAYS.en.deleted);
    assert.match(r.out, ROADMAP_SAYS.en.edited);
    assert.ok(!hasRoadmap(root));
    assert.equal(read(root, 'docs/README.md'), fresh.replaceAll(OLD_PIN, now));

    run(root, ['checkout', '--', '.']);
    movePins();
    put(root, 'docs/README.md', `${read(root, 'docs/README.md')}| [x](x.md) | Own row | Living |\n`);
    r = cli(root, ['migrate']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, ROADMAP_SAYS.en.dirty);
    assert.ok(hasRoadmap(root));
    assert.equal(config(root).version, '0.11.0');
  } finally {
    cleanup(root);
  }
});

test('roadmap migration: a docs/README.md behind a symlink is left alone and keeps the copy', { skip: process.platform === 'win32' }, () => {
  const { root, old, roadmap } = roadmapConsumer('en');
  const shared = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-shared-')));
  try {
    writeFileSync(path.join(shared, 'README.md'), old);
    rmSync(path.join(root, 'docs', 'README.md'));
    symlinkSync(path.join(shared, 'README.md'), path.join(root, 'docs', 'README.md'));
    gitAll(root, 'shared index');
    const r = cli(root, ['migrate']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.err, /docs\/README\.md: the path goes through the symlink docs\/README\.md — file left alone/);
    assert.match(r.err, /docs\/ROADMAP\.md: kept — is still linked from docs\/README\.md;/);
    assert.equal(read(shared, 'README.md'), old, 'the write landed behind the link');
    assert.equal(read(root, 'docs/ROADMAP.md'), roadmap);
  } finally {
    cleanup(root);
    rmSync(shared, { recursive: true, force: true });
  }
});

test('roadmap migration: docs/README.md keeps its BOM when its old lines go', () => {
  const { root, fresh } = roadmapConsumer('en');
  try {
    put(root, 'docs/README.md', `﻿${read(root, 'docs/README.md')}`);
    gitAll(root, 'bom');
    const r = cli(root, ['migrate']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, ROADMAP_SAYS.en.deleted);
    assert.equal(read(root, 'docs/README.md'), `﻿${fresh}`);
  } finally {
    cleanup(root);
  }
});

test('roadmap migration: a copy in the language the project left is kept with a warning', () => {
  const { root, old, roadmap } = roadmapConsumer('ru');
  try {
    setConfig(root, { lang: 'en' });
    gitAll(root, 'lang en');
    const r = cli(root, ['migrate']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.err, ROADMAP_SAYS.en.differs);
    assert.equal(read(root, 'docs/ROADMAP.md'), roadmap);
    assert.equal(read(root, 'docs/README.md'), old);
  } finally {
    cleanup(root);
  }
});

test('roadmap migration: a copy already gone that an edited line still links is named in a warning', () => {
  const { root } = roadmapConsumer('en');
  try {
    rmSync(path.join(root, 'docs', 'ROADMAP.md'));
    const readme = read(root, 'docs/README.md').replace('for project direction, see', 'for our goals, see');
    put(root, 'docs/README.md', readme);
    gitAll(root, 'no roadmap, own intro');
    const r = cli(root, ['migrate']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, ROADMAP_SAYS.en.edited);
    assert.match(r.err, /docs\/ROADMAP\.md: the file is gone, yet docs\/README\.md still link it — fix or remove those links/);
    const after = read(root, 'docs/README.md');
    assert.ok(after.includes('for our goals, see [ROADMAP.md](ROADMAP.md)'), 'the edited line was touched');
    assert.doesNotMatch(after, /\| \[ROADMAP\.md\]\(ROADMAP\.md\) \|/);
  } finally {
    cleanup(root);
  }
});

test('roadmap migration: a link from the archive keeps the copy, as lint gate 1 reads the archive', () => {
  const { root, roadmap } = roadmapConsumer('en');
  try {
    put(root, 'docs/archive/BS-1-alpha/task.md', '# BS-1 · Alpha\n\nSee [goals](../../ROADMAP.md).\n');
    put(root, 'docs/archive/LOG.md', `${read(root, 'docs/archive/LOG.md')}- <a id="bs-1"></a>BS-1 alpha, see [goals](../ROADMAP.md)\n`);
    gitAll(root, 'archive links');
    const r = cli(root, ['migrate']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.err, /docs\/ROADMAP\.md: kept — is still linked from docs\/README\.md, docs\/archive\/BS-1-alpha\/task\.md, docs\/archive\/LOG\.md;/);
    assert.equal(read(root, 'docs/ROADMAP.md'), roadmap);
  } finally {
    cleanup(root);
  }
});
