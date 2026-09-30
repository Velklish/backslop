# backslop documentation

The canonical project documentation. For current work, use `node bin/backslop.js status`; for why the system is arranged this way, see the ADRs in the table below. The user guide is the repository [README.md](../README.md): installation, commands and the process; this page covers how the tool is built.

| Document | Topic | Status |
|---|---|---|
| [reference/](reference/README.md) | Subsystem reference: layout and file formats, the CLI, lint gates, the finding verification protocol, and the orchestrator contract (page 05) | Living |
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
2. **A topic has one ADR.** A changed decision rewrites it, in place or as a new file that replaces it; the replaced file is deleted and nothing cites its number — there are no "Superseded by" chains.
3. **Use only terms from the glossary.** If a required name is missing, propose it rather than silently inventing it.
4. **Evidence is stronger than intuition.** Put a number, file path, or command output in task definitions, results, and ADRs; state unverified claims as hypotheses.
5. **Repository rules** — templates as the source, generated adapter outputs, gates and comments — are in [AGENTS.md](../AGENTS.md).

Every ADR must be linked from this file — lint gate 8 checks the link — and the link is kept as a row of the table above.
