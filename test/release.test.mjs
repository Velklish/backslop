// Checks of the release script. Not for Windows: git and npm are replaced by shebang shims, and
// acceptance calls `npm` without a shell; tests whose subject depends on the platform say skip.
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
  // The script sits in scripts/ with the real lib/util.js beside it: the release takes today() from
  // there for the CHANGELOG section heading, and a flat copy in the root would not find the module.
  mkdirSync(path.join(root, 'scripts'));
  mkdirSync(path.join(root, 'lib'));
  copyFileSync(RELEASE, path.join(root, 'scripts', 'release.mjs'));
  copyFileSync(path.join(REPO, 'lib', 'util.js'), path.join(root, 'lib', 'util.js'));
  copyFileSync(path.join(REPO, 'lib', 'version.js'), path.join(root, 'lib', 'version.js'));
  copyFileSync(path.join(REPO, 'lib', 'changelog-format.js'), path.join(root, 'lib', 'changelog-format.js'));
  copyFileSync(path.join(REPO, 'lib', 'text.js'), path.join(root, 'lib', 'text.js'));
  copyFileSync(path.join(REPO, 'lib', 'i18n.js'), path.join(root, 'lib', 'i18n.js'));
  mkdirSync(path.join(root, 'templates', 'i18n'), { recursive: true });
  copyFileSync(path.join(REPO, 'templates', 'i18n', 'ru.mjs'), path.join(root, 'templates', 'i18n', 'ru.mjs'));
  // `type: module` is no decoration: without it node rereads the copied lib/*.js as CJS, and the
  // MODULE_TYPELESS_PACKAGE_JSON warning lands in the stderr the tests compare.
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

// bump must run `init` with the running node; a PATH `node` shim would log a bare `node`.
function putFakeCli(f) {
  const log = (name) => `import { appendFileSync } from 'node:fs';\nappendFileSync(process.env.RELEASE_LOG, ['${name}', ...process.argv.slice(2)].join(' ') + '\\n');\n`;
  putExecutable(path.join(f.bin, 'node'), `#!${process.execPath}\n${log('node')}`);
  mkdirSync(path.join(f.root, 'bin'));
  writeFileSync(path.join(f.root, 'bin', 'backslop.js'), log('bin/backslop.js'));
}

const SEQ = [
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
];
const through = (last) => SEQ.slice(0, SEQ.indexOf(last) + 1);

test('release: every preflight and gate runs before the tag, the publish and the atomic push', () => {
  for (const row of [
    { label: 'published', args: ['0.2.0'], log: SEQ },
    { label: '--no-publish', args: ['0.2.0', '--no-publish'], log: SEQ.filter((c) => c !== 'npm publish'), out: /npm publish was not run/ },
  ]) {
    const f = fixture();
    try {
      const r = runRelease(f, row.args);
      assert.equal(r.code, 0, `${row.label}: ${r.err}`);
      assert.deepEqual(r.log.trim().split('\n'), row.log, row.label);
      if (row.out) assert.match(r.out, row.out, row.label);
    } finally {
      cleanup(f);
    }
  }
});

test('release: changes made by the gates stop the release before the tag', () => {
  const f = fixture();
  try {
    const r = runRelease(f, '0.2.0', { FAKE_GATE_DIRTY: '1' });
    assert.equal(r.code, 1);
    assert.match(r.err, /the gates changed the working tree; the tag is not created/);
    assert.match(r.err, /\?\? generated\.txt/);
    assert.match(r.log, /npm pack --dry-run\ngit status --porcelain\n$/);
    assert.doesNotMatch(r.log, /git tag|npm publish|git push/);
  } finally {
    cleanup(f);
  }
});

