# ADR-044: Closed tasks fold into a journal line; the body stays in git

**Status:** Accepted
**Date:** 2026-09-28
**Deciders:** Velklish

## Context

The archive grows by one directory per closed task, and those directories crowd live rules out of every search over `docs/`. git can keep the text of a closed task: as files in a past revision, or, when the files never reached a commit, as a commit message. Numbers, outcomes and close dates must stay readable without git, and every command that counts numbers must keep seeing folded tasks, or a number would be issued twice. The outcome is read from the free prose of `result.md`, so that prose needs a contract that fails early instead of silently writing `—` into the journal.

## Options

- **Keep archive directories forever** — search noise grows with every close.
- **Fold automatically on upgrade or by age** — removes history without an owner step.
- **An explicit outcome field in `result.md`** — a second place to fill, while the first paragraph already names the outcome.
- **Presence of a file in the revision instead of blob equality** — accepts a changed file as its own revision.

## Decision

- **A separate command.** Folding is `fold`; `archive N` is unchanged and refuses an archived or folded task, pointing to `fold` (`run` in `lib/archive.js`). There is no unfold command.
- **The journal line.** A folded task is one line in `<docs>/archive/LOG.md`: `- <a id="<lowercase id>"></a>`<id>-<slug>` · <date> · <outcome> · `<rev10>` or — · <title>` (`formatLogLine`, `parseLogLine` in `lib/log.js`). Lines are appended, a blank line separates prose from the first entry, and the file keeps its own line endings (`appendLogLines`). The date is the first date of the first paragraph of `result.md`, else the date in the parentheses of its heading, else the commit date of the body revision, else today (`dateFromResult`). Bulk lines are ordered by date, then by number.
- **Folded tasks stay tasks.** `scanTasks` in `lib/tasks.js` reads journal lines together with directories, as archived and folded tasks; `foreignTaskIds` reads the journal of other worktrees and local branches, so `new` never reuses a folded number. A batch entry gets its own line with the outcome `batch <M>`, taken from the task scan in numeric order.
- **Incoming links.** Links to the folded directory, its `task.md` and `result.md` and its batch entry files are rewritten to `LOG.md#<anchor>`; links deeper into the directory are reported, not rewritten (`rewriteLinks` in `lib/fold.js`).
- **Body revision** (`bodyRev`). It is the last commit that touched the directory, accepted only when the directory is clean under `git status --porcelain --untracked-files=all`, `task.md`, `result.md` and every batch entry exist in that revision's tree, and each file's `git hash-object` equals its blob id. A mismatch on a file with no assume-unchanged or skip-worktree flag gets a second opinion from `git diff --quiet <rev> -- <file>`, so a CRLF file over an LF blob that git reports unchanged is equal (`drift`).
- **Four reasons for no revision** — no git, a dirty directory, a body absent from history, a body that diverges from its revision. Bulk fold refuses no git, dirty and diverged before any write, and drops an absent body with a stderr note, or carries it into the draft with `--embed-missing`. Single fold also computes the revision and records it when the directory is committed, clean and blob-equal; it writes `—` for any of the four reasons and always embeds the body in the draft.
- **Pre-write refusals.** A missing `task.md` or `result.md`, an empty `result.md`, or a `[TODO]` left in it (`prepare`). Single fold also refuses a task that is not archived, is already folded, or is a batch entry (`pickOne`), and a `result.md` that names no outcome word. Attachments — every other file of the directory — must already be in `HEAD` as they are on disk wherever the body goes into the draft (single fold, and bulk fold with `--embed-missing` for an absent body), or fold refuses before deleting them; a file git ignores is not an attachment unless the ignore rules cover the whole directory (`attachmentsOf`, `unsavedAttachments`). `--older-than YYYY-MM-DD` limits bulk fold by close date and is refused with a task number, as is `--embed-missing`.
- **Outcome.** The first dictionary word by position in the first paragraph of `result.md`, else in the heading note (`outcomeFromResult`). The dictionary is exactly `OUTCOME_FORMS` in `lib/log.js`: merged (слита / слиянием / merged, followed by into `<prefix>-N`), rejected (отклонена / отклонением / снята с плана / a leading bare снята / rejected), completed (выполнена / completed); "снята с плана" has no English form. One strict predicate, `hasNamedOutcome`, with one refusal text, `outcomeWordMissing`, serves lint gate 5 and single fold. Bulk fold also accepts a bare закрыта / closed / done or an `Исход:` / `Outcome:` marker as completed (`CLOSED_FORM`), and otherwise writes `—`. The `result.md` template states the requirement in both languages.
- **Order of writes.** Directories are removed first — `git rm -r -f` on tracked ones, then leftovers — then the journal is appended, then links are rewritten (`removeDirs`, `rewriteLinks`); a git failure before removal is a refusal that leaves the tree and the journal untouched. `--dry-run` prints the draft and writes nothing.
- **Draft.** stdout carries only the commit message draft in every fold form; the routine report and diagnostics go to stderr. The single draft's subject is `<id>: <title>`. Each embedded body line carries the mark `> `, so git's message cleanup keeps its `#` headings, and `show` strips the mark (`bodySection`, `messageSections`). The draft is mandatory only for a `—` line; with a revision the note says committing it is optional because the body is already in history (`draftNoteOne`); the draft itself introduces the body as a copy (`draftOne`). The bulk note has three variants: bodies embedded (the commit must carry the draft), nothing dropped (the draft carries no bodies), some dropped (it names the count of `—` lines) (`draftNoteMany`).
- **`show N`** (`lib/show.js`). It needs git. It prints the body files from the line's revision, `task.md` first, and names attachments by path. For a `—` line it takes the newest commit whose message holds a section of the task's body, else the newest commit whose subject starts with `<id>:`; with no body file at that revision it prints the task's sections of the message, or the whole message when it holds none, and warns when the body lacks its `# <id>` heading (`checkHeading`). With neither, it refuses.
- **Upgrade never folds.** The migration only creates `LOG.md` from the template when it is missing (`MIGRATIONS` in `lib/migrate.js`).
- **Lint gate 13** (`lintLog`, `lintLogRevisions` in `lib/lint.js`) has four checks: the line parses, the anchor equals the lowercase id, a `LOG.md#anchor` link from `<docs>/**` or a root `*.md` has an entry, and the revision is reachable from `HEAD` — with a warning instead of a verdict on a shallow clone, without git or on a git failure.
- **Acceptance recipe** (the `backslop-batch` skill, both layers). Single-task acceptance runs `archive N`, completes `result.md` and runs `fold N` into the acceptance commit, whose message is the draft. A track of several tasks leaving as one commit only archives, and folds in the next commit, where the lines get revisions and no draft is required. A batch folds after its entries.

## Consequences

- `docs/` stops growing by two files per closed task.
- Reading a closed task costs `show N` and a git repository.
- A `—` line depends on the acceptance commit carrying the draft, which the tool cannot enforce.
- A recorded revision depends on staying reachable from `HEAD`: a squash or rebase after folding breaks it, and gate 13 reports it.
- A directory with an uncommitted `result.md` is refused by bulk fold, not dropped.
- A consumer archive directory whose `result.md` names no outcome word turns gate 5 red after an upgrade.
- A hand edit of a `batch <M>` outcome is read as a separate closed task.
