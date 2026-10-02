# backslop

A backlog for slop: a file-based task tracker and decision log next to the code, plus process skills for agents. Initialise any project with one command.

```bash
npx github:Velklish/backslop init --lang en
```

Without `--lang`, `init` writes `"lang": "ru"`: new files and messages are then in Russian. Requires Node 20+ and git. The package has no dependencies.

## What it is

Agents produce a lot of work, and it needs a tracker that lives in the repository, can be read by an agent without external services, and does not create conflicts during parallel branch work. backslop keeps everything as files:

- **a task is a file** `<prefix>-N-<slug>.md` (the default prefix is `BS`); **status is the directory** containing it: `triage/`, `queue/`, `active/`, `deferred/`, or `minor/`;
- **closing is two steps**: `archive N` moves the task into `docs/archive/<id>-<slug>/` as `task.md` plus a `result.md`, and `fold N` later folds that directory into one line of `docs/archive/LOG.md` — the body stays in git history, and `show N` reads it back;
- **priority is the Order field** in the file, not a line in a shared list; there is no task list in git — `status` prints the summary;
- **a finding is a file** numbered `N.k`, created by its finder in their branch without coordination, and its cost label decides the route: `critical` and `major` within the current scope are fixed now, `major` outside it becomes a card, `minor` and hypotheses wait in `minor/` for a batch;
- **decisions are ADRs**, **terms are a glossary**, and **structure is a subsystem reference**;
- **the process is skills**: a one-task lifecycle with worker and approver roles, a worker run by tracks with briefs and a review gate, and documentation population after installation.

## What appears in a project

```
backslop.json                    config: prefix, docs, cli (with the version pin), gates, probe, writer, version, source, lang, tools, agents
AGENTS.md                        procedure section between <!-- backslop:start --> and <!-- backslop:end -->
docs/…                           documentation skeleton, backlog, archive and its journal, first ADR
```

