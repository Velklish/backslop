#!/usr/bin/env node
// CLI entry: the first argument is the command, the rest goes to `run(argv, { cwd, lang })` of
// lib/<command>.js; a CliError is a refusal, any other exception a code error (02-cli.md).
import process from 'node:process';
import { CliError, HelpRequest, bad } from '../lib/util.js';
import { TOOL_VERSION } from '../lib/version.js';
import { projectHintsOrNull } from '../lib/config.js';
import { pick } from '../lib/i18n.js';

const COMMANDS = ['init', 'new', 'mv', 'archive', 'fold', 'show', 'adr', 'brief', 'seed', 'status', 'lint', 'gates', 'tracks', 'upgrade', 'migrate', 'changelog', 'merge-changelog'];

const HELP_RU = `backslop — бэклог для слопа: задачи файлами, архив, ADR, скиллы процесса

Команды:
  init [--dir docs] [--prefix BS] [--cli <команда>] [--lang ru|en] [--tools <CSV|none>]
                                                      разложить скелет docs, adapters, блок в AGENTS.md, backslop.json
  new <slug> [--title "…"] [--queue [--top]] [--parent N[.M] [--minor --evidence "…" [--cost <уровень>] [--hypothesis]]]
                                                      завести задачу (по умолчанию в triage/) или находку задачи N / N.M;
                                                      --minor — minor-находка или гипотеза в minor/, с полем «Цена»;
                                                      --evidence обязателен с --minor: путь со строкой, команда с выводом
                                                      и кодом, замер числом; непроверенное — предположением
  mv <N…> <triage|queue|active|deferred|minor> [--top | --after M | --restore] [--evidence "…"]
                                                      сменить статус: git mv между каталогами; номеров может быть несколько;
                                                      в minor — только с уликой: раздел «Улика» или --evidence
  archive <N> [--dry-run] [--range <база>..HEAD]      закрыть задачу: переезд в archive/ с правкой ссылок;
                                                      печатает доки, которых коснулся ход задачи
  archive <N.k> --into <M> [--dry-run]                закрыть minor-запись пачкой M: переезд в archive/<M>-<slug>/minor/ без своего result.md
  fold <N> [--dry-run]                                свернуть закрытую задачу в строку archive/LOG.md: каталог уходит из дерева,
                                                      тело — в заготовку сообщения коммита (stdout), ссылки — на якорь строки
  fold [--older-than <дата>] [--embed-missing] [--dry-run]
                                                      свернуть накопленный архив: тело каждой задачи обязано лежать в истории,
                                                      строка журнала называет его ревизию; --embed-missing уносит тело,
                                                      которого в истории нет, в заготовку сообщения коммита
  show <N>                                            напечатать тело свёрнутой задачи (stdout) из ревизии, которую называет
                                                      её строка журнала; шапка — в stderr
  adr <slug> [--title "…"]                            завести ADR со следующим номером
  brief <N…> [--track "…"] [--neighbour "путь=track"] [--entry "…"]
        [--autonomy "…"] [--handover "…"] [--measurements]
                                                      напечатать бриф worker'у по этим задачам
  seed --scan [--json] | --queue-reference            кандидаты в gates и подсистемы с уликами;
                                                      задачи «Справочник: …» по таблице reference/
  status [--json]                                     сводка: в работе, очередь по порядку, отложено, triage, minor по областям
  lint                                                четырнадцать гейтов: ссылки, номера, раскладка бэклога, поля,
                                                      архив, упоминания, CHANGELOG, таблица ADR, разбор triage,
                                                      цитаты, версии релиза, слоты шаблонов, журнал закрытых,
                                                      непечатаемые байты;
                                                      adapter outputs, равенство шаблонов и предупреждения
                                                      о версии и закрытом родителе
  gates [--keep-going] [--json] [--require-clean] [--dry-run] [--base <ref>]
                                                      прогнать команды из gates: код каждой, счёт зелёных, снимок дерева;
                                                      область when сверяется с грязным деревом, --base добавляет дифф к ref
  tracks [--json]                                     worktree и ветки захода: влиты ли, что не влито, что не закоммичено
  upgrade [--to X.Y.Z] [--dry-run] [--pin-only]       обновить проект: пин в cli, gates и живых файлах, migrate и init новой версией
  migrate [--dry-run]                                 миграция формата файлов, правила ведения и архива из шаблона, штамп версии
  changelog [--since X.Y.Z] [--to X.Y.Z]              выжимка CHANGELOG backslop между версиями
  merge-changelog --ours <ref> --theirs <ref> [--base <ref>] [--out <файл>]
                                                      слить две редакции CHANGELOG.md: записи секции невыпущенного
                                                      по заголовку; результат в stdout или в --out, отчёт в stderr
  version | --version | -v                            версия backslop
  help | --help | -h | <команда> --help               эта справка

Значение флага, начинающееся с дефиса, — формой с «=»: --title="--…". Без «=» оно принимается,
если не совпадает с именем флага этой команды; -h и --help на месте значения — тоже значение.

Запуск без установки: npx github:Velklish/backslop#v${TOOL_VERSION} <команда>
`;

