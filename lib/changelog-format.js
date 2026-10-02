// CHANGELOG.md structure shared by `changelog`, `merge-changelog`, `lint` and `release --bump`.
// A leaf: it imports no command module.
import { splitLines } from './text.js';
import { CliError, git, gitCause } from './util.js';
import { msgBoth } from './i18n.js';

// The title of an entry line `- **title**`, or null. Gate 7 and `merge-changelog` read it alike, or
// they would match different sets; a `**` inside a code span does not close the title.
export function entryTitle(line) {
  if (!line.startsWith('- **')) return null;
  for (let i = 4; i < line.length; i += 1) {
    if (line[i] === '`') {
      let end = i;
      while (line[end] === '`') end += 1;
      const close = codeSpanEnd(line, line.slice(i, end), end);
      if (close !== -1) i = close - 1;
      else i = end - 1;
    } else if (i > 4 && line.startsWith('**', i)) {
      return line.slice(4, i);
    }
  }
  return null;
}

// The index after the run of backticks `fence` that closes a code span, or -1.
function codeSpanEnd(line, fence, from) {
  for (let at = line.indexOf(fence, from); at !== -1; at = line.indexOf(fence, at + 1)) {
    if (line[at - 1] !== '`' && line[at + fence.length] !== '`') return at + fence.length;
  }
  return -1;
}

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

// A tag `vX.Y.Z` or `X.Y.Z` makes a version released: an empty tag list after a git failure would
// silently make any top section unreleased.
export function taggedVersions(root, lang) {
  const r = git(root, ['tag', '--list']);
  if (r.status !== 0) {
    throw new CliError(msgBoth(lang, 'cannot read the tag list — {cause}', { cause: (l) => gitCause(r, l) }));
  }
  const tags = new Set(r.stdout.split('\n').map((t) => t.trim()).filter(Boolean));
  return (version) => tags.has(`v${version}`) || tags.has(version);
}
