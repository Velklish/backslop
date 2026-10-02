// CHANGELOG.md structure shared by `changelog`, `merge-changelog`, `lint` and `release --bump`.
// A leaf: it imports no command module.
import { splitLines } from './text.js';
import { CliError, git, gitCause } from './util.js';
import { msgBoth } from './i18n.js';

// An entry heading. Gate 7 finds duplicates in a section with it, `merge-changelog` matches the
// entries of two revisions: diverging, the two would merge different sets.
export const CHANGELOG_ENTRY = /^- \*\*(.+?)\*\*/;

const SECTION = /^## (.+)$/;
const SECTION_VERSION = /^\[?v?(\d+\.\d+\.\d+)/;

// The version a section title starts with, after an optional `[` and `v`; null for none.
export function sectionVersion(title) {
  return title.match(SECTION_VERSION)?.[1] ?? null;
}

// The head before the first `## ` section and the sections; section bodies stay lines as they were.
export function splitSections(text) {
  const head = [];
  const sections = [];
  let current = null;
  for (const raw of splitLines(text)) {
    const m = raw.match(SECTION);
    if (m) {
      current = { title: m[1].trim(), lines: [] };
      sections.push(current);
      continue;
    }
    (current ? current.lines : head).push(raw);
  }
  return { head, sections };
}

// No heading without a leading version: the top section is the unreleased one while its version
// has no tag, as `release --bump` leaves it before the release (ADR-043).
export function unreleasedIndex(sections, released) {
  const at = sections.findIndex((s) => sectionVersion(s.title) === null);
  if (at !== -1 || !sections.length) return at;
  return released(sectionVersion(sections[0].title)) ? -1 : 0;
}

// Выпущенной версию делает тег `vX.Y.Z` или `X.Y.Z`: пустой список тегов при сбое git молча
// сделал бы невыпущенной любую верхнюю секцию.
export function taggedVersions(root, lang) {
  const r = git(root, ['tag', '--list']);
  if (r.status !== 0) {
    throw new CliError(msgBoth(lang, 'cannot read the tag list — {cause}', { cause: (l) => gitCause(r, l) }));
  }
  const tags = new Set(r.stdout.split('\n').map((t) => t.trim()).filter(Boolean));
  return (version) => tags.has(`v${version}`) || tags.has(version);
}
