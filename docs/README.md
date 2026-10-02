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
The project command `<cli> upgrade` runs the code of the pinned version and finishes from a pin of 0.11.1 or later. For an older pin, use the untagged form `npx github:Velklish/backslop upgrade`, which always runs fresh backslop and still updates the project to the latest tag; pins earlier than 0.9.0 are unsupported.
```
<!-- /quote -->

<!-- quote:reference/README.md -->
```text
| [05. Orchestrator contract](05-orchestrator-contract.md) | what an orchestrator or a script may rely on: output channels, exit codes, the JSON of `status`, `gates`, `tracks`, `links --external` and `seed --scan`, the brief, the commands that change files, and what is stable |
```
<!-- /quote -->

<!-- quote:reference/01-layout.md -->
```text
| `agents-section.md` — the `AGENTS.md` block | `init` | [lib/init.js](../../lib/init.js) | docs/skills group: `adrNumber`, `cli`, `date`, `docs`, `hooksRule`, `prefix`, `probeBreakage`, `probeManual`, `probeRule`, `probeSecond`, `probeVerified`, `project` | the `<!-- backslop:start -->` and `<!-- backslop:end -->` markers; the step lines `1.`–`7.`, which `agents.stepOverrides` replaces by number; the `Worker boundaries:` line that closes step 7, in the Russian layer its `workerBoundaries` form from [templates/i18n/ru.mjs](../../templates/i18n/ru.mjs) |
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

<!-- quote:reference/05-orchestrator-contract.md -->
```text
### Change the contract
```
<!-- /quote -->

<!-- quote:reference/05-orchestrator-contract.md -->
```text
- A script becomes a gate candidate only when its name matches `GATE_NAME` in [lib/seed.js](../../lib/seed.js), which is why `start` is absent from the `gates` list of the sample run; the walk skips the directories of `SKIP_BUILD` in the same file. The lists live in the code, and the sources are named in [02 § seed](02-cli.md#seed).
```
<!-- /quote -->

<!-- quote:reference/05-orchestrator-contract.md -->
```text
- `deferred` is the text of the Reason line of the Deferred section, without the list marker and the label, as written in the file and in its language; it is `null` when that line is empty or still the `[TODO]` stub, and when the task has no Deferred section. A section without a Reason line gives its first non-empty line that is not a `- **Label:** value` field line, as written, or `null` when every line is a field.
```
<!-- /quote -->

<!-- quote:reference/05-orchestrator-contract.md -->
```text
      "deferred": "Waiting for the reviewer"
```
<!-- /quote -->

