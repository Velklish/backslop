// Закрытие задачи: переезд в archive/<id>-<slug>/task.md с правкой ссылок в обе стороны по обходу
// `lint` и заготовкой result.md. Исход и результат в result.md — решение approver'а.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadProject } from './config.js';
import { renderProjectTemplate } from './templates.js';
import { findFlatTask, findTask, formatId, parseId, relocateTask, scanTasks, writeText } from './tasks.js';
import { CliError, git, gitCause, gitOrFail, info, ok, parseCommandArgs, today, toPosix, warn } from './util.js';
import { tr } from './i18n.js';

export async function run(argv, { cwd }) {
  const { values, positionals } = parseCommandArgs(argv, { 'dry-run': { type: 'boolean' }, range: { type: 'string' }, into: { type: 'string' } });
  const dry = values['dry-run'] === true;
  const project = loadProject(cwd);
  const { root, cfg, dirs } = project;
  if (!positionals[0]) throw new CliError(tr(cfg.lang, 'нужен номер задачи: backslop archive <N> [--dry-run] [--range <база>..HEAD] | backslop archive <N.k> --into <M>', 'task number is required: backslop archive <N> [--dry-run] [--range <base>..HEAD] | backslop archive <N.k> --into <M>'));
  const range = values.range === undefined ? null : values.range.trim();
  if (range !== null && !range) throw new CliError(tr(cfg.lang, '--range ждёт ревизии: <база>..HEAD', '--range expects revisions: <base>..HEAD'));
  if (range !== null && !range.includes('..')) throw new CliError(tr(cfg.lang, `--range ${range}: нужен диапазон <база>..HEAD — одна ревизия читает всю историю до неё`, `--range ${range}: expects a range <base>..HEAD — a single revision reads the whole history up to it`));
  const tasks = scanTasks(project);
  const id = parseId(positionals[0], cfg.prefix, cfg.lang);
  const task = findTask(tasks, id, cfg.lang) ?? findFlatTask(project, id);
  if (!task) throw new CliError(tr(cfg.lang, `задачи ${formatId(cfg.prefix, id.num, id.sub)} нет ни в одном каталоге статуса`, `task ${formatId(cfg.prefix, id.num, id.sub)} was not found in any status directory`));
  if (task.folded) throw new CliError(tr(cfg.lang, `${task.id} уже свёрнута в журнал: ${task.rel}`, `${task.id} is already folded into the journal: ${task.rel}`));
  if (task.status === 'archive') throw new CliError(tr(cfg.lang, `${task.id} уже в архиве: ${task.rel} — свернуть её в строку журнала: ${cfg.cli} fold ${task.id}`, `${task.id} is already archived: ${task.rel} — fold it into a journal line with ${cfg.cli} fold ${task.id}`));
  if (values.into !== undefined) return archiveInto(project, tasks, task, values.into, { dry, range });

  const dirName = `${task.id}-${task.slug}`;
  const archiveDir = path.join(dirs.archive, dirName);
  const newFile = path.join(archiveDir, 'task.md');
  if (existsSync(newFile)) throw new CliError(tr(cfg.lang, `${toPosix(path.relative(root, newFile))} уже существует — под этим номером в архиве лежит другая задача`, `${toPosix(path.relative(root, newFile))} already exists — another archived task uses this number`));

  const oldRel = task.rel;
  const newRel = toPosix(path.relative(root, newFile));
  info(tr(cfg.lang, `переезд: ${oldRel} → ${newRel}${dry ? ' (--dry-run, ничего не пишу)' : ''}`, `move: ${oldRel} → ${newRel}${dry ? ' (--dry-run, no changes written)' : ''}`));

  // Список считается до переезда: он только читает историю, а отказ по битому `--range`
  // после `relocateTask` оставил бы задачу переехавшей и повтор команды — с «уже в архиве».
  const touched = touchedDocs(root, cfg, task, range);

  const changed = relocateTask(project, task, newRel, { dry });

  const resultFile = path.join(archiveDir, 'result.md');
  if (!dry && !existsSync(resultFile)) {
    writeText(resultFile, renderProjectTemplate(cfg, 'result.md', { id: task.id, date: today(), prefix: cfg.prefix }));
  }

  ok(tr(cfg.lang, `archive: ${task.id} — файлов с поправленными ссылками ${changed.length}`, `archive: ${task.id} — files with updated links ${changed.length}`));
  for (const rel of changed) info(rel);

  if (touched.length) {
    info(tr(cfg.lang,
      `доки, которых коснулся ход ${task.id} — скопируй нужное в «Доки тем же ходом»:`,
      `documentation touched by ${task.id} — copy what belongs into “Documentation in the same pass”:`));
    for (const rel of touched) info(`  ${rel}`);
  }

  if (!dry) {
    info(tr(cfg.lang, `допиши ${toPosix(path.relative(root, resultFile))}: исход и результат — ход approver'а, без него lint красный`, `complete ${toPosix(path.relative(root, resultFile))}: outcome and result belong to the approver; lint fails until then`));
    info(tr(cfg.lang, `потом сверни каталог в строку журнала: ${cfg.cli} fold ${task.id}`, `then fold the directory into a journal line: ${cfg.cli} fold ${task.id}`));
  }
  return 0;
}

