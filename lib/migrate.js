// Миграция формата файлов проекта на версию инструмента. Форматы задачи, архива, ADR и
// конфига не менялись с v0.1.0, поэтому пока здесь только штамп: список миграций пуст, и
// команда честно говорит об этом. Новая миграция — запись в MIGRATIONS с версией, начиная
// с которой она нужна, и функцией, которая переписывает файлы.
import { loadProject, saveConfig } from './config.js';
import { CliError, info, ok, parseCommandArgs } from './util.js';
import { TOOL_VERSION, compareVersions } from './version.js';
import { tr } from './i18n.js';

// [{ since: 'X.Y.Z', title, run(project) }] — применяются к проекту со штампом ниже `since`.
export const MIGRATIONS = [];

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
  if (!due.length) {
    info(tr(cfg.lang, `мигрировать нечего: формат файлов не менялся${from ? ` с v${from}` : ''} до v${TOOL_VERSION}`, `nothing to migrate: file format did not change${from ? ` from v${from}` : ''} through v${TOOL_VERSION}`));
  }
  for (const m of due) {
    info(tr(cfg.lang, `миграция до v${m.since}: ${m.title}${dry ? ' (--dry-run)' : ''}`, `migration through v${m.since}: ${m.title}${dry ? ' (--dry-run)' : ''}`));
    if (!dry) await m.run(project);
  }
  if (!dry && from !== TOOL_VERSION) {
    cfg.version = TOOL_VERSION;
    saveConfig(root, cfg);
    info(tr(cfg.lang, `штамп версии: ${from ? `v${from}` : 'не было'} → v${TOOL_VERSION}`, `version stamp: ${from ? `v${from}` : 'missing'} → v${TOOL_VERSION}`));
  }
  ok(tr(cfg.lang, `migrate: проект на v${dry ? (from ?? '?') : TOOL_VERSION}`, `migrate: project is on v${dry ? (from ?? '?') : TOOL_VERSION}`));
  return 0;
}
