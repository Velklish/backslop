// Смена статуса: `git mv` файла между каталогами плюс поля, которые статус за собой ведёт.
// Место в очереди считается до переноса: отказ `--after` не должен оставлять файл уже в
// queue/ без порядка.
import path from 'node:path';
import { STATUSES, loadProject } from './config.js';
import { rewriteIncomingLinks } from './links.js';
import { repoMarkdown } from './mdwalk.js';
import {
  FIELD_ORDER, FIELD_TAKEN, SECTION_DEFERRED, findTask, formatId, moveFile, parseId, placeInQueue,
  queueOrder, readText, removeField, scanTasks, sectionBody, appendSection, setField, writeText,
} from './tasks.js';
import { CliError, info, ok, parseCommandArgs, today, toPosix, warn } from './util.js';

export async function run(argv, { cwd }) {
  const { values, positionals } = parseCommandArgs(argv, {
    top: { type: 'boolean' },
    after: { type: 'string' },
  });
  const [rawId, target] = positionals;
  if (!rawId || !target) throw new CliError('нужны номер и статус: backslop mv <N> <triage|queue|active|deferred> [--top | --after M]');
  if (!STATUSES.includes(target)) throw new CliError(`статус «${target}» неизвестен; есть ${STATUSES.join(', ')}. Закрытие — backslop archive`);
  if ((values.top || values.after !== undefined) && target !== 'queue') throw new CliError('--top и --after имеют смысл только при переводе в queue');
  if (values.top && values.after !== undefined) throw new CliError('--top и --after вместе не сочетаются');

  const project = loadProject(cwd);
  const { root, cfg, dirs } = project;
  const tasks = scanTasks(project);
  const id = parseId(rawId, cfg.prefix);
  const task = findTask(tasks, id);
  if (!task) throw new CliError(`задачи ${formatId(cfg.prefix, id.num, id.sub)} нет ни в одном каталоге статуса`);
  if (task.status === 'archive') throw new CliError(`${task.id} в архиве; вернуть закрытую задачу — руками, осознанно`);
  if (task.status === target) throw new CliError(`${task.id} уже в ${target}/`);

  let placed = null;
  if (target === 'queue') {
    const rows = queueOrder(tasks.filter((t) => t.file !== task.file));
    const after = values.after === undefined ? null : parseId(values.after, cfg.prefix);
    placed = placeInQueue(rows, { top: Boolean(values.top), after });
  }

  const to = path.join(dirs.statusDir[target], path.basename(task.file));
  const how = moveFile(root, task.file, to);
  if (how === 'fs') warn('файл не в индексе git — перенесён без git mv');

  let text = readText(to);
  if (placed) text = setField(text, FIELD_ORDER, String(placed.rank));
  else text = removeField(text, FIELD_ORDER);
  if (target === 'active') text = setField(text, FIELD_TAKEN, today());
  else text = removeField(text, FIELD_TAKEN);
  if (target === 'deferred' && sectionBody(text, SECTION_DEFERRED) === null) {
    text = appendSection(text, SECTION_DEFERRED, [
      `- **Отложена:** ${today()}`,
      '- **Причина:** [TODO]',
      '- **Условие возврата:** [TODO: что должно случиться, чтобы вернуть в очередь]',
    ].join('\n'));
  }
  writeText(to, text);
  for (const [otherFile, rank] of placed?.renumbered ?? []) {
    writeText(otherFile, setField(readText(otherFile), FIELD_ORDER, String(rank)));
  }

  // Входящие ссылки на файл — по всему markdown репозитория, как при archive: каталог сменился,
  // и ссылка из roadmap или соседней задачи иначе остаётся битой.
  const newRel = toPosix(path.relative(root, to));
  const relinked = [];
  for (const [rel, abs] of repoMarkdown(root)) {
    if (rel === newRel || rel === task.rel) continue;
    const before = readText(abs);
    const after = rewriteIncomingLinks(before, path.posix.dirname(rel), task.rel, newRel);
    if (after === before) continue;
    writeText(abs, after);
    relinked.push(rel);
  }

  ok(`${task.id}: ${task.status}/ → ${target}/ (${newRel})`);
  if (relinked.length) info(`ссылки на задачу поправлены: ${relinked.join(', ')}`);
  if (placed?.renumbered.length) info(`очередь перенумерована шагом 10: ${placed.renumbered.length} файлов`);
  if (target === 'deferred') info('заполни раздел «Отложено»: причина и условие возврата — без них lint красный');
  return 0;
}
