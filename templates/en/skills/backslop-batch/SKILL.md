---
name: backslop-batch
description: "A worker run over the backslop backlog — split the queue into tracks, required brief contents, worker boundaries, the review gate and criterion for a second review round, branch integration, and acceptance. Use when taking several tasks in one run and assigning them to workers — subagents in worktrees, separate sessions, or bus participants — and when managing a running batch: a result arrived, review is being prepared, or a worker branch is being merged. Triggers: “assign tasks to workers”, “run the backlog”, “orchestrate the queue”, “do it in parallel”, “a worker result arrived”, “merge a worker branch”, “should a reviewer be raised a second time”. Not for one task alone (`backslop-task`)."
---

# backslop-batch — a worker run over the backlog

You are the orchestrator: the session that holds the queue, splits it into tracks, writes briefs, and accepts work. Do not write code for a worker — that removes the only reason to separate contexts. The one-task lifecycle in `backslop-task` fully applies; this file adds what appears when there are several tasks and workers. `{{cli}}` is called `backslop` below.

A worker run is justified when the queue splits into **tracks** — directions that do not overlap in files. Two or three consecutive tasks in one subsystem are faster alone: launching a worker, briefing, and review cost more than the change itself.

## Three roles

| Role | Who | What it does |
|---|---|---|
| orchestrator | you | splits the queue, writes briefs, chooses the worker model, accepts work, moves statuses and archive |
| worker | a session in its own worktree | changes code from the brief, commits its branch, and sends results and findings |
| reviewer | an isolated read-only session | reads a diff with fresh context and does not fix findings |

## Before splitting — triage and consolidation

**Review triage in full before the run.** Review on task closure (`backslop-task`) does not replace this; it complements it. Entries from the previous run belong exactly to the subsystems you are about to split and can join this run’s tracks at no extra cost. Skip them and you hand them to the next run, which will visit the same files again. Rules are in `{{docs}}/backlog/README.md`.

**Minor batches are cut at the same point.** `backslop status` prints `minor/` by scope: fill in the empty “Scope” fields and assemble one batch card per scope — the scope the run touches anyway, or one with ten or more entries. A batch is an ordinary card, `backslop new <slug> --queue`, listing the numbers under “Work to do”, and it joins a track like any task of that scope. The owner may order a batch at any time. Closing batch M at acceptance: first `backslop archive M`, then `backslop archive N.k --into M` for each entry, and their outcomes as lines in the batch's `result.md` — an entry has no `result.md` of its own. `backslop fold M` comes last and carries the entries away with the batch — each gets its own journal line with the outcome “batch M”. A folded batch cannot take another entry: its directory is gone from the tree, and `archive N.k --into M` refuses.

**Also check the queue for consolidation.** Neighbouring tasks often prove to be one: the symptom is shared, causes differ, and the solution is one. Merge with `backslop archive N`, recording “merged into M” in `result.md`, and copy the content into the receiving task in full.

**A merge and a track are different.** A track groups tasks that change the same files while remaining distinct subjects: each has its own `result.md` and decision. Merge only when the subject is one. Tasks merged “for company” leave one archive report for two decisions, and after a month it no longer says what was done.

## Split the queue into tracks

One worker equals one subsystem, not one task. Tasks within a track share context; adjacent tracks do not overlap in files. Work that splits poorly stays with the orchestrator: tasks changing shared files — `AGENTS.md`, configuration, versions, or the whole CHANGELOG — create merge conflicts for no reason.

After distributing briefs, **move every assigned task to active work** in one call: `backslop mv N M K active`. You hold directories; workers do not touch them at all. When the run ends and you have not accepted work, return the whole track to the queue in one call: `backslop mv N M K queue --restore`. Each task goes back where it left from as far as the queue allows; among themselves the tasks line up in the order of their saved numbers, and the order of numbers in the command does not change the outcome. Need another priority — use `--top` or `--after M`, but they take one number. Without `--restore` the saved position is lost, and the command says so.

**Until integration, findings under task N are created only by the worker of its track** — `backslop new <slug> --parent N[.M]` in the worker branch, with `--minor --evidence "…"` for minors and hypotheses; the worker fixes `critical` within their boundaries and messages you at once about one in another track's files. With `--parent N.M`, the command assigns the next free `N.k` and stores the `Parent` field; with `--parent N`, it keeps the `N.k` numbering. Do not create findings under the same parent before integration: `new` counts `N.k` across neighbouring worktrees and local branches, but not across a separate clone or a worker branch not yet fetched, and two identical `N.k` meet only in `lint` at integration. Record your own observation about task N before integration in the acceptance notes or as a task without a parent.

