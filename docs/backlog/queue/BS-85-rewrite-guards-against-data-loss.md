# BS-85 · init, migrate, upgrade: never destroy user text when rewriting a file

- **Order:** 30
- **Scope:** [Reference](../../reference/README.md)
- **Created:** 2026-09-25
- **Dependencies:** BS-84

## Context

Line numbers refer to base commit 6f6318e (v0.11.0). `$BS` below is `node <repo>/bin/backslop.js`; throwaway projects are created with `git init -q && $BS init --lang en --tools none` unless stated otherwise.

Four verified bugs where a command that rewrites a user-visible file destroys text, writes outside the project, or duplicates a managed block — all with rc=0.

**1. High — init and upgrade rewrite a non-UTF-8 file with U+FFFD.** verified — reproduced on 6f6318e at both sites.
- A Windows-1251 AGENTS.md (`printf '# Проект\n\nПравила команды: не трогать prod.\n' | iconv -f UTF-8 -t CP1251 > AGENTS.md`, 44 bytes, not valid UTF-8): `$BS init --tools none` → rc=0, `AGENTS.md: backslop block appended`; afterwards the file holds 29 U+FFFD (`EF BF BD`) and 0 of the original CP1251 bytes.
- `rewriteProsePins` on a CP1251 docs/NOTES.md containing `npx github:Velklish/backslop#v0.11.0` rewrites it the same way (22 U+FFFD) and counts it in `pin in prose: N files`.
- Root cause: lib/init.js:291 `readFileSync(file, 'utf8')` then lib/init.js:295-296 / :300-301 write the lossy decode back over the whole file; lib/upgrade.js:53-56 does the same. No doc declares UTF-8-only input; Windows is a supported platform.

**2. Major — upgrade rewrites pins in files outside the project through a symlinked directory.** verified — reproduced on 6f6318e.
- Project with `vendor -> ../shared` where `../shared/package.json` holds `{"scripts":{"l":"npx github:me/proj#v0.10.0 lint"}}` (and `docs/shared -> <outside>/shared` with a notes.md): `upgrade` rc=0 prints `pin in prose: 7 files` (no names) and the files outside the project now read `#v0.11.0`; `git status` in the project shows nothing for them.
- Root cause: lib/mdwalk.js:60 `const st = e.isSymbolicLink() ? statOrNull(child) : e;` recurses into link targets (lib/mdwalk.js:62-66); `livePinFiles` walks the whole root for package.json (lib/mdwalk.js:135) and CI dirs (:143); lib/upgrade.js:56 `writeFileSync(abs, next)` has no symlink check. migrate already skips such paths with a warning (lib/migrate.js:45-46, `symlinkComponent`, lib/mdwalk.js:34) and the code comments at lib/mdwalk.js:78-79 name "writing behind a symlink outside the project" as the hazard.

**3. Major — migrate treats any failing `git status` as "no git" and overwrites uncommitted edits of the rules pair.** verified — reproduced on 6f6318e with three git failure modes inside a real repository (`GIT_INDEX_FILE=<a directory>`, dubious ownership via `GIT_TEST_ASSUME_DIFFERENT_OWNER=1`, truncated `.git/index`), each giving `git status` rc=128.
- Project stamped 0.10.0 with an uncommitted line appended to docs/backlog/README.md. Healthy git: `$BS migrate` → rc=1 `uncommitted edit …`, edit kept. `GIT_INDEX_FILE=$PWD/idxdir $BS migrate` → rc=0, prints `… redrawn docs/backlog/README.md — no git, uncommitted edits could not be checked`, stamp 0.10.0 → 0.11.0, `grep -c 'MY LOCAL EDIT' docs/backlog/README.md` → 0.
- Root cause: lib/migrate.js:60-62 `if (status.status !== 0) { plan.noGit = true; }` — exit 128, `status: null` on timeout/signal (lib/util.js:36-38) and a missing git binary all become "no git"; the write at lib/migrate.js:104-107 proceeds. The only sanctioned exception is a project without a repository.

**4. Minor — init treats a prose mention of the block markers as the block and leaves two blocks.** verified — reproduced on 6f6318e.
- After `init`, prepend to AGENTS.md: ``The managed block sits between `<!-- backslop:start -->` and `<!-- backslop:end -->`.`` Then `$BS init` → rc=0 `AGENTS.md: backslop block updated`; `grep -c backslop:start AGENTS.md` → 2, `grep -c backslop:end AGENTS.md` → 2; the prose line is cut at the first marker and followed by the block heading; a third `init` reports `unchanged`; `lint` rc=0.
- Root cause: lib/init.js:292-295 `const start = text.indexOf(BLOCK_OPEN); const end = text.indexOf(BLOCK_CLOSE); … text.slice(0, start) + block + text.slice(end + BLOCK_CLOSE.length)` — first occurrence of each marker, no check that each occurs once or on its own line. lib/init.js:300 already refuses on an unpaired marker.

## Work to do

- Bug 1: read files that init (`upsertBlock`) and upgrade (`rewriteProsePins`) rewrite as a Buffer and decode with `new TextDecoder('utf-8', { fatal: true })`; on a decode error init refuses with a CliError naming the file (`not valid UTF-8 — convert it, then retry`) before any write, and upgrade skips the file with a warning naming it.
- Bug 2: in `rewriteProsePins` skip, with a warning that names the path and the link, every file whose path from the root has a symlink component (reuse `symlinkComponent`, lib/mdwalk.js:34), as migrate does for the rules pair; lint may keep reading such files.
- Bug 3: in `planRules` fall back to `noGit` only when git reports that the project is not in a repository (`rev-parse --is-inside-work-tree` exit 128 with `not a git repository`) or the git binary is missing (`r.error.code === 'ENOENT'`); any other non-zero status, signal or spawn error throws a CliError with `gitCause(r)` and writes nothing.
- Bug 4: locate the managed block by line-anchored markers (each marker alone on its line); when either marker occurs more than once as such a line, or a marker text occurs outside the block, refuse with the existing unpaired-marker style CliError instead of rewriting.
- Add the regression tests listed under Verification (test/init.test.mjs, test/upgrade.test.mjs).

## Out of scope

- The upgrade sequencing and pin-coverage fixes — the BS-84 (`upgrade-completes-pinned-consumers`) card this card depends on.
- BOM handling of backslop.json (the BS-94 (`config-validation-one-rule-set`) card) and of task files (the BS-100 (`unverified-bom-and-move-fallback`) card).

## Verification

- New test (bug 1): CP1251 AGENTS.md → `init` rc=1 naming AGENTS.md, file bytes unchanged (compare Buffer before/after); CP1251 docs/NOTES.md with an old pin → `upgrade` warns with the path and leaves the bytes unchanged.
- New test (bug 2): project with `vendor -> ../shared` and an old pin in `../shared/package.json` → after `upgrade` the outside file still holds the old pin and the output names the skipped link.
- New test (bug 3): project stamped 0.10.0, uncommitted edit in docs/backlog/README.md, `GIT_INDEX_FILE` pointing at a directory → `migrate` rc=1 with the git cause, edit kept, stamp unchanged. Existing no-repository test (test/upgrade.test.mjs:276-289) stays green.
- New test (bug 4): AGENTS.md with a prose line quoting both markers before the block → `init` refuses (rc=1) or leaves exactly one block; `grep -c backslop:start AGENTS.md` equals the number of marker lines the test expects.
- `npm test` → rc=0; `node bin/backslop.js lint` → rc=0.
