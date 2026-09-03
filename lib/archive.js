// Закрытие задачи: переезд файла из каталога статуса в archive/<id>-<slug>/task.md с правкой
// ссылок и заготовкой result.md. Переезд меняет глубину файла относительно docs/ — от этого
// едут все относительные ссылки внутри файла и на него; чинятся обе стороны по одному обходу
// markdown, что и у lint. Исход и результат в result.md — решение approver'а, не подстановка.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadProject } from './config.js';
import { rewriteIncomingLinks, rewriteMovedLinks } from './links.js';
import { repoMarkdown } from './mdwalk.js';
import { renderTemplate } from './templates.js';
import { findTask, formatId, moveFile, parseId, readText, scanTasks, writeText } from './tasks.js';
import { CliError, info, ok, parseCommandArgs, today, toPosix, warn } from './util.js';

export async function run(argv, { cwd }) {
  const { values, positionals } = parseCommandArgs(argv, { 'dry-run': { type: 'boolean' } });
  const dry = values['dry-run'] === true;
  if (!positionals[0]) throw new CliError('нужен номер задачи: backslop archive <N> [--dry-run]');

  const project = loadProject(cwd);
  const { root, cfg, dirs } = project;
  const tasks = scanTasks(project);
  const id = parseId(positionals[0], cfg.prefix);
  const task = findTask(tasks, id);
  if (!task) throw new CliError(`задачи ${formatId(cfg.prefix, id.num, id.sub)} нет ни в одном каталоге статуса`);
  if (task.status === 'archive') throw new CliError(`${task.id} уже в архиве: ${task.rel}`);

  const dirName = `${task.id}-${task.slug}`;
  const archiveDir = path.join(dirs.archive, dirName);
  const newFile = path.join(archiveDir, 'task.md');
  if (existsSync(newFile)) throw new CliError(`${toPosix(path.relative(root, newFile))} уже существует — под этим номером в архиве лежит другая задача`);

  const oldRel = task.rel;
  const newRel = toPosix(path.relative(root, newFile));
  info(`переезд: ${oldRel} → ${newRel}${dry ? ' (--dry-run, ничего не пишу)' : ''}`);

  if (!dry) {
    const how = moveFile(root, task.file, newFile);
    if (how === 'fs') warn('файл не в индексе git — перенесён без git mv');
  }

  const changed = [];
  const source = dry ? task.file : newFile;
  const before = readText(source);
  const after = rewriteMovedLinks(before, path.posix.dirname(oldRel), path.posix.dirname(newRel));
  if (after !== before) {
    changed.push(newRel);
    if (!dry) writeText(source, after);
  }

  for (const [rel, abs] of repoMarkdown(root)) {
    if (rel === newRel || rel === oldRel) continue;
    const text = readText(abs);
    const next = rewriteIncomingLinks(text, path.posix.dirname(rel), oldRel, newRel);
    if (next === text) continue;
    changed.push(rel);
    if (!dry) writeText(abs, next);
  }

  const resultFile = path.join(archiveDir, 'result.md');
  if (!dry && !existsSync(resultFile)) {
    writeText(resultFile, renderTemplate('result.md', { id: task.id, date: today(), prefix: cfg.prefix }));
  }

  ok(`archive: ${task.id} — файлов с поправленными ссылками ${changed.length}`);
  for (const rel of changed) info(rel);
  if (!dry) info(`допиши ${toPosix(path.relative(root, resultFile))}: исход и результат — ход approver'а, без него lint красный`);
  return 0;
}
