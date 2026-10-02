// Folding a closed task into a journal line: the directory leaves the tree, the body stays in git:
// as a message draft on stdout for `fold N`, as a history revision for bare `fold` (ADR-044).
import { existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { loadProject } from './config.js';
import { formatId } from './ids.js';
import { repoPrefix, rewriteFoldedLinks } from './links.js';
import { appendLogLines, bodySection, dateFromResult, formatLogLine, hasNamedOutcome, logAnchor, logFile, outcomeFromResult, outcomeWordMissing, renderOutcome } from './log.js';
import { linkBase, repoMarkdown } from './mdwalk.js';
import { renderProjectTemplate } from './templates.js';
import { findTask, hasResultTodo, parseId, readTitle, scanTasks, warnLinkedOut } from './tasks.js';
import { eolOf } from './text.js';
import { CliError, DATE_RE, git, gitCause, insideRepo, isTracked, note, parseCommandArgs, readText, toPosix, today, warn, writeText } from './util.js';
import { msg, msgBoth } from './i18n.js';

export async function run(argv, { cwd, lang }) {
  const { values, positionals } = parseCommandArgs(argv, { 'dry-run': { type: 'boolean' }, 'older-than': { type: 'string' }, 'embed-missing': { type: 'boolean' } }, {
    positionals: 1,
    lang,
    tooMany: (l) => msgBoth(l, 'a single task number is expected: bulk folding is the same command without a number'),
  });
  const dry = values['dry-run'] === true;
  const embed = values['embed-missing'] === true;
  const project = loadProject(cwd);
  const { root, cfg, dirs } = project;
  const olderThan = values['older-than'] === undefined ? null : values['older-than'].trim();
  if (olderThan !== null && !DATE_RE.test(olderThan)) {
    throw new CliError(msg(cfg.lang, '--older-than expects a YYYY-MM-DD date, not “{value}”', { value: values['older-than'] }));
  }
  if (positionals[0] !== undefined && olderThan !== null) {
    throw new CliError(msg(cfg.lang, '--older-than cannot be combined with a task number: the age filter selects accumulated entries, not a named task'));
  }
  if (positionals[0] !== undefined && embed) {
    throw new CliError(msg(cfg.lang, '--embed-missing cannot be combined with a task number: folding a single task always puts the body into the message draft'));
  }
  const single = positionals[0] !== undefined;
  const tasks = scanTasks(project);
  warnLinkedOut(project);
  const picked = single ? [pickOne(project, tasks, positionals[0])] : pickAll(project, tasks, olderThan);
  if (!picked.length) {
    note(msg(cfg.lang, 'nothing to fold: the archive has no unfolded directories'));
    return 0;
  }

  // Everything visible before writing is checked before the first write: half a folded archive
  // would leave the tree in a state that cannot be read from anywhere.
  const entries = picked.map((t) => prepare(project, t, { single, embed, tasks }));
  // The journal of a bulk fold follows the closing dates in the lines; equal dates go by number.
  entries.sort((a, b) => a.date.localeCompare(b.date) || a.task.num - b.task.num || (a.task.sub ?? 0) - (b.task.sub ?? 0));

  // The bulk form drops a body outside history aloud (ADR-044); selected by the reason `ABSENT`:
  // the other reasons for an empty revision are refusals of `prepare`.
  const missing = single ? [] : entries.filter((e) => e.why === ABSENT);
  for (const e of missing) {
    if (embed) continue;
    warn(msg(cfg.lang,
      '{dirRel}: the body is not in git history — the text goes with the directory; {cli} fold --embed-missing would have kept it in the commit message draft', { dirRel: e.dirRel, cli: cfg.cli }));
  }

  const embedded = embed ? missing : [];
  process.stdout.write(single ? draftOne(project, entries[0]) : draftMany(project, entries, embedded));

  if (dry) {
    note(msg(cfg.lang, '--dry-run: {entries} tasks would be folded, nothing was written', { entries: entries.length }));
    return 0;
  }

  // Directories go first: a `git rm` refusal midway would leave a journal entry about a task that
  // still lies in the tree, a state that cannot be read from anywhere.
  const prefix = repoPrefix(root, cfg.lang);
  // The link walk comes first: a directory it cannot list refuses before the first write.
  const markdown = repoMarkdown(root);
  removeDirs(project, entries);

  const lines = entries.flatMap((e) => e.lines);
  const log = logFile(dirs);
  if (!existsSync(log)) writeText(log, renderProjectTemplate(cfg, 'docs/archive/LOG.md', { cli: cfg.cli, prefix: cfg.prefix }));
  const logText = readText(log);
  writeText(log, appendLogLines(logText, lines, eolOf(logText)));

  const { changed, missed } = rewriteLinks(entries, root, prefix, markdown);

  note(msg(cfg.lang,
    'folded tasks {entries}, lines appended to {log} {lines}, files with updated links {changed}, links into the folded left unrewritten {missed}', { entries: entries.length, log: toPosix(path.relative(root, log)), lines: lines.length, changed: changed.length, missed: missed.length }));
  for (const rel of changed) note(`  ${rel}`);
  if (missed.length) {
    warn(msg(cfg.lang,
      'these links lead into a folded directory past task.md, result.md and batch entries — there is nothing to point them at; fix them by hand'));
    for (const m of missed) warn(`  ${m}`);
  }
  // A line with a revision hands the body to `show N`, and the draft is a copy; for a line with `—`
  // the draft is the only storage.
  note(single ? draftNoteOne(cfg, entries[0]) : draftNoteMany(cfg, entries, embedded, embed ? [] : missing));
  return 0;
}

function draftNoteOne(cfg, entry) {
  return entry.rev !== null
    ? msg(cfg.lang,
      'the commit message draft is on stdout; committing it is optional: the body is already in history — the revision is recorded in the journal line, and {cli} show {id} reads it from there. A squash or reset --soft across that revision drops it, and then without the draft the task body is lost. {note}', { cli: cfg.cli, id: entry.task.id, note: verbatimNote(cfg) })
    : msg(cfg.lang,
      'the commit message draft is on stdout: commit the fold together with it, otherwise the task body is lost. {note}', { note: verbatimNote(cfg) });
}

function verbatimNote(cfg) {
  return msg(cfg.lang,
    'Commit it with git commit --cleanup=verbatim -F <draft file>, so git leaves the message as written');
}

// A bulk draft carries bodies only with `--embed-missing`, and only then requires a commit.
function draftNoteMany(cfg, entries, embedded, dropped) {
  if (embedded.length) {
    return msg(cfg.lang,
      'the commit message draft is on stdout and carries the bodies of tasks that are not in history: commit the fold together with it, otherwise those bodies are lost. {note}', { note: verbatimNote(cfg) });
  }
  if (!dropped.length) {
    return msg(cfg.lang,
      'the commit message draft is on stdout and carries no task bodies: the journal line names the revision that holds the body, and {cli} show N reads it from there', { cli: cfg.cli });
  }
  const rest = entries.length > dropped.length
    ? msg(cfg.lang, '; for lines with a revision {cli} show N reads the body', { cli: cfg.cli })
    : '';
  return msg(cfg.lang,
    'the commit message draft is on stdout and carries no task bodies: the lines with “—” ({dropped} tasks) lost their bodies with the directories, kept neither in the draft nor in history{rest}', { dropped: dropped.length, rest });
}

// --- selection -----------------------------------------------------------------------------

function pickOne({ cfg }, tasks, raw) {
  const id = parseId(raw, cfg.prefix, cfg.lang);
  const task = findTask(tasks, id, cfg.lang);
  if (!task) throw new CliError(msg(cfg.lang, 'task {id} was not found in any status directory or the archive', { id: formatId(cfg.prefix, id.num, id.sub) }));
  if (task.folded) throw new CliError(msg(cfg.lang, '{id} is already folded into the journal: {rel}', { id: task.id, rel: task.rel }));
  if (task.status !== 'archive') throw new CliError(msg(cfg.lang, '{id} sits in {status}/ — folding closes an archived task: run {cli} archive {id} first', { id: task.id, status: task.status, cli: cfg.cli }));
  if (task.into) throw new CliError(msg(cfg.lang, '{id} is an entry of batch {into}: it folds together with its batch', { id: task.id, into: task.into }));
  return task;
}

function pickAll(project, tasks, olderThan) {
  return tasks
    .filter((t) => t.status === 'archive' && !t.folded && !t.into)
    .filter((t) => olderThan === null || closedAt(project, tasks, t) < olderThan);
}

// The closing date is the one that will stand in the line: `result.md`, else the revision commit;
// with no revision the task counts as closed today and `--older-than` skips it: unknown age.
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

// --- preparing an entry ----------------------------------------------------------------------

function prepare(project, task, { single, embed, tasks }) {
  const { root, cfg, dirs } = project;
  const dirRel = toPosix(path.relative(root, task.dir));
  const taskFile = path.join(task.dir, 'task.md');
  const resultFile = path.join(task.dir, 'result.md');
  if (!existsSync(taskFile)) throw new CliError(msg(cfg.lang, '{dirRel}: task.md is missing — there is no definition to send into git', { dirRel }));
  if (!existsSync(resultFile)) throw new CliError(msg(cfg.lang, '{dirRel}: result.md is missing — the approver writes the result; without it folding erases the task without an outcome', { dirRel }));
  const resultText = readText(resultFile);
  if (!resultText.trim()) throw new CliError(msg(cfg.lang, '{dirRel}/result.md is empty: folding carries the body into git, and an empty result goes with it', { dirRel }));
  if (hasResultTodo(resultText)) throw new CliError(msg(cfg.lang, '{dirRel}/result.md is still a stub: it contains [TODO] — write the outcome and the verification', { dirRel }));
  // A single fold is a step of acceptance and runs before lint: the outcome word is required here,
  // as in gate 5.
  if (single && !hasNamedOutcome(resultText, cfg.prefix)) throw new CliError(`${dirRel}/${outcomeWordMissing(cfg.prefix, cfg.lang)}`);

  const taskText = readText(taskFile);
  const minors = batchEntries(tasks, task);
  const { rev, why, detail, at, cause, flag } = bodyRev(root, dirRel, [`${dirRel}/task.md`, `${dirRel}/result.md`, ...minors.map((e) => e.rel)], cfg.lang);
  // For the bulk form the only body storage is history: no git is a refusal before the first write,
  // not a deletion. Only a proven absence of the body (`ABSENT`) is answered by deleting.
  if (!single && why === NO_GIT) {
    throw new CliError(msg(cfg.lang,
      '{dirRel}: there is no git repository — history cannot be read{detail}, and bulk folding does not print bodies: deleting the directory would have no backing. Create a repository, or fold one task at a time: {cli} fold {id}', { dirRel, detail: detail ? ` (${detail})` : '', cli: cfg.cli, id: task.id }));
  }
  if (!single && why === DIRTY) {
    throw new CliError(msg(cfg.lang,
      '{dirRel}: the directory is not committed ({detail}) — history holds a different revision, and the recorded revision would promise text it does not contain. Commit the directory and retry, or fold this task alone: {cli} fold {id}', { dirRel, detail, cli: cfg.cli, id: task.id }));
  }
  if (!single && why === DIVERGED && cause) {
    throw new CliError(msg(cfg.lang,
      '{detail}: the directory files cannot be checked against revision {at} — git hash-object: {cause}. Deleting the directory without checking the body against history has no backing: restore the files in the working tree and retry, or fold this task alone: {cli} fold {id}', { detail, at: at.slice(0, 10), cause, cli: cfg.cli, id: task.id }));
  }
  if (!single && why === DIVERGED && flag) {
    throw new CliError(msg(cfg.lang,
      '{detail}: the file differs from its revision {at} although git status reports the directory clean ({flag}) — the recorded revision would promise text it does not contain. Commit the file and retry, or fold this task alone: {cli} fold {id}', { detail, at: at.slice(0, 10), flag, cli: cfg.cli, id: task.id }));
  }
  if (!single && why === DIVERGED) {
    const crlf = autocrlfOn(root);
    const fix = crlf
      ? msg(cfg.lang, 'This looks like line endings under core.autocrlf: normalise them with git add --renormalize {dirRel}, commit, and retry', { dirRel })
      : msg(cfg.lang, 'Commit the file and retry');
    throw new CliError(msg(cfg.lang,
      '{detail}: the file differs from its revision {at} — the recorded revision would promise text it does not contain. {fix}, or fold this task alone: {cli} fold {id}', { detail, at: at.slice(0, 10), fix, cli: cfg.cli, id: task.id }));
  }
  // An attachment has no place in the draft: without its own copy in HEAD, folding would delete it.
  if (single || (embed && why === ABSENT)) {
    const unsaved = unsavedAttachments(root, attachmentsOf(root, task.dir, dirRel, minors), cfg.lang);
    if (unsaved.length) {
      throw new CliError(msg(cfg.lang,
        '{dirRel}: attachments are not saved in git history, and folding would delete them with the directory: {unsaved}. Save them first as the attachment branch of step 5 in AGENTS.md says, or move the files out of the directory and link them from result.md, then fold again', { dirRel, unsaved: unsaved.join(', ') }));
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

  // The paths that vanish and the journal line they now lead to: the directory itself and both of
  // its files go to the task's line, a batch entry file goes to that entry's line.
  const targets = [[dirRel, task.id], [`${dirRel}/task.md`, task.id], [`${dirRel}/result.md`, task.id]];
  const bodies = [[`${dirRel}/task.md`, taskText], [`${dirRel}/result.md`, resultText]];
  // Batch entries leave with it: their outcome is named by the batch's result, and there is no line
  // of its own to take it from: the journal holds the membership in the batch itself.
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

// The body revision: the last commit that touched the directory. Deleting is the default only for
// `ABSENT` ([ADR-044](../docs/adr/adr-044-closed-task-journal.md)); the rest mean "unsure".
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
  // `ls-tree` paths are from the current directory, in the same coordinates as `dirRel`.
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

// --- message draft ---------------------------------------------------------------------------

function draftOne({ cfg }, entry) {
  const anchor = `${entry.logRel}#${logAnchor(entry.task.id)}`;
  const head = `${entry.task.id}: ${entry.title ?? entry.task.slug}`;
  const intro = entry.rev === null
    ? msg(cfg.lang,
      'Folded into the {anchor} line. The task body is below: it is no longer in the tree, and this message is its only storage.', { anchor })
    : msg(cfg.lang,
      'Folded into the {anchor} line. The task body is below as a copy: the journal line names revision {rev}, and {cli} show {id} reads it from there.', { anchor, rev: entry.rev.slice(0, 10), cli: cfg.cli, id: entry.task.id });
  return [head, '', intro, '', ...entry.bodies.flatMap(([rel, text]) => bodySection(rel, text))].join('\n');
}

// The bulk-fold draft lists the tasks and the body revisions; whole bodies go into the message only
// when history lacks them, and only with `--embed-missing`.
function draftMany({ cfg }, entries, embedded) {
  const head = msg(cfg.lang, 'fold the archive into the journal: {entries} tasks', { entries: entries.length });
  const bare = entries.filter((e) => e.rev === null).map((e) => e.task.id).join(', ');
  const intro = !bare
    ? msg(cfg.lang,
      'Task directories leave the tree; numbers and outcomes remain as journal lines. A task body sits in history — its journal line names the revision that {cli} show N reads it from.', { cli: cfg.cli })
    : msg(cfg.lang,
      'Task directories leave the tree; numbers and outcomes remain as journal lines. A line with a revision names the commit that {cli} show N reads the body from; the lines with “—” ({bare}) have none: {bodies}.', {
        cli: cfg.cli,
        bare,
        bodies: embedded.length
          ? msg(cfg.lang, 'their bodies are below, in this message, and {cli} show N finds them here', { cli: cfg.cli })
          : msg(cfg.lang, 'their bodies left with the directories and are kept neither in this message nor in history'),
      });
  const list = entries.map((e) => `- ${e.dirRel} — ${e.rev === null ? '—' : e.rev.slice(0, 10)}`);
  const tail = embedded.length
    ? ['', msg(cfg.lang,
      'The task bodies below are not in history: this message is their only storage ({cli} fold --embed-missing).', { cli: cfg.cli }),
    '', ...embedded.flatMap((e) => e.bodies.flatMap(([rel, text]) => bodySection(rel, text)))]
    : [];
  return [head, '', intro, '', ...list, ...tail, ''].join('\n');
}

// --- writing -----------------------------------------------------------------------------------

// Incoming links lead to the journal line, anchor included: the anchor of a vanished file
// (`#context`) means nothing on it, and the journal gate reports an anchor no entry has.
function rewriteLinks(entries, root, prefix, markdown) {
  const byPath = new Map();
  for (const e of entries) {
    for (const [rel, id] of e.targets) byPath.set(rel, { logRel: e.logRel, id });
  }
  const gone = entries.map((e) => e.dirRel);
  const inGone = (rel) => gone.some((dir) => rel === dir || rel.startsWith(`${dir}/`));
  const changed = [];
  const missed = [];
  for (const [rel, abs] of markdown) {
    // The files of the folded directories leave with them: nothing to rewrite in them. A file the
    // removal took through a symlinked alias is gone too.
    if (inGone(rel) || !existsSync(abs)) continue;
    const text = readText(abs);
    const next = rewriteFoldedLinks(text, linkBase(root, rel, abs), (target, href) => {
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

// `git rm -f` in one call, only for tracked directories: one untracked would fail the whole call.
// `-f` is for task.md, which `archive N` put in the index by a rename past HEAD.
function removeDirs({ root, cfg }, entries) {
  const tracked = [];
  const repo = insideRepo(root, cfg.lang);
  for (const e of entries) {
    if (repo && isTracked(root, e.dirRel, cfg.lang)) tracked.push(e.dirRel);
  }
  if (tracked.length) {
    const r = git(root, ['rm', '-r', '-q', '-f', '--', ...tracked]);
    if (r.status !== 0) {
      throw new CliError(msg(cfg.lang,
        'git rm failed: {cause} — task directories were not removed, the journal is untouched; sort the tree out and retry', { cause: gitCause(r, cfg.lang) }));
    }
  }
  // A directory that survived `git rm` holds something untracked: the `result.md` of a just-created
  // task never reached the index, so without this pass the directory would keep one file.
  const trackedSet = new Set(tracked);
  for (const e of entries) {
    if (!existsSync(e.dir)) continue;
    if (!trackedSet.has(e.dirRel)) warn(msg(cfg.lang, '{dirRel}: directory is not tracked by git — removed without git rm', { dirRel: e.dirRel }));
    rmSync(e.dir, { recursive: true, force: true });
  }
}