const HELP_EN = `backslop — a file-based backlog with an archive, ADRs, and process skills

Commands:
  init [--dir docs] [--prefix BS] [--cli <command>] [--lang ru|en] [--tools <CSV|none>]
                                                      create docs, adapters, AGENTS.md block, and backslop.json
  new <slug> [--title "…"] [--queue [--top]] [--parent N[.M] [--minor --evidence "…" [--cost <level>] [--hypothesis]]]
                                                      create a task (triage/ by default) or a finding for task N / N.M;
                                                      --minor — a minor finding or hypothesis in minor/, with a Cost field;
                                                      --evidence is required with --minor: a path with a line, a command
                                                      with output and exit code, a measurement; unverified is an assumption
  mv <N…> <triage|queue|active|deferred|minor> [--top | --after M | --restore] [--evidence "…"]
                                                      change status with git mv between directories; several numbers allowed;
                                                      minor requires evidence: an “Evidence” section or --evidence
  archive <N> [--dry-run] [--range <base>..HEAD]      close a task, move it to archive/, and update links;
                                                      prints the documentation touched by the task
  archive <N.k> --into <M> [--dry-run]                close a minor entry by batch M: move it to archive/<M>-<slug>/minor/ without a result.md of its own
  fold <N> [--dry-run]                                fold a closed task into an archive/LOG.md line: the directory leaves the tree,
                                                      the body goes into the commit message draft (stdout), links onto the line anchor
  fold [--older-than <date>] [--embed-missing] [--dry-run]
                                                      fold the accumulated archive: every task body must already be in history,
                                                      and its journal line names the revision; --embed-missing carries a body
                                                      that is not in history into the commit message draft
  show <N>                                            print the body of a folded task (stdout) from the revision its journal
                                                      line names; header on stderr
  adr <slug> [--title "…"]                            create the next numbered ADR
  brief <N…> [--track "…"] [--neighbour "path=track"] [--entry "…"]
        [--autonomy "…"] [--handover "…"] [--measurements]
                                                      print a worker brief for these tasks
  seed --scan [--json] | --queue-reference            gate and subsystem candidates with evidence;
                                                      “Reference: …” tasks from the reference/ table
  status [--json]                                     show active work, ordered queue, deferred tasks, triage, and minor entries by scope
  lint                                                fourteen gates: links, numbers, layout, fields, archive,
                                                      mentions, CHANGELOG, ADR index, triage review, quotes, release
                                                      versions, template slots, closed task journal, non-printable
                                                      bytes; adapter outputs,
                                                      template parity, and closed-parent warnings
  gates [--keep-going] [--json] [--require-clean] [--dry-run] [--base <ref>]
                                                      run the gates list: exit code of each, green count, tree snapshot;
                                                      a when scope is matched against the dirty tree, --base adds the diff to ref
  tracks [--json]                                     run worktrees and branches: merged or not, what is left, what is dirty
  upgrade [--to X.Y.Z] [--dry-run] [--pin-only]       update cli, gate, and live-file pins, migrate, and initialize the new version
  migrate [--dry-run]                                 migrate file formats, rewrite tracking and archive rules from the template, update the version stamp
  changelog [--since X.Y.Z] [--to X.Y.Z]              print backslop CHANGELOG entries between versions
  merge-changelog --ours <ref> --theirs <ref> [--base <ref>] [--out <file>]
                                                      merge two CHANGELOG.md revisions: unreleased entries by
                                                      heading; result on stdout or in --out, report on stderr
  version | --version | -v                            print the backslop version
  help | --help | -h | <command> --help               show this help

A flag value that starts with a dash goes in the “=” form: --title="--…". Without “=” it is
accepted unless it matches a flag name of that command; -h and --help in a value position are values.

Run without installing: npx github:Velklish/backslop#v${TOOL_VERSION} <command>
`;

const help = (lang) => pick(lang, HELP_RU, HELP_EN, `${HELP_EN}\n${HELP_RU}`);

async function main(argv) {
  const [name, ...rest] = argv;
  const project = projectHintsOrNull(process.cwd());
  const lang = project?.lang ?? null;
  if (!name || name === 'help' || name === '--help' || name === '-h') {
    process.stdout.write(help(lang));
    return 0;
  }
  if (name === 'version' || name === '--version' || name === '-v') {
    process.stdout.write(`backslop ${TOOL_VERSION}\n`);
    return 0;
  }
  if (!COMMANDS.includes(name)) {
    throw new CliError(pick(lang,
      `неизвестная команда «${name}»; список — ${project?.cli} help`,
      `unknown command “${name}”; see ${project?.cli} help`,
      `Unknown command “${name}” / Неизвестная команда «${name}»; see / список — backslop help`));
  }
  const mod = await import(`../lib/${name}.js`);
  try {
    return (await mod.run(rest, { cwd: process.cwd(), lang })) ?? 0;
  } catch (e) {
    if (!(e instanceof HelpRequest)) throw e;
    process.stdout.write(help(lang));
    return 0;
  }
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
