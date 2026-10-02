// Merging two CHANGELOG.md revisions by structure units: `-X ours`/`-X theirs` silently lose the
// neighbour's entries (ADR-043). Only the unreleased section merges; released ones are ours.
import { statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { entryTitle, sectionVersion, splitSections, taggedVersions, unreleasedIndex } from './changelog-format.js';
import { CliError, bad, git, gitCause, note, parseCommandArgs, readText, toPosix, warn, writeText } from './util.js';
import { eolOf } from './text.js';
import { findRoot } from './config.js';
import { msg, msgBoth } from './i18n.js';

const CHANGELOG_FILE = 'CHANGELOG.md';
// A `### Fixed` heading is not an entry: without a rule of its own it would slip into the previous
// entry's body with the section tail, giving a duplicate heading and a false body divergence.
const HEADING = /^#{3,6} \S/;
// A bold subgroup inside a section: `**For workspace users:**` on its own line. It does not match
// `entryTitle`, but the entry's membership in it is kept.
const SUBGROUP = /^\*\*.+\*\*$/;
// A top-level bullet without a bold title. It is not an entry, nor a continuation of the
// neighbouring entry: a continuation is indented, and this one starts in the first column.
const PLAIN_ITEM = /^[-*+] /;

export const CONFLICT_MARK = '<!-- backslop:conflict';
// The mark is a whole line from the first column, as `conflictEntry` puts it: the mark's name in
// prose, in a code span or in an indented code block is not a mark (docs/reference/02-cli.md).
const MARK_LINE = /^<!-- backslop:conflict/;
const countMarks = (lines) => lines.filter((line) => MARK_LINE.test(line)).length;

const bodyOf = (block) => block.lines.join('\n').trim();
// The block's name in the report: an entry by its title, a bullet without a bold title by the start
// of its text; an unnamed one is named too: a one-sided bullet must not arrive silently.
const label = (block) => {
  if (block.title) return block.title;
  const first = block.lines[0].replace(/^[-*+] /, '').trim();
  return first.length > 60 ? `${first.slice(0, 57)}…` : first;
};
// A block's lines without trailing blanks: the blank lines are the gap before the next block and
// travel with it, so the file layout does not change from a reshuffle.
const withoutTail = (lines) => {
  let n = lines.length;
  while (n > 0 && lines[n - 1].trim() === '') n -= 1;
  return lines.slice(0, n);
};

// Reversible parse: `lead`, `open` and the block lines in a row give the input exactly (ADR-043). A
// container is "### heading + bold subgroup", a block an `- **…**` entry or a bare bullet.
function parseSection(lines) {
  const lead = [];
  const containers = [];
  let heading = null;
  let container = null;
  let block = null;

  const start = (nextHeading, subgroup, open) => {
    heading = nextHeading;
    container = { key: `${nextHeading ?? ''}\u0000${subgroup ?? ''}`, heading: nextHeading, subgroup, open, blocks: [] };
    containers.push(container);
    block = null;
  };

  for (const raw of lines) {
    if (HEADING.test(raw)) { start(raw.trim(), null, [raw]); continue; }
    if (SUBGROUP.test(raw.trimEnd())) { start(heading, raw.trim(), [raw]); continue; }
    const title = entryTitle(raw);
    if (title !== null || PLAIN_ITEM.test(raw)) {
      if (!container) start(null, null, []);
      block = { title, lines: [raw] };
      container.blocks.push(block);
      continue;
    }
    if (block) block.lines.push(raw);
    else if (container) container.open.push(raw);
    else lead.push(raw);
  }
  for (const c of containers) for (const b of c.blocks) b.id = b.title ?? `\u0001${bodyOf(b)}`;
  markTailCarrier(containers);
  return { lead, containers };
}

const blanksAfter = (lines) => lines.length - withoutTail(lines).length;

// The last block of a side carries the section tail. Once another block follows it anywhere in
// the result, it keeps one trailing blank line.
function markTailCarrier(containers) {
  const last = containers.at(-1)?.blocks.at(-1);
  if (last) last.carrier = true;
}

function emitLines(block, followed) {
  if (!block.carrier || !followed) return block.lines;
  return block.lines.slice(0, block.lines.length - Math.max(0, blanksAfter(block.lines) - 1));
}

// Diverged bodies under one title are for the agent to pick: both entries under a mark, gate 7 goes
// red on the duplicate title, and the command exits non-zero and names the mark.
function conflictEntry(ours, theirs) {
  const body = withoutTail(ours.lines);
  return {
    id: ours.id,
    title: ours.title,
    carrier: ours.carrier,
    lines: [`${CONFLICT_MARK} ${ours.title} -->`, ...body, '', ...withoutTail(theirs.lines), ...ours.lines.slice(body.length)],
  };
}

// A repeat of a block inside one side will not reach the result, so "+N / −0" is wrong: the report
// names it. Per side: in a shared `seen` a theirs repeat looks like an ours block.
function repeatedBlocks(parsed) {
  const seen = new Set();
  const repeats = [];
  for (const c of parsed.containers) {
    for (const b of c.blocks) {
      if (seen.has(b.id)) repeats.push(label(b));
      else seen.add(b.id);
    }
  }
  return repeats;
}

function indexBlocks(parsed) {
  const byId = new Map();
  for (const c of parsed.containers) for (const b of c.blocks) if (!byId.has(b.id)) byId.set(b.id, b);
  return byId;
}

function countEntries(parsed) {
  return parsed.containers.reduce((n, c) => n + c.blocks.filter((b) => b.title !== null).length, 0);
}

// Recognising the unreleased blocks in the merge base: only it tells "the side removed an entry"
// from "the side never had it".
function baseUnreleased(text, released) {
  const { sections } = splitSections(text);
  const at = unreleasedIndex(sections, released);
  if (at === -1) return { title: null, ids: new Set() };
  return { title: sections[at].title, ids: new Set(indexBlocks(parseSection(sections[at].lines)).keys()) };
}

// A one-sided entry of theirs goes after the nearest entry preceding it in theirs that already lies
// in the result; none: first; no common entry in the container at all: at the end (ADR-043).
function insertionPoint(target, blocks, from) {
  for (let j = from - 1; j >= 0; j -= 1) {
    const at = target.blocks.findIndex((b) => b.id === blocks[j].id);
    if (at !== -1) return at + 1;
  }
  return blocks.some((b) => target.blocks.some((t) => t.id === b.id)) ? 0 : target.blocks.length;
}

const countLines = (lines, key) => {
  const counts = new Map();
  for (const raw of lines) {
    const k = key(raw);
    if (k !== null) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
};

const headingKey = (raw) => (HEADING.test(raw) || SUBGROUP.test(raw.trimEnd()) ? raw.trim() : null);

// A self-check of the result before it is handed over: a violated invariant is a refusal with a
// reason, not a warning on stderr that the caller need not read (ADR-043).
function checkInvariants(merged, oursLines, theirsLines, report, lang) {
  const fails = [];
  const mergedHeads = countLines(merged, headingKey);
  const oursHeads = countLines(oursLines, headingKey);
  const theirsHeads = countLines(theirsLines, headingKey);
  for (const [title, n] of mergedHeads) {
    const limit = Math.max(oursHeads.get(title) ?? 0, theirsHeads.get(title) ?? 0);
    if (n > limit) {
      fails.push(msgBoth(lang,
        'heading “{title}” occurs {n} times in the section, at most {limit} on either side', { title, n, limit }));
    }
  }

  // An additive merge (nothing removed per the base) loses no line of ours: the diff against it is
  // a pure `+N / −0`.
  if (!report.dropped.length) {
    const seen = countLines(merged, (raw) => (raw.trim() === '' ? null : raw.trim()));
    const lost = [];
    for (const [line, n] of countLines(oursLines, (raw) => (raw.trim() === '' ? null : raw.trim()))) {
      if ((seen.get(line) ?? 0) < n) lost.push(line);
    }
    if (lost.length && report.duplicatesOurs.length) {
      // Ours lines go missing when ours carries two blocks with one identity and the second is
      // dropped as a repeat: the refusal names the repeat, not a loss.
      fails.push(msgBoth(lang,
        'the ours side carries a repeated block and the second occurrence was dropped: {blocks}', {
          blocks: (l) => report.duplicatesOurs.map((d) => msg(l, '“{name}”', { name: d })).join(', '),
        }));
    }
  }

  if (fails.length) {
    throw new CliError(msgBoth(lang,
      'the merge failed its own check and the file was not handed over: {fails}', { fails: fails.join('; ') }));
  }
}

// `released(version)` tells whether the version `X.Y.Z` is released; by default any version is.
export function mergeChangelog(oursText, theirsText, baseText = null, lang = 'ru', released = () => true, eol = eolOf(oursText)) {
  const ours = splitSections(oursText);
  const theirs = splitSections(theirsText);
  const oursAt = unreleasedIndex(ours.sections, released);
  if (oursAt === -1) {
    throw new CliError(msgBoth(lang,
      '{changelog} on the --ours side has no unreleased section (a “## …” heading that does not start with a version, or a top section whose version has no tag)', { changelog: CHANGELOG_FILE }));
  }
  const theirsAt = unreleasedIndex(theirs.sections, released);
  const oursLines = ours.sections[oursAt].lines;
  const theirsLines = theirsAt === -1 ? [] : theirs.sections[theirsAt].lines;
  // A previous merge's mark in the merged section is an unclosed conflict: a second revision on top
  // would vanish as a duplicate. Only mark lines count, here only (docs/reference/02-cli.md).
  for (const [side, lines] of [['--ours', oursLines], ['--theirs', theirsLines]]) {
    if (countMarks(lines)) {
      throw new CliError(msgBoth(lang,
        'the unreleased section on the {side} side carries an unresolved {mark} mark: close the previous merge before merging on top of it', { side, mark: CONFLICT_MARK }));
    }
  }
  const oursSection = parseSection(oursLines);
  const theirsSection = theirsAt === -1 ? { lead: [], containers: [] } : parseSection(theirsLines);
  const theirsById = indexBlocks(theirsSection);
  // An entry's title identifies it across the whole section: the same entry standing in different
  // containers on the two sides would otherwise lie twice and turn gate 7 red.
  const base = baseText === null ? null : baseUnreleased(baseText, released);
  const baseIds = base?.ids ?? null;

  const report = { section: { ours: ours.sections[oursAt].title, theirs: theirsAt === -1 ? null : theirs.sections[theirsAt].title, base: base?.title ?? null }, ours: countEntries(oursSection), theirs: countEntries(theirsSection), conflicts: [], onlyOurs: [], onlyTheirs: [], onlyOursPlain: [], onlyTheirsPlain: [], dropped: [], duplicatesOurs: repeatedBlocks(oursSection), duplicatesTheirs: repeatedBlocks(theirsSection), placed: [] };
  const merged = [];
  const byKey = new Map();
  const seen = new Set();

  // Ours sets the layout: containers and blocks as they are, with the same blank lines. An empty
  // container too: its heading was written by hand.
  for (const c of oursSection.containers) {
    const out = { key: c.key, heading: c.heading, open: c.open, blocks: [] };
    merged.push(out);
    byKey.set(c.key, out);
    for (const b of c.blocks) {
      if (seen.has(b.id)) continue;
      seen.add(b.id);
      const other = theirsById.get(b.id);
      if (other) {
        if (bodyOf(b) === bodyOf(other)) out.blocks.push(b);
        else {
          report.conflicts.push(b.title);
          out.blocks.push(conflictEntry(b, other));
        }
        continue;
      }
      // Without a base new and removed look alike: the entry stays, named. A title-less bullet is
      // never dropped per the base: it may be "rewritten", and a loss is worse than a duplicate.
      if (b.title && baseIds?.has(b.id)) {
        report.dropped.push(b.title);
        continue;
      }
      (b.title ? report.onlyOurs : report.onlyOursPlain).push(label(b));
      out.blocks.push(b);
    }
  }

  const lastOf = (heading) => merged.findLastIndex((m) => m.heading === heading);
  const insert = (at, c) => {
    const out = { key: c.key, heading: c.heading, open: c.open, blocks: [] };
    merged.splice(at, 0, out);
    byKey.set(c.key, out);
    return out;
  };
  // A theirs-only container goes after the last one of its heading; a heading ours lacks comes
  // with its nearest theirs heading line, after the nearest group before it already placed.
  const place = (c) => {
    if (c.heading !== null && lastOf(c.heading) === -1) {
      const all = theirsSection.containers;
      const head = all.slice(0, all.indexOf(c) + 1).findLast((t) => t.heading === c.heading && t.subgroup === null);
      const prev = all.slice(0, all.indexOf(head)).findLast((t) => lastOf(t.heading) !== -1);
      const at = prev ? lastOf(prev.heading) + 1 : merged.length;
      const added = insert(at, head);
      report.placed.push({ heading: c.heading, subgroup: null, before: merged[at + 1]?.heading ?? null });
      if (head === c) return added;
    }
    report.placed.push({ heading: c.heading, subgroup: c.subgroup });
    return insert(c.heading === null && c.subgroup === null ? 0 : lastOf(c.heading) + 1, c);
  };

  for (const c of theirsSection.containers) {
    for (let i = 0; i < c.blocks.length; i += 1) {
      const b = c.blocks[i];
      if (seen.has(b.id)) continue;
      seen.add(b.id);
      if (b.title && baseIds?.has(b.id)) {
        report.dropped.push(b.title);
        continue;
      }
      (b.title ? report.onlyTheirs : report.onlyTheirsPlain).push(label(b));
      const target = byKey.get(c.key) ?? place(c);
      target.blocks.splice(insertionPoint(target, c.blocks, i), 0, b);
    }
  }

  report.merged = merged.reduce((n, c) => n + c.blocks.filter((b) => b.title !== null).length, 0);

  const section = [...oursSection.lead];
  const lastBlock = merged.at(-1)?.blocks.at(-1);
  for (const c of merged) {
    section.push(...c.open);
    for (const b of c.blocks) section.push(...emitLines(b, b !== lastBlock));
  }
  // The gap before the next section is set by ours: a last block removed per the base carried it
  // off.
  const tail = (lines) => lines.length - withoutTail(lines).length;
  for (let n = tail(oursLines) - tail(section); n > 0; n -= 1) section.push('');
  report.marks = countMarks(section);
  checkInvariants(section, oursLines, theirsLines, report, lang);

  const out = [...ours.head];
  ours.sections.forEach((s, i) => {
    out.push(`## ${s.title}`);
    out.push(...(i === oursAt ? section : s.lines));
  });
  const text = out.join(eol);
  return { text: text.endsWith(eol) ? text : `${text}${eol}`, report };
}

function readRevision(root, ref, lang) {
  const r = git(root, ['show', `${ref}:./${CHANGELOG_FILE}`]);
  if (r.status !== 0) {
    throw new CliError(msgBoth(lang, 'cannot read {ref}:{changelog} — {cause}', { ref, changelog: CHANGELOG_FILE, cause: (l) => gitCause(r, l) }));
  }
  return r.stdout;
}

// An fs failure on --out is a refusal naming the path and the code, not a node:fs stack.
function onOut(file, lang, step) {
  try {
    return step();
  } catch (e) {
    throw new CliError(msgBoth(lang, 'cannot write --out {file}: {cause}', { file, cause: e.code ?? e.message }));
  }
}

export async function run(argv, { cwd, lang }) {
  const { values } = parseCommandArgs(argv, {
    ours: { type: 'string' }, theirs: { type: 'string' }, base: { type: 'string' }, out: { type: 'string' },
  }, { positionals: 0, lang });
  const root = findRoot(cwd) ?? path.resolve(cwd);
  if (!values.ours || !values.theirs) {
    throw new CliError(msgBoth(lang,
      'both --ours <ref> and --theirs <ref> are required: two CHANGELOG.md revisions from git'));
  }
  if (values.base !== undefined && !values.base.trim()) {
    throw new CliError(msgBoth(lang,
      '--base is empty: pass --base <ref>, the merge-base revision, or drop the flag'));
  }
  const out = values.out === undefined ? null : path.resolve(cwd, values.out);
  // An existing --out keeps its line endings: with core.autocrlf the blob is LF, the file CRLF.
  const onDisk = out === null ? '' : onOut(out, lang, () => (statSync(out, { throwIfNoEntry: false })?.isFile() ? readText(out) : ''));
  const oursText = readRevision(root, values.ours, lang);
  const { text, report } = mergeChangelog(
    oursText,
    readRevision(root, values.theirs, lang),
    values.base === undefined ? null : readRevision(root, values.base, lang),
    lang,
    taggedVersions(root, lang),
    onDisk.includes('\n') ? eolOf(onDisk) : eolOf(oursText),
  );
  if (out === null) process.stdout.write(text);
  else onOut(out, lang, () => writeText(out, text));

  note(msgBoth(lang,
    'entries: ours {ours}, theirs {theirs}, merged {merged}', { ours: report.ours, theirs: report.theirs, merged: report.merged }));
  if (report.section.theirs === null) {
    note(msgBoth(lang, 'theirs has no unreleased section — its entries were not read'));
  }
  for (const [side, title] of Object.entries(report.section)) {
    if (title !== null && sectionVersion(title) !== null) {
      note(msgBoth(lang, 'unreleased section in {side} — “{title}”: the version has no tag', { side, title }));
    }
  }
  if (out !== null) note(msgBoth(lang, 'written: {out}', { out: toPosix(path.relative(cwd, out)) }));
  for (const title of report.onlyOurs) note(msgBoth(lang, 'only in ours: {title}', { title }));
  for (const title of report.onlyTheirs) note(msgBoth(lang, 'only in theirs: {title}', { title }));
  // Bullets without a bold title go on separate lines and are not counted as entries: an entry is
  // identified by its title, this block by its text, and their counts must not be mixed.
  for (const what of report.onlyOursPlain) note(msgBoth(lang, 'only in ours, bullet with no bold heading: {what}', { what }));
  for (const what of report.onlyTheirsPlain) note(msgBoth(lang, 'only in theirs, bullet with no bold heading: {what}', { what }));
  const section = `## ${report.section.ours}`;
  for (const { heading, subgroup, before } of report.placed) {
    if (subgroup !== null) note(msgBoth(lang, 'subgroup {subgroup} added under {heading}', { subgroup, heading: heading ?? section }));
    else if (heading === null) note(msgBoth(lang, 'entries without a heading added at the top of {section}', { section }));
    else if (before !== null) note(msgBoth(lang, 'heading {heading} added before {before}', { heading, before }));
    else note(msgBoth(lang, 'heading {heading} added at the end of {section}', { heading, section }));
  }
  // A dropped repeat is always named, not only when it came to a refusal: with a `--base` that
  // removed at least one entry there is no refusal, yet a content line is gone all the same.
  for (const what of report.duplicatesOurs) note(msgBoth(lang, 'repeated block in ours, the second occurrence dropped: {what}', { what }));
  for (const what of report.duplicatesTheirs) note(msgBoth(lang, 'repeated block in theirs, the second occurrence dropped: {what}', { what }));
  for (const title of report.dropped) note(msgBoth(lang, 'removed relative to --base: {title}', { title }));
  if (report.conflicts.length) {
    warn(msgBoth(lang,
      'bodies differ under one heading — both revisions kept under the {mark} mark, decide yourself: {conflicts}', { mark: CONFLICT_MARK, conflicts: report.conflicts.join('; ') }));
  }
  if (values.base === undefined) {
    note(msgBoth(lang,
      'without --base a removed entry is indistinguishable from a neighbour’s new one — one-sided entries are kept'));
  }
  // An unclosed conflict is not a success. Marks are counted by the mark lines of the merged
  // section, as on input: prose in a code span of a released section would give a false refusal.
  const marks = report.marks;
  if (marks) {
    bad(msgBoth(lang,
      '{marks} {mark} mark(s) left in the result — the conflict is not closed: pick a revision and remove the mark', { marks, mark: CONFLICT_MARK }));
    return 1;
  }
  return 0;
}
