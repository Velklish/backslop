// Обновление проекта: пин, гейты, выжимка CHANGELOG и команды процессом; релизы — локальный git с
// тегами, без сети. Тесты, доходящие до пробы (шим npx на `/bin/sh`), на Windows — skip.
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

test('upgrade npm-пина: теги только из explicit source, флаги и gates сохраняются', { skip: process.platform === 'win32' }, () => {
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

test('upgrade --dry-run показывает план и ничего не пишет; --pin-only переставляет пин, lint предупреждает', { skip: process.platform === 'win32' }, () => {
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

    r = cli(root, ['lint'], { env });
    assert.equal(r.code, 0, r.err);
    assert.ok(r.err.includes(`пин в cli v${V} расходится со штампом v0.1.0`), r.err);

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
    setConfig(root, { cli: `node "${BIN}"`, gates: [`node "${BIN}" lint`], version: '0.0.9', source: src, tools: ['claude'] });
    rmSync(path.join(root, 'docs', 'README.md'));
    const rules = renderTemplate('docs/backlog/README.md', { cli: `node "${BIN}"`, prefix: 'BS', project: path.basename(root) });
    put(root, 'docs/backlog/README.md', staleRules(rules));
    put(root, 'docs/GLOSSARY.md', '# Свой глоссарий\n');
    const r = cli(root, ['upgrade']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.err, /пин не меняется/);
    assert.match(r.out, /→ node .*backslop\.js" migrate/);
    assert.match(r.out, /→ node .*backslop\.js" init/);
    assert.match(r.out, /## v0\.1\.0/);
    assert.equal(config(root).version, TOOL_VERSION);
    assert.equal(read(root, 'docs/backlog/README.md'), rules, 'правила ведения — рендер шаблона новой версии');
    assert.equal(read(root, 'docs/GLOSSARY.md'), '# Свой глоссарий\n', 'проектный файл docs upgrade не перерисовывает');
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
    assert.match(r.out, /миграция до v0\.10\.0: журнал закрытых docs\/archive\/LOG\.md \(--dry-run\)/, 'без штампа проект считается старше любой миграции');
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

// Правила ведения и архива принадлежат инструменту (ADR-032): migrate перерисовывает их, пока
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

test('upgrade pins a floating cli inside an init-rendered rules pair, with no note', { skip: process.platform === 'win32' }, () => {
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
function npxShim() {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-npx-')));
  const shim = path.join(dir, 'npx');
  // Снимает флаги npx и спеку пакета, сколько бы их ни было: `npx --yes -q backslop@X version`
  // и `npx github:me/proj#vX version` оба должны дойти до локального bin как `version`.
  writeFileSync(shim, `#!/bin/sh\nwhile [ $# -gt 0 ]; do case "$1" in -*) shift ;; *) shift; break ;; esac; done\nexec "${process.execPath}" "${BIN}" "$@"\n`);
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
    assert.match(r.err, / — код 3\. /);
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

// Пин живёт не только в конфиге: живая инструкция в docs зовёт его текстом команды.
test('upgrade: пин в прозе docs переставляется, записи о моменте — нет', { skip: process.platform === 'win32' }, () => {
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

test('upgrade leaves a pin in a journal entry, rewrites the LOG.md header, then says already on', { skip: process.platform === 'win32' }, () => {
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

// Пин пишется только после пробного запуска новой версии, и `--pin-only` пробу не сокращает:
// иначе проект остался бы с пином на команду, которая не поднимается.
test('upgrade --pin-only: сбой пробного запуска не пишет пин и гейты', { skip: process.platform === 'win32' }, () => {
  const root = makeProject({ git: false });
  const src = releasesRepo(['v0.1.0', 'v0.2.0']);
  const broken = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-npx-')));
  writeFileSync(path.join(broken, 'npx'), '#!/bin/sh\nexit 3\n');
  chmodSync(path.join(broken, 'npx'), 0o755);
  try {
    setConfig(root, { cli: 'npx github:me/proj#v0.1.0', gates: ['npx github:me/proj#v0.1.0 lint', 'npm test'], version: '0.1.0', source: src });
    const r = cli(root, ['upgrade', '--pin-only'], { env: { PATH: `${broken}${path.delimiter}${process.env.PATH}` } });
    assert.equal(r.code, 1);
    assert.match(r.err, / — код 3\. /);
    assert.match(r.err, /Пин и штамп не тронуты/);
    assert.equal(config(root).cli, 'npx github:me/proj#v0.1.0');
    assert.deepEqual(config(root).gates, ['npx github:me/proj#v0.1.0 lint', 'npm test']);
  } finally {
    cleanup(root);
    rmSync(src, { recursive: true, force: true });
    rmSync(broken, { recursive: true, force: true });
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

test('upgrade from a pinned consumer with committed rules completes in one run', { skip: process.platform === 'win32' }, () => {
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
test('upgrade shows the first probe run and compares the version of a second one', { skip: process.platform === 'win32' }, () => {
  const root = makeProject({ git: false });
  const src = releasesRepo(['v0.1.0', `v${TOOL_VERSION}`]);
  const shim = npxShim();
  try {
    const seen = path.join(shim, 'seen');
    writeFileSync(path.join(shim, 'npx'), `#!/bin/sh\nif [ ! -e "${seen}" ]; then : > "${seen}"; echo 'Need to install the following packages: Ok to proceed? (y)'; echo 'backslop 0.1.0'; exit 0; fi\nwhile [ $# -gt 0 ]; do case "$1" in -*) shift ;; *) shift; break ;; esac; done\nexec "${process.execPath}" "${BIN}" "$@"\n`, { mode: 0o755 });
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

test('upgrade takes the lower of pin and stamp as the from-version', { skip: process.platform === 'win32' }, () => {
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

test('upgrade moves every pin inside gate commands and probe', { skip: process.platform === 'win32' }, () => {
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

test('upgrade pins a floating cli already on the latest version', { skip: process.platform === 'win32' }, () => {
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

test('upgrade: the printed after-pin recovery sequence completes the run', { skip: process.platform === 'win32' }, () => {
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
