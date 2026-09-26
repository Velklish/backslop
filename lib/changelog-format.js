// CHANGELOG.md structure shared by `changelog`, `merge-changelog`, `lint` and `release --bump`.
// A leaf: it imports no command module.
import { splitLines } from './text.js';

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