// Закрытие minor-записи пачкой: файл уезжает в подкаталог minor/ архива пачки, своего result.md
// не получает — исход по записям называет result.md пачки (ADR-022).
function archiveInto(project, tasks, task, rawInto, { dry, range }) {
  const { root, cfg } = project;
  if (range !== null) throw new CliError(tr(cfg.lang, '--range с --into не сочетается: доки хода считает пачка', '--range cannot be combined with --into: the batch accounts for the touched docs'));
  if (task.status !== 'minor') throw new CliError(tr(cfg.lang, `${task.id} не в minor/ (${task.rel}): --into закрывает пачкой только minor-записи; слияние карточек — archive N с исходом «слита в …» в result.md`, `${task.id} is not in minor/ (${task.rel}): --into closes minor entries by batch only; merge cards with archive N and a “merged into …” outcome in result.md`));
  const intoId = parseId(rawInto, cfg.prefix, cfg.lang);
  const batch = findTask(tasks, intoId, cfg.lang);
  if (!batch) throw new CliError(tr(cfg.lang, `пачки ${formatId(cfg.prefix, intoId.num, intoId.sub)} нет ни в одном каталоге статуса и в архиве`, `batch ${formatId(cfg.prefix, intoId.num, intoId.sub)} was not found in any status directory or archive`));
  if (batch.status === 'minor' || batch.into) throw new CliError(tr(cfg.lang, `${batch.id} сама minor-запись, пачкой быть не может`, `${batch.id} is a minor entry itself and cannot be a batch`));
  // Каталог незакрытой пачки в архиве читался бы вторым файлом её номера: пачка закрывается первой.
  if (batch.status !== 'archive') throw new CliError(tr(cfg.lang, `пачка ${batch.id} ещё в ${batch.status}/ — сначала закрой её: backslop archive ${batch.id}`, `batch ${batch.id} is still in ${batch.status}/ — close it first: backslop archive ${batch.id}`));
  // Свёрнутая пачка каталога в дереве не имеет, и класть запись некуда: записи закрываются до
  // свёртки пачки и уходят в журнал вместе с ней.
  if (batch.folded) throw new CliError(tr(cfg.lang, `пачка ${batch.id} свёрнута в журнал (${batch.rel}) — каталога для записи нет: minor-записи закрываются до свёртки пачки`, `batch ${batch.id} is folded into the journal (${batch.rel}) — there is no directory for the entry: minor entries are closed before the batch is folded`));
  const newFile = path.join(batch.dir, 'minor', path.basename(task.file));
  if (existsSync(newFile)) throw new CliError(tr(cfg.lang, `${toPosix(path.relative(root, newFile))} уже существует`, `${toPosix(path.relative(root, newFile))} already exists`));
  const newRel = toPosix(path.relative(root, newFile));
  info(tr(cfg.lang, `переезд: ${task.rel} → ${newRel}${dry ? ' (--dry-run, ничего не пишу)' : ''}`, `move: ${task.rel} → ${newRel}${dry ? ' (--dry-run, no changes written)' : ''}`));
  const changed = relocateTask(project, task, newRel, { dry });
  ok(tr(cfg.lang, `archive: ${task.id} → пачка ${batch.id} — файлов с поправленными ссылками ${changed.length}`, `archive: ${task.id} → batch ${batch.id} — files with updated links ${changed.length}`));
  for (const rel of changed) info(rel);
  if (!dry) info(tr(cfg.lang, `исход ${task.id} назови строкой в result.md пачки ${batch.id}; своего result.md у записи нет`, `name the outcome of ${task.id} in the result.md of batch ${batch.id}; the entry has no result.md of its own`));
  return 0;
}

