# BS-111 · Shared git helpers in util.js replace duplicated queries; comment scan skips deleted files

- **Order:** 290
- **Scope:** [Reference](../../reference/README.md)
- **Created:** 2026-09-25
- **Dependencies:** BS-106, BS-85, BS-95, BS-100, BS-88

## Context

The same git queries are written separately in several commands. Some copies differ in failure policy or output parsing. lib/util.js already owns `git()`, `gitOrFail()` and `worktrees()`, so these helpers belong next to them.

**1. Repository probe** — verified — read the code at base.
- `git(root, ['rev-parse', '--git-dir']).status` is checked `!== 0` at lib/archive.js:93, lib/gates.js:12 and lib/show.js:25, and `=== 0` at lib/gates.js:88. The two lib/gates.js probes are deleted by the BS-106 (`dead-branches-project-modules`) card before this card.
- lib/tracks.js:44 and lib/tasks.js:259 probe with `--show-toplevel` on purpose, because they need the path and `--show-toplevel` fails inside `.git`/bare repos where `--git-dir` succeeds. Leave them as they are.

**2. `rev-parse --show-prefix`, with opposite failure policies** — verified — read the code at base; not reproduced, because the divergent branch cannot be reached.
- lib/archive.js:103 uses `gitOrFail`. Its comment says a swallowed failure would silently return toplevel paths.
- lib/gates.js:62-65 does exactly that: `return r.status === 0 ? r.stdout.trim() : ''`. `when` globs would then be matched against toplevel paths.
- Both run only after a successful `--git-dir` probe (lib/archive.js:93, lib/gates.js:88).
- Winner: the `gitOrFail` form.

**3. Is the path tracked** — verified — both forms were measured in a scratch repo and gave the same truth value for file, directory, untracked, missing and index-renamed pathspecs.
- lib/tasks.js:576 uses `ls-files --error-unmatch -- <from>` and checks `status === 0` (BS-100 (`unverified-bom-and-move-fallback`) may have narrowed its failure handling; keep whatever it settled).
- lib/fold.js:347-348 uses `ls-files -- <dirRel>` and checks `status === 0 && stdout.trim()`.
- Winner: the `--error-unmatch` form.

**4. `git status --porcelain` is parsed three ways** — verified — the migrate message defect was reproduced at base.
- lib/gates.js:44-58 runs `status --porcelain -z -uall`, takes `slice(3)`, and pushes both names of a rename.
- lib/migrate.js:60-64 runs without `-z` and maps `line.slice(3)`. Its refusal message therefore shows a non-ASCII or spaced path quoted in octal, and a rename as `old -> new`.
- lib/tracks.js:36 (`trim`) and lib/fold.js:257 keep raw lines for display only.
- Winner: the gates parser. Porcelain v1 paths are relative to the repo root, so in a monorepo the migrate message names repo-root paths, as it does today.

**5. `git ls-files` listing** — verified — repro rerun at base.
- Gate 14 (lib/lint.js:140-145) runs `ls-files -z` and splits on `\0`.
- `scannedCode` in test/comment-scan.mjs:181-183 splits on `\n` without `-z`, with the default 1 MiB `execFileSync` buffer. A quoted non-ASCII path fails `/\.(js|mjs)$/` and is skipped without a message.
- Repro: in a new repo, stage `lib/a.js` and `lib/тест.js`. `scannedCode(root, ['lib'])` → `{"files":["lib/a.js"],"empty":[]}`, while `git ls-files lib` prints `lib/a.js` and `"lib/\321\202\320\265\321\201\321\202.js"`.
- The repository has no non-ASCII tracked paths today, so no current result changes.

**6. The local-branch listing is copied** — verified — read the code at base. lib/tasks.js:318-320 has the same `for-each-ref --format=%(refname:short) refs/heads/` call and mapping as `tracks.localBranches` (lib/tracks.js:9-13). tasks.js skips the loop on a non-zero status and tracks returns `[]`, which is equivalent for both callers.

**7. The own-worktree exclusion compares paths differently** — verified — on macOS only; not checked on Windows.
- lib/tasks.js:262-263 and :298 compare `safeRealpath(wtRoot)` with `safeRealpath(root)`.
- lib/tracks.js:50 and :57 compare `path.resolve(wt.path)` with `path.resolve(--show-toplevel)`.
- On macOS, from a `/tmp` (symlinked) cwd, git prints `/private/tmp/...` for both `--show-toplevel` and `worktree list`, so no divergence was observed.

