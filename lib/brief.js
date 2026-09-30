// Бриф worker'у: данные с диска и неизменный текст, а решения оркестратора — текстовыми
// аргументами. Команда печатает в stdout; куда его отправить, решает оркестратор (ADR-042).
import process from 'node:process';
import { CONFIG_FILE, gateEntry, loadProject, parseCli } from './config.js';
import { formatId } from './ids.js';
import { probeSlots, renderProjectTemplate } from './templates.js';
import {
  SECTION_OUT, SECTION_WORK, findTask, parseId, readTitle, scanTasks, sectionBody, sectionName,
} from './tasks.js';
import { CliError, parseCommandArgs, readText, warn } from './util.js';
import { compareVersions } from './version.js';
import { msg } from './i18n.js';

// Version floor for runnable brief instructions.
const BRIEF_COMMANDS_SINCE = '0.10.0';

export async function run(argv, { cwd, lang }) {
  const { values, positionals } = parseCommandArgs(argv, {
    track: { type: 'string' },
    neighbour: { type: 'string', multiple: true },
    entry: { type: 'string' },
    autonomy: { type: 'string' },
    handover: { type: 'string' },
    measurements: { type: 'boolean' },
  }, { positionals: Infinity, lang });
  const project = loadProject(cwd);
  const { cfg } = project;
  if (!positionals.length) {
    throw new CliError(msg(cfg.lang,
      'task numbers are required: {cli} brief <N…> [--track "…"] [--neighbour "path=track"] [--entry "…"] [--autonomy "…"] [--handover "…"] [--measurements]', { cli: cfg.cli }));
  }
  const all = scanTasks(project);
  // Несуществующий номер — отказ с этим номером: пустой рендер worker прочитал бы как «задач нет».
  const chosen = positionals.map((raw) => {
    const id = parseId(raw, cfg.prefix, cfg.lang);
    const task = findTask(all, id, cfg.lang);
    if (!task) {
      throw new CliError(msg(cfg.lang,
        'task {id} was not found in any status directory or the archive', { id: formatId(cfg.prefix, id.num, id.sub) }));
    }
    // Архивная запись без `task.md` постановки не несёт — читать нечего, и ENOENT со стеком
    // здесь ошибка кода, а не адресованный человеку отказ (гейт 5 lint смотрит на то же).
    if (task.status === 'archive' && !task.hasTask) {
      throw new CliError(msg(cfg.lang,
        '{id} is archived without task.md — there is no definition for the brief to take', { id: task.id }));
    }
    return task;
  });

  process.stdout.write(renderProjectTemplate(cfg, 'brief.md', {
    track: values.track ?? msg(cfg.lang, '[TODO: track title in 2–5 words]'),
    tasks: chosen.map((task) => taskBlock(task, cfg.lang)).join('\n\n'),
    neighbours: neighbours(values.neighbour ?? [], cfg.lang),
    entry: values.entry ?? msg(cfg.lang,
      '[TODO: where the subject lives and what to read first — `--entry "lib/guard.js, then docs/reference/03-cli.md"`. Without a map the participant looks for the subject itself and pays for it in recon turns.]'),
    autonomy: values.autonomy ?? msg(cfg.lang,
      '[TODO: what the participant closes by its own decision and what it brings to the orchestrator — `--autonomy "…"`. Without this list a fork leaves as a question on the bus and the participant waits for the answer.]'),
    handover: values.handover ?? msg(cfg.lang,
      '[TODO: the gate protocol and the header of the report — `--handover "…"`. The template sets the structure, the caller supplies the content: the format of those two lives outside backslop.]'),
    gates: gatesStep(cfg),
    ...probeSlots(cfg),
    prefix: cfg.prefix,
    cli: cfg.cli,
    measurements: values.measurements ? measurements(cfg.lang) : '',
  }));
  warnForMissingBriefCommands(cfg);
  // Пропажу требования команда называет вслух, как это делает `init` (ADR-041), и называет в
  // stderr: stdout — сам бриф, и нота в нём уехала бы worker'у частью постановки.
  if (!cfg.probe) {
    warn(msg(cfg.lang,
      'probe is not declared in {config}: the brief names no mutation-probe command — declare it in probe or name it in the brief yourself', { config: CONFIG_FILE }));
  }
  return 0;
}

