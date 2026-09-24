// Миграция формата файлов проекта на версию инструмента. Новая миграция — запись в
// MIGRATIONS с версией, начиная с которой она нужна, и функцией, которая переписывает файлы.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadProject, saveConfig } from './config.js';
import { projectName } from './init.js';
import { logFile } from './log.js';
import { symlinkComponent } from './mdwalk.js';
import { renderProjectTemplate } from './templates.js';
import { CliError, git, info, ok, parseCommandArgs, toPosix, warn } from './util.js';
import { TOOL_VERSION, compareVersions } from './version.js';
import { tr } from './i18n.js';

// [{ since: 'X.Y.Z', title: { ru, en }, run(project) }] — применяются к проекту со штампом ниже `since`.
export const MIGRATIONS = [
  {
    since: '0.9.0',
    title: { ru: 'каталог статуса minor/', en: 'status directory minor/' },
    run({ dirs }) {
      const keep = path.join(dirs.statusDir.minor, '.gitkeep');
      if (existsSync(keep)) return;
      mkdirSync(path.dirname(keep), { recursive: true });
      writeFileSync(keep, '');
    },
  },
  {
    since: '0.10.0',
    title: { ru: 'журнал закрытых docs/archive/LOG.md', en: 'closed task journal docs/archive/LOG.md' },
    // Заводит пустой журнал и больше ничего: апгрейд не сносит архив молча, свёртка — отдельным
    // ходом `fold` (ADR-026).
    run({ cfg, dirs }) {
      const file = logFile(dirs);
      if (existsSync(file)) return;
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, renderProjectTemplate(cfg, 'docs/archive/LOG.md', { cli: cfg.cli, prefix: cfg.prefix }));
    },
  },
];

// Правила ведения и архива принадлежат инструменту: при штампе ниже его версии migrate
// перерисовывает их из шаблона этой версии — ADR-032. Остальной скелет docs — проектный.
export const RULES_DOCS = ['backlog/README.md', 'archive/README.md'];

// План идёт до первой записи: незакоммиченная правка — отказ, путь через symlink — пропуск,
// иначе запись ушла бы за ссылку в чужой файл (прецедент ADR-016).
function planRules({ root, cfg, dirs }) {
  const vars = { prefix: cfg.prefix, docs: cfg.docs, cli: cfg.cli, project: projectName(root) };
  const plan = { write: [], links: [], noGit: false };
  for (const rel of RULES_DOCS) {
    const file = path.join(dirs.docs, ...rel.split('/'));
    const text = renderProjectTemplate(cfg, `docs/${rel}`, vars);
    if (existsSync(file) && readFileSync(file, 'utf8') === text) continue;
    const out = toPosix(path.relative(root, file));
    const link = symlinkComponent(root, file);
    if (link !== null) plan.links.push({ out, link });
    else plan.write.push({ file, text, out });
  }
  if (!plan.write.length) return plan;
  const status = git(root, ['status', '--porcelain', '--', ...plan.write.map((w) => w.out)]);
  if (status.status !== 0) {
    plan.noGit = true;
  } else if (status.stdout.trim()) {
    const dirty = status.stdout.trimEnd().split('\n').map((line) => line.slice(3)).join(', ');
    throw new CliError(tr(cfg.lang,
      `${dirty}: незакоммиченная правка — migrate перерисовал бы файл из шаблона и стёр её без следа в истории; закоммить или откати правку, затем повтори`,
      `${dirty}: uncommitted edit — migrate would rewrite the file from the template and erase it with no trace in history; commit or revert the edit, then retry`));
  }
  return plan;
}

export async function run(argv, { cwd }) {
  const { values } = parseCommandArgs(argv, { 'dry-run': { type: 'boolean' } });
  const dry = values['dry-run'] === true;
  const project = loadProject(cwd);
  const { root, cfg } = project;
  const from = cfg.version ?? null;
  if (from && compareVersions(from, TOOL_VERSION) > 0) {
    throw new CliError(tr(cfg.lang, `штамп v${from} новее инструмента v${TOOL_VERSION}: обнови установку или пин в cli, назад формат не переводится`, `version stamp v${from} is newer than tool v${TOOL_VERSION}: update the installation or cli pin; file formats cannot be migrated backwards`));
  }
  const due = MIGRATIONS.filter((m) => from === null || compareVersions(from, m.since) < 0);
  const rules = from === null || compareVersions(from, TOOL_VERSION) < 0 ? planRules(project) : null;
  if (!due.length) {
    info(tr(cfg.lang, `мигрировать нечего: формат файлов не менялся${from ? ` с v${from}` : ''} до v${TOOL_VERSION}`, `nothing to migrate: file format did not change${from ? ` from v${from}` : ''} through v${TOOL_VERSION}`));
  }
  for (const m of due) {
    info(tr(cfg.lang, `миграция до v${m.since}: ${m.title.ru}${dry ? ' (--dry-run)' : ''}`, `migration through v${m.since}: ${m.title.en}${dry ? ' (--dry-run)' : ''}`));
    if (!dry) await m.run(project);
  }
  if (rules) {
    for (const { out, link } of rules.links) {
      warn(tr(cfg.lang,
        `${out}: путь идёт через symlink ${link} — правила не перерисованы, запись ушла бы за ссылку`,
        `${out}: the path goes through the symlink ${link} — rules not rewritten, the write would land behind the link`));
    }
    const names = rules.write.map((w) => w.out).join(', ');
    const noGit = rules.noGit ? tr(cfg.lang, ' — git нет, незакоммиченных правок проверить нечем', ' — no git, uncommitted edits could not be checked') : '';
    if (names || !rules.links.length) {
      info(tr(cfg.lang,
        `правила ведения и архива из шаблона v${TOOL_VERSION}: ${names ? `${dry ? 'перерисовать' : 'перерисованы'} ${names}` : 'уже совпадают'}${dry ? ' (--dry-run)' : ''}${noGit}`,
        `tracking and archive rules from the v${TOOL_VERSION} template: ${names ? `${dry ? 'would rewrite' : 'rewritten'} ${names}` : 'already match'}${dry ? ' (--dry-run)' : ''}${noGit}`));
    }
    if (!dry) {
      for (const { file, text } of rules.write) {
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, text);
      }
    }
  }
  if (!dry && from !== TOOL_VERSION) {
    cfg.version = TOOL_VERSION;
    saveConfig(root, cfg);
    info(tr(cfg.lang, `штамп версии: ${from ? `v${from}` : 'не было'} → v${TOOL_VERSION}`, `version stamp: ${from ? `v${from}` : 'missing'} → v${TOOL_VERSION}`));
  }
  ok(tr(cfg.lang, `migrate: проект на v${dry ? (from ?? '?') : TOOL_VERSION}`, `migrate: project is on v${dry ? (from ?? '?') : TOOL_VERSION}`));
  return 0;
}
