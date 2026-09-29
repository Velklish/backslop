# 01. Layout and formats

## What init lays down

```
<project>/
  backslop.json                    config (fields: see the table below)
  AGENTS.md                        block between <!-- backslop:start --> and <!-- backslop:end -->
  .gitignore                       block between # backslop:start and # backslop:end; only with selected adapters
  docs/README.md                   documentation index and the ADR table
  docs/GLOSSARY.md  docs/reference/README.md
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
| `cursor` | `.cursor/rules/backslop-*.mdc` and namespaced `references/` |
| `codex` | `.agents/skills/backslop-*` |

An existing `CLAUDE.md` is kept; when it neither imports `@AGENTS.md` nor is a symlink to `AGENTS.md`, `init` warns that Claude Code will not see the block. Deselecting `claude` removes `CLAUDE.md` only when its content is exactly the stub.

Owned outputs are a local generated result and do not belong in git. `init` keeps a block for them in `.gitignore` between `# backslop:start` and `# backslop:end`: one line `<adapter root>/backslop-*` per selected adapter, plus `/CLAUDE.md` when the file on disk is exactly our stub rather than a user file. Other lines of the file are kept; only the content between the markers is replaced. A project with no selected adapters gets no `.gitignore`: there is nothing to generate, and `init` does not create the file where there was none. Deselecting every adapter leaves an empty block with an explanation.

### Adapter ownership

