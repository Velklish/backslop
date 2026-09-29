# Changelog

## Unreleased

- **Template parity takes the English layer as the source** — `lint` in the tool's repository names a missing Russian twin of an English template and a Russian template without an English source, and on a placeholder or heading mismatch prints the English side as the expected one.
- **`README.ru.md` is no longer shipped** — the package carries one README, `README.md`, in English. It lists every command with a link to its reference section, says that `init` writes `lang: ru` unless `--lang` is given, describes closing a task through `fold` into the archive journal, and ends the update section with a post-upgrade checklist. The npm description is English too.
- **The glossary templates separate the Term and EN columns** — the English glossary now defines Term as the spelling in project prose and EN as the identifier in code only, and the `backslop-seed` glossary reference shows example rows where the two differ. The reference points to the glossary header for the column and `[?]` rules instead of restating them and no longer repeats the rule on proposing missing names.
- **The `backslop-seed` skill states the real end state and drops the roadmap** — Phase 4 no longer promises a green `lint`: right after `seed --queue-reference` it is red on the placeholder fields of the seeded tasks and on links to sections not written yet, and after Phase 3 only those links remain, so Phase 3 now tells the agent to fill every seeded `describe-<slug>` task and Phase 4 adds a `grep` for placeholder markers in the places `lint` does not check. The inventory marks which sources `seed --scan` reads and which are read by eye; ADRs migrated from another format are renamed to `adr-NNN-<slug>.md` (a foreign-named file already inside `docs/adr/` is renamed or moved out), take the next free numbers and stay `Proposed` until the owner accepts them; the survey and the fill steps no longer mention `ROADMAP.md`; every runnable command uses the configured `cli`.
- **The process ADR and the docs index stop restating the tool-owned READMEs** — the ADR written by `init` no longer lists the task layout, closed-task directories, skills and gates (it described directories that `fold` removes and skills a default project does not have); it states the decision, the version pin and links the backlog and archive READMEs and the backslop section of `AGENTS.md`. The docs index template drops the two principles the `AGENTS.md` block owns, and its archive row names the `LOG.md` journal. The hint printed when `docs/README.md` already exists no longer repeats the row text. Existing projects keep their copies.
- **The brief forbids a push and contact with the owner, and states one commit rule** — the worker brief gains a fixed line under "How to work": do not push, decision points go to the orchestrator and never to the owner directly. The commit bullet reads the same in both languages: commits per task, each prefixed with the task prefix, including review fixes and the task's `CHANGELOG.md` entry. The Russian brief also names "status directories" and "another track's files" the way the English one does.
- **The managed block tells a worker to commit and names the triage commit** — steps 1, 2, 4, 5 and 7 of the `AGENTS.md` block changed: step 4 tells the worker to commit to their branch with the task prefix before reporting; step 5 keeps one commit subject, `<prefix>-N: <what was done>`, and no longer carries the alternative `closed —` subject, the lint and push sentence or the worker-boundary sentence; step 7 commits the changes of the triage review as a separate commit with the subject `<prefix>: triage after <prefix>-N` after the acceptance commit, then `lint` on the final commit, then push; step 1 says a `major` finding outside the task is filed with `new <slug> --parent N[.M]` and its `Evidence:` line filled in, and a `major` or `critical` hypothesis takes `--minor --cost <level> --hypothesis --evidence`. The step 2 glossary rule names the owner as the addressee, the `Worker boundaries:` line allows new finding files through `new` and forbids `mv` and `archive` on existing task files, and the `status` sentence names the minor entries. The `backslop-task` skill states the same worker boundary and names the owner in the glossary rule; the brief carries the same finding routes. A project with `agents.stepOverrides` for steps 1, 2, 4, 5 or 7 should review its overrides.
- **An unreadable directory in the task scan, the link walk or the pin walk is worded** — a directory the task scan or the link and pin walks could not list stopped `status`, `mv`, `archive`, `fold`, `brief`, `show`, `new` and `upgrade` with an `EACCES` stack trace or a bare `<absolute path>: EACCES`. They now name the project-relative path, the reason and what the command could not do, in the wording `lint` already uses. `upgrade` keeps its “finish manually” hint when the pin walk fails after the pin was saved.
- **`tracks` names a locked worktree in its text listing** — a locked worktree showed only in `tracks --json` (`locked: true`), and the reader of the text listing learned it when `git worktree remove` refused. The text now adds a line for a locked worktree saying to run `git worktree unlock` first.
- **`mv … minor` reads a stub as gate 4 does** — `mv` counted only a bullet or a bare line as a `[TODO` placeholder, so a card with `1. [TODO: command]`, a task box or a table row with a placeholder cell moved to `minor/` and then failed `lint`. `mv` now applies the line rule of gate 4 in every section: a stub is cut from every section but “Evidence”, where it is replaced by the `--evidence` line or, without the flag, refused, and an all-placeholder table row there is cut. In a table row that also has a written cell only the placeholder cell is emptied, and the written cells stay.
- **`new` skips a status directory that is a file in another worktree** — `new` stopped with an `ENOTDIR` stack trace when another worktree held a file where a status directory, `archive/` or an archive `minor/` belongs. Such a path now counts as holding no tasks, as in the working tree itself.
- **`lint` and `new` refuse a file where `docs/backlog` or a status directory is expected** — `lint` stopped with an `ENOTDIR` stack trace when `docs/backlog` was a file, and `new` with `ENOTDIR` or `EEXIST` when `docs/backlog` or the status directory it writes into was one. `lint` now reports the path as “a file, expected a directory”, and `new` refuses with the same wording `mv` uses, before it writes anything.
- **`new` sees numbers taken on other branches whatever the `docs` spelling** — with `"docs": "./docs"` or `"docs": "docs/"` in `backslop.json`, `new` did not see a task number taken on another branch and handed it out again. The path is now compared the way git prints it.
- **A pin with a suffix is not the cli pin** — `upgrade` matched the version prefix of `#v0.1.0x` or `#v0.1.0-rc.1` as the pin `#v0.1.0` and rewrote it to `#v0.2.0x`, keeping the suffix. A pin of the project's `cli` now ends at its version and `upgrade` leaves a suffixed one as written; `lint` reports it in a gate, the probe or a live file as a pin with a suffix that is not the cli pin, to fix by hand, and `upgrade` does not say “already on” while one stays. The pin in prose that gate 11 reads in the tool repository is unchanged.
- **`upgrade` pins a floating cli inside a quoted gate command** — a gate such as `sh -c "npx github:me/proj lint"` kept the floating form after `upgrade` pinned `cli`, because only whitespace and shell operators counted as word boundaries. A single or double quote now bounds the form too, and the command moves like an unquoted one.

