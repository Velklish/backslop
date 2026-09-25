# BS-88 · new and tracks: see numbers on every branch, and tell a git failure from an empty list

- **Order:** 60
- **Scope:** [02. CLI](../../reference/02-cli.md) § new
- **Created:** 2026-09-25
- **Dependencies:** none

## Context

Line numbers refer to base commit 6f6318e (v0.11.0). `$BS` below is `node <repo>/bin/backslop.js`; throwaway projects are created with `git init -q && $BS init --lang en --tools none` unless stated otherwise.

Five verified bugs in the branch/worktree scans behind `new` (lib/tasks.js `foreignTaskIds`, lib/new.js) and `tracks` (lib/tracks.js). Three of them make `new` hand out a number already used on another branch.

**1. High — monorepo subproject: numbers on other branches are invisible.** verified — reproduced on 6f6318e (git 2.54.0).
- Repo `mono/` with the project in `pkg/a`; BS-2 committed only on branch `worker`; `$BS new c` on main from `pkg/a` → `✔ BS-2: …` (duplicate). Same scenario at the repo root → `BS-3` and `BS-2 is taken: branch worker`.
- Root cause: lib/tasks.js:265-266 builds `docsRel` relative to the toplevel (`pkg/a/docs`), lib/tasks.js:321 runs `git -C <root> ls-tree -r --name-only <branch> -- <docsRel>/backlog <docsRel>/archive` and :325 keeps lines that `startsWith(docsRel + '/')`. Without `--full-tree`, `ls-tree` resolves the pathspec and prints paths relative to the cwd: `git -C pkg/a ls-tree -r --name-only worker -- pkg/a/docs/backlog pkg/a/docs/archive` prints nothing (rc=0); with `--full-tree` it prints the files. lib/show.js:44-45, :72 already handle this. docs/reference/02-cli.md:14 supports projects in a repository subdirectory.

**2. Medium — non-ASCII docs directory: numbers on other branches are invisible.** verified — reproduced on 6f6318e with `init --dir доки` / `--dir докс` and default `core.quotepath`.
- BS-2 committed on branch `worker`; `$BS new c` on main → `✔ BS-2` again (ASCII `docs` control → BS-3 with `BS-2 is taken: branch worker`).
- Root cause: lib/tasks.js:321 calls `git ls-tree` without `-c core.quotePath=false`, so git prints `"\320\264…/backlog/triage/BS-2-b.md"` and the `startsWith` filter at :325 drops every line. lib/show.js:74, lib/archive.js:109 and lib/gates.js:42 already pass `core.quotePath=false`; lib/config.js:116-119 accepts non-ASCII `docs`. The branch-tree listing of `show.bodyFiles` (lib/show.js:72-74: `cfg.docs` relative to the cwd, `core.quotePath=false`) and `fold.bodyRev` (lib/fold.js:262-263, `-z`) already uses the right coordinates; `foreignTaskIds` copies it with neither. Tests cover only a repo-root ASCII layout (test/commands.test.mjs:122, test/fold.test.mjs:847).

**3. Major — any git failure is treated as "no repository".** verified — reproduced on 6f6318e with a git shim on PATH that `kill -9`s itself on `--show-toplevel`.
- BS-1 on main, BS-2 committed on branch `worker`: real git → `✔ BS-3 …` / `BS-2 is taken: branch worker`; with the shim → `✔ BS-2 …` rc=0, no warning.
- Root cause: lib/tasks.js:259-260 `const top = git(root, ['rev-parse', '--show-toplevel']); if (top.status !== 0) return [];` — `status` is null on a signal, on the 60 s timeout (lib/util.js:37) and on spawn errors; the same pattern at lib/tasks.js:319, :322, :330 and lib/util.js:60 (`worktrees`). docs/reference/01-layout.md:84 and test/commands.test.mjs:175-184 cover only the genuine no-repository case (exit 128). Elsewhere the code reports `gitCause()` (lib/fold.js:256-264, lib/lint.js:142, lib/archive.js:136, lib/show.js:64).

