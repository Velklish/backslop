// Выжимка из CHANGELOG самого backslop между версиями: её печатает upgrade после переезда
// на новую версию, чтобы проект увидел, что изменилось, не открывая репозиторий инструмента.
import { readFileSync } from 'node:fs';
import { compareVersions, normalizeVersion } from './version.js';
import { CliError, parseCommandArgs } from './util.js';
import { TOOL_VERSION } from './version.js';
import { findRoot, loadConfig } from './config.js';
import { tr } from './i18n.js';

const CHANGELOG_FILE = new URL('../CHANGELOG.md', import.meta.url);

// Секции `## …` с номером версии в заголовке; секции без номера («Не выпущено») пропускаются.
export function changelogSections(text) {
  const out = [];
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(/^## (.+)$/);
    if (m) {
      const version = normalizeVersion(m[1].match(/v?\d+\.\d+\.\d+/)?.[0]);
      current = version ? { version, title: m[1].trim(), lines: [] } : null;
      if (current) out.push(current);
      continue;
    }
    if (current) current.lines.push(raw);
  }
  return out;
}

// Секции с версией строго больше `since` и не больше `to`, от новой к старой.
export function changelogSince(text, since, to) {
  return changelogSections(text)
    .filter((s) => (since ? compareVersions(s.version, since) > 0 : true) && (to ? compareVersions(s.version, to) <= 0 : true))
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
