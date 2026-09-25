# BS-125 · Report channels: unmarked stderr notes, one archive dry-run line, one git rm error

- **Order:** 430
- **Scope:** [02. CLI](../../reference/02-cli.md) § archive
- **Created:** 2026-09-25
- **Dependencies:** BS-91, BS-87

## Context

`B` is the absolute path to this repo's `bin/backslop.js`; `T` is a fresh temporary directory. Line numbers refer to the v0.11.0 tree (commit 6f6318e).

Commands whose stdout carries data (JSON, a body, a merged file) put reports on stderr. The output helpers are `ok` / `info` / `warn` / `bad` (util.js:13-17), and docs/reference/02-cli.md:3 defines `⚠` as a warning. Inconsistencies:

1. **Three stderr report styles.** verified — `grep -n 'process.stderr.write\|console\.' lib/*.js` (hits only util.js:13-17 and merge-changelog.js:357) and by reading the code. fold.js:79-82 reports its success summary (`folded tasks N, lines appended to …`) and the changed paths through `warn()`, so a success carries `⚠`. show.js:36 prints the header line `BS-N · date · outcome · rev` through `warn()`. merge-changelog.js:356-358 defines a private unmarked `note()` with `process.stderr.write`. brief.js:74 is a real warning and correctly uses `warn()`.
2. **archive's dry run prints a success line.** verified — a CLI run in a project where docs/notes/n.md links task 1: `archive 1 --dry-run` gives rc=0 with `  move: … (--dry-run, no changes written)` and then `✔ archive: BS-1 — files with updated links 1`, while `git status --short` is empty. archive.js:34 appends an inline suffix, and archive.js:47 and :84 print `ok(…)` unconditionally. fold.js:64 and upgrade.js:140 print a dedicated `--dry-run: …` line. test/archive.test.mjs:52 pins the current wording.
3. **Path lists under one header use two indents.** verified — a CLI run of `archive 1`: the link-rewrite list prints at column 2, the same column as its `✔` header text (archive.js:48 `info(rel)`, same at :85). The touched-docs list prints at column 4 (archive.js:54 `info(`  ${rel}`)`), and fold.js:82 uses the column-4 form too. test/archive.test.mjs:43 (`l.slice(2)`) pins the column-2 form.

4. **Routine `fold` report uses the warning glyph.** verified — the stderr of a successful `fold 2` was `⚠ folded tasks 1, lines appended to docs/archive/LOG.md 1, …` and `⚠ the commit message draft is on stdout: …` (`warn()` at lib/fold.js:79, :91), while the real warning "the body is not in git history" (:55) uses the same glyph, so an orchestrator cannot tell them apart.
5. **fold prints one git rm failure twice.** verified — read the code; not reproduced live, because making `git rm` fail needs a PATH shim. fold.js:353 calls `bad('git rm failed: …')` and fold.js:354 then throws a `CliError`, which bin/backslop.js:166 prints as a second `✖` line. It is the only `bad()` followed by `throw` in lib/. archive.js:127, merge-changelog.js:337 and util.js:52 fold the git cause into one CliError. util.js:16 documents `bad()` as the 'list what was found, no exit' channel.
6. **`process` is imported in some files and global in others.** verified — `grep -ln "import process from 'node:process'" lib/*.js bin/*.js scripts/*`: fold, gates, show, tracks, util, bin/backslop.js and scripts/release.mjs import it. brief, changelog, merge-changelog, seed, status and upgrade use the global. No doc sets a rule, so this is a style choice. The entry point and util use the explicit import, and that side is taken here.

BS-91 (`fold-journal-eol-and-order`) already moved bulk fold's "nothing to fold" line to stderr. docs/reference/02-cli.md:3 sets the error rule: a refusal addressed to a person is a `CliError`, printed as a single `✖` line.

## Work to do

- lib/util.js: add `note(msg)`, an unmarked stderr line (`console.error(`  ${msg}`)`). Use it for merge-changelog's reports (delete the local `note` at :356-358), for the fold success summary and changed paths (fold.js:79-82), for the show header (show.js:36), and for bulk fold's nothing-to-fold line (the BS-91 (`fold-journal-eol-and-order`) card moved it to stderr with `warn()`). Keep `warn()` for real warnings (brief.js:74 and similar).
- lib/archive.js: in dry mode, print one `--dry-run: nothing was written` line (via `info`, as upgrade.js:140 does) and phrase :47 and :84 as `would update links in N files`, without `✔`. Drop the inline suffix at :34. Update test/archive.test.mjs:52.
- lib/archive.js:48 and :85: `info(`  ${rel}`)`. Update the filter at test/archive.test.mjs:43 to match.
- lib/fold.js:353-354: throw one CliError that carries the cause and the recovery text together, for example `git rm failed: ${gitCause(r, cfg.lang)} — task directories were not removed, the journal is untouched; sort the tree out and retry` (and the Russian twin). Drop the `bad` import if it is no longer used.
- Add `import process from 'node:process';` to lib/brief.js, changelog.js, merge-changelog.js, seed.js, status.js and upgrade.js. Leave test files alone.
- CHANGELOG.md, unreleased section (English): the routine `fold` report is an unmarked stderr note, `archive --dry-run` prints one `--dry-run:` line instead of a success line, and a failed `git rm` in `fold` prints one error.

## Out of scope

- `status --json` nulls, the `seed --scan` total and the `tree.dirty` description — BS-126 (`json-contract-nulls-total`).
- Moving JSON writes to a shared helper.

## Verification

- test/fold.test.mjs: a successful `fold` writes no `⚠` to stderr. test/merge-changelog.test.mjs: reports still go to stderr, and stdout holds only the merged text when there is no `--out`.
- test/archive.test.mjs: `archive 1 --dry-run` prints no line starting with `✔`, prints a `--dry-run:` line, and leaves `git status --short` empty. In a real `archive 1`, both path lists start at column 4.
- `grep -n 'process.stderr.write' lib/*.js` finds only util.js, if any.
- test/fold.test.mjs: with a `git` shim on PATH that fails only for `rm`, `fold N` prints exactly one `✖` line (count the lines that start with `✖`). Mark it `skip` on win32, as the other sh-shim tests are.
- `grep -L "import process from 'node:process'" $(grep -lE '\bprocess\.(stdout|stderr|env|exit|argv|cwd|platform|exitCode|execPath|version)' lib/*.js)` prints nothing (a plain `process\.` pattern also matches file names such as `adr-001-process.md` in init.js).
- `npm test` passes (report the count), and `node bin/backslop.js lint` gives rc=0.
