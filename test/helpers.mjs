// Временный проект для проверок команд: git-репозиторий с backslop.json и каталогами
// статусов, собранный руками, — независимо от `init`, чтобы дефект init не красил чужие
// проверки. Команды гоняются настоящим процессом через bin/backslop.js.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOL_VERSION } from '../lib/version.js';

export const BIN = fileURLToPath(new URL('../bin/backslop.js', import.meta.url));
export const REPO = fileURLToPath(new URL('..', import.meta.url));

// stamp: false — проект без штампа версии, каким его застаёт lint у старой раскладки.
// По умолчанию штамп стоит: иначе lint на любой проверке несёт постоянное предупреждение
// «нет штампа версии», и ассерт на пустой stderr нельзя написать ни в одном тесте. Поле cli
// не пишется — loadConfig подставит defaultCli() с пином на ту же TOOL_VERSION, и lint молчит.
export function makeProject({ prefix = 'BS', docs = 'docs', git = true, stamp = true } = {}) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-proj-')));
  const cfg = { prefix, docs, gates: [] };
  if (stamp) cfg.version = TOOL_VERSION;
  writeFileSync(path.join(root, 'backslop.json'), `${JSON.stringify(cfg, null, 2)}\n`);
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
    // Пин против глобального конфига машины: определение переименований у себя выключил —
    // и `git mv` виден в status как пара D/A, неотличимо от renameSync; подпись коммитов
    // включена без ключа — фикстура падает на первом же снимке.
    run(root, ['config', 'status.renames', 'true']);
    run(root, ['config', 'commit.gpgsign', 'false']);
  }
  return root;
}

// Код возврата git проверяется: проглоченный отказ (нет git, сломанный конфиг, нечего
// коммитить) оставлял бы файл вне индекса, и команда молча уходила бы на ветку renameSync —
// проверка ветки `git mv` тихо становилась бы проверкой ветки fs.
export function run(root, args) {
  const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  if (r.status !== 0) {
    const why = (r.stderr ?? '').trim() || (r.stdout ?? '').trim() || r.error?.message || `код ${r.status}`;
    throw new Error(`git ${args.join(' ')}: ${why}`);
  }
  return r;
}

export function gitAll(root, message = 'снимок') {
  run(root, ['add', '-A']);
  run(root, ['commit', '-qm', message]);
}

export function cli(root, args, { cwd = root, env = {} } = {}) {
  return runBin(BIN, args, cwd, env);
}

// --no-warnings дочернему процессу: предупреждения самого Node (конфликт NO_COLOR с
// унаследованным FORCE_COLOR, Experimental/Deprecation из NODE_OPTIONS сессии) уходят в его
// stderr и красили бы ассерты на пустой stderr выводом, которого команда не писала.
// Унаследованное значение сохраняется — флаг дописывается к нему.
function runBin(bin, args, cwd, env) {
  const nodeOptions = `${process.env.NODE_OPTIONS ?? ''} --no-warnings`.trim();
  const r = spawnSync(process.execPath, [bin, ...args], { cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', NODE_OPTIONS: nodeOptions, ...env } });
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
}

// Копия инструмента — bin, lib, templates, package.json в mkdtemp. Нужна пробам, которым нужен
// self-host (гейт парности шаблонов и гейт 11 включаются только там, где `templates/` проекта —
// каталог запущенного инструмента) или состав шаблонов, отличный от дерева репозитория
// (не-legacy owned-путь). CHANGELOG.md копия не несёт — пробы кладут его сами. `mutate` правит
// копию до первого запуска.
export function toolCopy(mutate = () => {}) {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-tool-')));
  for (const rel of ['bin', 'lib', 'templates', 'package.json']) {
    cpSync(path.join(REPO, rel), path.join(dir, rel), { recursive: true });
  }
  mutate(dir);
  return dir;
}

// Команда копии инструмента `tool`; `cwd` — проект, в котором она запускается, по умолчанию
// сама копия (self-host). Окружение то же, что у `cli`.
export function toolCli(tool, args, { cwd = tool, env = {} } = {}) {
  return runBin(path.join(tool, 'bin', 'backslop.js'), args, cwd, env);
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
