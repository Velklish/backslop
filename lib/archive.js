// Closing a task: a move to archive/<id>-<slug>/task.md with links fixed both ways by the `lint`
// walk and a result.md stub. The outcome and result in result.md are the approver's decision.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadProject } from './config.js';
import { probeSlots, renderProjectTemplate } from './templates.js';
import { formatId, taskSubjectRe } from './ids.js';
import { findFlatTask, findTask, parseId, relocateTask, scanTasks } from './tasks.js';
import { CliError, git, gitCause, info, insideRepo, ok, parseCommandArgs, showPrefix, today, toPosix, warn, writeText } from './util.js';
import { msg } from './i18n.js';

export async function run(argv, { cwd, lang }) {
  const { values, positionals } = parseCommandArgs(argv, { 'dry-run': { type: 'boolean' }, range: { type: 'string' }, into: { type: 'string' } }, { positionals: 1, lang });
  const dry = values['dry-run'] === true;
  const project = loadProject(cwd);
  const { root, cfg, dirs } = project;
  if (!positionals[0]) throw new CliError(msg(cfg.lang, 'task number is required: {cli} archive <N> [--dry-run] [--range <base>..HEAD] | {cli} archive <N.k> --into <M>', { cli: cfg.cli }));
  const range = values.range === undefined ? null : values.range.trim();
  if (range !== null && !range) throw new CliError(msg(cfg.lang, '--range expects revisions: <base>..HEAD'));
  if (range !== null && !range.includes('..')) throw new CliError(msg(cfg.lang, '--range {range}: expects a range <base>..HEAD — a single revision reads the whole history up to it', { range }));
  const tasks = scanTasks(project);
  const id = parseId(positionals[0], cfg.prefix, cfg.lang);
  const task = findTask(tasks, id, cfg.lang) ?? findFlatTask(project, id);
  if (!task) throw new CliError(msg(cfg.lang, 'task {id} was not found in any status directory', { id: formatId(cfg.prefix, id.num, id.sub) }));
  if (task.folded) throw new CliError(msg(cfg.lang, '{id} is already folded into the journal: {rel}', { id: task.id, rel: task.rel }));
  if (task.status === 'archive') throw new CliError(msg(cfg.lang, '{id} is already archived: {rel} — fold it into a journal line with {cli} fold {id}', { id: task.id, rel: task.rel, cli: cfg.cli }));
  if (values.into !== undefined) return archiveInto(project, tasks, task, values.into, { dry, range });

  const dirName = `${task.id}-${task.slug}`;
  const archiveDir = path.join(dirs.archive, dirName);
  const newFile = path.join(archiveDir, 'task.md');
  if (existsSync(newFile)) throw new CliError(msg(cfg.lang, '{newFile} already exists — another archived task uses this number', { newFile: toPosix(path.relative(root, newFile)) }));

  const oldRel = task.rel;
  const newRel = toPosix(path.relative(root, newFile));
  info(msg(cfg.lang, 'move: {oldRel} → {newRel}', { oldRel, newRel }));

  // Counted before the move: it only reads history, and a refusal over a bad `--range` after
  // `relocateTask` would leave the task moved and a repeat saying "already archived".
  const touched = touchedDocs(root, cfg, task, range);

  const changed = relocateTask(project, task, newRel, { dry });

  const resultFile = path.join(archiveDir, 'result.md');
  if (!dry && !existsSync(resultFile)) {
    writeText(resultFile, renderProjectTemplate(cfg, 'result.md', { id: task.id, date: today(), prefix: cfg.prefix, cli: cfg.cli, ...probeSlots(cfg) }));
  }

  reportLinks(cfg, changed, dry, msg(cfg.lang, 'archive: {id} — files with updated links {changed}', { id: task.id, changed: changed.length }));

  if (touched.length) {
    info(msg(cfg.lang,
      'documentation touched by {id} — copy what belongs into “Documentation in the same pass”:', { id: task.id }));
    for (const rel of touched) info(`  ${rel}`);
  }

  if (!dry) {
    info(msg(cfg.lang, 'complete {resultFile}: outcome and result belong to the approver; lint fails until then', { resultFile: toPosix(path.relative(root, resultFile)) }));
    info(msg(cfg.lang, 'then fold the directory into a journal line: {cli} fold {id}', { cli: cfg.cli, id: task.id }));
  }
  if (dry) info(dryRunLine(cfg));
  return 0;
}

