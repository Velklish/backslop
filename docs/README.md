# backslop documentation

The canonical project documentation. For current work, use `node bin/backslop.js status`; for why the system is arranged this way, see the ADRs in the table below. The user guide is the repository [README.md](../README.md): installation, commands and the process; this page covers how the tool is built.

| Document | Topic | Status |
|---|---|---|
| [reference/](reference/README.md) | Subsystem reference: layout and file formats, the CLI, lint gates, the finding verification protocol, the orchestrator contract (page 05), and the module map with contributor recipes (page 06) | Living |
| [GLOSSARY.md](GLOSSARY.md) | Normative terminology: one concept, one name | Living |
| [backlog/](backlog/README.md) | Task tracker: one file per task, status is the directory, summary is `node bin/backslop.js status` | Living |
| [archive/](archive/README.md) | Closed tasks in two forms: a task directory with `task.md` and `result.md` until it is folded, then a line in `archive/LOG.md` | Living |
| [adr/adr-039-node-runtime-delivery-release.md](adr/adr-039-node-runtime-delivery-release.md) | Zero-dependency Node runtime, npx delivery and release | Accepted |
| [adr/adr-040-harness-adapters.md](adr/adr-040-harness-adapters.md) | Harness adapters: selection, ownership and path safety of generated outputs | Accepted |
| [adr/adr-041-probe-command.md](adr/adr-041-probe-command.md) | The mutation-probe command is a project field substituted into the block, the task skill and the brief | Accepted |
| [adr/adr-042-worker-brief.md](adr/adr-042-worker-brief.md) | The worker brief is rendered by a command from a template | Accepted |
| [adr/adr-043-changelog-merge.md](adr/adr-043-changelog-merge.md) | merge-changelog merges the unreleased section structurally and refuses rather than guess | Accepted |
| [adr/adr-044-closed-task-journal.md](adr/adr-044-closed-task-journal.md) | Closed tasks fold into a journal line; the body stays in git | Accepted |
| [adr/adr-045-gates-runner.md](adr/adr-045-gates-runner.md) | Gates runner and path-scoped gates | Accepted |
| [adr/adr-046-comment-length-gate.md](adr/adr-046-comment-length-gate.md) | Inline comments: at most two lines and 100 code points, checked by a test | Accepted |
| [adr/adr-047-findings.md](adr/adr-047-findings.md) | Findings: numbering under a parent, cost label, the minor/ status and batch closing | Accepted |
| [adr/adr-048-version-pin-upgrade-migrate.md](adr/adr-048-version-pin-upgrade-migrate.md) | Version pin, upgrade and migrate | Accepted |
| [adr/adr-049-queue-order.md](adr/adr-049-queue-order.md) | Queue order: an integer rank per file, a saved rank on leaving, restore of several tasks in one call | Accepted |
| [adr/adr-050-process.md](adr/adr-050-process.md) | Tasks and decisions live as files; a task's status is its directory | Accepted |
| [adr/adr-051-localization.md](adr/adr-051-localization.md) | Layout language: the lang field and a second template set | Accepted |
| [adr/adr-052-step-overrides.md](adr/adr-052-step-overrides.md) | A project overrides a numbered step of the AGENTS.md block from backslop.json | Accepted |
| [adr/adr-053-seed.md](adr/adr-053-seed.md) | Seeding: the seed command extracts candidates, the agent and the owner select | Accepted |
| [adr/adr-054-tracks.md](adr/adr-054-tracks.md) | The tracks command observes a worker run and never removes anything | Accepted |
| [adr/adr-055-docs-rules-ship-to-projects.md](adr/adr-055-docs-rules-ship-to-projects.md) | Documentation rules ship to projects: lint checks, writing skills, agent hooks and the writer pass | Accepted |

## Cross-cutting principles

