// Body of a folded task: from the revision of its journal line; for `—`, from the commit whose
// message holds its section, else whose subject starts with `<prefix>-N:` (02-cli.md, `show`).
import path from 'node:path';
import process from 'node:process';
import { loadProject } from './config.js';
import { logFile, messageSections } from './log.js';
import { canonicalId, findTask, formatId, parseId, readTitle, scanTasks, taskFileRe } from './tasks.js';
import { CliError, escapeRe, git, gitCause, insideRepo, parseCommandArgs, toPosix, warn } from './util.js';
import { tr } from './i18n.js';

export async function run(argv, { cwd }) {
  const { positionals } = parseCommandArgs(argv, {});
  const project = loadProject(cwd);
  const { root, cfg, dirs } = project;
  if (!positionals[0]) throw new CliError(tr(cfg.lang, `нужен номер задачи: ${cfg.cli} show <N>`, `task number is required: ${cfg.cli} show <N>`));
  const id = parseId(positionals[0], cfg.prefix, cfg.lang);
  const label = formatId(cfg.prefix, id.num, id.sub);
  const task = findTask(scanTasks(project), id, cfg.lang);
  if (!task) throw new CliError(tr(cfg.lang, `задачи ${label} нет ни в одном каталоге статуса, ни в архиве, ни в журнале`, `task ${label} was not found in any status directory, the archive, or the journal`));
  if (!task.folded) {
    throw new CliError(tr(cfg.lang,
      `${task.id} не свёрнута — её тело лежит в дереве: ${task.rel}`,
      `${task.id} is not folded — its body sits in the tree: ${task.rel}`));
  }
  if (!insideRepo(root, cfg.lang)) {
    throw new CliError(tr(cfg.lang, 'репозитория git нет — тело свёрнутой задачи достаётся только из истории', 'no git repository — the body of a folded task can only be read from history'));
  }

  const logRel = toPosix(path.relative(root, logFile(dirs)));
  const own = ownPath(toPosix(path.relative(root, dirs.archive)), task);
  const rev = task.log.commit ?? bySection(root, own) ?? bySubject(root, cfg.prefix, task);
  if (rev === null) {
    throw new CliError(tr(cfg.lang,
      `${task.id}: строка ${logRel} коммита не называет, раздела её тела нет ни в одном сообщении коммита, и коммита с заголовком «${task.id}: …» в истории нет — тело не достать`,
      `${task.id}: the ${logRel} line names no commit, no commit message holds a section of its body, and history holds no commit whose subject starts with “${task.id}: ” — the body cannot be retrieved`));
  }
  warn(`${task.id} · ${task.log.date} · ${task.log.outcome} · ${rev}`);

  // Ревизия держит тело ФАЙЛАМИ, и печатаются они, а не коммит: штатное закрытие — переезд, и в
  // диффе переименования содержимого нет вовсе.
  const { body, attachments } = bodyFiles(root, cfg, own, rev);
  const sections = [];
  for (const file of body) {
    // `<rev>:./<путь>` — от текущего каталога, как пути `ls-tree` в `bodyRev` (`lib/fold.js`):
    // без `./` git берёт путь от корня дерева, и в проекте-подкаталоге чтение отказывает.
    const blob = git(root, ['show', `${rev}:./${file}`]);
    if (blob.status === 0) sections.push({ rel: file, text: blob.stdout.trimEnd() });
  }
  if (sections.length) {
    const parts = sections.flatMap((s) => [`--- ${s.rel} ---`, '', s.text, '']);
    if (attachments.length) {
      parts.push(`--- ${tr(cfg.lang, 'вложения', 'attachments')} ---`, '', ...attachments, '');
      warn(tr(cfg.lang, `вложения названы путём: git show ${rev}:./<путь> печатает файл`, `attachments are listed by path: git show ${rev}:./<path> prints one`));
    }
    process.stdout.write(`${parts.join('\n')}\n`);
    checkHeading(cfg, task, own, sections);
    return 0;
  }

  // No body file at the revision: the body is in the message, where the fold draft puts it. The
  // diff is not read: a bulk fold commit weighs megabytes and holds no body.
  warn(tr(cfg.lang,
    `тела файлом в ${rev} нет — печатается сообщение коммита: заготовка свёртки кладёт тело туда, и из него берутся разделы этой задачи`,
    `no body file in ${rev} — printing the commit message: the fold draft keeps the body there, and this task's sections are taken from it`));
  const show = git(root, ['show', '-s', '--format=%B', rev]);
  if (show.status !== 0) {
    throw new CliError(tr(cfg.lang,
      `git show ${rev}: ${gitCause(show, cfg.lang)} — коммит из строки ${logRel} в этом клоне не читается`,
      `git show ${rev}: ${gitCause(show, cfg.lang)} — the commit named by the ${logRel} line is not readable in this clone`));
  }
  const mine = messageSections(show.stdout).filter((s) => own.re.test(s.rel));
  process.stdout.write(mine.length ? `${mine.flatMap((s) => [`--- ${s.rel} ---`, '', s.text, '']).join('\n')}\n` : show.stdout);
  checkHeading(cfg, task, own, mine);
  return 0;
}

