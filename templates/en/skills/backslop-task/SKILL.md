---
name: backslop-task
description: "The lifecycle of one backslop backlog task — who changes it, who verifies it, who accepts it, and when it moves to the archive. Always use when taking a queued task, closing a completed or rejected task, moving it to the archive, creating a triage finding, or reviewing triage. Triggers: “take a task”, “what is first in the queue”, “do a queued task”, “close a task”, “move it to the archive”, “create a finding”, “review triage”, “review inbox”, “defer a task”, and a task number in the form {{prefix}}-N. Workers under an orchestrator use this too: it states the boundary a worker must not cross. Not for a complete worker run (`backslop-batch`) or documentation population after installation (`backslop-seed`)."
---

# backslop-task — one task lifecycle

The subject is one task from taking it to archiving it. Tracker rules are in `{{docs}}/backlog/README.md`; this file lays out the order by role and step.

## Two roles and one boundary

The block splits the work between the worker (steps 1–4) and the approver (5–7). Under orchestration the worker is a session under the orchestrator and the approver is the orchestrator. The split is more than ceremony: they are different contexts, and the approver sees what the author of the change does not.

**The boundary is at step 5.** Moving a task to the archive is an acceptance event; when performed by the author, it means “I accepted myself”.

## Task flow

Steps 1–7 are in the backslop section of AGENTS.md; below, each step gets only what the block does not say.

1. **Take a task.** The priority in `{{cli}} status` is the “Order” field. Whoever holds the queue moves the task into `active/`: a single agent does `{{cli}} mv N active`; an orchestrator does it while distributing briefs. A worker under an orchestrator does not touch directories.
2. **Change it.** A code comment explains a limitation invisible from the code, not the history of a change: task number and date belong in git and the tracker.
3. **Document in the same pass.** Review the whole set, not only the obvious file: the applicable `{{docs}}/reference/` section, the affected subsystem README, CHANGELOG, and templates. If a changed text links to a neighbouring file, that neighbour belongs to the change.
4. **Run gates before reporting, not after.** For a committed branch, run `{{cli}} gates --require-clean --base <base>`, where `<base>` is the commit before the task was taken, the same `<base>` as in step 4 of acceptance below. Without `--base` only uncommitted paths count and scoped gates are skipped. `--require-clean` refuses on a dirty tree before the first command; `--json` returns the summary for a report. Gates stop at the first red unless you pass `--keep-going`. In “not run N (out of scope K)” only K is path filtering; the other N−K gates were never reached.{{probeRule}}{{probeBreakage}} Run gates on an unchanged tree: editing files during a run produces a red result with a misleading diagnosis; `--require-clean` checks that mechanically, and the snapshot at the end names the commit and whether the tree is clean.{{probeSecond}}

5. **Acceptance and archive** — by the approver, one pass (below).
6. **Triage review** — by the approver, immediately after acceptance (below).
7. **Commit.** Where the branch goes — a branch and MR, or direct main — follows the project rules.

## What a worker does instead of closing

When the worker is finished, they **commit to their branch** and send the result through the channel supplied by the harness: an agent answer or a message to the orchestrator. The result must include:

- for every task, what was done and how it was verified;
- files touched beyond the obvious ones;
- gate results as numbers, not merely “green”: how many checks, how many files, and “not run N” and “out of scope K” as two numbers. Take them from the summary line of `{{cli}} gates` or from its `--json`, not from memory;
- **what remains open and where the worker worked around it** — this is more valuable than the rest because it determines whether to raise an isolated reviewer;
- findings outside the assigned scope — a neighbouring bug, a gap in rules, an unanswered question — with a cost label: fix `critical` now within your boundaries, in another track's files message the orchestrator at once; fix `major` within your task's “Scope” now and name it here; file `major` outside it yourself, in the worker branch: `{{cli}} new <slug> --parent N[.M]` puts a file in `triage/`; file `minor` and hypotheses with `{{cli}} new <slug> --parent N[.M] --minor --evidence "…"` into `minor/`. The worker never moves or archives an existing task file. Record a finding in the same pass in which you read it, not after acceptance. A verifiable fact in a finding includes evidence — a command or a file and line; grep takes seconds when already in the repository. Not verified means a hypothesis, and its place is `minor/` with `--cost <level> --hypothesis`; it carries `--evidence` just like a verified finding, only worded as an assumption — without it the command refuses before the file is created.

