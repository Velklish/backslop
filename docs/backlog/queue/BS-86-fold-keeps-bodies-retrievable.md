# BS-86 · fold: keep attachments and headings, findable embedded bodies, honest bulk draft intro

- **Order:** 40
- **Scope:** [02. CLI](../../reference/02-cli.md) § fold
- **Created:** 2026-09-25
- **Dependencies:** none

## Context

Line numbers refer to base commit 6f6318e (v0.11.0). `$BS` below is `node <repo>/bin/backslop.js`; throwaway projects are created with `git init -q && $BS init --lang en --tools none` unless stated otherwise.

Four verified bugs where a folded task body is lost, cannot be retrieved with `show N`, or is misdescribed in the draft.

**1. High — `fold N` deletes attachments without storing them.** verified — reproduced on 6f6318e in the documented flow `archive N` → write result.md → `fold N` (no commit in between).
- Task directory with task.md (staged rename), untracked result.md, measurements.md (`p95 = 12 ms`) and diagram.svg. `$BS lint` → rc=0. `$BS fold 1 > draft.txt` → rc=0; the draft has sections only for task.md and result.md; `docs/archive/BS-1-alpha` is gone; `git log --all --oneline -- docs/archive/BS-1-alpha/measurements.md` is empty; no warning on stderr.
- Root cause: `prepare()` builds `bodies` from task.md, result.md and minor entries only (lib/fold.js:215-220); `draftOne` prints only those (lib/fold.js:291); `removeDirs` runs `git rm -r -q -f` (lib/fold.js:351) and `rmSync(…, {recursive, force})` (lib/fold.js:363) on the whole directory. Lint gate 5 (lib/lint.js:414-440) accepts extra files, and docs/reference/01-layout.md:126 names attachments as legitimate content of the body directory. Bulk fold refuses the same dirty state; `show N` prints attachments when they were committed (lib/show.js:46-48 also prints binaries verbatim).

**2. Major — bodies embedded by bulk `fold --embed-missing` cannot be retrieved with `show N`.** verified — reproduced on 6f6318e (fresh `lang: en` project and a ru project).
- Two gitignored archived tasks; `$BS fold --embed-missing > draft.txt` → rc=0, draft subject `fold the archive into the journal: 1 tasks`, journal lines end in `· — ·`; `git add -A && git commit -F draft.txt`; `$BS show 1` → rc=1 `BS-1: the docs/archive/LOG.md line names no commit, and history holds no commit whose subject starts with “BS-1: ” — the body cannot be retrieved` while `git log --grep='<body text>'` finds the fold commit. Amending only the subject to `BS-1: …` makes `show 1` succeed.
```text
- Root cause: lib/fold.js:297 `draftMany` subject has no task id; lib/fold.js:108-110 tells the user this draft is the bodies' only storage; lib/show.js:30 falls back to `bySubject` for a `—` line and lib/show.js:88 matches only `/^BS-0*N:/`. The LOG.md header (templates/en/docs/archive/LOG.md:5) promises that `show` looks a `—` commit up by the `BS-N:` subject.
```

**3. Medium — git's message cleanup strips the `#` headings of the stored body.** verified — reproduced on 6f6318e (git 2.54.0, no `commit.cleanup` config).
- The fold draft holds 6–7 lines starting with `#` (`# BS-1 · Title`, `## Context`, …). `git commit -F draft` keeps them; `GIT_EDITOR=true git commit -e -F draft` (git's default cleanup=strip when the message is edited), `--amend`, or `-c commit.cleanup=strip` keeps 0; `$BS show 1` then prints the headless body with rc=0 and no diagnostic; `lint` rc=0.
- Root cause: `draftOne`/`draftMany` embed task.md/result.md verbatim (lib/fold.js:291, :306); lib/show.js:61-67 prints `%B`. docs/reference/02-cli.md:15 recommends `git commit -F` without `--cleanup=verbatim` and says the subject may be replaced (i.e. the message may be edited).

**4. Minor — the bulk draft intro claims every body sits in history.** verified — reproduced on 6f6318e (ru project). Exclude an archived task directory from git (`echo docs/archive/BS-5-delta/ >> .git/info/exclude`), then `$BS fold > bulk.stdout 2> bulk.stderr; echo rc=$?` → rc=0; stderr warns that the body is not in git history and names `fold --embed-missing`; the LOG line carries `—` in the commit field; `show 5` → rc=1 (no commit to read the body from). The stdout draft still opens with the `draftMany` intro (lib/fold.js:297-300): "A task body sits in history — its journal line names the revision that … show N reads it from."

## Work to do

- Bug 1: in `prepare()` enumerate the task directory recursively; every file that is not task.md, result.md or a minor entry is an attachment. When the directory has no recorded revision (the draft is the only storage), refuse `fold N` with a CliError listing the attachments (`commit the directory first, or remove the files`), unless they are committed in HEAD; never remove an unsaved attachment. In `show`, print only the paths of non-markdown files.
- Bug 2: make every bulk `--embed-missing` body retrievable: give each embedded task a section header that `show` can find (e.g. `--- <dirRel>/task.md ---` already exists) and extend `show`'s `—` lookup to search commit bodies for that task's section (`git log --grep` with a fixed-string pattern for the task directory) and print only that section; keep the `BS-N:` subject lookup for single folds.
- Bug 3: make the stored body survive `commit.cleanup=strip`. Owner decision: every embedded body line gets a fixed marker prefix that `show` strips back; fold commits written before this change (without the marker) are printed by `show` as they are. Document `git commit --cleanup=verbatim -F` next to the fold recipe in docs/reference/02-cli.md and in the fold note; `show` warns when the retrieved body has no `# <id> ·` first line.
- Bug 4: in `draftMany` (lib/fold.js:297-300 at 6f6318e; bug 2 above reshapes the same function), when any entry has `rev === null` the intro must not claim that every body is in history; name the `—` lines.
- Add the regression tests listed under Verification to test/fold.test.mjs and the show tests.

## Out of scope

- Line endings and ordering of journal lines — the BS-91 (`fold-journal-eol-and-order`) card.
- Changing the journal line format.

## Verification

- New test (bug 1): `archive 1`, untracked result.md and measurements.md, `fold 1` → rc=1 naming measurements.md, directory still on disk; after committing the directory `fold 1` → rc=0 and `show 1` lists measurements.md by path.
- New test (bug 2): two gitignored archived tasks, `fold --embed-missing > draft`, `git commit -F draft`, `show 1` and `show 2` → rc=0, each prints only its own task.md/result.md.
- New test (bug 3): fold draft committed with `git -c commit.cleanup=strip commit -F draft` → `show 1` prints `# BS-1 · …` and the `## …` headings.
- New test (bug 3, old format): a fold commit whose body lines carry no marker (the draft format before this change, committed with `git commit -F`) → `show 1` gives rc=0 and prints the body unchanged.
- New test (bug 4): the excluded-directory bulk fold from the context → the stdout draft makes no "sits in history" claim for that entry; restoring the old intro turns the test red.
- `npm test` → rc=0; `node bin/backslop.js lint` → rc=0.
