# backslop

A backlog for slop: a file-based task tracker and decision log next to the code, plus process skills for agents. Initialise any project with one command.

```bash
npx github:Velklish/backslop init
```

Requires Node 20+ and git. The package has no dependencies.

[Russian version](README.ru.md)

## What it is

Agents produce a lot of work, and it needs a tracker that lives in the repository, can be read by an agent without external services, and does not create conflicts during parallel branch work. backslop keeps everything as files:

- **a task is a file** `BS-N-<slug>.md`; **status is the directory** containing it: `triage/`, `queue/`, `active/`, or `deferred/`; closed tasks move to `archive/` as `task.md` + `result.md`;
- **priority is the “Order” field** in the file, not a line in a shared list; there is no task list in git — `status` prints the summary;
- **a finding is a file** numbered `N.k`, created by its finder in their branch without coordination;
- **decisions are ADRs**, **terms are a glossary**, and **structure is a subsystem reference**;
- **the process is skills**: a one-task lifecycle with worker and approver roles, a worker run by tracks with briefs and a review gate, and documentation population after installation.

## What appears in a project

```
backslop.json                    prefix, docs, cli (with version pin), gates, version, lang, tools
AGENTS.md                        procedure section between <!-- backslop:start --> and <!-- backslop:end -->
docs/…                           documentation skeleton, backlog, archive, first ADR
```

Adapters are written only when selected: `init --tools claude,cursor,codex`. Default `tools` is `[]`. A legacy config without `tools` preserves Claude when the old canonical `.claude/skills/backslop-task/SKILL.md` exists; otherwise it remains adapter-free. An explicit `tools: []` or `--tools none` always wins.

| Adapter | Output |
|---|---|
| `claude` | `.claude/skills/backslop-*` and a `CLAUDE.md` stub (`@AGENTS.md`) if the file did not exist |
| `cursor` | `.cursor/rules/backslop-*.mdc` and namespaced references |
| `codex` | `.agents/skills/backslop-*` |

A repeated `init` does not touch existing `docs/` files; it updates selected adapter outputs and the section in `AGENTS.md`. `--tools none` clears the list and removes only backslop-owned files. Adapter outputs are generated and are not committed: `init` keeps a block for them in `.gitignore` between `# backslop:start` and `# backslop:end` — one `<harness root>/backslop-*` line per selected adapter, plus `/CLAUDE.md` when the file on disk is our stub. Your own lines are preserved; a project with no adapters gets no `.gitignore`. Flags: `--dir <directory>` instead of `docs`, `--prefix <KEY>` instead of `BS`, `--cli <command>`, `--lang ru|en`.

Once the skeleton is ready, ask an agent to “populate docs using backslop”: the `backslop-seed` skill reads the repository, asks a few questions, and fills the glossary, initial ADRs, and reference without inventing anything without evidence.

## Commands

| Command | What it does |
|---|---|
| `init [--dir docs] [--prefix BS] [--cli …] [--lang ru\|en] [--tools <CSV\|none>]` | lay out the skeleton; on repeat, update selected adapters and the AGENTS.md section |
| `new <slug> [--title "…"] [--queue [--top]] [--parent N]` | create a task in `triage/` or directly in the queue; `--parent N` creates finding `N.k`; the number skips those taken in other worktrees and local branches |
| `mv <N…> <triage\|queue\|active\|deferred> [--top \| --after M]` | change status of one or several tasks in one call: `git mv` plus fields that follow status; on a task already in `queue/`, `--top` or `--after M` only changes its Order |
| `archive <N> [--dry-run]` | close: move to `archive/`, rewrite task links throughout the repository, create `result.md` stub |
| `adr <slug> [--title "…"]` | create the next-numbered ADR |
| `status [--json]` | active work, ordered queue, deferred work, triage; `--json` is for orchestrators and scripts |
| `upgrade [--to X.Y.Z] [--dry-run] [--pin-only]` | update a project: CLI and gate pins, `migrate` and `init` with the new version, CHANGELOG summary |
| `migrate [--dry-run]` | migrate file formats and version stamp; while formats have not changed, only stamp |
| `changelog [--since X.Y.Z] [--to X.Y.Z]` | summarise backslop CHANGELOG between versions |
| `version`, `help` | version and help |
| `lint` | tracker gates plus adapter outputs and, in this repository, template-language parity |
| `gates [--keep-going] [--json] [--require-clean] [--dry-run]` | run the commands from `gates`: exit code of each, “gates N, green M”, tree snapshot |

