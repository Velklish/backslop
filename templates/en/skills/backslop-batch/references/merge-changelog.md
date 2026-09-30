# Merging CHANGELOG.md during integration

Read from `backslop-batch`, step 2 of “Integration and acceptance”, when two tracks changed `CHANGELOG.md`.

Run `{{cli}} merge-changelog --ours <your head> --theirs <worker head> [--base <branch point>] --out CHANGELOG.md` from the project root. It merges the unreleased entries by their `- **…**` heading, keeps the section's structure — a `### …` heading and the bold subgroup under it — and takes released sections from your side: their headings repeat in each release and there is nothing to merge.

## Conflict and refusal

- The command does not pick between diverging bodies under one heading: both revisions stay under a `<!-- backslop:conflict … -->` mark, and the report names the heading.
- A non-zero exit code means an unresolved conflict or a refusal. Read the code from the command, not the presence of a file.
- The command may hand over no file at all: it refuses on an unresolved mark in the unreleased section of `--ours` or `--theirs`, and on a broken invariant of its own check. `--out` is left untouched.

**Closing a conflict.** Keep one revision of the entry and delete the `<!-- backslop:conflict … -->` line. While both revisions stay, `lint` exits 1 with “entry title … already exists in section …”. Deleting one revision makes `lint` green even when the mark line is still there, but the next `merge-changelog` refuses on it: a leftover mark passes `lint` and blocks the next merge.

## Without `--base`

An entry removed by one side is indistinguishable from a neighbour's new one, so it is kept. The report names it, together with one-sided bullets that carry no bold heading.

## Which section gets the entries

The unreleased section is the first heading that does not start with a version number (a leading `v` or `[` is allowed), or, when there is none, the top section whose version has no tag: that is how a bump leaves it before the release. Your side decides where entries land, not the time of the bump:

- While no such heading stands above the bumped section, track entries are merged into the bumped version. After the tag, the command refuses until such a heading exists.
- To send entries to the next version, add `## Unreleased` above the bumped section on your side and merge with `--base`. Without a base, entries the bumped section already carries arrive from the worker a second time.

## Report lines

- “unreleased section in <side> — “…”: the version has no tag” — the merge went into a version section. Check that the version is not released; if it is, the tag has not reached this clone: run `git fetch --tags` and repeat.
- “theirs has no unreleased section — its entries were not read” — the worker's entries are not in the result. Find them in its revision.
