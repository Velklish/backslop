# ADR-047: Findings: numbering under a parent, cost label, the minor/ status and batch closing

**Status:** Accepted
**Date:** 2026-09-28
**Deciders:** Velklish

## Context

Work on a task keeps turning up findings. Made into full cards, every observation fills `triage/` faster than it drains. A finding needs a stable link to the task it came from, without a third level of numbering. An entry that waits for a batch is never revisited by its author, so it has to carry its evidence from the moment it is written, through both ways into the waiting status, and lint has to agree with the commands on what a valid entry is. How a finding is verified before it is acted on is the protocol in [04. Finding verification protocol](../reference/04-verification.md); this ADR does not restate it.

## Options

- **Every finding a full card in `triage/`** — review load grows with every observation, and cheap findings crowd out expensive ones.
- **A third numbering level (`N.M.k`)** — longer ids in file names, headings and commits for a relation the Parent field already records.
- **Evidence optional in `minor/`** — the entry reaches a batch that nobody who saw the finding will ever read, and the batch cannot act on it.

## Decision

- **Numbering.** `new <slug> --parent N[.M]` needs an existing parent in any status, in the archive or in the journal (`createTask` in `lib/tasks.js`), and gets the next free `N.k`, counted over the status directories, archive directories with their batch `minor/`, journal lines, other worktrees and local branches (`nextSub`, `foreignTaskIds`). A finding of a finding gets `N.k` under the same root task, and its Parent field names the exact parent: a finding outside `minor/` gets the field only when its parent is itself a finding, a `minor/` entry always carries it. Lint gate 2 requires task `N` to exist (`lintTaskFiles` in `lib/lint.js`). Parent is informational: lint rejects only a repeated field.
- **Gate 9.** Lint warns — exit code 0 — about a finding in `triage/` whose root task `N` is archived or folded (`lintClosedParent`). That check does not consult the Parent field, so a closed exact parent `N.M` with `N` open is not reported, and findings in other statuses are not reported. The same gate warns about a Parent field in a status directory whose task number differs from the number in the file name; the field is read for nothing else, so a wrong one blocks no command and the gate does not fail.
- **Cost scale.** A finding carries a cost label on the reviewer's scale: `critical` — it breaks in use, loses data or grants a right nobody granted; `major` — a stated contract or rule is broken, or a case the change claims to cover stays unchecked; `minor` — the cost is local and nothing else depends on it. When unsure, raise the label. The label decides the fate: `critical` is fixed now; `major` inside the current task's scope is fixed now; `major` outside it becomes a card in `triage/` through `new --parent`; `minor` and hypotheses go to `minor/`. The process text lives in the backlog rules template (`templates/docs/backlog/README.md` and its English twin).
- **`minor/` is the fifth status** (`STATUSES` in `lib/config.js`): `init` creates it, and lint gate 3 requires it (`lintBacklogLayout`).
- **`new --minor`** (`run` in `lib/new.js`). It needs `--parent` and refuses `--queue`. `--cost critical|major|minor` defaults to `minor`, and a level above `minor` needs `--hypothesis`; `--hypothesis` and `--evidence` are refused without `--minor`; `--cost critical|major` with `--parent` and no `--minor` writes the Cost field of the `triage/` or queue card (a dash when the flag is absent), and `status` shows it. `--evidence` is required and must not be blank: the refusal names the three forms evidence takes and comes before the task scan and any write. The entry lands in `minor/` with an empty Scope, Created, Parent, Cost and an Evidence section built from the flag. A `triage/` finding keeps an evidence placeholder for its reviewer instead.
- **`mv … minor`** (`lib/mv.js`). Evidence is checked for the whole call before the first move; `--evidence` is accepted only with target `minor` and a single task number. `minorForm` reshapes the card: statement sections holding only placeholders are removed, written text stays, a Context section becomes Evidence when there is no Evidence section, and `--evidence` writes the evidence line as `new --minor` does. A Cost above `minor` without the hypothesis mark refuses the whole call before the first move. `Cost: minor` is added when the card has no Cost field or a dash, with a note to raise it for a hypothesis of a costlier finding, and a placeholder Scope is blanked. `mv` keeps an existing Parent field and never adds one.
- **Lint for `minor/`.** Gate 4 requires a readable Cost — `critical`, `major` or `minor`, a level above `minor` only with the hypothesis mark — and a non-empty Evidence section without a `[TODO]` placeholder (`lintStatusFields`); an empty Scope in `minor/` is a warning (`lintAreaField`). Gate 5 allows only entry files `<prefix>-N[.k]-<slug>.md` in a batch's `minor/` directory (`lintArchive`).
- **Batches.** A batch is an ordinary queue card listing entry numbers. It closes with `archive M`, then `archive N.k --into M` for each entry (`archiveInto` in `lib/archive.js`): the entry must be in `minor/`, M must exist, be archived and not folded, and not be a minor entry itself, and `--range` is refused. The entry file moves to `archive/<M>-<slug>/minor/` with incoming links rewritten and gets no `result.md` of its own; its outcome is a line in M's `result.md`. `fold M` comes last: each entry gets its own journal line with the outcome `batch M`, and an entry cannot be folded alone. Batch entries remain tasks for numbering and for number mentions. `status` lists `minor/` grouped by scope, with each entry's cost.

## Consequences

- Only a `major` finding outside the current scope becomes a full card.
- An understated label hides an expensive finding in a batch.
- A hand-written `minor/` entry without Evidence fails gate 4, while entries made by `new --minor` or `mv … minor` pass from birth.
- `mv` keeps an existing Parent and never adds one, so a card moved from `triage/` whose parent is a root task has no Parent field.
- Gate 9 does not report a closed exact parent `N.M` while `N` is open.
- A folded batch cannot take more entries: its directory is gone from the tree, and `archive N.k --into M` refuses.
