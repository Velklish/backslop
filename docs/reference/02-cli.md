# 02. CLI

The entry point is [bin/backslop.js](../../bin/backslop.js): the first argument is the command, and only a name in its `COMMANDS` allowlist is run. The exit code of the process is the return value of the command's `run` (none means 0); a `CliError` is a refusal with exit 1. The modules behind the commands are in [06. Module map](06-module-map.md).

**Exit codes and output channels** — which stream carries what, what `✔`, `✖` and `⚠` mark, and how to tell a result from a refusal — are in [05. Orchestrator contract](05-orchestrator-contract.md), with the JSON shapes and what is stable. An unknown command is a refusal that points to `help`.

**Output.** A hint you can run names the command from the project's `cli` field; outside a project it names `backslop`. Long output (`status --json`) reaches the reader whole, and a reader that closes the pipe early ends the command quietly.

**Language.** Messages are in the project language (`lang` in `backslop.json`). An argv refusal, an unknown command, `help`, `version`, `changelog` and `merge-changelog` read `lang` without validating the rest of the config. Outside a project an argv or unknown-command refusal is one line in both languages, `EN / RU`, and `help` prints both full texts. A first `init` reports in the `--lang` language, or `ru` without it; its flag refusals before any language is known are `EN / RU`.

**Flag parsing** is strict:

- A command takes at most its number of positional arguments: none for `status`, `gates`, `tracks`, `links`, `seed`, `changelog`, `merge-changelog`, `upgrade`, `init`, `migrate` and `lint`; one for `new`, `adr`, `show`, `archive`, `fold` and `hook`; any number for `mv` and `brief`. An extra argument is a refusal naming the first extra one: `new ee --title My Title` refuses on `Title` — quote a value with spaces. `fold` has its own refusal, because the bulk fold is the same command without a number. `--` does not lift the limit.
- A string flag value that starts with a dash is accepted after a space too (`--title "--strategy …"`): the pair is joined into `--title=…` unless the value equals a flag name of this command. `--title --queue` is a refusal that suggests the form `--title=…`; the form with `=` is safe for any value. The help text states this rule.
- `-h`/`--help` is a flag of every command: help with exit code 0, inside a project or outside. In the place of a string flag's value (`--title -h`, `--evidence --help`) it is the value, not a help request. An unknown flag and an extra argument beat help: `new --bogus --help` is the refusal `unknown option “--bogus”` with exit code 1.
- A refusal to parse argv names the flag.

