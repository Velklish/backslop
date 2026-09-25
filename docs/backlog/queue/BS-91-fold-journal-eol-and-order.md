# BS-91 · fold: CRLF blobs git calls clean, journal EOL, numeric minor scan, reports off stdout

- **Order:** 90
- **Scope:** [02. CLI](../../reference/02-cli.md) § fold
- **Created:** 2026-09-25
- **Dependencies:** BS-86

## Context

Line numbers refer to base commit 6f6318e (v0.11.0). `$BS` below is `node <repo>/bin/backslop.js`; throwaway projects are created with `git init -q && $BS init --lang en --tools none` unless stated otherwise.

Four verified bugs in how `fold` checks bodies, scans a batch and writes the closed-task journal docs/archive/LOG.md.

**1. Medium — bulk fold refuses a clean directory whose blobs were committed with CRLF once `core.autocrlf=true|input` is set.** verified — reproduced on 6f6318e (git 2.54.0, macOS) for both `true` and `input`.
- CRLF task.md/result.md committed with `core.autocrlf=false`; `fold --dry-run` then lists the task. After `git config core.autocrlf true`: `git status --porcelain -- docs/archive/BS-1-alpha` empty, `git diff --quiet HEAD -- docs/archive/BS-1-alpha` rc=0, but `$BS fold` → rc=1 `✖ docs/archive/BS-1-alpha/result.md: the file differs from its revision <rev> although git status reports the directory clean (assume-unchanged, skip-worktree) — the recorded revision would promise text it does not contain. Commit the file and retry …`. `git add -A && git commit` stages nothing and the retry fails the same way; only `git add --renormalize` + commit gives rc=0.
- Root cause: `bodyRev` compares `git hash-object -- <files>` (clean filter applied) with the `ls-tree` blob ids (lib/fold.js:267-276); the refusal text (lib/fold.js:196-199) names a cause that is not present. The comment at lib/fold.js:267 and docs/reference/01-layout.md:126 cover only the opposite case (CRLF worktree over an LF blob). Git-for-Windows installs with `core.autocrlf=true`; Windows is supported. The fold ADR (docs/adr/adr-034-fold-checks-body-blobs-against-revision.md:20 at 6f6318e) chose this check so that it trusts git's filters the way `git status` does.

**2. Minor — fold appends LF lines to a CRLF LOG.md.** verified — reproduced on 6f6318e for `fold` and `fold 1`.
- LOG.md committed with CRLF (5 of 5 lines) → after `fold` 5 CRLF and 2 LF lines; `git ls-files --eol docs/archive/LOG.md` → `i/mixed w/mixed`; `od -c` shows `.\r\n\n- <a id=`. lint and show stay rc=0 (readers split on `/\r?\n/`).
- Root cause: lib/fold.js:75 calls `appendLogLines(readText(log), lines)` without an eol; lib/log.js:202 defaults `eol='\n'` and lib/log.js:204, :207 build the gap and lines with it. lib/tasks.js:346-347 states the rule that a CRLF file stays CRLF (`eolOf`). The `eol` parameter of `appendLogLines` is passed by no caller today (callers: lib/fold.js:75, test/tasks.test.mjs:333, :335-337); this fix makes it used, so it must not be deleted as dead.

**3. Minor — minor entries of a batch are written in lexicographic order.** verified — reproduced on 6f6318e.
```text
- Batch BS-1 with minors BS-1.1 … BS-1.11 archived into it, `fold 1` → journal lines `bs-1, bs-1.1, bs-1.10, bs-1.11, bs-1.2, …, bs-1.9`; the draft sections follow the same order; rc=0, lint rc=0.
- Root cause: lib/fold.js:244 sorts `minorEntries` by `a.id.localeCompare(b.id)`, while lib/fold.js:48 and lib/tasks.js:163 sort by `num`/`sub` numerically and docs/reference/01-layout.md:102 documents journal order as "by number" for equal dates. `fold.minorEntries` (lib/fold.js:234-245) is a weaker copy of the `scanTasks` minor loop (lib/tasks.js:148-162): it iterates bare `readdirSync(minorDir)` with no file check and builds ids by hand (:242). Second repro: a **directory** `docs/archive/BS-1-fold-probe/minor/BS-1.1-dir-entry.md` in an archived batch → `fold 1` rc=1 with an uncaught `Error: EISDIR: illegal operation on a directory, read` at `readText (lib/tasks.js:349:16)` ← `prepare (lib/fold.js:219:18)`, no CliError. Lint gate 5 (lib/lint.js:436-439) reports such an entry and stays the stricter validator (it also rejects a symlink to a file and skips dotfiles).
```

