// Свёртка закрытой задачи в строку журнала: каталог уходит из дерева, тело остаётся в git.
// Две формы одной команды ([ADR-026](../docs/adr/adr-026-archive-folds-to-log.md)):
// `fold N` закрывает одну задачу — тело уезжает в заготовку сообщения коммита, которую команда
// печатает; `fold` без номера сворачивает накопленное — семьдесят семь тел в одно сообщение не
// помещаются, поэтому каждое обязано уже лежать в истории, и в журнал идёт ревизия, из которой
// его достаёт `show`.
// Заготовка — в stdout, диагностика — в stderr: так `fold N | git commit -F -` работает без
// чистки вывода (тот же раздел, что у `merge-changelog`).
import { existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { loadProject } from './config.js';
import { rewriteFoldedLinks } from './links.js';
import { appendLogLines, dateFromResult, formatLogLine, logAnchor, logFile, outcomeFromResult, renderOutcome } from './log.js';
import { repoMarkdown } from './mdwalk.js';
import { renderProjectTemplate } from './templates.js';
import { findTask, hasResultTodo, parseId, readText, readTitle, scanTasks, taskFileRe, writeText } from './tasks.js';
import { CliError, bad, git, info, parseCommandArgs, toPosix, today, warn } from './util.js';
import { tr } from './i18n.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
    info(tr(cfg.lang, 'сворачивать нечего: несвёрнутых каталогов в архиве нет', 'nothing to fold: the archive has no unfolded directories'));
    return 0;
  }

  // Всё, что видно до записи, проверяется до первой записи: половина свёрнутого архива
  // оставила бы дерево в состоянии, которое ниоткуда не прочитать.
  const entries = picked.map((t) => prepare(project, t, { single }));

  // Тело вне истории: одиночная свёртка уносит его в заготовку всегда, массовая — только с
  // `--embed-missing`. Умолчание массовой формы удаляет текст, и это решение владельца
  // ([ADR-026](../docs/adr/adr-026-archive-folds-to-log.md)), но молчаливым выброс не бывает:
  // задача и флаг, который её спас бы, называются вслух. Отбор идёт по причине, а не по пустой
  // ревизии: две другие причины пустой ревизии — отказы `prepare`, и сюда не доходят.
  const missing = single ? [] : entries.filter((e) => e.why === ABSENT);
  for (const e of missing) {
    if (embed) continue;
    warn(tr(cfg.lang,
      `${e.dirRel}: тела нет в истории git — текст уходит вместе с каталогом; сохранить его в заготовке сообщения коммита мог бы ${cfg.cli} fold --embed-missing`,
      `${e.dirRel}: the body is not in git history — the text goes with the directory; ${cfg.cli} fold --embed-missing would have kept it in the commit message draft`));
  }

  process.stdout.write(single ? draftOne(project, entries[0]) : draftMany(project, entries, embed ? missing : []));

  if (dry) {
    warn(tr(cfg.lang, `--dry-run: свернулось бы задач ${entries.length}, ничего не записано`, `--dry-run: ${entries.length} tasks would be folded, nothing was written`));
    return 0;
  }

  // Каталоги уходят первыми: отказ `git rm` на середине оставил бы журнал с записью о задаче,
  // которая всё ещё лежит в дереве, — состояние, которого ниоткуда не прочитать.
  removeDirs(project, entries);

  const lines = entries.flatMap((e) => e.lines);
  const log = logFile(dirs);
  if (!existsSync(log)) writeText(log, renderProjectTemplate(cfg, 'docs/archive/LOG.md', { cli: cfg.cli, prefix: cfg.prefix }));
  writeText(log, appendLogLines(readText(log), lines));

  const changed = rewriteLinks(project, entries);

  warn(tr(cfg.lang,
    `свёрнуто задач ${entries.length}, строк в ${toPosix(path.relative(root, log))} дописано ${lines.length}, файлов с поправленными ссылками ${changed.length}`,
    `folded tasks ${entries.length}, lines appended to ${toPosix(path.relative(root, log))} ${lines.length}, files with updated links ${changed.length}`));
  for (const rel of changed) warn(`  ${rel}`);
  warn(tr(cfg.lang,
    'заготовка сообщения коммита — в stdout: закоммить свёртку вместе с ней, иначе тело задачи потеряется',
    'the commit message draft is on stdout: commit the fold together with it, otherwise the task body is lost'));
  return 0;
}

