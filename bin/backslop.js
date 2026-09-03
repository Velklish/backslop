#!/usr/bin/env node
// Точка входа CLI: первый аргумент — команда, остальное уходит модулю команды.
// Модули лежат в lib/<команда>.js и экспортируют `run(argv, { cwd })`; отказ —
// исключение CliError с текстом для человека, любое другое исключение — ошибка кода.
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { CliError, bad } from '../lib/util.js';

const COMMANDS = ['init', 'new', 'mv', 'archive', 'adr', 'status', 'lint'];

const HELP = `backslop — бэклог для слопа: задачи файлами, архив, ADR, скиллы процесса

Команды:
  init [--dir docs] [--prefix BS] [--cli <команда>]   разложить скелет docs, скиллы, блок в AGENTS.md, backslop.json
  new <slug> [--title "…"] [--queue [--top]] [--parent N]
                                                      завести задачу (по умолчанию в triage/) или находку задачи N
  mv <N> <triage|queue|active|deferred> [--top | --after M]
                                                      сменить статус: git mv между каталогами
  archive <N> [--dry-run]                             закрыть задачу: переезд в archive/ с правкой ссылок
  adr <slug> [--title "…"]                            завести ADR со следующим номером
  status [--json]                                     сводка: в работе, очередь по порядку, отложено, triage
  lint                                                восемь гейтов: ссылки, номера, раскладка бэклога, поля статусов,
                                                      архив, упоминания, CHANGELOG, таблица ADR
  version                                             версия backslop
  help                                                эта справка

Запуск без установки: npx github:Velklish/backslop <команда>
`;

function version() {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  return `${pkg.name} ${pkg.version}\n`;
}

async function main(argv) {
  const [name, ...rest] = argv;
  if (!name || name === 'help' || name === '--help' || name === '-h') {
    process.stdout.write(HELP);
    return 0;
  }
  if (name === 'version' || name === '--version' || name === '-v') {
    process.stdout.write(version());
    return 0;
  }
  if (!COMMANDS.includes(name)) throw new CliError(`неизвестная команда «${name}»; список — backslop help`);
  if (rest.includes('--help') || rest.includes('-h')) {
    process.stdout.write(HELP);
    return 0;
  }
  const mod = await import(`../lib/${name}.js`);
  const code = await mod.run(rest, { cwd: process.cwd() });
  return code ?? 0;
}

// Читатель закрыл пайп (`status --json | head`) — не наша ошибка, выходим тихо.
process.stdout.on('error', (e) => {
  if (e.code === 'EPIPE') process.exit(0);
  throw e;
});

// Код возврата — через exitCode, а не process.exit: выход до сброса stdout режет длинный
// вывод на размере буфера пайпа, и `status --json` уезжал бы оркестратору битым.
main(process.argv.slice(2)).then(
  (code) => { process.exitCode = code; },
  (e) => {
    if (e instanceof CliError) {
      bad(e.message);
      process.exitCode = 1;
      return;
    }
    throw e;
  },
);
