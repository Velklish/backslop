// Бриф worker'у: из восьми обязательных пунктов семь — данные с диска и неизменный текст,
// решение оркестратора только одно — границы правки, и оно остаётся текстовым аргументом.
// Команда печатает текст в stdout; куда его отправить — промпт субагента, первое сообщение
// сессии, шина — решает оркестратор.
import { loadProject } from './config.js';
import { renderProjectTemplate } from './templates.js';
import {
  SECTION_OUT, SECTION_WORK, findTask, formatId, parseId, readText, readTitle, scanTasks, sectionBody, sectionName,
} from './tasks.js';
import { CliError, parseCommandArgs } from './util.js';
import { tr } from './i18n.js';

export async function run(argv, { cwd }) {
  const { values, positionals } = parseCommandArgs(argv, {
    track: { type: 'string' },
    neighbour: { type: 'string', multiple: true },
    measurements: { type: 'boolean' },
  });
  const project = loadProject(cwd);
  const { cfg } = project;
  if (!positionals.length) {
    throw new CliError(tr(cfg.lang,
      'нужны номера задач: backslop brief <N…> [--track "…"] [--neighbour "путь=track"] [--measurements]',
      'task numbers are required: backslop brief <N…> [--track "…"] [--neighbour "path=track"] [--measurements]'));
  }
  const all = scanTasks(project);
  // Несуществующий номер — отказ с этим номером: пустой рендер worker прочитал бы как «задач нет».
  const chosen = positionals.map((raw) => {
    const id = parseId(raw, cfg.prefix, cfg.lang);
    const task = findTask(all, id, cfg.lang);
    if (!task) {
      throw new CliError(tr(cfg.lang,
        `задачи ${formatId(cfg.prefix, id.num, id.sub)} нет ни в одном каталоге статуса и в архиве`,
        `task ${formatId(cfg.prefix, id.num, id.sub)} was not found in any status directory or the archive`));
    }
    // Архивная запись без `task.md` постановки не несёт — читать нечего, и ENOENT со стеком
    // здесь ошибка кода, а не адресованный человеку отказ (гейт 5 lint смотрит на то же).
    if (task.status === 'archive' && !task.hasTask) {
      throw new CliError(tr(cfg.lang,
        `${task.id} в архиве без task.md — постановки нет, брифу нечего взять`,
        `${task.id} is archived without task.md — there is no definition for the brief to take`));
    }
    return task;
  });

  process.stdout.write(renderProjectTemplate(cfg, 'brief.md', {
    track: values.track ?? tr(cfg.lang, '[TODO: заголовок track’а в 2–5 слов]', '[TODO: track title in 2–5 words]'),
    tasks: chosen.map((task) => taskBlock(task, cfg.lang)).join('\n\n'),
    neighbours: neighbours(values.neighbour ?? [], cfg.lang),
    gates: cfg.gates.length
      ? cfg.gates.map((g) => `\`${g}\``).join(', ')
      : tr(cfg.lang, 'в `backslop.json` их нет — спроси оркестратора', 'none in `backslop.json` — ask the orchestrator'),
    prefix: cfg.prefix,
    cli: cfg.cli,
    measurements: values.measurements ? measurements(cfg.lang) : '',
  }));
  return 0;
}

// Постановка задачи в бриф: номер, заголовок, путь к файлу и разделы, задающие границы.
// Целиком файл не переносится — worker его прочитает; бриф называет, что именно взято.
function taskBlock(task, lang) {
  const text = readText(task.file);
  const title = readTitle(text);
  const parts = [`### ${task.id} — ${title ? title.title : task.slug}`, '', tr(lang, `Файл: \`${task.rel}\``, `File: \`${task.rel}\``)];
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
    return tr(lang,
      '[TODO: какие каталоги твои. Соседние track\'и назови поимённо — `--neighbour "test/=tests"`: запрет без имени соседа worker пытается обойти.]',
      '[TODO: which directories are yours. Name neighbouring tracks explicitly — `--neighbour "test/=tests"`: a ban without a neighbour’s name invites the worker to work around it.]');
  }
  const rows = list.map((pair) => {
    const at = pair.indexOf('=');
    if (at <= 0 || at === pair.length - 1) {
      throw new CliError(tr(lang, `--neighbour «${pair}»: нужна форма «путь=track»`, `--neighbour “${pair}”: expected the form “path=track”`));
    }
    return [pair.slice(0, at), pair.slice(at + 1)];
  });
  const head = tr(lang,
    'Всё, что не названо ниже, — твоё. Соседние track\'и идут параллельно в своих worktree, их файлы не трогай без нужды:',
    'Everything not listed below is yours. Neighbouring tracks run in parallel in their own worktrees; do not touch their files without need:');
  return [head, '', ...rows.map(([p, track]) => tr(lang, `- \`${p}\` — track «${track}»;`, `- \`${p}\` — track “${track}”;`))].join('\n');
}

function measurements(lang) {
  return tr(lang,
    `- **Число из захода снимай замером, а не на глаз**: настенные часы при живом заходе меряют соседей, код возврата смотрится у команды, а не у пайпа, неполный ответ грепа выглядит так же уверенно, как полный. Не замерил — пиши предположением.\n`,
    `- **Take numbers from the run by measurement, not by feel**: a live wall clock measures your neighbours, an exit code is read from the command rather than the pipe, and an incomplete grep result looks as confident as a complete one. Not measured — write it as a hypothesis.\n`);
}