// --- отбор ---------------------------------------------------------------------------------

function pickOne({ cfg }, tasks, raw) {
  const id = parseId(raw, cfg.prefix, cfg.lang);
  const task = findTask(tasks, id, cfg.lang);
  if (!task) throw new CliError(tr(cfg.lang, `задачи ${cfg.prefix}-${id.num}${id.sub === null ? '' : `.${id.sub}`} нет ни в одном каталоге статуса и в архиве`, `task ${cfg.prefix}-${id.num}${id.sub === null ? '' : `.${id.sub}`} was not found in any status directory or the archive`));
  if (task.folded) throw new CliError(tr(cfg.lang, `${task.id} уже свёрнута в журнал: ${task.rel}`, `${task.id} is already folded into the journal: ${task.rel}`));
  if (task.status !== 'archive') throw new CliError(tr(cfg.lang, `${task.id} лежит в ${task.status}/ — сворачивается закрытая задача: сначала ${cfg.cli} archive ${task.id}`, `${task.id} sits in ${task.status}/ — folding closes an archived task: run ${cfg.cli} archive ${task.id} first`));
  if (task.into) throw new CliError(tr(cfg.lang, `${task.id} — запись пачки ${task.into}: она сворачивается вместе с пачкой`, `${task.id} is an entry of batch ${task.into}: it folds together with its batch`));
  return task;
}

function pickAll({ cfg }, tasks, olderThan) {
  return tasks
    .filter((t) => t.status === 'archive' && !t.folded && !t.into)
    .filter((t) => olderThan === null || closedAt(t) < olderThan);
}

// Дата закрытия — из `result.md`; её нет — задача считается закрытой сегодня, и `--older-than`
// её не берёт: молчаливое включение записи с неизвестным возрастом хуже пропуска.
function closedAt(task) {
  const result = path.join(task.dir, 'result.md');
  return (existsSync(result) ? dateFromResult(readText(result)) : null) ?? today();
}

// --- подготовка записи -----------------------------------------------------------------------

