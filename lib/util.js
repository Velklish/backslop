import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';

// Отказ, адресованный человеку: точка входа печатает текст без стека и выходит кодом 1.
// Всё остальное — ошибка кода, и стек ей нужен.
export class CliError extends Error {}

// Цвет — по тому потоку, в который строка и уйдёт: при `> out.txt` ANSI-коды в файл не едут.
const paint = (stream, code, s) => (stream.isTTY && !process.env.NO_COLOR ? `\x1b[${code}m${s}\x1b[0m` : s);

export function ok(msg) { console.log(`${paint(process.stdout, 32, '✔')} ${msg}`); }
export function info(msg) { console.log(`  ${msg}`); }
export function warn(msg) { console.warn(`${paint(process.stderr, 33, '⚠')} ${msg}`); }
// Тот же уровень, что у отказа, но без выхода: диагностика перечисляет всё найденное.
export function bad(msg) { console.error(`${paint(process.stderr, 31, '✖')} ${msg}`); }

// Календарная дата машины, а не UTC: «Взята» в час ночи по местному времени — сегодняшнее
// число для того, кто работает, а toISOString дал бы вчерашнее.
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Пути в markdown и в выводе — всегда posix, в том числе на Windows.
export function toPosix(p) {
  return p.split(path.sep).join('/');
}

// Потолок вывода git: умолчание spawnSync в 1 МиБ обрывает `ENOBUFS`
// крупный коммит и длинную историю.
export const GIT_MAX_BUFFER = 1 << 28;

// git с явным корнем и потолком ожидания: без него залипший index.lock держал бы команду вечно.
export function git(root, args, opts = {}) {
  return spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 60_000, maxBuffer: GIT_MAX_BUFFER, ...opts });
}

// Причина отказа git: stderr, иначе ошибка запуска (ENOENT, ENOBUFS, ETIMEDOUT),
// иначе сигнал или код.
export function gitCause(r, lang = 'ru') {
  const stderr = (r.stderr ?? '').trim();
  if (stderr) return stderr;
  if (r.error) return r.error.message;
  if (r.signal) return lang === 'en' ? `killed by ${r.signal}` : `оборван сигналом ${r.signal}`;
  return lang === 'en' ? `exit code ${r.status}` : `код ${r.status}`;
}

export function gitOrFail(root, args) {
  const r = git(root, args);
  if (r.status !== 0) throw new CliError(`git ${args.join(' ')}: ${gitCause(r)}`);
  return r.stdout;
}

// Worktree по `git worktree list --porcelain` — один разбор на `foreignTaskIds` и `tracks`. У
// detached HEAD `branch: null`, `HEAD <sha>` есть всегда; без git — пусто.
export function worktrees(root) {
  const list = git(root, ['worktree', 'list', '--porcelain']);
  if (list.status !== 0) return [];
  const out = [];
  for (const block of list.stdout.split(/\n\n+/)) {
    const wtPath = block.match(/^worktree (.+)$/m)?.[1];
    if (!wtPath) continue;
    out.push({
      path: wtPath,
      branch: block.match(/^branch refs\/heads\/(.+)$/m)?.[1] ?? null,
      head: block.match(/^HEAD ([0-9a-f]+)$/m)?.[1] ?? null,
    });
  }
  return out;
}

// Разбор argv: неизвестный флаг — отказ текстом, а не стеком parseArgs. Значение с дефиса
// склеивается в `--флаг=значение`, если оно не флаг этой команды (docs/reference/02-cli.md).
export function parseCommandArgs(argv, options) {
  const args = [];
  for (let i = 0; i < argv.length; i += 1) {
    const tok = argv[i];
    const name = /^--[^=]+$/.test(tok) ? tok.slice(2) : null;
    const next = argv[i + 1];
    if (name && options[name]?.type === 'string' && next !== undefined && next.startsWith('-') && !isOption(next, options)) {
      args.push(`${tok}=${next}`);
      i += 1;
      continue;
    }
    args.push(tok);
  }
  try {
    return parseArgs({ args, options, allowPositionals: true, strict: true });
  } catch (e) {
    throw new CliError(e.message);
  }
}

function isOption(tok, options) {
  const m = tok.match(/^--([^=]+)/);
  return Boolean(m && m[1] in options);
}
