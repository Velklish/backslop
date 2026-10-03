# 01. Layout and formats

This page is for a contributor or a maintainer who needs the exact layout and formats of a project that uses backslop. It covers what `init` lays down, the fields of `backslop.json`, the task, minor and archive files, the ADRs, the templates and the agent hook files. What each command does is on [02. CLI](02-cli.md), what each lint gate checks is on [03. Lint gates](03-lint.md), how a finding is verified is on [04. Finding verification protocol](04-verification.md), and what a caller may rely on is on [05. Orchestrator contract](05-orchestrator-contract.md).

## What init lays down

`init` lays down these paths in a project:

```
<project>/
  backslop.json                    config (the fields are in § backslop.json)
  AGENTS.md                        block between <!-- backslop:start --> and <!-- backslop:end -->
  .gitignore                       block between # backslop:start and # backslop:end; only with selected adapters
  .claude/settings.json  .cursor/hooks.json  .codex/hooks.json   agent hook records; only with selected hooks
  docs/README.md                   documentation index and the ADR table
  docs/GLOSSARY.md  docs/reference/README.md
  docs/ROLES.md                    who decides what: worker, approver, owner; owned by the tool, redrawn by migrate
  docs/adr/adr-001-process.md      process ADR: tasks and decisions are managed with backslop; in a project with ADRs of its own, the next free number
  docs/backlog/README.md           operating rules; no task list; owned by the tool, redrawn by migrate
  docs/backlog/{triage,queue,active,deferred,minor}/.gitkeep
  docs/archive/README.md  docs/archive/LOG.md   archive rules (owned by the tool) and the journal of closed tasks
```

The project name in headings is `name` from `package.json` without its npm scope, otherwise the directory name.

Adapters are laid down only when selected in `tools`:

| Adapter | Writes to |
|---|---|
| `claude` | `.claude/skills/backslop-*` and a `CLAUDE.md` stub (`@AGENTS.md`) when there was no such file |
| `cursor` | `.cursor/rules/backslop-*.mdc` and namespaced `references/`, plus `LICENSE` and `SOURCE.md` of a vendored skill |
| `codex` | `.agents/skills/backslop-*` |

Every selected adapter lays out the backslop skills (`backslop-task`, `backslop-batch`, `backslop-seed`, `backslop-writer`) and two vendored writing skills, for every `lang`:

| Skill | Vendored from | Laid out with |
|---|---|---|
| `backslop-humanizer` | `templates/vendor/humanizer/` | `SKILL.md`, `LICENSE`, `SOURCE.md` |
| `backslop-techdoc` | `templates/vendor/technical-documentation/` | `SKILL.md`, `references/*.md`, `LICENSE`, `SOURCE.md` |

A vendored skill is laid out under its frontmatter `name`, as upstream's text: nothing in it is rendered. For `cursor`, its `SKILL.md` becomes `.cursor/rules/<name>.mdc` with the upstream `description` and `alwaysApply: false`, and the other files sit in `.cursor/rules/<name>/` with rebased links, as for the process skills. `LICENSE` is written byte for byte, without the marker.

`backslop-writer` runs in three modes over project documentation. Release and batch-close modes check currency, and release mode also checks style; each returns a ledger. Audit mode runs under a task of its own and writes the upstream audit report (`Score`, `Shippable`, `Blocking`, `Findings`) for each audited document into the task result. It files every finding by severity: Blocking as a `critical` card, High as a `major` card, Medium and Low as `minor` entries, one per document and rule. Each record names the check the fix adds and where it lives: a test, a lint rule, or a `quote` block of gate 10 in a file that is neither the quoted one nor the record. A document with `Shippable: no` holds the release pass until its Blocking findings are closed: a card by `archive N.k`, a hypothesis entry by the batch that closes it. The audit changes no document, and `lint` computes no score.

When an adapter is selected, the managed block asks for the release mode before a release commit, in a sentence outside the numbered steps, so the `agents.stepOverrides` keys `"1"`–`"7"` keep their meaning. The `backslop-batch` skill runs the batch-close mode as the last step of a run, after every track is accepted and before the last push, as a task of its own: the ledger goes into that task's `result.md`, its commits carry the task prefix, and its findings are filed under it. Step 3 of the block requires a documentation fix to carry a check that fails on the old text, and the backlog README and the brief say the same.

An existing `CLAUDE.md` is kept; when it neither imports `@AGENTS.md` nor is a symlink to `AGENTS.md`, `init` prints the warning `CLAUDE.md has no “@AGENTS.md” import line — add it, the backslop block is in AGENTS.md`. Measured on 2026-10-02 with Claude Code 2.1.284, model `claude-sonnet-5-5`, headless `claude -p --setting-sources project` with tools disabled (`--tools ""`), on a fresh project, one run per condition: with `@AGENTS.md` in `CLAUDE.md` the model quoted a marker sentence of `AGENTS.md`, and in a control without that line it found no such sentence. With tools disabled this says nothing about whether an agent with tools reads `AGENTS.md` itself. The record is the Checks paragraph of the message of the commit that accepts this change. Deselecting `claude` removes `CLAUDE.md` only when its content is exactly the stub.

Owned outputs are a local generated result and do not belong in git. `init` keeps a block for them in `.gitignore` between `# backslop:start` and `# backslop:end`: one line `<adapter root>/backslop-*` per selected adapter, plus `/CLAUDE.md` when the file on disk is exactly the stub `init` writes rather than a user file. Other lines of the file are kept; only the content between the markers is replaced. A project with no selected adapters gets no `.gitignore`: there is nothing to generate, and `init` does not create the file where there was none. Deselecting every adapter leaves an empty block with an explanation.

### Adapter ownership

