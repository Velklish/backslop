// Body of a folded task: from the revision of its journal line; for `—`, from the commit whose
// message holds its section, else whose subject starts with `<prefix>-N:` (02-cli.md, `show`).
import path from 'node:path';
import process from 'node:process';
import { loadProject } from './config.js';
import { logFile, messageSections } from './log.js';
import { formatId, taskSubjectRe } from './ids.js';
import { canonicalId, findTask, parseId, readTitle, scanTasks, taskFileRe, warnLinkedOut } from './tasks.js';
import { CliError, escapeRe, git, gitCause, insideRepo, note, parseCommandArgs, toPosix, warn } from './util.js';
import { msg } from './i18n.js';

export async function run(argv, { cwd, lang }) {
  const { positionals } = parseCommandArgs(argv, {}, { positionals: 1, lang });
  const project = loadProject(cwd);
  const { root, cfg, dirs } = project;
  if (!positionals[0]) throw new CliError(msg(cfg.lang, 'task number is required: {cli} show <N>', { cli: cfg.cli }));
  const id = parseId(positionals[0], cfg.prefix, cfg.lang);
  const label = formatId(cfg.prefix, id.num, id.sub);
  const tasks = scanTasks(project);
  warnLinkedOut(project);
  const task = findTask(tasks, id, cfg.lang);
  if (!task) throw new CliError(msg(cfg.lang, 'task {label} was not found in any status directory, the archive, or the journal', { label }));
  if (!task.folded) {
    throw new CliError(msg(cfg.lang,
      '{id} is not folded — its body sits in the tree: {rel}', { id: task.id, rel: task.rel }));
  }
  if (!insideRepo(root, cfg.lang)) {
    throw new CliError(msg(cfg.lang, 'no git repository — the body of a folded task can only be read from history'));
  }

  const logRel = toPosix(path.relative(root, logFile(dirs)));
  const own = ownPath(toPosix(path.relative(root, dirs.archive)), task);
  const rev = task.log.commit ?? bySection(root, own) ?? bySubject(root, cfg.prefix, task);
  if (rev === null) {
    throw new CliError(msg(cfg.lang,
      '{id}: the {logRel} line names no commit, no commit message holds a section of its body, and history holds no commit whose subject starts with “{id}: ” — the body cannot be retrieved', { id: task.id, logRel }));
  }
  note(`${task.id} · ${task.log.date} · ${task.log.outcome} · ${rev}`);

  // The revision holds the body as FILES, and they are printed, not the commit: a normal closure is
  // a move, and a rename diff has no content at all.
  const { body, attachments } = bodyFiles(root, cfg, own, rev);
  const sections = [];
  for (const file of body) {
    // `<rev>:./<path>` is relative to the current directory, like the `ls-tree` paths in `bodyRev`
    // (`lib/fold.js`): without `./` git reads from the tree root, and a subdirectory project fails.
    const blob = git(root, ['show', `${rev}:./${file}`]);
    if (blob.status === 0) sections.push({ rel: file, text: blob.stdout.trimEnd() });
  }
  if (sections.length) {
    const parts = sections.flatMap((s) => [`--- ${s.rel} ---`, '', s.text, '']);
    if (attachments.length) {
      parts.push(`--- ${msg(cfg.lang, 'attachments')} ---`, '', ...attachments, '');
      note(msg(cfg.lang, 'attachments are listed by path: git show {rev}:./<path> prints one', { rev }));
    }
    process.stdout.write(`${parts.join('\n')}\n`);
    checkHeading(cfg, task, own, sections);
    return 0;
  }

  // No body file at the revision: the body is in the message, where the fold draft puts it. The
  // diff is not read: a bulk fold commit weighs megabytes and holds no body.
  note(msg(cfg.lang,
    'no body file in {rev} — printing the commit message: the fold draft keeps the body there, and this task\'s sections are taken from it', { rev }));
  const show = git(root, ['show', '-s', '--format=%B', rev]);
  if (show.status !== 0) {
    throw new CliError(msg(cfg.lang,
      'git show {rev}: {cause} — the commit named by the {logRel} line is not readable in this clone', { rev, cause: gitCause(show, cfg.lang), logRel }));
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

// Body paths come from the revision tree under `<docs>/archive`: a batch entry lies in `minor/` of
// another directory. `ls-tree` without `--full-name` gives paths from the cwd, as `<rev>:./` reads.
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
  // The definition prints before the result: alphabetically `result.md` would come first, but a
  // closed task is read from what was done and why.
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

// The number is compared numerically (`BS-7:` belongs to `BS-007`). `--grep` only prefilters, the
// first line decides: a squash carries subjects into the body.
function bySubject(root, prefix, task) {
  const re = taskSubjectRe(prefix, task);
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
  warn(msg(cfg.lang,
    '{id}: the body does not open with “# {id} · …” — the message holds no body, or git\'s cleanup (commit.cleanup=strip) took its headings; printed as found', { id: task.id }));
}