The worker does not push their branch or touch the repository’s main tree; the assignment does not override this.

## Acceptance and archive

The approver has passed the review gate and accepted the work. **The skill does not decide who reviews a diff.** Under orchestration, the orchestrator chooses using the review table in `backslop-batch`. Alone, ask the user with a survey offering at least two choices: regular review (subagent or a project review skill) or isolated review (a separate session with fresh context); list your recommendation first and word the question as *Talking to the owner* in the backslop section of AGENTS.md says. Keep the chosen method for the whole task. Then do **all actions together in one pass**:

1. `{{cli}} archive N [--range <base>..HEAD]` moves the file to `archive/<id>-<slug>/task.md`, rewrites links to it throughout the repository, and creates a `result.md` stub beside it; it also prints the documentation files touched by the task, which is where the “documentation updated” line comes from.
2. Complete `result.md`: outcome (completed, rejected, or merged), exactly what was done, verification with numerical gates{{probeVerified}} and live run, and documentation updated. While a `[TODO` placeholder remains outside code, `{{cli}} lint` fails — that is the reminder; the placeholder form quoted in a code span does not count.
3. `{{cli}} fold N > "$(git rev-parse --git-dir)/BACKSLOP_DRAFT"` folds the directory into a `{{docs}}/archive/LOG.md` line, moves incoming links onto its anchor, and sends the definition and the result in full into a commit message draft: the command prints the draft on stdout and its report on stderr. The draft lands in the git directory, outside the working tree, so the `git add -A` of step 4 does not pick it up. The tree keeps only what is alive; the record of work lives in git. **Do not commit between steps 1 and 3:** that commit would become the journal line's revision, the squash in step 4 would drop it, and the line would name a commit that is not in history — `show N` could not find the body through it, and `{{cli}} lint` on the final commit fails.
4. The final acceptance commit — one per task — carries the draft from step 3 as its message: `git add -A`, `git reset --soft <base>` (the commit before the task was taken), `git commit -F "$(git rev-parse --git-dir)/BACKSLOP_DRAFT"`. The subject is `{{prefix}}-N: <what was done>`, as in step 7 of the block; keep the body: without it the task body is lost — it is no longer in the tree. A `fixup` onto the worker's commit discards the draft, and so does a squash after this commit. **`{{cli}} lint` is green on the final commit, before pushing:** it sees a journal revision dropped by the squash only after that commit.

On Windows, run this recipe in Git Bash.

**A rejected task closes in the same way**, with its rejection reason in `result.md`. **A deferred task does not close:** run `{{cli}} mv N deferred`, then give the “Deferred” section its reason and return condition; without them, `lint` fails.

## Triage review

After a task closes, give every entry accumulated during it a next step. Not “when enough accumulate”: the finding author was a session that no longer exists, and no later pass can recover its context. There are two cadence points: this one and the full review before a worker run (`backslop-batch`). Both, and the review rules, are in `{{docs}}/backlog/README.md`.

Decide yourself: merge an obvious duplicate (`{{cli}} archive N` with outcome “merged into M” in `result.md`, copying the entire content into the receiving task), clarify the wording, put it in the queue and choose its place (`{{cli}} mv N queue --top | --after M`), or defer it with a return condition. Ask the owner **only before rejecting**, worded as *Talking to the owner* in the backslop section of AGENTS.md says: a finding discarded without asking will never be found a second time. Review is complete by the criterion in `{{docs}}/backlog/README.md`, “Triage cadence”.

Before queueing a factual claim — a number, “covered by a test”, “printed by three commands” — verify it with evidence; incorrect facts create incorrect boundaries for the implementer. An unverified claim is not a card but a hypothesis: `{{cli}} mv N minor --evidence "presumably …"` with the label in `Cost`. Entries in `minor/` are not reviewed on closure — they wait for a batch before the run (`backslop-batch`, “Before splitting”).
