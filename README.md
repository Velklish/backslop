# backslop

A backlog for slop: a file-based task tracker and decision log next to the code, plus process skills for agents. Initialise any project with one command.

```bash
npx github:Velklish/backslop init
```

Requires Node 20+ and git. The package has no dependencies.

[Russian version](README.ru.md)

## What it is

Agents produce a lot of work, and it needs a tracker that lives in the repository, can be read by an agent without external services, and does not create conflicts during parallel branch work. backslop keeps everything as files:

- **a task is a file** `BS-N-<slug>.md`; **status is the directory** containing it: `triage/`, `queue/`, `active/`, `deferred/`, or `minor/`; closed tasks move to `archive/` as `task.md` + `result.md`;
- **priority is the “Order” field** in the file, not a line in a shared list; there is no task list in git — `status` prints the summary;
- **a finding is a file** numbered `N.k`, created by its finder in their branch without coordination, and its cost label decides the route: `critical` and `major` within the current scope are fixed now, `major` outside it becomes a card, `minor` and hypotheses wait in `minor/` for a batch;
- **decisions are ADRs**, **terms are a glossary**, and **structure is a subsystem reference**;
- **the process is skills**: a one-task lifecycle with worker and approver roles, a worker run by tracks with briefs and a review gate, and documentation population after installation.

## What appears in a project

```
backslop.json                    prefix, docs, cli (with version pin), gates, probe, version, lang, tools, agents.stepOverrides
AGENTS.md                        procedure section between <!-- backslop:start --> and <!-- backslop:end -->
docs/…                           documentation skeleton, backlog, archive, first ADR
```

Adapters are written only when selected: `init --tools claude,cursor,codex`. Default `tools` is `[]`. A legacy config without `tools` preserves Claude when the old canonical `.claude/skills/backslop-task/SKILL.md` exists; otherwise it remains adapter-free. An explicit `tools: []` or `--tools none` always wins.

Step 4 of the managed block demands a mutation probe only where there is something to run it with: the command comes from the `probe` field in `backslop.json` — a single-line command without a backtick and without the `backslop:start`/`backslop:end` markers: the template puts the value in a code span, and the block bounds are found in raw text. Every value substituted into the block shares that form and one check: `prefix`, `docs`, `cli` and `probe`. When the field is declared, the step names the command; when it is missing, the probe sentence is absent from the block — a rule nothing can execute costs more than no rule at all. `init` says so on its output (“probe is not declared in backslop.json…”) instead of dropping the requirement silently. A repository without the field describes its own probe in a section outside the managed block, and that section survives `init`.

To adapt a numbered step in the managed `AGENTS.md` block, set `agents.stepOverrides` in `backslop.json`: a string key `"1"` through `"7"` replaces that step's text on `init` while its number and the other steps stay managed. The value must be a single non-empty line without `<`; `init` rejects invalid values before writing the managed block. Whatever passes is substituted escaped: every CommonMark ASCII punctuation character is backslashed, so the value stays text and never becomes markup — a link reference definition such as `[label]: /target`, whose scope is the whole document, cannot open inside it. Brackets without a link definition remain a legal value: escaping disarms rather than rejects. The step number, the other steps, and the worker boundary remain managed.

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
| `new <slug> [--title "…"] [--queue [--top]] [--parent N[.M] [--minor --evidence "…" [--cost <level>] [--hypothesis]]]` | create a task in `triage/` or directly in the queue; `--parent N` creates finding `N.k`; `--parent N.M` accepts a finding parent, creates the next free `N.k`, and records the `Parent` field; `--minor` puts the finding in `minor/` with a `Cost` field (`major`/`critical` only as a hypothesis) and requires `--evidence` — without evidence it refuses before the file is created; the number skips those taken in other worktrees and local branches |
| `mv <N…> <triage\|queue\|active\|deferred\|minor> [--top \| --after M \| --restore]` | change the status of one or several tasks in one call: `git mv` plus fields that follow status; in `minor/` the `Cost` field is added when missing; in `deferred/`, an existing section is not duplicated and the command prompts you to check its reason and return condition; a heading inside a fenced example does not count as an existing section; on a task already in `queue/`, `--top` or `--after M` only changes its Order; leaving `queue/` stores the rank in “Previous order”, `--restore` puts the task back on it and accepts a batch, returning its tasks in the order of their saved numbers, and a return without it names the discarded position aloud |
| `archive <N> [--dry-run]` | close: move to `archive/`, rewrite task links throughout the repository, create `result.md` stub; `archive <N.k> --into <M>` closes a minor entry by batch M: the file moves into `archive/<M>-<slug>/minor/` without a `result.md` of its own, the batch is closed first |
| `adr <slug> [--title "…"]` | create the next-numbered ADR |
| `status [--json]` | active work, ordered queue, deferred work, triage, minor entries by scope; `--json` is for orchestrators and scripts |
| `upgrade [--to X.Y.Z] [--dry-run] [--pin-only]` | update a project: CLI, gate, and live-file pins, `migrate` and `init` with the new version, CHANGELOG summary |
| `migrate [--dry-run]` | migrate file formats and version stamp; while formats have not changed, only stamp |
| `changelog [--since X.Y.Z] [--to X.Y.Z]` | summarise backslop CHANGELOG between versions |
| `version`, `help` | version and help |
| `lint` | tracker gates plus adapter outputs and, in this repository, template-language parity; a standalone placeholder line or a field whose entire value is a `[TODO…]` placeholder in any markdown file under `docs/backlog/**` fails the gate — except in `triage/`, where placeholders are not checked at all; `[TODO]` inside explanatory text is not a placeholder; `quote:before:<path>` stores a pre-change snapshot, regular `quote:<path>` guards an invariant |
| `gates [--keep-going] [--json] [--require-clean] [--dry-run] [--base <ref>]` | run the commands from `gates`: exit code of each, “gates N, green M”, tree snapshot. A `gates` entry is either a command string (always run) or `{ "command": …, "when": ["<glob>", …] }` — the scoped command runs only when the changed path set touches one of its globs. The set comes from the dirty tree, and with `--base <ref>` from `git diff --name-only <ref>..HEAD` on top of it; paths are made relative to the project root (in a monorepo the directory prefix is stripped and reported in `scope.prefix`), and the source and the set are printed and are in `--json` as `scope`. A skip is printed with its reason, counted as `outOfScope` inside `skipped`, and never added to the green count. Two refusals keep an idle acceptance run from looking like a passing one: an empty `--base`, and `--require-clean` when the changed path set is empty while some entry carries a scope — with no base named, or with a base that yielded no diff |

