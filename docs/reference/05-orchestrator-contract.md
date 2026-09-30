# 05. Orchestrator contract

What an orchestrator, a skill or a script may rely on when it drives backslop: how to call it, which channel carries what, the exit codes, the JSON shapes, the brief, the commands that change files, and what is stable. The full behaviour of each command is in [02. CLI](02-cli.md); this page names only what a caller parses or acts on.

## Scope and audience

- The files and the CLI are the only API. There is no library entry point, no server and no other channel.
- The contract belongs to a version. A project pins it in the `cli` field of `backslop.json` (`npx github:owner/repo#vX.Y.Z` or `npx backslop@X.Y.Z`); an orchestrator calls the tool through that field and relies on what that version documents.
- A `cli` without a tag (`npx github:owner/repo`, `npx backslop`, `npx backslop@latest`) is no contract: the version behind it changes without notice.

## Invocation

- The form is `<cli> <command> [arguments]`, where `<cli>` is the `cli` field of the project, run through a shell.
- Flag parsing is strict: an unknown flag, an extra positional argument and a flag without its value are refusals, and `--` does not lift the argument limit. A value with spaces is quoted; a value that starts with a dash is safest in the form `--flag=value`. The details are in [02 § Flag parsing](02-cli.md).
- The project is the nearest directory with `backslop.json`, going up from the current directory. A command that loads the config refuses a missing or malformed file.
- `lang` in `backslop.json` changes only human text: messages, reports and the Russian or English forms of rendered files. JSON keys and structural values do not depend on it. A JSON string that carries a reason or file text — the `skipped` reason of `gates`, a `title`, the `deferred` line of `status`, a `pending` commit subject of `tracks` — is human text inside a stable key.
- Dates the commands write are the machine's calendar date in its own time zone, in the form `YYYY-MM-DD`.

## Output channels

| Channel | What goes there |
|---|---|
| stdout | the data of a data command; the report of every other command |
| stderr | refusals, warnings, and the routine report of a data command |

- **Data commands.** A `--json` mode writes exactly one JSON document to stdout, followed by a line break. `fold` writes only the commit message draft to stdout, `show` only the task body, `brief` only the brief, and `merge-changelog` without `--out` only the merged file. Their human report goes to stderr: `fold` and `show` report there as lines indented by two spaces, and a `--json` mode of `gates` sends the gates' own output there too.
- **Other commands** (`new`, `mv`, `archive`, `adr`, `init`, `migrate`, `upgrade`, `seed --queue-reference`, and the text modes) report on stdout: a success line starting with `✔` and indented detail lines. Their warnings, their refusals and their red lines go to stderr: a red gate line and a red `gates N, green M` summary of `gates`, the errors and the summary of a red `lint`.
- **A refusal** starts with a line starting with `✖` on stderr, without a stack; some refusals add detail lines after it (`gates --require-clean` on a dirty tree lists the dirty paths).
- **`⚠`** marks a real warning — a file moved without `git mv`, a brief without a probe command — and not a failure: a warning alone does not change the exit code.
- **Colour** is added only when the stream is a terminal and `NO_COLOR` is not set.

## Exit codes

| Code | Case | stdout |
|---|---|---|
| 0 | success; `help`, `--help`, `-h`, `version`; `fold` with nothing to fold; a `gates` run where every gate that ran is green, with skips or without | the data or the report |
| 1 | a refusal: an unknown command or flag, an extra argument, a missing or malformed `backslop.json`, a bad slug, an unknown task number, a move into the current status, a minor move without evidence, a `fold` of a folded task or of a result with a placeholder, a `brief` of a folded or unknown task, `tracks` without git, `seed` without a mode, any `gates` refusal | empty |
| 1 | a red result: a gate is not green | the JSON result with `gates --json`; in text mode the gates’ own output, the green gate lines and the tree line, while the red gate lines and the summary are on stderr |
| 1 | `lint` found errors | empty; the errors are on stderr |
| 1 | `merge-changelog` left a conflict mark | the merged file, or empty with `--out` (the file is written) |
| 1 | a crash: an exception that is not a refusal | empty for a `--json` mode; a stack trace on stderr |

**Telling the outcomes apart.** For a `--json` mode:

- exit 1 with JSON on stdout is a **result**: the command ran, and the result is red (`gates --json`, a gate that is not green);
- exit 1 with empty stdout is a **refusal**: the command did nothing, and stderr says why;
- a crash is also exit 1 with empty stdout; its stderr carries a stack trace instead of a `✖` line, so a caller that reads only the exit code and stdout sees it as "no result", like a refusal.

## `status --json`