## v0.12.0 — 2026-09-29

- **`docs/ROADMAP.md` leaves the layout** — `init` no longer creates it. `upgrade` and `migrate` delete an untouched, unlinked copy with its row in `docs/README.md` and keep an edited or linked one with a warning.
- **Upgrade: add `lang` and `tools`, rename `Area:` to `Scope:`, lead release headings with a version** — a config missing either field is refused; `## Release 1.2.3` is no release. `lint` now reports a stub behind a `[TODO` field and an unmarked skill-path file; pins below 0.9.0 are unsupported.
- **Only the generated marker makes an adapter file backslop's** — an unmarked file at a skill path is foreign: `init` leaves it and warns. A leading BOM, or the marker on a last line without a newline, no longer makes a generated file foreign.
- **`lint` and `mv` read placeholders and links more precisely** — `lint` reports a placeholder behind a `[TODO` field name, `mv … minor` keeps a written Scope, and `mv`, `archive` and `fold` rewrite percent-encoded links.
- **Git failures and time caps are named, not guessed** — `show`, `archive --range`, `gates` and `fold` refuse with the git cause instead of reading a failure as no repository. An `upgrade` step that hits the time cap fails.
- **Line endings and BOMs survive rewrites** — `init` keeps the line endings of `AGENTS.md` and `.gitignore`, `migrate` keeps the BOM of the rules it redraws, adapter outputs are always LF, and a `package.json` with a BOM is read.
- **`lint` names an unreadable directory instead of crashing** — it refuses with the path from the project root and the error code, and `upgrade`, `archive`, `fold` and `mv` refuse on the same directories.
- **Stricter arguments and consistent messages** — an extra positional argument is refused, messages follow the project language (both outside a project), hints name the project `cli`, and routine reports go to stderr. `changelog` and `merge-changelog` accept an otherwise invalid config.

