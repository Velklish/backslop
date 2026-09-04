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
  copyFileSync(RELEASE, path.join(root, 'release.mjs'));
  writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({ name: 'backslop', version }, null, 2)}\n`);
  const shim = `#!${process.execPath}\nimport { appendFileSync, existsSync, writeFileSync } from 'node:fs';\nconst name = process.argv[1].split('/').pop();\nconst args = process.argv.slice(2);\nappendFileSync(process.env.RELEASE_LOG, [name, ...args].join(' ') + '\\n');\nif (name === 'git' && args[0] === 'branch') process.stdout.write(process.env.FAKE_BRANCH ?? 'main');\nif (name === 'npm' && args.join(' ') === 'pack --dry-run' && process.env.FAKE_GATE_DIRTY) writeFileSync('generated.txt', 'gate output\\n');\nif (name === 'git' && args[0] === 'status' && (process.env.FAKE_DIRTY || existsSync('generated.txt'))) process.stdout.write('?? generated.txt\\n');\nif (name === 'git' && args[0] === 'rev-parse') process.exit(process.env.FAKE_LOCAL_TAG ? 0 : 1);\nif (name === 'git' && args[0] === 'ls-remote') process.exit(process.env.FAKE_REMOTE_TAG ? 0 : 2);\nif (name === 'git' && args[0] === 'fetch') process.exit(process.env.FAKE_FETCH_FAIL ? 9 : 0);\nif (name === 'git' && args[0] === 'merge-base') process.exit(process.env.FAKE_DIVERGED ? 1 : 0);\nif (name === 'git' && args[0] === 'push' && args.includes('--dry-run')) process.exit(process.env.FAKE_PUSH_DRY_FAIL ? 8 : 0);\nif (name === 'npm' && process.env.FAKE_NPM_FAIL === args.join(' ')) process.exit(7);\nif (name === 'git' && process.env.FAKE_GIT_FAIL === args.join(' ')) process.exit(8);\n`;
  putExecutable(path.join(bin, 'git'), shim);
  putExecutable(path.join(bin, 'npm'), shim);
  return { root, bin, log: path.join(root, 'release.log') };
}

function runRelease(f, version = '0.2.0', env = {}) {
  const r = spawnSync(process.execPath, ['release.mjs', version], {
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
    { env: { FAKE_DIVERGED: '1' }, match: /не является fast-forward от origin\/main/, log: ['git branch --show-current', 'git status --porcelain', 'git rev-parse --verify --quiet refs/tags/v0.2.0', 'git ls-remote --exit-code --tags origin refs/tags/v0.2.0', 'git fetch origin', 'git merge-base --is-ancestor refs/remotes/origin/main HEAD'] },
  ];
  for (const c of cases) {
    const f = fixture(c.fixture);
    try {
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

test('packed tarball installs locally and its bin passes version, init and lint', { timeout: 60_000 }, () => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-pack-')));
  const packDir = path.join(root, 'pack');
  const project = path.join(root, 'project');
  const cache = path.join(root, 'npm-cache');
  mkdirSync(packDir);
  mkdirSync(project);
  try {
    const packed = spawnSync('npm', ['pack', REPO, '--json', '--pack-destination', packDir, '--cache', cache, '--ignore-scripts'], { encoding: 'utf8' });
    assert.equal(packed.status, 0, packed.stderr);
    const tarball = path.join(packDir, JSON.parse(packed.stdout)[0].filename);
    writeFileSync(path.join(project, 'package.json'), '{"name":"acceptance","private":true}\n');
    const installed = spawnSync('npm', ['install', tarball, '--ignore-scripts', '--no-audit', '--no-fund', '--cache', cache], { cwd: project, encoding: 'utf8' });
    assert.equal(installed.status, 0, installed.stderr);
    const bin = process.platform === 'win32' ? path.join(project, 'node_modules/.bin/backslop.cmd') : path.join(project, 'node_modules/.bin/backslop');
    let r = spawnSync(bin, ['version'], { cwd: project, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    // Версия берётся из манифеста: зашитый литерал делает этот вердикт релиз-блокером
    // на каждом бампе — он краснел на 0.3.0, хотя предмет проверки от версии не зависит.
    const expected = JSON.parse(readFileSync(path.join(REPO, 'package.json'), 'utf8')).version;
    assert.match(r.stdout, new RegExp(`backslop ${expected.replace(/\./g, '\\.')}`));
    r = spawnSync(bin, ['init'], { cwd: project, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    r = spawnSync(bin, ['lint'], { cwd: project, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
