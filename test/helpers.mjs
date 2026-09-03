// Временный проект для проверок команд: git-репозиторий с backslop.json и каталогами
// статусов, собранный руками, — независимо от `init`, чтобы дефект init не красил чужие
// проверки. Команды гоняются настоящим процессом через bin/backslop.js.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BIN = fileURLToPath(new URL('../bin/backslop.js', import.meta.url));

export function makeProject({ prefix = 'BS', docs = 'docs', git = true } = {}) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-proj-')));
  writeFileSync(path.join(root, 'backslop.json'), `${JSON.stringify({ prefix, docs, gates: [] }, null, 2)}\n`);
  for (const d of ['backlog/triage', 'backlog/queue', 'backlog/active', 'backlog/deferred', 'archive', 'adr', 'reference']) {
    mkdirSync(path.join(root, docs, d), { recursive: true });
  }
  writeFileSync(path.join(root, docs, 'README.md'), '# Документация\n\n| Документ | Тема | Статус |\n|---|---|---|\n');
  writeFileSync(path.join(root, docs, 'backlog', 'README.md'), '# Backlog\n');
  writeFileSync(path.join(root, docs, 'archive', 'README.md'), '# Архив\n');
  if (git) {
    run(root, ['init', '-q', '-b', 'main']);
    run(root, ['config', 'user.email', 'test@example.com']);
    run(root, ['config', 'user.name', 'test']);
  }
  return root;
}

function run(root, args) {
  return spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}

export function gitAll(root, message = 'снимок') {
  run(root, ['add', '-A']);
  run(root, ['commit', '-qm', message]);
}

export function cli(root, args, { cwd = root } = {}) {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
}

export function read(root, rel) {
  return readFileSync(path.join(root, ...rel.split('/')), 'utf8');
}

export function put(root, rel, text) {
  const abs = path.join(root, ...rel.split('/'));
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, text);
}

export function cleanup(root) {
  rmSync(root, { recursive: true, force: true });
}
