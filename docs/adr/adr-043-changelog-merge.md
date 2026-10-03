# ADR-043: merge-changelog merges the unreleased section structurally and refuses rather than guess

**Status:** Accepted
**Date:** 2026-09-28
**Deciders:** Velklish

## Context

Every parallel worker edits `CHANGELOG.md`, so every acceptance merges it. `git merge -X ours` or `-X theirs` drops a neighbour's entries or duplicates hunks without a word, and a merge driver works only in a clone whose git config declares it. The merge has to be reproducible in any clone, must never pick a winner between two versions of one entry, must keep the author's layout so the diff against it shows only additions, and must report through its exit code, because a caller that does not read stderr still reads that. A version bump made before the work leaves the top section titled with a version that has no tag yet.

## Options

- **git merge strategies `-X ours` / `-X theirs`** — drop hunks silently.
- **A git merge driver** — needs per-clone configuration, so the result depends on the clone.
- **Ordering "ours first, then theirs"** — loses the position the author gave an entry.
- **A sum bound across both sides for the entry count** — never fires, so it checks nothing.

## Decision

- **Command.** `merge-changelog --ours <ref> --theirs <ref> [--base <ref>] [--out <file>]`; `--ours` and `--theirs` are required, and an empty `--base` is refused (`run` in `lib/merge-changelog.js`). Each revision is read with `git show <ref>:./CHANGELOG.md` from the project root; an unreadable revision is a refusal (`readRevision`).
- **The unreleased section.** It is the first `## ` section whose title does not start with a version, and if there is none, the top section when its version has no tag `vX.Y.Z` or `X.Y.Z` (`unreleasedIndex`). A title starts with a version when the version stands at its very start, after an optional `[` and `v` (`sectionVersion` in `lib/changelog-format.js`): `## v1.2.3 — date`, `## [1.2.3] - date` and `## 1.2.3` are releases, `## Release 1.2.3` is not. The same rule applies to `--ours`, `--theirs` and `--base`. The command reads `git tag --list`, and an unreadable tag list is a refusal (`taggedVersions`); the library function `mergeChangelog` takes `released(version)` as an argument whose default treats every version as released.
- **Missing sections.** `--ours` without an unreleased section is a refusal naming both criteria. `--theirs` without one is read as empty, and the report says so. Only the unreleased section is merged; the head of the file and every other section come from `--ours`.
- **Parse.** Sections are split by the shared parser (`splitSections` in `lib/changelog-format.js`). A line inside a fenced code block, including the opening and closing fence, is never a section heading, container heading, subgroup, entry boundary or conflict mark. Backtick and tilde fences follow the same boundary rule as the link reader's separate implementation; a test holds the two classifiers equal. An unclosed fence extends to the end of the source, so `merge-changelog` refuses when one starts in either side's file head or unreleased section, naming the side and opening line, before writing. Classification uses a blanked copy while output keeps the source lines. Inside the unreleased section a container is a `###`–`######` heading, or a bold subgroup line `**…**` at column 0, which belongs to the current heading, if any; an indented bold line stays part of an entry body. A block is an entry `- **Title**` (`CHANGELOG_ENTRY`, the same pattern lint gate 7 uses) or a top-level `-`, `*` or `+` bullet at column 0. Every other line, blank lines included, belongs to the preceding block, or to the container's opening lines before its first block (`parseSection`). Content before the first heading forms the heading-less top group of the section.
- **Identity.** An entry is identified by its title across the whole unreleased section, so one entry under different headings on the two sides is still one entry; a plain bullet is identified by its trimmed text.
- **Layout from `--ours`.** The result keeps the containers and blocks of `--ours` in their order with their blank lines, empty containers included.
- **Placing a `--theirs`-only block.** Inside its container the block goes after the nearest preceding block of the same `--theirs` container that already sits in the same result container; with no such block it goes first when that container shares any block with the result, and last otherwise (`insertionPoint`).
- **Placing a `--theirs`-only container.** A subgroup goes after the last container of its heading. A heading `--ours` lacks comes with its subgroups and goes after the group of the nearest preceding `--theirs` container already in the result — the heading-less top group counts — or at the end of the section when there is none. Heading-less entries go to the start of the section. The report names each placement in one of four forms: heading added before another heading, heading added at the end of the section, subgroup added under a heading, heading-less entries added at the start of the section.
- **Same title.** The same title with the same trimmed body gives one entry. Different bodies give a conflict pair: a line `<!-- backslop:conflict <title> -->`, the `--ours` block, a blank line, the `--theirs` block (`conflictEntry`). The command never picks a winner.
- **`--base`.** With `--base`, a titled entry present in the base's unreleased section and missing on one side is dropped and named in the report. Plain bullets are never dropped: a removed bullet cannot be told from a rewritten one. Without `--base` one-sided entries are kept and named, and the report says why.
- **Repeats.** A block repeated within one side keeps its first occurrence, and every repeat is named in the report.
- **Conflict marks.** A mark is a line starting with `<!-- backslop:conflict` at column 0, counted only in the unreleased section; a mark set in prose inside a code span is not a mark. A mark in the unreleased section of `--ours` or `--theirs` is a refusal before merging; `--base` is not checked.
- **Self-check.** Before any output the result is checked, and a violation is a refusal with nothing written (`checkInvariants`): a heading or subgroup line may not occur in the merged section more often than on the side that has more of it; and when nothing was dropped by `--base`, a non-blank `--ours` line missing from the result because `--ours` repeats a block is a refusal that names the repeat, since a merge that drops nothing must be additive against `--ours`.
- **Output.** The merged file goes to stdout, or to `--out`, which is resolved from the current directory and whose missing directories are created; a file-system failure on `--out` is a refusal naming the path and the error code. The report always goes to stderr. Line endings follow an existing `--out` file, and otherwise the `--ours` revision. `## ` titles are trimmed; nothing else outside the merged section changes. The exit code is 1 when conflict marks remain, with their count, and `--out` is still written.

## Consequences

- A conflict pair duplicates a title, so lint gate 7 stays red until one revision is kept and the mark removed, and the exit code is 1 meanwhile.
- Callers handle refusals that leave no file: `--out` is untouched after a refusal.
- The result depends on the tags in the clone: a clone without the release tag treats the released top section as unreleased, and the report line naming an untagged version section says so (`git fetch --tags` fixes it).
- After a bump, entries merge into the bumped section until a heading without a version is added above it on `--ours`.
- When only `--theirs` carries the bump, the section title comes from `--ours`, and in this repository gate 11 flags the missing version section.
- The same subgroup added under different headings on each side is refused by the self-check and merged by hand.
- The parse must stay the exact inverse of the assembly, or the additive check fails on every merge.
- The `splitSections` readers (`merge-changelog`, `baseUnreleased`, `changelogSince` and lint's `unreleasedSpan`) use the fence-aware boundary rule, so a heading in an example cannot change their section boundaries. Gate 11 (`splitSections`) and `release --bump` (`firstSection`) read the same way: a fenced `## v1.2.3` is not the released section and a fenced `## …` line is not the top section.