Before publishing to npm the command is long, so projects record it in the `cli` field of `backslop.json`; skills and the `AGENTS.md` section substitute it from there. If installed globally (`npm i -g github:Velklish/backslop#v<version>`), change `cli` to `backslop`.

## Updating

`init` records the version pin that created the layout in `backslop.json`: `cli` is `npx github:Velklish/backslop#v<version>` with the version that ran it, and `version` is its stamp. The untagged form pulls the `main` branch HEAD on every run, so it is unsuitable for a project `cli`: behaviour would change through someone else’s commit. Update a project only when you choose to:

```bash
npx github:Velklish/backslop upgrade
```

`upgrade` takes the latest repository tag (or `--to X.Y.Z`), test-runs the new version, and moves pins in `cli`, `gates`, and live files: markdown under `docs/**` and root `*.md` with historical exceptions, every file named `package.json`, and known CI files. It then runs `migrate`, `init`, and prints a CHANGELOG summary between versions. You can call it through the project command — `<cli> upgrade` works from any version 0.2.0 or later — or by the unpinned form above: it always takes fresh backslop, but still updates the project to the latest tag. `--dry-run` prints the plan; `--pin-only` changes only configuration and gates, not live files; after manual `migrate` and `init`, repeat the full `upgrade` to find and rewrite them even when there is no newer tag. Downgrades are unsupported because an old version does not know a newer file format. `lint` keeps layout-version warnings advisory, but an old pin in a live file is an error; historical files stay green.

A global install (`cli: "backslop"`) or an npm pin (`cli: "npx backslop@X.Y.Z"`) has no GitHub-derived source: set the `source` field in `backslop.json` to the repository URL with release tags. `upgrade` then updates the pin and layout; you still update a globally installed package yourself.

## How work proceeds

1. An agent takes the first task from `status` and starts it with `mv N active`.
2. It changes code, updates documentation in the same pass, and runs gates from `backslop.json` — including `lint`.
3. The approver accepts work: `archive N`, completes `result.md` (while it still holds a `[TODO` placeholder outside code, `lint` fails; the form quoted in a code span does not count), and reviews `triage/` so every entry has a next step. The approver also edits task-file text in status directories and the archive; the worker sends the wording in the result. The only exception is a new finding: the worker creates it as a separate file with `new --parent N[.M]` on their branch; the worker does not edit an existing card.
4. Tasks in non-overlapping subsystems run through `backslop-batch`: one track per subsystem, a self-contained brief, a worker changes only its branch and does not move statuses, a reviewer is raised for contract diffs, and acceptance squashes by task.

The role boundary is identical in solo and orchestrated work: workers do not declare their own work accepted or move existing task files between directories; they create a new finding as a separate file with `new --parent N[.M]` (with `--minor --evidence "…"` for minors and hypotheses) on their branch and do not edit an existing card.

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
