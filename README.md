# backslop

A task tracker and decision log for coding agents, stored in your Git repository as Markdown files.

backslop keeps tasks, architectural decisions, and project documentation next to the code. Agents can read and update them with a CLI, so the next session can pick up where the last one left off. You do not need a hosted tracker, a database, or an MCP server.

## What you can do

- **Track work in Git.** Create tasks, prioritize the queue, and record findings. Each task has its own file, so agents working on separate tasks do not have to edit a shared task list.
- **Give agents a consistent workflow.** Install skills for Claude Code, Cursor, or Codex that cover implementation, verification, review, and acceptance.
- **Keep decisions and documentation with the code.** Create architectural decision records (ADRs), maintain a glossary and reference, and use skills to populate and check the docs.
- **Check work before accepting it.** Validate links, task structure, version pins, and other documentation rules. Run your project's tests and checks through one `gates` command.
- **Prepare parallel work.** Generate worker briefs and inspect branches and worktrees. Your agent harness provides the workers; backslop provides their assignments and workflow.
- **Keep completed work searchable.** Fold closed tasks into a compact journal and retrieve their full records from Git history.

## Quick start

You need **Node.js 20+ and Git**. backslop has no package dependencies and supports Windows, macOS, and Linux. It is distributed through GitHub tags, not the npm registry.

From the root of the repository you want to manage:

```bash
npx github:Velklish/backslop#v1.0.0 init --tools codex
```

Replace `codex` with `claude` or `cursor`, or select several with `--tools claude,cursor,codex`. Omit `--tools` to use the CLI and the instructions in `AGENTS.md` without installing agent skills.

By default, a first `init` writes `"lang": "en"` and selects no adapters (`--lang en`, `--tools none`). Add `--lang ru` for Russian templates and CLI messages. Repeated `init` and `upgrade` preserve the configured language unless you explicitly change it; changing the language does not translate your existing project content.

`init` creates the documentation skeleton, adds a managed section to `AGENTS.md`, and saves the version-pinned command in `backslop.json`. It preserves existing documentation and instructions outside that section. Review and commit the generated project files; adapter skills are generated locally and ignored by Git.

### Create your first task

```bash
npx github:Velklish/backslop#v1.0.0 new add-search --title "Add search" --queue
npx github:Velklish/backslop#v1.0.0 status
```

Open the task file printed by `new` and fill in its context, scope, work to do, and verification. Then start it, using the number printed by the command (here, `1`):

```bash
npx github:Velklish/backslop#v1.0.0 mv 1 active
```

For an existing project, use the command in its `backslop.json` → `cli` field. The examples above use the current release; the saved command keeps everyone on the version chosen for that project.

## Use it with an agent

With an adapter installed, ask your agent to **"populate docs using backslop"**. The `backslop-seed` skill inspects the repository, asks about decisions it cannot establish from the code, and fills the glossary and initial ADRs. It builds a reference index and queues tasks for the detailed sections.

The adapters install these skills:

| Skill | Use it to |
|---|---|
| `backslop-task` | Take one task through implementation, verification, review, and acceptance |
| `backslop-batch` | Organize work across independent tracks and accept the results by task |
| `backslop-seed` | Populate the documentation skeleton from repository evidence |
| `backslop-writer` | Check documentation against the code and audit its style |
| `backslop-techdoc`, `backslop-humanizer` | Apply technical writing guidance and remove common AI writing patterns |

`backslop-writer` checks documentation before a release or when a run with workers closes. Release mode also checks style; audit mode reports findings for a selected document.

Skills are instructions for your agent. backslop does not run a model or launch workers itself.

