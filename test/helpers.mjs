// Временный проект для проверок команд: git с backslop.json и каталогами статусов, собранный
// руками, а не `init`, — дефект init не красит чужие проверки. Команды — настоящим процессом.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOL_VERSION } from '../lib/version.js';
import { renderTemplate, templateRel } from '../lib/templates.js';

export const BIN = fileURLToPath(new URL('../bin/backslop.js', import.meta.url));
export const REPO = fileURLToPath(new URL('..', import.meta.url));

// stamp: false — проект без штампа, как старая раскладка. По умолчанию штамп стоит, а `cli` берётся
// из defaultCli() с той же версией: иначе предупреждение lint мешало бы ассертам на пустой stderr.
export function makeProject({ prefix = 'BS', docs = 'docs', git = true, stamp = true } = {}) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-proj-')));
  const cfg = { prefix, docs, gates: [], lang: 'ru', tools: [] };
  if (stamp) cfg.version = TOOL_VERSION;
  writeFileSync(path.join(root, 'backslop.json'), `${JSON.stringify(cfg, null, 2)}\n`);
  for (const d of ['backlog/triage', 'backlog/queue', 'backlog/active', 'backlog/deferred', 'backlog/minor', 'archive', 'adr', 'reference']) {
    mkdirSync(path.join(root, docs, d), { recursive: true });
  }
  writeFileSync(path.join(root, docs, 'README.md'), '# Документация\n\n| Документ | Тема | Статус |\n|---|---|---|\n');
  writeFileSync(path.join(root, docs, 'backlog', 'README.md'), '# Backlog\n');
  writeFileSync(path.join(root, docs, 'archive', 'README.md'), '# Архив\n');
  if (git) {
    run(root, ['init', '-q', '-b', 'main']);
    run(root, ['config', 'user.email', 'test@example.com']);
    run(root, ['config', 'user.name', 'test']);
    // Пин против глобального конфига: без переименований `git mv` в status неотличим от renameSync,
    // подпись коммитов без ключа роняет фикстуру на первом снимке.
    run(root, ['config', 'status.renames', 'true']);
    run(root, ['config', 'commit.gpgsign', 'false']);
  }
  return root;
}

// Код git проверяется: проглоченный отказ оставил бы файл вне индекса, и проверка ветки `git mv`
// тихо стала бы проверкой ветки renameSync.
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

// --no-warnings дописывается к унаследованному NODE_OPTIONS: предупреждения Node (NO_COLOR против
// FORCE_COLOR, Experimental) красили бы ассерты на пустой stderr чужим выводом.
function runBin(bin, args, cwd, env) {
  const nodeOptions = `${process.env.NODE_OPTIONS ?? ''} --no-warnings`.trim();
  const r = spawnSync(process.execPath, [bin, ...args], { cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', NODE_OPTIONS: nodeOptions, ...env } });
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
}

// Копия инструмента в mkdtemp — для проб self-host (парность шаблонов, гейт 11) и чужого состава
// шаблонов. CHANGELOG.md пробы кладут сами; `mutate` правит копию до первого запуска.
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

// Абзацы шаблона `result.md` после заголовка — с подставленными номером и датой, как их кладёт
// `archive`. Проба заглушки идёт на них, а не на выдуманную строку.
export function resultTemplateParagraphs(lang, { id = 'BS-4', date = '2026-08-01' } = {}) {
  const text = renderTemplate(templateRel(lang, 'result.md'), { id, date, prefix: id.split('-')[0] });
  return text.trim().split(/\n\s*\n/).slice(1);
}