A real run on a project with a task in every status and one folded task, each list shortened to one item:

```json
{
  "prefix": "<prefix>",
  "docs": "docs",
  "active": [
    {
      "id": "<prefix>-N",
      "title": "Beta",
      "file": "docs/backlog/active/<prefix>-N-beta.md",
      "created": "YYYY-MM-DD",
      "taken": "YYYY-MM-DD"
    }
  ],
  "queue": [
    {
      "id": "<prefix>-N",
      "title": "Alpha",
      "file": "docs/backlog/queue/<prefix>-N-alpha.md",
      "created": "YYYY-MM-DD",
      "order": 10
    }
  ],
  "deferred": [
    {
      "id": "<prefix>-N",
      "title": "Delta",
      "file": "docs/backlog/deferred/<prefix>-N-delta.md",
      "created": "YYYY-MM-DD",
      "deferred": "- **Deferred:** YYYY-MM-DD"
    }
  ],
  "triage": [
    {
      "id": "<prefix>-N.k",
      "title": "Finding",
      "file": "docs/backlog/triage/<prefix>-N.k-fnd.md",
      "created": "YYYY-MM-DD"
    }
  ],
  "minor": [
    {
      "id": "<prefix>-N.k",
      "title": "Minor two",
      "file": "docs/backlog/minor/<prefix>-N.k-mnr2.md",
      "created": "YYYY-MM-DD",
      "area": null,
      "cost": "major (hypothesis)"
    }
  ],
  "archive": 1
}
```

- Every list is present, empty when its status has no tasks.
- **Nulls.** An empty or missing `title`, `created`, `taken`, `area` or `cost` is `null`, never an empty string; `order` is `null` for a queued task without an integer Order; `deferred` is `null` when the task has no Deferred section or an empty one.
- **Order.** `active`, `deferred` and `triage` are ordered by `N`, then by `k`: a task `N` comes before its findings `N.k`. `queue` is ordered by Order, then by number, a task without Order last. `minor` is ordered by Scope as a string, entries without Scope last.
- `deferred` is the first non-empty line of the Deferred section, as written in the file and in its language.
- `cost` is the Cost field as written (`minor`, `major (hypothesis)`); `area` is the Scope field as written, a markdown link included.
- `archive` is the number of closed tasks: archive directories plus `LOG.md` journal lines, without minor entries closed into a batch with `--into`.
- Paths are from the project root, in posix form.

## `gates --json`

A real run with the gates `node -e 0` and `{"command": "node -e 0 # docs", "when": ["src/**"]}` on a clean tree:

```json
{
  "gates": [
    {
      "command": "node -e 0",
      "code": 0,
      "signal": null,
      "error": null,
      "ms": 90,
      "when": null
    },
    {
      "command": "node -e 0 # docs",
      "when": [
        "src/**"
      ],
      "skipped": "skipped: the scope is untouched (src/**), 0 paths in the set"
    }
  ],
  "total": 2,
  "green": 1,
  "skipped": 1,
  "outOfScope": 1,
  "scope": {
    "source": "worktree",
    "base": null,
    "prefix": "",
    "dropped": 0,
    "paths": []
  },
  "tree": {
    "head": "<sha>",
    "clean": true,
    "dirty": ""
  }
}
```

A real run in a directory without git, with a first gate that exits 3 and no `--keep-going` — exit code 1:

```json
{
  "gates": [
    {
      "command": "node -e \"console.log('gate out'); process.exit(3)\"",
      "code": 3,
      "signal": null,
      "error": null,
      "ms": 94,
      "when": null
    }
  ],
  "total": 2,
  "green": 0,
  "skipped": 1,
  "outOfScope": 0,
  "scope": null,
  "tree": null
}
```

