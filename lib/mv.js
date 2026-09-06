// Смена статуса: `git mv` файла между каталогами плюс поля, которые статус за собой ведёт.
// Место в очереди считается до переноса: отказ `--after` не должен оставлять файл уже в
// queue/ без порядка. Задача, уже стоящая в очереди, с `--top`/`--after` не переезжает —
// у неё меняется только «Порядок»; без флага положения это отказ, а не тихий no-op.
import path from 'node:path';
import { STATUSES, loadProject } from './config.js';
import {
  FIELD_ORDER, FIELD_TAKEN, SECTION_DEFERRED, fieldName, findFlatTask, findTask, formatId, parseId, placeInQueue,
  queueOrder, readText, relocateTask, removeField, sameId, scanTasks, sectionBody, appendSection, setField, writeText,
} from './tasks.js';
import { CliError, info, ok, parseCommandArgs, today, toPosix } from './util.js';
import { tr } from './i18n.js';

export async function run(argv, { cwd }) {
  const { values, positionals } = parseCommandArgs(argv, {
    top: { type: 'boolean' },
    after: { type: 'string' },
  });
  const project = loadProject(cwd);
  const { root, cfg, dirs } = project;
  const [rawId, target] = positionals;
  if (!rawId || !target) throw new CliError(tr(cfg.lang, 'нужны номер и статус: backslop mv <N> <triage|queue|active|deferred> [--top | --after M]', 'task number and status are required: backslop mv <N> <triage|queue|active|deferred> [--top | --after M]'));
  if (!STATUSES.includes(target)) throw new CliError(tr(cfg.lang, `статус «${target}» неизвестен; есть ${STATUSES.join(', ')}. Закрытие — backslop archive`, `unknown status “${target}”; expected ${STATUSES.join(', ')}. Close tasks with backslop archive`));
  if ((values.top || values.after !== undefined) && target !== 'queue') throw new CliError(tr(cfg.lang, '--top и --after имеют смысл только при переводе в queue', '--top and --after are only valid when moving to queue'));
  if (values.top && values.after !== undefined) throw new CliError(tr(cfg.lang, '--top и --after вместе не сочетаются', '--top and --after cannot be used together'));
  const tasks = scanTasks(project);
  const id = parseId(rawId, cfg.prefix, cfg.lang);
  // Файл плоского бэклога (прямо в docs/backlog/) — тоже задача для переезда: миграция.
  const task = findTask(tasks, id, cfg.lang) ?? findFlatTask(project, id);
  if (!task) throw new CliError(tr(cfg.lang, `задачи ${formatId(cfg.prefix, id.num, id.sub)} нет ни в одном каталоге статуса`, `task ${formatId(cfg.prefix, id.num, id.sub)} was not found in any status directory`));
  if (task.status === 'archive') throw new CliError(tr(cfg.lang, `${task.id} в архиве; вернуть закрытую задачу — руками, осознанно`, `${task.id} is archived; restore a closed task manually and deliberately`));
  const reorder = task.status === 'queue' && target === 'queue';
  if (task.status === target && !reorder) throw new CliError(tr(cfg.lang, `${task.id} уже в ${target}/`, `${task.id} is already in ${target}/`));
  if (reorder && !values.top && values.after === undefined) throw new CliError(tr(cfg.lang, `${task.id} уже в queue/; место — --top или --after M`, `${task.id} is already in queue/; give a position: --top or --after M`));

  let placed = null;
  if (target === 'queue') {
    const after = values.after === undefined ? null : parseId(values.after, cfg.prefix, cfg.lang);
    if (after && sameId(after, task)) throw new CliError(tr(cfg.lang, `--after ${task.id}: задача не может стоять после самой себя`, `--after ${task.id}: a task cannot follow itself`));
    const rows = queueOrder(tasks.filter((t) => t.file !== task.file));
    placed = placeInQueue(rows, { top: Boolean(values.top), after }, cfg.lang);
  }

  const to = reorder ? task.file : path.join(dirs.statusDir[target], path.basename(task.file));
  const newRel = toPosix(path.relative(root, to));

  // Исходящие ссылки — от старого каталога к новому, как при archive: из плоского docs/backlog/
  // глубина растёт и `../reference/…` иначе рвётся; между каталогами статусов ссылка на соседа
  // из прежнего каталога получает `../<статус>/`.
  const changed = reorder ? [] : relocateTask(project, task, newRel);
  let text = readText(to);
  const outgoingChanged = changed.includes(newRel);
  if (placed) text = setField(text, FIELD_ORDER, String(placed.rank), cfg.lang);
  else text = removeField(text, FIELD_ORDER);
  if (target === 'active') text = setField(text, FIELD_TAKEN, today(), cfg.lang);
  else text = removeField(text, FIELD_TAKEN);
  if (target === 'deferred' && sectionBody(text, SECTION_DEFERRED) === null) {
    const deferred = cfg.lang === 'en'
      ? [`- **Deferred:** ${today()}`, '- **Reason:** [TODO]', '- **Return condition:** [TODO: what must happen before this returns to the queue]']
      : [`- **Отложена:** ${today()}`, '- **Причина:** [TODO]', '- **Условие возврата:** [TODO: что должно случиться, чтобы вернуть в очередь]'];
    text = appendSection(text, SECTION_DEFERRED, deferred.join('\n'), cfg.lang);
  }
  writeText(to, text);
  for (const [otherFile, rank] of placed?.renumbered ?? []) {
    writeText(otherFile, setField(readText(otherFile), FIELD_ORDER, String(rank), cfg.lang));
  }

  if (reorder) {
    ok(`${task.id}: queue/ «${fieldName(FIELD_ORDER, cfg.lang)}» ${placed.rank}`);
    if (placed.renumbered.length) info(tr(cfg.lang, `очередь перенумерована шагом 10: ${placed.renumbered.length} файлов`, `queue renumbered in steps of 10: ${placed.renumbered.length} files`));
    return 0;
  }

  // Входящие ссылки на файл — по всему markdown репозитория, как при archive: каталог сменился,
  // и ссылка из roadmap или соседней задачи иначе остаётся битой.
  const relinked = changed.filter((rel) => rel !== newRel);

  ok(`${task.id}: ${task.status}/ → ${target}/ (${newRel})`);
  if (outgoingChanged) info(tr(cfg.lang, 'исходящие ссылки пересчитаны от нового каталога', 'outgoing links recalculated from the new directory'));
  if (relinked.length) info(tr(cfg.lang, `ссылки на задачу поправлены: ${relinked.join(', ')}`, `task links updated: ${relinked.join(', ')}`));
  if (placed?.renumbered.length) info(tr(cfg.lang, `очередь перенумерована шагом 10: ${placed.renumbered.length} файлов`, `queue renumbered in steps of 10: ${placed.renumbered.length} files`));
  if (target === 'deferred') info(tr(cfg.lang, 'заполни раздел «Отложено»: причина и условие возврата — без них lint красный', 'complete the “Deferred” section with a reason and return condition or lint will fail'));
  return 0;
}
