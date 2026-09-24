// Обновление проекта: пин, гейты, выжимка CHANGELOG и команды процессом; релизы — локальный git с
// тегами, без сети. Тесты, доходящие до пробы (шим npx на `/bin/sh`), на Windows — skip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseCli } from '../lib/config.js';
import { changelogSince } from '../lib/changelog.js';
import { listReleaseTags, rewriteGates } from '../lib/upgrade.js';
import { renderTemplate } from '../lib/templates.js';
import { TOOL_VERSION } from '../lib/version.js';
import { BIN, cleanup, cli, gitAll, makeProject, put, read } from './helpers.mjs';

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

test('upgrade npm-пина: теги только из explicit source, флаги и gates сохраняются', { skip: process.platform === 'win32' }, () => {
  const root = makeProject({ git: false });
  const src = releasesRepo(['v0.2.0', 'v0.3.0']);
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
    assert.match(r.out, /→ npx --yes -q backslop@0\.3\.0 version/, 'проба новой версии идёт и при --pin-only');
    assert.equal(config(root).cli, 'npx --yes -q backslop@0.3.0');
    assert.deepEqual(config(root).gates, ['npx --yes -q backslop@0.3.0 lint', 'npm test']);
  } finally {
    cleanup(root);
    rmSync(src, { recursive: true, force: true });
    rmSync(shim, { recursive: true, force: true });
  }
});

test('rewriteGates: меняется только команда, начинающаяся со старого cli', () => {
  assert.deepEqual(
    rewriteGates(['npx github:me/proj#v0.1.0 lint', 'npm test', 'npx github:me/proj#v0.1.0'], 'npx github:me/proj#v0.1.0', 'npx github:me/proj#v0.2.0'),
    ['npx github:me/proj#v0.2.0 lint', 'npm test', 'npx github:me/proj#v0.2.0'],
  );
  assert.deepEqual(rewriteGates(['npx github:me/proj#v0.1.0x lint'], 'npx github:me/proj#v0.1.0', 'npx github:me/proj#v0.2.0'),
    ['npx github:me/proj#v0.1.0x lint'], 'подстрока без пробела — другая команда');
  // Запись с областью правится внутрь и сохраняет `when`, нетронутая возвращается той же ссылкой —
  // иначе число заменённых было бы числом записей с областью.
  const gates = [{ command: 'npx github:me/proj#v0.1.0 lint', when: ['docs/**'] }, { command: 'npm test', when: ['lib/**'] }];
  const next = rewriteGates(gates, 'npx github:me/proj#v0.1.0', 'npx github:me/proj#v0.2.0');
  assert.deepEqual(next, [{ command: 'npx github:me/proj#v0.2.0 lint', when: ['docs/**'] }, { command: 'npm test', when: ['lib/**'] }]);
  assert.equal(next[1], gates[1], 'нетронутая запись — та же ссылка');
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

test('upgrade --dry-run показывает план и ничего не пишет; --pin-only переставляет пин, lint предупреждает', { skip: process.platform === 'win32' }, () => {
  const root = makeProject({ git: false });
  const src = releasesRepo(['v0.1.0', 'v0.2.0']);
  const shim = npxShim();
  try {
    const env = { PATH: `${shim}${path.delimiter}${process.env.PATH}` };
    setConfig(root, { cli: 'npx github:me/proj#v0.1.0', gates: ['npx github:me/proj#v0.1.0 lint', 'npm test'], version: '0.1.0', source: src });
    const before = read(root, 'backslop.json');
    let r = cli(root, ['upgrade', '--dry-run'], { env });
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /v0\.1\.0 → v0\.2\.0/);
    assert.match(r.out, /npx github:me\/proj#v0\.2\.0/);
    assert.equal(read(root, 'backslop.json'), before);

    r = cli(root, ['upgrade', '--pin-only'], { env });
    assert.equal(r.code, 0, r.err);
    const cfg = config(root);
    assert.equal(cfg.cli, 'npx github:me/proj#v0.2.0');
    assert.deepEqual(cfg.gates, ['npx github:me/proj#v0.2.0 lint', 'npm test']);
    assert.equal(cfg.version, '0.1.0', 'штамп ставит только новая версия через migrate/init');

    r = cli(root, ['lint'], { env });
    assert.equal(r.code, 0, r.err);
    assert.match(r.err, /пин в cli v0\.2\.0 расходится со штампом v0\.1\.0/);

    setConfig(root, { version: '0.2.0' });
    r = cli(root, ['upgrade'], { env });
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /уже на v0\.2\.0/);
    r = cli(root, ['upgrade', '--to', 'v9.9.9'], { env });
    assert.equal(r.code, 1);
    assert.match(r.err, /тега v9\.9\.9/);
    r = cli(root, ['upgrade', '--to', 'v0.1.0'], { env });
    assert.equal(r.code, 1);
    assert.match(r.err, /старше v0\.2\.0/);
    assert.equal(config(root).cli, 'npx github:me/proj#v0.2.0', 'отказ ничего не переставил');
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
    assert.match(r.out, /миграция до v0\.9\.0: каталог статуса minor\/ \(--dry-run\)/, 'без штампа проект считается старше любой миграции');
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
    assert.match(r.err, /кодом 3/);
    assert.match(r.err, /Пин и штамп не тронуты/);
    assert.equal(config(root).cli, 'npx github:me/proj#v0.1.0');
    assert.deepEqual(config(root).gates, ['npx github:me/proj#v0.1.0 lint', 'npm test']);
  } finally {
    cleanup(root);
    rmSync(src, { recursive: true, force: true });
    rmSync(broken, { recursive: true, force: true });
  }
});