Before publishing to npm the command is long, so projects record it in the `cli` field of `backslop.json`; skills and the `AGENTS.md` section substitute it from there. If installed globally (`npm i -g github:Velklish/backslop#v<version>`), change `cli` to `backslop`.

## Updating

`init` records the version pin that created the layout in `backslop.json`: `cli` is `npx github:Velklish/backslop#v<version>` with the version that ran it, and `version` is its stamp. The untagged form pulls the `main` branch HEAD on every run, so it is unsuitable for a project `cli`: behaviour would change through someone else’s commit. Update a project only when you choose to:

```bash
npx github:Velklish/backslop upgrade
```

`upgrade` takes the latest repository tag (or `--to X.Y.Z`), test-runs the new version, moves pins in `cli` and `gates`, runs `migrate` and `init` with that new version, and prints a CHANGELOG summary between versions. You can call it through the project command — `<cli> upgrade` works from any version 0.2.0 or later — or by the unpinned form above: it always takes fresh backslop, but still updates the project to the latest tag. `--dry-run` prints the plan; `--pin-only` only moves the pin. Downgrades are unsupported because an old version does not know a newer file format. `upgrade` does not touch `docs/` or task files; any future format change belongs to `migrate`. `lint` warns when `cli` lacks a pin, its stamp is older than the tool, or the stamp and pin differ, but the gate does not fail.

A global install (`cli: "backslop"`) or an npm pin (`cli: "npx backslop@X.Y.Z"`) has no GitHub-derived source: set the `source` field in `backslop.json` to the repository URL with release tags. `upgrade` then updates the pin and layout; you still update a globally installed package yourself.

## How work proceeds

1. An agent takes the first task from `status` and starts it with `mv N active`.
2. It changes code, updates documentation in the same pass, and runs gates from `backslop.json` — including `lint`.
3. The approver accepts work: `archive N`, completes `result.md` (while it contains `[TODO]`, `lint` fails), and reviews `triage/` so every entry has a next step.
4. Tasks in non-overlapping subsystems run through `backslop-batch`: one track per subsystem, a self-contained brief, a worker changes only its branch and does not move statuses, a reviewer is raised for contract diffs, and acceptance squashes by task.

The role boundary is identical in solo and orchestrated work: workers do not declare their own work accepted or move task files between directories; they create findings with `new --parent N`.

## For orchestrators

An orchestrator on any harness — subagents in worktrees, separate sessions, or a bus — operates through files and CLI: `status --json` reads the queue, `mv` assigns work, and `archive` closes it. Worker transport is a slot in `backslop-batch`; a new transport adds a page with an option for that slot, without CLI changes.

## Limitations

- Skills appear only for selected `tools`. Without `--tools`, a project gets the `AGENTS.md` section and `docs/`.
- English and Russian template layers are provided. Changing `lang` does not translate existing docs.
- Publishing to npm is prepared (`npx backslop@X.Y.Z` pins work; `npm run release`) but the default CLI stays on GitHub until the first publish.
- A prefix that matches an ordinary word (`API`, `RFC`) causes false positives in the number-reference gate on lines such as `API-2.0`; choose a prefix absent from project text.

## Development

```bash
npm test                      # node --test
node bin/backslop.js lint     # gates against this repository's docs/
```

`templates/` is the source of everything installed into a project; the repository’s own `docs/` are managed with the same tool. See `docs/reference/` for the structure.

License: MIT.

[Russian version](README.ru.md)
