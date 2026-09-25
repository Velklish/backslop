# BS-114 · One CHANGELOG section parser and version rule for changelog, merge-changelog and release

- **Order:** 320
- **Scope:** [02. CLI](../../reference/02-cli.md) § merge-changelog
- **Created:** 2026-09-25
- **Dependencies:** BS-87, BS-105

## Context

Four places split a CHANGELOG into sections or decide whether a section has a version, and they apply three different rules. In addition, `merge-changelog` imports `CHANGELOG_ENTRY` from the `lint` command module.

**Duplication and divergence** — verified — the sites were read at base and the Node snippet below was rerun.
- `changelogSections` (lib/changelog.js:13-27) and `splitSections` (lib/merge-changelog.js:30-44) are the same splitter. Both use the unanchored version match `/v?\d+\.\d+\.\d+/` (lib/changelog.js:19, lib/merge-changelog.js:12).
- `release --bump` (scripts/release.mjs:54-56) calls a top section released when `/^## v\d/` matches.
- Gate 11 (lib/lint.js:100) looks for an exact `^## v<version>\b`. Gate 7 (lib/lint.js:535) splits on `/^## /`.
- `CHANGELOG_ENTRY` is defined at lib/lint.js:28 and imported by lib/merge-changelog.js:5.
- Snippet: take the text `# Changelog`, `## Unreleased (after v0.11.0)`, `- **a** — x`, `## v0.11.0 — 2026-09-24`, `- **b** — y`. Then:
  - the release.mjs rule says the top section is not released;
  - `changelogSections(text)` → `[["0.11.0","Unreleased (after v0.11.0)"],["0.11.0","v0.11.0 — 2026-09-24"]]`;
  - `mergeChangelog(text, text, text, 'en', () => true)` throws `CHANGELOG.md on the --ours side has no unreleased section (a “## …” heading without a version, or a top section whose version has no tag)`.

**Which behaviour wins.** A new anchored rule, `sectionVersion(title)`, matches `/^\[?v?(\d+\.\d+\.\d+)/`: the version at the start of the title, with an optional `v` or `[`.
- It is not the release.mjs rule (`^v` only). That rule would turn a Keep-a-Changelog heading `## [1.2.3] - date` in a consumer project into an unreleased section, and `merge-changelog` would then merge released entries as unreleased.
- It is not the unanchored rule, which reads `Unreleased (after v0.11.0)` as 0.11.0.

Behaviour change: a heading whose only version is in the middle becomes unreleased in `changelog`, `merge-changelog` and `release --bump`.

## Work to do

- Create a leaf module (for example lib/changelog-format.js) that imports no command module. Export `splitSections(text)`, `sectionVersion(title)` and `CHANGELOG_ENTRY` (moved from lib/lint.js:28).
- Build `changelogSections` in lib/changelog.js on it. In lib/merge-changelog.js, delete the local `SECTION`, `VERSION_IN_TITLE` and `splitSections` (lines 11-12 and 30-49) and import the shared ones. scripts/release.mjs:54-56 decides "released" with `sectionVersion`.
- lib/lint.js imports `CHANGELOG_ENTRY` from the new module. Leave gate 11 (lib/lint.js:100) and gate 7's split (lib/lint.js:535) as they are, or optionally express gate 11 as `sectionVersion(title) === version`.
- Update the tests that pin the old unanchored reading, and add the tests listed under Verification.
- Add a CHANGELOG entry that names the behaviour change for headings whose version is not at the start.

## Out of scope

- merge-changelog's other defects: subgroup parsing of indented bold lines, a theirs-only `###` heading, CRLF output, `--out` handling, and `--base ""`.
- Gate 7's handling of code fences.
- Rewriting the content of CHANGELOG.md itself.

## Verification

- Rerun the snippet from the context. `changelogSections` returns only `[["0.11.0","v0.11.0 — 2026-09-24"]]`, `mergeChangelog(text, text, text, 'en', () => true)` does not throw, and the release rule gives the same answer.
- New test in test/merge-changelog.test.mjs: a consumer CHANGELOG with `## [1.2.3] - 2026-01-01` treats that section as versioned (released when tagged).
- New test in test/release.test.mjs: `## Unreleased (after v0.11.0)` is the unreleased section that `--bump` renames.
- `grep -rn "CHANGELOG_ENTRY =" lib scripts` → one definition, in the new module. `grep -n "from './lint.js'" lib/merge-changelog.js` → no hit.
- `npm test`: every test passes. `node bin/backslop.js lint` → rc=0.
