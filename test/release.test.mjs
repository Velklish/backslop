// Проверки скрипта релиза. Файл не рассчитан на Windows: git и npm подменяются шимами с
// shebang (putExecutable ниже), которые Windows не исполняет, а acceptance зовёт `npm` без
// shell. Тесты, у которых от платформы зависит сам предмет проверки, помечены skip явно.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const RELEASE = path.join(REPO, 'scripts', 'release.mjs');

function putExecutable(file, text) {
  writeFileSync(file, text);
  chmodSync(file, 0o755);
}

function fixture({ version = '0.2.0' } = {}) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-release-')));
  const bin = path.join(root, 'fake-bin');
  mkdirSync(bin);
  // Скрипт лежит в scripts/ и рядом с ним настоящий lib/util.js: релиз берёт оттуда today()
  // для заголовка секции CHANGELOG, и плоская копия в корне не нашла бы модуль.
  mkdirSync(path.join(root, 'scripts'));
  mkdirSync(path.join(root, 'lib'));
  copyFileSync(RELEASE, path.join(root, 'scripts', 'release.mjs'));
  copyFileSync(path.join(REPO, 'lib', 'util.js'), path.join(root, 'lib', 'util.js'));
  copyFileSync(path.join(REPO, 'lib', 'version.js'), path.join(root, 'lib', 'version.js'));
  // `type: module` — не украшение: без него node перечитывает скопированные lib/*.js как CJS,
  // и предупреждение MODULE_TYPELESS_PACKAGE_JSON садится в stderr, который тесты сверяют.
  writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({ name: 'backslop', version, type: 'module' }, null, 2)}\n`);
  const shim = `#!${process.execPath}\nimport { appendFileSync, existsSync, writeFileSync } from 'node:fs';\nconst name = process.argv[1].split('/').pop();\nconst args = process.argv.slice(2);\nappendFileSync(process.env.RELEASE_LOG, [name, ...args].join(' ') + '\\n');\nif (name === 'git' && args[0] === 'branch') process.stdout.write(process.env.FAKE_BRANCH ?? 'main');\nif (name === 'npm' && args.join(' ') === 'pack --dry-run' && process.env.FAKE_GATE_DIRTY) writeFileSync('generated.txt', 'gate output\\n');\nif (name === 'git' && args[0] === 'status' && (process.env.FAKE_DIRTY || existsSync('generated.txt'))) process.stdout.write('?? generated.txt\\n');\nif (name === 'git' && args[0] === 'rev-parse') process.exit(process.env.FAKE_LOCAL_TAG ? 0 : 1);\nif (name === 'git' && args[0] === 'ls-remote') process.exit(process.env.FAKE_REMOTE_TAG ? 0 : 2);\nif (name === 'git' && args[0] === 'fetch') process.exit(process.env.FAKE_FETCH_FAIL ? 9 : 0);\nif (name === 'git' && args[0] === 'merge-base') process.exit(process.env.FAKE_DIVERGED ? 1 : 0);\nif (name === 'git' && args[0] === 'push' && args.includes('--dry-run')) process.exit(process.env.FAKE_PUSH_DRY_FAIL ? 8 : 0);\nif (name === 'npm' && process.env.FAKE_NPM_FAIL === args.join(' ')) process.exit(7);\nif (name === 'git' && process.env.FAKE_GIT_FAIL === args.join(' ')) process.exit(8);\n`;
  putExecutable(path.join(bin, 'git'), shim);
  putExecutable(path.join(bin, 'npm'), shim);
  return { root, bin, log: path.join(root, 'release.log') };
}

