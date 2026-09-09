// Картина захода: worktree и локальные ветки, несущие коммиты `<prefix>-N:`, — влиты ли они в
// HEAD, какие коммиты задач в HEAD ещё не доехали и не осталось ли в worktree незакоммиченного.
// Команда только наблюдает: удаление worktree и веток остаётся явными `git worktree remove` и
// `git branch -D` в руках оркестратора, потому что снести чужую невлитую работу дороже, чем
// перечитать список. Своё дерево и своя ветка в перечень не попадают — убирают не за собой.
import path from 'node:path';
import process from 'node:process';
import { loadProject } from './config.js';
import { CliError, git, info, ok, parseCommandArgs, worktrees } from './util.js';
import { tr } from './i18n.js';

function localBranches(root) {
  const r = git(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/']);
  if (r.status !== 0) return [];
  return r.stdout.split('\n').map((b) => b.trim()).filter(Boolean);
}

// Коммиты задач, которых нет в HEAD. Ветка без них влита по существу, даже когда сама ссылка
// ещё жива, — и именно это отличает «убрать можно» от «потеряешь работу».
// `--grep` — только предфильтр: он матчит любую строку сообщения, а схлопнутый коммит тащит
// заголовки схлопнутых в тело. Решает заголовок, как в `lib/archive.js`.
function pendingCommits(root, ref, prefix) {
  if (ref === null) return [];
  const r = git(root, ['log', '--format=%h %s', ref, '--not', 'HEAD', `--grep=${prefix}-`]);
  if (r.status !== 0) return [];
  const subjectRe = new RegExp(`^${prefix}-\\d`);
  const out = [];
  for (const line of r.stdout.split('\n')) {
    const at = line.indexOf(' ');
    if (at === -1) continue;
    if (subjectRe.test(line.slice(at + 1))) out.push(line.trim());
  }
  return out;
}

// Незакоммиченное считается в самом worktree: `git -C <путь> status` смотрит его дерево, а не
// дерево, из которого запущена команда. Пустой список — чисто, null — спросить не удалось;
// это разные вещи, и сводить их к «чисто» значило бы звать к удалению вслепую.
function dirtyIn(wtPath) {
  const r = git(wtPath, ['status', '--porcelain']);
  if (r.status !== 0) return null;
  return r.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
}

export async function run(argv, { cwd }) {
  const { values } = parseCommandArgs(argv, { json: { type: 'boolean' } });
  const asJson = values.json === true;
  const { root, cfg } = loadProject(cwd);

  const top = git(root, ['rev-parse', '--show-toplevel']);
  if (top.status !== 0) {
    throw new CliError(tr(cfg.lang,
      'git-репозитория нет: перечислять worktree и ветки захода нечем',
      'there is no git repository: worktrees and run branches cannot be listed'));
  }
  const here = path.resolve(top.stdout.trim());
  const current = git(root, ['branch', '--show-current']);
  const currentBranch = current.status === 0 ? current.stdout.trim() : '';

  const entries = [];
  const seenBranch = new Set();
  for (const wt of worktrees(root)) {
    if (path.resolve(wt.path) === here) continue;
    // Detached worktree меряется по своему sha (`HEAD <sha>` porcelain даёт всегда): ветки у него
    // нет, а работа в нём — есть; «влитость не проверена» там, где git готов ответить, было бы
    // отговоркой.
    const ref = wt.branch ?? wt.head;
    if (wt.branch !== null) seenBranch.add(wt.branch);
    entries.push({
      kind: 'worktree',
      path: wt.path,
      branch: wt.branch,
      head: wt.head,
      merged: ref !== null && git(root, ['merge-base', '--is-ancestor', ref, 'HEAD']).status === 0,
      pending: pendingCommits(root, ref, cfg.prefix),
      dirty: dirtyIn(wt.path),
    });
  }
  // Ветка без worktree попадает в перечень, только когда несёт коммиты задач мимо HEAD: «есть
  // коммиты задач в истории» верно для любой ветки, отросшей от main, и перечня из этого не
  // выходит. Worktree перечисляется всегда — его удаляют как каталог, даже когда он влит.
  for (const branch of localBranches(root)) {
    if (branch === currentBranch || seenBranch.has(branch)) continue;
    const pending = pendingCommits(root, branch, cfg.prefix);
    if (!pending.length) continue;
    entries.push({
      kind: 'branch',
      path: null,
      branch,
      head: null,
      merged: git(root, ['merge-base', '--is-ancestor', branch, 'HEAD']).status === 0,
      pending,
      dirty: null,
    });
  }

  if (asJson) {
    process.stdout.write(`${JSON.stringify({ tracks: entries, total: entries.length }, null, 2)}\n`);
    return 0;
  }

  // Влитость и неслитые коммиты печатаются порознь: ветка бывает не предком HEAD и при этом без
  // своих коммитов задач — после переписи истории, — и одно из двух вводило бы в заблуждение.
  for (const e of entries) {
    info(e.kind === 'worktree' ? `${e.path} (${e.branch ?? 'detached'})` : e.branch);
    info(e.merged
      ? tr(cfg.lang, '  влит в HEAD', '  merged into HEAD')
      : tr(cfg.lang, '  не влит в HEAD', '  not merged into HEAD'));
    if (e.pending.length) {
      info(tr(cfg.lang, `  не влито коммитов задач: ${e.pending.length}`, `  task commits not in HEAD: ${e.pending.length}`));
      for (const c of e.pending) info(`    ${c}`);
    } else {
      info(tr(cfg.lang, '  не влитых коммитов задач нет', '  no task commits outside HEAD'));
    }
    // У ветки без worktree дерева нет, и молчание тут — не «чисто», а «нечего смотреть»;
    // у worktree чистота называется вслух, иначе её не отличить от непроверенной.
    if (e.kind !== 'worktree') continue;
    if (e.dirty === null) info(tr(cfg.lang, '  незакоммиченное: спросить не удалось', '  uncommitted: could not be checked'));
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