After cloning a project, the instructions in `AGENTS.md` tell a selected agent to check its adapter with `<cli> lint --require-adapter codex` (or `claude` / `cursor`) and restore missing files with `<cli> init`. Here and below, `<cli>` means the exact command saved in `backslop.json`, not text to paste literally. See [agent startup after clone](docs/reference/01-layout.md#agent-startup-after-clone) for setup and discovery details.

## How work proceeds

A task's directory is its status. New tasks enter `triage/` unless you use `--queue`; `status` shows active work, the ordered queue, deferred work, triage, and minor findings.

```text
docs/backlog/
  triage/     Ideas and findings to review
  queue/      Tasks ready to take, in priority order
  active/     Work in progress
  deferred/   Work waiting for a stated return condition
  minor/      Small findings and hypotheses to handle together
```

The workflow separates implementation from acceptance:

1. **Define and start the task.** Fill in the task file, place it in the queue, and move it to `active/` when work begins.
2. **Implement and verify.** Update the code and documentation, run the configured gates, and commit the work on its branch.
3. **Review and close.** The approver reviews the changes, runs `archive N`, records the outcome and checks in `result.md`, and runs `fold N`. The fold draft becomes the acceptance commit message, preserving the full record in Git. The approver then reviews any remaining triage entries.

One agent can perform both roles in order. In parallel work, workers implement and report; the approver manages existing task files and closes tasks. Follow the [acceptance recipe](docs/reference/02-cli.md#fold) when folding: the draft and commit order are what preserve the task body, and attachments require an extra commit. Use `show N` to read a folded task later.

## What goes into your repository

With the default `docs` directory:

```text
backslop.json       CLI version, language, adapters, hooks, and verification commands
AGENTS.md           Managed workflow instructions alongside your own instructions
docs/
  README.md         Documentation index
  GLOSSARY.md       Project terminology
  ROLES.md          Worker, approver, and owner responsibilities
  adr/              Architectural decision records
  reference/        Subsystem documentation
  backlog/          Open tasks and operating rules
  archive/          Closed tasks and the LOG.md journal
```

Adapters add local files for the tools you select:

| Tool | Generated skills |
|---|---|
| Claude Code | `.claude/skills/backslop-*` |
| Cursor | `.cursor/rules/backslop-*.mdc` and supporting files |
| Codex | `.agents/skills/backslop-*` |

For Claude Code, `init` also creates a `CLAUDE.md` stub that imports `AGENTS.md` if the file does not exist. Commit that stub. If you already have a `CLAUDE.md`, keep it and add the import if needed.

See the [configuration reference](docs/reference/01-layout.md#backslopjson) for custom directories, task prefixes, gates, and workflow overrides.

## Everyday commands

Run these after your project's configured `<cli>`:

| Command | Purpose |
|---|---|
| `status` | See current work and the queue |
| `new <slug> --title "…" --queue` | Create a queued task |
| `mv N active` | Start a task |
| `new <slug> --parent N` | File a finding under a task |
| `adr <slug> --title "…"` | Create an architectural decision record |
| `lint` | Check the tracker and documentation |
| `gates` | Run the project's configured verification commands |
| `archive N`, `fold N`, `show N` | Close, compact, and retrieve task records |

A new project's `gates` list contains only backslop's `lint`. Add your build, tests, and other checks to `backslop.json`; backslop does not discover and enable them automatically. The seed skill can help identify suitable commands.

The [CLI reference](docs/reference/02-cli.md) covers all commands and flags, including worker briefs, worktree status, external-link checks, and changelog merging. For scripts and orchestrators, see the [JSON formats and stable CLI contract](docs/reference/05-orchestrator-contract.md).

## Optional agent hooks

Hooks let an agent check documentation at the end of a session. Enable them separately from skills, using your configured CLI:

```text
<cli> init --hooks codex
```

Choose `claude`, `cursor`, or a comma-separated list; use `--hooks none` to remove them. backslop adds session-start and stop records to project settings while preserving other hooks. It does not change settings in your home directory.

The start hook records the initial state. The stop hook reports lint errors in changed files and, when a compatible baseline is available, subtracts pre-existing missing-link counts. It cannot determine who made a change. Ordinary `lint` still checks the full project. See [hook behavior and limits](docs/reference/02-cli.md#hook).

<details>
<summary>Using a local npm dependency for hooks</summary>

On a first `init` with hooks enabled, a project-root `devDependencies.backslop` declaration selects `npx --no-install backslop` unless you pass `--cli`. Run `npm install` after cloning. Without the declaration, a fresh checkout has no local backslop installation from `package.json`, so `init` keeps the pinned GitHub command.

Installation checks look in the project first, then the nearest ancestor with `node_modules/.bin/backslop`, including hoisted npm workspace installations. Repeated `init` preserves the saved command. If you remove the dependency declaration while using local hooks, restore it or change `cli` in the config before running `init` again. See [local command selection and diagnostics](docs/reference/02-cli.md#init).

</details>

## Update a project

Updates are explicit. Preview and apply one with your configured CLI:

```text
<cli> upgrade --dry-run
<cli> upgrade
<cli> lint
```

`upgrade` selects the latest release tag, updates version pins, migrates the layout, refreshes generated files, and prints the intervening changelog. Use `--to X.Y.Z` to choose a release. Review the diff and commit it after fixing any errors reported by `lint`.

**Keep custom rules outside generated sections.** An upgrade rewrites the backlog and archive READMEs, `docs/ROLES.md`, and the header of `docs/archive/LOG.md`. Committed edits to those sections are replaced; journal entries are preserved. Put your own rules in `AGENTS.md` outside the backslop block or in a separate document.

For local or global installations, update the installed package first and configure `source`. For pins older than 0.11.1, use `npx github:Velklish/backslop upgrade`; pins earlier than 0.9.0 are unsupported. See [upgrade details](docs/reference/02-cli.md#upgrade) and [migration rules](docs/reference/01-layout.md#the-rules-pair-belongs-to-the-tool).

## Work on backslop

Read [AGENTS.md](AGENTS.md) for contribution rules and the [module map](docs/reference/06-module-map.md) for code entry points. The repository uses backslop to manage its own work.

Run the repository checks from its root:

```bash
node bin/backslop.js gates
```

This runs `lint` and `npm test`. The CLI uses only the Node.js standard library. Original repository prose is English; Russian templates and CLI translations are maintained alongside their English sources.

Browse the [reference](docs/reference/README.md) for detailed behavior and the [changelog](CHANGELOG.md) for release history. Report bugs or ask questions in [GitHub Issues](https://github.com/Velklish/backslop/issues).

## Third-party components

`templates/vendor/` holds two MIT-licensed skills that the adapters lay out in every project that selects one. Each directory carries the upstream `LICENSE` verbatim and a `SOURCE.md` with the upstream commit, the modifications and the sha256 of each upstream file.

- **`backslop-humanizer`** — [humanizer](https://github.com/blader/humanizer) at commit `9862685f575c65a8247f90369951df1b3416e3d6`. MIT License, Copyright (c) 2025 Siqi Chen. Its patterns of AI writing are based on Wikipedia's "Signs of AI writing". Modification: the frontmatter `name` is `backslop-humanizer`.
- **`backslop-techdoc`** — [technical-documentation](https://github.com/wondelai/skills/tree/c172996495bed0fcd26896a9416b2093fd7073f0/plugins/code-craftsmanship/skills/technical-documentation) from wondelai/skills at commit `c172996495bed0fcd26896a9416b2093fd7073f0`. MIT License, Copyright (c) 2025 Wondel.ai sp. z o.o. Its "About the Source" section is the CC BY 4.0 attribution to Google's developer documentation style guide and is unchanged. Modifications: the frontmatter `name` is `backslop-techdoc`; the affiliate query `?tag=wondelai00-20` is removed from two Further Reading links; in `references/release-notes.md`, an example link to `CHANGELOG.md` outside a code block is inline code, because it resolved to nothing.

License: [MIT](LICENSE).