1. **An undocumented change is incomplete.** Update the reference, subsystem README, and CHANGELOG in the same pass as the code.
2. **The ADR directory holds current decisions only.** A new decision on a question already decided rewrites that question's ADR in place: same number, the rationale that still holds, the consequences of the change. An ADR that no longer governs anything is deleted; git keeps its history. A chain of ADRs on one question is folded into its highest number.
3. **Use only terms from the glossary.** If a required name is missing, propose it rather than silently inventing it.
4. **Evidence is stronger than intuition.** Put a number, file path, or command output in task definitions, results, and ADRs; state unverified claims as hypotheses.
5. **Repository rules** — templates as the source, generated adapter outputs, gates and comments — are in [AGENTS.md](../AGENTS.md).

Every ADR must be linked from this file — lint gate 8 checks the link — and the link is kept as a row of the table above.

## Guarded statements

Each block quotes a statement of the README or the reference that a code change can make stale. Lint gate 10 fails when the quoted statement changes, so an edit of it updates its block in the same pass.

<details>
<summary>Quoted statements</summary>

<!-- quote:../README.md -->
```text
The project command `<cli> upgrade` runs the code of the pinned version and finishes from a pin of 0.11.1 or later. For an older pin, use the untagged form above, which always runs fresh backslop and still updates the project to the latest tag; pins earlier than 0.9.0 are unsupported.
```
<!-- /quote -->

<!-- quote:reference/README.md -->
```text
| [05. Orchestrator contract](05-orchestrator-contract.md) | what an orchestrator or a script may rely on: output channels, exit codes, the JSON of `status`, `gates`, `tracks`, `links --external` and `seed --scan`, the brief, the commands that change files, and what is stable |
```
<!-- /quote -->

<!-- quote:reference/01-layout.md -->
```text
| `agents-section.md` — the `AGENTS.md` block | `init` | [lib/init.js](../../lib/init.js) | docs/skills group: `adrNumber`, `cli`, `date`, `docs`, `hooksRule`, `prefix`, `probeBreakage`, `probeRule`, `probeSecond`, `probeVerified`, `project` | the `<!-- backslop:start -->` and `<!-- backslop:end -->` markers; the step lines `1.`–`7.`, which `agents.stepOverrides` replaces by number; the `Worker boundaries:` line that closes step 7, in the Russian layer its `workerBoundaries` form from [templates/i18n/ru.mjs](../../templates/i18n/ru.mjs) |
```
<!-- /quote -->

<!-- quote:reference/01-layout.md -->
```text
| `agents-hooks.md` — the hook sentence of the block | `init`, only when `hooks` is not empty | [lib/init.js](../../lib/init.js) | none; `init` places its text in the `{{hooksRule}}` slot of `agents-section.md` | none |
```
<!-- /quote -->

<!-- quote:reference/02-cli.md -->
```text
- `-h`/`--help` is a flag of every command: help with exit code 0, inside a project or outside. In the place of a string flag's value (`--title -h`, `--evidence --help`) it is the value, not a help request. An unknown flag and an extra argument beat help: `new --bogus --help` is the refusal `unknown option “--bogus”` with exit code 1.
```
<!-- /quote -->

<!-- quote:reference/02-cli.md -->
```text
- A git failure while scanning foreign numbers, other than "no repository" and "git is not installed"; a bad slug; a slug that makes the file name `<prefix>-<N[.k]>-<slug>.md` longer than 255 bytes — before any write and before the queue is renumbered; no such parent; `docs/backlog` or the status directory the file goes into is a file.
```
<!-- /quote -->

<!-- quote:reference/05-orchestrator-contract.md -->
```text
The single owner of the field semantics is the [01 config table](01-layout.md#backslopjson). The twelve fields, in the order the tool writes them:
```
<!-- /quote -->

<!-- quote:reference/05-orchestrator-contract.md -->
```text
| `writer` | extra scope of the `backslop-writer` pass, or absent |
```
<!-- /quote -->

<!-- quote:reference/06-module-map.md -->
```text
`lib/` has 37 files. Every command is one module; the rest are shared. `lib/<name>.js` that exports `run` is a command only if it is in `COMMANDS`.
```
<!-- /quote -->