function prepare(project, task, { single }) {
  const { root, cfg, dirs } = project;
  const dirRel = toPosix(path.relative(root, task.dir));
  const taskFile = path.join(task.dir, 'task.md');
  const resultFile = path.join(task.dir, 'result.md');
  if (!existsSync(taskFile)) throw new CliError(tr(cfg.lang, `${dirRel}: нет task.md — постановки, которая уехала бы в git`, `${dirRel}: task.md is missing — there is no definition to send into git`));
  if (!existsSync(resultFile)) throw new CliError(tr(cfg.lang, `${dirRel}: нет result.md — результат дописывает approver, без него свёртка стирает задачу без исхода`, `${dirRel}: result.md is missing — the approver writes the result; without it folding erases the task without an outcome`));
  const resultText = readText(resultFile);
  if (!resultText.trim()) throw new CliError(tr(cfg.lang, `${dirRel}/result.md пуст: свёртка уносит тело в git, и пустой результат уносится вместе с ним`, `${dirRel}/result.md is empty: folding carries the body into git, and an empty result goes with it`));
  if (hasResultTodo(resultText)) throw new CliError(tr(cfg.lang, `${dirRel}/result.md остался заглушкой: в нём [TODO] — допиши исход и проверки`, `${dirRel}/result.md is still a stub: it contains [TODO] — write the outcome and the verification`));

  const taskText = readText(taskFile);
  const { rev, why, detail } = bodyRev(root, dirRel);
  // Массовая форма тел не печатает, поэтому её единственное хранилище — история. Посмотреть в
  // неё нечем — это отказ, а не повод удалять: удалением отвечают только на доказанное
  // отсутствие тела (`ABSENT`), и умолчание владельца было именно о нём. Отказ идёт из
  // `prepare`, то есть до первой записи, вместе с остальными.
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
  const title = readTitle(taskText)?.title ?? null;
  const date = dateFromResult(resultText) ?? today();
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
  for (const entry of minorEntries(cfg, task.dir)) {
    const rel = `${dirRel}/minor/${path.basename(entry.file)}`;
    const text = readText(entry.file);
    bodies.push([rel, text]);
    targets.push([rel, entry.id]);
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

function minorEntries(cfg, dir) {
  const minorDir = path.join(dir, 'minor');
  if (!existsSync(minorDir)) return [];
  const fileRe = taskFileRe(cfg.prefix);
  const out = [];
  for (const name of readdirSync(minorDir)) {
    const m = name.match(fileRe);
    if (!m) continue;
    out.push({ id: `${cfg.prefix}-${m[1]}${m[2] === undefined ? '' : `.${m[2]}`}`, slug: m[3], file: path.join(minorDir, name) });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

// Ревизия, из которой тело достаётся после удаления, — и причина, если ревизии нет. Причин три,
// и ход у них разный: без git и на грязном каталоге мы НЕ СМОГЛИ ПОСМОТРЕТЬ в историю, а не
// убедились, что тела там нет. Умолчание «удалить» владелец выбирал для третьей причины, и на
// первые две оно не распространяется ([ADR-026](../docs/adr/adr-026-archive-folds-to-log.md)).
// Форма `<rev>:./<путь>` — от текущего каталога: проект может лежать в подкаталоге репозитория,
// и `<rev>:<путь>` читался бы от корня репозитория.
const NO_GIT = 'no-git';
const DIRTY = 'dirty';
const ABSENT = 'absent';

function bodyRev(root, dirRel) {
  const dirty = git(root, ['status', '--porcelain', '--', dirRel]);
  if (dirty.status !== 0) return { rev: null, why: NO_GIT, detail: (dirty.stderr ?? '').trim() };
  if (dirty.stdout.trim()) return { rev: null, why: DIRTY, detail: dirty.stdout.trim().split('\n').slice(0, 4).join('; ') };
  const log = git(root, ['log', '-1', '--format=%H', '--', `${dirRel}/task.md`]);
  if (log.status !== 0) return { rev: null, why: NO_GIT, detail: (log.stderr ?? '').trim() };
  const rev = log.stdout.trim();
  if (!rev) return { rev: null, why: ABSENT, detail: '' };
  return git(root, ['cat-file', '-e', `${rev}:./${dirRel}/task.md`]).status === 0
    ? { rev, why: null, detail: '' }
    : { rev: null, why: ABSENT, detail: '' };
}

// --- заготовка сообщения ---------------------------------------------------------------------

function draftOne({ cfg }, entry) {
  const anchor = `${entry.logRel}#${logAnchor(entry.task.id)}`;
  const head = `${entry.task.id}: ${entry.title ?? entry.task.slug}`;
  const intro = tr(cfg.lang,
    `Свёрнута в строку ${anchor}. Тело задачи — ниже: в дереве его больше нет, и это сообщение — его единственное хранилище.`,
    `Folded into the ${anchor} line. The task body is below: it is no longer in the tree, and this message is its only storage.`);
  return [head, '', intro, '', ...entry.bodies.flatMap(([rel, text]) => [`--- ${rel} ---`, '', text.trimEnd(), ''])].join('\n');
}

// Заготовка массовой свёртки перечисляет задачи и ревизии их тел: семьдесят семь тел целиком в
// одно сообщение не помещаются, и хранилищем им остаётся история. Целиком в сообщение идут
// только тела, которых в истории нет, — и только по просьбе `--embed-missing`.
function draftMany({ cfg }, entries, embedded) {
  const head = tr(cfg.lang, `свёртка архива в журнал: задач ${entries.length}`, `fold the archive into the journal: ${entries.length} tasks`);
  const intro = tr(cfg.lang,
    `Каталоги задач уходят из дерева, номера и исходы остаются строками журнала. Тело задачи лежит в истории — строка журнала называет ревизию, из которой его достаёт ${cfg.cli} show N.`,
    `Task directories leave the tree; numbers and outcomes remain as journal lines. A task body sits in history — its journal line names the revision that ${cfg.cli} show N reads it from.`);
  const list = entries.map((e) => `- ${e.dirRel} — ${e.rev === null ? '—' : e.rev.slice(0, 10)}`);
  const tail = embedded.length
    ? ['', tr(cfg.lang,
      `Тела задач ниже в истории не лежат: это сообщение — их единственное хранилище (${cfg.cli} fold --embed-missing).`,
      `The task bodies below are not in history: this message is their only storage (${cfg.cli} fold --embed-missing).`),
    '', ...embedded.flatMap((e) => e.bodies.flatMap(([rel, text]) => [`--- ${rel} ---`, '', text.trimEnd(), '']))]
    : [];
  return [head, '', intro, '', ...list, ...tail, ''].join('\n');
}

// --- запись ------------------------------------------------------------------------------------

// Входящие ссылки ведут на строку журнала целиком — вместе с якорем: якорь исчезнувшего файла
// (`#контекст`) на ней не значит ничего, а гейт ссылок якоря не проверяет вовсе.
function rewriteLinks(project, entries) {
  const { root } = project;
  const byPath = new Map();
  for (const e of entries) {
    for (const [rel, id] of e.targets) byPath.set(rel, { logRel: e.logRel, id });
  }
  const gone = entries.map((e) => e.dirRel);
  const changed = [];
  for (const [rel, abs] of repoMarkdown(root)) {
    // Файлы самих сворачиваемых каталогов уезжают вместе с ними: править в них нечего.
    if (gone.some((dir) => rel === dir || rel.startsWith(`${dir}/`))) continue;
    const fileDir = path.posix.dirname(rel);
    const text = readText(abs);
    const next = rewriteFoldedLinks(text, fileDir, (target) => {
      const hit = byPath.get(target);
      return hit ? `${path.posix.relative(fileDir, hit.logRel)}#${logAnchor(hit.id)}` : null;
    });
    if (next === text) continue;
    changed.push(rel);
    writeText(abs, next);
  }
  return changed.sort();
}

// Каталог уходит из индекса вместе с диском: `git rm` одним вызовом на все отслеживаемые,
// остальное — обычным удалением. Отслеживаемость проверяется до удаления: `git rm` на
// неотслеживаемом каталоге отказывает целиком и не снял бы ни одного. `-f` обязателен: задача,
// только что переехавшая `archive N`, лежит в индексе переименованием, а её `result.md` не
// закоммичен вовсе — без флага `git rm` отказывает ровно на штатном ходе закрытия. Текст при
// этом не теряется: одиночная свёртка уносит тело в заготовку сообщения, а массовая берёт
// только тела, которые уже в истории.
function removeDirs({ root, cfg }, entries) {
  const tracked = [];
  for (const e of entries) {
    const ls = git(root, ['ls-files', '--', e.dirRel]);
    if (ls.status === 0 && ls.stdout.trim()) tracked.push(e.dirRel);
  }
  if (tracked.length) {
    const r = git(root, ['rm', '-r', '-q', '-f', '--', ...tracked]);
    if (r.status !== 0) {
      bad(tr(cfg.lang, `git rm отказал: ${(r.stderr ?? '').trim() || `код ${r.status}`}`, `git rm failed: ${(r.stderr ?? '').trim() || `exit code ${r.status}`}`));
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