The fields, their defaults and their rules — the mutation-probe command `probe` and the step overrides `agents.stepOverrides` included — are in the [config table](docs/reference/01-layout.md#backslopjson). A `backslop.json` without `lang` or `tools` is refused by every command that loads the config, `init` included: add the field by hand.

Adapters are written only when selected — `init --tools claude,cursor,codex`; by default `init` writes `"tools": []`:

| Adapter | Output |
|---|---|
| `claude` | `.claude/skills/backslop-*` and a `CLAUDE.md` stub (`@AGENTS.md`) if the file did not exist |
| `cursor` | `.cursor/rules/backslop-*.mdc` and namespaced references |
| `codex` | `.agents/skills/backslop-*` |

Each adapter lays out the process skills, the `backslop-writer` release and batch-close pass, and two third-party writing skills, `backslop-humanizer` and `backslop-techdoc`, with their `LICENSE` and `SOURCE.md` (see [Third-party components](#third-party-components)).

`init` flags and the defaults of a first `init`: `--dir docs`, `--prefix BS`, `--cli npx github:Velklish/backslop#v<version>`, `--lang ru`, `--tools none`; a repeated `init` without `--lang` or `--tools` keeps the config's values. A repeated `init` does not touch existing `docs/` files; it rewrites the selected adapter outputs and the section in `AGENTS.md`, and removes only backslop-owned files of deselected adapters. Adapter outputs are generated and not committed: `init` keeps a block for them in `.gitignore`. The full rules are in [What init lays down](docs/reference/01-layout.md#what-init-lays-down).

With an adapter selected, ask an agent to "populate docs using backslop" once the skeleton is ready: the `backslop-seed` skill reads the repository, asks a few questions, and fills the glossary, initial ADRs and the reference without inventing anything without evidence. Before a release or when a worker batch closes, `backslop-writer` checks documentation currency and, in release mode, style. Its audit mode scores a document, says whether it can ship and files every finding with a regression check.

## Commands

Each command links its reference section: behaviour, output and refusals.

| Command | What it does |
|---|---|
| [`init [--dir docs] [--prefix BS] [--cli <command>] [--lang ru\|en] [--tools <CSV\|none>]`](docs/reference/02-cli.md#init) | create docs, adapters, the AGENTS.md block and backslop.json; on repeat, refresh the adapters and the AGENTS.md block |
| [`new <slug> [--title "…"] [--queue [--top]] [--parent N[.M] [--minor --evidence "…" [--cost <level>] [--hypothesis]]]`](docs/reference/02-cli.md#new) | create a task (in `triage/`, or the queue), a finding of task N / N.M, or a minor finding with evidence |
| [`mv <N…> <triage\|queue\|active\|deferred\|minor> [--top \| --after M \| --restore] [--evidence "…"]`](docs/reference/02-cli.md#mv) | change the status of one or several tasks, or reorder the queue |
| [`archive <N> [--dry-run] [--range <base>..HEAD]`, `archive <N.k> --into <M> [--dry-run]`](docs/reference/02-cli.md#archive) | close a task into `archive/` and print the documentation it touched; close a minor entry by batch M |
| [`fold <N> [--dry-run]`, `fold [--older-than <date>] [--embed-missing] [--dry-run]`](docs/reference/02-cli.md#fold) | fold a closed task, or the accumulated archive, into `archive/LOG.md` lines; `fold N` puts the body into the commit message draft, the bulk form names each body's revision (`--embed-missing` carries bodies that are not in history) |
| [`show <N>`](docs/reference/02-cli.md#show) | print the body of a folded task |
| [`adr <slug> [--title "…"]`](docs/reference/02-cli.md#adr) | create the next numbered ADR |
| [`brief <N…> [--track "…"] [--neighbour "path=track"] [--entry "…"] [--autonomy "…"] [--handover "…"] [--measurements]`](docs/reference/02-cli.md#brief) | print a worker brief for these tasks |
| [`seed --scan [--json] \| --queue-reference`](docs/reference/02-cli.md#seed) | list gate and subsystem candidates with evidence, or queue reference tasks |
| [`status [--json]`](docs/reference/02-cli.md#status) | active work, the ordered queue, deferred work, triage, and minor entries by scope |
| [`lint`](docs/reference/02-cli.md#lint) | the tracker gates, project documentation without task ids and tracker links, adapter outputs and, in the tool's own repository, template parity ([gates](docs/reference/03-lint.md)) |
| [`gates [--keep-going] [--json] [--require-clean] [--dry-run] [--base <ref>]`](docs/reference/02-cli.md#gates) | run the `gates` commands: exit code of each, green count, tree snapshot |
| [`tracks [--json]`](docs/reference/02-cli.md#tracks) | run worktrees and branches: merged or not, what is left, what is dirty |
| [`links --external [--json]`](docs/reference/02-cli.md#links) | request the http(s) links of the documents and classify each: ok, dead, unverified; outside `gates` and `lint` |
| [`hook <session-start\|stop> --harness <claude\|cursor\|codex>`](docs/reference/02-cli.md#hook) | agent hook: record where a session started, return the turn on `lint` errors in the files it changed |
| [`upgrade [--to X.Y.Z] [--dry-run] [--pin-only]`](docs/reference/02-cli.md#upgrade) | update the pins, then migrate and initialize with the new version |
| [`migrate [--dry-run]`](docs/reference/02-cli.md#migrate) | migrate file formats, redraw the tracking and archive rules, update the version stamp |
| [`changelog [--since X.Y.Z] [--to X.Y.Z]`](docs/reference/02-cli.md#changelog) | print backslop CHANGELOG entries between versions |
| [`merge-changelog --ours <ref> --theirs <ref> [--base <ref>] [--out <file>]`](docs/reference/02-cli.md#merge-changelog) | merge two `CHANGELOG.md` revisions |
| [`version \| --version \| -v`, `help \| --help \| -h \| <command> --help`](docs/reference/02-cli.md#version-and-help) | print the version or the help |

The command is long, so a project records it in the `cli` field of `backslop.json`, and skills and the `AGENTS.md` section substitute it from there. With a global install (`npm i -g github:Velklish/backslop#v<version>`), set `cli` to `backslop`.

## Updating

`init` records the version that created the layout: `cli` is `npx github:Velklish/backslop#v<version>`, and `version` is its stamp. The untagged form pulls the `main` branch HEAD on every run, so it is unsuitable for a project `cli`: behaviour would change through someone else's commit. Update a project only when you choose to:

```bash
npx github:Velklish/backslop upgrade
```

The project command `<cli> upgrade` works too, from any version 0.2.0 or later; the untagged form above always runs fresh backslop and still updates the project to the latest tag.

- **What it does.** `upgrade` takes the latest tag (or `--to X.Y.Z`), test-runs the new version, moves the pin in `cli` and inside the `gates` and `probe` commands, runs the new version's `migrate` and `init`, moves pins in the [live files](docs/reference/03-lint.md#live-pin-files), and prints the tool's CHANGELOG between the two versions.
- **Preview.** `--dry-run` prints the plan only; it does not include the output of `migrate`. Preview the format migrations and the rules redraw with `npx github:Velklish/backslop#v<new> migrate --dry-run`.
- **What is lost.** `docs/backlog/README.md` and `docs/archive/README.md` belong to backslop: `migrate` redraws them from the new version's template, and a committed local edit in them is lost (an uncommitted one makes `migrate` refuse). Keep project rules of your own elsewhere, for example in `AGENTS.md` outside the backslop section.
- **Options.** `--pin-only` changes only the configuration; after a manual `migrate` and `init`, run the full `upgrade` again to rewrite live pins, even without a newer tag. Downgrades are unsupported: an old version does not know a newer file format. `lint` keeps layout-version warnings advisory, but an old pin in a live file is an error.
- **A global install** (`cli: "backslop"`) has no source derived from GitHub: set `source` in `backslop.json` to the repository URL with release tags, and update the installed package yourself first — `upgrade` refuses while `cli` still runs the old version.

After an upgrade:

1. Review and commit the diff: `backslop.json`, the `AGENTS.md` section, the tracking and archive rules, and new files such as `docs/archive/LOG.md`.
2. Run `<cli> lint` and fix what newer gates report — for example, a `result.md` that names no outcome word, or a task id, a tracker link or an untracked run file in project documentation: README, `docs/` outside `backlog/` and `archive/`, and the unreleased CHANGELOG section ([gate 15](docs/reference/03-lint.md#documentation-without-the-tracker)). Write what the record says instead: the contract, the rationale, or the measurement with its version and date.
3. Optionally, run `<cli> fold` to fold archive directories closed before 0.10.

## How work proceeds

1. An agent takes the first task from `status` and starts it with `mv N active`.
2. It changes code, updates documentation in the same pass, runs `<cli> gates` (which includes `lint`), and commits to its branch with the `<prefix>-N:` prefix.
3. The approver accepts: `archive N`, completes `result.md` (`lint` fails while a `[TODO` placeholder stays outside code), runs `fold N` into a draft outside the working tree, and makes one acceptance commit that carries the draft as its message — the [fold section](docs/reference/02-cli.md#fold) gives the exact commands, and nothing is committed between `archive N` and `fold N`.
4. The approver then reviews `triage/` so every entry has a next step, in a separate commit.
5. Tasks in non-overlapping subsystems run through `backslop-batch`: one track per subsystem, a self-contained brief, a reviewer for contract diffs, and acceptance squashed by task.

The role boundary is the same in solo and orchestrated work: a worker changes only its branch, does not declare its own work accepted, and does not move, archive or edit existing task files — the approver edits task-file text, and the worker sends the wording in its result. The worker's only tracker write is a new finding, created as a separate file with `new <slug> --parent N[.M]` (with `--minor --evidence "…"` for minors and hypotheses) on its branch.

## For orchestrators

An orchestrator on any harness works through the files and the CLI; what it can rely on — output channels, exit codes, the JSON shapes and the stable list — is in [05. Orchestrator contract](docs/reference/05-orchestrator-contract.md).

## Limitations

- backslop is not published to npm: install and pin it from GitHub tags (`npx github:Velklish/backslop#vX.Y.Z`).
- Skills appear only for selected `tools`. Without an adapter, a project gets the `AGENTS.md` section and `docs/`, and no `backslop-seed` skill.
- A project that never selected an adapter gets no `.gitignore`; deselecting every adapter (`--tools none`) leaves an empty backslop block in it.
- English and Russian template layers are provided. Changing `lang` does not translate existing docs, except the tracking and archive rules: the next `migrate` redraws them in the new language unless they carry local edits.
- A prefix that matches an ordinary word (`API`, `RFC`) causes false positives in the number-mention gate on lines such as `API-2.0`; choose a prefix absent from project text.

## Working on backslop

- The repository rules are in [AGENTS.md](AGENTS.md), and the structure of the tool is in [docs/reference/](docs/reference/README.md).
- Where each part of `lib/` lives, and how to add a command, a lint gate, a migration or a template placeholder: [06. Module map](docs/reference/06-module-map.md).
- `templates/` is the source of everything installed into a project; the repository's own `docs/` are managed with the same tool.
- `node bin/backslop.js gates` runs the repository gates: `lint` and `npm test`.
- Windows is supported.

## Third-party components

`templates/vendor/` holds two MIT-licensed skills that the adapters lay out in every project that selects one. Each directory carries the upstream `LICENSE` verbatim and a `SOURCE.md` with the upstream commit, the modifications and the sha256 of each upstream file.

- **`backslop-humanizer`** — [humanizer](https://github.com/blader/humanizer) at commit `9862685f575c65a8247f90369951df1b3416e3d6`. MIT License, Copyright (c) 2025 Siqi Chen. Its patterns of AI writing are based on Wikipedia's "Signs of AI writing". Modification: the frontmatter `name` is `backslop-humanizer`.
- **`backslop-techdoc`** — [technical-documentation](https://github.com/wondelai/skills/tree/c172996495bed0fcd26896a9416b2093fd7073f0/plugins/code-craftsmanship/skills/technical-documentation) from wondelai/skills at commit `c172996495bed0fcd26896a9416b2093fd7073f0`. MIT License, Copyright (c) 2025 Wondel.ai sp. z o.o. Its "About the Source" section is the CC BY 4.0 attribution to Google's developer documentation style guide and is unchanged. Modifications: the frontmatter `name` is `backslop-techdoc`; the affiliate query `?tag=wondelai00-20` is removed from two Further Reading links; in `references/release-notes.md`, an example link to `CHANGELOG.md` outside a code block is inline code, because it resolved to nothing.

License: MIT.