<!-- quote:reference/06-module-map.md -->
```text
| `lib/links.js` | `links`: `links --external`, the http(s) addresses of the gate 1 file set, one request at a time, the class of each answer, the exit code. Also the one parser of every link form that gates 1, 8, 13 and 15 and `seed` read, heading anchors, the gate 1 check of a file, directory links, the rewrite on a move, a fold or an archive (every form gate 1 reads, in the syntax it was written) | `run`, `classifyStatus`, `externalUrls`, `linksOf`, `localLinks`, `relativeLinks`, `checkLinks`, `anchorsOf`, `anchorReader`, `slugOf`, `uniqueSlugs`, `hasAnchor`, `directoryLinks`, `mapLinks`, `rebaseTarget`, `rewriteMovedLinks`, `rewriteFoldedLinks`, `blankFences`, `CODE_SPAN` |
```
<!-- /quote -->

<!-- quote:reference/06-module-map.md -->
```text
| Lint in a fresh `git worktree`, where ignored adapter outputs are absent | `test/lint-worktree.test.mjs` |
```
<!-- /quote -->

<!-- quote:reference/06-module-map.md -->
```text
| Shared modules | `test/config.test.mjs`, `test/tasks.test.mjs`, `test/links.test.mjs`, `test/mdwalk.test.mjs`, `test/util.test.mjs`, `test/version.test.mjs`, `test/adapter-ownership.test.mjs`, `test/hooks-install.test.mjs` |
```
<!-- /quote -->

<!-- quote:reference/06-module-map.md -->
```text
| Vendored writing skills: `LICENSE`, `SOURCE.md`, and how the adapters lay them out | `test/vendor.test.mjs` |
```
<!-- /quote -->

<!-- quote:reference/06-module-map.md -->
```text
| The `backslop-writer` skill templates and the `writer` field of `backslop.json` | `test/writer.test.mjs` |
```
<!-- /quote -->

<!-- quote:reference/README.md -->
```text
| [03. Lint gates](03-lint.md) | the fifteen gates, the checks outside them (adapter outputs, template parity, live pins, agent hook records), warnings, and what each catches and how to fix it |
```
<!-- /quote -->

<!-- quote:reference/02-cli.md -->
```text
- A green gate is exit code 0 without a launch error. A gate that hit the ceiling (`error` with the code `ETIMEDOUT`, with or without a signal) prints "timed out after the 10-min cap"; a signal without the ceiling prints "killed by signal SIG…"; any other launch error prints "did not start: …". All three are ✖, do not count as green and turn the total red whatever the code. The ceiling usually gives ETIMEDOUT with SIGTERM, and a shell that survived SIGTERM gives ETIMEDOUT with no signal and code 0: in `--json` such a gate has `code` 0 and a non-empty `error`.
```
<!-- /quote -->

<!-- quote:reference/02-cli.md -->
```text
- A `--theirs` side without an unreleased section reads as empty, and the report says "theirs has no unreleased section — its entries were not read"; the exit code does not change.
```
<!-- /quote -->


<!-- quote:reference/02-cli.md -->
```text
- An attachment is any file of the directory other than `task.md`, `result.md` and batch entries in `minor/`, at any depth. A file git ignores (`.gitignore`, `info/exclude`, `core.excludesFile` — `.DS_Store`, for example) is not an attachment unless git ignores the task directory itself (`git check-ignore -q --no-index -- <dir>/`): in a directory ignored whole, and outside a repository, every file counts. Attachments do not go into the draft, so `fold N` refuses while any attachment is not in `HEAD` as it is on disk: an unsaved attachment is never deleted.
```
<!-- /quote -->


<!-- quote:../README.md -->
```text
As measured on 2026-09-30 with Claude Code 2.1.284, `codex-cli 0.158.0` and `cursor-agent` 2026.09.26-dd393fe, the trust step before a project hook runs differs by harness (the record is the message of commit `43f35f8`; the measurements are in [Agent hook files and protocols](docs/reference/01-layout.md#agent-hook-files-and-protocols)):
```
<!-- /quote -->

<!-- quote:../README.md -->
```text
At promptobus `v0.21.0` (recorded on 2026-10-02 in the message of commit `8dc5fb0`), Codex participants refuse a foreign `<project>/.codex/hooks.json` and Cursor participants overwrite `<project>/.cursor/hooks.json`, so a project that runs such participants should not select those hooks.
```
<!-- /quote -->