## How to raise a worker

The harness supplies transport; the skill only states its requirements: a dedicated worktree and branch for each track, a self-contained brief, a channel for results and findings, and a ban on pushing or touching the main tree. Options:

- **an isolated Claude Code subagent** — the `Agent` tool with `isolation: "worktree"`; the brief is the subagent prompt and the result is its answer; select model and effort at launch;
- **a separate session** — `git worktree add ../<track> -b <track>` and an agent session in that directory; the first message is the brief and the answer or file is the result;
- **a session bus**, when available in the environment, under its own rules; it also owns reviewer and cleanup.

Choose worker model capability from the complexity of the portion, not a fixed tier: mechanics from a ready recipe use a smaller model with low effort; implementation from a precise brief uses the default; design and contract changes use a stronger model with high effort. When uncertain, take the higher row: another review round costs more than the model difference. Decide once, at launch.

## Brief

The brief text is assembled by a command: `{{cli}} brief <N…> --track "<title>" [--neighbour "path=track"] [--entry "…"] [--autonomy "…"] [--handover "…"] [--measurements]`. It takes task definitions from their files, `gates`, `prefix`, and `cli` from `backslop.json`, and the rest is fixed sections: definition of done, the request to commit with the prefix, the ban on status directories and `archive/` with its reason, findings as files, the mutation-probe order, and result contents. It prints to stdout; where the brief goes — a subagent prompt, a session’s first message, a bus — is yours to decide.

Five decisions in the brief are yours, and the command does not invent them:

- **the track title** in 2–5 words (`--track`): it becomes the worker session name so a person can identify the work;
- **change boundaries** (`--neighbour "path=track"`, repeatable): which directories belong to the worker and which belong to others. Name a neighbouring track — without the flag the section stays a `[TODO]` stub, which is your signal that the boundaries are not decided yet;
- **the entry point** (`--entry`): where the subject lives and what to read first. Without it the worker does its own recon, and recon eats the start of the session;
- **what it decides itself** (`--autonomy`): which forks it closes by its own decision and what it brings to you. Without the list every fork comes back to you as a question while the worker waits for the answer;
- **the hand-off form** (`--handover`): which gate protocol and which report header are required on the way out. The slot is parameterised — the template holds the structure, you supply the content.

Asking the worker to measure — add `--measurements`. The brief is self-contained: workers do not see your context or owner conversation, and whatever cannot be derived from the brief and the repository the worker must ask you rather than guess.

## Worker boundaries

- Changes are only in the worker’s worktree; the main tree and pushing are always forbidden.
- The worker does not close tasks and does not touch status directories or archive.
- Findings are created as files in the worker branch — `major` outside the worker's scope in `triage/`, `minor` and hypotheses in `minor/` — and named in the result; the worker fixes `critical` within their boundaries and messages you at once about one in another track's files.
- The worker does not approach the owner directly: decision points go through you.

## Measurements during the run

Read [references/measurements.md](references/measurements.md) before a number from the run goes into a report or definition: live wall clocks measure neighbours, inspect a command’s exit code rather than a pipe’s, and an incomplete grep result looks as confident as a complete one. If you ask a worker to measure, the rule goes in their brief; only you read this skill.

## Review gate

When a worker sends a result, decide who reads the diff. An isolated reviewer costs a separate session and review rounds, so do not raise one for every result.

| What is in the diff | Who reviews | Reviewer effort |
|---|---|---|
| Contract or mechanism: CLI flags and output, config schema, public API, file format, version change, bulk deletion | reviewer, mandatory | high; maximum for migrations |
| Code without a contract change: new logic, files, tests | reviewer | default |
| Documentation and text only; a patterned change; one-screen diff with no code | orchestrator | — |
| Worker reports uncertainty, workaround, or open edge | reviewer regardless of size | default |

Risk is stronger than size: a one-line config-schema change goes to a reviewer, while two hundred moved documentation lines do not. When reviewing yourself, read the entire worker-worktree diff, not its description.

A reviewer is a read-only session with fresh context. Give it the diff and its base (the divergence point between worker branch and main). It sends findings but does not fix them. Send all findings to the worker in one message.

## Second review round

After findings are addressed, **you verify the diff** in your context: the findings are in front of you and another review round is the most expensive part of the run.

| Orchestrator review is enough | A second review round is required |
|---|---|
| Change stays strictly within a finding: replace text, restore a check, move a function | Change exceeds findings — touches neighbouring code or changes logic |
| Finding is mechanically verified: a test fails, `lint` is green, grep finds it | The change itself changes a contract — flags, format, or config schema |
| Worker supplied a mutation probe and result | Diff cannot verify closure: a run is needed in an environment you lack |
| Documentation and text; any minor finding | The finding was critical to a contract |

