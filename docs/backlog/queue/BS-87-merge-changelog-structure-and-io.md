# BS-87 · merge-changelog: keep subgroups and entry bodies, EOL, empty --base, --out errors

- **Order:** 50
- **Scope:** [02. CLI](../../reference/02-cli.md) § merge-changelog
- **Created:** 2026-09-25
- **Dependencies:** none

## Context

Line numbers refer to base commit 6f6318e (v0.11.0). `$BS` below is `node <repo>/bin/backslop.js`; throwaway projects are created with `git init -q && $BS init --lang en --tools none` unless stated otherwise.

Five verified bugs in lib/merge-changelog.js. The first two lose theirs' content with rc=0 and no report line.

**1. High — a theirs-only subgroup lands under the wrong `###` heading; a theirs-only `###` heading disappears.** verified — reproduced on 6f6318e via the library API and the CLI.
- ours: `## Unreleased` / `### Added` / `- **A1** …` / `### Fixed` / `- **F1** …`; theirs adds `### Changed` + `**For workspace users:**` + `- **C1** …` between Added and Fixed. `$BS merge-changelog --ours base --theirs theirsA --base base` → rc=0; output has `**For workspace users:**` and C1 under `### Fixed`; `grep -c '^### Changed'` → 0; stderr only `only in theirs: C1`.
- Variant: theirs adds a subgroup under an existing `### Added` that is not ours' last heading → the subgroup is appended after ours' last container (under `### Fixed`).
- Root cause: `parseSection` (lib/merge-changelog.js:88) starts a subgroup container with `open: [raw]` = only the `**Sub:**` line, while the parent heading is a separate container keyed `heading\u0000` (:81); in `mergeChangelog` a theirs-only container is `merged.push(target)`-ed at the end of the section (:302-305) with only its own `open` lines, and a theirs heading container with no direct blocks is never materialised. `checkInvariants` (:150-156) cannot catch it (heading count ≤ per-side maximum). The ADR on changelog merge layout (docs/adr/adr-024-changelog-merge-keeps-layout.md:59-63 at 6f6318e) defines the container as heading plus subgroup.

**2. Major — an indented bold-only line inside an entry body is parsed as a subgroup and theirs' diverging tail is dropped.** verified — reproduced on 6f6318e via `node -e` and the CLI.
- Probe: ours = `# C\n\n## Unreleased\n\n- **A** — first line\n  **Note.**\n  tail of A\n\n## v0.1.0\n\n- **Old**\n`, theirs = same with `tail of A CHANGED` → `mergeChangelog(ours, theirs)` gives `conflicts: []`, `onlyTheirsPlain: []`, `text === ours`. CLI with a base tag and `  **Note:**` + a theirs-only tail line → rc=0, `grep -c 'theirs-only tail' merged.md` → 0. Control with `  Note:` (not bold) → the body divergence is reported as a conflict mark, rc=1.
- Root cause: lib/merge-changelog.js:88 tests `SUBGROUP` (:18, `/^\*\*.+\*\*$/`) on `raw.trim()`, so an indented line opens a container; following lines go to `container.open` (:97), copied from ours only (:265). The code comment at :19-20 and the merge ADR say an indented continuation line stays in the entry body.

**3. Minor — a CRLF CHANGELOG.md is written back with LF.** verified — reproduced on 6f6318e with `core.autocrlf=false` and CRLF blobs.
- `$BS merge-changelog --ours HEAD --theirs theirs --base HEAD~1 --out CHANGELOG.md` → rc=0; CRLF lines 0 of 12; `git diff --stat` → `12 insertions(+), 10 deletions(-)` for a one-entry change; stdout mode is LF too.
- Root cause: lib/merge-changelog.js:34 splits on `/\r?\n/`, :329-330 join and terminate with `'\n'`. lib/tasks.js:346-347 states the project rule: a CRLF file stays CRLF after an edit (`eolOf`).