<!-- quote:reference/01-layout.md -->
```text
Measured on 2026-09-30 on macOS with a hand-written project hook file that runs a probe on the start and stop events. Each harness ran headless, and Cursor also ran interactively in `tmux`. Versions: Claude Code 2.1.284, Codex `codex-cli 0.158.0`, Cursor `cursor-agent` 2026.09.26-dd393fe. The record is the message of commit `43f35f8`, which holds the result of the measurement with the evidence of each cell. What is stated below was observed on those versions, one run per cell unless the cell gives a run count; a cell that reads "not measured" was not tried.
```
<!-- /quote -->

<!-- quote:reference/01-layout.md -->
```text
**The trust step.** As measured above, the harnesses differ: Claude Code in `-p` needs no step; Codex in `codex exec` ran the hooks only with `--dangerously-bypass-hook-trust`, and persisted trust was not measured; Cursor in `-p` with `--force` needs none, and the interactive `cursor-agent` asks to trust the workspace (`--trust`). Cursor's `stop` fires only in the interactive terminal, and a linked Codex worktree runs the main checkout's `<project>/.codex/hooks.json`.
```
<!-- /quote -->

<!-- quote:reference/01-layout.md -->
```text
**promptobus participants.** At promptobus `v0.21.0` (recorded on 2026-10-02 in the message of commit `8dc5fb0`, from the functions `refuseForeignProjectLayer` and `prepare` of its source), a Codex participant refuses a foreign `<project>/.codex/hooks.json` in the project, and a Cursor participant overwrites `<project>/.cursor/hooks.json` in its worktree. A project that runs promptobus Codex or Cursor participants should not select those hooks at that version; `init` says so in one line of its output when `cursor` or `codex` is selected.
```
<!-- /quote -->

<!-- quote:reference/02-cli.md -->
```text
Checked live on 2026-10-02 on Claude Code 2.1.284 (the record is the message of commit `74c73a2`), in two `claude -p` sessions of a throwaway project with the records written by hand: a broken anchor in a file the session created returned the turn once, with the error line in the `Stop hook feedback:` message; a broken anchor in a file the session never touched did not return it. Not checked: this command under Codex and Cursor, which follow the protocols measured in [01](01-layout.md#agent-hook-files-and-protocols) (for Cursor, only in the interactive terminal, where `stop` fires), and the note channels — `systemMessage` for `claude` and `codex`, stderr for `cursor` — which no run showed to the user.
```
<!-- /quote -->


<!-- quote:reference/01-layout.md -->
```text
An existing `CLAUDE.md` is kept; when it neither imports `@AGENTS.md` nor is a symlink to `AGENTS.md`, `init` warns that Claude Code will not see the block. Measured on 2026-10-02 with Claude Code 2.1.284, model `claude-sonnet-5-5`, headless `claude -p --setting-sources project` with tools disabled (`--tools ""`), on a fresh project, one run per condition: with `@AGENTS.md` in `CLAUDE.md` the model quoted a marker sentence of `AGENTS.md`, and in a control without that line it found no such sentence. With tools disabled this says nothing about whether an agent with tools reads `AGENTS.md` itself. The record is the Checks paragraph of the message of the commit that accepts this change. Deselecting `claude` removes `CLAUDE.md` only when its content is exactly the stub.
```
<!-- /quote -->

<!-- quote:adr/adr-040-harness-adapters.md -->
```text
- **Claude stub.** With `claude` selected and no `CLAUDE.md`, `init` writes the stub `@AGENTS.md`. A `CLAUDE.md` that is a link to `AGENTS.md` or contains `@AGENTS.md` is accepted; any other file is kept and `init` warns that Claude Code will not see the block (`ensureClaudeStub`; a dated measurement under stated conditions is in [01 § What init lays down](../reference/01-layout.md#what-init-lays-down)). The AGENTS.md block always lists the skills and labels them as available only when an adapter is selected (`templates/agents-section.md`).
```
<!-- /quote -->

</details>
