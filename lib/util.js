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

// git с явным корнем и потолком ожидания: без него залипший index.lock держал бы команду вечно.
export function git(root, args) {
  return spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 60_000 });
}

export function gitOrFail(root, args) {
  const r = git(root, args);
  if (r.status !== 0) {
    const why = (r.stderr ?? '').trim() || (r.error ? r.error.message : `код ${r.status}`);
    throw new CliError(`git ${args.join(' ')}: ${why}`);
  }
  return r.stdout;
}

// Worktree репозитория по `git worktree list --porcelain`: блоки разделены пустой строкой,
// первая строка блока — путь, строки `branch` у detached HEAD нет (branch: null), а строка
// `HEAD <sha>` есть всегда. Один разбор на `foreignTaskIds` (lib/tasks.js) и `tracks`
// (lib/tracks.js); без git или вне репозитория — пусто.
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

// Разбор argv команды: флаги по описанию, позиционные — как есть. Неизвестный флаг — отказ
// текстом, а не стеком parseArgs.
// Значение строкового флага, начинающееся с дефиса (`--title "--strategy …"`), parseArgs в
// строгом режиме считает неоднозначным. Пара «флаг, значение» склеивается в `--флаг=значение`,
// если значение не является именем флага этой команды; `--title --queue` остаётся отказом с
// подсказкой формы `--title=…` из самого parseArgs.
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