- The adapter registry holds one id and one root per adapter: `claude` → `.claude/skills`, `cursor` → `.cursor/rules`, `codex` → `.agents/skills`. The valid `tools` values, the output paths and the adapter-path test all derive from it; there is no second copy of the roots.
- A file is owned when it lies under an adapter root and carries the generated marker `<!-- backslop:generated -->` at the start of the file or right after its YAML frontmatter. A leading BOM does not hide the marker, and the marker may be the last line of the file without a line break. A quote of the marker in the body of a docs file is not ownership. Under an adapter root the marker counts at any path, not only at `backslop-*`.
- `init` rewrites the owned outputs of every selected adapter. An unmarked file at an adapter output path survives `init`: the selected adapter does not write over it, `init` reports it as foreign in a warning, and `lint` reports it as an error for a selected adapter.
- Removal uses the same predicate — the marker in the file, not a match with the current template. Removal candidates are marked files under the root and the paths the current templates produce; only an owned candidate is removed. So the owned outputs of an unselected adapter are removed unless its root has a symlink component (see [Symlinks and traversal](#symlinks-and-traversal)), and so are marked files of a selected adapter that no current template produces. An unmarked file at a template path survives and is named in a warning; an unmarked file at a path no template produces is not even a candidate.
- Removal is silent, as for any owned file: a committed one shows in `git status` (the `.gitignore` block does not hide it), an uncommitted one goes without a trace. Directories left empty are removed, up to and including the harness directory (`.claude`, `.cursor`, `.agents`).
- **A vendored `LICENSE`** carries no marker, because the licence text stays verbatim. It is owned through its skill directory: a `LICENSE` under an adapter root is owned when the `SOURCE.md` beside it carries the marker. `init` reads ownership of every output of an adapter before its first write and every removal candidate before its first removal, so writing or removing `SOURCE.md` never decides the fate of its `LICENSE` in the same run. A foreign `LICENSE` keeps its `SOURCE.md` unwritten, so a later `init` does not come to own it either; a foreign `SOURCE.md` keeps its `LICENSE` unwritten, because no marker could then own it. Either way the whole vendored skill is skipped for that adapter, so it never ships without its licence, and the warning names the adapter and the skill. A marked `SOURCE.md` and its `LICENSE` that no current vendored skill produces are removed together.
- `lint` reports an owned output or the Claude stub that is absent as an error, unless git ignores it in that working tree: a fresh `git worktree`, a fresh clone and a checkout with a deleted output have none of the ignored outputs and stay green, so run `init` after cloning; a `git archive` copy outside any repository has no git and stays red ([03 § Absent outputs and git](03-lint.md#absent-outputs-and-git)).
- `mv` and `archive` do not rewrite links inside owned outputs.

### Re-run init

- **Config.** `backslop.json` is created once. A `--dir`, `--prefix` or `--cli` flag that differs from it is refused: the value is changed in the config, not with a flag. `--lang`, `--tools` and `--hooks` on a repeated `init` change the config. A repeated run preserves `cli`, even on a machine with another installation; with hooks selected and `cli: "npx --no-install backslop"`, it refuses before writes if the project-root `package.json` no longer declares `devDependencies.backslop`. A config stamped with a newer version than the tool is refused: an older tool does not lay out a newer layout.
- **Docs.** `docs/` files are created only when missing; `init` does not touch existing ones. An existing process ADR (slug `process`, any number) counts as present. The operating rules and the archive rules are redrawn by `migrate` (see [The rules pair belongs to the tool](#the-rules-pair-belongs-to-the-tool)), never by `init`.
- **Adapters.** Selected adapter outputs are rewritten and deselected ones are cleaned, both by the ownership predicate of [Adapter ownership](#adapter-ownership).
- **Foreign files.** An unmarked file at an adapter output path stays and is named in a warning, both on removal and on write.
- **The AGENTS.md block.** The block is replaced between its markers, or appended at the end of the file when there are no markers. A marker counts only on a line of its own: a mention in prose is not a block. A marker that stands on its own line twice is refused, and so is a marker without its pair. `AGENTS.md`, and a `.gitignore` that `init` rewrites, are read only as UTF-8: a file in another encoding is refused before the first write.
- **Agent hooks.** The owned records of the selected `hooks` are rewritten in place, those of the other harnesses are removed, and a file whose content would not change is not written: see [Agent hook records](#agent-hook-records).
- **Stamp and pin.** The `version` stamp is moved to the tool version; the pin in `cli` is left alone, and a mismatch between them is named in a warning.
- **Subdirectory.** Running `init` in a subdirectory of an already initialized project is refused, and the refusal names the root.
- **Before the first write.** The config, adapter-root, docs-directory and managed-block checks run before anything is written. A refusal on an adapter output path (see [Symlinks and traversal](#symlinks-and-traversal)) comes on write, after the config and the docs skeleton are on disk; after the cause is removed, the same `init` completes. So does the refusal of a skill `description` the `cursor` adapter cannot read, in a template or a vendored `SKILL.md`: only a malformed skill in the tool itself triggers it.
- **The tool's own repository** keeps `tools: []`: a plain `init` there creates no harness files and does not dirty the tracked tree, and `init --tools` with an adapter is refused there.

### Symlinks and traversal

- **Selected adapter roots** (`.claude/skills`, `.cursor/rules`, `.agents/skills`, by the `tools` selection) are checked for symlinks before the first write. A symlink on any path component under the project root is refused, `.claude` itself included, wherever the link leads — inside the project or out. The refusal comes while neither the config nor the skeleton is on disk. The cure is a plain directory in place of the component, or deselecting the adapter: `--tools` without it, or `--tools none` when no other adapters are selected. A repeated `init` without `--tools` does not change the selection and does not cure it.
- **Unselected adapter roots** are not checked for symlinks, but they are cleaned: the owned outputs of an unselected adapter are removed when no path component up to its root is a symlink. A root with a link on any component, like a root that is not a directory, is skipped whole — backslop does not enter it, and a shared harness directory linked into a project without that adapter is a legitimate layout. Inside an unselected root that is being cleaned, a candidate behind a link or one that is not a file is skipped, without a refusal.
- **Markdown traversal** does not follow a link on a harness root either, on any of its components (`.claude` or `.claude/skills`): `mv` and `archive` neither read nor rewrite files behind it. The `lint` link gate walks `<docs>/**` and root `*.md` and does not touch harness directories.
- **Agent hook files.** The hook file of a selected harness (`<project>/.claude/settings.json`, `<project>/.cursor/hooks.json`, `<project>/.codex/hooks.json`) follows the rule of a selected adapter root: a symlink on any component of its path under the project root is refused before the first write, the file itself included. The hook file of an unselected harness behind such a link is skipped, and its records are not removed.
- **A directory on an output path.** A directory at an output path of a selected adapter, and a file on a component of that path, are refused in words on write (`owned adapter output is not a file`, `a file sits where the adapter output path needs a directory`): there is nowhere to write.
- **Status directories.** A status directory that is a symlink to a directory inside the project is read as a directory. One leading out of the project is not followed by the commands: the task scan skips it, and `status`, `show`, `brief`, `mv`, `archive` and `fold` print a warning naming it; `new` refuses while any status directory leads out, because the numbers behind the link are not seen, and `mv` refuses it as a destination. A link whose target is missing is judged by its text, with a symlinked prefix of the path resolved: a path inside the project is not out. `lint` gate 3 reports the link; gates 2 and 4 do not read behind it, and gate 6 reports no missing task number while the link leads out. A task directory of the archive that is such a link is treated the same way: the scan skips it, the same commands name it, `new` refuses, and `lint` gate 5 reports a stray file.

### The rules pair belongs to the tool

`<docs>/backlog/README.md`, `<docs>/archive/README.md` and `<docs>/ROLES.md` carry backslop's process text, not the project's; the name of the pair comes from the first two. The header of `<docs>/archive/LOG.md` — the text above its first entry line — is redrawn with them under the same rules: an entry line is data and is never touched, and a journal without an entry line is replaced by the template.

- **Below the tool version.** `migrate` redraws the three files and the journal header when the stamp is below the tool version or missing: it renders the template of the project language with `cli`, `prefix`, `docs` and the project name. A file that differs from the render, or is missing, is rewritten, and the output names its path; `--dry-run` prints the plan.
- **At the tool version** `migrate` redraws only untouched tool output: a file that differs from the render only by pins of the `cli` spec (or by its unpinned form), and a render of the other language after a `lang` change, up to the same pins and line endings. A file that matches no render stays until the next version update, and the output names it.
- **Safeguards before the first write.** An uncommitted edit of such a file (`git status --porcelain` is not empty) is refused with the file name; for `archive/LOG.md` the refusal says that the entries stay and only an edit of the header would be erased. A `ROLES.md` that is no render of either language and lacks the paragraph "This file belongs to backslop" is the project's own file: `migrate` refuses before the first write, with git or without, names the file and asks to rename it. A render of the other language, or a file that keeps the paragraph, is backslop's own and is redrawn. A path through a symlink on any component is skipped with a warning, so the write does not go through the link. A pin move alone is not an edit: a file that, after every pin of the `cli` spec is set to the `cli` pin, equals its `HEAD` version up to line endings is redrawn — that is how `upgrade` of earlier versions leaves it.
- **Without git** the redraw runs, and the output says there was nothing to check edits with. "Without git" means only a project outside a repository or a missing `git`; any other git failure refuses `migrate` with its cause before the first write.
- **Upgrade.** `upgrade` calls `migrate` of the new version, so every upgrade redraws the pair and `ROLES.md`, and a project from before `ROLES.md` gets the file laid. A committed local edit of them is lost on upgrade by design: the project keeps rules of its own outside them, for example in `AGENTS.md` outside the block. The paragraph "This file belongs to backslop…" in the templates themselves says so.
- **The rest of the skeleton** — `README.md`, `GLOSSARY.md`, `reference/README.md`, the process ADR, `archive/LOG.md` below its header — belongs to the project, and nothing redraws it. `ROLES.md` holds the role protocol the backlog README links to, and a new project gets it from `init`.

### ROADMAP.md is not part of the layout

`init` does not create `ROADMAP.md`. `migrate` at a stamp below 0.12.0 deletes the copy that earlier versions laid down, but only when both hold:

- the copy equals the earlier render of the project-language template, up to pins of the `cli` spec and line endings;
- no file that `lint` gate 1 checks (`<docs>/**` with the archive, and root `*.md`) links to it, in the form this same run leaves those files in. A link in code is not a link here, so after the deletion gate 1 has nothing to report about the file.

The same run takes the two lines of the earlier render that link the file out of `<docs>/README.md`: the table row is removed, and the third, introductory line is replaced with the current one; a line the project has edited stays. When the copy is already gone, only these lines are removed, and a warning names any links to it that remain. An edited copy, or a copy something still links to, stays as a project document, and a warning names it and every file that links to it; `<docs>/README.md` is then left alone. The safeguards are those of the rules pair: an uncommitted edit of a file to be deleted or edited is refused before the first write, except for a pin move alone; a path through a symlink is skipped with a warning; `--dry-run` prints the plan. The migration runs once, when the stamp crosses 0.12.0.

### Implementation notes

- The registry is [lib/adapters-registry.js](../../lib/adapters-registry.js). [lib/adapter-ownership.js](../../lib/adapter-ownership.js) holds `markGenerated`, which places the marker, and `isOwnedAdapterFile`, the one ownership predicate for writing, removal, `lint` and `repoMarkdown` ([lib/mdwalk.js](../../lib/mdwalk.js)). `repoMarkdown` leaves owned files out, which is why `mv` and `archive` do not rewrite their links.
- Contributor rule: a new skill template is owned through the marker. Add it under `templates/skills/` and `templates/en/skills/`; there is no path list and no `tools` inference to extend.
- The re-run rules and the pre-write phase live in [lib/init.js](../../lib/init.js); the adapter writes and removals in [lib/adapters.js](../../lib/adapters.js).
- The rules pair and `ROLES.md` are `RULES_DOCS` in [lib/migrate.js](../../lib/migrate.js); the earlier ROADMAP render and its two README lines are in [lib/legacy-roadmap.js](../../lib/legacy-roadmap.js), and the gate 1 file set is `linkGateFiles`.

## backslop.json

This table is the single owner of the field semantics. The Default column is the value read when the field is absent.

| Field | Default | Meaning |
|---|---|---|
| `prefix` | `BS` | task number prefix: 2–6 uppercase Latin letters or digits, starting with a letter; lands in the managed block (see [Values that land in the block](#values-that-land-in-the-block)) |
| `docs` | `docs` | documentation directory relative to the project root; lands in the managed block. The path must lie inside the project on every OS, so that one config reads the same everywhere: `\` splits a path like `/`; a `..` segment is refused (`../x`, `a\..\b`), while `..` inside a name is legal (`my..docs`); the absolute forms `/x`, `C:\x`, `C:/x` and `\\server\x` are refused, and so are an empty path and `.`. `init --dir` is checked by the same rule |
| `cli` | `npx github:Velklish/backslop#v<tool version>`; on a first `init --hooks` with `devDependencies.backslop`, `npx --no-install backslop` | how this project calls backslop; substituted into the skills and the `AGENTS.md` block, and lands in the managed block and selected hook records. The local form has no release pin and needs `source` for `upgrade`. The form `npx github:owner/repo#vX.Y.Z` carries a pin, and `upgrade` derives the release source from it. The form is accepted with a `.git` suffix and without the `v` before the version (`npx github:owner/repo.git#1.0.0`); `lint` checks a pin in live files in any of these forms, and `upgrade` moves it to the canonical `#vX.Y.Z` |
| `gates` | `["<cli> lint"]`, built from the project's `cli` | commands that must be green before hand-off; `backslop gates` runs them ([02. CLI](02-cli.md)), and the skills call exactly that. An entry is a non-empty command string (always run) or an object `{ "command": "<command>", "when": ["<glob>", …] }`: a scoped command runs only when the set of changed paths touches at least one pattern. `when` is a non-empty list of non-empty patterns; an empty one is refused, because the command would never run. A pattern matches the whole path from the project root (in a monorepo the project directory prefix is stripped, and a path outside the project leaves the set): `*` and `?` do not cross `/`, `**` does, and `**/` also matches the root. So a directory is written `docs/**`, not `docs`: a bare directory name matches no path, and the gate never runs |
| `probe` | none | the project's mutation-probe command: a non-empty string that lands in the managed block. Declared, it is named by step 4 of the `AGENTS.md` block, by the same step of the `backslop-task` skill and by the brief. Absent, the block, the brief and the `result.md` stub carry no probe text, step 4 of the `backslop-task` skill asks for a check by hand without naming a command (commit first, break the code, confirm that the new test fails), and `init` says so in a line of its output. There is no default: every repository has its own probe command, and an invented one is worse than none |
| `writer` | none | optional scope for the `backslop-writer` pass. It is an object with `style` and `currency` arrays of glob patterns relative to the project root. `writer.style` adds human-facing paths to the default writer scope for currency and style; `writer.currency` adds currency-only paths such as CLI help source, shipped skills and prompts. Unknown keys and non-string glob values are refused, and the refusal names the field. `init` does not write the object |
| `version` | none — `init` and `migrate` write the running tool version | stamp: which tool version made the layout, in the form `X.Y.Z`; `lint` and `upgrade` read it. An absent stamp is read as unknown: `lint` warns, and `upgrade` and `migrate` treat the project as unstamped (`migrate` counts it older than every migration) |
| `source` | none | where `upgrade` takes release tags from: a git URL or a path. A relative path is resolved from the project root, whatever directory the command runs in and whatever repository the project lies in. Without the field, the tags come from the GitHub form of `cli`; an npm pin gives no source |
| `lang` | none — `init` writes `ru` unless `--lang` says otherwise | language of new files and generated artifacts: `ru` or `en`. A config without the field is refused by every command that loads the config, `init` included; `help`, `version`, `changelog` and `merge-changelog` do not load it, and read the field only for their message language, taking an absent one as `ru`. To fix a refused config, add the field to `backslop.json` by hand — `init` reads the config first and cannot add it. The operating rules and the archive rules follow a `lang` change on the next `migrate`: an untouched render of the other language is redrawn in the new one, and a file that matches neither render stays until the next version update, and `migrate` names it |
| `tools` | none — `init` writes `[]` unless `--tools` says otherwise | selected adapters: a list of `claude`, `cursor`, `codex` without repeats; `[]` selects none. A config without the field is refused as one without `lang` is, and the field is added by hand |
| `hooks` | `[]` — `init` writes the field only when `--hooks` is given | harnesses whose project hook files carry backslop's agent hook records: a list of `claude`, `cursor`, `codex` without repeats, refused otherwise with a message that names the field; `[]` selects none. A repeated `init` without `--hooks` keeps the field. What `init` writes into those files is in [Agent hook records](#agent-hook-records) |
| `agents.stepOverrides` | none | `agents` is an object; its `stepOverrides` overrides steps of the `AGENTS.md` block. Keys are step numbers as strings, `"1"`…`"7"`; values are non-empty single-line text, without line breaks and without the `<` character. `init` replaces the text of that step inside the managed block and keeps its number, the other steps and the worker boundary. The value is substituted escaped: every CommonMark ASCII punctuation character (32 characters, `!` to `~`) gets a backslash, so the value stays text and never becomes markup — in particular, a link reference definition `[label]: /target`, whose scope is the whole document, does not open inside it. Brackets without a definition stay a legal value: escaping does not refuse them, it defuses them. An override of step 4 also replaces the probe sentence: the block stops naming the `probe` command while the `backslop-task` skill and the brief still name it, and `init` does not warn; for the block to name the command, write it into the override text |

The file is read as UTF-8; a leading BOM (U+FEFF — PowerShell 5 `Set-Content -Encoding UTF8` writes one, for example) is dropped on read. The commands that rewrite the config (`init`, `migrate`, `upgrade`) write it without a BOM.

The project root is the nearest directory with `backslop.json`, going up from the current one.

### Values that land in the block

The class is the fields whose value the template substitutes inside the managed block of `AGENTS.md`: `prefix`, `docs`, `cli` and `probe`. Their form there is one for all: no line breaks, no backtick, and no `backslop:start` or `backslop:end` marker. A second line would stand in the block as a separate paragraph, and a backtick would close the code span the template puts the value in. A marker would put a copy of a block boundary into the block text. A first `init` checks the assembled config by the rules every later command applies, before the first write: a `--dir` or `--cli` value that a later command would refuse never reaches the disk.

### Implementation notes

- One check covers every field of the class: `validateBlockValue` in [lib/config.js](../../lib/config.js). A separate copy of the bans per field survives the arrival of the next field and leaves that one open.
- `prefix` is not in its list: `PREFIX_RE` admits no marker, backtick or line break, so the call would be unreachable code. A check in `test/config.test.mjs` holds that condition: if the regex weakens, that test turns red, not someone's `AGENTS.md`. `<` is not banned: nothing closes a code span with it.
- `init` recognizes a block marker only on a line of its own (`readManaged` in [lib/init.js](../../lib/init.js)), and a block value has no line break, so the marker ban keeps copies of the boundary out of the block text rather than guarding the parse.
- The first `init` runs the assembled config through the same `validateConfig` as `loadConfig`. `loadConfig` builds the `gates` default from the project's `cli`, not from the default `cli`: a foreign command in the gates would be a defect.

## Task file

The name is `<prefix>-N-<slug>.md`, or `<prefix>-N.k-<slug>.md` for a finding; a slug is lowercase Latin letters, digits and hyphens between words. The directory is the status. Russian and English names of fields and sections are read together in one backlog; new files are written by the `lang` layer. The Russian names are `fieldNames` and `sectionNames` in [templates/i18n/ru.mjs](../../templates/i18n/ru.mjs), under the same keys. The English names:

```
# <prefix>-N · Title

- **Order:** 10                    only in queue/; an integer, step 10, lower comes first
- **Previous order:** 20           outside queue/; the rank the task had when it left the queue
- **Scope:** [section](../../reference/01-layout.md)
- **Created:** YYYY-MM-DD
- **Taken:** YYYY-MM-DD            set by mv … active
- **Dependencies:** none
- **Parent:** <prefix>-N.k         only on a finding created with `--parent N.M`; the child gets the next free `N.k`; always in `minor/`
- **Cost:** minor                  set in `minor/`, and on a task card by `new --parent N --cost critical|major`, a dash otherwise; kept as is when the entry leaves it: `critical`, `major` or `minor`; a hypothesis carries a mark, `major (hypothesis)`, with the Russian word in a `ru` project

## Context
## Work to do
## Out of scope
## Verification
## Deferred                         only in deferred/: Deferred, Reason, Return condition
```

- **Header fields.** A header field is a line `- **Name:** value` between the title and the first `## ` section. Field order is free; commands put Order first.
- **One occurrence.** Every known field, counting its RU and EN aliases, appears in a file once: reading and writing take the first occurrence in line order, a field write collapses the rest, and a field removal deletes them all.
- **Title.** The title on the first line names the same number as the file name.
- **Scope.** `new` gives a new task a link to `reference/README.md` with the path depth computed; in a project without that file the stub stays as text, `[TODO: reference/ section]`, because a broken link would fail gate 1. Whoever files the task picks the actual section. A triaged task's Scope is a filled link to a reference section: in `queue/`, `active/` and `deferred/`, an empty field and the `[TODO]` stub left by `new` fail `lint` (gate 4, [03. Lint gates](03-lint.md)); in `triage/` the field is not checked, since an entry there lies unsorted.
- **Previous order.** `mv` sets Previous order when a task leaves `queue/` and removes it when the task returns. Outside the queue there is no active Order, and `mv N queue --restore` ([02. CLI](02-cli.md)) needs the number the task left with. The fields are distinct: the gate that requires Order in `queue/` does not count a saved Previous order in its place.
- **Prefix choice.** A prefix that is an ordinary word (`API`, `RFC`, `HTTP`) gives false hits of the mentions gate on strings such as `API-2.0`: choose a prefix that does not occur in the project's texts.

### Numbers

- `new` gives the maximum over all status directories and the archive plus one; it refuses while a status directory is a symlink leading out of the project, whose numbers it cannot see ([Symlinks and traversal](#symlinks-and-traversal)); a finding's sub-id is the maximum `k` among the `N.*` files plus one. There is no counter in the files.
- The numbers taken in other worktrees of the repository (on disk, uncommitted ones included) and in every local branch count with those of the current tree. Numbers are seen for a project in a subdirectory of its repository and for a `docs` directory with a non-ASCII name too. When a foreign number that is not in the current tree moves your number, the command names its source; a number that is also in the current tree is not named as a source.
- A clone and a remote branch are not visible locally: `lint` catches a collision with them after the merge.
- **Simultaneous calls.** `new` runs the scan, the number, the Order renumbering of the neighbours and the card write under one lock, the file `backslop-new.lock` in the git common directory (`git rev-parse --git-common-dir`), so `new` calls started together in the worktrees of one repository get different numbers, a finding's sub-id included. A caller that finds the lock taken polls for 10 seconds, then counts again over what the holder wrote. If the lock is still taken it refuses, naming the file, and writes no card: run the command again, or delete the file when no backslop process is running. A lock older than 60 seconds is stale: the next `new` removes it and goes on. The lock covers one repository; a clone and a remote branch stay out of it. Without git there is no lock.
- Without git — no repository, or git not installed — the number is computed from the current tree. Any other git failure during this scan (a signal, a timeout, a launch error, another exit code) refuses `new` with git's cause and without a file: a number that could not be checked is not given out.

### Implementation notes

- Field writes are `setField` and `removeField` in [lib/tasks.js](../../lib/tasks.js): `setField` collapses repeated occurrences, and `removeField` removes every one.
- The lock is `withNumberingLock` in [lib/lock.js](../../lib/lock.js): the lock file is created with the `wx` flag and holds a random token. A stale lock is never removed: a caller claims that exact lock with a file `backslop-new.lock.claim-<hash of the lock content>-<n>`, re-reads the lock, and renames its own file over it, so the path is never free and a lock taken later is left alone; a claim older than 60 seconds is skipped for the next `<n>`. The holder removes the lock only while it still holds its own token. A file that cannot be created, written or replaced refuses with its path and the cause. `createTask` in [lib/tasks.js](../../lib/tasks.js) calls it around the whole allocation.
- The foreign-number scan is `foreignTaskIds` in [lib/tasks.js](../../lib/tasks.js): `git worktree list --porcelain` for other worktrees, and `git ls-tree -r -z --name-only <branch> -- <docs>/backlog <docs>/archive`, run from the project root, for local branches. The pathspec and the output paths are relative to that root, which is what makes the subdirectory and non-ASCII cases work.

## Minor file

- **Filing.** `new <slug> --parent N --minor --evidence "…"` puts a file from [templates/minor.md](../../templates/minor.md) into `minor/`: the title `# <id> · <title>`, the fields Scope, Created, Parent and Cost, and an Evidence section with the text of `--evidence`. A card filed by this command carries no `[TODO]` stubs: without evidence `new` refuses before creating the file.
- **Sections.** An entry filed by `new --minor` has no Work to do, Out of scope or Verification sections: it is an entry for a batch, not a task definition.
- **Scope** is empty: the approver fills it when cutting batches, and `lint` only warns about an empty or unfilled Scope in `minor/`.
- **Cost** defaults to `minor`; `--cost major|critical` is accepted only with `--hypothesis` and is written with the hypothesis mark.
- **Moving in.** The second door into `minor/`, `mv N.k minor`, needs the same: an Evidence section with text and without a stub, or the flag `--evidence "…"`; otherwise it refuses before the move. A `triage/` card built from `task.md` is reshaped without losing text: sections made only of stubs are removed, stub lines in sections with text are removed too, a Context with text and no Evidence becomes Evidence, and `--evidence` writes an `Evidence: …` line in place of the evidence stub. `mv N minor` of a card from another status adds `Cost: minor` when the field is missing and erases the Scope stub left by `new`.
- **Lint.** In `minor/`, `lint` requires the Evidence section: a missing or empty one, or one holding a stub, is a gate 4 error ([03. Lint gates](03-lint.md)).

## Archive

The archive holds two record forms, and they live side by side for as long as needed.

**Directory** — `docs/archive/<id>-<slug>/task.md`: the task definition as it was, with links rewritten for the new depth, and `result.md` from the template [templates/result.md](../../templates/result.md): closing date, outcome, what was done, how it was verified, which docs were updated. `archive N` lays it down so. While a `[TODO` stub remains in `result.md` outside code, `lint` is red; the stub form shown in a code span is not a stub ([03. Lint gates](03-lint.md)).

**Journal line** — `docs/archive/LOG.md`: a task looks like this after `fold N`. No directory stays in the tree, and the body goes into the message of the fold commit. The line form:

```
- <a id="<lowercase prefix>-N"></a>`<prefix>-N-slug` · YYYY-MM-DD · completed · `a1b2c3d4e5` · Task title
```

- **Order.** Lines are appended at the end of the journal: a single fold as one line, a bulk fold as a run of lines ordered by closing date — the dates that stand in the lines; equal dates go by number.
- **Fields**, left to right: the anchor (the number in lower case — incoming links point at it), the number with its slug, the closing date, the outcome, the commit and the title. The outcome is written in the `lang` form: `completed` for `en`, and for `ru` its Russian text from [templates/i18n/ru.mjs](../../templates/i18n/ru.mjs).
- **Title last.** The title stands last because it alone may contain the `·` separator; everything before it parses in one pass without backtracking.
- **Anchor.** The anchor is an explicit `<a id>`, not derived from the title: it must equal the number, and gate 13 checks that ([03. Lint gates](03-lint.md)).
- **Commit** is the revision the body is read from; `—` while the body is not in history. `show N` reads it, and gate 13 reports a revision that is not in the history of `HEAD` ([03. Lint gates](03-lint.md)).

### Closing date and outcome

The closing date and the outcome are read from two places of `result.md`: the first paragraph, where the template puts them, and the heading, as old archives closed.

- **Heading forms.** The heading is read in two forms: brackets `(<outcome> YYYY-MM-DD)` — `# <prefix>-N — result (rejected YYYY-MM-DD)` — and a colon after the dash, `— result: <outcome>` — `# <prefix>-N — result: rejected`. The word "result" is read in both languages. Only the brackets carry a date.
- **Paragraph over heading.** The first paragraph is stronger than the heading: the date is the first date of the paragraph, and without one, the date in the brackets; the outcome is the paragraph's word, and without one, the heading's word.
- **Nothing past the paragraph.** The file is not read past the first paragraph: "rejected" in the Verification section, or "result: rejected" under the first paragraph, is an account of the work, not an outcome.
- **No date.** When neither place has a date, the line gets the commit date of the body revision (`git log -1 --format=%cs <revision>`): the other dates in `result.md` are measurements and decisions, and they are not read as the closing. Only a line without a revision keeps the fold day; `fold --older-than` does not take such a record — its age is unknown.

### Outcome words

The words map onto three journal outcomes. Both language forms are always read; the `lang` form is written. The table gives the English words and says what the Russian forms add; the Russian forms themselves are `parserWords` in [templates/i18n/ru.mjs](../../templates/i18n/ru.mjs).

| Outcome in the line | Words in `result.md` |
|---|---|
| `merged into <number>` | "merged into"; in Russian also the feminine, neuter and plural participles and "by merging into". A date and markup may stand between the word and "into": `**Merged YYYY-MM-DD into** <prefix>-N`, `**merged** into <prefix>-N`. The project's number stands right after the form, with only whitespace and link or emphasis markup between them; without it this is not a merge: "merged into main", "merged into it", a number of another project. A negation before the form — "not merged into", or the Russian "not" before either Russian form — is not a merge either |
| `rejected` | "rejected"; in Russian the feminine, neuter and plural participles, "by rejection" and "taken off the plan". The Russian masculine participle is not read as an outcome: in archives it is always about an option ("the checking gate was rejected"), not about the task; the Russian "with a deviation", built on the same root, neither: "deviating from the task definition" is an account of the work. The bare Russian "removed" counts only as the first word of the paragraph or of the heading outcome: in Russian, "Removed: YYYY-MM-DD. Moot" is an outcome, and "the stub was removed" in the middle of prose is an account |
| `completed` | "completed" and its Russian participle. A bare "closed" or "done" (and the Russian "closed"), and the marker "Outcome:" in either language (the word with a colon right after it), count only when neither the paragraph nor the heading named an outcome with the words of the `merged into <number>` or `rejected` row: the template opens the paragraph with `**Closed DATE.**`, in Russian in the `ru` layer, and in old archives that is the only outcome word. "**Outcome: both forms are understood.**" is completed; so is a marker with a word outside the table, or with the Russian "removed" not as the first word of the paragraph, like "Refusal: moot": "**Outcome: removed** together with its subject". "Outcome: rejected" is rejected, by the word. "Outcome" without a colon and "Outcome — …" with a dash are not the marker |

- **Position first.** Within one place, position decides and then the table: the outcome is the table word that stands first in the place, and the row order of the table decides only at equal positions. So a leading word beats the prose: "Merged into <prefix>-N. Completed there" is a merge, "Completed. … was tried and rejected" is completed.
- **Whole words.** Words match whole, not as part of another word: "abandoned" does not carry "done", "disclosed" does not carry "closed", and the Russian "a deviation" does not carry the Russian "rejected" that shares its root.
- **No outcome.** The field holds `—` only when neither the paragraph nor the heading carries a table word, a bare "closed" or the "Outcome:" marker: the command does not invent an outcome `result.md` did not name.
- **Name a non-completed outcome with a table word.** "**Closed YYYY-MM-DD.** Refusal: moot" is the template's bare "Closed" and gives `completed`, while "**Closed YYYY-MM-DD.** Rejected: moot" gives `rejected`. `lint` gate 5 on an unfolded directory ([03. Lint gates](03-lint.md)) and `fold N` by a refusal before any write ([02. CLI](02-cli.md)) hold this requirement: the first paragraph or the heading of `result.md` must carry a table word. A bare "Closed" or "done" and the "Outcome:" marker, in either language, without a table word do not pass, and the template stub states the requirement. The fallback to the bare word and the marker remains for the bulk fold of old records closed before the gate; `result.md` has no separate Outcome field.
- **Batches.** A record closed by a batch gets the outcome `batch <M>`, in the `lang` form: the command builds it rather than reading it, and it reads it back by that form — `status` counts closed tasks in the archive, not batch entries.

These forms are read by the table, not by intent:

- "**Closed by refusal YYYY-MM-DD** by the owner's decision" — `completed`: "refusal" is not a table word, as in the "Refusal: moot" example of **Name a non-completed outcome with a table word**;
- "**Closed YYYY-MM-DD. Closed by a boundary, not completed.**" — `completed`: a negation is cut off only before a merge;
- "**Closed:** YYYY-MM-DD. Outcome — removed together with its subject", in Russian — `completed`: the bare Russian "removed" is read only as the first word, and "Outcome —" with a dash is not the marker;
- "**Closed.** Duplicate: the same subject is queued as <number>" — `completed`: a duplicate without "merged into" or "by merging into" is not a merge;
- "**Closed on a recorded decision, and the rejected option is recorded with it.**" — `rejected`: a table word decides by position, whatever it is about — a rejected option or a neighbouring task, as in the Russian "<number> taken off the plan".

The honest move for such records is a table word in the first paragraph: "Rejected: …", "Merged into <number>", "Completed; the rejected option is recorded below".

- New records are held to it by `lint` gate 5 and `fold N` (see **Name a non-completed outcome with a table word**); journals that are already folded are fixed by hand.
- The requirement does not close all five forms: a negation ("not completed") and a word about someone else's option or task carry a table word, gate 5 and `fold N` pass them, and in new records they are read by the first word too.

### Fold and show

The command behaviour of `fold` and `show` — revision choice, the per-file blob check, the causes of a missing revision, gitignored files, CRLF, the message draft, the squash warning and the `show N` lookup — is described in [02 § fold](02-cli.md#fold) and [§ show](02-cli.md#show).

### Closed numbers, findings and batches

- **Closed numbers** are read from both record forms: archive `<id>-<slug>/` directories and journal lines, in the current tree, in other worktrees and in the trees of local branches. A folded task has no file names at all, and without reading the journal of a neighbouring branch its number would be given out a second time.
- **Docs in the same pass.** `archive` prints the mechanical half of the "Docs in the same pass" line: the files under `<docs>/` and `CHANGELOG.md` touched by the commits of the `--range` range and by the commits with the task number in the subject (`<prefix>-N: …`); paths are from the project root, and a merge commit counts by what the merge itself changed. The list is only printed — what goes into `result.md` is the approver's call; Outcome and Verification are not filled in at all, since they are the approver's judgement of the task.
- **Findings.** Closing a task does not close its findings: a finding `N.k` left in `triage/` after task `N` moved to the archive makes `lint` warn (gate 9, [03. Lint gates](03-lint.md)).
- **Batches.** An entry from `minor/` is closed by a batch: `archive N.k --into M` puts its file into `docs/archive/<M>-<slug>/minor/` as is, without a `result.md` of its own; the outcome for the entries is a line in the batch's `result.md`. Such entries stay known to `lint` and to numbering: a mention of `N.k` is green, the next finding under `N` gets the next free number, and `status` does not count them in the archive total — that counts closed tasks.

### Implementation notes

- Both record forms are read by `scanTasks` and `foreignTaskIds` in [lib/tasks.js](../../lib/tasks.js). The outcome parser is `outcomeFromResult` in [lib/log.js](../../lib/log.js); word boundaries are by letter rather than `\b`, because in JavaScript `\b` is ASCII-only and does not exist after a Cyrillic letter.

## ADR

- **File.** `docs/adr/adr-NNN-<slug>.md`, the number padded to three digits. `adr` gives the maximum number in the local `docs/adr/` plus one. The number is not protected across worktrees or branches: `adr` reads only the local tree, and only `new` checks other worktrees and branches.
- **Template.** [templates/adr.md](../../templates/adr.md): Status, Date, Deciders, Context, Options, Decision, Consequences. A new ADR starts as `Proposed`.
- **Status.** `Proposed` or `Accepted`, on a `**Status:**` line; `lint` fails on another word, on a missing line and on a status line that names another ADR (gate 8, [03 § ADR status line](03-lint.md#adr-status-line)).
- **Index.** Every ADR is linked from `docs/README.md`, as a row of its table by convention; at most one table row links it, and that row's Status cell is the status word of the file. `lint` fails without the link, on a second row, on a differing cell and on a `[TODO]` placeholder line left in the file (gate 8, [03 § ADR status line](03-lint.md#adr-status-line)).
- **Current decisions only.** A new decision on a question already decided rewrites that question's ADR in place: same number, the rationale that still holds, the consequences of the change. An ADR that no longer governs anything is deleted, and git keeps its history; a chain of ADRs on one question is folded into its highest number. The `backslop-task` skill says how to fold a chain and repoint its links. The principle is the first item of the index template; `migrate` does not redraw a project's `docs/README.md`.

## Templates

Everything the tool writes from a template lives in [templates/](../../templates/). The English layer `templates/en/` is the source, and `templates/` holds its Russian twins. `templates/vendor/` is outside both layers: third-party skills, copied verbatim, one directory each with its upstream files, `LICENSE` and `SOURCE.md`. One file of `templates/` is not a project template: [templates/i18n/ru.mjs](../../templates/i18n/ru.mjs) is the CLI's Russian localization — the Russian text of every message keyed by its English text, the Russian help and the Russian words the parsers read. `init`, `migrate` and `upgrade` never copy it into a project, since they render only `docs/**`, `skills/**`, the vendored skills of `vendor/**` and named files, and parity compares only `.md` files, so it has no English twin under `templates/en/`; the package ships it with `templates/`. Keys are what the caller passes; a group shares one key set, and each file of the group uses part of it. The last column is what code reads back from the rendered text: a template edit keeps those strings.

| Template | Rendered by | Code | Keys | Strings code reads |
|---|---|---|---|---|
| `agents-section.md` — the `AGENTS.md` block | `init` | [lib/init.js](../../lib/init.js) | docs/skills group: `adrNumber`, `cli`, `date`, `docs`, `hooksRule`, `prefix`, `probeBreakage`, `probeManual`, `probeRule`, `probeSecond`, `probeVerified`, `project` | the `<!-- backslop:start -->` and `<!-- backslop:end -->` markers; the step lines `1.`–`7.`, which `agents.stepOverrides` replaces by number; the `Worker boundaries:` line that closes step 7, in the Russian layer its `workerBoundaries` form from [templates/i18n/ru.mjs](../../templates/i18n/ru.mjs) |
| `agents-hooks.md` — the hook sentence of the block | `init`, only when `hooks` is not empty | [lib/init.js](../../lib/init.js) | none; `init` places its text in the `{{hooksRule}}` slot of `agents-section.md` | none |
| `agents-probe.md` — the probe sentence, rendered only with `probe` | `init` (the block and the skills), `brief` | [lib/templates.js](../../lib/templates.js) | `probe` | the code span around `{{probe}}`: the form of the `probe` field rests on it |
| `probe/*.md` — the probe passages; `manual.md` is the command-free sentence of the skill, rendered only without `probe` | `init` (the skills), `brief`, `archive` | [lib/templates.js](../../lib/templates.js) | `bullet.md`: `probeRule`; the others none | none |
| `task.md` | `new`, `seed --queue-reference` | [lib/tasks.js](../../lib/tasks.js), [lib/seed.js](../../lib/seed.js) | `area`, `context`, `cost`, `date`, `id`, `title` | the title line `# <id> · <title>` with its ` · ` separator, read by `lint`, `fold`, `brief`, `status` and `show`; the header field labels and the `## ` headings ([Task file](#task-file)); the `[TODO]` stubs, which `lint` and `mv N minor` recognise |
| `minor.md` | `new --minor`; `mv N minor` reshapes a `task.md` card into the same fields and Evidence section | [lib/tasks.js](../../lib/tasks.js), [lib/mv.js](../../lib/mv.js) | `area`, `context`, `cost`, `date`, `id`, `parent`, `title` | the title line `# <id> · <title>` with its ` · ` separator ([Task file](#task-file)), read as in `task.md`; the header field labels and the Evidence heading ([Minor file](#minor-file)) |
| `result.md` | `archive` | [lib/archive.js](../../lib/archive.js) | `cli`, `date`, `id`, `prefix`, `probeVerified` | the first paragraph: the closing date and the outcome words ([Outcome words](#outcome-words)), read by `lint` and `fold`; the `[TODO` stub, which both refuse |
| `adr.md` | `adr` | [lib/adr.js](../../lib/adr.js) | `date`, `number`, `title` | none |
| `brief.md` | `brief` | [lib/brief.js](../../lib/brief.js) | `autonomy`, `cli`, `entry`, `gates`, `handover`, `measurements`, `neighbours`, `prefix`, `probeBullet`, `probeResult`, `tasks`, `track` | none: the brief goes to stdout |
| `docs/**` — the documentation skeleton | `init`; `migrate` redraws `backlog/README.md`, `archive/README.md`, `ROLES.md` and the header of `archive/LOG.md`; `fold` and `migrate` write `archive/LOG.md` when it is missing | [lib/init.js](../../lib/init.js), [lib/migrate.js](../../lib/migrate.js), [lib/fold.js](../../lib/fold.js) | docs/skills group | `backlog/README.md`, `archive/README.md` and `ROLES.md` whole: they belong to the tool, `migrate` compares them with their render, and in this repository they are a 1:1 render, as is the `archive/LOG.md` header above its first journal line; the ADR rows of `README.md` as links (gate 8, [03. Lint gates](03-lint.md)); the first link of each row of `reference/README.md`, read by `seed --queue-reference` |
| `skills/**` | the adapters, on `init` | [lib/adapters.js](../../lib/adapters.js) | docs/skills group | frontmatter `name` and `description`; the `cursor` adapter writes `description` into its rule file |
| `vendor/*/**` — third-party skills | the adapters, on `init`, without rendering | [lib/adapters.js](../../lib/adapters.js) | none: `{{…}}` is not substituted | frontmatter `name`, the laid-out directory; `description`, which the `cursor` adapter reads as a JSON string, a YAML single-quoted scalar or a `\|` block |

Rules:

- **Placeholders** are written `{{name}}`. A placeholder without a key from the caller is a render-time error naming the template and the key; nothing is left in the text. `lint` gate 12 checks placeholders against the declared keys of each template group, both ways and in both language layers ([03. Lint gates](03-lint.md)).
- **Source layer.** `templates/en/` is the source; a Russian twin in `templates/` has the same file, the same placeholders, the same skill frontmatter contract (`name` equals the directory name, `description` is not empty) and the same sequence of heading levels outside fenced code blocks — not merely the same count of headings — and the English layer has no Cyrillic. `lint` in the tool's repository fails on a mismatch ([03. Lint gates](03-lint.md)). It names a missing Russian twin of an English file and a Russian file without an English source; on a placeholder or heading mismatch it names the Russian file and prints the English value as the expected one.
- **Names the parser reads.** The `## ` headings and the `- **Label:**` fields of `task.md` and `minor.md` equal the names in [Task file](#task-file) and [Minor file](#minor-file) for the language of their layer. Parity compares heading levels, not text: a renamed heading passes it, and `brief` and `mv` stop finding the section. `npm test` holds these names.
- **The probe text** lives in its own templates, so the rule text stays in `templates/` and not in code: the sentence with the command in `agents-probe.md`, the other passages in `probe/*.md`. `probeSlots` in [lib/templates.js](../../lib/templates.js) renders each into its slot, and every slot is the empty string unless the config declares `probe`, except `probeManual` (`probe/manual.md`), which is empty with it. `{{probeRule}}` carries the sentence into step 4 of the managed block and of the `backslop-task` skill; the other slots are `probeBreakage`, `probeSecond` and `probeVerified` in the skill (and `probeManual`, the command-free sentence that step 4 of the skill carries without `probe`), `probeBullet` and `probeResult` in the brief, and `probeVerified` in the `result.md` stub. The full list of places is in the probe-command ADR.
- **Skill descriptions.** The `description` value in skill frontmatter stands in double quotes: a plain scalar with ": " inside does not parse as a YAML mapping, and the consumer's frontmatter gate would fail on every `init`. So `description: ""` is an empty value for parity, and an unclosed quote is a parity error and, for the `cursor` adapter, an `init` refusal naming the template. `npm test` holds the YAML-mapping form, not parity.
- **Adapter outputs** are marked and owned as [Adapter ownership](#adapter-ownership) says.
- **Vendored skills.** `templates/vendor/` has no language: parity, gate 12 and `TEMPLATE_KEYS` skip it, and the skill frontmatter test does too, because upstream's frontmatter is not in the YAML-mapping form that **Skill descriptions** sets. Its `SOURCE.md` names the upstream URL, the full commit sha, the copy date, the upstream path, the modifications, and the sha256 of each upstream file. `npm test` holds it: every directory has `LICENSE` and such a `SOURCE.md`, and every file not listed as modified matches its recorded sha256. A new vendored skill needs no change in `lib/` when its frontmatter `description` is a one-line plain scalar, a one-line double- or single-quoted string, or a `|` block: these are the forms the `cursor` adapter decodes, and only for vendored skills; the form is read from the raw line, so a double-quoted string is decoded once. A ` # comment` after the value is not read as a comment and stays in the text. `init` with `cursor` selected refuses any other form (`>`, `|-`, `|2`, an unclosed quote, a scalar continued on an indented next line) and names the file. Its `name` must start with `backslop-`, or the `.gitignore` block does not cover it.

### Implementation notes

- The keys of each group are `TEMPLATE_KEYS` in [lib/templates.js](../../lib/templates.js); `renderTemplate` throws on a placeholder without a key; gate 12 is `templateSlots`, and the layer comparison is `templateParity`, which walks the English layer and compares heading levels as a sequence after blanking fenced blocks. `test/templates.test.mjs` holds the 1:1 render of the rules pair in this repository, and the `archive/LOG.md` header above its first journal line, in the layer of `backslop.json` `lang`.
- The names test in `test/templates.test.mjs` renders `task.md` and `minor.md` in both layers and checks the title line, each heading and each field label through the task parser: `readTitle`, `sections`, `sectionName`, `fieldName` and `getField` in [lib/tasks.js](../../lib/tasks.js). The English field and section names are `FIELD_NAMES` and `SECTION_NAMES` there, and the Russian ones `fieldNames` and `sectionNames` in [templates/i18n/ru.mjs](../../templates/i18n/ru.mjs); the outcome words are `OUTCOME_FORMS` in [lib/log.js](../../lib/log.js), built with the Russian `parserWords` of the same module; the step and boundary lines are `STEP_RE` and `WORKER_BOUNDARY_RE` in [lib/init.js](../../lib/init.js).
- `frontmatterField` ([lib/frontmatter.js](../../lib/frontmatter.js)) strips the quotes, and both readers use it: `splitFrontmatter` for `.mdc` and parity. `cursorOutput` quotes the value again (`JSON.stringify`), and without the stripping the `.mdc` would carry double escaping. `frontmatterField` reads line by line and is blind to the YAML-mapping defect, which is why `npm test` holds that form.

## Agent hook records

For each harness in `hooks`, `init` writes one record per event into its project file:

| Harness | File | Start record | Stop record |
|---|---|---|---|
| `claude` | `<project>/.claude/settings.json` | `SessionStart` group running `<cli> hook session-start --harness claude` | `Stop` group running `<cli> hook stop --harness claude` |
| `cursor` | `<project>/.cursor/hooks.json` | `sessionStart` entry running `<cli> hook session-start --harness cursor` | `stop` entry running `<cli> hook stop --harness cursor` |
| `codex` | `<project>/.codex/hooks.json` | `SessionStart` group running `<cli> hook session-start --harness codex` | `Stop` group running `<cli> hook stop --harness codex` |

`init` writes a `claude` or `codex` file in the shape `{"hooks": {"Stop": [{"hooks": [{"type": "command", "command": …}]}]}}` and a `cursor` file in the shape `{"version": 1, "hooks": {"stop": [{"command": …}]}}`.

The files are shared: they may hold the team's own settings and hooks and the records of other tools. So backslop owns its records, not the file, and JSON has no place for the generated marker.

On a first `init --hooks` without `--cli`, an own `devDependencies.backslop` entry in the project-root `package.json` selects `npx --no-install backslop` as the whole `cli`; otherwise the pinned GitHub npx default stays. `init` does not inspect `PATH`, so a global install on one machine cannot change these committed files. The declared dependency and the command travel to a second machine in the committed files. On a fresh checkout without `npm install`, `init` warns and the local hook command fails until the dependency is installed. Without the declaration, a fresh checkout has no local backslop installation from `package.json`, and the local hook command fails there too. Removing the declaration makes a repeated `init` with hooks refuse before writes; removing the installation can make the local hook command fail, while `lint` stays independent of machine availability.

- **Ownership.** A record is owned when its command ends in `hook session-start --harness <id>` or `hook stop --harness <id>`, where `<id>` is the harness of the file, and the `cli` before it either names backslop or equals the project's `cli`. The first covers a pin that `upgrade` moved; the second covers a `cli` without the name, such as a wrapper script. Known limit: when `cli` changes from one such wrapper to another, neither naming backslop, the old records become foreign, and they are removed by hand. A `claude` or `codex` record is an entry of a group's `hooks` list; a `cursor` record is an entry of the event list.
- **Writing.** A missing file and its missing parent directory are created; a new `cursor` file starts with `"version": 1`. An existing file is merged into: every foreign key, group and record stays, in its order. The first owned record of an event is rewritten in place with the project's `cli`, so an `upgrade` that moves the pin rewrites the records instead of adding new ones; a further owned record is removed, and an event without one gets a new record at the end of its list. The file is written whole as JSON in a standard layout, with the indent of its first indented line and its line endings, and with a final newline only if it had one; a new file gets two spaces. A hand-formatted file therefore changes layout on the first write: an array kept on one line is spread over several, and the content stays the same. A file whose content would not change is not written, so a repeated `init` writes no byte.
- **Removal.** The owned records of a harness that is not in `hooks` are removed. A group, an event list and the `hooks` object that this removal leaves empty go with them; an empty one that was there before stays. The file is removed when nothing else is left in it — for `cursor`, a lone `"version": 1` counts as nothing — and so is its directory when it is left empty.
- **Before the first write.** The file of a selected harness is refused, with its name, when it is not valid JSON, its top level is not an object, its `hooks` is not an object, or one of its two event values is not a list; also when it is not a file, when a file sits on its directory path, and when its path has a symlink ([Symlinks and traversal](#symlinks-and-traversal)). The file of an unselected harness in any of these states is skipped.
- **lint.** For a selected harness, a missing start or stop record and an owned record with another `cli` are errors that say to run `init`. So is any other content that `init` would rewrite, such as a duplicate or a record under the wrong event, and an owned record in the file of a harness that `hooks` does not select. `lint` reads that file through a symlink too, and says that `init` does not remove records through a link ([03 § Checks outside the fifteen gates](03-lint.md#checks-outside-the-fifteen-gates)).
- **Files in the home directory** (`~/.claude`, `~/.cursor`, `~/.codex`) are never written; `lint` reads one only when a project path links to it, and then only reports records — removing them is left to you.

### Session records

`hook session-start` writes one file per harness and session, `<harness>-<session id>.json`, in `backslop/hooks/` under the git directory of the working tree (`git rev-parse --git-dir`): `.git/backslop/hooks/` in a checkout, `.git/worktrees/<name>/backslop/hooks/` in a linked worktree. In the name, every character of the id outside ASCII letters, digits, `.`, `_` and `-` becomes `_`, and the id is cut at 128 characters; two ids that differ only in such characters, or after the 128th, share one record. Git never tracks the git directory, so the record is neither tracked nor untracked, and each worktree has its own.

A record has this form:

```json
{
  "harness": "claude",
  "session": "17d92a35-7a8c-4f4a-bfea-07150a742ad5",
  "start": "189fc44…",
  "time": "2026-10-02T08:44:09.000Z",
  "returns": { "count": 1 }
}
```

`start` is the commit the changed set is measured from: `HEAD` at the first `session-start` for the harness and session id, or the empty tree in a repository without a commit; a repeated start for the same harness and id keeps it. `returns` is written by `hook stop` while it reports errors: `count` is the number of reports in a row, whatever the errors were; a clean stop sets it to `null`, and a new `session-start` for the session drops it. A record that is not JSON or has no 40- to 64-digit `start` is read as missing, and the start is then `HEAD`. Nothing deletes the records: a session leaves a few hundred bytes. The behaviour is in [02 § hook](02-cli.md#hook).