// Механическая половина «Доки тем же ходом»: доки, которых коснулись коммиты `--range` и коммиты
// с номером задачи в заголовке, без карточек трекера (docs/reference/02-cli.md, `archive`).
function touchedDocs(root, cfg, task, range) {
  if (git(root, ['rev-parse', '--git-dir']).status !== 0) {
    // Без репозитория считать нечего. Молчим, только когда список никто не просил: заданный
    // `--range` без git — отказ, иначе флаг игнорируется незаметно.
    if (range) throw new CliError(tr(cfg.lang, `--range ${range}: репозитория git нет — считать историю нечем`, `--range ${range}: no git repository — there is no history to read`));
    return [];
  }
  const files = new Set();
  const pathspec = [cfg.docs, 'CHANGELOG.md', `:(exclude)${cfg.docs}/backlog`, `:(exclude)${cfg.docs}/archive`];
  // Префикс подкаталога срезается сам, а не `--relative`: combined diff (`--cc`) его не учитывает.
  // Отказ тут недостижим, но проглоченный вернул бы пути от toplevel молча — поэтому громкий.
  const prefix = gitOrFail(root, ['rev-parse', '--show-prefix']).trim();
  // Merge-коммит отдаёт файлы только с `--cc` — правку самого слияния; `-m` тащил бы всё с точки
  // ветвления, `--first-parent` прятал бы коммиты ветки от выборки по заголовку.
  const collect = (args, subjectRe = null) => {
    // `%x01` отделяет заголовок от файлов коммита; без `quotePath=false` не-ASCII путь приехал бы
    // восьмеричными в кавычках, и префикс не срезался бы.
    const r = git(root, ['-c', 'core.quotePath=false', 'log', '--format=%x01%s', '--name-only', '--cc', ...args, '--', ...pathspec]);
    if (r.status !== 0) return r;
    let keep = subjectRe === null;
    for (const line of r.stdout.split('\n')) {
      if (line.startsWith('\x01')) {
        keep = subjectRe === null || subjectRe.test(line.slice(1));
        continue;
      }
      const raw = line.trim();
      const rel = prefix && raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
      if (rel && keep) files.add(rel);
    }
    return r;
  };
  if (range) {
    // Неразрешимая ревизия — отказ словами git: пустой список читался бы как «доки не
    // трогали», а это неправда.
    const r = collect([range]);
    if (r.status !== 0) throw new CliError(tr(cfg.lang, `--range ${range}: git log: ${gitCause(r, cfg.lang)}`, `--range ${range}: git log: ${gitCause(r, cfg.lang)}`));
  }
  // Номер сравнивается числом (`BS-7:` относится к `BS-007-…`). `--grep` — только предфильтр,
  // решает первая строка: squash тащит заголовки схлопнутых в тело.
  const digits = (n) => `0*${n}`;
  const subjectRe = new RegExp(`^${cfg.prefix}-${digits(task.num)}${task.sub === null ? '' : `\\.${digits(task.sub)}`}:`);
  const byPrefix = collect([`--grep=${cfg.prefix}-`, 'HEAD'], subjectRe);
  // Репозиторий без коммитов — законный пустой список; всё прочее прячет часть выборки.
  if (byPrefix.status !== 0 && git(root, ['rev-parse', '--verify', 'HEAD']).status === 0) {
    warn(tr(cfg.lang, `коммиты с номером задачи не прочитаны: git log: ${gitCause(byPrefix, cfg.lang)}`, `commits naming the task were not read: git log: ${gitCause(byPrefix, cfg.lang)}`));
  }
  return [...files].sort();
}