**4. Major — bulk `fold` with nothing to fold prints its report on stdout.** verified — reproduced on 6f6318e in a fresh project with an empty archive.
- `$BS fold > out 2> err; echo rc=$?` → rc=0, stdout `  nothing to fold: the archive has no unfolded directories`, stderr empty; `--dry-run` behaves the same.
- Root cause: `info()` at lib/fold.js:40 (util.js:13-17: `ok`/`info` write stdout, `warn`/`bad` stderr). The draft-on-stdout rule is stated for `fold N` (docs/reference/02-cli.md:15, templates/en/agents-section.md:14) and `fold N` never reaches this branch, but `fold > "$(git rev-parse --git-dir)/BACKSLOP_DRAFT"` followed by `git commit -F` would commit the report line as the message.

## Work to do

- Bug 1: when a hash-object id differs from the recorded blob, ask git for a second opinion (`git diff --quiet <rev> -- <file>`); accept the file when git reports it unchanged. When the mismatch is real, keep the refusal but drop the assume-unchanged/skip-worktree guess unless `git ls-files -v` shows such a flag, and name line-ending normalisation with `git add --renormalize <dir>` as the remedy when `core.autocrlf` is set.
- Bug 2: pass `eolOf(text)` of the existing LOG.md text as the eol argument of `appendLogLines` at lib/fold.js:75 (keep the parameter).
- Bug 3: delete `fold.minorEntries` (lib/fold.js:234-245). In `prepare`, take the batch entries from the `scanTasks` records `fold` already loads (`tasks.filter((t) => t.into === task.id)`; they are filtered by `isFileEntry` and sorted numerically) and map them to the `{ id, slug, file }` shape the rest of fold uses. If those records are not in scope there, export the minor-dir loop of lib/tasks.js:148-159 as one helper used by both; do not keep a second loop. Leave lint gate 5 unchanged. Behaviour change: `fold` ignores a non-file entry in `minor/` (gate 5 still reports it).
- Bug 4, test first: in test/fold.test.mjs, bulk `fold` and `fold --dry-run` on a project with an empty archive exit 0 with empty stdout and the nothing-to-fold line on stderr; see it fail; then switch lib/fold.js:40 from `info()` to `warn()` (the BS-125 (`report-channels-and-dry-run`) card settles the routine-report glyph later).
- CHANGELOG.md, unreleased section: `fold` keeps a CRLF journal CRLF, orders batch minors numerically, no longer crashes on a directory in `minor/`, and reports "nothing to fold" on stderr.
- Add the regression tests listed under Verification to test/fold.test.mjs.

## Out of scope

- Attachments, embedded-body lookup and message cleanup — the BS-86 (`fold-keeps-bodies-retrievable`) card.

## Verification

- New test (bug 1): CRLF blobs committed with `core.autocrlf=false`, then `core.autocrlf=true` → `fold` rc=0 and the journal line carries the revision.
- New test (bug 2): CRLF LOG.md, `fold 1` → every line of LOG.md ends in CRLF (`git ls-files --eol` shows `w/crlf`).
- New test (bug 3): batch with minors 1.1, 1.2, 1.3, 1.10, 1.11 → journal order 1, 1.1, 1.2, 1.3, 1.10, 1.11.
- Example with fixture ids (see block):

  ```text
  New test (bug 3, directory): a directory named `BS-1.1-dir-entry.md` in the batch `minor/` → `fold 1` rc=0 with no stack, and `lint` gate 5 still reports the entry before the fold.
  ```
- New test (bug 4): `node <repo>/bin/backslop.js fold > out 2> err; echo rc=$?` on an empty archive → rc=0, `out` empty, `err` holds the nothing-to-fold line.
- `npm test` → rc=0; `node bin/backslop.js lint` → rc=0.
