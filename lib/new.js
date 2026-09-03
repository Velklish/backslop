// Заведение задачи или находки: номер — по каталогам, файл — из шаблона, статус — triage,
// если не сказано иначе. Строк индекса нет, поэтому команда не оставляет ничего, кроме файла.
import path from 'node:path';
import { loadProject } from './config.js';
import { renderTemplate } from './templates.js';
import {
  FIELD_ORDER, SLUG_RE, findTask, formatId, nextNumber, nextSub, parseId, placeInQueue,
  queueOrder, readText, scanTasks, setField, writeText,
} from './tasks.js';
import { CliError, info, ok, parseCommandArgs, today, toPosix } from './util.js';

export async function run(argv, { cwd }) {
  const { values, positionals } = parseCommandArgs(argv, {
    title: { type: 'string' },
    queue: { type: 'boolean' },
    top: { type: 'boolean' },
    parent: { type: 'string' },
  });
  const slug = positionals[0];
  if (!slug) throw new CliError('нужен slug: backslop new <slug> [--title "…"] [--queue [--top]] [--parent N]');
  if (!SLUG_RE.test(slug)) throw new CliError(`slug «${slug}»: латиница в нижнем регистре, цифры и дефисы между словами`);
  if (values.top && !values.queue) throw new CliError('--top имеет смысл только вместе с --queue');

  const project = loadProject(cwd);
  const { root, cfg, dirs } = project;
  const tasks = scanTasks(project);

  let num;
  let sub = null;
  let context = '[TODO: откуда задача и что за ней стоит.]';
  if (values.parent !== undefined) {
    const parent = parseId(values.parent, cfg.prefix);
    if (parent.sub !== null) throw new CliError('находка привязывается к задаче, а не к находке: --parent ждёт N без точки');
    if (!findTask(tasks, parent)) throw new CliError(`задачи ${formatId(cfg.prefix, parent.num)} нет ни в одном каталоге статуса и в архиве`);
    num = parent.num;
    sub = nextSub(tasks, num);
    context = `Находка при работе над ${formatId(cfg.prefix, num)}. Улика: [TODO: путь к файлу или команда с выводом]. Не проверено — написать как предположение.`;
  } else {
    num = nextNumber(tasks);
  }

  const id = formatId(cfg.prefix, num, sub);
  const status = values.queue ? 'queue' : 'triage';
  const file = path.join(dirs.statusDir[status], `${id}-${slug}.md`);
  let text = renderTemplate('task.md', {
    id,
    title: values.title ?? slug,
    date: today(),
    area: '[TODO: раздел reference/]',
    context,
  });
  const renumbered = [];
  if (status === 'queue') {
    const placed = placeInQueue(queueOrder(tasks), { top: Boolean(values.top) });
    text = setField(text, FIELD_ORDER, String(placed.rank));
    renumbered.push(...placed.renumbered);
  }
  for (const [otherFile, rank] of renumbered) {
    writeText(otherFile, setField(readText(otherFile), FIELD_ORDER, String(rank)));
  }
  writeText(file, text);
  ok(`${id}: ${toPosix(path.relative(root, file))}`);
  if (renumbered.length) info(`очередь перенумерована шагом 10: ${renumbered.length} файлов`);
  if (status === 'triage') info('запись лежит в triage/ до разбора; в очередь — backslop mv <N> queue');
  return 0;
}