Worktree comparison wins as: realpath when both sides resolve; otherwise `path.resolve`; never equal when both sides fail.

**8. Bug, minor — this repository's comment gate crashes on a pending deletion.** verified — reproduced on a clone at 6f6318e.
- `rm scripts/release.mjs && node --test --test-timeout=60000 --test-concurrency=1 test/comment-length.test.mjs` → rc=1 twice in a row, `Error: ENOENT: no such file or directory, open '…/scripts/release.mjs'` at `surveyTree` (test/comment-length.test.mjs:95, called at :115), `tests 1, pass 0, fail 1`; baseline rc=0 with 16 tests.
- Root cause: test/comment-scan.mjs:181-185 list `git ls-files` (index) paths and read each without an existence check. The gate is meant to run before `git add`/`git commit`.

## Work to do

- lib/util.js: add `isGitRepo(root)` (the `--git-dir` probe) and `showPrefix(root)` (`gitOrFail` on `rev-parse --show-prefix`, trimmed).
- lib/util.js: add `isTracked(root, pathspec)` (the `--error-unmatch` form) and `porcelainPaths(root, pathspecs = [])`, moved from the body of `gates.worktreePaths`: `-z`, `-uall`, both names of a rename.
- lib/util.js: add `lsFiles(root, paths)`: `ls-files -z`, split on NUL, with the same maximum buffer as `git()`.
- Use `isGitRepo` at lib/archive.js:93 and lib/show.js:25 (the BS-106 (`dead-branches-project-modules`) card already deleted the two probes in lib/gates.js, whose following git call fails the same way). Use `showPrefix` at lib/archive.js:103 and lib/gates.js:62-65.
- Use `isTracked` at lib/tasks.js:576 and lib/fold.js:347-348. Use `porcelainPaths` in `gates.worktreePaths` (no pathspecs) and at lib/migrate.js:60-64 (with its file pathspecs).
- Use `lsFiles` at lib/lint.js:140-145 and in test/comment-scan.mjs:181-183. The test module imports from lib/util.js.
- Add `localBranches(root)` to lib/util.js next to `worktrees()`. Use it at lib/tasks.js:318 and in tracks (lib/tracks.js:9-13, used at :73), and delete the tracks copy.
- Add `isSameTree(a, b)` to lib/util.js: realpath when both sides resolve, `path.resolve` otherwise, never true when both fail. Use it at lib/tasks.js:298 and lib/tracks.js:57.
- Item 8: in `scannedCode` (test/comment-scan.mjs) skip index paths that no longer exist in the worktree (a deletion is not judged). Apply it on top of the `lsFiles` listing above.
- Add a CHANGELOG entry for the only visible change: the `migrate` refusal now names real paths, and a rename lists both names.

## Out of scope

- The raw porcelain lines that lib/tracks.js:36 and lib/fold.js:257 print for display.
- The `--show-toplevel` probes in tracks.js and tasks.js.
- `gates --json` reporting an unstaged ` M` as staged after `trim()` (fixed by the BS-92 (`gates-tree-labels-globs`) card).
- `adr` numbering across branches.
- Verifying worktree comparison on real Windows beyond the unit test.
- The ls-tree coordinates and git-failure handling of `foreignTaskIds` — BS-88 (`branch-scans-new-and-tracks`).

## Verification

- New test in test/commands.test.mjs (or upgrade/migrate tests): a `migrate` refusal with a dirty `docs/тест.md` names the file unquoted.
- New test for `scannedCode`: a staged `lib/тест.js` is in `files`.
- `grep -rn "'rev-parse', '--git-dir'" lib` → only lib/util.js. `grep -rn "'--show-prefix'" lib` → only lib/util.js.
- Unit test (item 7): `isSameTree` of two nonexistent paths is false. `isSameTree(p, p + '/.')` is true.
- New test (item 8): tracked fixture file deleted from the worktree → the comment gate reports verdicts, rc=0 when the rest is clean.
- `node --test --test-timeout=60000 test/gates.test.mjs test/tracks.test.mjs test/fold.test.mjs; echo rc=$?` → rc=0 with the same test count as before this card; `npm test`: every test passes; `node bin/backslop.js lint` → rc=0.