## v0.11.1 — 2026-09-25

- **`upgrade` finishes from a pinned project** — from v0.9.0–v0.11.0 it now finishes, checks the version the new `cli` runs, starts from the lower of pin and stamp, moves every pin in `gates` and `probe`, and pins a floating `cli`.
- **Commands refuse before they damage a file** — `init` refuses a non-UTF-8 `AGENTS.md`, `upgrade` skips non-UTF-8 and symlinked files, `migrate` refuses when git fails, block markers count only as whole lines, and `init`, `mv`, `new`, `adr` check paths first.
- **Links resolve as GitHub renders them** — `/…` starts at the repository root, `#` and `?` end the target, escapes decode, any URI scheme is external, and self-links follow `mv` and `archive`. `.MD` files and root symlinks are walked.
- **`seed` reads real repositories** — `seed --queue-reference` writes Scope in the project language, keeps rows sharing a basename apart; `seed --scan` lists only `bin/` scripts, reads YAML block scalars, skips linked worktrees, quotes .NET paths.
- **`fold` and `show` keep task bodies safe** — `fold N` refuses while git lacks an attachment, bodies survive git's message cleanup, CRLF stays CRLF, and `show N` finds bulk-embedded bodies.
- **`new`, `tracks` and `gates` handle monorepos and git failures** — `new` sees other branches' numbers in subdirectory projects, `tracks` names gone worktrees, `gates` judges only the project's tree, and git failures refuse.
- **Stricter config, flags and `merge-changelog`** — a blank gate, a non-string `prefix` and an unsafe `init --dir` are refused, a BOM in `backslop.json` is ignored, and `-h` can be a flag value. `merge-changelog` keeps theirs' headings and line endings; `--out` follows the current directory.
- **Upgrade: fix what `lint` newly reports** — case-only link mismatches, misnamed ADR files, malformed quote markers and placeholders in numbered items, task boxes and tables are now errors, and an unknown `lint` flag fails. Journal entry pins are history.

## v0.11.0 — 2026-09-24

- **Upgrade: keep local rules elsewhere and name outcomes** — `migrate` redraws `docs/backlog/README.md` and `docs/archive/README.md` on every upgrade, losing committed edits. `lint` now wants an outcome word in every unfolded `result.md` and a file, not a directory, behind a task link.
- **`result.md` must name its outcome** — gate 5 and `fold N` want completed, rejected or merged into `<prefix>-N` (or Russian forms) in the first paragraph or heading. A bare "Closed" fails; a placeholder quoted in code is not a stub.
- **`fold` reads outcomes and revisions more accurately** — the first outcome word decides, "merged into" needs a task id, and `Outcome:` reads as completed. Bulk `fold` records the last commit that touched the task directory and checks each file against it.
- **`fold` rewrites root and trailing-slash links** — a link into the folded directory that cannot be rewritten is listed. `fold N` asks to commit the draft only when the body is not in history, and the batch skill names `fold M`.
- **`show N` handles large commits** — it prints a body from the commit message without the diff, and every git call reads up to 256 MiB, so large output is no longer cut off.
- **`mv` requires evidence for `minor/` and restores batches in order** — `mv N minor` refuses without an Evidence section or `--evidence`. `mv <N…> queue --restore` goes by descending saved numbers; a task whose place falls behind a batch neighbour goes right before it, and a line says so.
- **`merge-changelog` works after a version bump** — the unreleased section is the first without a version, or else the top one without a tag, and the report names it per side; the blank line before the next section is kept.
- **Stricter link checks and clearer git failures** — the task link rule covers reference-style links, and the rules name `quote:before:` for a task's own code. `gates` counts a gate that fails to start as red, and git killed by a signal is named.