**Config.** Every command that loads the config refuses a `backslop.json` that breaks a rule of the [01-layout config table](01-layout.md#backslopjson) — an invalid `agents.stepOverrides` value included — and `init` refuses it before writing the block. The probe step and the step overrides of the managed block are described in that table.

**Task numbers.** A command that resolves a task by its number — `mv`, `archive` (and its `--into` batch), `fold`, `show`, `brief`, `new --parent` — refuses when two files carry that number, naming both paths.

**Dates** that commands write (Created, Taken, Deferred, Closed) are the machine's calendar date in its own time zone, not UTC.

**Files.** Task files are read without a BOM, and their line endings are kept as they were. A file a command rewrites keeps the BOM it had on disk and never gets a second one; the exception is an owned adapter output, which `init` rewrites as the template render byte for byte, without a BOM. A new file gets a BOM only when its text carries one — for `merge-changelog --out` that is the BOM of the `--ours` revision.

**git output.** The output of every git call — in `show`, `fold`, `lint` gate 13, `merge-changelog`, `upgrade`'s `ls-remote` and the rest — is read with a ceiling of 256 MiB.

## Commands

| Command | Purpose |
|---|---|
| `init [--dir docs] [--prefix BS] [--cli <command>] [--lang ru\|en] [--tools <CSV\|none>] [--hooks <CSV\|none>]` | lay down or refresh the layout |
| `new <slug> [--title "…"] [--queue [--top]] [--parent N[.M] [--minor --evidence "…" [--cost <level>] [--hypothesis]]]` | file a task or a finding |
| `mv <N…> <triage\|queue\|active\|deferred\|minor> [--top \| --after M \| --restore] [--evidence "…"]` | move tasks between statuses, or reorder the queue |
| `archive <N> [--dry-run] [--range <base>..HEAD]` \| `archive <N.k> --into <M> [--dry-run]` | archive a task, or close a minor entry into a batch |
| `fold <N> [--dry-run]` | fold one archived task into a journal line |
| `fold [--older-than <date>] [--embed-missing] [--dry-run]` | fold the accumulated archive |
| `show <N>` | print the body of a folded task |
| `adr <slug> [--title "…"]` | create the next ADR |
| `brief <N…> [--track "…"] [--neighbour "path=track"] [--entry "…"] [--autonomy "…"] [--handover "…"] [--measurements]` | print a worker brief |
| `seed --scan [--json]` \| `seed --queue-reference` | list gate and subsystem candidates, or queue reference sections |
| `status [--json]` | summarise the backlog |
| `lint` | run the tracker gates |
| `gates [--keep-going] [--json] [--require-clean] [--dry-run] [--base <ref>]` | run the project's gate commands |
| `tracks [--json]` | list worktrees and run branches |
| `links --external [--json]` | request the external links of the documents and classify each |
| `hook <session-start\|stop> --harness <claude\|cursor\|codex>` | agent hook: record where a session started, and return the turn on `lint` errors in the files it changed |
| `upgrade [--to X.Y.Z] [--dry-run] [--pin-only]` | update backslop in the project |
| `migrate [--dry-run]` | run the layout migrations and redraw the rules pair |
| `changelog [--since X.Y.Z] [--to X.Y.Z]` | print backslop's CHANGELOG sections |
| `merge-changelog --ours <ref> --theirs <ref> [--base <ref>] [--out <file>]` | merge two revisions of `CHANGELOG.md` |
| `version` \| `--version` \| `-v`, `help` \| `--help` \| `-h`, `<command> --help` | print the version or the help |

### init

Behaviour:

- Lays down the skeleton; the rules of a repeated run are in [01 § Re-run init](01-layout.md#re-run-init). An existing `docs/` file is not touched, nor is the rules pair — `migrate` redraws it. The process ADR is `adr-001-process.md`, or the next free number in a project with ADRs of its own.
- The block in `AGENTS.md` and in `.gitignore` is written with the file's own line endings (CRLF stays CRLF); a new file gets LF. Adapter outputs are always LF, even from a CRLF clone of the tool.
- `--dir` and the configured `docs` are compared normalized: `docs/`, `./docs` and `docs` are one directory.
- An unselected adapter whose root is not a directory is skipped without a refusal, as is a removal candidate of it that goes through a symlink or is not a file.
- `--hooks claude,cursor,codex` (any subset, or `none`) sets the `hooks` field as `--tools` sets `tools`; a repeated `init` without the flag keeps the field, and a first `init` without it selects no hooks and writes no field. `init` writes the start and stop records of each selected harness into its project hook file and removes the records of the others ([01 § Agent hook records](01-layout.md#agent-hook-records)). With hooks selected, the `AGENTS.md` block gains one sentence after the release sentence: the stop hook returns the turn on `lint` errors in the files the session changed, and those errors are fixed, not bypassed. Without hooks the block is the same, byte for byte.

Output:

- The summary line `✔ init: …`, then adapter outputs, the `AGENTS.md`, `CLAUDE.md` and `.gitignore` states, and warnings.
- Without `probe` in the config, a line says that neither the block nor the skill carries a probe requirement: declare the command in `probe`, or describe the probe in a section of your own outside the block — such a section survives `init`.
- `agent hooks: <file> written|removed, …` when a hook file was written or removed.
- The `next:` hint names the `backslop-seed` skill only when an adapter is selected; without one it names `init --tools`; in the tool's own repository, where `--tools` is refused, it names neither.

Refusals:

- A `dir`/`prefix`/`cli` flag that differs from the existing config; an unknown `lang`, `tools` or `hooks` value; a project already initialized above; a stamp newer than the tool.
- A bad prefix; a `--dir` path outside the project or with a `..` segment, by the rule of the `docs` field (`docs/../x` is refused, not shortened to `x`); a value any later run would refuse (an empty `--cli`). A flag refusal speaks the language of `--lang` or of the existing config, or `EN / RU` when the language is unknown; a `--cli`/`--dir` refusal by the block rule names the flag, not `backslop.json`.
- `--tools` other than `none` in the tool's own repository (its `templates/` is the running tool's directory): self-host keeps `tools: []`, and a stand with an adapter is set up in a directory of its own.
- Before the first write: a symlink on the root of a selected adapter or on the path of one of its outputs (unselected roots are not checked), a directory at an output path, a file on a component of that path, `CLAUDE.md` that is a directory or a dangling symlink with `claude` selected; `docs`, a skeleton directory under it, or a selected adapter root that is a file; `docs` or a skeleton directory under it that cannot be read (named with its error code, as the other commands name it); `AGENTS.md` or `.gitignore` that is a directory; `docs/README.md` that is not a file; `AGENTS.md` or a `.gitignore` that `init` rewrites not in UTF-8; a block marker on its own line twice, or without its pair; the hook file of a selected harness that is not valid JSON, whose top level or `hooks` is not an object, or whose start or stop value is not a list, or that has a symlink on its path.

### new

Behaviour:

- Writes a task file from the template into `triage/`; with `--queue`, into the queue at the end, or at the top with `--top`. An empty or blank `--title` makes the slug the title.
- `--parent N` files a finding `N.k`; `--parent N.M` files a finding under a finding, with the next free `N.k` and a Parent field naming the exact parent.
- `--minor` files a minor finding into `minor/` from the `minor.md` template, with Parent, Cost (`--cost`: `critical`, `major`, `minor`; default `minor`; `major` and `critical` only with `--hypothesis`, and then marked as a hypothesis) and an empty Scope ([01 § Minor file](01-layout.md#minor-file)). The required `--evidence` gives the evidence.
- A finding in `triage/` gets the Evidence field as a separate line with a placeholder to fill; a minor entry gets the `--evidence` text instead.
- Scope gets a link to `reference/README.md` with the depth from the status directory computed (text, in a project without that file); whoever files the task writes the actual section.
- The number is the next free one across the current tree, other worktrees and local branches ([01 § Numbers](01-layout.md#numbers)).

Output:

- `✔ <id>: <path>`, then notes — a foreign number that moved yours is named, a number from the current tree is not — and a next-step hint: for a `triage/` entry, that it stays there until triage and moves to the queue with `mv <N> queue`; for a minor entry, that it stays in `minor/` until a batch closes it with `archive N.k --into M`.

Refusals:

- A git failure while scanning foreign numbers, other than "no repository" and "git is not installed"; a bad slug; a slug that makes the file name `<prefix>-<N[.k]>-<slug>.md` longer than 255 bytes — before any write and before the queue is renumbered; no such parent; `docs/backlog` or the status directory the file goes into is a file.
- `--top` without `--queue`; `--minor` without `--parent` or with `--queue`; `--cost`/`--hypothesis`/`--evidence` without `--minor`; `--cost` outside the three levels; `--cost major|critical` without `--hypothesis`; `--minor` without `--evidence` or with empty evidence.
- A status directory or an archive task directory that is a symlink leading out of the project — the numbers behind it are not seen; before any write.

### mv

Behaviour:

- `git mv` between status directories. A file outside the git index (or with no repository) is moved by a plain rename, with a warning.
- Several numbers per call: all are resolved and checked before the first move, then moved one by one in argument order, with one `ok` line each and one summary of the queue renumbering (a file renumbered twice by neighbours from the same call counts once). Every refusal visible before a move happens before the first move; a file-system failure in the middle of a call is not undone — the check is atomic, the move is not.
- Into `queue`: sets Order and removes Previous order. Out of `queue`: removes Order and keeps its number in Previous order, where `--restore` reads it. A return to `queue` without `--restore` discards the saved number, with one line per task that had one.
- A task already in `queue/` with `--top`/`--after M` is reordered, not moved: its place is computed as the bullet "Queue position" describes, without the task itself among the neighbours; only Order changes, the file stays and no links are rewritten.
- Into `active`: writes Taken. Into `deferred`: appends the Deferred section only when there is none; when there is one, the file stays as is and a line asks to check the reason and return condition. A Deferred heading inside a fenced example is not a section.
- Into `minor`: needs evidence — an Evidence section with text and without a placeholder, or `--evidence "…"` (one number only). A `task.md`-shaped card is reshaped: the Context, Work to do, Out of scope and Verification sections made only of placeholders are removed; in every other section but Evidence, a placeholder line by the gate 4 line rule ([03](03-lint.md)) is cut, while a table row with a written cell stays with its placeholder cells emptied. A Context with text and no Evidence becomes Evidence.
- `--evidence` writes an `Evidence: …` line in place of the first placeholder line of the Evidence section that is not a table row, otherwise at the end of the section, otherwise as a new section. `mv N minor` adds `Cost: minor` when the field is missing, and erases Scope when its value is entirely a `[TODO…]` placeholder by the gate 4 rule (a value that only starts with one stays).
- Links: outgoing links of the file are recomputed from the old directory to the new one, and incoming links are rewritten across the repository's markdown. The rewritten forms are the local forms gate 1 reads: inline links and images, both destinations of a badge, HTML `<a href>`, and reference declarations, including in a blockquote or a list item. The target is read by the [link rule](03-lint.md#link-rule), so a `%`-encoded link (`my%20docs/…`) is rewritten too and stays encoded; a `#…`/`?…` tail is kept; a link whose decoded target does not change is not touched. Rewriting matches the complete written filename, including literal backticks: a link to a distinct unmoved file stays as written. A link with a broken `%` escape is not decoded: an outgoing one is recomputed as written, an incoming one stays. A file's link to itself, relative or root, points to its new place.
- A file lying flat in `docs/backlog/` (a migrated foreign tracker) moves too, with links recomputed for the deeper path.
- Queue position (with `--top`, `--after M` and `--restore`) is computed before the move, so a refused `--after` leaves the file untouched, and it is computed afresh for each number when its turn comes:
  - to the end: the maximum plus 10; `--top`: the middle between zero and the first; `--after M`: the middle between M and the next;
  - `--restore`: the saved number when it is free, otherwise the place right before whoever holds it;
  - with no integer place left, the whole queue is renumbered in steps of 10, order kept, and the command says so.
- `--restore` returns a place, it does not guarantee a number: rank is absolute, and the queue may have been renumbered. A line says whether the task took its saved number, the nearest free one, or the place before a neighbour from the same call.
- `--restore` with several numbers: each number comes from its own header, and the restored tasks end up in ascending order of their saved numbers, equal numbers by task number, whatever the argument order. The tasks are processed in descending saved numbers; each next task is placed no later than the neighbour placed before it — a free number behind that neighbour, or one held by a task behind it, gives way to the place right before the neighbour, with the middle of the gap or a renumbering, as for a held number.

Output:

- One line per task: `✔ <id>: <from>/ → <to>/ (<path>)`, or `✔ <id>: queue/ “Order” <rank>` for a reorder; then its notes — the saved position restored, taken, or placed ahead of a neighbour from the same call, a discarded saved position, placeholder-only sections removed, Context became Evidence, outgoing links recalculated, task links updated.
- After the last task: the queue renumbering summary; for `deferred`, a line asking to complete the new Deferred section, or to check an existing one; for `minor`, a line when `Cost: minor` was added, asking to adjust it for a hypothesis of a costlier finding.

Refusals:

- No task numbers or no status named; an unknown status (tasks are closed with `archive`); `--top`/`--after`/`--restore` with a target other than `queue`.
- No such task; the task is in the archive; already in that status (in `queue/`, without `--top`/`--after`/`--restore`).
- `--after` target not in the queue, or the task itself; the `--after` target sits in `queue/` without an integer Order; a number named twice in the call; `--top`/`--after` with several numbers (one number cannot place several tasks; `--restore` is not limited so); two position flags at once.
- `--restore` for a task of the call without Previous order, or with a non-integer one — a refusal for the whole call, by name, before the first move.
- Into `minor` without evidence for any task of the call — by name, before the first move; `--evidence` not into `minor`, or with several numbers.
- A destination path taken by a file or a directory, or a destination status directory that is a file — before the first move.
- A destination status directory that is a symlink leading out of the project — before the first move.
- A failure of `git ls-files` other than "not in the index" (a signal, a launch error, an unexpected code) — before the move.

### archive

Behaviour:

- `git mv` into `archive/<id>-<slug>/task.md` and a `result.md` blank whose verification line names the gates command through the project's `cli`, and the mutation probe only where `probe` is declared. Outgoing and incoming links are rewritten across the repository's markdown, as `mv` does: inline links and images, both badge destinations, HTML `<a href>` and reference declarations keep their syntax while only the path changes; the card's link to itself becomes `task.md`, and a root link becomes `/<docs>/archive/<id>-<slug>/task.md` from the repository root — with the subproject's path in a monorepo.
- A file lying flat in `docs/backlog/` is found too and moves into the archive with the same link rewrite. A file outside the git index (or with no repository) is moved by a plain rename, with a warning.
- `--into M` closes a minor entry by batch M: the file goes into `archive/<M>-<slug>/minor/` with the same link rewrite and gets no `result.md` of its own; the batch's `result.md` names the outcome for the entry. The batch is closed first: an unclosed batch's directory in the archive would read as a second file of its number.
- The files under `<docs>/` and `CHANGELOG.md` that the task's work touched are always printed ([01 § Archive](01-layout.md#archive)): the selection takes the commits whose subject starts with `<prefix>-N:` (the number compared as a number; the body does not count, because a squash drags other subjects into it), and `--range` adds the commits of the range. Tracker cards (`<docs>/backlog`, `<docs>/archive`) are left out.
- Paths are from the project root even when the project lies in a subdirectory of its repository. A merge commit adds only what the merge itself changed (`--cc`); branch files come through their own commits — as part of the range with `--range`, and without it only those whose subject starts with `<prefix>-N:`. `archive` writes nothing into `result.md`.

Output:

- Both path lists are indented by four spaces under their line.
- `--dry-run` prints no `✔` success line: instead, `would update links in N files` and, at the end, one line `--dry-run: nothing was written`.

Refusals:

- No such task; already archived; the directory is taken; a failure of `git ls-files` other than "not in the index" — before the move.
- `--range` empty, or a revision that does not parse — a refusal in git's words, not an empty list; `--range` without `..` (one revision would give all history up to it) — the refusal names the form `<base>..HEAD`.
- With `--into`: the entry is not in `minor/`; no such batch; the batch is itself a minor entry; the batch is not closed yet; the batch is already folded into the journal (minor entries are closed before the batch is folded); `--range` together with `--into`.
- With `--range`, a git failure while checking the repository, other than "no repository" and "git is not installed" — a refusal with the cause.

### fold

`fold <N>` folds one closed task into a line of `<docs>/archive/LOG.md` (the line form is in [01 § Archive](01-layout.md#archive)); `fold` without a number folds the accumulated archive.

Behaviour of `fold <N>`:

- The task directory leaves the tree, and `task.md` and `result.md` go whole into the draft of the commit message. Every body line goes into the draft behind a `> ` mark, an empty line as a bare `>`: git's message cleanup (`commit.cleanup=strip`, editing the message in an editor, `--amend`) strips lines starting with `#`, and with them the headings of the task and the result; `show` removes the mark.
- The closing date and the outcome come from `result.md` as [01 § Archive](01-layout.md#archive) describes. The commit field stays `—` while the body is not in history; `show N` then finds the commit by the body section in its message, or else by the subject.
- An attachment is any file of the directory other than `task.md`, `result.md` and batch entries in `minor/`, at any depth. A file git ignores (`.gitignore`, `info/exclude`, `core.excludesFile` — `.DS_Store`, for example) is not an attachment unless git ignores the task directory itself (`git check-ignore -q --no-index -- <dir>/`): in a directory ignored whole, and outside a repository, every file counts. Attachments do not go into the draft, so `fold N` refuses while any attachment is not in `HEAD` as it is on disk: an unsaved attachment is never deleted.
- Incoming links move to the line's anchor — together with the old anchor, because the `#context` of a vanished file means nothing on a journal line. Rewritten are links to the directory itself, `task.md`, `result.md` and batch entries, root ones included (`/docs/archive/…` resolves from the repository root, by the [link rule](03-lint.md#link-rule), and stays a root link), and links to the directory with a trailing slash. The forms are the local forms gate 1 reads: inline links and images, both badge destinations, HTML `<a href>` and reference declarations, including in a blockquote or a list item. A `%`-encoded link moves too and stays encoded; a link with a broken `%` escape is never decoded and never rewritten.
- A batch entry leaves with its batch and gets a line of its own with the outcome `batch M`; entries go in numeric order (`1.2` before `1.10`). Anything but a file in `minor/` — a directory, a broken link — `fold` does not read; `lint` gate 5 names it. A journal with CRLF stays CRLF: appended lines take the file's line ending.
- The acceptance procedure: the draft lands outside the working tree — `fold N > "$(git rev-parse --git-dir)/BACKSLOP_DRAFT"`, because `git add -A` would otherwise take it into the task commit — and the final acceptance commit carries it as its message: `git add -A`, `git reset --soft <base>`, `git commit --cleanup=verbatim -F "$(git rev-parse --git-dir)/BACKSLOP_DRAFT"`. `--cleanup=verbatim` stops git from cleaning the message at all. The subject is `<prefix>-N: <what was done>`.
- **Do not commit between `archive N` and `fold N`.** A directory committed between them gives the line that commit as its revision, and a squash before the push drops it from history. A `fixup` onto the worker's commit discards the draft, and nothing is squashed after the fold. `lint` gate 13 catches a revision that is not in the history of `HEAD` ([03](03-lint.md)), so `lint` runs on the final commit, before the push.

Output of `fold <N>`:

- The draft goes to stdout, the report to stderr as lines without a symbol, paths indented by four spaces: `fold N | git commit --cleanup=verbatim -F -` commits the output without cleaning it.
- Links into the folded directory that go around the rewritten targets have nowhere to point: the report names them — including a link with a broken `%` escape whose path as written leads into the folded directory — as a separate count of links into the folded task left unrewritten, with a `file: target` list; `lint` gate 1 reports them as broken in `docs/**` and root `*.md`.
- The last report line and the draft's opening say which case this is: with `—` in the field, the commit carrying the draft is required, since the draft is the body's only storage; when the line names a revision, the draft is only a copy — `show N` reads the body until a squash or `reset --soft` drops that revision from history. The last line also names `--cleanup=verbatim`.
- A `git rm` refusal is one `✖` line with git's cause and the next step.

Refusals of `fold <N>`:

- No such task; already folded; not in the archive; a batch entry, which folds together with its batch; no `task.md`.
- `result.md` missing, empty, or failing a [gate 5](03-lint.md#gates) predicate — a placeholder left, or no outcome word in the first paragraph or heading; the outcome refusal carries gate 5's message. (The bulk fold does not refuse on it; see [01 § Outcome words](01-layout.md#outcome-words).)
- An attachment not in `HEAD`, or differing from it — the refusal names the files and says to move them out of the directory and link them from `result.md`: a commit between `archive` and `fold` is not part of the acceptance recipe.
- `--embed-missing` with a number; more than one number; a git failure while checking whether the task directory is tracked — before any directory is deleted.

Behaviour of the bulk `fold`:

- The same directories, but each task's body is taken from history, and the journal line names the revision `show` reads it from: the last commit that touched the body's directory (`git log -1 -- <dir>/`) — a `result.md` completed after archiving counts too.
- Before deletion, every file of the directory from the revision is compared with it by blob id (`git hash-object`), that is after the same cleaning `git add` does: a working tree with CRLF over an LF blob is not a divergence. A blob committed with CRLF before `core.autocrlf=true|input` hashes differently; such a file, without a flag in `git ls-files -v`, is compared a second time — `git diff --quiet <revision> -- <file>` — and passes when git calls it unchanged.
- A file under `.gitignore` is not in the revision and leaves with the directory (the ignored-file rule is that of `fold N`; a directory ignored whole counts every file).
- A directory with an uncommitted edit gets no revision, since its last commit then carries another version; so does a file that differs from the revision while `git status` shows no edit (`assume-unchanged`, `skip-worktree`).
- The revision is missing for four causes, with different answers. No repository, the directory is not committed (a new file counts even with `status.showUntrackedFiles=no`) and a file does not match the revision — differs from it, or `git hash-object` cannot read it (deleted bypassing the index) — are refusals: history could not be checked, which is not proof that the body is absent. No body in history (no commit touched the directory, or the revision lacks the task, the result or a batch entry) is proof: by default the body leaves with the directory, and the command prints on stderr which task was dropped; `--embed-missing` carries such bodies into the message draft whole.
- `--embed-missing` carries no attachments: a directory with no body in history that holds an attachment not saved in `HEAD` is a refusal before the first write, listing the files, not a skipped directory.
- `--older-than` takes only tasks closed strictly before the named date; the closing date is read as [01 § Archive](01-layout.md#archive) says, and a record with no date and no revision is not taken.
- Journal lines and the draft's list go in closing-date order — the dates that stand in the lines — and equal dates by number.

Output of the bulk `fold`:

- The draft lists tasks and revisions, not bodies: the last report line says so — the bodies are read by `show N` through the line's revision, and for lines with `—` whose body left with its directory without `--embed-missing`, that the body is stored nowhere. A commit of the draft for the sake of bodies is required only with `--embed-missing`, when the draft carries bodies.
- The draft's opening promises the bodies in history only when every line named a revision; otherwise it names the tasks of the `—` lines and says whether their bodies are below or lost.
- A body carried by `--embed-missing` goes in sections `--- <dir>/task.md ---` behind the same `> ` mark as in `fold N`, and `show N` finds it by its section.
- Nothing to fold: the line "nothing to fold" goes to stderr, stdout stays empty, and `fold > "$(git rev-parse --git-dir)/BACKSLOP_DRAFT"` commits nothing with it as the message.

Refusals of the bulk `fold`:

- `--older-than` not in the form `YYYY-MM-DD`; `--older-than` or `--embed-missing` with a number; no git repository; the directory of a selected task is not committed.
- A file of the directory differs from its version in the revision — the refusal names the file, names an index flag only when `git ls-files -v` shows one, and under `core.autocrlf` names the cure `git add --renormalize <dir>`; a file `git hash-object` cannot read — the refusal names git's cause.
- With `--embed-missing`, an attachment of a directory with no body in history is not in `HEAD` — the refusal names the files.
- Any other preparation refusal of any selected task — they are all computed before the first write; a `git rm` refusal.

### show

Behaviour:

- When the journal line names a revision, `show` reads it. Otherwise (`—`) it looks for the commit whose message carries the task's body section — `--- <task dir>/…` or `--- …/minor/<entry>.md ---` (`git log -F --grep`; the newest of several) — and without one, the commit by the subject `<prefix>-N:`, the same sign `archive` uses for the task's commits (the colon is required, the number is compared as a number, the first message line decides). `tracks` uses a looser sign: any subject that starts with `<prefix>-<digit>`.
- From a revision it prints **files** — `git show <rev>:<path>` for the task, the result and a batch entry file, the task first. Paths come from the revision's tree (`ls-tree` over `<docs>/archive`), not from the number: an entry closed by a batch lies in the `minor/` subdirectory of another directory.
- Other files of the directory — attachments — are not printed: their paths are listed under the section `--- attachments ---` (the Russian heading with `lang: ru`), and stderr names `git show <rev>:./<path>`. For a `—` line `show` names no attachments at all: the body is read from the commit message, which carries none, even when they are in history.
- When the revision has no body file — the `—` case, where the body is in the commit message — the message is read, `git show -s --format=%B <rev>`, without the diff: a bulk-fold acceptance commit weighs megabytes, and the body is not in the diff; a stderr line names the reason. Only this task's sections are printed from the message, with the `> ` mark removed; a body without the mark (folds made before it) is printed as is; a message without the task's section is printed whole.
- A body that does not open with the line `# <prefix>-N · …` is printed as is, with a warning on stderr: git's message cleanup may have stripped the headings.

Output: the body to stdout; the header "number · date · outcome · revision" to stderr.

Refusals: no such task; not folded (the body is in the tree, and the path is named); no git repository; a git failure while checking the repository, other than "no repository" and "git is not installed" — a refusal with the cause; no revision in the line or by subject; `git show` could not read the commit.

### adr

- Behaviour: writes `docs/adr/adr-NNN-<slug>.md` from the template with the next number ([01 § ADR](01-layout.md#adr)); an empty or blank `--title` makes the slug the title.
- Output: the file, and a reminder to add the row to the `docs/README.md` table.
- Refusals: a bad slug; a slug that makes the file name longer than 255 bytes; `docs/adr` is a file, not a directory.

### brief

Behaviour:

- Prints a worker brief to stdout: the track heading, the task definitions of the named tasks from disk (Work to do and Out of scope), the project's `gates`, `prefix`, `cli` and `probe`, and the fixed sections of [templates/brief.md](../../templates/brief.md). The worker boundary is stated there.
- The orchestrator's decisions come as text arguments: `--track` — the track title; `--neighbour` (repeatable) — edit boundaries; `--entry` — where the subject lives and what to read first; `--autonomy` — what the participant closes alone and what goes to the orchestrator; `--handover` — the gate protocol and the report header. These are the brief slots; a slot without its flag is a placeholder ([05 § brief](05-orchestrator-contract.md#brief)). `--measurements` adds the measurement rule.
- The probe bullet and the probe item of the result contents appear only where `probe` is declared, and the bullet names the mutation-probe command with the same `agents-probe.md` template as the managed block.
- The command only prints: where the brief goes is the orchestrator's decision.

Output:

- stdout is the brief, stderr the notes: [05 § brief](05-orchestrator-contract.md#brief). Without `probe`, a note goes to stderr.
- When `cli` is pinned below 0.10.0, stderr says the pinned version does not support `new --minor --evidence` and suggests `<cli> upgrade`; stdout does not change. An unpinned or floating `cli` gets no such note.

Refusals: no task numbers named; a task found neither in the statuses nor in the archive (no partial brief is printed); `--neighbour` not in the form `path=track`; an archived task without `task.md` — there is no definition; a folded task is read with `show N`.

### seed

Behaviour:

- `--scan` prints candidates for `gates` — `package.json` scripts, `Makefile`/`justfile`/`Taskfile` targets, steps of `.github/workflows/*.yml` and `.gitlab-ci.yml`, `dotnet build`/`test` by `*.csproj`/`*.sln`, `pytest`/`ruff`/`mypy` by `pyproject.toml`/`setup.cfg`/`tox.ini` — and for subsystems — `src/*`, `services/*`, `apps/*`, `packages/*`, `.csproj` projects, entry points, and `bin/*` scripts by extension (`.js`/`.mjs`/`.cjs`/`.ts`/`.sh`/`.py`/`.rb`, dots in the name allowed) or an extensionless file starting with `#!`. Each item carries an evidence path; the choice stays with the agent and the owner.
- A `dotnet` path with a space or a shell metacharacter (anything but `[A-Za-z0-9_./@+,:=-]`) is put in double quotes, which both sh and cmd.exe understand; a path with `"`, `$`, a backtick, `\` or `%` gets no command, and the output warns that it has to be quoted by hand.
- The walk skips build output and environments (`.venv`, `venv`, `vendor`, `dist`, `build`, `out`, `target`, `obj`, `bin`, `coverage`, `.tox`, `__pycache__`), `.git*`, `node_modules`, `.claude/worktrees` and linked worktrees of this repository; a submodule is walked.
- `--queue-reference` reads the table of `<docs>/reference/README.md` and queues `describe-<slug>` for every row whose section file is not written yet. The row's link target is read by the [link rule](03-lint.md#link-rule); the slug comes from the target file name. The queued task's Scope is the table row with a link to the reference index (the section itself is not written yet).
- A collision — two rows, or an already filed task, with one slug for different files — takes the parent directory's name into the slug (`api/README.md` → `describe-api-readme`), and the output names both hrefs, or the href and the task the slug matched (its number or card path).
- A repeated run files no duplicates and counts the skipped ones: a task with the same slug is seeded when any code span of its Scope names the same file, and a Scope without a code span decides by the slug alone; a folded task is seeded when its journal title is `Reference: <label>` of this row (or the Russian form of that title), otherwise it is a collision, as for a live task.

Output: the text listing, or `--scan --json`: [05 § `seed --scan --json`](05-orchestrator-contract.md#seed---scan---json).

Refusals: no mode named, or both; `--json` with `--queue-reference`; no `reference/README.md`; a git failure while finding the repository root, in `git worktree list` for `--scan`, and while scanning foreign numbers, as for `new`. Tasks filed before a refusal stay, and a repeat skips them.

### status

- Behaviour: a summary by directory; the `Minor` section goes by Scope — that is how batches are cut — with an empty Scope last. A status directory or an archive task directory that is a symlink leading out of the project is skipped, and the command prints a warning naming it ([01 § Symlinks and traversal](01-layout.md#symlinks-and-traversal)).
- Output: text, or the JSON of [05 § `status --json`](05-orchestrator-contract.md#status---json).
- Refusals: none of its own.

### lint

- Behaviour: the tracker gates, gate 15 on project documentation included, the adapter checks and template parity — [03](03-lint.md). A status directory, `docs/backlog`, `archive/`, a batch's `minor/` or `adr/` that is a file is an error of gate 3, 5 or 8 with its path, not a crash.
- Output: on stderr, one `✖` line per error and one `⚠` line per warning; on stdout, a note per gate 15 class that was skipped (no `origin` remote, no git index), then the line of what gate 1 read, `gate 1: files N, links N, local N, anchors checked N`. Then the summary with the warning count: `lint: no errors` on stdout, `lint: errors N` on stderr.
- Refusals: errors found (exit 1); an unknown flag; a directory the walk cannot read (`EACCES`, `EPERM`) — `<path>: the directory is not readable (<code>) — lint cannot walk it; restore read access or move it out of the project`, with the path from the project root instead of a stack. The other commands word an unreadable directory the same way, naming what they cannot do: `tasks cannot be read from it`, `task numbers cannot be read from it` (a status directory of another worktree), `links in it cannot be updated`, `pins cannot be read from it`. A status directory or the archive that cannot be searched is the same refusal, naming the directory that denies it — never an empty backlog. `mv`, `archive` and `fold` run the link walk before the first move or write, so that refusal leaves the tree as it was.

### gates

Behaviour:

- Runs the `gates` commands in order, each through the shell, with a ceiling of 10 minutes per gate: a stuck command would otherwise hold the run forever.
- A green gate is exit code 0 without a launch error. A gate that hit the ceiling (`error` with the code `ETIMEDOUT`, with or without a signal) prints "timed out after the 10-min cap"; a signal without the ceiling prints "killed by signal SIG…"; any other launch error prints "did not start: …". All three are ✖, do not count as green and turn the total red whatever the code. The ceiling usually gives ETIMEDOUT with SIGTERM, and a shell that survived SIGTERM gives ETIMEDOUT with no signal and code 0: in `--json` such a gate has `code` 0 and a non-empty `error`.
- An entry with a `when` scope runs only when the set of changed paths touches one of its patterns (the pattern rules are in the [config table](01-layout.md#backslopjson)); a skipped entry prints a line with the reason and the patterns, is counted as `outOfScope` inside `skipped`, and is not added to the green count. The total turns red only from a red gate: a run where everything that ran is green returns 0, skips or not.
- The path set: without `--base`, the dirty tree; with `--base <ref>`, `git diff --name-only <ref>..HEAD` (with `-c diff.relative=false`: paths from the repository root whatever the config) plus the dirty tree. Paths are brought to the project root: in a monorepo the directory prefix is stripped and printed in `scope.prefix`, and a path outside the project leaves the set and is counted in `scope.dropped`. The source, the base and the set itself are printed in a line `scope: …` and in the `scope` field.
- The set is computed only when some entry carries a scope or `--base` is named; without git it is not computed at all, and every gate runs.
- Without `--keep-going` the run stops at the first red gate.
- `--require-clean` refuses a dirty tree before the first command. On an empty set every scoped entry is skipped; a run that declares itself an acceptance with `--require-clean` refuses that, judged by the set, not by the flags: an empty set also comes with a named base — `--base HEAD`, or `--base origin/main` on a branch already merged, give a clean tree and an empty diff. A non-empty set that touched no scope is not refused: that skip is honest. Without `--require-clean` an empty set stays an honest answer for the chosen source — nothing was touched. An acceptance run on a project with scopes goes with `--base`, otherwise it confirms only the entries without a scope; the numbers in the total show it.
- The tree snapshot is `HEAD` and cleanliness, when there is git. In a monorepo the snapshot and `--require-clean` look only at the project directory (`git status --porcelain -- .` from the project root), with paths from the project root, both sides of a rename, and an untracked project directory as a whole shown as `./`. In a repository without commits `head` is `null`, and the output line says there are no commits yet.
- `--dry-run` prints the whole list with each command's scope, running nothing and computing no set.

Output:

- One line per gate — the command, the outcome (its exit code, the ceiling, a signal, or no launch) and the time — and at the end "gates N, green M" with the tree snapshot. An entry skipped for its scope is named on a line of its own and counted separately. The summary adds ", not run N" only when N is not zero, and " (out of scope K)" only when K is not zero; `--json` always carries `skipped` and `outOfScope`.
- `--json` and `--json --dry-run` give the same content in machine form: [05 § `gates --json`](05-orchestrator-contract.md#gates---json).
- A gate that is not green — a non-zero code, a signal, or a launch error, code 0 included — is a red result, not a refusal: exit 1, with the result on stdout for `--json` ([05 § Exit codes](05-orchestrator-contract.md#exit-codes)).

Refusals:

- `gates` is empty.
- `--require-clean` on a dirty tree or without git; `--require-clean` with an empty raw set of changed paths while some entry carries a scope — no base named, or the base gave no diff. A diff to the base that went entirely outside the project does not refuse, and a neighbour package's dirt in a monorepo does not lift the refusal.
- `--base` empty, without git, or on a ref that does not resolve; `--dry-run` with `--require-clean` or `--base`.
- A git failure while checking the repository, other than "no repository" and "git is not installed" (then every gate runs), or a failure of `git rev-parse --show-prefix` in a repository: a refusal with the cause before the first command, not an empty prefix that would compare `when` patterns with paths from the repository root.

### tracks

Behaviour:

- Lists the worktrees and local branches of a run: path, branch, whether it is merged into `HEAD` (`merge-base --is-ancestor`), the `<prefix>-N` commits not in `HEAD` (by commit subject, not body: a squashed commit drags other subjects into its body), and uncommitted work in the worktree. A detached worktree is measured by its sha.
- The current tree and branch are not listed; a branch without a worktree is listed only when it carries task commits not in `HEAD`. A branch name is always read as a revision, even when it equals a path (`docs`).
- A `git log` failure for a branch gives `pending: null` in `--json` and the line "task commits not in HEAD: could not be checked" rather than an empty list; a branch without a worktree with that answer stays listed.
- For a `prunable` worktree — its directory is gone — `git status` is not called, `dirty` is `null`, and instead of the uncommitted line the listing prints "directory is gone — git worktree prune". A `locked` worktree gets the line "locked — git worktree unlock, then remove".
- The command only observes: `git worktree remove` and `git branch -D` remove.

Output: the text listing, or `--json`: [05 § `tracks --json`](05-orchestrator-contract.md#tracks---json).

Refusals: no git repository; a failure of `git worktree list`, `git rev-parse --show-toplevel` or `git for-each-ref` — with git's cause, not "no repository" and not an empty list.

### links

Behaviour:

- `--external` is required: `links` alone is a refusal, because gate 1 of `lint` already checks the local links and the command has no local mode.
- Takes the `http` and `https` addresses of the files gate 1 reads, with the same parser (every link form, code and comments left out), in document order. An address without its fragment is one address: `…/a#x` and `…/a#y` are requested once, and the row carries the address without the fragment. Links to anything else (`mailto:`, relative paths, anchors) are not requested.
- Requests the addresses one at a time with the global `fetch`: `GET`, redirects followed, a 20-second limit for each, the user agent `backslop-links`. There are no retries, no backoff, no authentication and no `robots.txt`.
- The class of an address follows its final answer:

| Class | Answer |
|---|---|
| `ok` | 2xx and 3xx |
| `unverified` | 401, 403, 408, 429, any 5xx, or no answer: a refused connection, a failed name lookup, the timeout, an address `fetch` rejects |
| `dead` | 404, 410 and every other status |

- A network answer is not reproducible, so the command is never part of `gates` or `lint`, and `init` does not add it to `gates`: run it by hand.

Output: one row per address, `<class> <status or error> <url>`, where the second word is the HTTP status or, without an answer, the error code (`ECONNREFUSED`) or name (`TimeoutError`); then `links: N urls, D dead, U unverified`. With `--json` one document replaces both: [05 § `links --external --json`](05-orchestrator-contract.md#links---external---json).

Exit codes: 0 when every address is `ok`, or there is none; 1 when any is `dead`; 2 when some are `unverified` and none is `dead`. A refusal (no `--external`, a bad flag, a malformed config) is exit 1 with an empty stdout.

### hook

Behaviour:

- The command is what the agent hook records run; it reads the event JSON of the harness on stdin. The event needs a non-empty string `session_id`, the field all three harnesses name that way ([01 § Agent hook files and protocols](01-layout.md#agent-hook-files-and-protocols)). The loop flags of the payloads, `stop_hook_active` and `loop_count`, are not read: the ceiling below counts on its own.
- `session-start` writes the session record: the id, the harness, the start commit (`git rev-parse HEAD`; in a repository without a commit, the empty tree) and the time. The record is a file under `backslop/hooks/` in the git directory of the working tree ([01 § Session records](01-layout.md#session-records)). It prints nothing and exits 0. A second `session-start` for the same session replaces the record, the count of returned turns included.
- `stop` builds the changed set of the session: every path that differs between the start commit and the working tree — committed since the start, staged or not — plus the untracked files that git does not ignore. Without a record, the start is `HEAD`.
- An empty changed set exits 0 without running `lint`. Otherwise the command runs the `lint` gates in the same process, keeps the errors whose file is in the changed set, and ignores every warning and every error that names no file. The changed paths are repository-relative and `lint` prints project-relative ones, so a project below the repository root maps one to the other.
- No kept error exits 0. Kept errors return the turn: the lines `<file>: <message>`, one per distinct error, then one line that tells the agent to fix them in the files named and not to bypass the hook. The protocol is the harness's:

| Harness | The turn is returned by | A note for the user |
|---|---|---|
| `claude`, `codex` | the text on stderr, exit 2 | `{"systemMessage": "…"}` on stdout, exit 0 |
| `cursor` | `{"followup_message": "…"}` on stdout, exit 0 | the text on stderr, exit 0 |

- **The ceiling.** The session record keeps how many times in a row the stop returned the turn, whatever the errors were: an edit that moves a line or changes the error does not restart the count. After three returns the next stop lets the turn end and gives the user a note that names the current errors; the following stops with kept errors do the same. Only a stop with no kept error resets the count. A stop without a record writes one, with `HEAD` as the start, when it returns the turn for the first time.
- **The hook never breaks a session.** Outside a git repository, without a readable `backslop.json`, with a stdin that is not a JSON object with a `session_id`, with a `harness` outside `claude`, `cursor`, `codex`, and on any error of its own — an unreadable directory that `lint` cannot walk, a record that cannot be written — it exits 0 and prints one note, `hook skipped: <cause>`, on the note channel of the harness (stderr for an unknown harness). It never returns the turn in those cases.

Output: nothing, the text that returns the turn, or one note, as above.

Exit codes: 0 in every case but a returned turn on `claude` and `codex`, which is 2. A usage refusal — an event other than `session-start` and `stop`, an extra argument, an unknown flag — is exit 1 and is a mistake of the hook record, not of the session.

Checked live on 2026-10-02 on Claude Code 2.1.284 (the record is the message of commit `74c73a2`), in two `claude -p` sessions of a throwaway project with the records written by hand: a broken anchor in a file the session created returned the turn once, with the error line in the `Stop hook feedback:` message; a broken anchor in a file the session never touched did not return it. Not checked: this command under Codex and Cursor, which follow the protocols measured in [01](01-layout.md#agent-hook-files-and-protocols) (for Cursor, only in the interactive terminal, where `stop` fires), and the note channels — `systemMessage` for `claude` and `codex`, stderr for `cursor` — which no run showed to the user.

### upgrade

Behaviour:

- Updates only upward. Tags `vX.Y.Z` come from `source` or from the `cli` form. `--to` picks a tag other than the latest, or repeats an update to the same version after a failure.
- The pin forms of `cli` are `npx [flags] github:owner/repo[#vX.Y.Z]` and `npx [flags] backslop@X.Y.Z`; npx flags are kept. `npx backslop` and `npx backslop@latest` are the npm form with no pin: `lint` warns, and `upgrade` does not derive a pin from the registry. The GitHub form gives a tag source; the npm form does not, and without `source` `upgrade` refuses. A `cli` in neither form (a global install, the tool's repository) keeps its pin untouched, and the new version's commands run through the same `cli`; without `source` that case is a refusal too.
- Steps: a trial `<new cli> version`, whose printed version is checked against the target — the first run goes with the terminal as is, so npx's install question is visible, and the version is read from a second, quiet run; a `cli` that still runs the previous installation is a refusal before any write. Then the pin in `cli`, and in the `gates` and `probe` commands every occurrence of the `cli` spec's pin with any number, not only the leading command. Then `<new cli> migrate` — which redraws the rules pair from the new version's template — and `<new cli> init`.
- After them, pins in the [live-pin files](03-lint.md#live-pin-files) are rewritten by the `cli` spec with any number, so prose two versions behind is fixed too. A file behind a symlink on any path component and a file not in UTF-8 are not rewritten — a warning names the path and the link or the encoding, only for a file with an old pin; a file without a pin is skipped silently. A suffixed pin (`#v0.1.0-rc.1`) is not rewritten either; `lint` reports it. The number of rewritten files is printed when the rewrite happens, not in the plan.
- Last, `<new cli> changelog --since <old> --to <new>` (without `--since` when there is no old version). The old version is the lower of the `cli` pin and the stamp: a stamp behind does not hide CHANGELOG entries, and when the two differ the plan names both; a downgrade is checked against the pin.
- A pin and a stamp on the latest tag give "already on vX", but not while a live file or a `gates`/`probe` command still carries a stale or suffixed pin. An old pin in a file `upgrade` cannot rewrite does not stop "already on vX"; `lint` names the manual edit for it. A `cli` form without a pin (`npx github:owner/repo`, `npx backslop`, `npx backslop@latest`) gets an exact pin even on the latest tag; "already on vX" is said only to an exact pin.
- `--pin-only` cuts the tail: it changes only the config (the pin and the `gates` and `probe` commands) and does not rewrite prose. After a manual `migrate` and `init`, the next full `upgrade` checks the live files and moves their pins even on the same latest tag. The trial of the new version runs with `--pin-only` too.
- Everything that depends on the format is done by the new version, so `upgrade` can run from an old one. The new version's commands run through the shell from the `cli` string as is — the same trust in `backslop.json` as `gates`.
- The steps (`version`, `migrate`, `init`, `changelog`) run through the shell with the `gates` runner and its 10-minute ceiling: a step passes only with code 0 and no launch error, so the ceiling stops `upgrade` even when the shell survived SIGTERM and exited 0.

Output: the plan (`--dry-run` stops there and writes nothing), each step, the rewritten-file count, the CHANGELOG excerpt.

Refusals:

- No source and no `npx github:` form; `--to` not in the form X.Y.Z — before the source is asked; no `--to` tag in the source; a target below the current version.
- `ls-remote` or the trial run failed, or the trial printed another version than the target — the pin is untouched.
- A failure after the pin — the refusal names how to finish: `<new cli> migrate && <new cli> init`, then `<new cli> upgrade` for the live pins. A step refusal names the step's outcome in `gates` words — the code, a signal, the ceiling or no launch — and the same recovery.

### migrate

Behaviour:

- Runs the tool's migrations whose version is above the stamp, then stamps; a project without a stamp counts as older than every migration.
- With the stamp below the tool version, or missing, it also redraws the rules pair (`<docs>/backlog/README.md`, `<docs>/archive/README.md`) from this version's template; the rules are in [01 § The rules pair belongs to the tool](01-layout.md#the-rules-pair-belongs-to-the-tool). A leading BOM does not count as a difference; at the tool version, neither does a difference in line endings alone.
- Migrations: below v0.10.0 — the closed-task journal `<docs>/archive/LOG.md` from the template; below v0.12.0 — deleting an untouched copy of `<docs>/ROADMAP.md` together with its two lines in `<docs>/README.md` ([01 § ROADMAP.md is not part of the layout](01-layout.md#roadmapmd-is-not-part-of-the-layout)). The journal migration creates an empty file and deletes no archive directory: folding what has accumulated is a separate `fold`, not a side effect of an upgrade.
- `init` and `migrate` refuse when the stamp is newer than themselves: a downgrade is not supported.

Output: the paths it rewrote or deleted, the files it kept and why, the stamp change; `--dry-run` prints the plan.

Refusals:

- A stamp newer than the tool.
- An uncommitted edit of a rules-pair file that would be redrawn — before the first write, with `--dry-run` too, the stamp untouched. The v0.12.0 migration refuses the same way on an uncommitted edit of `<docs>/ROADMAP.md` or `<docs>/README.md` that it would delete or edit — before the first write of the whole run, with `--dry-run` too. A pin move alone is not an edit (CRLF in a checkout under `core.autocrlf` included).
- A git failure other than "no repository" and "git is not installed" — before the first write.

### changelog

- Behaviour: prints the sections of backslop's CHANGELOG with a version strictly after `--since` and not after `--to` (by default, the tool version). A section's version is the number at the start of its heading — the same rule as in `merge-changelog`.
- Output: the sections as written in backslop's CHANGELOG; only the "no entries" message follows the project language (read without validating the rest of the config), and outside a project it is in both languages.
- Refusals: a version not in the form X.Y.Z.

### merge-changelog

Behaviour:

- Merges two revisions of `CHANGELOG.md`, read with `git show <ref>:./CHANGELOG.md`: entries of the unreleased section are joined by their `- **…**` titles (a `**` inside a code span does not close a title), and released sections are taken from `--ours` whole.
- The unreleased section is the first section whose heading does not start with a version number (a `v` or `[` may precede the number: `## v1.2.3 — date`, `## [1.2.3] - date` and `## 1.2.3` are versions, while `## Unreleased (after v1.2.3)` is unreleased); without such a section, it is the top section whose version has no tag `vX.Y.Z` or `X.Y.Z` in the repository — `npm run release -- X.Y.Z --bump` leaves it so before the release, and the report names that section on a line per side, `--base` included.
- A `--theirs` side without an unreleased section reads as empty, and the report says "theirs has no unreleased section — its entries were not read"; the exit code does not change.
- Structure: a section is pairs of a `### …` heading and a bold subgroup; a subgroup is a `**…**` line from the first column, while such a line with an indent stays an entry body. A top-level bullet without a bold title is a block of its own, recognized by its text and never removed by `--base`. The parse is reversible, and the `--ours` layout does not change: an additive merge gives only additions against it. The blank lines ending the last section belong to the section: an entry placed after the last entry of a side is separated from it by one blank line.
- Placement: a one-sided `--theirs` entry goes right after the nearest preceding `--theirs` entry of the same container that is already in the same result container; without one it goes first in the container, and when the container shares no entry with the result, last: the "newest on top" convention, with a dispute over one place settled for `--theirs`.
- A one-sided `--theirs` container stays under its heading: a subgroup goes after the last container of its `### …`, and a heading `--ours` lacks arrives with its subgroups after the group of the nearest preceding `--theirs` container already in the result — the top group without a heading counts too; without one, at the end of the section. Entries and subgroups before the first `### …` are the section's top group: entries without a heading go to its start, a subgroup after the last container without a heading, or also to the start.
- A matching title with the same body is one entry; with differing bodies, both go under the mark `<!-- backslop:conflict …  -->`, the choice is the agent's, and the exit code is 1. The mark is recognized as a line starting with it, and only in the unreleased section being merged: the mark's name written in a code span in prose appears in the CHANGELOG of any project that wrote about it, and is not a mark.
- `--base` removes an entry a side lost relative to the base; without `--base` a one-sided entry is kept, and a note about it goes into the report, not the file — without a base, a removal cannot be told from a new entry.
- A repeated block within one side is always named on its own line, for both sides: the second occurrence does not reach the result, and a vanished line must not go unmentioned.
- The result goes to stdout or to `--out`, whose missing directories are created; a relative `--out` resolves from the current directory, and the report line "written:" names the path from there. The result's line endings are those of an existing `--out` file, or else of the `--ours` revision: a `CHANGELOG.md` checked out with `core.autocrlf=true` stays CRLF although its blob is LF.

Output: the report — entry counts, one-sided entries, one-sided bullets without a bold title (named on their own lines and not counted as entries), marked pairs, and each placed heading and subgroup ("heading … added before …", "heading … added at the end of ## …", "subgroup … added under …", "entries without a heading added at the top of ## …") — always to stderr. The message language is that of `changelog`.

Refusals:

- No `--ours` or `--theirs`; an empty `--base`; a revision or the tag list cannot be read.
- The `--ours` side has no unreleased section — neither a heading that does not start with a version number, nor a top section whose version has no tag.
- The unreleased section of `--ours` or `--theirs` carries an unclosed `<!-- backslop:conflict` mark.
- The result fails its self-check: a heading or subgroup appears more often than on either side, or the additive merge lost a `--ours` line to a repeated block of `--ours` — then the refusal names the repeat. This refusal is possible only when `--base` removed nothing: a merge with a removed entry is not additive, and a removed repeat there is a report line, not a refusal.
- `--out` is not written — a directory in place of the file, a file in place of a directory on the path, another file-system failure: the refusal names the path and the error code.

### version and help

- `version`, `--version` and `-v` print `backslop <version>` from `package.json`; `help`, `--help`, `-h` and `<command> --help` print the help. Exit code 0; no refusals.

## Release (repository script)

`npm run release` is a script of this repository, not a backslop command; the release procedure is in [`AGENTS.md` § Release](../../AGENTS.md#release).

- The packed files are the `files` field of `package.json`: `bin`, `lib`, `templates`, `README.md`, `LICENSE`, `CHANGELOG.md`; the tarball holds every git-tracked file under them, and beyond them only `package.json`.

## Implementation notes

- A command is the module `lib/<command>.js`, exporting `run(argv, { cwd, lang })`; `lang` is the project language read loosely (without validating the other fields), `null` outside a project, and the same loose read gives the `cli` of the unknown-command hint. A refusal addressed to a person is a `CliError`. The exit code is set through `process.exitCode`, and a closed reader pipe (`EPIPE`) exits quietly.
- Flags are parsed by `parseArgs` in strict mode through `parseCommandArgs` ([lib/util.js](../../lib/util.js)); the flags in the synopsis of each command in [Commands](#commands) are the option keys of its call. Command dates come from `today` in the same file.
- Queue placement is `placeInQueue` in [lib/tasks.js](../../lib/tasks.js). The `git worktree list --porcelain` parse is one function, `worktrees` in [lib/util.js](../../lib/util.js), used by `tracks` and by `new` for foreign numbers.
- The git output ceiling of 256 MiB replaces the 1 MiB default of `spawnSync`.
- Escaping of `agents.stepOverrides` values is complete by construction, not by a list: CommonMark declares every ASCII punctuation character escapable, and nothing but a character of that class opens a markdown construct.
- The reverse skew — a `MIGRATIONS` entry whose `since` is above the tool version — is not caught at run time: such a migration prints as due and runs again on every start, and cannot mark itself applied, because the stamp is not written when the versions are equal. The cost is another pass over the project's files each time `upgrade` calls `migrate`, so a migration body must be idempotent. [test/version.test.mjs](../../test/version.test.mjs) guards it: both numbers come from one package and differ only in the tool's dev tree, between a migration's commit and the bump.
- The release acceptance test [test/release.test.mjs](../../test/release.test.mjs) builds the tarball with a real `npm pack` and compares its content with the `files` field.