The signal in the right column is not finding severity but whether the correction can produce a new failure of the same class. Limit: two reviewer launches for one result or three review rounds without progress — stop the loop and go to the owner with the findings as they stand. A round closing all preceding findings is progress: fixes create a new surface and the next reviewer sees it.

## Integration and acceptance

1. **One commit per task:** the message names the task and summary: `{{prefix}}-N: <what was done>`; review-round history remains in `result.md`. For a track with several tasks, integrate by task when worker commits are separable by prefix, one command per task: `git cherry-pick -n <task commits>`, or `git merge --squash <last commit of the task>` for the first, only when its commits precede all others on the branch (with interleaved history the squash form brings the later tasks too: use `git cherry-pick -n` for the first task as well); when commits are not separable by prefix, one commit per track lists the tasks, and `git merge --squash <worker-branch>` brings all of them. **A later task is not integrated by a second `merge --squash` of the same branch**: a squash commit does not record the worker branch as a parent, so the next squash diffs from the branch point again and conflicts wherever main has changed the first task’s lines since (review fixes, acceptance edits).
2. You resolve conflicts. They are usually in files shared by tracks, and **a merge strategy cannot resolve them**: `-X theirs` and `-X ours` take one side’s file whole and silently drop the neighbouring track’s hunks — CHANGELOG entries, reference sections, list items in code — or duplicate the file’s tail. Build a shared file from both revisions (`git show HEAD:<file>` and `git show <worker-head>:<file>`) by the units of its structure, not by resolving conflict markers:
   - **CHANGELOG** — run `{{cli}} merge-changelog --ours <your head> --theirs <worker head> --base <branch point> --out CHANGELOG.md`. A non-zero exit means a conflict or a refusal: read the report, keep one revision, and delete the `<!-- backslop:conflict … -->` line. Details: [references/merge-changelog.md](references/merge-changelog.md);
   - **a document split by headings** (a reference by `###`, a README by sections) — merge sections by heading: one side’s sections whole plus the other side’s missing sections; a section changed by both — by hand, with both changes;
   - **a list in code** (a regex list, a prefix set, a table of names) — by hand, then grep to confirm that both sides’ names are present.

   Put the assembled file in place of the conflict. The measure is step 3: the worker’s lines and the neighbour’s lines are both contained in the result, except the conflicts you decided.
3. **Run gates after integration, not only for the worker:** two green branches can be red together. After the final acceptance commit, check that conflict resolution lost nothing. For worker files that no other track changed since the branch point, `git diff HEAD <worker-head> -- <those files>` is empty. For a shared file, every line the worker added — the `+` lines of `git diff <branch-point> <worker-head> -- <file>` — is present in HEAD, and so is every line the main branch added since the branch point (`git diff <branch-point> <main-head-before-integration> -- <file>`); any remaining difference is the other side’s. A missing line was lost in conflict resolution and would reach main silently. The exception is a conflict you resolved on purpose — one kept revision or a hand-merged line: the other revision’s lines are legitimately missing, so name those lines in the acceptance report, and “missing” then means missing outside the decided conflicts.
4. Acceptance is in that commit and follows the `backslop-task` recipe: [Acceptance and archive](../backslop-task/SKILL.md#acceptance-and-archive). On Windows, run this recipe in Git Bash. In a batch, the recipe’s `<base>` is main’s head before this integration, and while the integration is uncommitted no reset is needed. What a batch adds: a task integrated by `merge --squash` or `cherry-pick -n` is accepted in that integration commit; fold a batch after its entries, as described above. **A track of several tasks leaving as one commit (step 1) is not folded in that commit:** a commit has one draft, the second `fold N > …` overwrites the first, and the first task’s directory leaves the tree together with its `result.md` without ever reaching history. That commit carries the archive directories — `backslop archive N` and `result.md` for each task, without `fold`. Folding goes in the next commit: `backslop fold N` for each task, or a bulk `backslop fold`. That commit is an ordinary commit, without the draft and without `reset --soft`: by then the directories are in history, and the journal line gets their revision. Run gates before committing, on an unchanged tree.
5. Clean up in the same pass: `git worktree remove <path>`, `git branch -D <branch>`, and close worker and reviewer sessions using the harness mechanism.

## End of the run

Report to the owner what closed, what remains, and where decisions are needed. `{{cli}} tracks` prints the run worktrees and branches: make sure the list is empty — a non-empty one names the path, the branch, task commits not in HEAD, and uncommitted work. The command does not see live sessions; check those the way the harness provides.