## v0.10.1 — 2026-09-23

- **`fold` reads dates and outcomes of old `result.md` files** — a heading like `(<outcome> YYYY-MM-DD)` counts, and a bare "closed" or "done" means done, so old archives fold with far fewer missing dates and outcomes. Journals folded earlier are not regenerated.
- **Upgrade: do not commit between `archive N` and `fold N`** — the block and `backslop-task` put the fold draft outside the working tree and use it as the acceptance commit message. `lint` reports a journal revision not reachable from `HEAD`; `upgrade` redraws the block.

## v0.10.0 — 2026-09-22

- **Closed tasks fold into a journal line** — `fold N` deletes the archive directory, appends a line to `docs/archive/LOG.md` and prints the body as a commit message draft. `fold` alone folds the whole archive from history, `show N` prints a folded body, and `lint` checks the journal.
- **`gates` entries can carry a `when` scope** — `{ "command": "…", "when": ["docs/**"] }` runs only when a changed path matches; `--base <ref>` adds a diff to the path set. A skipped gate is counted apart and never as green.
- **A task keeps its queue place when it leaves** — `mv` stores the rank as Previous order, and `mv N queue --restore` puts the task back on it, before whoever took it; several numbers go in one call.
- **`new --minor` requires `--evidence`** — it refuses before writing anything, and the evidence replaces the placeholder, so a new `minor/` card passes `lint`. Cards in `triage/` are no longer checked for placeholders.
- **`merge-changelog` understands `###` headings** — it keeps the file's layout, places theirs' entries where they stood, and checks itself before writing. An unresolved conflict marker gives exit code 1.
- **Safer managed block and adapter outputs** — `docs` and `cli` are validated like `probe`, skill descriptions are quoted so the Cursor frontmatter parses, and the probe command reaches the `backslop-task` skill and the brief.
- **Upgrade: expect new `lint` placeholders and pass `--evidence` to `new --minor`** — `lint` reports list items like `- [TODO: hint]`, and `new --minor` refuses without `--evidence`. `upgrade` keeps your `docs/backlog/README.md`: read it as this release ships it.

## v0.9.0 — 2026-09-18

- **A fifth status directory, `minor/`** — `new <slug> --parent N --minor [--cost <level>] [--hypothesis]` files minor findings and hypotheses there to wait for a batch. `status` lists them by area, and `migrate` creates the directory.
- **`archive N.k --into M` closes a minor entry with its batch** — the file moves under the batch's archive directory with the usual link rewrites, and the batch's `result.md` names the outcome.
- **A finding's cost decides its route** — the backlog rules, the `AGENTS.md` block, the brief and the skills fix `critical` and in-scope `major` findings now, file other `major` findings in `triage/` and the rest in `minor/`.
- **The mutation probe command comes from `probe`** — step 4 of the `AGENTS.md` block names the `probe` command from `backslop.json`, or drops the probe requirement when the field is absent, and `init` says so.
- **`agents.stepOverrides` values stay plain text** — markdown punctuation is escaped, so a value cannot become a link definition for the whole document; markup inside a value no longer renders.

## v0.8.0 — 2026-09-13

- **`quote:before:<path>` keeps a pre-edit snapshot** — its content may differ from the file, but a missing target or an unclosed block is still an error; a plain `quote:<path>` still guards the text.
- **`upgrade` and `lint` share one set of live pins** — `package.json` and known CI files move with live markdown, and a stale pin there is a `lint` error; historical files stay green.
- **`agents.stepOverrides` replaces steps of the `AGENTS.md` block** — keys `"1"` to `"7"` in `backslop.json` replace a step's text on `init` with a single-line plain string.
- **The brief states the status and archive boundary** — a worker sends wording in the result instead of editing status or archive files; the one exception is a new finding filed with `new --parent N[.M]`.
- **`new --parent N.M` files a finding under a finding** — it takes the next free `N.k` and records the parent; `lint` warns when the parent is already closed.
- **`lint` catches a second Deferred section and whole-placeholder values** — headings inside fenced examples do not count, a line or field that is wholly `[TODO…]` in `docs/backlog/**` is an error, and `mv N deferred` does not add the section twice.