// Closing a minor entry by batch: the file goes to the minor/ subdirectory of the batch's archive
// directory and gets no result.md of its own: the batch's result.md names the outcomes (ADR-047).
function archiveInto(project, tasks, task, rawInto, { dry, range }) {
  const { root, cfg } = project;
  if (range !== null) throw new CliError(msg(cfg.lang, '--range cannot be combined with --into: the batch accounts for the touched docs'));
  if (task.status !== 'minor') throw new CliError(msg(cfg.lang, '{id} is not in minor/ ({rel}): --into closes minor entries by batch only; merge cards with {cli} archive N and a “merged into …” outcome in result.md', { id: task.id, rel: task.rel, cli: cfg.cli }));
  const intoId = parseId(rawInto, cfg.prefix, cfg.lang);
  const batch = findTask(tasks, intoId, cfg.lang);
  if (!batch) throw new CliError(msg(cfg.lang, 'batch {intoId} was not found in any status directory or archive', { intoId: formatId(cfg.prefix, intoId.num, intoId.sub) }));
  if (batch.status === 'minor' || batch.into) throw new CliError(msg(cfg.lang, '{id} is a minor entry itself and cannot be a batch', { id: batch.id }));
  // An archive directory of an unclosed batch would read as a second file of its number: close the
  // batch first.
  if (batch.status !== 'archive') throw new CliError(msg(cfg.lang, 'batch {id} is still in {status}/ — close it first: {cli} archive {id}', { id: batch.id, status: batch.status, cli: cfg.cli }));
  // A folded batch has no directory in the tree, so there is nowhere to put the entry: entries are
  // closed before the batch is folded and go to the journal with it.
  if (batch.folded) throw new CliError(msg(cfg.lang, 'batch {id} is folded into the journal ({rel}) — there is no directory for the entry: minor entries are closed before the batch is folded', { id: batch.id, rel: batch.rel }));
  const newFile = path.join(batch.dir, 'minor', path.basename(task.file));
  if (existsSync(newFile)) throw new CliError(msg(cfg.lang, '{newFile} already exists', { newFile: toPosix(path.relative(root, newFile)) }));
  const newRel = toPosix(path.relative(root, newFile));
  info(msg(cfg.lang, 'move: {oldRel} → {newRel}', { oldRel: task.rel, newRel }));
  const changed = relocateTask(project, task, newRel, { dry });
  reportLinks(cfg, changed, dry, msg(cfg.lang, 'archive: {id} → batch {batchId} — files with updated links {changed}', { id: task.id, batchId: batch.id, changed: changed.length }));
  if (dry) info(dryRunLine(cfg));
  else info(msg(cfg.lang, 'name the outcome of {id} in the result.md of batch {batchId}; the entry has no result.md of its own', { id: task.id, batchId: batch.id }));
  return 0;
}

function dryRunLine(cfg) {
  return msg(cfg.lang, '--dry-run: nothing was written');
}

// A dry run reports what the link rewrite would touch, without the success mark.
function reportLinks(cfg, changed, dry, done) {
  if (dry) info(msg(cfg.lang, 'would update links in {changed} files', { changed: changed.length }));
  else ok(done);
  for (const rel of changed) info(`  ${rel}`);
}

// The mechanical half of "Documentation in the same pass": docs touched by `--range` commits and
// commits naming the task, minus tracker cards (docs/reference/02-cli.md, `archive`).
function touchedDocs(root, cfg, task, range) {
  if (!insideRepo(root, cfg.lang)) {
    // Without a repository there is nothing to count. Silent only when no one asked for the list: a
    // given `--range` without git is a refusal, or the flag would be ignored unnoticed.
    if (range) throw new CliError(msg(cfg.lang, '--range {range}: no git repository — there is no history to read', { range }));
    return [];
  }
  const files = new Set();
  const pathspec = [cfg.docs, 'CHANGELOG.md', `:(exclude)${cfg.docs}/backlog`, `:(exclude)${cfg.docs}/archive`];
  // The subdirectory prefix is cut by hand: `--relative` is ignored by a combined diff (`--cc`).
  // The refusal is unreachable, yet a swallowed one would silently return toplevel paths.
  const prefix = showPrefix(root, cfg.lang);
  // A merge commit gives files only with `--cc`, its own edit: `-m` would take all since the fork,
  // `--first-parent` would hide branch commits from the subject match.
  const collect = (args, subjectRe = null) => {
    // `%x01` separates the subject from the commit's files; without `quotePath=false` a non-ASCII
    // path would arrive octal-escaped in quotes, and the prefix would not be cut.
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
    // An unresolvable revision is a refusal in git's words: an empty list would read as "docs not
    // touched", and that is untrue.
    const r = collect([range]);
    if (r.status !== 0) throw new CliError(msg(cfg.lang, '--range {range}: git log: {cause}', { range, cause: gitCause(r, cfg.lang) }));
  }
  // The number is compared numerically (`BS-7:` belongs to `BS-007-…`). `--grep` only prefilters,
  // the first line decides: a squash carries subjects into the body.
  const subjectRe = taskSubjectRe(cfg.prefix, task);
  const byPrefix = collect([`--grep=${cfg.prefix}-`, 'HEAD'], subjectRe);
  // A repository without commits is a legitimate empty list; anything else hides part of the
  // selection.
  if (byPrefix.status !== 0 && git(root, ['rev-parse', '--verify', 'HEAD']).status === 0) {
    warn(msg(cfg.lang, 'commits naming the task were not read: git log: {cause}', { cause: gitCause(byPrefix, cfg.lang) }));
  }
  return [...files].sort();
}
