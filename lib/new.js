// Заведение задачи или находки: номер — по каталогам, файл — из шаблона, статус — triage,
// если не сказано иначе. Строк индекса нет, поэтому команда не оставляет ничего, кроме файла.
// Номер считается и по чужим worktree и локальным веткам: параллельный worker иначе берёт тот же.
import path from 'node:path';
import { loadProject } from './config.js';
import { renderProjectTemplate } from './templates.js';
import {
  FIELD_ORDER, SLUG_RE, findTask, foreignTaskIds, formatId, nextNumber, nextSub, parseId, placeInQueue,
  queueOrder, readText, scanTasks, setField, writeText,
} from './tasks.js';
import { CliError, info, ok, parseCommandArgs, today, toPosix } from './util.js';
import { tr } from './i18n.js';

export async function run(argv, { cwd }) {
  const { values, positionals } = parseCommandArgs(argv, {
    title: { type: 'string' },
    queue: { type: 'boolean' },
    top: { type: 'boolean' },
    parent: { type: 'string' },
  });
  const project = loadProject(cwd);
  const { root, cfg, dirs } = project;
  const slug = positionals[0];
  if (!slug) throw new CliError(tr(cfg.lang, 'нужен slug: backslop new <slug> [--title "…"] [--queue [--top]] [--parent N]', 'slug is required: backslop new <slug> [--title "…"] [--queue [--top]] [--parent N]'));
  if (!SLUG_RE.test(slug)) throw new CliError(tr(cfg.lang, `slug «${slug}»: латиница в нижнем регистре, цифры и дефисы между словами`, `slug “${slug}”: use lowercase Latin letters, digits, and hyphens between words`));
  if (values.top && !values.queue) throw new CliError(tr(cfg.lang, '--top имеет смысл только вместе с --queue', '--top is only valid together with --queue'));
  const tasks = scanTasks(project);
  const foreign = foreignTaskIds(project, cfg.lang);
  const all = [...tasks, ...foreign];

  let num;
  let sub = null;
  let parentTask = null;
  let blocker = null; // чужой номер, из-за которого свой сдвинулся
  let context = cfg.lang === 'en' ? '[TODO: where the task came from and what motivates it.]' : '[TODO: откуда задача и что за ней стоит.]';
  if (values.parent !== undefined) {
    const parent = parseId(values.parent, cfg.prefix, cfg.lang);
    if (parent.sub !== null) throw new CliError(tr(cfg.lang, 'находка привязывается к задаче, а не к находке: --parent ждёт N без точки', 'a finding attaches to a task, not another finding: --parent expects N without a dot'));
    parentTask = findTask(tasks, parent, cfg.lang);
    if (!parentTask) throw new CliError(cfg.lang === 'en'
      ? `task ${formatId(cfg.prefix, parent.num)} was not found in any status directory or archive`
      : `задачи ${formatId(cfg.prefix, parent.num)} нет ни в одном каталоге статуса и в архиве`);
    num = parent.num;
    sub = nextSub(all, num);
    blocker = foreign.find((f) => f.num === num && f.sub === sub - 1) ?? null;
    context = cfg.lang === 'en'
      ? `Finding discovered while working on ${parentTask.id}. Evidence: [TODO: file path or command output]. If unverified, state it as an assumption.`
      : `Находка при работе над ${parentTask.id}. Улика: [TODO: путь к файлу или команда с выводом]. Не проверено — написать как предположение.`;
  } else {
    num = nextNumber(all);
    blocker = foreign.find((f) => f.sub === null && f.num === num - 1) ?? null;
  }

  // Находка наследует форму номера родителя: у `BS-007` — `BS-007.1`, не `BS-7.1`.
  const id = parentTask ? `${parentTask.id}.${sub}` : formatId(cfg.prefix, num);
  const status = values.queue ? 'queue' : 'triage';
  const file = path.join(dirs.statusDir[status], `${id}-${slug}.md`);
  let text = renderProjectTemplate(cfg, 'task.md', {
    id,
    title: values.title ?? slug,
    date: today(),
    area: cfg.lang === 'en' ? '[TODO: reference/ section]' : '[TODO: раздел reference/]',
    context,
  });
  const renumbered = [];
  if (status === 'queue') {
    const placed = placeInQueue(queueOrder(tasks), { top: Boolean(values.top) }, cfg.lang);
    text = setField(text, FIELD_ORDER, String(placed.rank), cfg.lang);
    renumbered.push(...placed.renumbered);
  }
  for (const [otherFile, rank] of renumbered) {
    writeText(otherFile, setField(readText(otherFile), FIELD_ORDER, String(rank), cfg.lang));
  }
  writeText(file, text);
  ok(`${id}: ${toPosix(path.relative(root, file))}`);
  if (blocker) info(tr(cfg.lang, `${formatId(cfg.prefix, blocker.num, blocker.sub)} занят: ${blocker.source}`, `${formatId(cfg.prefix, blocker.num, blocker.sub)} is taken: ${blocker.source}`));
  if (renumbered.length) info(tr(cfg.lang, `очередь перенумерована шагом 10: ${renumbered.length} файлов`, `queue renumbered in steps of 10: ${renumbered.length} files`));
  if (status === 'triage') info(tr(cfg.lang, 'запись лежит в triage/ до разбора; в очередь — backslop mv <N> queue', 'entry remains in triage/ until review; move it to the queue with backslop mv <N> queue'));
  return 0;
}