// Paths of the task under the archive: its directory, or a batch entry file in `minor/`. `inner`
// is the path inside the directory, empty for an entry; `grep` is a fixed string of its sections.
function ownPath(archiveRel, task) {
  const name = `${task.id}-${task.slug}`;
  return task.into
    ? { re: new RegExp(`^${escapeRe(archiveRel)}/[^/]+/minor/${escapeRe(name)}\\.md()$`), grep: `/minor/${name}.md ---`, main: '' }
    : { re: new RegExp(`^${escapeRe(archiveRel)}/${escapeRe(name)}/(.+)$`), grep: `--- ${archiveRel}/${name}/`, main: 'task.md' };
}

// Пути тела — из дерева ревизии по `<docs>/archive`: запись пачки лежит в `minor/` чужого каталога.
// `ls-tree` без `--full-name` даёт пути от текущего каталога — их и читает форма `<rev>:./<путь>`.
function bodyFiles(root, cfg, own, rev) {
  const tree = git(root, ['-c', 'core.quotePath=false', 'ls-tree', '-r', '--name-only', rev, '--', `${cfg.docs}/archive`]);
  if (tree.status !== 0) return { body: [], attachments: [] };
  const fileRe = taskFileRe(cfg.prefix);
  const body = [];
  const attachments = [];
  for (const p of tree.stdout.split('\n').map((l) => l.trim())) {
    const m = p.match(own.re);
    if (!m) continue;
    const inner = m[1];
    const isBody = ['', 'task.md', 'result.md'].includes(inner) || (/^minor\/[^/]+$/.test(inner) && fileRe.test(inner.slice(6)));
    (isBody ? body : attachments).push(p);
  }
  // Постановка печатается перед результатом: по алфавиту `result.md` встал бы первым, а читают
  // закрытую задачу с того, что и зачем делали.
  const rank = (p) => (p.endsWith('/task.md') ? 0 : p.endsWith('/result.md') ? 1 : 2);
  return { body: body.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)), attachments: attachments.sort() };
}

// A body embedded by the fold draft: the newest commit whose message holds a section of the task.
function bySection(root, own) {
  const r = git(root, ['log', '--format=%H%x1f%B%x1e', '-F', `--grep=${own.grep}`, 'HEAD']);
  if (r.status !== 0) return null;
  for (const record of r.stdout.split('\x1e')) {
    const [sha, message] = record.replace(/^\s+/, '').split('\x1f');
    if (message !== undefined && messageSections(message).some((s) => own.re.test(s.rel))) return sha;
  }
  return null;
}

// Номер сравнивается числом (`BS-7:` относится к `BS-007`). `--grep` — только предфильтр, решает
// первая строка: squash тащит заголовки схлопнутых в тело.
function bySubject(root, prefix, task) {
  const re = new RegExp(`^${prefix}-0*${task.num}${task.sub === null ? '' : `\\.0*${task.sub}`}:`);
  const r = git(root, ['log', '--format=%H%x01%s', `--grep=${prefix}-`, 'HEAD']);
  if (r.status !== 0) return null;
  for (const line of r.stdout.split('\n')) {
    const [sha, subject] = line.split('\x01');
    if (subject !== undefined && re.test(subject)) return sha;
  }
  return null;
}

// git's message cleanup takes `#` lines, so a body without its heading is named, not hidden.
function checkHeading(cfg, task, own, sections) {
  const main = sections.find((s) => own.re.exec(s.rel)?.[1] === own.main);
  const head = main ? readTitle(main.text) : null;
  if (head && canonicalId(head.id, cfg.prefix) === canonicalId(task.id, cfg.prefix)) return;
  warn(tr(cfg.lang,
    `${task.id}: тело не открывается строкой «# ${task.id} · …» — сообщение без тела, либо чистка git (commit.cleanup=strip) сняла его заголовки; напечатано как есть`,
    `${task.id}: the body does not open with “# ${task.id} · …” — the message holds no body, or git's cleanup (commit.cleanup=strip) took its headings; printed as found`));
}
