# backslop documentation

The canonical project documentation. For current work, use `node bin/backslop.js status`; for why the system is arranged this way, see the ADRs in the table below. The user guide is the repository [README.md](../README.md): installation, commands and the process; this page covers how the tool is built.

| Document | Topic | Status |
|---|---|---|
| [reference/](reference/README.md) | Subsystem reference: layout and file formats, the CLI, lint gates, the finding verification protocol, the orchestrator contract (page 05), and the module map with contributor recipes (page 06) | Living |
| [GLOSSARY.md](GLOSSARY.md) | Normative terminology: one concept, one name | Living |
| [ROLES.md](ROLES.md) | Who decides what in the tracker: worker, approver, owner | Living |
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
| [adr/adr-056-adr-placeholder-gate.md](adr/adr-056-adr-placeholder-gate.md) | A placeholder left in an ADR fails lint | Accepted |

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

<!-- quote:adr/adr-051-localization.md -->
```text
- **Messages.** Human CLI output goes through `msg(lang, en, params)` in the config language (`lib/i18n.js`). The English text in the code is the key, with `{name}` placeholders filled from `params`; the Russian text is the entry of that key in `templates/i18n/ru.mjs`, and a key without an entry falls back to the English. Outside a project the language is unknown, so messages use the English text; `help` in `bin/backslop.js` prints the English help (`HELP_EN`).
```
<!-- /quote -->

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
`lib/` has 38 files. Every command is one module; the rest are shared. `lib/<name>.js` that exports `run` is a command only if it is in `COMMANDS`.
```
<!-- /quote -->

<!-- quote:reference/06-module-map.md -->
```text
| `lib/links.js` | `links`: `links --external`, the http(s) addresses of the gate 1 file set, one request at a time, the class of each answer, the exit code. Also the one parser of every link form that gates 1, 8, 13 and 15 and `seed` read, heading anchors, the gate 1 check of a file, directory links, the rewrite on a move, a fold or an archive (every form gate 1 reads, in the syntax it was written) | `run`, `classifyStatus`, `externalUrls`, `linksOf`, `localLinks`, `relativeLinks`, `checkLinks`, `anchorsOf`, `anchorReader`, `slugOf`, `uniqueSlugs`, `hasAnchor`, `directoryLinks`, `mapLinks`, `rebaseTarget`, `rewriteMovedLinks`, `rewriteFoldedLinks`, `blankFences` |
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
4. **The docs.** A row in the command table of [02. CLI](02-cli.md) and a `### foo` section under it; the list of positional-argument counts in the "Flag parsing" paragraph of that page; a row in the command table of the README. If an orchestrator depends on the command, [05. Orchestrator contract](05-orchestrator-contract.md) gets its channel and exit-code lines.
```
<!-- /quote -->

<!-- quote:reference/06-module-map.md -->
```text
**Messages.** Every user-facing message is written once, in English, as the key of `msg(lang, en, params)` from `lib/i18n.js`: `{name}` in the text takes `params.name`, and a function param is called with the language of the text it fills. For `ru` the lookup returns the Russian entry of the same key in [templates/i18n/ru.mjs](../../templates/i18n/ru.mjs), the CLI's Russian localization; for `en` or an unknown language it returns the English text. A missing Russian entry falls back to English. An entry is a string with a subset of the key's placeholders, or a function of the params, for word order, plural forms and a text that differs by context. After the config is loaded the language is `cfg.lang`; before that, it is the `lang` passed to `run`. Outside a project that `lang` is `null`, so messages use English. The key is a string literal at the call: `test/i18n.test.mjs` reads every key in `lib/` and `bin/` and fails on a key without an entry, on an entry no call uses, on a key written twice in the module, on one English text under two keys that differ only in placeholder names, and on a call whose params object has no param for a placeholder of its key. JSON output is language-neutral.
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
With an adapter selected, ask an agent to "populate docs using backslop" after the skeleton is ready: the `backslop-seed` skill reads the repository, asks a few questions, and fills the glossary, initial ADRs and the reference without inventing anything without evidence. Before a release or when a run with workers closes, `backslop-writer` checks documentation currency and, in release mode, style. Its audit mode scores a document, says whether it can ship and files every finding with a regression check.
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
An existing `CLAUDE.md` is kept; when it neither imports `@AGENTS.md` nor is a symlink to `AGENTS.md`, `init` prints the warning `CLAUDE.md has no “@AGENTS.md” import line — add it, the backslop block is in AGENTS.md`. Measured on 2026-10-02 with Claude Code 2.1.284, model `claude-sonnet-5-5`, headless `claude -p --setting-sources project` with tools disabled (`--tools ""`), on a fresh project, one run per condition: with `@AGENTS.md` in `CLAUDE.md` the model quoted a marker sentence of `AGENTS.md`, and in a control without that line it found no such sentence. With tools disabled this says nothing about whether an agent with tools reads `AGENTS.md` itself. The record is the Checks paragraph of the message of the commit that accepts this change. Deselecting `claude` removes `CLAUDE.md` only when its content is exactly the stub.
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
- **Safeguards before the first write.** An uncommitted edit of such a file (`git status --porcelain` is not empty) is refused with the file name; for `archive/LOG.md` the refusal says that the entries stay and only an edit of the header would be erased. A `ROLES.md` that is no render of either language and lacks the paragraph "This file belongs to backslop" is the project's own file: `migrate` refuses before the first write, with git or without, names the file and asks to rename it. A render of the other language, or a file that keeps the paragraph, is backslop's own and is redrawn. A path through a symlink on any component is skipped with a warning, so the write does not go through the link. A pin move alone is not an edit: a file that, after every pin of the `cli` spec is set to the `cli` pin, equals its `HEAD` version up to line endings is redrawn — that is how `upgrade` of earlier versions leaves it.
```
<!-- /quote -->

<!-- quote:reference/01-layout.md -->
```text
This page is for a contributor or a maintainer who needs the exact layout and formats of a project that uses backslop. It covers what `init` lays down, the fields of `backslop.json`, the task, minor and archive files, the ADRs, the templates and the agent hook files. What each command does is on [02. CLI](02-cli.md), what each lint gate checks is on [03. Lint gates](03-lint.md), how a finding is verified is on [04. Finding verification protocol](04-verification.md), and what a caller may rely on is on [05. Orchestrator contract](05-orchestrator-contract.md).
```
<!-- /quote -->

<!-- quote:reference/01-layout.md -->
```text
| `gates` | `["<cli> lint"]`, built from the project's `cli` | commands that must be green before hand-off; `backslop gates` runs them ([02. CLI](02-cli.md)), and the skills call exactly that. An entry is a non-empty command string (always run) or an object `{ "command": "<command>", "when": ["<glob>", …] }`: a scoped command runs only when the set of changed paths touches at least one pattern. `when` is a non-empty list of non-empty patterns; an empty one is refused, because the command would never run. A pattern matches the whole path from the project root (in a monorepo the project directory prefix is stripped, and a path outside the project leaves the set): `*` and `?` do not cross `/`, `**` does, and `**/` also matches the root. So a directory is written `docs/**`, not `docs`: a bare directory name matches no path, and the gate never runs |
```
<!-- /quote -->

<!-- quote:reference/01-layout.md -->
```text
- **Scope.** `new` gives a new task a link to `reference/README.md` with the path depth computed; in a project without that file the stub stays as text, `[TODO: reference/ section]`, because a broken link would fail gate 1. Whoever files the task picks the actual section. A triaged task's Scope is a filled link to a reference section: in `queue/`, `active/` and `deferred/`, an empty field and the `[TODO]` stub left by `new` fail `lint` (gate 4, [03. Lint gates](03-lint.md)); in `triage/` the field is not checked, since an entry there lies unsorted.
```
<!-- /quote -->

<!-- quote:reference/01-layout.md -->
```text
- **Previous order.** `mv` sets Previous order when a task leaves `queue/` and removes it when the task returns. Outside the queue there is no active Order, and `mv N queue --restore` ([02. CLI](02-cli.md)) needs the number the task left with. The fields are distinct: the gate that requires Order in `queue/` does not count a saved Previous order in its place.
```
<!-- /quote -->

<!-- quote:reference/01-layout.md -->
```text
- **Lint.** In `minor/`, `lint` requires the Evidence section: a missing or empty one, or one holding a stub, is a gate 4 error ([03. Lint gates](03-lint.md)).
```
<!-- /quote -->

<!-- quote:reference/01-layout.md -->
```text
**Directory** — `docs/archive/<id>-<slug>/task.md`: the task definition as it was, with links rewritten for the new depth, and `result.md` from the template [templates/result.md](../../templates/result.md): closing date, outcome, what was done, how it was verified, which docs were updated. `archive N` lays it down so. While a `[TODO` stub remains in `result.md` outside code, `lint` is red; the stub form shown in a code span is not a stub ([03. Lint gates](03-lint.md)).
```
<!-- /quote -->

<!-- quote:reference/01-layout.md -->
```text
- **Anchor.** The anchor is an explicit `<a id>`, not derived from the title: it must equal the number, and gate 13 checks that ([03. Lint gates](03-lint.md)).
```
<!-- /quote -->

<!-- quote:reference/01-layout.md -->
```text
- **Commit** is the revision the body is read from; `—` while the body is not in history. `show N` reads it, and gate 13 reports a revision that is not in the history of `HEAD` ([03. Lint gates](03-lint.md)).
```
<!-- /quote -->

<!-- quote:reference/01-layout.md -->
```text
- **Name a non-completed outcome with a table word.** "**Closed YYYY-MM-DD.** Refusal: moot" is the template's bare "Closed" and gives `completed`, while "**Closed YYYY-MM-DD.** Rejected: moot" gives `rejected`. `lint` gate 5 on an unfolded directory ([03. Lint gates](03-lint.md)) and `fold N` by a refusal before any write ([02. CLI](02-cli.md)) hold this requirement: the first paragraph or the heading of `result.md` must carry a table word. A bare "Closed" or "done" and the "Outcome:" marker, in either language, without a table word do not pass, and the template stub states the requirement. The fallback to the bare word and the marker remains for the bulk fold of old records closed before the gate; `result.md` has no separate Outcome field.
```
<!-- /quote -->

<!-- quote:reference/01-layout.md -->
```text
- **Findings.** Closing a task does not close its findings: a finding `N.k` left in `triage/` after task `N` moved to the archive makes `lint` warn (gate 9, [03. Lint gates](03-lint.md)).
```
<!-- /quote -->

<!-- quote:reference/01-layout.md -->
```text
- **Status.** `Proposed` or `Accepted`, on a `**Status:**` line; `lint` fails on another word, on a missing line and on a status line that names another ADR (gate 8, [03 § ADR status line](03-lint.md#adr-status-line)).
```
<!-- /quote -->

<!-- quote:reference/01-layout.md -->
```text
- **Index.** Every ADR is linked from `docs/README.md`, as a row of its table by convention; at most one table row links it, and that row's Status cell is the status word of the file. `lint` fails without the link, on a second row, on a differing cell and on a `[TODO]` placeholder line left in the file (gate 8, [03 § ADR status line](03-lint.md#adr-status-line)).
```
<!-- /quote -->

<!-- quote:reference/01-layout.md -->
```text
| `docs/**` — the documentation skeleton | `init`; `migrate` redraws `backlog/README.md`, `archive/README.md`, `ROLES.md` and the header of `archive/LOG.md`; `fold` and `migrate` write `archive/LOG.md` when it is missing | [lib/init.js](../../lib/init.js), [lib/migrate.js](../../lib/migrate.js), [lib/fold.js](../../lib/fold.js) | docs/skills group | `backlog/README.md`, `archive/README.md` and `ROLES.md` whole: they belong to the tool, `migrate` compares them with their render, and in this repository they are a 1:1 render, as is the `archive/LOG.md` header above its first journal line; the ADR rows of `README.md` as links (gate 8, [03. Lint gates](03-lint.md)); the first link of each row of `reference/README.md`, read by `seed --queue-reference` |
```
<!-- /quote -->

<!-- quote:reference/01-layout.md -->
```text
- **Placeholders** are written `{{name}}`. A placeholder without a key from the caller is a render-time error naming the template and the key; nothing is left in the text. `lint` gate 12 checks placeholders against the declared keys of each template group, both ways and in both language layers ([03. Lint gates](03-lint.md)).
```
<!-- /quote -->

<!-- quote:reference/01-layout.md -->
```text
- **Source layer.** `templates/en/` is the source; a Russian twin in `templates/` has the same file, the same placeholders, the same skill frontmatter contract (`name` equals the directory name, `description` is not empty) and the same sequence of heading levels outside fenced code blocks — not merely the same count of headings — and the English layer has no Cyrillic. `lint` in the tool's repository fails on a mismatch ([03. Lint gates](03-lint.md)). It names a missing Russian twin of an English file and a Russian file without an English source; on a placeholder or heading mismatch it names the Russian file and prints the English value as the expected one.
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

<!-- quote:reference/02-cli.md -->
```text
- Output: on stderr, one `✖` line per error and one `⚠` line per warning; on stdout, a note when gate 15 skips its URL class (no `origin` remote), then the line of what gate 1 read, `gate 1: files N, links N, local N, anchors checked N`. Then the summary with the warning count: `lint: no errors` on stdout, `lint: errors N` on stderr.
```
<!-- /quote -->

<!-- quote:../README.md -->
```text
2. Run `<cli> lint` and fix what newer gates report — for example, a `result.md` that names no outcome word, or a task id or a tracker link in project documentation: README, `docs/` outside `backlog/` and `archive/`, and the unreleased CHANGELOG section ([gate 15](docs/reference/03-lint.md#documentation-without-the-tracker)). Write what the record says instead: the contract, the rationale, or the measurement with its version and date.
```
<!-- /quote -->

<!-- quote:reference/03-lint.md -->
```text
| 9 | Triage review | A finding `N.k` lies in `triage/` while its task `N` is already in `archive/`: `lint` prints a warning for the approver and does not fail. A finding in `queue/`, `active/` or `deferred/` is already triaged and does not count. A `Parent` field in a status directory whose number differs from the number in the file name (`<prefix>-5.1` with `Parent: <prefix>-6`) is a warning too; `<prefix>-5.2` with `Parent: <prefix>-5.1` agrees, and a `Parent` with no task number is not compared | the approver triages the entry: `mv N.k queue`, merge it into another task, or close it with `archive N.k`; fix the `Parent` field or the file name |
```
<!-- /quote -->

<!-- quote:reference/03-lint.md -->
```text
- an `Order` on a card outside `queue/` and a `Previous order` on a card in `queue/` (gate 4): `mv` removes the first when a card leaves `queue/` and the second when it enters, so delete the line;
```
<!-- /quote -->

<!-- quote:reference/03-lint.md -->
```text
- **Files.** `docs/**` and root `*.md`, the extension in any case (`NOTE.MD` too). A root symlink is read when it resolves to a regular file inside the project; a link leading outside is not read; a symlink whose target the walk already covers is checked once, by the path without the link. A status or archive directory that is a symlink leading out of the project is not read, as in gates 2, 4 and 6: gate 3 reports the link, and the links and quotes of the files behind it, the journal anchors among them, are not checked.
```
<!-- /quote -->

<!-- quote:reference/03-lint.md -->
```text
- A directory reached through several symlinks is walked once, under the first path that reaches it. `mv`, `archive` and `fold` resolve the relative links of a file from its real place in the project, so a card listed only through a symlinked alias of its directory has its links to the moved task rewritten.
```
<!-- /quote -->

<!-- quote:reference/02-cli.md -->
```text
- Output: the file, and a reminder to add the row to the `docs/README.md` table. `lint` fails until the row is added and the `[TODO]` lines of the template are written (gate 8).
```
<!-- /quote -->

<!-- quote:ROLES.md -->
```text
- Asks the owner **only before rejecting** an entry: a finding discarded without asking will not be rediscovered.
```
<!-- /quote -->

<!-- quote:backlog/README.md -->
```text
What the agent decides without asking, and what goes to the owner, is in [ROLES.md](../ROLES.md).
```
<!-- /quote -->

<!-- quote:reference/01-layout.md -->
```text
- **The rest of the skeleton** — `README.md`, `GLOSSARY.md`, `reference/README.md`, the process ADR, `archive/LOG.md` below its header — belongs to the project, and nothing redraws it. `ROLES.md` holds the role protocol the backlog README links to, and a new project gets it from `init`.
```
<!-- /quote -->

<!-- quote:reference/01-layout.md -->
```text
`<docs>/backlog/README.md`, `<docs>/archive/README.md` and `<docs>/ROLES.md` carry backslop's process text, not the project's; the name of the pair comes from the first two. The header of `<docs>/archive/LOG.md` — the text above its first entry line — is redrawn with them under the same rules: an entry line is data and is never touched, and a journal without an entry line is replaced by the template.
```
<!-- /quote -->

<!-- quote:reference/02-cli.md -->
```text
| `migrate [--dry-run]` | run the layout migrations and redraw the rules pair, `ROLES.md` and the journal header |
```
<!-- /quote -->

<!-- quote:../templates/en/agents-section.md -->
```text
6. **Triage review** follows closure immediately and is complete when every entry still in `triage/` has a named next step: merged, moved, or closed by the owner’s decision (`{{docs}}/backlog/README.md`, § Triage cadence). A next step is, for example, a merge into another task, a clarified wording, `{{cli}} mv N queue`, or `{{cli}} mv N deferred` with a return condition. Ask the owner only before rejecting an entry.
```
<!-- /quote -->

<!-- quote:reference/02-cli.md -->
```text
- **The attachment branch.** A task directory with an attachment cannot be folded before the attachment is in `HEAD`, so the squash comes first, with the directory in the tree: `git add -A`, `git reset --soft <base>`, `git commit -m "<prefix>-N: <what was done>"`. Then `fold N > "$(git rev-parse --git-dir)/BACKSLOP_DRAFT"` and the commit of its result: `git add -A`, `git commit --cleanup=verbatim -F "$(git rev-parse --git-dir)/BACKSLOP_DRAFT"`. The journal line names the squash commit, which holds the directory with its attachments, and `show N` lists them by path from it. The task reaches the main branch as those two commits, and nothing is squashed after the fold.
```
<!-- /quote -->

<!-- quote:reference/02-cli.md -->
```text
- An attachment not in `HEAD`, or differing from it — the refusal names the files and points to the attachment branch of the acceptance procedure below, or to moving them out of the directory and linking them from `result.md`.
```
<!-- /quote -->

<!-- quote:reference/02-cli.md -->
```text
- `--cost critical|major` with `--parent` and without `--minor` writes that level into the Cost field of the task card; without `--cost` the card carries a dash (`—`), and so does a card with no `--parent`. `status` shows the level of a card outside `minor/` behind its title, and a dash is shown as nothing.
```
<!-- /quote -->

<!-- quote:reference/05-orchestrator-contract.md -->
```text
- `cost` is the Cost field as written (`minor`, `major (hypothesis)`); on a card outside `minor/` it is a level written by `new --parent N --cost critical|major`, and `null` for a card with no Cost field or a dash; `area` is the Scope field as written, a markdown link included.
```
<!-- /quote -->

<!-- quote:GLOSSARY.md -->
```text
| managed block | `BLOCK_MARKERS` | The section of `AGENTS.md` between the `<!-- backslop:start -->` and `<!-- backslop:end -->` markers: `init` writes and replaces it from `agents-section.md`, and the text outside the markers is the project's | [lib/config.js](../lib/config.js), `BLOCK_MARKERS`; [lib/init.js](../lib/init.js), `readManaged` |
```
<!-- /quote -->

<!-- quote:GLOSSARY.md -->
```text
| rules pair | `RULES_DOCS` | The process text that backslop owns and `migrate` redraws from the template of the project language, so a local edit does not survive an update: the backlog README and the archive README (`<docs>/backlog/README.md`, `<docs>/archive/README.md`), which gave the name, and `<docs>/ROLES.md` beside them | [lib/migrate.js](../lib/migrate.js), `RULES_DOCS`, `planRules`; [01 § The rules pair belongs to the tool](reference/01-layout.md#the-rules-pair-belongs-to-the-tool) |
```
<!-- /quote -->

<!-- quote:GLOSSARY.md -->
```text
| live pin | `stalePins` | A mention of a backslop version in a live file — `README.md` and `AGENTS.md` among them — that `lint` compares with the current version and `upgrade` moves; a journal entry records a moment and is not live | [lib/mdwalk.js](../lib/mdwalk.js), `livePinFiles`, `stalePins`; [03 § Live-pin files](reference/03-lint.md#live-pin-files) |
```
<!-- /quote -->

<!-- quote:reference/02-cli.md -->
```text
- An uncommitted edit of a rules-pair file, of `ROLES.md` or of the journal `LOG.md` that would be redrawn — before the first write, with `--dry-run` too, the stamp untouched. The refusal for the journal has its own wording: its entries stay and only an edit of the header would be erased. The v0.12.0 migration refuses the same way on an uncommitted edit of `<docs>/ROADMAP.md` or `<docs>/README.md` that it would delete or edit — before the first write of the whole run, with `--dry-run` too. A pin move alone is not an edit (CRLF in a checkout under `core.autocrlf` included).
```
<!-- /quote -->

<!-- quote:reference/02-cli.md -->
```text
- A move to `minor` of a card whose Cost is `major` or `critical` without the hypothesis mark — a refusal for the whole call, before the first move, naming each card and its level and pointing to the hand edit `major (hypothesis)` or to `new … --minor --cost <level> --hypothesis`.
```
<!-- /quote -->

<!-- quote:../templates/en/agents-section.md -->
```text
7. **Commit.** Start the message with the task number: `{{prefix}}-N: <what was done>`. A task reaches the main branch as one commit, or as two in the attachment branch of step 5: review fixes are squashed into the acceptance commit of step 5, and so is the take commit when it took this task alone and `git rev-list <take>..HEAD` prints nothing: the `reset --soft` of step 5 goes to `<take>^`. Otherwise the take commit stays a commit of its own and the acceptance commit says so: the acceptance of one task never absorbs the take of another, and the `reset --soft` goes to `<head>`, main’s head immediately before the current integration, never to a take commit that took several tasks, which would replace the earlier acceptances above it and lose their drafts. After it, commit the changes of the triage review of step 6 as a separate commit with the subject `{{prefix}}: triage after {{prefix}}-N`, so task N's commit carries no other task's status moves. Nothing is squashed after the fold — a squash would discard the draft, the only storage of the task body. `{{cli}} lint` is green on the final commit; then push.
```
<!-- /quote -->

<!-- quote:reference/02-cli.md -->
```text
- A `ROLES.md` of the project's own — no render of either language and no "This file belongs to backslop" paragraph — before the first write, with `--dry-run` too, with git or without; the refusal names the file and asks to rename it and fix the links to it.
```
<!-- /quote -->

<!-- quote:reference/02-cli.md -->
```text
- Lays down the skeleton; the rules of a repeated run are in [01 § Re-run init](01-layout.md#re-run-init). An existing `docs/` file is not touched, nor are the rules pair and `ROLES.md` — `migrate` redraws them. An existing `ROLES.md` that is no render and lacks the "This file belongs to backslop" paragraph is kept, and `init` warns, naming the file and asking to rename it and run `init` again, which lays backslop's file; the block and the backlog README point at that path. The process ADR is `adr-001-process.md`, or the next free number in a project with ADRs of its own.
```
<!-- /quote -->

<!-- quote:reference/02-cli.md -->
```text
This page is for a person or a script that calls the CLI. It holds every command with its flags, behaviour, output and refusals. The contract for scripts, which names the output channels, the exit codes and the JSON shapes a caller may rely on, is [05. Orchestrator contract](05-orchestrator-contract.md).
```
<!-- /quote -->

<!-- quote:reference/02-cli.md -->
```text
- The acceptance procedure is four steps, one action each:
  1. Run `fold N > "$(git rev-parse --git-dir)/BACKSLOP_DRAFT"`. Expect the journal line in `<docs>/archive/LOG.md`, the task directory gone from the tree, and the draft in a file outside the working tree, because `git add -A` would otherwise take it into the task commit.
  2. Run `git add -A`. Expect the changes of the fold, the journal line and the removed directory, staged.
  3. Run `git reset --soft <base>`. Expect `HEAD` on `<base>` and the index still holding the whole change of the task.
  4. Run `git commit --cleanup=verbatim -F "$(git rev-parse --git-dir)/BACKSLOP_DRAFT"`. Expect one acceptance commit whose message is the draft, with the subject `<prefix>-N: <what was done>`; `--cleanup=verbatim` stops git from cleaning the message at all.
```
<!-- /quote -->

<!-- quote:reference/03-lint.md -->
```text
This page is for a person fixing a red `lint` and for a contributor adding a gate. Each row of the gate table says what the gate catches and how to fix it; the sections after the table cover the checks outside the gates, the warnings and the walk of the files. The recipe for a new gate is [06 § Recipe: add a lint gate](06-module-map.md#recipe-add-a-lint-gate).
```
<!-- /quote -->

<!-- quote:reference/06-module-map.md -->
```text
Where things live in the tool's own code, and the routine changes spelled out step by step: a command, a lint gate, a migration, a template placeholder. Start here when you change `bin/`, `lib/`, `scripts/` or the test helpers; behaviour as a user or an orchestrator sees it is on pages [01. Layout and formats](01-layout.md) to [05. Orchestrator contract](05-orchestrator-contract.md).
```
<!-- /quote -->

<!-- quote:reference/06-module-map.md -->
```text
**A human refusal is a `CliError`** (`lib/util.js`). A command throws it for anything the reader can fix: a bad flag, an unknown task number, a config that breaks a rule. The entry point prints `✖ <message>` on stderr and exits 1, with no stack trace. Any other exception is a crash: the stack goes to stderr and the exit code is 1 as well; a crash is a code error and is never thrown on purpose. The table of exit codes and output channels is in [05 § Exit codes](05-orchestrator-contract.md#exit-codes).
```
<!-- /quote -->

<!-- quote:reference/06-module-map.md -->
```text
- **Docs.** The `migrate` section of [02. CLI](02-cli.md) lists each migration and its refusal, and [01. Layout and formats](01-layout.md) describes the format. A format change that an orchestrator reads is a contract change, see [05 § Change the contract](05-orchestrator-contract.md#change-the-contract).
```
<!-- /quote -->

<!-- quote:reference/04-verification.md -->
```text
5. **Probe removal of dead code.**
   - a. Search for uses across `lib/`, `bin/`, `scripts/`, `test/`, `templates/` and `docs/`; record the search command and output. Mentions in backlog cards (`docs/backlog/`) and the archive (`docs/archive/`) quote the candidate and are not uses.
```
<!-- /quote -->

<!-- quote:reference/04-verification.md -->
```text
   - d. Rerun that suite.
   - e. Rerun `node bin/backslop.js lint`.
   - f. Record each exit code and every red test by name.
```
<!-- /quote -->

<!-- quote:reference/04-verification.md -->
```text
   - c. Run the suite.
   - d. Name all red tests.
```
<!-- /quote -->

<!-- quote:reference/04-verification.md -->
```text
   - h. Apply the same mutation.
   - i. Rerun the suite.
   - j. Name at least one other test that turns red.
```
<!-- /quote -->

<!-- quote:reference/04-verification.md -->
```text
6. **Probe deletion of a test.**
   - a. In a clone, run the unmutated suite as a baseline.
```
<!-- /quote -->

<!-- quote:reference/03-lint.md -->
```text
| 5 | Archive | A directory whose name does not match the pattern (a symlink to a directory inside the project is a task directory, a symlink leading out of the project is a stray file); a stray file in the archive — anything other than task directories, `README.md` and `LOG.md` (dot files are ignored); no `task.md` or `result.md`; a placeholder left in `result.md` — `[TODO` outside code, with code blocks and code spans blanked, so the placeholder form shown in code is an account of it and does not count, while the same form in prose does; a completed `result.md` that names no word of the outcome table ([01 § Archive](01-layout.md#archive)) — completed, rejected, merged into `<prefix>-N`, or a Russian form — in its first paragraph or heading: a bare closing word ("Closed" or its Russian form), "done" and the `Outcome:` marker are not an outcome, folding would read them as completed, and with no word at all it would write `—`. `fold N` refuses on the same two predicates; the outcome refusal carries the same message ([02. CLI](02-cli.md)). In a batch's `minor/` subdirectory, anything other than entry files `<prefix>-N[.k]-<slug>.md` (dot files are ignored); `docs/archive` or a batch's `minor/` that is a regular file — `<path>: a file, expected a directory` | complete the result — this is the approver's reminder; name the outcome with a table word in the first paragraph: `**Closed DATE.** Rejected: …`; only `archive N.k --into M` puts files into a batch's `minor/`; a file in place of a directory — remove or rename it and restore the directory |
```
<!-- /quote -->

<!-- quote:reference/03-lint.md -->
```text
| 13 | Closed-task journal | A line of `<docs>/archive/LOG.md` that looks like an entry (starts with `- <a id=`) but does not parse; a line whose anchor does not match its number; a link to `LOG.md#<anchor>` with no journal entry behind the anchor, in `docs/**` and root `*.md` (the gate 1 set, with its root symlinks and `.MD`) — the path resolves by the [link rule](#link-rule), and the anchor is everything after `#`, including after a `?query`; a line revision not reachable from `HEAD` (absent from `git rev-list HEAD`), through which `show N` cannot find the body. Gate 1 leaves the anchors of journal links in its own file set to this check, whose message names the missing entry and the line: incoming links of closed tasks point at the journal. The adapter pass checks journal anchors itself, since this check does not walk adapter outputs. The fourth catches a commit that a squash or rebase dropped after folding — before the push, when `lint` runs on the final acceptance commit as the procedure says; [02 § fold](02-cli.md#fold) says what leaves such a revision | fix the journal line to the form of [01 § Archive](01-layout.md#archive); point the link at an existing anchor — `backslop show N` shows the folded task's number; for an unreachable revision, bring the commit back into history or, when the body went into the acceptance commit message, replace the revision with `—`: `show N` finds the commit by its subject |
```
<!-- /quote -->

<!-- quote:reference/03-lint.md -->
```text
- **Adapter outputs** of every selected adapter: the output file is present, is a file, and is owned (carries the generated marker; a vendored skill's `LICENSE` stays verbatim and is owned through the marked `SOURCE.md` beside it, see [01 § Adapter ownership](01-layout.md#adapter-ownership)); its links pass the gate 1 rule — target, anchor and label — and do not point to a directory while their text names a task. A foreign file without the marker at an owned path is an error — `init` does not overwrite it; remove or rename the file and rerun `init`, or deselect the adapter. A directory at an owned path is an error, since `init` refuses on it. An output that is absent is an error too, unless git ignores that path in this working tree (see [Absent outputs and git](#absent-outputs-and-git)), or the output belongs to a vendored skill that `init` did not lay out because of a foreign `LICENSE` or `SOURCE.md` — the foreign file is the error then.
```
<!-- /quote -->

<!-- quote:reference/02-cli.md -->
```text
- Into `minor`: needs evidence — an Evidence section with text and without a placeholder, or `--evidence "…"` (one number only). A `task.md`-shaped card is reshaped: the Context, Work to do, Out of scope and Verification sections made only of placeholders are removed; in every other section but Evidence, a placeholder line by the gate 4 line rule ([03. Lint gates](03-lint.md)) is cut, while a table row with a written cell stays with its placeholder cells emptied. A Context with text and no Evidence becomes Evidence.
```
<!-- /quote -->

<!-- quote:reference/02-cli.md -->
```text
- **Do not commit between `archive N` and `fold N`** — except in the attachment branch below. A directory committed between them gives the line that commit as its revision, and a squash before the push drops it from history. A `fixup` onto the worker's commit discards the draft, and nothing is squashed after the fold. `lint` gate 13 catches a revision that is not in the history of `HEAD` ([03. Lint gates](03-lint.md)), so `lint` runs on the final commit, before the push.
```
<!-- /quote -->

<!-- quote:reference/02-cli.md -->
```text
- Behaviour: the tracker gates, gate 15 on project documentation included, the adapter checks and template parity — [03. Lint gates](03-lint.md). A status directory, `docs/backlog`, `archive/`, a batch's `minor/` or `adr/` that is a file is an error of gate 3, 5 or 8 with its path, not a crash.
```
<!-- /quote -->

<!-- quote:adr/adr-055-docs-rules-ship-to-projects.md -->
```text
- **Git hooks instead of agent hooks** — `core.hooksPath` is set per clone, it collides with husky and lefthook, and a git hook runs at commit, while the stop record that `init` writes into a harness's project hook file runs `hook stop`.
```
<!-- /quote -->

<!-- quote:adr/adr-055-docs-rules-ship-to-projects.md -->
```text
- Enabling `hooks` writes agent hooks into the project hook files of the harnesses, and its stop record runs `hook stop`, which runs `lint`, so a project turns it on knowingly.
```
<!-- /quote -->

<!-- quote:adr/adr-055-docs-rules-ship-to-projects.md -->
```text
- **A stop hook that fails on every `lint` error** — in a project that is red after an upgrade, `hook stop` would report an error on every run until its migration lands.
```
<!-- /quote -->

</details>