- The adapter registry holds one id and one root per adapter: `claude` → `.claude/skills`, `cursor` → `.cursor/rules`, `codex` → `.agents/skills`. The valid `tools` values, the output paths and the adapter-path test all derive from it; there is no second copy of the roots.
- A file is owned when it lies under an adapter root and carries the generated marker `<!-- backslop:generated -->` at the start of the file or right after its YAML frontmatter. A leading BOM does not hide the marker, and the marker may be the last line of the file without a line break. A quote of the marker in the body of a docs file is not ownership. Under an adapter root the marker counts at any path, not only at `backslop-*`.
- `init` rewrites the owned outputs of every selected adapter. An unmarked file at an adapter output path survives `init`: the selected adapter does not write over it, `init` reports it as foreign in a warning, and `lint` reports it as an error for a selected adapter.
- Removal uses the same predicate — the marker in the file, not a match with the current template. Removal candidates are marked files under the root and the paths the current templates produce; only an owned candidate is removed. So the owned outputs of an unselected adapter are removed unless its root has a symlink component (see [Symlinks and traversal](#symlinks-and-traversal)), and so are marked files of a selected adapter that no current template produces. An unmarked file at a template path survives and is named in a warning; an unmarked file at a path no template produces is not even a candidate.
- Removal is silent, as for any owned file: a committed one shows in `git status` (the `.gitignore` block does not hide it), an uncommitted one goes without a trace. Directories left empty are removed, up to and including the harness directory (`.claude`, `.cursor`, `.agents`).
- `mv` and `archive` do not rewrite links inside owned outputs.

### Re-running init

- **Config.** `backslop.json` is created once. A `--dir`, `--prefix` or `--cli` flag that differs from it is refused: the value is changed in the config, not with a flag. `--lang` and `--tools` on a repeated `init` change the config. A config stamped with a newer version than the tool is refused: an older tool does not lay out a newer layout.
- **Docs.** `docs/` files are created only when missing; `init` does not touch existing ones. An existing process ADR (slug `process`, any number) counts as present. The operating rules and the archive rules are redrawn by `migrate` (see [The rules pair belongs to the tool](#the-rules-pair-belongs-to-the-tool)), never by `init`.
- **Adapters.** Selected adapter outputs are rewritten and deselected ones are cleaned, both by the ownership predicate of [Adapter ownership](#adapter-ownership).
- **Foreign files.** An unmarked file at an adapter output path stays and is named in a warning, both on removal and on write.
- **The AGENTS.md block.** The block is replaced between its markers, or appended at the end of the file when there are no markers. A marker counts only on a line of its own: a mention in prose is not a block. A marker that stands on its own line twice is refused, and so is a marker without its pair. `AGENTS.md`, and a `.gitignore` that `init` will rewrite, are read only as UTF-8: a file in another encoding is refused before the first write.
- **Stamp and pin.** The `version` stamp is moved to the tool version; the pin in `cli` is left alone, and a mismatch between them is named in a warning.
- **Subdirectory.** Running `init` in a subdirectory of an already initialized project is refused, and the refusal names the root.
- **Before the first write.** The config, adapter-root, docs-directory and managed-block checks run before anything is written. A refusal on an adapter output path (see [Symlinks and traversal](#symlinks-and-traversal)) comes on write, after the config and the docs skeleton are on disk; once the cause is removed, the same `init` completes.
- **The tool's own repository** keeps `tools: []`: a plain `init` there creates no harness files and does not dirty the tracked tree, and `init --tools` with an adapter is refused there.

### Symlinks and traversal

- **Selected adapter roots** (`.claude/skills`, `.cursor/rules`, `.agents/skills`, by the `tools` selection) are checked for symlinks before the first write. A symlink on any path component under the project root is refused, `.claude` itself included, wherever the link leads — inside the project or out. The refusal comes while neither the config nor the skeleton is on disk. The cure is a plain directory in place of the component, or deselecting the adapter: `--tools` without it, or `--tools none` when no other adapters are selected. A repeated `init` without `--tools` does not change the selection and does not cure it.
- **Unselected adapter roots** are not checked for symlinks, but they are cleaned: the owned outputs of an unselected adapter are removed when no path component up to its root is a symlink. A root with a link on any component, like a root that is not a directory, is skipped whole — backslop does not enter it, and a shared harness directory linked into a project without that adapter is a legitimate layout. Inside an unselected root that is being cleaned, a candidate behind a link or one that is not a file is skipped, without a refusal.
- **Markdown traversal** does not follow a link on a harness root either, on any of its components (`.claude` or `.claude/skills`): `mv` and `archive` neither read nor rewrite files behind it. The `lint` link gate walks `<docs>/**` and root `*.md` and does not touch harness directories.
- **A directory on an output path.** A directory at an output path of a selected adapter, and a file on a component of that path, are refused in words on write (`owned adapter output is not a file`, `a file sits where the adapter output path needs a directory`): there is nowhere to write.

### The rules pair belongs to the tool

`<docs>/backlog/README.md` and `<docs>/archive/README.md` carry backslop's process text, not the project's.

- **Below the tool version.** `migrate` redraws both files when the stamp is below the tool version or missing: it renders the template of the project language with `cli`, `prefix`, `docs` and the project name. A file that differs from the render, or is missing, is rewritten, and the output names its path; `--dry-run` prints the plan.
- **At the tool version** `migrate` redraws only untouched tool output: a file that differs from the render only by pins of the `cli` spec (or by its unpinned form), and a render of the other language after a `lang` change, up to the same pins and line endings. A file that matches no render stays until the next version update, and the output names it.
- **Safeguards before the first write.** An uncommitted edit of such a file (`git status --porcelain` is not empty) is refused with the file name. A path through a symlink on any component is skipped with a warning, so the write does not go through the link. A pin move alone is not an edit: a file that, once every pin of the `cli` spec is set to the `cli` pin, equals its `HEAD` version up to line endings is redrawn — that is how `upgrade` of earlier versions leaves it.
- **Without git** the redraw runs, and the output says there was nothing to check edits with. "Without git" means only a project outside a repository or a missing `git`; any other git failure refuses `migrate` with its cause before the first write.
- **Upgrade.** `upgrade` calls `migrate` of the new version, so every upgrade redraws the pair. A committed local edit of the pair is lost on upgrade by design: the project keeps rules of its own outside the pair, for example in `AGENTS.md` outside the block. The paragraph "This file belongs to backslop…" in the templates themselves says so.
- **The rest of the skeleton** — `README.md`, `GLOSSARY.md`, `reference/README.md`, the process ADR, `archive/LOG.md` — belongs to the project, and nothing redraws it.

### ROADMAP.md is not part of the layout

`init` does not create `ROADMAP.md`. `migrate` at a stamp below 0.12.0 deletes the copy that earlier versions laid down, but only when both hold:

- the copy equals the earlier render of the project-language template, up to pins of the `cli` spec and line endings;
- no file that `lint` gate 1 checks (`<docs>/**` with the archive, and root `*.md`) links to it, in the form this same run leaves those files in. A link in code is not a link here, so after the deletion gate 1 has nothing to report about the file.

The same run takes the two lines of the earlier render that link the file out of `<docs>/README.md`: the table row is removed, and the third, introductory line is replaced with the current one; a line the project has edited stays. When the copy is already gone, only these lines are removed, and a warning names any links to it that remain. An edited copy, or a copy something still links to, stays as a project document, and a warning names it and every file that links to it; `<docs>/README.md` is then left alone. The safeguards are those of the rules pair: an uncommitted edit of a file to be deleted or edited is refused before the first write, except for a pin move alone; a path through a symlink is skipped with a warning; `--dry-run` prints the plan. The migration runs once, when the stamp crosses 0.12.0.

### Implementation notes

- The registry is [lib/adapters-registry.js](../../lib/adapters-registry.js). [lib/adapter-ownership.js](../../lib/adapter-ownership.js) holds `markGenerated`, which places the marker, and `isOwnedAdapterFile`, the one ownership predicate for writing, removal, `lint` and `repoMarkdown` ([lib/mdwalk.js](../../lib/mdwalk.js)). `repoMarkdown` leaves owned files out, which is why `mv` and `archive` do not rewrite their links.
- Contributor rule: a new skill template is owned through the marker. Add it under `templates/skills/` and `templates/en/skills/`; there is no path list and no `tools` inference to extend.
- The re-run rules and the pre-write phase live in [lib/init.js](../../lib/init.js); the adapter writes and removals in [lib/adapters.js](../../lib/adapters.js).
- The rules pair is `RULES_DOCS` in [lib/migrate.js](../../lib/migrate.js); the earlier ROADMAP render and its two README lines are in [lib/legacy-roadmap.js](../../lib/legacy-roadmap.js), and the gate 1 file set is `linkGateFiles`.

## backslop.json

This table is the single owner of the field semantics. The Default column is the value read when the field is absent.

| Field | Default | Meaning |
|---|---|---|
| `prefix` | `BS` | task number prefix: 2–6 uppercase Latin letters or digits, starting with a letter; lands in the managed block (see [Values that land in the block](#values-that-land-in-the-block)) |
| `docs` | `docs` | documentation directory relative to the project root; lands in the managed block. The path must lie inside the project on every OS, so that one config reads the same everywhere: `\` splits a path like `/`; a `..` segment is refused (`../x`, `a\..\b`), while `..` inside a name is legal (`my..docs`); the absolute forms `/x`, `C:\x`, `C:/x` and `\\server\x` are refused, and so are an empty path and `.`. `init --dir` is checked by the same rule |
| `cli` | `npx github:Velklish/backslop#v<tool version>` | how this project calls backslop; substituted into the skills and the `AGENTS.md` block, and lands in the managed block. The form `npx github:owner/repo#vX.Y.Z` carries a pin, and `upgrade` derives the release source from it. The form is accepted with a `.git` suffix and without the `v` before the version (`npx github:owner/repo.git#1.0.0`); `lint` checks a pin in live files in any of these forms, and `upgrade` moves it to the canonical `#vX.Y.Z` |
| `gates` | `["<cli> lint"]`, built from the project's `cli` | commands that must be green before hand-off; `backslop gates` runs them ([02](02-cli.md)), and the skills call exactly that. An entry is a non-empty command string (always run) or an object `{ "command": "<command>", "when": ["<glob>", …] }`: a scoped command runs only when the set of changed paths touches at least one pattern. `when` is a non-empty list of non-empty patterns; an empty one is refused, because the command would never run. A pattern matches the whole path from the project root (in a monorepo the project directory prefix is stripped, and a path outside the project leaves the set): `*` and `?` do not cross `/`, `**` does, and `**/` also matches the root. So a directory is written `docs/**`, not `docs`: a bare directory name matches no path, and the gate never runs |
| `probe` | none | the project's mutation-probe command: a non-empty string that lands in the managed block. Declared, it is named by step 4 of the `AGENTS.md` block, by the same step of the `backslop-task` skill and by the brief. Absent, the block carries no probe requirement at all, and `init` says so in a line of its output. There is no default: every repository has its own probe command, and an invented one is worse than none |
| `version` | none — `init` and `migrate` write the running tool version | stamp: which tool version made the layout, in the form `X.Y.Z`; `lint` and `upgrade` read it. An absent stamp is read as unknown: `lint` warns, and `upgrade` and `migrate` treat the project as unstamped (`migrate` counts it older than every migration) |
| `source` | none | where `upgrade` takes release tags from: a git URL or a path. A relative path is resolved from the project root, whatever directory the command runs in and whatever repository the project lies in. Without the field, the tags come from the GitHub form of `cli`; an npm pin gives no source |
| `lang` | none — `init` writes `ru` unless `--lang` says otherwise | language of new files and generated artifacts: `ru` or `en`. A config without the field is refused by every command that loads the config, `init` included; `help`, `version`, `changelog` and `merge-changelog` do not load it, and read the field only for their message language, taking an absent one as `ru`. To fix a refused config, add the field to `backslop.json` by hand — `init` reads the config first and cannot add it. The operating rules and the archive rules follow a `lang` change on the next `migrate`: an untouched render of the other language is redrawn in the new one, and a file that matches neither render stays until the next version update, and `migrate` names it |
| `tools` | none — `init` writes `[]` unless `--tools` says otherwise | selected adapters: a list of `claude`, `cursor`, `codex` without repeats; `[]` selects none. A config without the field is refused as one without `lang` is, and the field is added by hand |
| `agents.stepOverrides` | none | `agents` is an object; its `stepOverrides` overrides steps of the `AGENTS.md` block. Keys are step numbers as strings, `"1"`…`"7"`; values are non-empty single-line text, without line breaks and without the `<` character. `init` replaces the text of that step inside the managed block and keeps its number, the other steps and the worker boundary. The value is substituted **escaped**: every CommonMark ASCII punctuation character (32 characters, `!` to `~`) gets a backslash, so the value stays text and never becomes markup — in particular, a link reference definition `[label]: /target`, whose scope is the whole document, does not open inside it. Brackets without a definition stay a legal value: escaping does not refuse them, it defuses them. An override of step 4 also replaces the probe sentence: the block stops naming the `probe` command while the `backslop-task` skill and the brief still name it, and `init` does not warn; for the block to name the command, write it into the override text |

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

The name is `<prefix>-N-<slug>.md`, or `<prefix>-N.k-<slug>.md` for a finding; a slug is lowercase Latin letters, digits and hyphens between words. The directory is the status. Russian and English names of fields and sections are read together in one backlog; new files are written by the `lang` layer.

```
# <prefix>-N · Title

- **Порядок / Order:** 10               only in queue/; an integer, step 10, lower comes first
- **Прежний порядок / Previous order:** 20   outside queue/; the rank the task had when it left the queue
- **Область / Scope:** [section](../../reference/01-layout.md)
- **Создана / Created:** YYYY-MM-DD
- **Взята / Taken:** YYYY-MM-DD         set by mv … active
- **Зависимости / Dependencies:** none
- **Родитель / Parent:** <prefix>-N.k   only on a finding created with `--parent N.M`; the child gets the next free `N.k`; always in `minor/`
- **Цена / Cost:** minor              set in `minor/`, kept as is when the entry leaves it: `critical`, `major` or `minor`; a hypothesis carries a mark, `major (гипотеза)` / `major (hypothesis)`

## Контекст / Context
## Что сделать / Work to do
## Не входит / Out of scope
## Проверки / Verification
## Отложено / Deferred                  only in deferred/: Отложена / Deferred, Причина / Reason, Условие возврата / Return condition
```

- **Header fields.** A header field is a line `- **Name:** value` between the title and the first `## ` section. Field order is free; commands put Order first.
- **One occurrence.** Every known field, counting its RU and EN aliases, appears in a file once: reading and writing take the first occurrence in line order, a field write collapses the rest, and a field removal deletes them all.
- **Title.** The title on the first line names the same number as the file name.
- **Scope.** `new` gives a new task a link to `reference/README.md` with the path depth computed; in a project without that file the stub stays as text, `[TODO: reference/ section]`, because a broken link would fail gate 1. Whoever files the task picks the actual section. A triaged task's Scope is a filled link to a reference section: in `queue/`, `active/` and `deferred/`, an empty field and the `[TODO]` stub left by `new` fail `lint` (gate 4, [03](03-lint.md)); in `triage/` the field is not checked, since an entry there lies unsorted.
- **Previous order.** `mv` sets Previous order when a task leaves `queue/` and removes it when the task returns. Outside the queue there is no active Order, and `mv N queue --restore` ([02](02-cli.md)) needs the number the task left with. The fields are distinct: the gate that requires Order in `queue/` does not count a saved Previous order in its place.
- **Prefix choice.** A prefix that is an ordinary word (`API`, `RFC`, `HTTP`) gives false hits of the mentions gate on strings such as `API-2.0`: choose a prefix that does not occur in the project's texts.

### Numbers

- `new` gives the maximum over all status directories and the archive plus one; a finding's sub-id is the maximum `k` among the `N.*` files plus one. There is no counter in the files.
- Not only the current tree counts: so do the numbers taken in other worktrees of the repository (on disk, uncommitted ones included) and in every local branch. Numbers are seen for a project in a subdirectory of its repository and for a `docs` directory with a non-ASCII name too. When a foreign number that is not in the current tree moves your number, the command names its source; a number that is also in the current tree is not named as a source.
- A clone and a remote branch are not visible locally: `lint` catches a collision with them after the merge.
- Without git — no repository, or git not installed — the number is computed from the current tree. Any other git failure during this scan (a signal, a timeout, a launch error, another exit code) refuses `new` with git's cause and without a file: a number that could not be checked is not given out.

### Implementation notes

- Field writes are `setField` and `removeField` in [lib/tasks.js](../../lib/tasks.js): `setField` collapses repeated occurrences, and `removeField` removes every one.
- The foreign-number scan is `foreignTaskIds` in [lib/tasks.js](../../lib/tasks.js): `git worktree list --porcelain` for other worktrees, and `git ls-tree -r -z --name-only <branch> -- <docs>/backlog <docs>/archive`, run from the project root, for local branches. The pathspec and the output paths are relative to that root, which is what makes the subdirectory and non-ASCII cases work.

## Minor file

- **Filing.** `new <slug> --parent N --minor --evidence "…"` puts a file from [templates/minor.md](../../templates/minor.md) into `minor/`: the title `# <id> · <title>`, the fields Scope, Created, Parent and Cost, and an Evidence section with the text of `--evidence`. A card filed by this command carries no `[TODO]` stubs: without evidence `new` refuses before creating the file.
- **Sections.** An entry filed by `new --minor` has no Work to do, Out of scope or Verification sections: it is an entry for a batch, not a task definition.
- **Scope** is empty: the approver fills it when cutting batches, and `lint` only warns about an empty or unfilled Scope in `minor/`.
- **Cost** defaults to `minor`; `--cost major|critical` is accepted only with `--hypothesis` and is written with the hypothesis mark.
- **Moving in.** The second door into `minor/`, `mv N.k minor`, needs the same: an Evidence section with text and without a stub, or the flag `--evidence "…"`; otherwise it refuses before the move. A `triage/` card built from `task.md` is reshaped without losing text: sections made only of stubs are removed, stub lines in sections with text are removed too, a Context with text and no Evidence becomes Evidence, and `--evidence` writes an `Evidence: …` line in place of the evidence stub. `mv N minor` of a card from another status adds `Cost: minor` when the field is missing and erases the Scope stub left by `new`.
- **Lint.** In `minor/`, `lint` requires the Evidence section: a missing or empty one, or one holding a stub, is a gate 4 error ([03](03-lint.md)).

## Archive

The archive holds two record forms, and they live side by side for as long as needed.

**Directory** — `docs/archive/<id>-<slug>/task.md`: the task definition as it was, with links rewritten for the new depth, and `result.md` from the template [templates/result.md](../../templates/result.md): closing date, outcome, what was done, how it was verified, which docs were updated. `archive N` lays it down so. While a `[TODO` stub remains in `result.md` outside code, `lint` is red; the stub form shown in a code span is not a stub ([03](03-lint.md)).

**Journal line** — `docs/archive/LOG.md`: a task looks like this after `fold N`. No directory stays in the tree, and the body goes into the message of the fold commit. The line form:

```
- <a id="<lowercase prefix>-N"></a>`<prefix>-N-slug` · YYYY-MM-DD · completed · `a1b2c3d4e5` · Task title
```

- **Order.** Lines are appended at the end of the journal: a single fold as one line, a bulk fold as a run of lines ordered by closing date — the dates that stand in the lines; equal dates go by number.
- **Fields**, left to right: the anchor (the number in lower case — incoming links point at it), the number with its slug, the closing date, the outcome, the commit and the title. The outcome is written in the `lang` form (`выполнена` for `ru`, `completed` for `en`).
- **Title last.** The title stands last because it alone may contain the `·` separator; everything before it parses in one pass without backtracking.
- **Anchor.** The anchor is an explicit `<a id>`, not derived from the title: it must equal the number, and gate 13 checks that ([03](03-lint.md)).
- **Commit** is the revision the body is read from; `—` while the body is not in history. `show N` reads it, and gate 13 reports a revision that is not in the history of `HEAD` ([03](03-lint.md)).

### Closing date and outcome

The closing date and the outcome are read from two places of `result.md`: the first paragraph, where the template puts them, and the heading, as old archives closed.

- **Heading forms.** The heading is read in two forms: brackets `(<outcome> YYYY-MM-DD)` — `# <prefix>-N — результат (снята с плана YYYY-MM-DD)` ("result (taken off the plan …)") — and a colon after the dash, `— результат: <исход>` / `— result: <outcome>` — `# <prefix>-N — результат: отклонена` ("result: rejected"). Only the brackets carry a date.
- **Paragraph over heading.** The first paragraph is stronger than the heading: the date is the first date of the paragraph, and without one, the date in the brackets; the outcome is the paragraph's word, and without one, the heading's word.
- **Nothing past the paragraph.** The file is not read past the first paragraph: "отклонена" (rejected) in the Verification section, or "результат: отклонена" under the first paragraph, is an account of the work, not an outcome.
- **No date.** When neither place has a date, the line gets the commit date of the body revision (`git log -1 --format=%cs <revision>`): the other dates in `result.md` are measurements and decisions, and they are not read as the closing. Only a line without a revision keeps the fold day; `fold --older-than` does not take such a record — its age is unknown.

### Outcome words

The words map onto three journal outcomes. Both language forms are always read; the `lang` form is written.

| Outcome in the line | Words in `result.md` |
|---|---|
| `слита в <number>` / `merged into <number>` | «слита в», «слиянием в» (merged into, by merging into), «merged into». A date and markup may stand between the word and «в» / "into": `**Слита YYYY-MM-DD в** <prefix>-N`, `**слита** в <prefix>-N`. The project's number stands right after the form, with only whitespace and link or emphasis markup between them; without it this is not a merge: «слито в main» (merged into main), "merged into it", a number of another project. A negation before the form — «не слиты в одно» (not merged into one), «не слиянием в», "not merged into" — is not a merge either |
| `отклонена` / `rejected` | «отклонена», «отклонено», «отклонением» (rejected, rejected, by rejection), "rejected", «снята с плана» (taken off the plan). The masculine «отклонён» is not read as an outcome: in archives it is always about an option («гейт-сверщик отклонён», "the checking gate was rejected"), not about the task; «с отклонением» (with a deviation) neither: «с отклонением от постановки» (deviating from the task definition) is an account of the work. A bare «снята» (removed) counts only as the first word of the paragraph or of the heading outcome: «Снята: YYYY-MM-DD. Беспредметна» (Removed: … Moot) is an outcome, «заглушка снята» (the stub was removed) in the middle of prose is an account |
| `выполнена` / `completed` | «выполнена» (completed), "completed". A bare «закрыта», "closed" or "done", and the marker «Исход:» / "Outcome:" (the word with a colon right after it), count only when neither the paragraph nor the heading named an outcome with the words above: the template opens the paragraph with `**Закрыта DATE.**` / `**Closed DATE.**`, and in old archives that is the only outcome word. «**Исход: обе формы понимаются.**» (Outcome: both forms are understood) is completed; so is a marker with a word outside the table, or with «снята» not as the first word of the paragraph, like «Отказ: беспредметна» (Refusal: moot): «**Исход: снята** вместе с предметом» (Outcome: removed together with its subject). «Исход: отклонена» is rejected, by the word. «исход» without a colon and «Исход — …» with a dash are not the marker |

- **Position first.** Within one place, position decides and then the table: the outcome is the table word that stands first in the place, and the row order of the table decides only at equal positions. So a leading word beats the prose: «Слита в <prefix>-N. Выполнена там» (Merged into …. Completed there) is a merge, "Completed. … was tried and rejected" is completed.
- **Whole words.** Words match whole, not as part of another word: "abandoned" does not carry "done", "disclosed" does not carry "closed", «отклонение» (a deviation) does not carry «отклонена».
- **No outcome.** The field holds `—` only when neither the paragraph nor the heading carries a table word, a bare «закрыта» or the «Исход:» marker: the command does not invent an outcome `result.md` did not name.
- **Name a non-completed outcome with a table word.** «**Закрыта YYYY-MM-DD.** Отказ: беспредметна» (Closed. Refusal: moot) is the template's bare «Закрыта» and gives `выполнена`, while «**Закрыта YYYY-MM-DD.** Отклонена: беспредметна» (Closed. Rejected: moot) gives `отклонена`. `lint` gate 5 on an unfolded directory ([03](03-lint.md)) and `fold N` by a refusal before any write ([02](02-cli.md)) hold this requirement: the first paragraph or the heading of `result.md` must carry a table word. A bare «Закрыта», "Closed", "done" and the «Исход:» marker without a table word do not pass, and the template stub states the requirement. The fallback to the bare word and the marker remains for the bulk fold of old records closed before the gate; `result.md` has no separate Outcome field.
- **Batches.** A record closed by a batch gets the outcome `пачкой <M>` / `batch <M>`: the command builds it rather than reading it, and it reads it back by that form — `status` counts closed tasks in the archive, not batch entries.

These forms are read by the table, not by intent:

- «**Закрыта отказом YYYY-MM-DD** решением владельца» (Closed by refusal, by the owner's decision) — `выполнена`: «отказ» (refusal) is not a table word, as in «Отказ: беспредметна» above;
- «**Закрыта YYYY-MM-DD. Закрыта границей, а не выполнена.**» (Closed by a boundary, not completed) — `выполнена`: a negation is cut off only before a merge;
- «**Закрыта:** YYYY-MM-DD. Исход — снята вместе с предметом» (Outcome — removed together with its subject) — `выполнена`: a bare «снята» is read only as the first word, and «Исход —» with a dash is not the marker;
- «**Закрыта.** Дубль: тот же предмет стоит в очереди как <number>» (Duplicate: the same subject is queued as …) — `выполнена`: a duplicate without «слита в» or «слиянием в» is not a merge;
- "**Closed on a recorded decision, and the rejected option is recorded with it.**" — `rejected`: a table word decides by position, whatever it is about — a rejected option or a neighbouring task, as in «<number> снята с плана».

The honest move for such records is a table word in the first paragraph: «Отклонена: …», «Слита в <number>», «Выполнена; отвергнутый вариант записан ниже» (Completed; the rejected option is recorded below).

- New records are held to it by `lint` gate 5 and `fold N` (see above); journals that are already folded are fixed by hand.
- The requirement does not close all five forms: a negation ("not completed") and a word about someone else's option or task carry a table word, gate 5 and `fold N` pass them, and in new records they are read by the first word too.

### Fold and show

The command behaviour of `fold` and `show` — revision choice, the per-file blob check, the causes of a missing revision, gitignored files, CRLF, the message draft, the squash warning and the `show N` lookup — is described in [02 § fold](02-cli.md#fold) and [§ show](02-cli.md#show).

### Closed numbers, findings and batches

- **Closed numbers** are read from both record forms: archive `<id>-<slug>/` directories and journal lines, in the current tree, in other worktrees and in the trees of local branches. A folded task has no file names at all, and without reading the journal of a neighbouring branch its number would be given out a second time.
- **Docs in the same pass.** `archive` prints the mechanical half of the "Docs in the same pass" line: the files under `<docs>/` and `CHANGELOG.md` touched by the commits of the `--range` range and by the commits with the task number in the subject (`<prefix>-N: …`); paths are from the project root, and a merge commit counts by what the merge itself changed. The list is only printed — what goes into `result.md` is the approver's call; Outcome and Verification are not filled in at all, since they are the approver's judgement of the task.
- **Findings.** Closing a task does not close its findings: a finding `N.k` left in `triage/` after task `N` moved to the archive fails `lint` (gate 9, [03](03-lint.md)).
- **Batches.** An entry from `minor/` is closed by a batch: `archive N.k --into M` puts its file into `docs/archive/<M>-<slug>/minor/` as is, without a `result.md` of its own; the outcome for the entries is a line in the batch's `result.md`. Such entries stay known to `lint` and to numbering: a mention of `N.k` is green, the next finding under `N` gets the next free number, and `status` does not count them in the archive total — that counts closed tasks.

### Implementation notes

- Both record forms are read by `scanTasks` and `foreignTaskIds` in [lib/tasks.js](../../lib/tasks.js). The outcome parser is `outcomeFromResult` in [lib/log.js](../../lib/log.js); word boundaries are by letter rather than `\b`, because in JavaScript `\b` is ASCII-only and does not exist after a Cyrillic letter.

## ADR

- **File.** `docs/adr/adr-NNN-<slug>.md`, the number padded to three digits. `adr` gives the maximum number in the local `docs/adr/` plus one. The number is not protected across worktrees or branches: `adr` reads only the local tree, and only `new` checks other worktrees and branches.
- **Template.** [templates/adr.md](../../templates/adr.md): Status, Date, Deciders, Context, Options, Decision, Consequences.
- **Index.** Every ADR is linked from `docs/README.md`, as a row of its table; `lint` fails without the link (gate 8, [03](03-lint.md)).
- **One ADR per topic.** A changed decision rewrites its ADR, in place or as a new file that replaces it. The replaced file is deleted, and nothing cites its number; there are no "superseded by" chains.

## Templates

Everything the tool writes from a template lives in [templates/](../../templates/). The English layer `templates/en/` is the source, and `templates/` holds its Russian twins. Keys are what the caller passes; a group shares one key set, and each file of the group uses part of it. The last column is what code reads back from the rendered text: a template edit keeps those strings.

| Template | Rendered by | Code | Keys | Strings code reads |
|---|---|---|---|---|
| `agents-section.md` — the `AGENTS.md` block | `init` | [lib/init.js](../../lib/init.js) | docs/skills group: `adrNumber`, `cli`, `date`, `docs`, `prefix`, `probeRule`, `project` | the `<!-- backslop:start -->` and `<!-- backslop:end -->` markers; the step lines `1.`–`7.`, which `agents.stepOverrides` replaces by number; the `Worker boundaries:` / `Границы worker'а:` line that closes step 7 |
| `agents-probe.md` — the probe sentence | `init` (the block and the skills), `brief` | [lib/templates.js](../../lib/templates.js) | `probe` | the code span around `{{probe}}`: the form of the `probe` field rests on it |
| `task.md` | `new`, `seed --queue-reference` | [lib/tasks.js](../../lib/tasks.js), [lib/seed.js](../../lib/seed.js) | `area`, `context`, `date`, `id`, `title` | the title line `# <id> · <title>` with its ` · ` separator, read by `lint`, `fold`, `brief`, `status` and `show`; the header field labels and the `## ` headings ([Task file](#task-file)); the `[TODO]` stubs, which `lint` and `mv N minor` recognise |
| `minor.md` | `new --minor`; `mv N minor` reshapes a `task.md` card into the same fields and Evidence section | [lib/tasks.js](../../lib/tasks.js), [lib/mv.js](../../lib/mv.js) | `area`, `context`, `cost`, `date`, `id`, `parent`, `title` | the title line `# <id> · <title>` with its ` · ` separator ([Task file](#task-file)), read as in `task.md`; the header field labels and the Evidence heading ([Minor file](#minor-file)) |
| `result.md` | `archive` | [lib/archive.js](../../lib/archive.js) | `date`, `id`, `prefix` | the first paragraph: the closing date and the outcome words ([Outcome words](#outcome-words)), read by `lint` and `fold`; the `[TODO` stub, which both refuse |
| `adr.md` | `adr` | [lib/adr.js](../../lib/adr.js) | `date`, `number`, `title` | none |
| `brief.md` | `brief` | [lib/brief.js](../../lib/brief.js) | `autonomy`, `cli`, `entry`, `gates`, `handover`, `measurements`, `neighbours`, `prefix`, `probeRule`, `tasks`, `track` | none: the brief goes to stdout |
| `docs/**` — the documentation skeleton | `init`; `migrate` redraws `backlog/README.md` and `archive/README.md`; `fold` and `migrate` write `archive/LOG.md` when it is missing | [lib/init.js](../../lib/init.js), [lib/migrate.js](../../lib/migrate.js), [lib/fold.js](../../lib/fold.js) | docs/skills group | `backlog/README.md` and `archive/README.md` whole: they belong to the tool, `migrate` compares them with their render, and in this repository they are a 1:1 render, as is the `archive/LOG.md` header above its first journal line; the ADR rows of `README.md` as links (gate 8, [03](03-lint.md)); the first link of each row of `reference/README.md`, read by `seed --queue-reference` |
| `skills/**` | the adapters, on `init` | [lib/adapters.js](../../lib/adapters.js) | docs/skills group | frontmatter `name` and `description`; the `cursor` adapter writes `description` into its rule file |

Rules:

- **Placeholders** are written `{{name}}`. A placeholder without a key from the caller is a render-time error naming the template and the key; nothing is left in the text. `lint` gate 12 checks placeholders against the declared keys of each template group, both ways and in both language layers ([03](03-lint.md)).
- **Source layer.** `templates/en/` is the source; a Russian twin in `templates/` has the same file, the same placeholders, the same skill frontmatter contract (`name` equals the directory name, `description` is not empty) and the same sequence of heading levels outside fenced code blocks — not merely the same count of headings — and the English layer has no Cyrillic. `lint` in the tool's repository fails on a mismatch ([03](03-lint.md)). It names a missing Russian twin of an English file and a Russian file without an English source; on a placeholder or heading mismatch it names the Russian file and prints the English value as the expected one.
- **Names the parser reads.** The `## ` headings and the `- **Label:**` fields of `task.md` and `minor.md` equal the names in [Task file](#task-file) and [Minor file](#minor-file) for the language of their layer. Parity compares heading levels, not text: a renamed heading passes it, and `brief` and `mv` stop finding the section. `npm test` holds these names.
- **The probe sentence** lives in its own template, `agents-probe.md`, so the rule text stays in `templates/` and not in code. The `{{probeRule}}` placeholder takes it in three places: step 4 of the managed block, the same step of the `backslop-task` skill, and the probe item of the brief. It is substituted only when the config declares `probe`.
- **Skill descriptions.** The `description` value in skill frontmatter stands in double quotes: a plain scalar with ": " inside does not parse as a YAML mapping, and the consumer's frontmatter gate would fail on every `init`. So `description: ""` is an empty value for parity, and an unclosed quote is a parity error and, for the `cursor` adapter, an `init` refusal naming the template. `npm test` holds the YAML-mapping form, not parity.
- **Adapter outputs** are marked and owned as [Adapter ownership](#adapter-ownership) says.

### Implementation notes

- The keys of each group are `TEMPLATE_KEYS` in [lib/templates.js](../../lib/templates.js); `renderTemplate` throws on a placeholder without a key; gate 12 is `templateSlots`, and the layer comparison is `templateParity`, which walks the English layer and compares heading levels as a sequence after blanking fenced blocks. `test/templates.test.mjs` holds the 1:1 render of the rules pair in this repository, and the `archive/LOG.md` header above its first journal line, in the layer of `backslop.json` `lang`.
- The names test in `test/templates.test.mjs` renders `task.md` and `minor.md` in both layers and checks the title line, each heading and each field label through the task parser: `readTitle`, `sections`, `sectionName`, `fieldName` and `getField` in [lib/tasks.js](../../lib/tasks.js). The field and section names are `FIELD_NAMES` and `SECTION_NAMES` there; the outcome words are `OUTCOME_FORMS` in [lib/log.js](../../lib/log.js); the step and boundary lines are `STEP_RE` and `WORKER_BOUNDARY_RE` in [lib/init.js](../../lib/init.js).
- `frontmatterField` ([lib/frontmatter.js](../../lib/frontmatter.js)) strips the quotes, and both readers use it: `splitFrontmatter` for `.mdc` and parity. `cursorOutput` quotes the value again (`JSON.stringify`), and without the stripping the `.mdc` would carry double escaping. `frontmatterField` reads line by line and is blind to the YAML-mapping defect, which is why `npm test` holds that form.