- **A gate that ran** is `{command, code, signal, error, ms, when}`. It is green only when `code` is 0 and `error` is `null`: a gate stopped by the 10-minute ceiling can carry `code` 0 and a non-empty `error`. `code` is the exit code, `null` when there is none (a signal, a launch error); `signal` is the signal name or `null`; `error` is the launch or ceiling error text or `null`; `when` is the entry's pattern list, or `null` for a string entry.
- **A gate skipped for its scope** is `{command, when, skipped}`, where `skipped` is a human-readable reason string, and it has **no** `code`, `signal`, `error` or `ms`: a check `code !== 0` would count a skip as red. Test for the `skipped` key.
- **Counts.** `total` is the number of entries in the `gates` field of `backslop.json`. `green` counts the gates that ran green. `outOfScope` counts the entries skipped for their scope. The top-level `skipped` is a number: `outOfScope` plus the gates that never ran because an earlier gate was red without `--keep-going`. Those gates are absent from the `gates` list, so the list can be shorter than `total`.
- **`scope`** is `{source, base, prefix, dropped, paths}`: `source` is `worktree` (the dirty tree) or `base+worktree` (the diff to `--base` plus the dirty tree); `base` is the `--base` ref or `null`; `prefix` is the project directory from the repository root with a trailing slash (`pkg/`), `""` when the project is the repository root; `dropped` counts paths outside the project; `paths` is the sorted set of changed paths from the project root. `scope` is `null` when no entry has a `when` and no `--base` is named, and when there is no git.
- **`tree`** is `{head, clean, dirty}`: `head` is the full sha of `HEAD`, or `null` in a repository without commits; `clean` is a boolean; `dirty` is one string, see [Two shapes of `dirty`](#two-shapes-of-dirty). `tree` is `null` without git.
- The gates' own output goes to stderr, so stdout carries the JSON alone.

### `gates --dry-run --json`

The same configuration, nothing run:

```json
{
  "gates": [
    {
      "command": "node -e 0",
      "when": null
    },
    {
      "command": "node -e 0 # docs",
      "when": [
        "src/**"
      ]
    }
  ],
  "total": 2,
  "dryRun": true
}
```

The whole list is printed; no set of paths is computed, so there are no counts, `scope` or `tree`. The exit code is 0.

## `tracks --json`

A real run with a worktree on branch `track-a` carrying one task commit, a modified and an untracked file; a detached worktree; and a branch `track-b` without a worktree carrying one task commit:

```json
{
  "tracks": [
    {
      "kind": "worktree",
      "path": "/path/to/wt-a",
      "branch": "track-a",
      "head": "<sha>",
      "merged": false,
      "pending": [
        "e880797 <prefix>-N: work on alpha"
      ],
      "dirty": [
        "M a.txt",
        "?? d.txt"
      ],
      "prunable": false,
      "locked": false
    },
    {
      "kind": "worktree",
      "path": "/path/to/wt-det",
      "branch": null,
      "head": "<sha>",
      "merged": true,
      "pending": [],
      "dirty": [],
      "prunable": false,
      "locked": false
    },
    {
      "kind": "branch",
      "path": null,
      "branch": "track-b",
      "head": null,
      "merged": false,
      "pending": [
        "9f279e7 <prefix>-N: work on eps"
      ],
      "dirty": null,
      "prunable": false,
      "locked": false
    }
  ],
  "total": 3
}
```

- `kind` is `worktree` or `branch`. Worktrees come first, in the order of `git worktree list`, then branches; the current tree and branch are not listed, and a branch without a worktree is listed only when it carries task commits not in `HEAD`. `total` is the length of `tracks`.
- `path` is the absolute worktree path as git prints it, `null` for a branch. `branch` is `null` for a detached worktree. `head` is the full sha of a worktree, `null` for a branch.
- `merged` is whether the branch, or the detached sha, is an ancestor of `HEAD`.
- `pending` lists the task commits not in `HEAD`, each `"<short sha> <subject>"`, chosen by a subject that starts with `<prefix>-` and a digit. `[]` means none; `null` means `git log` failed for that entry.
- `dirty` lists the uncommitted entries of a worktree, `[]` when it is clean. `null` means "could not be checked" for a worktree — `git status` failed, or the worktree is `prunable` — and "not applicable" for a branch.
- `prunable` and `locked` are booleans: whether `git worktree list --porcelain` prints the line of that name for the worktree; `false` for a branch.

## `seed --scan --json`

A real run in a repository with `package.json` scripts `test`, `lint` and `start`, a workflow `.github/workflows/ci.yml` and a directory `src/api`:

```json
{
  "gates": [
    {
      "command": "npm run test",
      "evidence": "package.json → scripts.test"
    },
    {
      "command": "npm run lint",
      "evidence": "package.json → scripts.lint"
    },
    {
      "command": "npm ci",
      "evidence": ".github/workflows/ci.yml:7"
    },
    {
      "command": "npm test",
      "evidence": ".github/workflows/ci.yml:8"
    }
  ],
  "subsystems": [
    {
      "name": "api",
      "evidence": "src/api"
    }
  ],
  "total": 1
}
```

- `gates` items are `{command, evidence}`, `subsystems` items `{name, evidence}`. `total` is the number of **subsystem** candidates, not of all items.
- `evidence` is a human-readable pointer to where the candidate was found — a script key (`package.json → scripts.test`), a file with a line (`.github/workflows/ci.yml:7`) or a path (`src/api`) — not a locator to parse.
- A script becomes a gate candidate only when its name matches `GATE_NAME` in [lib/seed.js](../../lib/seed.js), which is why `start` is absent above; the walk skips the directories of `SKIP_BUILD` in the same file. The lists live in the code, and the sources are named in [02 § seed](02-cli.md#seed).
- The choice stays with the caller: a candidate is not a gate or a subsystem until the agent and the owner say so.

## Two shapes of `dirty`

The two commands report uncommitted work in different shapes, and a caller must not read one as the other:

- `gates --json` `tree.dirty` is **one string**: the lines of `git status --porcelain -- .` joined by line breaks, leading space included, `""` on a clean tree. Untracked directories are collapsed (`?? src/`), and in a monorepo paths are from the project root. The paths `gates` actually compares with `when` patterns are in `scope.paths`, one file per item (`src/api/a.js`).
- `tracks --json` `dirty` is **an array**: one item per `git status --porcelain` line of that worktree, trimmed at both ends, so the leading space of an unstaged change is gone (`M a.txt`).

## `brief`

- **stdout is the brief alone**: the track heading, the Work to do and Out of scope sections of the named tasks, the project's `gates`, `prefix`, `cli` and `probe`, and the fixed sections of the brief template. Its content goes to the worker as it is.
- **stderr carries notes** as `⚠` lines: a missing `probe` field, and a `cli` pinned below 0.10.0. A note never changes stdout or the exit code.
- **Brief slots.** The orchestrator's decisions come as flags: `--track`, `--neighbour` (repeatable, `path=track`), `--entry`, `--autonomy` and `--handover`; `--measurements` adds the measurement rule. A slot without its flag is printed as a bracketed placeholder that opens with `[TODO` (`[TODO: track title in 2–5 words]`). It is a requirement to the brief's author, not a default: the orchestrator passes the flag, or replaces the placeholder before the brief leaves.
- **Refusals** (exit 1, empty stdout, no partial brief): no task numbers; a number found neither in a status directory nor in the archive; `--neighbour` not in the form `path=track`. A **folded task** — a journal line in `LOG.md` without a task directory — is refused too, because the brief has no definition to take; its body is read with `show N`. An archived task that is not folded yet still has `task.md` and gets a brief.

## Mutating commands

These are the commands an orchestrator uses to change the tracker. The behaviour of each is in [02. CLI](02-cli.md); here are the parts an orchestrator acts on.

- **`new <slug> --parent N[.M]`** files a finding `N.k` in `triage/`, with the next free `k` across the current tree, other worktrees and local branches, and a Parent field naming the exact parent. `--minor --evidence "…"` files it in `minor/` instead, with the evidence and Cost (`--cost`; `major` and `critical` only with `--hypothesis`). A minor finding without evidence is refused.
- **`mv <N…> <status>`** moves one or more tasks between status directories and rewrites links to them. With several numbers, all are resolved and checked before the first move and then moved in argument order. `--top` and `--after M` place one task in the queue; `--restore` returns tasks to their saved queue place and works on a batch.
- **`archive N`** moves a task into `archive/<id>-<slug>/task.md` with a `result.md` blank and prints the documentation files the task’s work touched: files under `<docs>/` outside `backlog/` and `archive/`, and `CHANGELOG.md`, changed by commits whose subject starts with `<prefix>-N:`, plus the commits of `--range`. **`archive N.k --into M`** closes a minor entry into the closed batch M.
- **`fold N`** folds one archived task into a `LOG.md` line and prints the commit message draft on stdout; **`fold`** without a number folds every archived directory, and with nothing to fold it exits 0 with empty stdout.
- **`show N`** prints the body of a folded task on stdout, and a header "number · date · outcome · revision" on stderr.

**Refusals come before the first write.** In these commands every check that can be made before a write — numbers, statuses, evidence, destination paths, attachments, git state — runs before the first move or write, for every task of the call, so a refusal leaves the files as they were. A file-system failure in the middle of a batch is not undone: the check is atomic, the move is not.

## Worker and approver

- A worker changes only its own branch or worktree. Its only tracker write is a new finding file, `new <slug> --parent N[.M]` (with `--minor --evidence "…"` for a minor or a hypothesis); it never moves, archives, folds or edits an existing task file, and never touches `archive/`.
- The approver — under orchestration, the orchestrator — accepts: it reviews, runs `archive`, completes `result.md`, runs `fold`, and moves tasks between statuses in the triage review.
- The rest of the worker boundary is stated by the brief template, [templates/en/brief.md](../../templates/en/brief.md).
- The worker transport is the harness slot "How to raise a worker" in the `backslop-batch` skill; a new transport is a variant of that slot, and nothing changes in the CLI.

## The managed block

`init` writes the process section into `AGENTS.md` between the markers `<!-- backslop:start -->` and `<!-- backslop:end -->`; the rules are in [01 § Re-running init](01-layout.md#re-running-init).

- A marker counts only on a line of its own. The block is replaced between its markers, or appended at the end of the file when there are none. A marker on its own line twice, or a marker without its pair, is refused before the first write.
- Text outside the markers is the project's and survives `init`.
- `agents.stepOverrides` replaces the text of a numbered step (`"1"`…`"7"`) inside the block, escaped, keeping its number, the other steps and the worker boundary.
- `probe`, when declared, is named by step 4 of the block, the `backslop-task` skill and the brief; without it none of them carries a probe requirement. An override of step 4 replaces the probe sentence too.

## `backslop.json`

The single owner of the field semantics is the [01 config table](01-layout.md#backslopjson). The ten fields, in the order `init` writes them:

| Field | For an orchestrator |
|---|---|
| `prefix` | the task number prefix in ids, file names and commit subjects |
| `docs` | the documentation directory; status directories live under `<docs>/backlog/` |
| `cli` | how to call the tool, with its version pin |
| `gates` | the gate commands; an entry is a command string or `{ "command": "…", "when": ["<glob>", …] }` |
| `probe` | the mutation-probe command, or absent |
| `version` | the layout stamp, `X.Y.Z` |
| `source` | where `upgrade` takes release tags from |
| `lang` | `ru` or `en`: the language of human text |
| `tools` | the selected adapters |
| `agents.stepOverrides` | replacements of numbered steps of the managed block |

## What is stable

Stable, within one tagged version and across versions until an ADR changes it:

- The status directories and the archive; the file name `<prefix>-N[.k]-<slug>.md`; the line form of `<docs>/archive/LOG.md` and its anchor `#<number in lower case>`; the Russian and English header fields and task sections.
- The `backslop.json` fields of the [01 config table](01-layout.md#backslopjson), `agents.stepOverrides` included; both forms of a `gates` entry; the pin forms `npx github:owner/repo#vX.Y.Z` and `npx backslop@X.Y.Z`.
- The managed block markers and the step numbering `agents.stepOverrides` addresses.
- The commands, and what of each is stable:

| Command | Stable |
|---|---|
| `status --json` | the keys of [`status --json`](#status---json), `null` for an empty `created`, `taken`, `area`, `cost` or `order`, the ordering of `queue` and `minor`, and the exit code |
| `gates --json`, `gates --dry-run --json` | the keys of [`gates --json`](#gates---json) and the exit code |
| `tracks --json` | the keys of [`tracks --json`](#tracks---json) and the exit code |
| `seed --scan --json` | the keys of [`seed --scan --json`](#seed---scan---json) and the exit code |
| `brief` | the output on stdout, its brief slots (`--track`, `--neighbour`, `--entry`, `--autonomy`, `--handover`) and their `[TODO` placeholder, and `--measurements` |
| `new <slug> --parent N[.M]`, `new … --minor --evidence "…"` | the file it writes, the next free `N.k`, the Parent field, the exit code |
| `mv`, `archive`, `archive N.k --into M` | the effect on files and the exit code |
| `fold`, `show` | the journal line, the draft and the body on stdout, the exit code |
| `adr` | the file name and the exit code |
| `lint` | the exit code: 0 without errors, 1 with errors |
| `merge-changelog` | the exit codes: 0 merged; 1 with the result written and a conflict mark left; 1 with nothing written for a refusal |
| `upgrade` | the effect on the pin, the rules pair and the live pins, and the exit code |

- What the table does not name — the ordering of `active`, `deferred` and `triage`, the other null cases, the counts of `gates`, the checks before the first move — is described behaviour, not a guarantee.
- **The outcome discriminator** for a `--json` mode: exit 1 with JSON on stdout is a result; exit 1 with empty stdout is a refusal.
- **JSON keys** may be added; removing or renaming a key is a breaking change.
- **Human text is not contract.**

### Not contract

- Human text: messages, report lines, and the text output of any command other than `brief`.
- The glyphs `✔`, `✖` and `⚠`, and colours.
- The order of info lines in a report.
- JSON key order and whitespace.
- stderr reports of data commands.
- The wording of a brief slot placeholder after its `[TODO` marker.
- `lint` message text.

### Changing the contract

- A behaviour change of a command updates `docs/reference/`, README and CHANGELOG in the same pass.
- A contract change — file formats, commands, the composition of `status --json` — needs a new ADR.