function warnForMissingBriefCommands(cfg) {
  const pin = parseCli(cfg.cli)?.pin;
  if (!pin || compareVersions(pin, BRIEF_COMMANDS_SINCE) >= 0) return;
  warn(msg(cfg.lang,
    'Pinned CLI {cli} predates 0.10.0 and lacks `new --minor --evidence` named in the brief; run `{cli} upgrade`.', { cli: cfg.cli }));
}

// Постановка задачи в бриф: номер, заголовок, путь к файлу и разделы, задающие границы.
// Целиком файл не переносится — worker его прочитает; бриф называет, что именно взято.
function taskBlock(task, lang) {
  const text = readText(task.file);
  const title = readTitle(text);
  const parts = [`### ${task.id} — ${title ? title.title : task.slug}`, '', msg(lang, 'File: `{rel}`', { rel: task.rel })];
  for (const section of [SECTION_WORK, SECTION_OUT]) {
    const body = sectionBody(text, section);
    if (body) parts.push('', `**${sectionName(section, lang)}**`, '', body);
  }
  return parts.join('\n');
}

// Соседний track: `--neighbour "test/=tests"`. Без флага — заготовка: границы решает
// оркестратор, и команда за него их не выдумывает.
function neighbours(list, lang) {
  if (!list.length) {
    return msg(lang,
      '[TODO: which directories are yours. Name neighbouring tracks explicitly — `--neighbour "test/=tests"`: a ban without a neighbour’s name invites the worker to work around it.]');
  }
  const rows = list.map((pair) => {
    const at = pair.indexOf('=');
    if (at <= 0 || at === pair.length - 1) {
      throw new CliError(msg(lang, '--neighbour “{pair}”: expected the form “path=track”', { pair }));
    }
    return [pair.slice(0, at), pair.slice(at + 1)];
  });
  const head = msg(lang,
    'Everything not listed below is yours. Neighbouring tracks run in parallel in their own worktrees; do not touch their files without need:');
  return [head, '', ...rows.map(([p, track]) => msg(lang, '- `{path}` — track “{track}”;', { path: p, track }))].join('\n');
}

function gatesStep(cfg) {
  const lang = cfg.lang;
  if (!cfg.gates.length) {
    return msg(lang,
      'Project gates are green by count, but the `gates` list in `{config}` is empty — ask the orchestrator what checks this task.', { config: CONFIG_FILE });
  }
  const entries = cfg.gates.map(gateEntry);
  const list = entries.map((g) => `\`${g.command}\``).join(', ');
  // Область у части команд меняет критерий готовности: «зелёных N» из N уже не обязано быть
  // равным составу списка, и пропуск, не названный в отчёте, читается как покрытие.
  const scoped = entries.filter((g) => g.when !== null).length;
  const scopeNote = scoped
    ? msg(lang,
      ' {scoped} of {entries} carry a `when` scope: on untouched paths they are skipped, and the runner prints them as “not run N”. A skip never adds to the green count — name it in the report separately.', { scoped, entries: entries.length })
    : '';
  return msg(lang,
    'Project gates are green by count: `{cli} gates` prints the summary “gates N, green N”. Their contents: {list}.{scopeNote} Read the exit code of the command, not of a pipe: `cmd > out; echo $?`.', { cli: cfg.cli, list, scopeNote });
}

function measurements(lang) {
  return msg(lang,
    '- **Take numbers from the run by measurement, not by feel**: a live wall clock measures your neighbours, an exit code is read from the command rather than the pipe, and an incomplete grep result looks as confident as a complete one. Not measured — write it as a hypothesis.\n');
}
