// Свёртка закрытой задачи в строку журнала: каталог уходит из дерева, тело остаётся в git — у
// `fold N` заготовкой сообщения в stdout, у `fold` без номера ревизией из истории (ADR-026).
import { existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { loadProject } from './config.js';
import { formatId } from './ids.js';
import { repoPrefix, rewriteFoldedLinks } from './links.js';
import { appendLogLines, bodySection, dateFromResult, formatLogLine, hasNamedOutcome, logAnchor, logFile, outcomeFromResult, outcomeWordMissing, renderOutcome } from './log.js';
import { repoMarkdown } from './mdwalk.js';
import { renderProjectTemplate } from './templates.js';
import { eolOf, findTask, hasResultTodo, parseId, readTitle, scanTasks } from './tasks.js';
import { CliError, DATE_RE, bad, git, gitCause, insideRepo, isTracked, parseCommandArgs, readText, toPosix, today, warn, writeText } from './util.js';
import { tr } from './i18n.js';

export async function run(argv, { cwd }) {
  const { values, positionals } = parseCommandArgs(argv, { 'dry-run': { type: 'boolean' }, 'older-than': { type: 'string' }, 'embed-missing': { type: 'boolean' } });
  const dry = values['dry-run'] === true;
  const embed = values['embed-missing'] === true;
  const project = loadProject(cwd);
  const { root, cfg, dirs } = project;
  const olderThan = values['older-than'] === undefined ? null : values['older-than'].trim();
  if (olderThan !== null && !DATE_RE.test(olderThan)) {
    throw new CliError(tr(cfg.lang, `--older-than ждёт дату ГГГГ-ММ-ДД, а не «${values['older-than']}»`, `--older-than expects a YYYY-MM-DD date, not “${values['older-than']}”`));
  }
  if (positionals[0] !== undefined && olderThan !== null) {
    throw new CliError(tr(cfg.lang, '--older-than с номером задачи не сочетается: отбор по возрасту — про накопленное, а не про названную задачу', '--older-than cannot be combined with a task number: the age filter selects accumulated entries, not a named task'));
  }
  if (positionals[0] !== undefined && embed) {
    throw new CliError(tr(cfg.lang, '--embed-missing с номером задачи не сочетается: одиночная свёртка кладёт тело в заготовку сообщения всегда', '--embed-missing cannot be combined with a task number: folding a single task always puts the body into the message draft'));
  }
  if (positionals.length > 1) {
    throw new CliError(tr(cfg.lang, 'номер задачи один: массовая свёртка — та же команда без номера', 'a single task number is expected: bulk folding is the same command without a number'));
  }
  const single = positionals[0] !== undefined;
  const tasks = scanTasks(project);
  const picked = single ? [pickOne(project, tasks, positionals[0])] : pickAll(project, tasks, olderThan);
  if (!picked.length) {
    warn(tr(cfg.lang, 'сворачивать нечего: несвёрнутых каталогов в архиве нет', 'nothing to fold: the archive has no unfolded directories'));
    return 0;
  }

  // Всё, что видно до записи, проверяется до первой записи: половина свёрнутого архива
  // оставила бы дерево в состоянии, которое ниоткуда не прочитать.
  const entries = picked.map((t) => prepare(project, t, { single, embed, tasks }));
  // Журнал массовой свёртки идёт по датам закрытия, стоящим в строках; равные даты — по номеру.
  entries.sort((a, b) => a.date.localeCompare(b.date) || a.task.num - b.task.num || (a.task.sub ?? 0) - (b.task.sub ?? 0));

  // Тело вне истории массовая форма выбрасывает вслух (ADR-026);
  // отбор — по причине `ABSENT`: прочие причины пустой ревизии — отказы `prepare`.
  const missing = single ? [] : entries.filter((e) => e.why === ABSENT);
  for (const e of missing) {
    if (embed) continue;
    warn(tr(cfg.lang,
      `${e.dirRel}: тела нет в истории git — текст уходит вместе с каталогом; сохранить его в заготовке сообщения коммита мог бы ${cfg.cli} fold --embed-missing`,
      `${e.dirRel}: the body is not in git history — the text goes with the directory; ${cfg.cli} fold --embed-missing would have kept it in the commit message draft`));
  }

  const embedded = embed ? missing : [];
  process.stdout.write(single ? draftOne(project, entries[0]) : draftMany(project, entries, embedded));

  if (dry) {
    warn(tr(cfg.lang, `--dry-run: свернулось бы задач ${entries.length}, ничего не записано`, `--dry-run: ${entries.length} tasks would be folded, nothing was written`));
    return 0;
  }

  // Каталоги уходят первыми: отказ `git rm` на середине оставил бы журнал с записью о задаче,
  // которая всё ещё лежит в дереве, — состояние, которого ниоткуда не прочитать.
  const prefix = repoPrefix(root, cfg.lang);
  removeDirs(project, entries);

  const lines = entries.flatMap((e) => e.lines);
  const log = logFile(dirs);
  if (!existsSync(log)) writeText(log, renderProjectTemplate(cfg, 'docs/archive/LOG.md', { cli: cfg.cli, prefix: cfg.prefix }));
  const logText = readText(log);
  writeText(log, appendLogLines(logText, lines, eolOf(logText)));

  const { changed, missed } = rewriteLinks(project, entries, prefix);

  warn(tr(cfg.lang,
    `свёрнуто задач ${entries.length}, строк в ${toPosix(path.relative(root, log))} дописано ${lines.length}, файлов с поправленными ссылками ${changed.length}, ссылок в свёрнутое без переписи ${missed.length}`,
    `folded tasks ${entries.length}, lines appended to ${toPosix(path.relative(root, log))} ${lines.length}, files with updated links ${changed.length}, links into the folded left unrewritten ${missed.length}`));
  for (const rel of changed) warn(`  ${rel}`);
  if (missed.length) {
    warn(tr(cfg.lang,
      'ссылки ведут в свёрнутый каталог мимо task.md, result.md и записей пачки — вести их не на что, поправь руками',
      'these links lead into a folded directory past task.md, result.md and batch entries — there is nothing to point them at; fix them by hand'));
    for (const m of missed) warn(`  ${m}`);
  }
  // Строка с ревизией отдаёт тело `show N`, и заготовка — копия;
  // строке с `—` она единственное хранилище.
  warn(single ? draftNoteOne(cfg, entries[0]) : draftNoteMany(cfg, entries, embedded, embed ? [] : missing));
  return 0;
}

function draftNoteOne(cfg, entry) {
  return entry.rev !== null
    ? tr(cfg.lang,
      `заготовка сообщения коммита — в stdout; коммитить её не обязательно: тело уже в истории — ревизия записана в строку журнала, и ${cfg.cli} show ${entry.task.id} достаёт его оттуда. Squash или reset --soft через эту ревизию выбросит её, и тогда без заготовки тело задачи потеряется. ${verbatimNote(cfg)}`,
      `the commit message draft is on stdout; committing it is optional: the body is already in history — the revision is recorded in the journal line, and ${cfg.cli} show ${entry.task.id} reads it from there. A squash or reset --soft across that revision drops it, and then without the draft the task body is lost. ${verbatimNote(cfg)}`)
    : tr(cfg.lang,
      `заготовка сообщения коммита — в stdout: закоммить свёртку вместе с ней, иначе тело задачи потеряется. ${verbatimNote(cfg)}`,
      `the commit message draft is on stdout: commit the fold together with it, otherwise the task body is lost. ${verbatimNote(cfg)}`);
}

function verbatimNote(cfg) {
  return tr(cfg.lang,
    'Коммит с ней — git commit --cleanup=verbatim -F <файл заготовки>: так git не чистит сообщение',
    'Commit it with git commit --cleanup=verbatim -F <draft file>, so git leaves the message as written');
}

// Тела массовая заготовка несёт только с `--embed-missing`, и только тогда требует коммита.
function draftNoteMany(cfg, entries, embedded, dropped) {
  if (embedded.length) {
    return tr(cfg.lang,
      `заготовка сообщения коммита — в stdout, и в ней тела задач, которых нет в истории: закоммить свёртку вместе с ней, иначе эти тела потеряются. ${verbatimNote(cfg)}`,
      `the commit message draft is on stdout and carries the bodies of tasks that are not in history: commit the fold together with it, otherwise those bodies are lost. ${verbatimNote(cfg)}`);
  }
  if (!dropped.length) {
    return tr(cfg.lang,
      `заготовка сообщения коммита — в stdout, тел задач в ней нет: строка журнала называет ревизию, в которой лежит тело, и ${cfg.cli} show N достаёт его оттуда`,
      `the commit message draft is on stdout and carries no task bodies: the journal line names the revision that holds the body, and ${cfg.cli} show N reads it from there`);
  }
  const rest = entries.length > dropped.length
    ? tr(cfg.lang, `; у строк с ревизией тело достаёт ${cfg.cli} show N`, `; for lines with a revision ${cfg.cli} show N reads the body`)
    : '';
  return tr(cfg.lang,
    `заготовка сообщения коммита — в stdout, тел задач в ней нет: у строк с «—» (задач ${dropped.length}) тело ушло вместе с каталогом и не сохранено ни в заготовке, ни в истории${rest}`,
    `the commit message draft is on stdout and carries no task bodies: the lines with “—” (${dropped.length} tasks) lost their bodies with the directories, kept neither in the draft nor in history${rest}`);
}

// --- отбор ---------------------------------------------------------------------------------

function pickOne({ cfg }, tasks, raw) {
  const id = parseId(raw, cfg.prefix, cfg.lang);
  const task = findTask(tasks, id, cfg.lang);
  if (!task) throw new CliError(tr(cfg.lang, `задачи ${formatId(cfg.prefix, id.num, id.sub)} нет ни в одном каталоге статуса и в архиве`, `task ${formatId(cfg.prefix, id.num, id.sub)} was not found in any status directory or the archive`));
  if (task.folded) throw new CliError(tr(cfg.lang, `${task.id} уже свёрнута в журнал: ${task.rel}`, `${task.id} is already folded into the journal: ${task.rel}`));
  if (task.status !== 'archive') throw new CliError(tr(cfg.lang, `${task.id} лежит в ${task.status}/ — сворачивается закрытая задача: сначала ${cfg.cli} archive ${task.id}`, `${task.id} sits in ${task.status}/ — folding closes an archived task: run ${cfg.cli} archive ${task.id} first`));
  if (task.into) throw new CliError(tr(cfg.lang, `${task.id} — запись пачки ${task.into}: она сворачивается вместе с пачкой`, `${task.id} is an entry of batch ${task.into}: it folds together with its batch`));
  return task;
}

function pickAll(project, tasks, olderThan) {
  return tasks
    .filter((t) => t.status === 'archive' && !t.folded && !t.into)
    .filter((t) => olderThan === null || closedAt(project, tasks, t) < olderThan);
}

// Дата закрытия — та же, что встанет в строку: `result.md`, иначе коммит ревизии тела; без ревизии
// задача считается закрытой сегодня, и `--older-than` её не берёт: запись с неизвестным возрастом.
function closedAt({ root, cfg }, tasks, task) {
  const result = path.join(task.dir, 'result.md');
  const own = existsSync(result) ? dateFromResult(readText(result)) : null;
  if (own) return own;
  const dirRel = toPosix(path.relative(root, task.dir));
  const minors = batchEntries(tasks, task).map((e) => e.rel);
  const { rev } = bodyRev(root, dirRel, [`${dirRel}/task.md`, `${dirRel}/result.md`, ...minors], cfg.lang);
  return (rev && commitDate(root, rev)) ?? today();
}

function commitDate(root, rev) {
  const r = git(root, ['log', '-1', '--format=%cs', rev]);
  return r.status === 0 && DATE_RE.test(r.stdout.trim()) ? r.stdout.trim() : null;
}

// --- подготовка записи -----------------------------------------------------------------------

function prepare(project, task, { single, embed, tasks }) {
  const { root, cfg, dirs } = project;
  const dirRel = toPosix(path.relative(root, task.dir));
  const taskFile = path.join(task.dir, 'task.md');
  const resultFile = path.join(task.dir, 'result.md');
  if (!existsSync(taskFile)) throw new CliError(tr(cfg.lang, `${dirRel}: нет task.md — постановки, которая уехала бы в git`, `${dirRel}: task.md is missing — there is no definition to send into git`));
  if (!existsSync(resultFile)) throw new CliError(tr(cfg.lang, `${dirRel}: нет result.md — результат дописывает approver, без него свёртка стирает задачу без исхода`, `${dirRel}: result.md is missing — the approver writes the result; without it folding erases the task without an outcome`));
  const resultText = readText(resultFile);
  if (!resultText.trim()) throw new CliError(tr(cfg.lang, `${dirRel}/result.md пуст: свёртка уносит тело в git, и пустой результат уносится вместе с ним`, `${dirRel}/result.md is empty: folding carries the body into git, and an empty result goes with it`));
  if (hasResultTodo(resultText)) throw new CliError(tr(cfg.lang, `${dirRel}/result.md остался заглушкой: в нём [TODO] — допиши исход и проверки`, `${dirRel}/result.md is still a stub: it contains [TODO] — write the outcome and the verification`));
  // Одиночная свёртка — ход приёмки, и она идёт раньше lint:
  // слово исхода требуется здесь, как у гейта 5.
  if (single && !hasNamedOutcome(resultText, cfg.prefix)) throw new CliError(`${dirRel}/${outcomeWordMissing(cfg.prefix, cfg.lang)}`);

  const taskText = readText(taskFile);
  const minors = batchEntries(tasks, task);
  const { rev, why, detail, at, cause, flag } = bodyRev(root, dirRel, [`${dirRel}/task.md`, `${dirRel}/result.md`, ...minors.map((e) => e.rel)], cfg.lang);
  // Массовой форме хранилище тел — только история: нет git — отказ до первой записи, а не
  // удаление. Удалением отвечают лишь на доказанное отсутствие тела (`ABSENT`).
  if (!single && why === NO_GIT) {
    throw new CliError(tr(cfg.lang,
      `${dirRel}: репозитория git нет — в историю посмотреть нечем${detail ? ` (${detail})` : ''}, а массовая свёртка тел не печатает: удалять каталог было бы нечем страховать. Заведи репозиторий или сворачивай по одной: ${cfg.cli} fold ${task.id}`,
      `${dirRel}: there is no git repository — history cannot be read${detail ? ` (${detail})` : ''}, and bulk folding does not print bodies: deleting the directory would have no backing. Create a repository, or fold one task at a time: ${cfg.cli} fold ${task.id}`));
  }
  if (!single && why === DIRTY) {
    throw new CliError(tr(cfg.lang,
      `${dirRel}: каталог не закоммичен (${detail}) — в истории лежит другая редакция, и записанная ревизия обещала бы текст, которого в ней нет. Закоммить каталог и повтори, либо сверни задачу поодиночке: ${cfg.cli} fold ${task.id}`,
      `${dirRel}: the directory is not committed (${detail}) — history holds a different revision, and the recorded revision would promise text it does not contain. Commit the directory and retry, or fold this task alone: ${cfg.cli} fold ${task.id}`));
  }
  if (!single && why === DIVERGED && cause) {
    throw new CliError(tr(cfg.lang,
      `${detail}: файлы каталога не сверить с ревизией ${at.slice(0, 10)} — git hash-object: ${cause}. Удалять каталог, не сверив тело с историей, нечем страховать: верни файлы в рабочее дерево и повтори, либо сверни задачу поодиночке: ${cfg.cli} fold ${task.id}`,
      `${detail}: the directory files cannot be checked against revision ${at.slice(0, 10)} — git hash-object: ${cause}. Deleting the directory without checking the body against history has no backing: restore the files in the working tree and retry, or fold this task alone: ${cfg.cli} fold ${task.id}`));
  }
  if (!single && why === DIVERGED && flag) {
    throw new CliError(tr(cfg.lang,
      `${detail}: файл расходится со своей редакцией в ${at.slice(0, 10)}, хотя git status считает каталог чистым (${flag}) — записанная ревизия обещала бы текст, которого в ней нет. Закоммить файл и повтори, либо сверни задачу поодиночке: ${cfg.cli} fold ${task.id}`,
      `${detail}: the file differs from its revision ${at.slice(0, 10)} although git status reports the directory clean (${flag}) — the recorded revision would promise text it does not contain. Commit the file and retry, or fold this task alone: ${cfg.cli} fold ${task.id}`));
  }
  if (!single && why === DIVERGED) {
    const crlf = autocrlfOn(root);
    throw new CliError(tr(cfg.lang,
      `${detail}: файл расходится со своей редакцией в ${at.slice(0, 10)} — записанная ревизия обещала бы текст, которого в ней нет. ${crlf ? `Похоже на переводы строк при core.autocrlf: нормализуй их — git add --renormalize ${dirRel} и коммит — и повтори` : 'Закоммить файл и повтори'}, либо сверни задачу поодиночке: ${cfg.cli} fold ${task.id}`,
      `${detail}: the file differs from its revision ${at.slice(0, 10)} — the recorded revision would promise text it does not contain. ${crlf ? `This looks like line endings under core.autocrlf: normalise them with git add --renormalize ${dirRel}, commit, and retry` : 'Commit the file and retry'}, or fold this task alone: ${cfg.cli} fold ${task.id}`));
  }
  // An attachment has no place in the draft: without its own copy in HEAD, folding would delete it.
  if (single || (embed && why === ABSENT)) {
    const unsaved = unsavedAttachments(root, attachmentsOf(root, task.dir, dirRel, minors), cfg.lang);
    if (unsaved.length) {
      throw new CliError(tr(cfg.lang,
        `${dirRel}: вложения не сохранены в истории git, и свёртка удалила бы их вместе с каталогом: ${unsaved.join(', ')}. Закоммить каталог сначала или убери эти файлы`,
        `${dirRel}: attachments are not saved in git history, and folding would delete them with the directory: ${unsaved.join(', ')}. Commit the directory first, or remove the files`));
    }
  }
  const title = readTitle(taskText)?.title ?? null;
  const date = dateFromResult(resultText) ?? (rev && commitDate(root, rev)) ?? today();
  const lines = [formatLogLine({
    id: task.id,
    slug: task.slug,
    date,
    outcome: outcomeFromResult(resultText, cfg.prefix, cfg.lang),
    commit: rev === null ? null : rev.slice(0, 10),
    title,
  })];

  // Пути, которые исчезают, и строка журнала, на которую они теперь ведут: сам каталог и оба
  // его файла — на строку задачи, файл записи пачки — на строку этой записи.
  const targets = [[dirRel, task.id], [`${dirRel}/task.md`, task.id], [`${dirRel}/result.md`, task.id]];
  const bodies = [[`${dirRel}/task.md`, taskText], [`${dirRel}/result.md`, resultText]];
  // Записи пачки уходят вместе с ней: их исход назван результатом пачки, и отдельной строки
  // о нём взять неоткуда — в журнале стоит сама принадлежность пачке.
  for (const entry of minors) {
    const text = readText(entry.file);
    bodies.push([entry.rel, text]);
    targets.push([entry.rel, entry.id]);
    lines.push(formatLogLine({
      id: entry.id,
      slug: entry.slug,
      date,
      outcome: renderOutcome('batched', task.id, cfg.lang),
      commit: rev === null ? null : rev.slice(0, 10),
      title: readTitle(text)?.title ?? null,
    }));
  }
  return { task, dirRel, dir: task.dir, title, date, rev, why, lines, bodies, targets, logRel: toPosix(path.relative(root, logFile(dirs))) };
}

// Batch entries as `scanTasks` reads them: files only, in numeric order; gate 5 names the rest.
function batchEntries(tasks, task) {
  return tasks.filter((t) => t.into === task.id && t.dir === task.dir).map((t) => ({ id: t.id, slug: t.slug, file: t.file, rel: t.rel }));
}

// Every file of the task directory but task.md, result.md and batch entries, recursively. A file
// git ignores is left out, unless its rules cover the whole directory, staged or not (02-cli.md).
function attachmentsOf(root, dir, dirRel, minors) {
  const body = new Set(['task.md', 'result.md', ...minors.map((e) => `minor/${path.basename(e.file)}`)]);
  const walk = (sub) => readdirSync(path.join(dir, sub), { withFileTypes: true }).flatMap((e) => {
    const rel = sub ? `${sub}/${e.name}` : e.name;
    return e.isDirectory() ? walk(rel) : [rel];
  });
  const rels = walk('').filter((rel) => !body.has(rel)).map((rel) => `${dirRel}/${rel}`);
  if (!rels.length || git(root, ['check-ignore', '-q', '--no-index', '--', `${dirRel}/`]).status !== 1) return rels;
  const ignored = git(root, ['check-ignore', '--stdin', '-z'], { input: rels.join('\0') });
  const skip = new Set(ignored.status === 0 ? ignored.stdout.split('\0') : []);
  return rels.filter((rel) => !skip.has(rel));
}

// Attachments HEAD does not hold as they are on disk.
function unsavedAttachments(root, rels, lang) {
  if (!rels.length) return [];
  const tree = git(root, ['ls-tree', '-r', '-z', 'HEAD', '--', ...rels]);
  if (tree.status !== 0) return rels;
  const blobs = blobMap(tree.stdout);
  const kept = rels.filter((rel) => blobs.has(rel));
  const { moved, cause } = kept.length ? drift(root, 'HEAD', blobs, kept, lang) : { moved: [] };
  if (cause) return rels;
  const saved = new Set(kept.filter((rel) => !moved.includes(rel)));
  return rels.filter((rel) => !saved.has(rel));
}

// Ревизия тела — последний коммит, тронувший каталог. Умолчание «удалить» — только для `ABSENT`
// ([ADR-026](../docs/adr/adr-026-archive-folds-to-log.md)): прочие причины — «не смогли убедиться».
const NO_GIT = 'no-git';
const DIRTY = 'dirty';
const ABSENT = 'absent';
const DIVERGED = 'diverged';

function bodyRev(root, dirRel, bodyPaths, lang) {
  const dirty = git(root, ['status', '--porcelain', '--untracked-files=all', '--', dirRel]);
  if (dirty.status !== 0) return { rev: null, why: NO_GIT, detail: gitCause(dirty, lang) };
  if (dirty.stdout.trim()) return { rev: null, why: DIRTY, detail: dirty.stdout.trim().split('\n').slice(0, 4).join('; ') };
  const log = git(root, ['log', '-1', '--format=%H', '--', `${dirRel}/`]);
  if (log.status !== 0) return { rev: null, why: NO_GIT, detail: gitCause(log, lang) };
  const rev = log.stdout.trim();
  if (!rev) return { rev: null, why: ABSENT, detail: '' };
  // Пути `ls-tree` — от текущего каталога, в тех же координатах, что `dirRel`.
  const tree = git(root, ['ls-tree', '-r', '-z', rev, '--', `${dirRel}/`]);
  if (tree.status !== 0) return { rev: null, why: NO_GIT, detail: gitCause(tree, lang) };
  const blobs = blobMap(tree.stdout);
  if (bodyPaths.some((rel) => !blobs.has(rel))) return { rev: null, why: ABSENT, detail: '' };
  const { moved, flag, cause } = drift(root, rev, blobs, [...blobs.keys()], lang);
  if (cause) return { rev: null, why: DIVERGED, detail: dirRel, at: rev, cause };
  return moved.length ? { rev: null, why: DIVERGED, detail: moved[0], at: rev, cause: null, flag } : { rev, why: null, detail: '' };
}

function blobMap(lsTree) {
  return new Map(lsTree.split('\0').filter(Boolean).map((l) => [l.slice(l.indexOf('\t') + 1), l.split(/\s/)[2]]));
}

// `hash-object` cleans a file as `git add` does, yet a CRLF blob under core.autocrlf hashes apart
// while git calls it clean: an unflagged mismatch asks `git diff --quiet <rev>` for a verdict.
function drift(root, rev, blobs, rels, lang) {
  const disk = git(root, ['hash-object', '--', ...rels]);
  if (disk.status !== 0) return { moved: [], flag: null, cause: gitCause(disk, lang).split('\n')[0] };
  const ids = disk.stdout.trim().split('\n');
  const moved = [];
  let flag = null;
  rels.forEach((rel, i) => {
    if (ids[i] === blobs.get(rel)) return;
    const own = indexFlag(root, rel);
    if (!own && git(root, ['diff', '--quiet', rev, '--', rel]).status === 0) return;
    if (!moved.length) flag = own;
    moved.push(rel);
  });
  return { moved, flag, cause: null };
}

// core.autocrlf is `input` or a boolean. `--type=bool` fails on an `input` in a lower scope, so the
// value in force is converted alone; a bare key reads empty and takes the full check.
function autocrlfOn(root) {
  const raw = git(root, ['config', '--get', 'core.autocrlf']).stdout.trim();
  if (raw.toLowerCase() === 'input') return true;
  const probe = raw ? ['-c', `backslop.autocrlf=${raw}`, 'config', '--type=bool', '--get', 'backslop.autocrlf'] : ['config', '--type=bool', '--get', 'core.autocrlf'];
  return git(root, probe).stdout.trim() === 'true';
}

// `git ls-files -v`: a lowercase tag is assume-unchanged, `S` is skip-worktree.
function indexFlag(root, rel) {
  const tag = git(root, ['ls-files', '-v', '--', rel]).stdout.charAt(0);
  if (tag === 'S') return 'skip-worktree';
  return tag && tag !== tag.toUpperCase() ? 'assume-unchanged' : null;
}

// --- заготовка сообщения ---------------------------------------------------------------------

function draftOne({ cfg }, entry) {
  const anchor = `${entry.logRel}#${logAnchor(entry.task.id)}`;
  const head = `${entry.task.id}: ${entry.title ?? entry.task.slug}`;
  const intro = entry.rev === null
    ? tr(cfg.lang,
      `Свёрнута в строку ${anchor}. Тело задачи — ниже: в дереве его больше нет, и это сообщение — его единственное хранилище.`,
      `Folded into the ${anchor} line. The task body is below: it is no longer in the tree, and this message is its only storage.`)
    : tr(cfg.lang,
      `Свёрнута в строку ${anchor}. Тело задачи — ниже, копией: строка журнала называет ревизию ${entry.rev.slice(0, 10)}, и ${cfg.cli} show ${entry.task.id} достаёт его оттуда.`,
      `Folded into the ${anchor} line. The task body is below as a copy: the journal line names revision ${entry.rev.slice(0, 10)}, and ${cfg.cli} show ${entry.task.id} reads it from there.`);
  return [head, '', intro, '', ...entry.bodies.flatMap(([rel, text]) => bodySection(rel, text))].join('\n');
}

// Заготовка массовой свёртки перечисляет задачи и ревизии тел; целиком в сообщение идут только
// тела, которых в истории нет, и только с `--embed-missing`.
function draftMany({ cfg }, entries, embedded) {
  const head = tr(cfg.lang, `свёртка архива в журнал: задач ${entries.length}`, `fold the archive into the journal: ${entries.length} tasks`);
  const bare = entries.filter((e) => e.rev === null).map((e) => e.task.id).join(', ');
  const intro = !bare
    ? tr(cfg.lang,
      `Каталоги задач уходят из дерева, номера и исходы остаются строками журнала. Тело задачи лежит в истории — строка журнала называет ревизию, из которой его достаёт ${cfg.cli} show N.`,
      `Task directories leave the tree; numbers and outcomes remain as journal lines. A task body sits in history — its journal line names the revision that ${cfg.cli} show N reads it from.`)
    : tr(cfg.lang,
      `Каталоги задач уходят из дерева, номера и исходы остаются строками журнала. Строка с ревизией называет коммит, из которого тело достаёт ${cfg.cli} show N; у строк с «—» (${bare}) ревизии нет: ${embedded.length ? `их тела — ниже, в этом сообщении, и ${cfg.cli} show N находит их здесь` : 'их тела ушли вместе с каталогами и не сохранены ни в этом сообщении, ни в истории'}.`,
      `Task directories leave the tree; numbers and outcomes remain as journal lines. A line with a revision names the commit that ${cfg.cli} show N reads the body from; the lines with “—” (${bare}) have none: ${embedded.length ? `their bodies are below, in this message, and ${cfg.cli} show N finds them here` : 'their bodies left with the directories and are kept neither in this message nor in history'}.`);
  const list = entries.map((e) => `- ${e.dirRel} — ${e.rev === null ? '—' : e.rev.slice(0, 10)}`);
  const tail = embedded.length
    ? ['', tr(cfg.lang,
      `Тела задач ниже в истории не лежат: это сообщение — их единственное хранилище (${cfg.cli} fold --embed-missing).`,
      `The task bodies below are not in history: this message is their only storage (${cfg.cli} fold --embed-missing).`),
    '', ...embedded.flatMap((e) => e.bodies.flatMap(([rel, text]) => bodySection(rel, text)))]
    : [];
  return [head, '', intro, '', ...list, ...tail, ''].join('\n');
}

// --- запись ------------------------------------------------------------------------------------

// Входящие ссылки ведут на строку журнала целиком — вместе с якорем: якорь исчезнувшего файла
// (`#контекст`) на ней не значит ничего, а гейт ссылок якоря не проверяет вовсе.
function rewriteLinks(project, entries, prefix) {
  const { root } = project;
  const byPath = new Map();
  for (const e of entries) {
    for (const [rel, id] of e.targets) byPath.set(rel, { logRel: e.logRel, id });
  }
  const gone = entries.map((e) => e.dirRel);
  const inGone = (rel) => gone.some((dir) => rel === dir || rel.startsWith(`${dir}/`));
  const changed = [];
  const missed = [];
  for (const [rel, abs] of repoMarkdown(root)) {
    // Файлы самих сворачиваемых каталогов уезжают вместе с ними: править в них нечего.
    if (inGone(rel)) continue;
    const text = readText(abs);
    const next = rewriteFoldedLinks(text, path.posix.dirname(rel), (target, href) => {
      const hit = byPath.get(target);
      if (hit) return { path: hit.logRel, anchor: logAnchor(hit.id) };
      if (inGone(target)) missed.push(`${rel}: ${href}`);
      return null;
    }, prefix);
    if (next === text) continue;
    changed.push(rel);
    writeText(abs, next);
  }
  return { changed: changed.sort(), missed: missed.sort() };
}

// `git rm -f` одним вызовом — только на отслеживаемые каталоги: один неотслеживаемый уронил бы весь
// вызов. `-f` — для task.md, который `archive N` поставил в индекс переименованием мимо HEAD.
function removeDirs({ root, cfg }, entries) {
  const tracked = [];
  const repo = insideRepo(root, cfg.lang);
  for (const e of entries) {
    if (repo && isTracked(root, e.dirRel, cfg.lang)) tracked.push(e.dirRel);
  }
  if (tracked.length) {
    const r = git(root, ['rm', '-r', '-q', '-f', '--', ...tracked]);
    if (r.status !== 0) {
      bad(tr(cfg.lang, `git rm отказал: ${gitCause(r, cfg.lang)}`, `git rm failed: ${gitCause(r, cfg.lang)}`));
      throw new CliError(tr(cfg.lang, 'каталоги задач не удалены — журнал не тронут, разбери дерево и повтори', 'task directories were not removed — the journal is untouched; sort the tree out and retry'));
    }
  }
  // Каталог, переживший `git rm`, несёт неотслеживаемое: `result.md` только что заведённой
  // задачи в индекс не попадал, и без этого прохода каталог остался бы с одним файлом внутри.
  const trackedSet = new Set(tracked);
  for (const e of entries) {
    if (!existsSync(e.dir)) continue;
    if (!trackedSet.has(e.dirRel)) warn(tr(cfg.lang, `${e.dirRel}: каталог не в индексе git — удалён без git rm`, `${e.dirRel}: directory is not tracked by git — removed without git rm`));
    rmSync(e.dir, { recursive: true, force: true });
  }
}
