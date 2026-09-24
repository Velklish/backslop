// Тело свёрнутой задачи: строка журнала называет коммит, команда печатает `git show` по нему.
// Строка с коммитом `—` осталась от свёртки, которая не знала своего коммита (тело уехало в его
// же сообщение) — тогда коммит ищется по заголовку `<prefix>-N:`, тому же признаку, которым
// `archive` и `tracks` узнают коммиты задачи.
import path from 'node:path';
import process from 'node:process';
import { loadProject } from './config.js';
import { logFile } from './log.js';
import { findTask, formatId, parseId, scanTasks } from './tasks.js';
import { CliError, git, parseCommandArgs, toPosix, warn } from './util.js';
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

  // Ревизия из строки журнала держит тело ФАЙЛАМИ, и печатать надо их, а не коммит: `git show
  // <rev>` показывает сообщение и дифф той волны, в которой задача закрывалась, и тело в нём
  // видно только у файла, добавленного этим же коммитом. Штатное закрытие — переезд, и в диффе
  // переименования содержимого нет вовсе.
  const files = bodyFiles(root, cfg, task, rev);
  if (files.length) {
    const parts = [];
    for (const file of files) {
      // `<rev>:./<путь>` — от текущего каталога, в координатах `ls-tree` (в них же сверяет тело `bodyRev` в `lib/fold.js`):
      // без `./` git берёт путь от корня рабочего дерева, и в проекте-подкаталоге чтение отказывает.
      const blob = git(root, ['show', `${rev}:./${file}`]);
      if (blob.status !== 0) continue;
      parts.push(`--- ${file} ---`, '', blob.stdout.trimEnd(), '');
    }
    if (parts.length) {
      process.stdout.write(`${parts.join('\n')}\n`);
      return 0;
    }
  }

  // Тела файлом в этой ревизии нет — значит оно уехало в сообщение коммита, как это делает
  // одиночная свёртка. Тогда печатается сам коммит, и причина названа вслух.
  warn(tr(cfg.lang,
    `тела файлом в ${rev} нет — печатается коммит целиком: у свёрнутой поодиночке задачи тело лежит в его сообщении`,
    `no body file in ${rev} — printing the whole commit: a task folded on its own keeps its body in the commit message`));
  const show = git(root, ['show', rev]);
  if (show.status !== 0) {
    throw new CliError(tr(cfg.lang,
      `git show ${rev}: ${(show.stderr ?? '').trim() || `код ${show.status}`} — коммит из строки ${logRel} в этом клоне не читается`,
      `git show ${rev}: ${(show.stderr ?? '').trim() || `exit code ${show.status}`} — the commit named by the ${logRel} line is not readable in this clone`));
  }
  process.stdout.write(show.stdout);
  return 0;
}

// Пути тела задачи в названной ревизии. Дерево ревизии читается целиком по `<docs>/archive`, а не
// собирается из номера и slug: у записи, закрытой пачкой, файл лежит в подкаталоге `minor/` чужого
// каталога, и собранный путь на неё не наведёт. Пути приходят от ТЕКУЩЕГО каталога — `ls-tree`
// без `--full-name` печатает их так, — и читаются потом формой `<rev>:./<путь>` в той же системе
// координат.
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

// Номер сравнивается числом, как в гейтах и в `archive`: коммит `BS-7:` относится и к записи
// `BS-007`. `--grep` — только предфильтр, решает первая строка сообщения: squash тащит заголовки
// схлопнутых коммитов в тело.
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
