# Glossary

The normative vocabulary for backslop. Project texts use only names from this glossary: one concept, one name. When a second spelling appears, either add it to “Retired terms” as a replacement or remove it from the text.

The “Term” column is the spelling in project prose; EN is the identifier in code, and `—` means the concept has none. Evidence identifies where the term lives: a file in the code or the templates, or a section of the reference.

## Terms

| Term | EN | Definition | Evidence |
|---|---|---|---|
| task | `task` | A unit of work: a file `<prefix>-N-<slug>.md` that lies in exactly one status directory | [lib/tasks.js](../lib/tasks.js), `scanTasks` |
| finding | — | A side discovery beside the current task, filed as a file numbered `N.k` by whoever found it: a `major` outside the current task's scope goes to `triage/`, a `minor` and a hypothesis go to `minor/` | [lib/new.js](../lib/new.js), flags `--parent`, `--minor`, `--evidence` |
| cost | `cost` | The label `critical`, `major` or `minor` on the reviewer's scale — what breaks or stays unverified if it is not fixed; the Cost field of a `minor/` entry, a hypothesis marked `(hypothesis)` | [lib/tasks.js](../lib/tasks.js), `parseCost` |
| batch | `batch` | An ordinary card listing the minor entries of one area. After the batch is archived and before it is folded, each entry is closed with `archive N.k --into M`, and its outcome is named in the batch's `result.md`; archiving the batch alone leaves its entries in `minor/` | [lib/archive.js](../lib/archive.js), `archiveInto`; [lib/log.js](../lib/log.js), `batchOf`; [01 § Closed numbers, findings and batches](reference/01-layout.md#closed-numbers-findings-and-batches) |
| status | `STATUSES` | The directory that holds the task file: `triage`, `queue`, `active`, `deferred`, `minor`; closed tasks are in the archive | [lib/config.js](../lib/config.js), `STATUSES` |
| rank | `order` | The Order field in the header of a task in `queue/`: an integer, step 10, lower comes first | [lib/tasks.js](../lib/tasks.js), `placeInQueue` |
| triage | `triage` | The directory of unsorted entries: ideas and findings before review; the file is the entry | [templates/en/docs/backlog/README.md](../templates/en/docs/backlog/README.md) |
| archive | `archive` | Closed tasks, in two forms that live side by side: a directory `<id>-<slug>/` with `task.md` and `result.md`, laid down by `archive N`, until it is folded; then a line in the journal | [lib/archive.js](../lib/archive.js); [01 § Archive](reference/01-layout.md#archive) |
| journal | `LOG.md` | `docs/archive/LOG.md`: one line per folded task and per batch entry folded with it — anchor, number and slug, closing date, outcome, revision, title | [lib/log.js](../lib/log.js), `parseLogLine`; [01 § Archive](reference/01-layout.md#archive) |
| fold | `fold` | Turning an archive directory into a journal line: the directory leaves the tree and its body goes into the fold draft | [lib/fold.js](../lib/fold.js); [02 § fold](reference/02-cli.md#fold) |
| fold draft | — | The commit message draft `fold` prints on stdout: the task body behind `> ` marks; the acceptance commit carries it, and while the journal line names no revision it is the body's only storage | [lib/fold.js](../lib/fold.js), `draftOne`; [02 § fold](reference/02-cli.md#fold) |
| revision | `bodyRev` | The commit a journal line names as the source of the task body; `—` while the body is not in history; `show N` reads the body from it | [lib/fold.js](../lib/fold.js), `bodyRev`; [01 § Archive](reference/01-layout.md#archive) |
| outcome | `outcome` | How a task closed: `completed`, `rejected` or `merged into <number>`, read from the first paragraph or the heading of `result.md`; `batch <M>` for a batch entry, written by the command; `—` when none is named | [lib/log.js](../lib/log.js), `outcomeFromResult`; [01 § Outcome words](reference/01-layout.md#outcome-words) |
| header | `FIELD_NAMES` | The field list after the task title: Order, Previous order (the rank saved when a task leaves the queue, read by `mv N queue --restore`), Scope, Created, Taken, Dependencies, Parent, Cost | [lib/tasks.js](../lib/tasks.js), `FIELD_NAMES` |
| evidence | `evidence` | A file path or command output that backs a claim; a claim without evidence is a hypothesis | [templates/en/skills/backslop-seed/SKILL.md](../templates/en/skills/backslop-seed/SKILL.md) |
| gate | `gates` | An entry of `gates` in `backslop.json` — a command string or `{command, when}` — that must pass before a report; `lint` is one gate | [lib/config.js](../lib/config.js), `gateEntry`; [02 § gates](reference/02-cli.md#gates) |
| lint gate | — | One numbered check of `lint` | [03 § Gates](reference/03-lint.md#gates), [lib/lint.js](../lib/lint.js) |
| skeleton | — | The files `init` lays down: the config, docs and the block in AGENTS.md; adapters only for the selected `tools` | [lib/init.js](../lib/init.js) |
| adapter | `adapter` | The rendering of skills into the directory of a specific harness: Claude, Cursor or Codex | [lib/adapters.js](../lib/adapters.js) |
| owned output | — | A generated adapter file: the `<!-- backslop:generated -->` marker at the `markGenerated` position on an adapter path; only such a file is rewritten and removed by `init` | [lib/adapter-ownership.js](../lib/adapter-ownership.js) |
| seed | `seed` | Filling the skeleton with project content by the `backslop-seed` skill | [templates/en/skills/backslop-seed/SKILL.md](../templates/en/skills/backslop-seed/SKILL.md) |
| run | — | One session's portion of backlog work: solo or with workers | [templates/en/skills/backslop-batch/SKILL.md](../templates/en/skills/backslop-batch/SKILL.md) |
| track | `track` | A direction within a run that shares no files with its neighbours; one worker, one track | [templates/en/skills/backslop-batch/SKILL.md](../templates/en/skills/backslop-batch/SKILL.md) |
| brief | `brief` | A self-contained assignment for a worker: tasks, boundaries, definition of done, what the result contains | [templates/en/skills/backslop-batch/SKILL.md](../templates/en/skills/backslop-batch/SKILL.md) |
| brief slot | — | An orchestrator decision the brief leaves to its author (`--track`, `--neighbour`, `--entry`, `--autonomy`, `--handover`); without its flag it prints `[TODO: …]` | [lib/brief.js](../lib/brief.js); [02 § brief](reference/02-cli.md#brief) |
| harness slot | — | The place in the `backslop-batch` skill where the harness plugs in its worker transport: the section “How to raise a worker” | [templates/en/skills/backslop-batch/SKILL.md](../templates/en/skills/backslop-batch/SKILL.md); [05 § Worker and approver](reference/05-orchestrator-contract.md#worker-and-approver) |
| template placeholder | `placeholders` | A `{{name}}` in `templates/**` that rendering replaces with a declared key of its template group; lint gate 12 checks the pairs | [lib/templates.js](../lib/templates.js), `placeholders`, `TEMPLATE_KEYS`; [03 § Gates](reference/03-lint.md#gates) |
| worker | — | The role that changes and verifies: implementation, documentation, gates and commits on its own branch; it never moves task files or touches the archive | [templates/en/skills/backslop-task/SKILL.md](../templates/en/skills/backslop-task/SKILL.md) |
| approver | — | The role that accepts: review, archive, `result.md`, fold and the triage review | [templates/en/skills/backslop-task/SKILL.md](../templates/en/skills/backslop-task/SKILL.md) |
| orchestrator | — | The session that leads a run with workers: splits the queue, writes briefs, accepts; under orchestration it is the approver | [templates/en/skills/backslop-batch/SKILL.md](../templates/en/skills/backslop-batch/SKILL.md) |
| reviewer | — | An isolated read-only session with a fresh context: reads the diff and does not fix it | [templates/en/skills/backslop-batch/SKILL.md](../templates/en/skills/backslop-batch/SKILL.md) |
| ADR | `adr` | An architectural decision record `adr-NNN-<slug>.md`, linked from `docs/README.md` | [lib/adr.js](../lib/adr.js); [03 § Gates](reference/03-lint.md#gates), gate 8 |
| pin | `cli` | The exact version in the `cli` field: `npx github:owner/repo#vX.Y.Z` or `npx backslop@X.Y.Z`; `upgrade` moves it | [lib/config.js](../lib/config.js), `parseCli` |
| stamp | `version` | The `version` field in `backslop.json`: the version that made the layout; `init` and `migrate` set it, `lint` and `upgrade` read it | [lib/init.js](../lib/init.js) |
| release source | `source` | The git repository with `vX.Y.Z` tags that `upgrade` takes versions from: the `source` field or the address from the `cli` form | [lib/upgrade.js](../lib/upgrade.js), `listReleaseTags` |
| changelog excerpt | — | The backslop CHANGELOG sections between two versions that `changelog` and `upgrade` print | [lib/changelog.js](../lib/changelog.js) |
| harness | — | The environment the agent works in, which provides transport for workers: subagents, sessions, a bus | [templates/en/skills/backslop-batch/SKILL.md](../templates/en/skills/backslop-batch/SKILL.md) |
| mutation probe | `probe` | A test check by breaking the code: the test must turn red; done after the commit, so reverting the mutation does not take the change with it | [templates/en/skills/backslop-task/SKILL.md](../templates/en/skills/backslop-task/SKILL.md) |
| review round | — | One review iteration: remarks, fixes, a check that they are closed; the round limits are a norm of the run skill | [templates/en/skills/backslop-batch/SKILL.md](../templates/en/skills/backslop-batch/SKILL.md) |
| owner | — | The person who makes project decisions: queue order, rejecting a finding, choosing an ADR | [templates/en/skills/backslop-seed/SKILL.md](../templates/en/skills/backslop-seed/SKILL.md) |
| comment block | `commentBlocks` | Consecutive lines that hold nothing but a comment: code before or after ends the block, and so does an empty line | [test/comment-scan.mjs](../test/comment-scan.mjs), `commentBlocks` |

## Retired terms

| Do not use | Use | Why |
|---|---|---|
| inbox | triage | the directory is called `triage/`; one name for the directory and the concept |
| backlog index | `status` | there is no task list in files — the command prints the summary |
| team lead | orchestrator, approver | a role is named by what it does, not by a job title |
| line (of work) | track | one name for a direction within a run |
| batch (of an `mv` call with several numbers) | a multi-number `mv` call | batch names the card that closes minor entries |
| template slot | template placeholder | a `{{name}}` in a template is a placeholder; slot names only the brief slot and the harness slot |
