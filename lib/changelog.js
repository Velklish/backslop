// An excerpt of backslop's own CHANGELOG between versions: `upgrade` prints it after moving to a
// new version, so the project sees what changed without opening the tool's repository.
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { TOOL_VERSION, compareVersions, normalizeVersion } from './version.js';
import { CliError, parseCommandArgs } from './util.js';
import { msg } from './i18n.js';
import { sectionVersion, splitSections } from './changelog-format.js';

const CHANGELOG_FILE = new URL('../CHANGELOG.md', import.meta.url);

// Sections whose title starts with a version; the rest (`Unreleased`, `Unreleased (after v1.0.0)`)
// are skipped.
function changelogSections(text) {
  return splitSections(text).sections
    .map((s) => ({ ...s, version: normalizeVersion(sectionVersion(s.title)) }))
    .filter((s) => s.version);
}

// Sections with a version strictly above `since` and not above `to`, in file order (the file is
// kept newest first).
export function changelogSince(text, since, to) {
  return changelogSections(text)
    .filter((s) => (since ? compareVersions(s.version, since) > 0 : true) && compareVersions(s.version, to) <= 0)
    .map((s) => `## ${s.title}\n${s.lines.join('\n').trim()}`)
    .join('\n\n');
}

export async function run(argv, { cwd, lang }) {
  const { values } = parseCommandArgs(argv, { since: { type: 'string' }, to: { type: 'string' } }, { positionals: 0, lang });
  const since = values.since === undefined ? null : normalizeVersion(values.since);
  const to = values.to === undefined ? TOOL_VERSION : normalizeVersion(values.to);
  if (values.since !== undefined && since === null) throw new CliError(msg(lang, '--since “{since}”: expected X.Y.Z', { since: values.since }));
  if (values.to !== undefined && to === null) throw new CliError(msg(lang, '--to “{to}”: expected X.Y.Z', { to: values.to }));
  const text = changelogSince(readFileSync(CHANGELOG_FILE, 'utf8'), since, to);
  const empty = since
    ? msg(lang, 'no entries after v{since} and through v{to}', { since, to })
    : msg(lang, 'no entries through v{to}', { to });
  process.stdout.write(text ? `${text}\n` : `${empty}\n`);
  return 0;
}
