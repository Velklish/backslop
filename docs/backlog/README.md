# Backlog

The operational tracker for backslop: **one task is one file**, and **status is the directory** containing it. There is no task list here — `node bin/backslop.js status` prints it. For closed tasks, see the [archive](../archive/README.md).

This file belongs to backslop: an update (`node bin/backslop.js upgrade`, the `migrate` step) rewrites it from the template of the new version, and a local edit here does not survive the next update. Keep project rules of your own outside this file — for example, in `AGENTS.md` outside the backslop section.

## Directories

| Directory | Contents | How it gets there |
|---|---|---|
| `triage/` | Unreviewed ideas and findings. The file is the entry | `node bin/backslop.js new <slug> --title "…"`; a `major` finding outside the current task's scope is `node bin/backslop.js new <slug> --parent N[.M]` |
| `queue/` | The queue; priority is the integer “Order” field, in steps of 10; lower comes first | `node bin/backslop.js new <slug> --queue [--top]`, `node bin/backslop.js mv N queue [--top \| --after M \| --restore]` |
| `active/` | Work in progress; “Taken” is the date it was started | `node bin/backslop.js mv N… active` by the person holding the queue |
| `deferred/` | Deferred work; the “Deferred” section gives the reason and return condition | `node bin/backslop.js mv N deferred` |
| `minor/` | Minor findings and hypotheses: they wait for a batch, not for review; the “Cost” field is required, “Scope” is filled in when batches are cut | `node bin/backslop.js new <slug> --parent N[.M] --minor --evidence "…" [--cost <level>] [--hypothesis]`; `node bin/backslop.js mv N minor [--evidence "…"]` |
| [`../archive/`](../archive/README.md) | Closed: a [`LOG.md`](../archive/LOG.md) journal line, and before folding a `task.md` + `result.md` directory; minor entries in the batch's `minor/` | `node bin/backslop.js archive N`, complete `result.md`, then `node bin/backslop.js fold N`; a minor entry — `node bin/backslop.js archive N.k --into M` |

## How to maintain it

