# BS-95 · lint: walk symlinked and upper-case markdown, fence-aware gate 7, gate 8 name check

- **Order:** 130
- **Scope:** [03. Lint gates](../../reference/03-lint.md)
- **Created:** 2026-09-25
- **Dependencies:** BS-89, BS-85

## Context

Line numbers refer to base commit 6f6318e (v0.11.0). `$BS` below is `node <repo>/bin/backslop.js`; throwaway projects are created with `git init -q && $BS init --lang en --tools none` unless stated otherwise.

Four verified bugs where a lint gate silently skips input it is documented to check.

**1. Medium — gate 8 skips the ADR file-name check when no correctly named ADR exists.** verified — reproduced on 6f6318e.
- With `adr-001-process.md` present, adding `ADR-002-foo.md` → rc=1 `✖ docs/adr/ADR-002-foo.md: name does not match adr-NNN-<slug>.md`. Renaming the only ADR to `ADR-001-process.md` (README link updated) → rc=0 with two mis-named files; `$BS adr new-one` then reuses number 001.
- Root cause: lib/adr.js:15-17 `scanAdrs()` drops names that do not match `ADR_FILE_RE`, and lib/lint.js:560 `if (!adrs.length) return;` exits before the name-pattern loop at lib/lint.js:571-576, whose own comment says it exists for files scanAdrs cannot count. docs/reference/03-lint.md:14 promises the name error unconditionally; test/lint.test.mjs:278 runs only on a fixture that holds a valid ADR.

**2. Minor — root-level markdown symlinks are skipped by gates 1, 10, 13 and the pin gate; a symlinked status or task directory is reported as a foreign file.** verified — reproduced on 6f6318e.
- notes/README.md containing `[broken](docs/none.md)` and `ln -s notes/README.md README.md` → `lint` rc=0; the same content as a regular README.md → rc=1 `broken link docs/none.md`. docs/backlog/queue replaced by a symlink to a directory holding a valid card → rc=1 `docs/backlog/queue: file is outside a status directory` while `status` lists the card and gate 4 reads it through the link.
- Root cause: `Dirent.isFile()`/`isDirectory()` on `readdirSync(…, { withFileTypes: true })` without resolving symlinks at lib/lint.js:202-204, :469-471, :596-598, lib/mdwalk.js:103-105 (root files) and lib/lint.js:298-302, :418-421 (status/task directories), while lib/mdwalk.js:60 and lib/tasks.js:128-133 resolve links with `statOrNull`. A CLAUDE.md symlink is a supported layout (lib/adapters.js:246-248). The root loop `for (const e of readdirSync(root, { withFileTypes: true })) { if (e.isFile() && e.name.endsWith('.md')) … }` is copied four times (lib/lint.js:201-202 gate 1, :468-469 gate 13, :595-596 gate 10, lib/mdwalk.js:102-103 `liveMarkdown`, which feeds `livePinFiles` for the pin gate and for `upgrade`); the callers pair it with docs files under different relative bases on purpose ('' at :201, root-relative at :468 for anchors, '' with an `archive/` filter at :595). Following root symlinks without a bound is not safe: `upgrade` rewrites the files `livePinFiles` returns.

**3. Minor — `.MD`/`.Md` files are never walked.** verified — reproduced on 6f6318e.
- docs/NOTE.MD with a broken link, an unknown task mention and a quote of a missing file → `lint` rc=0; the byte-identical lower-case copy → rc=1 with three errors; a link to `NOTE.MD` is accepted (it exists); `mv` leaves links inside NOTE.MD stale.
- Root cause: lib/mdwalk.js:67 `exts.some((x) => e.name.endsWith(x))` (case-sensitive), also used for lib/mdwalk.js:76 and :92 and the root `*.md` loops in lib/lint.js. docs/reference/03-lint.md promises `docs/**` and root `*.md` without a case restriction.

**4. Minor — gate 7 (CHANGELOG duplicates) does not blank code fences.** verified — reproduced on 6f6318e.
- CHANGELOG section with two real `- **Alpha**` entries around a fence containing `## 0.9.0` → rc=0 (the fenced heading reset the section); one real `- **Entry format**` plus two fenced copies → rc=1 `line 8: entry title “Entry format” already exists in section “1.0.0” (line 5)`.
- Root cause: lib/lint.js:533-540 iterate `readText(file).split('\n')` raw; every other markdown gate uses `blankFences` (lib/lint.js:318, 382, 522, 631; lib/links.js:31). docs/reference/03-lint.md row 6 (also over CHANGELOG.md) says code blocks are examples and do not count.

## Work to do

- Bug 1: run the name-pattern loop (lib/lint.js:571-576) before the `if (!adrs.length) return;` early return.
- Bug 2: add one `rootMarkdown(root)` helper in lib/mdwalk.js returning `[name, abs]` pairs of project-root `*.md` files; it includes a symlink only when its realpath is a regular file inside the project, deduplicated by realpath. Use it at the four loop sites, keeping each caller's relative base and the gate-10 archive filter. `upgrade` stays safe because the BS-85 (`rewrite-guards-against-data-loss`) card makes `rewriteProsePins` skip every path with a symlink component. Classify backlog/archive entries by the resolved stat in lib/lint.js:298-302 and :418-421.
- Bug 3: compare extensions case-insensitively (`e.name.toLowerCase().endsWith(x)`) in `srcFiles`/`mdFiles` and in the root loops.
- Bug 4: run the gate-7 loop over the lines of `blankFences(text)` (line numbers are preserved).
- Update the gate 1, 10 and 13 rows of docs/reference/03-lint.md for root symlinks and `.MD` files; add a CHANGELOG entry under the unreleased section.
- Add the regression tests listed under Verification to test/lint.test.mjs and test/mdwalk.test.mjs.

## Out of scope

- Href normalisation and case-exact link targets — the BS-89 (`link-gate-target-resolution`) card this card depends on.
- Whether docs/archive/LOG.md journal lines belong to live markdown — the BS-99 (`unverified-lint-gate-gaps`) card.

## Verification

- New test (bug 1): docs/adr holding only `ADR-001-process.md` → gate 8 name error, rc=1.
- New tests (bug 2): root `README.md -> notes/README.md` with a broken link → rc=1; a root `*.md` symlink to a file outside the project is not read; symlinked docs/backlog/queue with a valid card → no `outside a status directory` error; `upgrade` leaves the outside file unchanged.
- New test (bug 3): docs/NOTE.MD with a broken link → rc=1.
- New test (bug 4): the two CHANGELOG fixtures above → the real duplicate is reported, fenced lines are not.
- `npm test` → rc=0; `node bin/backslop.js lint` → rc=0.