<!-- quote:reference/05-orchestrator-contract.md -->
```text
- a crash is also exit 1 with empty stdout; its stderr carries a stack trace instead of a `✖` line, so a caller that reads only the exit code and stdout treats it as "no result", like a refusal.
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

<!-- quote:reference/06-module-map.md -->
```text
| `makeProject({ docs = 'docs', git = true, stamp = true } = {})` | A temporary project built by hand, not by `init`, so an `init` defect does not redden another test. `backslop.json` has prefix `BS`, `gates: []`, `lang: 'ru'` and `tools: []`; `stamp: false` omits the `version` stamp. It creates the status directories, `archive/`, `adr/`, `reference/` and minimal READMEs — `docs/README.md` with one link, since Markdown files without any link fail gate 1 as `gate 1 read nothing` — and with `git: true` a repository on `main` with a test identity. Because `lang` is `ru`, messages come out in Russian, and a test builds its expectation through the Russian helpers of [Russian in tests](#russian-in-tests), never from a Russian literal; a test of an English message rewrites `lang` to `en` in `backslop.json` first |
```
<!-- /quote -->

<!-- quote:reference/06-module-map.md -->
```text
Inputs that cannot come from a Russian source are built from code points: the look-alike forms named with the `ruExpand` tokens (`String.fromCodePoint` in `LOOKALIKES` of the helpers), the non-ASCII directory names of the git `quotePath` tests (`NON_ASCII_DIR` in `test/commands.test.mjs`, `DOCS_DIR` in `test/upgrade.test.mjs`), the non-ASCII names in `PKG` of `test/gates.test.mjs`, `ELKA` of `test/links.test.mjs` and `STEM` of `test/util.test.mjs`, and the cp1251 bytes in `test/init.test.mjs`. A test that asserts the absence of Russian uses `/\p{Script=Cyrillic}/u`.
```
<!-- /quote -->

<!-- quote:reference/06-module-map.md -->
```text
4. **The docs.** A row in the command table of [02. CLI](02-cli.md) and a `### foo` section under it; the list of positional-argument counts in the "Flag parsing" paragraph of that page; a row in the command table of the README. If an orchestrator depends on the command, [05](05-orchestrator-contract.md) gets its channel and exit-code lines.
```
<!-- /quote -->

<!-- quote:reference/06-module-map.md -->
```text
**Messages.** Every user-facing message is written once, in English, as the key of `msg(lang, en, params)` from `lib/i18n.js`: `{name}` in the text takes `params.name`, and a function param is called with the language of the text it fills. For `en` the lookup returns the English text; otherwise it returns the Russian entry of the same key in [templates/i18n/ru.mjs](../../templates/i18n/ru.mjs), the CLI's Russian localization, and a key without an entry falls back to the English. An entry is a string with a subset of the key's placeholders, or a function of the params, for word order, plural forms and a text that differs by context. After the config is loaded the language is `cfg.lang`; before that, it is the `lang` passed to `run`. Outside a project that `lang` is `null`, and `msgBoth(lang, en, params)` returns both texts, `en / ru`, or the entry of the same key in `both` of that module when the two-language form is another. The key is a string literal at the call: `test/i18n.test.mjs` reads every key in `lib/` and `bin/` and fails on a key without an entry, on an entry no call uses, on a key written twice in the module, on one English text under two keys that differ only in placeholder names, and on a call whose params object has no param for a placeholder of its key. JSON output is language-neutral.
```
<!-- /quote -->

<!-- quote:reference/README.md -->
```text
| [03. Lint gates](03-lint.md) | the fifteen gates, the checks outside them (adapter outputs, template parity, live pins, agent hook records), warnings, and what each catches and how to fix it |
```
<!-- /quote -->

<!-- quote:reference/README.md -->
```text
How backslop works, as the code shows it. The intent and rationale are in the [ADRs](../README.md); this reference covers only the behaviour of the working version. It is split by subsystem, and each file is edited independently. The Scope field of a task links here.
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
## Update a project
```
<!-- /quote -->

<!-- quote:../README.md -->
```text
## Work on backslop
```
<!-- /quote -->

<!-- quote:../README.md -->
```text
A backlog for slop: a file-based task tracker and decision log next to the code, plus process skills for agents. Initialise any project with one command:
```
<!-- /quote -->

<!-- quote:../README.md -->
```text
`init` lays down this core in every project:
```
<!-- /quote -->

<!-- quote:../README.md -->
```text
With an adapter selected, ask an agent to "populate docs using backslop" after the skeleton is ready: the `backslop-seed` skill reads the repository, asks a few questions, and fills the glossary, initial ADRs and the reference without inventing anything without evidence. Before a release or when a worker batch closes, `backslop-writer` checks documentation currency and, in release mode, style. Its audit mode scores a document, says whether it can ship and files every finding with a regression check.
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

<!-- quote:reference/02-cli.md -->
```text
Checked live on 2026-10-02 on Claude Code 2.1.284 (the record is the message of commit `74c73a2`), in two `claude -p` sessions of a throwaway project with the records written by hand: a broken anchor in a file the session created returned the turn once, with the error line in the `Stop hook feedback:` message; a broken anchor in a file the session never touched did not return it. Not checked: this command under Codex and Cursor, which follow the protocols measured in [01](01-layout.md#agent-hook-files-and-protocols) (for Cursor, only in the interactive terminal, where `stop` fires), and the note channels — `systemMessage` for `claude` and `codex`, stderr for `cursor` — which no run showed to the user.
```
<!-- /quote -->

<!-- quote:reference/02-cli.md -->
```text
- A task already in `queue/` with `--top`/`--after M` is reordered, not moved: its place is computed as the bullet "Queue position" describes, without the task itself among the neighbours; only Order changes, the file stays and no links are rewritten.
```
<!-- /quote -->

<!-- quote:reference/02-cli.md -->
```text
- Flags are parsed by `parseArgs` in strict mode through `parseCommandArgs` ([lib/util.js](../../lib/util.js)); the flags in the synopsis of each command in [Commands](#commands) are the option keys of its call. Command dates come from `today` in the same file.
```
<!-- /quote -->

<!-- quote:reference/02-cli.md -->
```text
- Before the first write: a symlink on the root of a selected adapter or on the path of one of its outputs (unselected roots are not checked), a directory at an output path, a file on a component of that path, `CLAUDE.md` that is a directory or a dangling symlink with `claude` selected; `docs`, a skeleton directory under it, or a selected adapter root that is a file; `docs` or a skeleton directory under it that cannot be read (named with its error code, as the other commands name it); `AGENTS.md` or `.gitignore` that is a directory; `docs/README.md` that is not a file; `AGENTS.md` or a `.gitignore` that `init` rewrites not in UTF-8; a block marker on its own line twice, or without its pair; the hook file of a selected harness that is not valid JSON, whose top level or `hooks` is not an object, or whose start or stop value is not a list, or that has a symlink on its path.
```
<!-- /quote -->

<!-- quote:reference/02-cli.md -->
```text
- Links into the folded directory that go around the rewritten targets have nowhere to point: the report names them — including a link with a broken `%` escape whose path as written leads into the folded directory — as a separate count of links into the folded task left unrewritten, with a `file: target` list; `lint` gate 1 reports them as broken in `docs/**` and root `*.md`.
```
<!-- /quote -->

<!-- quote:reference/02-cli.md -->
```text
- A directory with an uncommitted edit gets no revision, since its last commit then carries another version; so does a file that differs from the revision while `git status` shows no edit (`assume-unchanged`, `skip-worktree`).
```
<!-- /quote -->


<!-- quote:reference/01-layout.md -->
```text
An existing `CLAUDE.md` is kept; when it neither imports `@AGENTS.md` nor is a symlink to `AGENTS.md`, `init` prints the warning `CLAUDE.md does not import AGENTS.md — add “@AGENTS.md” or Claude Code will not see the backslop block`. Measured on 2026-10-02 with Claude Code 2.1.284, model `claude-sonnet-5-5`, headless `claude -p --setting-sources project` with tools disabled (`--tools ""`), on a fresh project, one run per condition: with `@AGENTS.md` in `CLAUDE.md` the model quoted a marker sentence of `AGENTS.md`, and in a control without that line it found no such sentence. With tools disabled this says nothing about whether an agent with tools reads `AGENTS.md` itself. The record is the Checks paragraph of the message of the commit that accepts this change. Deselecting `claude` removes `CLAUDE.md` only when its content is exactly the stub.
```
<!-- /quote -->

<!-- quote:reference/01-layout.md -->
```text
### Re-run init
```
<!-- /quote -->

<!-- quote:reference/01-layout.md -->
```text
`init` lays down these paths in a project:
```
<!-- /quote -->

<!-- quote:reference/01-layout.md -->
```text
The name is `<prefix>-N-<slug>.md`, or `<prefix>-N.k-<slug>.md` for a finding; a slug is lowercase Latin letters, digits and hyphens between words. The directory is the status. Russian and English names of fields and sections are read together in one backlog; new files are written by the `lang` layer. The Russian names are `fieldNames` and `sectionNames` in [templates/i18n/ru.mjs](../../templates/i18n/ru.mjs), under the same keys. The English names:
```
<!-- /quote -->

<!-- quote:reference/01-layout.md -->
```text
A record has this form:
```
<!-- /quote -->

<!-- quote:reference/01-layout.md -->
```text
| `completed` | "completed" and its Russian participle. A bare "closed" or "done" (and the Russian "closed"), and the marker "Outcome:" in either language (the word with a colon right after it), count only when neither the paragraph nor the heading named an outcome with the words of the `merged into <number>` or `rejected` row: the template opens the paragraph with `**Closed DATE.**`, in Russian in the `ru` layer, and in old archives that is the only outcome word. "**Outcome: both forms are understood.**" is completed; so is a marker with a word outside the table, or with the Russian "removed" not as the first word of the paragraph, like "Refusal: moot": "**Outcome: removed** together with its subject". "Outcome: rejected" is rejected, by the word. "Outcome" without a colon and "Outcome — …" with a dash are not the marker |
```
<!-- /quote -->

<!-- quote:reference/01-layout.md -->
```text
- New records are held to it by `lint` gate 5 and `fold N` (see **Name a non-completed outcome with a table word**); journals that are already folded are fixed by hand.
```
<!-- /quote -->

<!-- quote:reference/01-layout.md -->
```text
- **Vendored skills.** `templates/vendor/` has no language: parity, gate 12 and `TEMPLATE_KEYS` skip it, and the skill frontmatter test does too, because upstream's frontmatter is not in the YAML-mapping form that **Skill descriptions** sets. Its `SOURCE.md` names the upstream URL, the full commit sha, the copy date, the upstream path, the modifications, and the sha256 of each upstream file. `npm test` holds it: every directory has `LICENSE` and such a `SOURCE.md`, and every file not listed as modified matches its recorded sha256. A new vendored skill needs no change in `lib/` when its frontmatter `description` is a one-line plain scalar, a one-line double- or single-quoted string, or a `|` block: these are the forms the `cursor` adapter decodes, and only for vendored skills; the form is read from the raw line, so a double-quoted string is decoded once. A ` # comment` after the value is not read as a comment and stays in the text. `init` with `cursor` selected refuses any other form (`>`, `|-`, `|2`, an unclosed quote, a scalar continued on an indented next line) and names the file. Its `name` must start with `backslop-`, or the `.gitignore` block does not cover it.
```
<!-- /quote -->

<!-- quote:reference/01-layout.md -->
```text
- **The AGENTS.md block.** The block is replaced between its markers, or appended at the end of the file when there are no markers. A marker counts only on a line of its own: a mention in prose is not a block. A marker that stands on its own line twice is refused, and so is a marker without its pair. `AGENTS.md`, and a `.gitignore` that `init` rewrites, are read only as UTF-8: a file in another encoding is refused before the first write.
```
<!-- /quote -->

<!-- quote:reference/01-layout.md -->
```text
- **Before the first write.** The config, adapter-root, docs-directory and managed-block checks run before anything is written. A refusal on an adapter output path (see [Symlinks and traversal](#symlinks-and-traversal)) comes on write, after the config and the docs skeleton are on disk; after the cause is removed, the same `init` completes. So does the refusal of a skill `description` the `cursor` adapter cannot read, in a template or a vendored `SKILL.md`: only a malformed skill in the tool itself triggers it.
```
<!-- /quote -->

<!-- quote:reference/01-layout.md -->
```text
- **Safeguards before the first write.** An uncommitted edit of such a file (`git status --porcelain` is not empty) is refused with the file name. A path through a symlink on any component is skipped with a warning, so the write does not go through the link. A pin move alone is not an edit: a file that, after every pin of the `cli` spec is set to the `cli` pin, equals its `HEAD` version up to line endings is redrawn — that is how `upgrade` of earlier versions leaves it.
```
<!-- /quote -->

<!-- quote:adr/adr-040-harness-adapters.md -->
```text
- **Claude stub.** With `claude` selected and no `CLAUDE.md`, `init` writes the stub `@AGENTS.md`. A `CLAUDE.md` that is a link to `AGENTS.md` or contains `@AGENTS.md` is accepted; any other file is kept and `init` warns that Claude Code will not see the block (`ensureClaudeStub`; a dated measurement under stated conditions is in [01 § What init lays down](../reference/01-layout.md#what-init-lays-down)). The AGENTS.md block always lists the skills and labels them as available only when an adapter is selected (`templates/agents-section.md`).
```
<!-- /quote -->

<!-- quote:reference/03-lint.md -->
```text
| 1 | Links | A broken local link, a missing anchor, an undeclared reference label, a target that differs from the file name in case or in Unicode form, a link to a directory whose text names a project task, or Markdown files with no link at all, in `docs/**` and root `*.md`. The files, the link forms, the messages and the counts line are in [Gate 1 in detail](#gate-1-in-detail) | fix the path, and the case to match the file; point a fragment at an existing heading or id; declare the label or write the link inline; point a link that names a task at its file or journal line; move tasks with `mv`, `archive` or `fold`: they rewrite the local forms gate 1 reads — inline links and images, both badge destinations, HTML `<a href>` and reference declarations, including in a blockquote or a list item |
```
<!-- /quote -->

<!-- quote:reference/03-lint.md -->
```text
| 3 | Backlog layout | Any file directly in `docs/backlog/` other than `README.md` (dot files are ignored); a directory that is not a status; a missing status directory; a missing `docs/backlog/`; `docs/backlog/` or a status directory that is a regular file — `<path>: a file, expected a directory`. A symlink to a directory inside the project is a directory; a symlink leading out of the project is not followed: under a status name the error says it is a symlink leading out, under any other name it counts as a file | `mv N <status>` — it finds the flat file and recomputes its links; create the directory with a `.gitkeep`, or run `init` for a missing `docs/backlog/`; a file in place of a directory — remove or rename it and create the directory |
```
<!-- /quote -->

<!-- quote:reference/03-lint.md -->
```text
- **The set.** Root `README*.md` (any letter case), every `.md` under `<docs>/` except `<docs>/backlog/` and `<docs>/archive/` — ADRs included — and, in `CHANGELOG.md`, the unreleased section only. The unreleased section is the first `## ` section whose title does not start with a version, and there is none when every section is versioned; the tags of the clone are not read, so a versioned top section is released whether or not its tag exists. Released sections are history and stay with gate 6.
```
<!-- /quote -->

<!-- quote:reference/03-lint.md -->
```text
- **Directory links that name a task.** The same gate reports a link to an existing directory whose text names a project task (`<prefix>-N[.k]` anywhere in the link text, in a code span too): inline `[<prefix>-N](../triage)` and reference-style — full `[<prefix>-N][f]`, collapsed `[<prefix>-N][]` and shortcut `[<prefix>-N]` with the declaration `[f]: ../triage` (labels compare case-insensitively). Such a link promises a card and delivers a directory, and it looks whole while broken; gate 6 does not report it, because the number exists. A directory link without a task id is allowed: `[templates/](../../templates/)` shows a directory, and nothing but the directory can show it. A link inside a code span or a fenced code block is an example and is not read.
```
<!-- /quote -->

</details>
