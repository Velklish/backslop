# ADR-050: Tasks and decisions live as files; a task's status is its directory

**Status:** Accepted
**Date:** 2026-09-29
**Deciders:** Velklish

## Context

A project needs a task tracker and a decision log that live next to the code, that an agent reads without any service, and that do not conflict when parallel branches work at once. A single list file conflicts on every take and every close, and its "next free number" line conflicts always. Decisions scattered over chats are not found when they are needed.

## Options

- **One task-list file or an index** — every take, close and reorder edits the same lines, so parallel branches conflict on it.
- **An external tracker** — an agent cannot read it offline or from a checkout, and the decision history leaves the repository.

## Decision

- **A task is one file** `<PREFIX>-N[.k]-<slug>.md` (`taskFileRe` in `lib/tasks.js`): the prefix follows `PREFIX_RE` in `lib/config.js`, the slug is lower-case Latin letters and digits joined by hyphens (`SLUG_SRC` in `lib/ids.js`). Its first line is `# <id> · <title>`, and the heading names the same number as the file name (lint gate 2, `lintTaskFiles` in `lib/lint.js`).
- **The status is the directory** under `<docs>/backlog/`: `triage`, `queue`, `active`, `deferred`, `minor` (`STATUSES` in `lib/config.js`). The backlog holds these five directories and `README.md` and nothing else — no index file (gate 3, `lintBacklogLayout`); a status directory holds only task files (gate 2). `new <slug>` creates a task in `triage/`, `--queue` puts it in `queue/`, `--minor` in `minor/`.
- **The list is a command.** `status` prints active, queue by rank, deferred, triage, minor by scope and the archive count, read from disk each time (`collectStatus` in `lib/status.js`); `status --json` gives the same content to orchestrators and scripts. Queue rank is a field of each queued file ([the queue-order ADR](adr-049-queue-order.md)).
- **A status change is `mv`** (`lib/mv.js`): `git mv` for a tracked file, a plain rename for an untracked file or outside git, any other git failure refuses before the move (`moveFile` in `lib/tasks.js`). The move rewrites the task's outgoing links and incoming links in every markdown file of the repository except owned adapter outputs (`relocateTask`). The fields a status owns move with it: Order and Previous order for `queue/`, a Taken date set on entering `active/` and removed on leaving, a Deferred section added on entering `deferred/` when missing, the minor form with Cost and Evidence for `minor/` ([the findings ADR](adr-047-findings.md)). Gate 4 (`lintStatusFields` in `lib/lint.js`) requires what each status needs — an integer, unique Order in `queue/`, a Taken date in `active/`, a filled Deferred section in `deferred/`, Cost and Evidence in `minor/` — and refuses a repeated field line; a field left behind outside its status is not checked ([the queue-order ADR](adr-049-queue-order.md)). `archive` is not a status: `mv N archive` is refused, and an archived task is not moved by `mv`.
- **Closing is two steps.** `archive N` moves the file to `<docs>/archive/<id>-<slug>/task.md`, rewrites links and adds a `result.md` stub the approver completes (`lib/archive.js`); `fold N` then turns that directory into a line of `<docs>/archive/LOG.md` ([the closed-task journal ADR](adr-044-closed-task-journal.md)). An unfolded archive directory is legal for as long as it stays (gate 5). Minor entries close into a batch task instead of one by one ([the findings ADR](adr-047-findings.md)).
- **Numbers are counted, not coordinated.** `new` takes the next number over `scanTasks` — the status directories, archive directories with their batch `minor/`, journal lines — plus `foreignTaskIds`: other worktrees on disk and every local branch, read through `git ls-tree` and that branch's journal (`createTask` in `lib/tasks.js`). Clones and remote branches are not seen. `<PREFIX>-7` and `<PREFIX>-007` are the same number, and gate 2 refuses a number used twice.
- **The change procedure and the roles** — worker (take, change, document, gates) and approver (accept and archive, triage review, commit) — live in the AGENTS.md block that `init` writes (`templates/agents-section.md` and its English twin); the details live in the skills `backslop-task` (one task), `backslop-batch` (a worker run by tracks) and `backslop-seed` (documentation after installation).
- **Gates are the `gates` list** of `backslop.json`, by default the one entry `<cli> lint` (`loadConfig` in `lib/config.js`), and `<cli> gates` runs exactly that list; lint is not run a second time beside it (the gates runner ADR).
- **The command-line contract.** Every command parses its arguments strictly (`parseCommandArgs` in `lib/util.js`): an unknown flag and an extra positional argument are refused with exit code 1, and the extra positional is refused even next to `--help`. The refusal speaks the project language when a config is found (`projectHintsOrNull` in `lib/config.js`) and carries both languages outside a project. `status --json` prints `null` for a blank field — title, created, taken, deferred reason, order, scope, cost — never an empty string.
- **Decisions are ADR files** `adr-NNN-<slug>.md` in `<docs>/adr/`. `adr <slug>` renders the project's ADR template with the next number, the largest existing one plus one (`lib/adr.js`), and does not write the table row: the topic and status wording belong to the author. Gate 8 (`lintAdrIndex`) requires every ADR file to be linked from `<docs>/README.md`, its name to match the pattern and its number to be unique. `init` finds the project's process ADR by the slug `process` and renders one from the template only when none exists.
- **One ADR per topic.** A changed decision rewrites its ADR, in place or as a new file that replaces it; the replaced file is deleted, its table row goes with it, and nothing cites its number. There are no "superseded by" chains, and the table row's Status equals the Status line of the file.

## Consequences

- A move touches more than one file: every file that links to the task, and in the queue the other queue files a renumbering rewrites. Parallel branches conflict there too, not only on the same task.
- Seeing the queue costs a command; opening the backlog README shows no list.
- Lint holds links, numbers, the backlog layout and the fields each status requires; the quality of a task's text and of its result stays with the author.
- Gate 8 checks that an ADR is linked, not what the Status column says; a Status cell that drifts from the file is not caught.
- A number taken only in a clone or on a remote branch is not seen, so two machines can still create the same number; lint reports the duplicate once both reach one tree.
- Rewriting an ADR in place loses no history: the earlier text stays in git.