**4. Low — `new` names a local number as a foreign blocker.** verified — reproduced on 6f6318e with one worktree and one branch.
- `new a`, commit, `new b` → `✔ BS-2 …` plus `BS-1 is taken: branch main`; the same line follows every `new` once the predecessor is committed, also for `N.k`. With an uncommitted predecessor there is no such line.
- Root cause: lib/new.js:83 and :103 pick `blocker` as `foreign.find(num === N-1)` without checking the local `tasks`; lib/tasks.js:318-320 iterate `refs/heads/` including the checked-out branch. lib/new.js:73 documents `blocker` as a foreign number that shifted the local one; test/commands.test.mjs:128-130 covers only an uncommitted predecessor. The tool-owned backlog rules promise the same (templates/en/docs/backlog/README.md:26: the command "names the foreign number it skipped"; the ru template and docs/backlog/README.md say the same). Tests that pin the message when a number really was taken elsewhere, and must stay green: test/commands.test.mjs:107 (`BS-2 занят: worktree .*worker`), :111 (`BS-1\.1 занят: worktree`), :122 (`BS-2 занят: ветка worker`) and test/fold.test.mjs:847 (`BS-5 занят: ветка worker`).

**5. Major — `tracks` drops a branch whose name equals an existing path.** verified — reproduced on 6f6318e.
- Branch `docs` (same name as the `docs/` directory init creates) with commit `BS-1: work on docs branch` not merged into HEAD: `$BS tracks` → `✔ tracks: worktrees and branches 0, not merged 0`; with a worktree on `docs`, `tracks --json` → `{"kind":"worktree","branch":"docs","merged":false,"pending":[],…}`. `git log --format='%h %s' docs --not HEAD --grep=BS-` → rc=128 `fatal: ambiguous argument 'docs': both revision and filename`; with a trailing `--` → the commit, rc=0.
- Root cause: lib/tracks.js:19 `git(root, ['log', '--format=%h %s', ref, '--not', 'HEAD', `--grep=${prefix}-`])` has no `--`; lib/tracks.js:20 `if (r.status !== 0) return [];` swallows the failure; lib/tracks.js:76 `if (!pending.length) continue;` drops the branch.

## Work to do

- Bugs 1 and 2: list the branch tree in the coordinates `show.bodyFiles` already uses: `git -c core.quotePath=false ls-tree -r -z --name-only <branch> -- <cfg.docs>/backlog <cfg.docs>/archive` run from the project root (pathspec and output are relative to the cwd), split on NUL and strip the `<cfg.docs>/` prefix. Keep `git show <branch>:<docsRel>/…` at lib/tasks.js:329 as it is: `git show` paths are relative to the tree root. (`--full-tree` with the toplevel-relative `docsRel` is an equivalent alternative for bug 1; `-c core.quotePath=false` or `-z` is still needed for bug 2.)
- Bug 3: distinguish "not a repository" (git ran, exit 128, stderr `not a git repository`) from a failed invocation in `foreignTaskIds` and `worktrees()`: on `r.error`, `r.signal`, `status === null` or another non-zero exit, throw a CliError with `gitCause(r)` (preferred) so `new` never hands out a number it could not check.
- Bug 4: compute `blocker` only when the previous number came from the foreign scan and is absent from the local `tasks` (the local scan without the foreign part; do not exclude the current branch instead, because its HEAD can differ from the working tree); dedupe local ids before the search. Apply the same rule to the finding path (`N.k`, lib/new.js:83). The BS-162 (`backlog-archive-rules-english`) card rewords the README sentence afterwards.
- Bug 5: append `'--'` after the revision arguments in `pendingCommits`; return `null` on a git failure and print `could not be checked` for that track (as `dirtyIn` does) instead of an empty list.
- Add the regression tests listed under Verification (test/commands.test.mjs, test/tracks.test.mjs).

## Out of scope

- `mv`/`archive` fallback to a plain rename on a git failure (`moveFile`) — the BS-100 (`unverified-bom-and-move-fallback`) card.
- Prunable worktrees in `tracks` — the BS-102 (`unverified-repo-state-reports`) card.

## Verification

- New test (bug 1): repo with the project in `pkg/a`, BS-1 on main, BS-2 on branch `worker` → `new c` from `pkg/a` creates BS-3 and prints `BS-2 is taken: branch worker`.
- New test (bug 2): same with `init --dir доки` at the repo root → BS-3.
- New test (bug 3): git shim on PATH that kills itself on `--show-toplevel` → `new c` rc=1 with a git cause, no file created.
- New test (bug 4), next to test/commands.test.mjs:122: committed BS-1 on a single branch → `new beta --queue` prints `✔ BS-2: …` and no `занят` / `is taken` line, rc=0. `node --test --test-name-pattern='занят|taken' test/commands.test.mjs test/fold.test.mjs` → rc=0 including the four existing assertions; reverting the condition turns only the new test red.
- New test (bug 5): branch `docs` with an unmerged `BS-1:` commit → `tracks --json` lists it with that commit in `pending`.
- `npm test` → rc=0; `node bin/backslop.js lint` → rc=0.