## v0.7.0 — 2026-09-12

- **`brief` takes `--entry`, `--autonomy` and `--handover`** — a slot left without its flag prints `[TODO: …]` saying what is missing, and a template slot without a key is refused instead of printed as is.
- **The brief's gates step follows the pinned version** — for a pin older than the `gates` runner, it lists each gate command and asks for its exit code instead of calling the runner.

## v0.6.0 — 2026-09-09

- **`init` checks only the selected adapters' roots for symlinks** — a shared harness directory no longer blocks `init`. A symlink is refused only at a selected adapter's root, and the refusal names the remedy.
- **`init` does not overwrite a foreign file at an adapter path** — an unmarked file outside the legacy paths stays and `init` names it in a warning, and `lint` reports it for the selected adapter. A directory in the way is refused in words.
- **Removing an adapter finds every marked file** — removal follows the generated marker under the harness root, as the ownership rule does, so no marked file is left behind.
- **`archive --range` lists docs changed by merge commits** — a conflict resolution counts too; paths start at the project root in a subdirectory project, and non-ASCII names print as they are.
- **A directory named like a task file is a `lint` diagnostic** — it is no longer read as a task and no longer stops commands with an `EISDIR` stack trace.

## v0.5.0 — 2026-09-09

- **New commands: `tracks`, `seed` and `brief`** — `tracks` lists worktrees and branches with unmerged task commits; `seed --scan` lists gate and subsystem candidates and `seed --queue-reference` seeds reference tasks; `brief` prints a worker brief from disk.
- **`gates` runs the configured gates** — it takes each command's exit code and prints "gates N, green M" with a tree snapshot; `--keep-going`, `--require-clean`, `--dry-run` and `--json` are available.
- **CHANGELOG tooling: `merge-changelog` and `release --bump`** — `merge-changelog` merges two revisions of the unreleased section by entry title and marks differing bodies as conflicts. `npm run release -- X.Y.Z --bump` writes the version and renames the top section.
- **`mv` moves several tasks, and `new` writes a working Scope link** — `mv 1 2 3 active` checks every number before the first move. `new` puts a link to `reference/README.md` into Scope, relative to the status directory.
- **`lint` checks Scope, duplicate fields, quotes and open findings** — gate 4 wants a Scope in `queue/`, `active/` and `deferred/` and reports duplicate header fields; gate 10 finds a `quote:` block in the live file; gate 9 reports an open finding of a closed task.
- **`upgrade` moves pins in prose** — the `cli` pin moves in `docs/**` and root `*.md`, but not in CHANGELOG, ADRs, the archive or cards, and `lint` warns about a pin that differs. `upgrade --pin-only` also tries the new version before writing the pin.
- **`init` keeps a `.gitignore` block and checks harness roots first** — the block lists `<harness root>/backslop-*` for each selected adapter. Symlinked harness roots are refused before any write, and removing an adapter deletes only owned files.
- **`archive` prints touched docs and finds flat tasks** — `archive N --range <base>..HEAD` prints files under `docs/` and `CHANGELOG.md` changed by the range, and a task file directly in `docs/backlog/` is archived like any other.

## v0.4.0 — 2026-09-05

- **`mv` moves a task out of a flat `docs/backlog/`** — into a status directory, rebasing its outgoing links; a move between status directories now fixes links to neighbouring tasks too.
- **Command dates use the machine's local time** — Created, Taken, Deferred and Closed take the local calendar date instead of the UTC one.
- **`backslop-batch` merges shared files by structure unit** — `-X theirs` and `-X ours` are forbidden for files that tracks share: CHANGELOG entries merge by title, documents by section. Before the merge only the track's worker files findings under its task.
- **`--title` accepts a value that starts with a dash** — unless the value equals a flag of the command; then the refusal suggests `--title=…`, and `help` names that form.
- **`new` counts numbers across all worktrees and local branches** — files in other worktrees and the trees of local branches take numbers and finding sub-IDs, and the output names the worktree or branch that moved yours.
- **`mv N queue --top | --after M` reorders a queued task** — only Order changes, and neighbours are renumbered by 10 when there is no free place; `lint` reports two queue files with the same Order.

