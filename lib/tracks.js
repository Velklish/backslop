// Картина захода: worktree и ветки с коммитами `<prefix>-N:` — влиты ли в HEAD, что не доехало и
// что не закоммичено. Команда только наблюдает, удаление — руками оркестратора (ADR-014).
import { loadProject } from './config.js';
import { CliError, git, gitCause, info, insideRepo, isSameTree, localBranches, ok, parseCommandArgs, printJson, worktrees } from './util.js';
import { tr } from './i18n.js';

// Коммиты задач мимо HEAD: без них ветка влита по существу, даже когда ссылка жива. `--grep` —
// только предфильтр, решает заголовок: squash тащит заголовки схлопнутых в тело (ADR-014).
function pendingCommits(root, ref, prefix) {
  if (ref === null) return [];
  // `--` keeps a branch named like a path (`docs`) a revision; `null` means git could not answer.
  const r = git(root, ['log', '--format=%h %s', ref, '--not', 'HEAD', `--grep=${prefix}-`, '--']);
  if (r.status !== 0) return null;
  const subjectRe = new RegExp(`^${prefix}-\\d`);
  const out = [];
  for (const line of r.stdout.split('\n')) {
    const at = line.indexOf(' ');
    if (at === -1) continue;
    if (subjectRe.test(line.slice(at + 1))) out.push(line.trim());
  }
  return out;
}

// `git -C <путь> status` смотрит дерево самого worktree. Пустой список — чисто, `null` — спросить
// не удалось: свести их к «чисто» значило бы звать к удалению вслепую.
function dirtyIn(wtPath) {
  const r = git(wtPath, ['status', '--porcelain']);
  if (r.status !== 0) return null;
  return r.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
}

export async function run(argv, { cwd }) {
  const { values } = parseCommandArgs(argv, { json: { type: 'boolean' } });
  const asJson = values.json === true;
  const { root, cfg } = loadProject(cwd);

  if (!insideRepo(root, cfg.lang)) {
    throw new CliError(tr(cfg.lang,
      'git-репозитория нет: перечислять worktree и ветки захода нечем',
      'there is no git repository: worktrees and run branches cannot be listed'));
  }
  const top = git(root, ['rev-parse', '--show-toplevel']);
  if (top.status !== 0) throw new CliError(`git rev-parse --show-toplevel: ${gitCause(top, cfg.lang)}`);
  const here = top.stdout.trim();
  const current = git(root, ['branch', '--show-current']);
  const currentBranch = current.status === 0 ? current.stdout.trim() : '';

  const entries = [];
  const seenBranch = new Set();
  for (const wt of worktrees(root, cfg.lang)) {
    if (isSameTree(wt.path, here)) continue;
    // Detached worktree меряется по `HEAD <sha>` из porcelain: ветки нет, а работа в нём есть.
    const ref = wt.branch ?? wt.head;
    if (wt.branch !== null) seenBranch.add(wt.branch);
    entries.push({
      kind: 'worktree',
      path: wt.path,
      branch: wt.branch,
      head: wt.head,
      merged: ref !== null && git(root, ['merge-base', '--is-ancestor', ref, 'HEAD']).status === 0,
      pending: pendingCommits(root, ref, cfg.prefix),
      dirty: wt.prunable ? null : dirtyIn(wt.path),
      prunable: wt.prunable,
      locked: wt.locked,
    });
  }
  // Ветка без worktree — только с коммитами задач мимо HEAD, иначе в перечне была бы каждая ветка
  // от main. Worktree перечисляется всегда: его удаляют как каталог, даже влитый.
  for (const branch of localBranches(root, cfg.lang)) {
    if (branch === currentBranch || seenBranch.has(branch)) continue;
    const pending = pendingCommits(root, branch, cfg.prefix);
    if (pending !== null && !pending.length) continue;
    entries.push({
      kind: 'branch',
      path: null,
      branch,
      head: null,
      merged: git(root, ['merge-base', '--is-ancestor', branch, 'HEAD']).status === 0,
      pending,
      dirty: null,
      prunable: false,
      locked: false,
    });
  }

  if (asJson) {
    printJson({ tracks: entries, total: entries.length });
    return 0;
  }

  // Влитость и неслитые коммиты печатаются порознь: ветка бывает не предком HEAD и при этом без
  // своих коммитов задач — после переписи истории, — и одно из двух вводило бы в заблуждение.
  for (const e of entries) {
    info(e.kind === 'worktree' ? `${e.path} (${e.branch ?? 'detached'})` : e.branch);
    info(e.merged
      ? tr(cfg.lang, '  влит в HEAD', '  merged into HEAD')
      : tr(cfg.lang, '  не влит в HEAD', '  not merged into HEAD'));
    if (e.pending === null) info(tr(cfg.lang, '  не влитые коммиты задач: спросить не удалось', '  task commits not in HEAD: could not be checked'));
    else if (e.pending.length) {
      info(tr(cfg.lang, `  не влито коммитов задач: ${e.pending.length}`, `  task commits not in HEAD: ${e.pending.length}`));
      for (const c of e.pending) info(`    ${c}`);
    } else {
      info(tr(cfg.lang, '  не влитых коммитов задач нет', '  no task commits outside HEAD'));
    }
    // У ветки без worktree дерева нет, и молчание тут — не «чисто», а «нечего смотреть»;
    // у worktree чистота называется вслух, иначе её не отличить от непроверенной.
    if (e.kind !== 'worktree') continue;
    if (e.prunable) info(tr(cfg.lang, '  каталога нет — git worktree prune', '  directory is gone — git worktree prune'));
    else if (e.dirty === null) info(tr(cfg.lang, '  незакоммиченное: спросить не удалось', '  uncommitted: could not be checked'));
    else if (e.dirty.length) {
      info(tr(cfg.lang, `  незакоммиченного: ${e.dirty.length}`, `  uncommitted entries: ${e.dirty.length}`));
      for (const l of e.dirty) info(`    ${l}`);
    } else info(tr(cfg.lang, '  незакоммиченного нет', '  nothing uncommitted'));
  }

  const notMerged = entries.filter((e) => !e.merged).length;
  ok(tr(cfg.lang,
    `tracks: worktree и веток ${entries.length}, не влитых ${notMerged}`,
    `tracks: worktrees and branches ${entries.length}, not merged ${notMerged}`));
  return 0;
}
