#!/usr/bin/env node
// Точка входа CLI: первый аргумент — команда, остальное уходит модулю команды.
// Модули лежат в lib/<команда>.js и экспортируют `run(argv, { cwd })`; отказ —
// исключение CliError с текстом для человека, любое другое исключение — ошибка кода.
import process from 'node:process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { CliError, bad } from '../lib/util.js';
import { TOOL_VERSION } from '../lib/version.js';
import { findRoot } from '../lib/config.js';

const COMMANDS = ['init', 'new', 'mv', 'archive', 'adr', 'status', 'lint', 'upgrade', 'migrate', 'changelog'];

const HELP_RU = `backslop — бэклог для слопа: задачи файлами, архив, ADR, скиллы процесса

Команды:
  init [--dir docs] [--prefix BS] [--cli <команда>] [--lang ru|en] [--tools <CSV|none>]
                                                      разложить скелет docs, adapters, блок в AGENTS.md, backslop.json
  new <slug> [--title "…"] [--queue [--top]] [--parent N]
                                                      завести задачу (по умолчанию в triage/) или находку задачи N
  mv <N> <triage|queue|active|deferred> [--top | --after M]
                                                      сменить статус: git mv между каталогами
  archive <N> [--dry-run]                             закрыть задачу: переезд в archive/ с правкой ссылок
  adr <slug> [--title "…"]                            завести ADR со следующим номером
  status [--json]                                     сводка: в работе, очередь по порядку, отложено, triage
  lint                                                восемь гейтов: ссылки, номера, раскладка бэклога, поля статусов,
                                                      архив, упоминания, CHANGELOG, таблица ADR; adapter outputs,
                                                      равенство шаблонов и предупреждения о версии
  upgrade [--to X.Y.Z] [--dry-run] [--pin-only]       обновить проект: пин в cli и gates, migrate и init новой версией
  migrate [--dry-run]                                 миграция формата файлов и штамп версии
  changelog [--since X.Y.Z] [--to X.Y.Z]              выжимка CHANGELOG backslop между версиями
  version                                             версия backslop
  help                                                эта справка

Значение флага, начинающееся с дефиса, — формой с «=»: --title="--…". Без «=» оно принимается,
если не совпадает с именем флага этой команды.

Запуск без установки: npx github:Velklish/backslop#v${TOOL_VERSION} <команда>
`;

const HELP_EN = `backslop — a file-based backlog with an archive, ADRs, and process skills

Commands:
  init [--dir docs] [--prefix BS] [--cli <command>] [--lang ru|en] [--tools <CSV|none>]
                                                      create docs, adapters, AGENTS.md block, and backslop.json
  new <slug> [--title "…"] [--queue [--top]] [--parent N]
                                                      create a task (triage/ by default) or a finding for task N
  mv <N> <triage|queue|active|deferred> [--top | --after M]
                                                      change status with git mv between directories
  archive <N> [--dry-run]                             close a task, move it to archive/, and update links
  adr <slug> [--title "…"]                            create the next numbered ADR
  status [--json]                                     show active work, ordered queue, deferred tasks, and triage
  lint                                                validate links, numbers, layout, status fields, archive,
                                                      mentions, CHANGELOG, ADR index, and adapter outputs
  upgrade [--to X.Y.Z] [--dry-run] [--pin-only]       update the cli pin, migrate, and initialize the new version
  migrate [--dry-run]                                 migrate file formats and update the version stamp
  changelog [--since X.Y.Z] [--to X.Y.Z]              print backslop CHANGELOG entries between versions
  version                                             print the backslop version
  help                                                show this help

A flag value that starts with a dash goes in the “=” form: --title="--…". Without “=” it is
accepted unless it matches a flag name of that command.

Run without installing: npx github:Velklish/backslop#v${TOOL_VERSION} <command>
`;

function projectLang(cwd) {
  const root = findRoot(cwd);
  if (!root) return null;
  try {
    return JSON.parse(readFileSync(path.join(root, 'backslop.json'), 'utf8')).lang === 'en' ? 'en' : 'ru';
  } catch { return 'ru'; }
}

async function main(argv) {
  const [name, ...rest] = argv;
  const lang = projectLang(process.cwd());
  if (!name || name === 'help' || name === '--help' || name === '-h') {
    process.stdout.write(lang === 'en' ? HELP_EN : lang === 'ru' ? HELP_RU : `${HELP_EN}\n${HELP_RU}`);
    return 0;
  }
  if (name === 'version' || name === '--version' || name === '-v') {
    process.stdout.write(`backslop ${TOOL_VERSION}\n`);
    return 0;
  }
  if (!COMMANDS.includes(name)) throw new CliError(lang === 'en'
    ? `unknown command “${name}”; see backslop help`
    : lang === 'ru' ? `неизвестная команда «${name}»; список — backslop help`
      : `Unknown command “${name}” / Неизвестная команда «${name}»; see / список — backslop help`);
  if (rest.includes('--help') || rest.includes('-h')) {
    process.stdout.write(lang === 'en' ? HELP_EN : lang === 'ru' ? HELP_RU : `${HELP_EN}\n${HELP_RU}`);
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