function runRelease(f, version = '0.2.0', env = {}) {
  const r = spawnSync(process.execPath, ['scripts/release.mjs', ...(Array.isArray(version) ? version : [version])], {
    cwd: f.root,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${f.bin}${path.delimiter}${process.env.PATH}`, RELEASE_LOG: f.log, ...env },
  });
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '', log: existsSync(f.log) ? readFileSync(f.log, 'utf8') : '' };
}

function cleanup(f) {
  rmSync(f.root, { recursive: true, force: true });
}

test('release: все preflight и gates идут до tag, publish и atomic push', () => {
  const f = fixture();
  try {
    const r = runRelease(f);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(r.log.trim().split('\n'), [
      'git branch --show-current',
      'git status --porcelain',
      'git rev-parse --verify --quiet refs/tags/v0.2.0',
      'git ls-remote --exit-code --tags origin refs/tags/v0.2.0',
      'git fetch origin',
      'git merge-base --is-ancestor refs/remotes/origin/main HEAD',
      'npm test',
      'npm run lint',
      'npm pack --dry-run',
      'git status --porcelain',
      'git tag v0.2.0',
      'git push --atomic --dry-run origin main v0.2.0',
      'npm publish',
      'git push --atomic origin main v0.2.0',
    ]);
  } finally {
    cleanup(f);
  }
});

test('release: изменения от gates останавливают release перед tag', () => {
  const f = fixture();
  try {
    const r = runRelease(f, '0.2.0', { FAKE_GATE_DIRTY: '1' });
    assert.equal(r.code, 1);
    assert.match(r.err, /gates изменили рабочее дерево; тег не создан/);
    assert.match(r.err, /\?\? generated\.txt/);
    assert.match(r.log, /npm pack --dry-run\ngit status --porcelain\n$/);
    assert.doesNotMatch(r.log, /git tag|npm publish|git push/);
  } finally {
    cleanup(f);
  }
});

test('release: argument, package version, branch, dirty tree и tag collision останавливаются до gates и side effects', () => {
  const cases = [
    { version: 'v0.2.0', match: /форме X\.Y\.Z/, log: [] },
    { fixture: { version: '0.1.0' }, match: /version 0\.1\.0.*запрошен 0\.2\.0/, log: [] },
    { env: { FAKE_BRANCH: 'topic' }, match: /ветка «topic»/, log: ['git branch --show-current'] },
    { env: { FAKE_DIRTY: '1' }, match: /рабочее дерево нечисто/, log: ['git branch --show-current', 'git status --porcelain'] },
    { env: { FAKE_LOCAL_TAG: '1' }, match: /локальный тег v0\.2\.0 уже/, log: ['git branch --show-current', 'git status --porcelain', 'git rev-parse --verify --quiet refs/tags/v0.2.0'] },
    { env: { FAKE_REMOTE_TAG: '1' }, match: /тег v0\.2\.0 уже.*origin/, log: ['git branch --show-current', 'git status --porcelain', 'git rev-parse --verify --quiet refs/tags/v0.2.0', 'git ls-remote --exit-code --tags origin refs/tags/v0.2.0'] },
    { env: { FAKE_FETCH_FAIL: '1' }, match: /git fetch origin/, log: ['git branch --show-current', 'git status --porcelain', 'git rev-parse --verify --quiet refs/tags/v0.2.0', 'git ls-remote --exit-code --tags origin refs/tags/v0.2.0', 'git fetch origin'] },
    { version: ['0.2.0', '--nope'], match: /неизвестный флаг --nope/, log: [] },
    { version: ['0.2.0', '--bump', '--no-publish'], match: /вместе бессмысленны/, log: [] },
    { version: ['0.1.0', '--bump'], match: /bump идёт только вверх/, log: [] },
    { version: ['0.3.0', '--bump'], setup: (f) => writeFileSync(path.join(f.root, 'CHANGELOG.md'), '# Changelog\n\nбез секций\n'), match: /нет ни одной секции/, log: [] },
    { env: { FAKE_DIVERGED: '1' }, match: /не является fast-forward от origin\/main/, log: ['git branch --show-current', 'git status --porcelain', 'git rev-parse --verify --quiet refs/tags/v0.2.0', 'git ls-remote --exit-code --tags origin refs/tags/v0.2.0', 'git fetch origin', 'git merge-base --is-ancestor refs/remotes/origin/main HEAD'] },
  ];
  for (const c of cases) {
    const f = fixture(c.fixture);
    try {
      if (c.setup) c.setup(f);
      const r = runRelease(f, c.version, c.env);
      assert.equal(r.code, 1);
      assert.match(r.err, c.match);
      assert.deepEqual(r.log.trim() ? r.log.trim().split('\n') : [], c.log);
    } finally {
      cleanup(f);
    }
  }
});

test('release: каждый gate failure не допускает tag/publish/push', () => {
  for (const failed of ['test', 'run lint', 'pack --dry-run']) {
    const f = fixture();
    try {
      const r = runRelease(f, '0.2.0', { FAKE_NPM_FAIL: failed });
      assert.equal(r.code, 1);
      assert.match(r.err, new RegExp(`npm ${failed.replaceAll(' ', '\\s+')}`));
      assert.doesNotMatch(r.log, /git tag|npm publish|git push/);
    } finally {
      cleanup(f);
    }
  }
});

test('release: отказ push --dry-run оставляет local tag и не публикует', () => {
  const f = fixture();
  try {
    const r = runRelease(f, '0.2.0', { FAKE_PUSH_DRY_FAIL: '1' });
    assert.equal(r.code, 1);
    assert.match(r.err, /state: локальный тег v0\.2\.0 создан; origin не изменён; npm registry не тронут/);
    assert.match(r.log, /git tag v0\.2\.0\ngit push --atomic --dry-run origin main v0\.2\.0\n$/);
    assert.doesNotMatch(r.log, /npm publish|git push --atomic origin/);
  } finally {
    cleanup(f);
  }
});

test('release: publish failure оставляет local tag и печатает первую recovery-команду', () => {
  const f = fixture();
  try {
    const r = runRelease(f, '0.2.0', { FAKE_NPM_FAIL: 'publish' });
    assert.equal(r.code, 1);
    assert.match(r.err, /state: локальный тег v0\.2\.0 создан; origin не изменён; состояние npm registry неизвестно/);
    assert.match(r.err, /next: npm view backslop@0\.2\.0 version/);
    assert.match(r.err, /if published: git push --atomic origin main v0\.2\.0/);
    assert.match(r.err, /if E404: npm publish, затем git push --atomic origin main v0\.2\.0/);
    assert.match(r.log, /git tag v0\.2\.0\ngit push --atomic --dry-run origin main v0\.2\.0\nnpm publish\n$/);
    assert.doesNotMatch(r.log, /git push --atomic origin main/);
  } finally {
    cleanup(f);
  }
});

test('release: push failure фиксирует published state и exact atomic retry', () => {
  const f = fixture();
  try {
    const push = 'push --atomic origin main v0.2.0';
    const r = runRelease(f, '0.2.0', { FAKE_GIT_FAIL: push });
    assert.equal(r.code, 1);
    assert.match(r.err, /state: backslop@0\.2\.0 опубликован; локальный тег v0\.2\.0 создан; atomic push не подтверждён/);
    assert.match(r.err, /next: git push --atomic origin main v0\.2\.0/);
    assert.match(r.log, /git push --atomic --dry-run origin main v0\.2\.0\nnpm publish\ngit push --atomic origin main v0\.2\.0\n$/);
  } finally {
    cleanup(f);
  }
});

// Отказ запуска и ненулевой код запущенной команды — разные отказы, и assert.equal(status, 0)
// их не различает: у несостоявшегося запуска status === null, причина лежит в error, а у снятого
// сигналом — в signal. «null !== 0» не называет ни команды, ни причины, и приёмка сообщает про
// дефект релиза там, где на машине просто нет npm или его снял sandbox.
function describeRun(label, r) {
  if (r.error) return `${label}: запуск не состоялся — ${r.error.code ?? r.error.message}`;
  if (r.signal) return `${label}: снят сигналом ${r.signal}`;
  if (r.status !== 0) return `${label}: код ${r.status}\n${(r.stderr ?? '').trim()}`;
  return null;
}

function runOk(label, cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  const why = describeRun(label, r);
  if (why !== null) assert.fail(why);
  return r;
}

// npm запускается со своим HOME, кэшем и обоими конфигами внутри каталога самой проверки:
// иначе он читает ~/.npmrc с токеном реестра и лезет за учёткой в Keychain — под sandbox этот
// запрос отклоняется, npm снимают, и приёмка релиза краснеет на окружении участника, а не на
// релизе. Унаследованные npm_config_* выбрасываются целиком: родитель прогона — сам `npm test`,
// и он выкладывает в окружение всю свою конфигурацию, включая globalconfig и userconfig.
// Зависимостей у пакета нет, поэтому install идёт --offline и реестр не нужен вовсе.
function npmEnv(home, cache) {
  mkdirSync(home, { recursive: true });
  writeFileSync(path.join(home, '.npmrc'), '');
  writeFileSync(path.join(home, 'globalrc'), '');
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('npm_config_')));
  return {
    ...inherited,
    HOME: home,
    USERPROFILE: home,
    npm_config_cache: cache,
    npm_config_userconfig: path.join(home, '.npmrc'),
    npm_config_globalconfig: path.join(home, 'globalrc'),
    npm_config_update_notifier: 'false',
  };
}

test('acceptance-раннер различает несостоявшийся запуск, сигнал и ненулевой код', { skip: process.platform === 'win32' }, () => {
  const missing = spawnSync(path.join(os.tmpdir(), 'backslop-такой-команды-нет'), [], { encoding: 'utf8' });
  assert.match(describeRun('npm pack', missing), /^npm pack: запуск не состоялся — ENOENT$/);

  const failed = spawnSync(process.execPath, ['-e', 'process.stderr.write("нет доступа к реестру"); process.exit(7)'], { encoding: 'utf8' });
  assert.match(describeRun('npm pack', failed), /^npm pack: код 7\nнет доступа к реестру$/);

  const killed = spawnSync(process.execPath, ['-e', 'process.kill(process.pid, "SIGKILL")'], { encoding: 'utf8' });
  assert.equal(describeRun('npm pack', killed), 'npm pack: снят сигналом SIGKILL');

  assert.equal(describeRun('npm pack', spawnSync(process.execPath, ['-e', ''], { encoding: 'utf8' })), null);
});

test('packed tarball matches files, installs locally and its bin passes version, init and lint', { timeout: 60_000 }, () => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-pack-')));
  const packDir = path.join(root, 'pack');
  const project = path.join(root, 'project');
  const cache = path.join(root, 'npm-cache');
  mkdirSync(packDir);
  mkdirSync(project);
  try {
    const env = npmEnv(path.join(root, 'home'), cache);
    const packed = runOk('npm pack', 'npm', ['pack', REPO, '--json', '--pack-destination', packDir, '--cache', cache, '--ignore-scripts'], { env });
    const packInfo = JSON.parse(packed.stdout)[0];
    const tarball = path.join(packDir, packInfo.filename);
    writeFileSync(path.join(project, 'package.json'), '{"name":"acceptance","private":true}\n');
    const manifest = JSON.parse(readFileSync(path.join(REPO, 'package.json'), 'utf8'));
    assert.deepEqual(Object.keys(manifest.dependencies ?? {}), [], '--offline держится на отсутствии зависимостей');

    // Состав tarball: всё, что инструменту нужно, и ничего сверх. Три команды ниже выпадение
    // `templates/` из `files` не поймают — self-host без adapters шаблонов скиллов не рендерит.
    // Ожидаемое — отслеживаемые git файлы каталогов из `files`, а не содержимое каталогов на
    // диске: `.DS_Store`, `._*`, `.gitignore` npm выбрасывает и внутри перечисленных каталогов,
    // и обход диска красил бы гейт артефактом ОС без следа в `git status`.
    const REQUIRED = ['bin', 'lib', 'templates', 'README.md', 'README.ru.md', 'LICENSE', 'CHANGELOG.md'];
    assert.deepEqual(manifest.files, REQUIRED, 'поле files package.json — контракт состава tarball');
    const packedPaths = new Set(packInfo.files.map((f) => f.path));
    const tracked = runOk('git ls-files', 'git', ['-C', REPO, 'ls-files', '-z', '--', ...REQUIRED]).stdout.split('\0').filter(Boolean);
    assert.ok(tracked.includes('templates/docs/backlog/README.md'), 'перечень отслеживаемых файлов — вглубь каталогов');
    assert.deepEqual(tracked.filter((p) => !packedPaths.has(p)), [], 'отслеживаемые файлы из files, которых нет в tarball');
    const stray = [...packedPaths].filter((p) => p !== 'package.json' && !REQUIRED.some((e) => p === e || p.startsWith(`${e}/`)));
    assert.deepEqual(stray, [], 'в tarball только состав files и package.json');
    runOk('npm install', 'npm', ['install', tarball, '--ignore-scripts', '--no-audit', '--no-fund', '--offline', '--cache', cache], { cwd: project, env });
    const bin = process.platform === 'win32' ? path.join(project, 'node_modules/.bin/backslop.cmd') : path.join(project, 'node_modules/.bin/backslop');
    let r = runOk('backslop version', bin, ['version'], { cwd: project });
    // Версия берётся из манифеста: зашитый литерал делает этот вердикт релиз-блокером
    // на каждом бампе — он краснел на 0.3.0, хотя предмет проверки от версии не зависит.
    assert.match(r.stdout, new RegExp(`backslop ${manifest.version.replace(/\./g, '\\.')}`));
    runOk('backslop init', bin, ['init'], { cwd: project });
    runOk('backslop lint', bin, ['lint'], { cwd: project });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('release --bump: версия, заголовок секции CHANGELOG и штамп через init; preflight и тег не трогаются', () => {
  const f = fixture();
  try {
    // Шим node: bump зовёт `node bin/backslop.js init`, а самого CLI во временном дереве нет.
    putExecutable(path.join(f.bin, 'node'), `#!${process.execPath}\nimport { appendFileSync } from 'node:fs';\nappendFileSync(process.env.RELEASE_LOG, ['node', ...process.argv.slice(2)].join(' ') + '\\n');\n`);
    writeFileSync(path.join(f.root, 'CHANGELOG.md'), '# Changelog\n\n## Не выпущено\n\n- **Одно** — раз\n\n## v0.1.0 — 2026-09-01\n\n- **Прежнее** — было\n');
    const r = runRelease(f, ['0.3.0', '--bump']);
    assert.equal(r.code, 0, r.err);
    assert.equal(JSON.parse(readFileSync(path.join(f.root, 'package.json'), 'utf8')).version, '0.3.0');
    const changelog = readFileSync(path.join(f.root, 'CHANGELOG.md'), 'utf8');
    assert.match(changelog, /^## v0\.3\.0 — \d{4}-\d{2}-\d{2}$/m);
    assert.doesNotMatch(changelog, /Не выпущено/);
    assert.match(changelog, /^## v0\.1\.0 — 2026-09-01$/m);
    assert.deepEqual(r.log.trim().split('\n'), ['node bin/backslop.js init']);

    // Повторный bump переименовал бы уже выпущенную секцию — отказ до записи файлов.
    const again = runRelease(f, ['0.4.0', '--bump']);
    assert.equal(again.code, 1);
    assert.match(again.err, /верхняя секция «## v0\.3\.0 — \d{4}-\d{2}-\d{2}» уже выпущена/);
    assert.equal(JSON.parse(readFileSync(path.join(f.root, 'package.json'), 'utf8')).version, '0.3.0');
  } finally {
    cleanup(f);
  }
});

test('release --no-publish: тег и atomic push без npm publish', () => {
  const f = fixture();
  try {
    const r = runRelease(f, ['0.2.0', '--no-publish']);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(r.log.trim().split('\n'), [
      'git branch --show-current',
      'git status --porcelain',
      'git rev-parse --verify --quiet refs/tags/v0.2.0',
      'git ls-remote --exit-code --tags origin refs/tags/v0.2.0',
      'git fetch origin',
      'git merge-base --is-ancestor refs/remotes/origin/main HEAD',
      'npm test',
      'npm run lint',
      'npm pack --dry-run',
      'git status --porcelain',
      'git tag v0.2.0',
      'git push --atomic --dry-run origin main v0.2.0',
      'git push --atomic origin main v0.2.0',
    ]);
    assert.doesNotMatch(r.log, /npm publish/);
    assert.match(r.out, /npm publish не запускался/);

    // Отказ push после тега называет состояние без публикации, а не «опубликован».
    const g = fixture();
    try {
      const failed = runRelease(g, ['0.2.0', '--no-publish'], { FAKE_GIT_FAIL: 'push --atomic origin main v0.2.0' });
      assert.equal(failed.code, 1);
      assert.match(failed.err, /npm publish не запускался \(--no-publish\)/);
      assert.doesNotMatch(failed.err, /опубликован/);
    } finally { cleanup(g); }
  } finally {
    cleanup(f);
  }
});