**4. Minor — `--base ""` silently uses the index blob as the base.** verified — reproduced on 6f6318e.
- Staged CHANGELOG.md edit, then `$BS merge-changelog --ours ours --theirs theirs --base ""` (also `--base=`) → rc=0, `entries: ours 2, theirs 2, result 1`, both one-sided entries reported as `removed relative to --base`. `--base "  "` fails with `invalid object name`.
- Root cause: lib/merge-changelog.js:366 refuses empty `--ours`/`--theirs`, but :374 checks only `values.base === undefined`; `""` reaches `readRevision` (:334) as `git show :./CHANGELOG.md`, the staged blob. `gates` refuses an empty `--base` (lib/gates.js:198-202, test/gates.test.mjs).

**5. Low — `--out` pointing at a directory or into a missing directory crashes with a stack.** verified — reproduced on 6f6318e.
- `--out outdir` (existing dir) → rc=1, `Error: EISDIR: illegal operation on a directory` stack from node:fs; `--out nope/x.md` → rc=1 ENOENT stack; no report lines printed.
- Root cause: unguarded `writeFileSync(path.resolve(root, values.out), text)` at lib/merge-changelog.js:379. docs/reference/02-cli.md:3: a refusal addressed to a human is a CliError without a stack. The ENOENT case also fires after a successful merge: `merge-changelog --ours=HEAD --theirs=w --out=missing/dir/CHANGELOG.md` → rc=1 with the stack from `Module.run (lib/merge-changelog.js:379:8)`, while `fold` (lib/fold.js:75) and `archive` (lib/archive.js:44) write through `writeText` (lib/tasks.js:353-356: `mkdirSync(dirname, {recursive:true})` first).

## Work to do

- Bug 1: when a theirs-only subgroup's parent heading exists in ours, insert the subgroup container right after the last container of that heading in ours; when ours lacks the heading, materialise the heading container together with its subgroups and insert them after the ours container that precedes them in theirs (or at the end of the section as a unit). Report the placement on stderr (`subgroup … added under …`).
- Bug 2: test `SUBGROUP` only on column-0 lines (`SUBGROUP.test(raw)`, like `HEADING` and `PLAIN_ITEM`), and keep `headingKey` in `checkInvariants` consistent with that change, so an indented bold-only line stays in the entry body and body divergence becomes a conflict.
- Bug 3: detect the EOL of the ours revision (`eolOf`) and join/terminate the output with it, for both `--out` and stdout.
- Bug 4: refuse an empty or blank `--base` with the usage text, as for `--ours`/`--theirs`.
- Bug 5: write `--out` through `writeText` (it creates missing parent directories, as `fold` and `archive` do), and wrap the write in try/catch: EISDIR, ENOTDIR and any other fs error become a CliError naming the resolved path and the error code.
- Add the regression tests listed under Verification to test/merge-changelog.test.mjs.

## Out of scope

- Where a relative `--out` is resolved (project root vs cwd) — the BS-101 (`unverified-command-input-forms`) card.
- The untagged-version rule for the unreleased section (documented contract, not a bug).

## Verification

- New test (bug 1): theirs adds `### Changed` + subgroup + entry between two ours headings → result contains `### Changed` once with the subgroup and entry under it; theirs adds a subgroup under ours' non-last `### Added` → it stays under `### Added`.
- New test (bug 2): entry with an indented `  **Note.**` line and a tail that differs between sides → a conflict mark and rc=1 from the CLI; identical tails → no conflict.
- New test (bug 3): CRLF ours/theirs blobs (`core.autocrlf=false`) → merged file has only CRLF line ends.
- New tests (bugs 4, 5): `--base ""` → rc=1 usage refusal; `--out missing/x.md` → rc=0 and the file exists; `--out <existing dir>` → rc=1 with one `✖` line and no stack.
- `npm test` → rc=0; `node bin/backslop.js lint` → rc=0.