test('release: argument, package version, branch, dirty tree and tag collision stop before the gates and side effects', () => {
  const cases = [
    { version: 'v0.2.0', match: /one argument of the form X\.Y\.Z/, log: [] },
    { fixture: { version: '0.1.0' }, match: /version 0\.1\.0.*the release asked for is 0\.2\.0/, log: [] },
    { env: { FAKE_BRANCH: 'topic' }, match: /the current branch is “topic”/, log: ['git branch --show-current'] },
    { env: { FAKE_DIRTY: '1' }, match: /the working tree is dirty/, log: ['git branch --show-current', 'git status --porcelain'] },
    { env: { FAKE_LOCAL_TAG: '1' }, match: /the local tag v0\.2\.0 already exists/, log: ['git branch --show-current', 'git status --porcelain', 'git rev-parse --verify --quiet refs/tags/v0.2.0'] },
    { env: { FAKE_REMOTE_TAG: '1' }, match: /the tag v0\.2\.0 already exists in origin/, log: ['git branch --show-current', 'git status --porcelain', 'git rev-parse --verify --quiet refs/tags/v0.2.0', 'git ls-remote --exit-code --tags origin refs/tags/v0.2.0'] },
    { env: { FAKE_FETCH_FAIL: '1' }, match: /git fetch origin/, log: ['git branch --show-current', 'git status --porcelain', 'git rev-parse --verify --quiet refs/tags/v0.2.0', 'git ls-remote --exit-code --tags origin refs/tags/v0.2.0', 'git fetch origin'] },
    { version: ['0.2.0', '--nope'], match: /unknown flag --nope/, log: [] },
    { version: ['0.2.0', '--bump', '--no-publish'], match: /together make no sense/, log: [] },
    { version: ['0.1.0', '--bump'], match: /bump goes only upward, 0\.1\.0 is not newer/, log: [] },
    { version: ['0.3.0', '--bump'], setup: (f) => writeFileSync(path.join(f.root, 'CHANGELOG.md'), '# Changelog\n\nno sections\n'), match: /no “## ” section at all/, log: [] },
    { env: { FAKE_DIVERGED: '1' }, match: /is not a fast-forward from origin\/main/, log: ['git branch --show-current', 'git status --porcelain', 'git rev-parse --verify --quiet refs/tags/v0.2.0', 'git ls-remote --exit-code --tags origin refs/tags/v0.2.0', 'git fetch origin', 'git merge-base --is-ancestor refs/remotes/origin/main HEAD'] },
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

test('release: every gate failure keeps the tag, the publish and the push from happening', () => {
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

// A row's log is every command run, the failing one last; absentRe must not match stderr.
test('release: each failure names its state and next step; the fast-forward refusal mentions npm publish only when publishing', () => {
  const push = 'push --atomic origin main v0.2.0';
  for (const row of [
    {
      label: 'push --dry-run refused',
      args: ['0.2.0'],
      env: { FAKE_PUSH_DRY_FAIL: '1' },
      // The tag command stays copyable: no punctuation right after it.
      errRes: [/state: the local tag v0\.2\.0 is created; origin is unchanged; the npm registry is untouched/, /git tag -d v0\.2\.0(\s|$)/],
      log: through('git push --atomic --dry-run origin main v0.2.0'),
    },
    {
      label: 'npm publish failed',
      args: ['0.2.0'],
      env: { FAKE_NPM_FAIL: 'publish' },
      errRes: [
        /state: the local tag v0\.2\.0 is created; origin is unchanged; the npm registry state is unknown/,
        /next: npm view backslop@0\.2\.0 version/,
        /if published: git push --atomic origin main v0\.2\.0/,
        /if E404: npm publish, then git push --atomic origin main v0\.2\.0/,
      ],
      log: through('npm publish'),
    },
    {
      label: 'atomic push failed after publish',
      args: ['0.2.0'],
      env: { FAKE_GIT_FAIL: push },
      errRes: [/state: backslop@0\.2\.0 is published; the local tag v0\.2\.0 is created; the atomic push is not confirmed/, /next: git push --atomic origin main v0\.2\.0/],
      log: SEQ,
    },
    {
      label: 'atomic push failed with --no-publish',
      args: ['0.2.0', '--no-publish'],
      env: { FAKE_GIT_FAIL: push },
      errRes: [/npm publish was not run \(--no-publish\)/],
      absentRe: /is published/,
    },
    {
      label: 'not a fast-forward with --no-publish',
      args: ['0.2.0', '--no-publish'],
      env: { FAKE_DIVERGED: '1' },
      errRes: [/is not a fast-forward from origin\/main: the atomic push would be refused\n/],
      absentRe: /npm publish/,
    },
    {
      label: 'not a fast-forward, published',
      args: ['0.2.0'],
      env: { FAKE_DIVERGED: '1' },
      errRes: [/the atomic push would be refused after npm publish/],
    },
  ]) {
    const f = fixture();
    try {
      const r = runRelease(f, row.args, row.env);
      assert.equal(r.code, 1, row.label);
      for (const re of row.errRes) assert.match(r.err, re, row.label);
      if (row.log) assert.deepEqual(r.log.trim().split('\n'), row.log, row.label);
      if (row.absentRe) assert.doesNotMatch(r.err, row.absentRe, row.label);
    } finally {
      cleanup(f);
    }
  }
});

// A launch that did not happen (the cause is in error), a kill by a signal and a non-zero code are
// different refusals: "null !== 0" would call a machine without npm a release defect.
function describeRun(label, r) {
  if (r.error) return `${label}: the launch did not happen — ${r.error.code ?? r.error.message}`;
  if (r.signal) return `${label}: killed by signal ${r.signal}`;
  if (r.status !== 0) return `${label}: exit code ${r.status}\n${(r.stderr ?? '').trim()}`;
  return null;
}

function runOk(label, cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  const why = describeRun(label, r);
  if (why !== null) assert.fail(why);
  return r;
}

// npm gets its own HOME, cache and configs in the check directory and no npm_config_* from `npm
// test`: else a ~/.npmrc token and a sandboxed Keychain would redden acceptance; install: offline.
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

test('the acceptance runner tells a launch that did not happen from a signal and a non-zero code', { skip: process.platform === 'win32' }, () => {
  const missing = spawnSync(path.join(os.tmpdir(), 'backslop-no-such-command'), [], { encoding: 'utf8' });
  assert.match(describeRun('npm pack', missing), /^npm pack: the launch did not happen — ENOENT$/);

  const failed = spawnSync(process.execPath, ['-e', 'process.stderr.write("no access to the registry"); process.exit(7)'], { encoding: 'utf8' });
  assert.match(describeRun('npm pack', failed), /^npm pack: exit code 7\nno access to the registry$/);

  const killed = spawnSync(process.execPath, ['-e', 'process.kill(process.pid, "SIGKILL")'], { encoding: 'utf8' });
  assert.equal(describeRun('npm pack', killed), 'npm pack: killed by signal SIGKILL');

  assert.equal(describeRun('npm pack', spawnSync(process.execPath, ['-e', ''], { encoding: 'utf8' })), null);
});

test('every package.json files entry exists in the tree', () => {
  const manifest = JSON.parse(readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  const missing = manifest.files.filter((entry) => !existsSync(path.join(REPO, entry)));
  assert.deepEqual(missing, [], `files entries missing from the tree: ${missing.join(', ')}`);
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
    assert.deepEqual(Object.keys(manifest.dependencies ?? {}), [], '--offline rests on there being no dependencies');

    // The tarball content is exactly what the tool needs: a dropped `templates/` is not caught by
    // the commands below. The expectation is the git files, not the disk: npm drops `.DS_Store`.
    const REQUIRED = ['bin', 'lib', 'templates', 'README.md', 'LICENSE', 'CHANGELOG.md'];
    assert.deepEqual(manifest.files, REQUIRED, 'the files field of package.json is the tarball content contract');
    const packedPaths = new Set(packInfo.files.map((f) => f.path));
    const tracked = runOk('git ls-files', 'git', ['-C', REPO, 'ls-files', '-z', '--', ...REQUIRED]).stdout.split('\0').filter(Boolean);
    assert.ok(tracked.includes('templates/docs/backlog/README.md'), 'the tracked-files list reaches into directories');
    assert.deepEqual(tracked.filter((p) => !packedPaths.has(p)), [], 'tracked files from files that are not in the tarball');
    const stray = [...packedPaths].filter((p) => p !== 'package.json' && !REQUIRED.some((e) => p === e || p.startsWith(`${e}/`)));
    assert.deepEqual(stray, [], 'the tarball holds only the files content and package.json');
    runOk('npm install', 'npm', ['install', tarball, '--ignore-scripts', '--no-audit', '--no-fund', '--offline', '--cache', cache], { cwd: project, env });
    const bin = process.platform === 'win32' ? path.join(project, 'node_modules/.bin/backslop.cmd') : path.join(project, 'node_modules/.bin/backslop');
    let r = runOk('backslop version', bin, ['version'], { cwd: project });
    // The version comes from the manifest: a hardcoded literal makes this verdict a release blocker
    // on every bump — it went red on 0.3.0 though the subject of the check does not depend on it.
    assert.match(r.stdout, new RegExp(`backslop ${manifest.version.replace(/\./g, '\\.')}`));
    runOk('backslop init', bin, ['init'], { cwd: project });
    runOk('backslop lint', bin, ['lint'], { cwd: project });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('release --bump: the version, the CHANGELOG section heading and the stamp through init; preflight and the tag are not touched', () => {
  const f = fixture();
  try {
    putFakeCli(f);
    writeFileSync(path.join(f.root, 'CHANGELOG.md'), '# Changelog\n\n## Unreleased\n\n- **One** — x\n\n## v0.1.0 — 2026-09-01\n\n- **Old** — y\n');
    const r = runRelease(f, ['0.3.0', '--bump']);
    assert.equal(r.code, 0, r.err);
    assert.equal(JSON.parse(readFileSync(path.join(f.root, 'package.json'), 'utf8')).version, '0.3.0');
    const changelog = readFileSync(path.join(f.root, 'CHANGELOG.md'), 'utf8');
    assert.match(changelog, /^## v0\.3\.0 — \d{4}-\d{2}-\d{2}$/m);
    assert.doesNotMatch(changelog, /Unreleased/);
    assert.match(changelog, /^## v0\.1\.0 — 2026-09-01$/m);
    assert.deepEqual(r.log.trim().split('\n'), ['bin/backslop.js init'], 'init ran through the running node, not a PATH node');
    assert.match(r.out, /then npm run release -- 0\.3\.0 --no-publish\n$/, 'the next-step hint names --no-publish');

    // A repeated bump would rename an already released section — a refusal before any write.
    const again = runRelease(f, ['0.4.0', '--bump']);
    assert.equal(again.code, 1);
    assert.match(again.err, /the top section “## v0\.3\.0 — \d{4}-\d{2}-\d{2}” is already released/);
    assert.equal(JSON.parse(readFileSync(path.join(f.root, 'package.json'), 'utf8')).version, '0.3.0');
  } finally {
    cleanup(f);
  }
});

test('release --bump renames `## Unreleased (after v0.1.0)` and refuses a released `## [0.2.0] - date`', () => {
  const f = fixture();
  const kac = fixture();
  try {
    putFakeCli(f);
    writeFileSync(path.join(f.root, 'CHANGELOG.md'), '# Changelog\n\n## Unreleased (after v0.1.0)\n\n- **One** — x\n\n## v0.1.0 — 2026-09-01\n\n- **Old** — y\n');
    const r = runRelease(f, ['0.3.0', '--bump']);
    assert.equal(r.code, 0, r.err);
    const changelog = readFileSync(path.join(f.root, 'CHANGELOG.md'), 'utf8');
    assert.match(changelog, /^## v0\.3\.0 — \d{4}-\d{2}-\d{2}\n\n- \*\*One\*\*/m);
    assert.doesNotMatch(changelog, /Unreleased/);

    putFakeCli(kac);
    const released = '# Changelog\n\n## [0.2.0] - 2026-09-01\n\n- **Old** — y\n';
    writeFileSync(path.join(kac.root, 'CHANGELOG.md'), released);
    const again = runRelease(kac, ['0.3.0', '--bump']);
    assert.equal(again.code, 1);
    assert.match(again.err, /the top section “## \[0\.2\.0\] - 2026-09-01” is already released/);
    assert.equal(readFileSync(path.join(kac.root, 'CHANGELOG.md'), 'utf8'), released);
  } finally {
    cleanup(f);
    cleanup(kac);
  }
});

test('release: the push --dry-run refusal tells the local tag is deleted before the rerun, not as an alternative', () => {
  const f = fixture();
  try {
    const r = runRelease(f, '0.2.0', { FAKE_PUSH_DRY_FAIL: '1' });
    assert.equal(r.code, 1);
    const next = r.err.split('\n').find((line) => line.startsWith('next:'));
    assert.ok(next, 'the refusal carries a next: line');
    assert.match(next, /fix the push refusal, then delete the local tag — git tag -d v0\.2\.0 — and rerun release/);
    assert.doesNotMatch(next, /\bor\b/, 'deleting the tag is not an alternative to fixing the push');
  } finally {
    cleanup(f);
  }
});
