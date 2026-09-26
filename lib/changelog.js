// Выжимка из CHANGELOG самого backslop между версиями: её печатает upgrade после переезда
// на новую версию, чтобы проект увидел, что изменилось, не открывая репозиторий инструмента.
import { readFileSync } from 'node:fs';
import { TOOL_VERSION, compareVersions, normalizeVersion } from './version.js';
import { CliError, parseCommandArgs } from './util.js';
import { findRoot, loadConfig } from './config.js';
import { tr } from './i18n.js';
import { sectionVersion, splitSections } from './changelog-format.js';

const CHANGELOG_FILE = new URL('../CHANGELOG.md', import.meta.url);

// Sections whose title starts with a version; the rest («Не выпущено», `Unreleased (after v1.0.0)`)
// are skipped.
function changelogSections(text) {
  return splitSections(text).sections
    .map((s) => ({ ...s, version: normalizeVersion(sectionVersion(s.title)) }))
    .filter((s) => s.version);
}

// Секции с версией строго больше `since` и не больше `to`, от новой к старой.
export function changelogSince(text, since, to) {
  return changelogSections(text)
    .filter((s) => (since ? compareVersions(s.version, since) > 0 : true) && compareVersions(s.version, to) <= 0)
    .map((s) => `## ${s.title}\n${s.lines.join('\n').trim()}`)
    .join('\n\n');
}

export async function run(argv, { cwd }) {
  const { values } = parseCommandArgs(argv, { since: { type: 'string' }, to: { type: 'string' } });
  const root = findRoot(cwd);
  const lang = root ? loadConfig(root).lang : null;
  const since = values.since === undefined ? null : normalizeVersion(values.since);
  const to = values.to === undefined ? TOOL_VERSION : normalizeVersion(values.to);
  if (values.since !== undefined && since === null) throw new CliError(lang === null ? `--since “${values.since}”: expected X.Y.Z / нужна форма X.Y.Z` : tr(lang, `--since «${values.since}»: нужна форма X.Y.Z`, `--since “${values.since}”: expected X.Y.Z`));
  if (values.to !== undefined && to === null) throw new CliError(lang === null ? `--to “${values.to}”: expected X.Y.Z / нужна форма X.Y.Z` : tr(lang, `--to «${values.to}»: нужна форма X.Y.Z`, `--to “${values.to}”: expected X.Y.Z`));
  const text = changelogSince(readFileSync(CHANGELOG_FILE, 'utf8'), since, to);
  const empty = lang === 'en'
    ? `no entries ${since ? `after v${since} and ` : ''}through v${to}\n`
    : lang === 'ru' ? `записей ${since ? `после v${since} и ` : ''}до v${to} нет\n`
      : `no entries ${since ? `after v${since} and ` : ''}through v${to} / записей ${since ? `после v${since} и ` : ''}до v${to} нет\n`;
  process.stdout.write(text ? `${text}\n` : empty);
  return 0;
}
