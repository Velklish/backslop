// Тело свёрнутой задачи: из ревизии строки журнала, а при `—` — из коммита, найденного по заголовку
// `<prefix>-N:`, как у `archive` и `tracks` (docs/reference/02-cli.md, `show`).
import path from 'node:path';
import process from 'node:process';
import { loadProject } from './config.js';
import { logFile } from './log.js';
import { findTask, formatId, parseId, scanTasks } from './tasks.js';
import { CliError, git, gitCause, parseCommandArgs, toPosix, warn } from './util.js';
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
  if (git(root, ['rev-parse', '--git-dir']).status !== 0) {
    throw new CliError(tr(cfg.lang, 'репозитория git нет — тело свёрнутой задачи достаётся только из истории', 'no git repository — the body of a folded task can only be read from history'));
  }

  const logRel = toPosix(path.relative(root, logFile(dirs)));
  const rev = task.log.commit ?? bySubject(root, cfg.prefix, task);
  if (rev === null) {
    throw new CliError(tr(cfg.lang,
      `${task.id}: строка ${logRel} коммита не называет, и коммита с заголовком «${task.id}: …» в истории нет — тело не достать`,
      `${task.id}: the ${logRel} line names no commit, and history holds no commit whose subject starts with “${task.id}: ” — the body cannot be retrieved`));
  }
  warn(`${task.id} · ${task.log.date} · ${task.log.outcome} · ${rev}`);

  // Ревизия держит тело ФАЙЛАМИ, и печатаются они, а не коммит: штатное закрытие — переезд, и в
  // диффе переименования содержимого нет вовсе.
  const files = bodyFiles(root, cfg, task, rev);
  if (files.length) {
    const parts = [];
    for (const file of files) {
      // `<rev>:./<путь>` — от текущего каталога, как пути `ls-tree` в `bodyRev` (`lib/fold.js`):
      // без `./` git берёт путь от корня дерева, и в проекте-подкаталоге чтение отказывает.
      const blob = git(root, ['show', `${rev}:./${file}`]);
      if (blob.status !== 0) continue;
      parts.push(`--- ${file} ---`, '', blob.stdout.trimEnd(), '');
    }
    if (parts.length) {
      process.stdout.write(`${parts.join('\n')}\n`);
      return 0;
    }
  }

  // Тела файлом в ревизии нет — оно в сообщении коммита, как у одиночной свёртки. Дифф не читается:
  // коммит приёмки массовой свёртки весит мегабайты, а тела в нём нет.
  warn(tr(cfg.lang,
    `тела файлом в ${rev} нет — печатается сообщение коммита: у свёрнутой поодиночке задачи тело лежит в нём`,
    `no body file in ${rev} — printing the commit message: a task folded on its own keeps its body there`));
  const show = git(root, ['show', '-s', '--format=%B', rev]);
  if (show.status !== 0) {
    throw new CliError(tr(cfg.lang,
      `git show ${rev}: ${gitCause(show, cfg.lang)} — коммит из строки ${logRel} в этом клоне не читается`,
      `git show ${rev}: ${gitCause(show, cfg.lang)} — the commit named by the ${logRel} line is not readable in this clone`));
  }
  process.stdout.write(show.stdout);
  return 0;
}

// Пути тела — из дерева ревизии по `<docs>/archive`: запись пачки лежит в `minor/` чужого каталога.
// `ls-tree` без `--full-name` даёт пути от текущего каталога — их и читает форма `<rev>:./<путь>`.
function bodyFiles(root, cfg, task, rev) {
  const tree = git(root, ['-c', 'core.quotePath=false', 'ls-tree', '-r', '--name-only', rev, '--', `${cfg.docs}/archive`]);
  if (tree.status !== 0) return [];
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const want = new RegExp(`(?:^|/)${esc(task.id)}-${esc(task.slug)}(?:/|\\.md$)`);
  // Постановка печатается перед результатом: по алфавиту `result.md` встал бы первым, а читают
  // закрытую задачу с того, что и зачем делали.
  const rank = (p) => (p.endsWith('/task.md') ? 0 : p.endsWith('/result.md') ? 1 : 2);
  return tree.stdout.split('\n').map((l) => l.trim()).filter((p) => p && want.test(p))
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
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
