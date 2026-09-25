# BS-132 · fold.test.mjs: drop a duplicate test, trim refusals, make the worktree check non-vacuous

- **Order:** 500
- **Scope:** [02. CLI](../../reference/02-cli.md) § fold
- **Created:** 2026-09-25
- **Dependencies:** BS-91, BS-86

## Context

Line numbers are at commit 6f6318e (v0.11.0); if a line moved, find the test by the quoted name. A *mutation probe* means: edit the named lib line in the working tree, run the named test file with `node --test --test-timeout=60000 <file>; echo rc=$?`, read the red test names (lines starting with `✖`), then restore with `git checkout -- lib bin scripts templates`. Base run at 6f6318e: full suite 450 tests, 450 pass. Bug and code cards earlier in the queue changed some of the lib lines named in the mutation probes; apply each probe to the same logic where it lives when you start.

Base run: test/fold.test.mjs 29 tests, 29 pass.

**1. `archive N в дереве без каталогов архива: свёрнутый архив не краевой случай` (:606-629) duplicates :85.** verified — mutation probe, full suite with the test skipped. It folds BS-1, commits, archives a second task into an archive holding only LOG.md+README.md, folds it and reads the second LOG line — the same walk as `fold N: тело с ревизией …` (:85) lines 109-118 (`archive 2` asserted at :111). Its extra `lint` exit 0 on a fully folded archive is asserted by :583 at :600. M1 lib/fold.js:74 `if (!existsSync(log))` -> `if (true)`: without :606 still red :85, :227, :282, :632. M2 (a refusal inserted in lib/archive.js after line 25 when the archive holds only folded tasks): without :606 still red :85 (a single test of margin). M3: 54 other tests red.

**2. `fold N: отказы — пустой result.md, заглушка в нём, задача не в архиве, уже свёрнутая` (:124): the stub branch :137-140 repeats the template sweep at :189.** verified — mutation probe. Deleting lib/fold.js:171 reds exactly :124 and :189 (pass 27, fail 2, rc 1); :189 asserts /остался заглушкой/ for every ru/en template paragraph (:200). :141-142 (no write after the refusal) are unique and must survive: both refusals throw in `prepare()` before any write.

**3. `fold: номера свёрнутых задач чужого worktree и чужой ветки заняты` (:821): the worktree half is vacuous; the test itself must stay.** verified — mutation probe, full suite (`node --test --test-timeout=60000 test/` rc=0, 450/450 with M1 applied). The root still holds `docs/archive/BS-1-alpha`, so `new b` in the root yields BS-2 without reading the worktree LOG.md. M1 lib/tasks.js:314 `if (existsSync(log)) fromLog(readText(log), source);` -> a comment: full suite 450/450, rc 0 — the worktree LOG scan is guarded by no test. M2 lib/tasks.js:296 `for (const wt of worktrees(root))` -> `for (const wt of [])`: this test stays green; only the commands test about foreign worktree numbering is red. M3 lib/tasks.js:330 (branch LOG scan) -> a comment: this test is red — it is the only guard of the branch LOG scan.

**Regression guards that must stay:** :85, :389, :473, :498, :518, :537, :683, :713, :744, :768, :821.

## Work to do

- Delete the test at :606-629.
- In :124 drop :137-140 (the `[TODO: исход]` stub refusal) and move the no-write checks at :141-142 (directory still in place, no LOG.md) to right after the empty-result refusal at :135.
- In :821 make the worktree step fold a number the root does not have: in the worktree create, archive and fold BS-3 without committing, then assert that `new b` in the root prints BS-4 and the occupied-number line naming the worktree source (the line `new` prints from lib/new.js:138; copy its exact wording from a run).

## Out of scope

- Any change under lib/.
- Adding a comment in place of the deleted :606 test.

## Verification

- `node --test --test-timeout=60000 test/fold.test.mjs; echo rc=$?` -> rc 0, tests 28.
- Mutation probe lib/tasks.js:314 -> comment: the strengthened :821 test is red (it was green at base).
- Mutation probe lib/tasks.js:330 -> comment: :821 still red.
- Mutation probe delete lib/fold.js:171 -> :189 red; lib/fold.js:74 `if (true)` -> :85 red.
- `npm test; echo rc=$?` -> rc 0.
