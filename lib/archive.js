// Закрытие задачи: переезд файла из каталога статуса в archive/<id>-<slug>/task.md с правкой
// ссылок и заготовкой result.md. Переезд меняет глубину файла относительно docs/ — от этого
// едут все относительные ссылки внутри файла и на него; чинятся обе стороны по одному обходу
// markdown, что и у lint. Исход и результат в result.md — решение approver'а, не подстановка.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadProject } from './config.js';
import { rewriteIncomingLinks, rewriteMovedLinks } from './links.js';
import { repoMarkdown } from './mdwalk.js';
import { renderProjectTemplate } from './templates.js';
import { findTask, formatId, moveFile, parseId, readText, scanTasks, writeText } from './tasks.js';
import { CliError, info, ok, parseCommandArgs, today, toPosix, warn } from './util.js';
import { tr } from './i18n.js';

export async function run(argv, { cwd }) {
  const { values, positionals } = parseCommandArgs(argv, { 'dry-run': { type: 'boolean' } });
  const dry = values['dry-run'] === true;
  const project = loadProject(cwd);
  const { root, cfg, dirs } = project;
  if (!positionals[0]) throw new CliError(tr(cfg.lang, 'нужен номер задачи: backslop archive <N> [--dry-run]', 'task number is required: backslop archive <N> [--dry-run]'));
  const tasks = scanTasks(project);
  const id = parseId(positionals[0], cfg.prefix, cfg.lang);
  const task = findTask(tasks, id, cfg.lang);
  if (!task) throw new CliError(tr(cfg.lang, `задачи ${formatId(cfg.prefix, id.num, id.sub)} нет ни в одном каталоге статуса`, `task ${formatId(cfg.prefix, id.num, id.sub)} was not found in any status directory`));
  if (task.status === 'archive') throw new CliError(tr(cfg.lang, `${task.id} уже в архиве: ${task.rel}`, `${task.id} is already archived: ${task.rel}`));

  const dirName = `${task.id}-${task.slug}`;
  const archiveDir = path.join(dirs.archive, dirName);
  const newFile = path.join(archiveDir, 'task.md');
  if (existsSync(newFile)) throw new CliError(tr(cfg.lang, `${toPosix(path.relative(root, newFile))} уже существует — под этим номером в архиве лежит другая задача`, `${toPosix(path.relative(root, newFile))} already exists — another archived task uses this number`));

  const oldRel = task.rel;
  const newRel = toPosix(path.relative(root, newFile));
  info(tr(cfg.lang, `переезд: ${oldRel} → ${newRel}${dry ? ' (--dry-run, ничего не пишу)' : ''}`, `move: ${oldRel} → ${newRel}${dry ? ' (--dry-run, no changes written)' : ''}`));

  if (!dry) {
    const how = moveFile(root, task.file, newFile);
    if (how === 'fs') warn(tr(cfg.lang, 'файл не в индексе git — перенесён без git mv', 'file is not tracked by git — moved without git mv'));
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
    writeText(resultFile, renderProjectTemplate(cfg, 'result.md', { id: task.id, date: today(), prefix: cfg.prefix }));
  }

  ok(tr(cfg.lang, `archive: ${task.id} — файлов с поправленными ссылками ${changed.length}`, `archive: ${task.id} — files with updated links ${changed.length}`));
  for (const rel of changed) info(rel);
  if (!dry) info(tr(cfg.lang, `допиши ${toPosix(path.relative(root, resultFile))}: исход и результат — ход approver'а, без него lint красный`, `complete ${toPosix(path.relative(root, resultFile))}: outcome and result belong to the approver; lint fails until then`));
  return 0;
}