## v0.3.1 — 2026-09-05

- **Task numbers with leading zeros** — the file name's form (`<prefix>-007`) stays in the id, the archive directory and links, while numbers compare as numbers; a finding inherits its parent's form (`<prefix>-007.1`), and one number written in two forms is an error.
- **`init` in a project with its own ADRs** — it writes the process ADR under the next free number instead of over a taken one, names the created file in the `docs/README.md` row hint, and does not duplicate it on a repeated `init`.

## v0.3.0 — 2026-09-04

- **The tarball acceptance test no longer hard-codes the version** — the expected `backslop X.Y.Z` line is read from the manifest, so the test no longer blocks every version bump.
- **`lang`** — a field in `backslop.json` and the `init --lang ru|en` flag: an English template layer in `templates/en/` and an English README.
- **`tools`** — choose the `claude`, `cursor` and `codex` adapters; the default is an empty list. A legacy config keeps Claude when the old canonical skill exists, and `--tools none` removes the set, deleting only owned outputs.
- **Harness-neutral self-host** — the generated `.claude/`, `.cursor/rules/backslop-*`, `.agents/skills/backslop-*` and `CLAUDE.md` are not stored in git; `templates/` is the only source.
- **npm pin** — `parseCli` and `upgrade` accept `npx backslop@X.Y.Z`, and release tags still come from git through `source`. `npx backslop` and `npx backslop@latest` count as unpinned, and `lint` warns about them.
- **`npm run release`** — preflight, gates, a fast-forward check against `origin/main`, a local tag, `push --dry-run`, `npm publish` and an atomic push; a failure prints the state and the next command.
- **Adapter output ownership** — the `backslop:generated` marker counts only at its generated position and only under `.claude/skills/`, `.cursor/rules/` and `.agents/skills/`; a quoted marker in docs does not hide a file from the markdown walk.
- **Contracts finalised** — the `AGENTS.md` block names skills conditionally, the Russian help lists the extra lint checks, the task format documents its Russian and English aliases, and a section heading takes only 0–3 spaces of indentation.

## v0.2.0 — 2026-09-03

- **`upgrade`** — updates the project when you decide: the latest tag from the release source (or `--to`), the pin in `cli` and `gates`, then `migrate` and `init` of the new version and a CHANGELOG summary; `--dry-run` and `--pin-only`.
- **Version pin and stamp** — `init` writes `cli` with its own version tag (`npx github:Velklish/backslop#vX.Y.Z`) and a `version` field in `backslop.json`; the untagged form pulls `main` on every run and does not suit a project `cli`.
- **`migrate` and `changelog`** — file format migrations by stamp (the list is empty for now) and a CHANGELOG summary between versions.
- **`lint`: version warnings** — no stamp, a stamp older or newer than the tool, a pin that differs from the stamp; they do not fail the gate.
- **`mv` rewrites incoming links** — like `archive`, so a move between status directories leaves no broken links in the roadmap and neighbouring tasks.
- **`init` on a project with its own `docs/README.md`** — a hint on which row to add to the table for the process ADR, instead of a red `lint` with no explanation.

## v0.1.0 — 2026-09-03

- **`init`** — a documentation skeleton, the `backslop.json` config, the `backslop-task`, `backslop-batch` and `backslop-seed` skills, and a procedure block in `AGENTS.md`; idempotent.
- **`new`, `mv`, `archive`, `adr`, `status`** — tasks as files in status directories, priority by the Order field, findings with sub-IDs, moves to the archive with link rewrites, ADRs with the next number, and a summary with `--json`.
- **`lint`** — eight gates: links, numbers, backlog layout, status fields, archive, mentions, CHANGELOG and the ADR table.