- When an idea appears, add an entry in `triage/`: `node bin/backslop.js new <slug>` writes a card from the template, and nothing has to be filled in before review. A line or two under “Context” is enough. Review is a separate pass.
- **A finding carries a cost label, and the label decides its route.** The scale is the reviewer's: `critical` — it breaks in use, loses data, or grants a right nobody granted; `major` — a stated contract or rule is broken, or a case the change claims to cover stays unchecked; `minor` — the cost is local and nothing else depends on it. In doubt, raise the label: an understated one hides an expensive finding among cheap ones. The approver does not accept a finding without a label.
- `critical` is fixed now: within the finder's boundaries by the finder; in another track's files by a message to the orchestrator in the same turn, without waiting for the result. `major` in the same “Scope” as the current task is fixed now on its branch and named in the result. `major` in another scope becomes a card in `triage/`: `--parent N` gets an `N.k` number, `--parent N.M` gets the next free `N.k` and stores the exact finding in the `Parent` field. It will be lost in chat; do not duplicate the current task.
- `minor` and any finding without verified evidence — `--parent N[.M] --minor --evidence "…"`: an `N.k` file in `minor/` with the `Parent` and `Cost` fields and an `Evidence` section built from the flag. Evidence is required: without it the command refuses before the file is created, and anything unverified is stated as an assumption — “presumably …” — rather than skipped. A hypothesis carries the assumed label with a mark: `--cost major --hypothesis` writes `major (hypothesis)`; `major` and `critical` without the mark in `minor/` are a `lint` error: with evidence they are fixed, not queued for a batch.
- A verifiable claim in an entry — a number, “covered by a test”, “printed by three commands” — must include evidence: the command or file and line that produced it. If unverified, write it as a hypothesis. A definition with an incorrect fact gives the implementer wrong boundaries, and a failing test in someone else’s work is what turns it into truth.
- **A documentation card’s Verification names a check that fails on the old text:** a `quote:` block on the corrected passage, a test, or a lint rule. A fix that no check tells from the old text can be reverted unnoticed.
- A finding under a closed parent may remain in `triage/`: `lint` warns the approver but does not fail the gate.
- **Numbers are sequential** and never reused after closure; `node bin/backslop.js new` assigns them across the directories and the closed-task journal lines of the current tree, the repository’s other worktrees, and all local branches, so a worker in a worktree and the orchestrator in the main tree get different numbers; when a number on another worktree or branch made it skip, the command names it. A collision remains possible with a clone or an unfetched remote branch; `node bin/backslop.js lint` catches it at merge time, and the loser recreates the file.
- **Status = directory** is the only place status lives. A task file holds the definition, scope (a link to [reference/](../reference/README.md)), dates, and current state.
- **“Scope”** links to a [reference/](../reference/README.md) section: in `queue/`, `active/`, and `deferred/` an empty field or a field whose entire value is a `[TODO…]` placeholder left by `node bin/backslop.js new` is a `lint` error; in `triage/` the field is not checked — it is filled in during review; in `minor/` an empty field is a warning, and the approver fills it in when cutting batches. A standalone `[TODO…]` placeholder line in any markdown file under `docs/backlog/**` also fails `lint` — except in `triage/`, where placeholders are not checked at all: the card sits unfilled until review. `[TODO]` inside explanatory text, as part of a larger value, is not a placeholder. A finding from `node bin/backslop.js new <slug> --parent N[.M]` lands in `triage/`, where placeholders are not checked; once it leaves `triage/`, an unfilled `Evidence:` line fails `lint`, and `node bin/backslop.js mv N minor` refuses it until `--evidence` fills it.
- **Priority = the “Order” field** in `queue/`. Reorder with `node bin/backslop.js mv N queue --top` or `--after M`, including a task already in the queue: the file stays, only the number changes. To return a task where it left the queue from, use `--restore`: the departure stores that number in the “Previous order” field. The flag takes several numbers per call; a return without it discards the saved position and says so. Two files with one “Order” is a `lint` error.
- **Closure** — completed, rejected, or merged — is `node bin/backslop.js archive N`, complete `result.md`, then `node bin/backslop.js fold N`; the draft it prints and the rule for committing it are in the [archive README](../archive/README.md).
- **Quote** — a regular `quote:<path>` block guards a file invariant. A `quote:before:<path>` block stores a pre-change snapshot: content drift does not fail `lint`, but the target and closing marker remain required. A card that quotes a passage its own task changes takes `quote:before:` from the start: the task's change breaks a regular quote by construction — a bare substitution is enough — and `lint` fails on a snapshot of the defect rather than on an invariant. A quote of a passage the task leaves alone stays regular. The card's author sets the marker. If the card already sits in a status directory without it, the approver sets it: the worker leaves the card file alone and names in its result which block to switch to `quote:before:`.
- A deferred task gets a “Deferred” section with its reason and return condition; if the section is already present, `node bin/backslop.js mv N deferred` does not append it and prints “section exists; check the reason and return condition”; without completed fields, `lint` fails.
- A task that becomes an architectural decision moves to an [ADR](../README.md); the task file keeps a link.
- Project gates are the `gates` field in `backslop.json`; `node bin/backslop.js lint` is among them.

## Triage cadence

There are two review points, and neither replaces the other:

- **before a worker run, in full**, before splitting the queue into tracks: entries from earlier runs belong exactly to the subsystems being split now and join this run’s tracks at no extra cost;
- **after every closed task**, for entries accumulated during that task, not whenever enough have accumulated.

An entry that sits through several runs loses context: its author was a session that no longer exists.

**Minor batches are cut at the same point, before the run.** The approver walks `minor/` — `node bin/backslop.js status` prints it by scope — fills in empty “Scope” fields and assembles one batch card per scope: the scope the run touches anyway, or one with ten or more entries. A batch is an ordinary card, `node bin/backslop.js new <slug> --queue --title "…"`, listing the numbers under “Work to do”. The owner may order a batch at any time. Closing batch M: first `node bin/backslop.js archive M`, then `node bin/backslop.js archive N.k --into M` for each entry, and their outcomes as lines in the batch's `result.md`; `node bin/backslop.js fold M` comes last and carries the entries away with the batch — each gets its own journal line with the outcome “batch M”.

The agent decides without asking:

- merge a duplicate into an existing task or clarify its wording;
- put an entry in the queue and choose its place;
- defer it with a return condition.

Review verifies a factual claim with evidence before queuing it; unverified text is rewritten as a hypothesis. The agent asks the owner **only before rejecting** an entry: a finding discarded without asking will not be rediscovered. Ordering is agent work; the owner sets goals and reverses priority when needed.

Review is complete when every entry still in `triage/` has a named next step: merged, moved, or closed by the owner’s decision.
