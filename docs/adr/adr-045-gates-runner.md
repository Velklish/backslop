# ADR-045: Gates runner and path-scoped gates

**Status:** Accepted
**Date:** 2026-09-29
**Deciders:** Velklish

## Context

The process rules for gates stayed unenforced while an agent ran each command by hand: the exit code was read from a pipe, gates ran on a tree that differed from the commit, and gate counts came from memory. Running every command on every change has the opposite cost: full test suites run on edits that cannot affect them, while some checks — the tracker's lint among them — must run exactly on such edits.

## Options

- **The agent runs each command by hand** — the rules stay text, and `grep … | wc -l` over a failed grep prints `0` with exit code 0.
- **A runner that also judges** — deciding whether a red gate is a defect of the change and whether a dirty tree is legitimate, it would be wrong silently.
- **Gates embedded in other commands or in CI** — the check becomes a side effect of something else.
- **A separate map of scopes beside `gates`** — a command and its scope live in two places and drift when one is edited.
- **A scope inside the command string, after a separator** — command and pattern no longer differ by grammar, and the separator is taken away from the shell.
- **Skipped entries added to the green count** — "gates N, green N" would claim checks that never ran.

## Decision

- **An explicit command.** `gates [--keep-going] [--json] [--require-clean] [--dry-run] [--base <ref>]` (`run` in `lib/gates.js`) only reports; no other command runs it.
- **Entries** (`gateEntry`, `validateGates` in `lib/config.js`). An entry of `gates` in `backslop.json` is a non-empty command string, which always runs, or `{ command, when: [<glob>…] }`, which runs only when the changed-path set touches one of its patterns; `command` is non-empty and `when`, when present, is a non-empty list of non-empty strings, checked whenever a config loads. A config without `gates` gets `["<cli> lint"]`; an explicit empty list is refused by `gates`.
- **Running.** Each command runs through the shell as written, in the project root, with a 10-minute cap (`runShell`, `SHELL_TIMEOUT_MS` in `lib/util.js`). The run stops at the first gate that is not green unless `--keep-going` is given.
- **Outcome labels** (`shellPassed`, `shellOutcome` in `lib/util.js`). A gate is green on exit code 0 without a start error. The line names what happened: `code N`; `timed out after the 10-min cap` whenever the cap was hit, even when the shell traps SIGTERM and exits 0 — then `--json` shows `code` 0 with a non-empty `error`; `killed by signal SIG…` for a signal without the cap, which does not mention the cap; `did not start: …` for any other start error. The cap, a signal and a start error are never reported as an exit code; all three are not green and fail the run.
- **Refusals before the first command.** `--require-clean` on a dirty tree or without git; `--dry-run` together with `--require-clean` or `--base`; an empty `--base`; `--base` without git, or on a ref `git diff` cannot resolve, naming the git cause; a git failure while checking for a repository, other than "no repository" and "git not installed" (`insideRepo`), and a failing `git rev-parse --show-prefix` inside a repository (`showPrefix`), since an empty prefix would match patterns against repository-root paths.
- **`--dry-run`** prints the whole configured list, each scoped entry with its patterns, runs nothing and computes no path set; with `--json` it prints `{ gates: [{ command, when }], total, dryRun: true }`.
- **The changed-path set** (`changedPaths`) is computed only when an entry has `when` or `--base` is given: the dirty tree from `git status --porcelain -z -uall`, both names of a rename or copy (`porcelainPaths` in `lib/util.js`), and with `--base <ref>` also `git -c diff.relative=false diff --name-only -z --no-renames <ref>..HEAD` (`basePaths`), de-duplicated. Paths are re-based from the repository root to the project root through `git rev-parse --show-prefix`; paths outside the project leave the set and are counted in `scope.dropped`, and the prefix is printed. Without git no set is computed and every entry runs, scoped ones included.
- **The glob** (`globToRe`). A pattern matches the whole project-relative path: `*` and `?` do not cross `/`, `**` does, `**/` at the start of the pattern or right after `/` also matches zero segments, and every other character is literal. A directory is written `docs/**`; a bare `docs` matches no file.
- **Skips.** An entry whose scope is untouched is reported on its own line with the reason and its patterns, counted as `outOfScope` inside `skipped`, and is never green and never red. `--require-clean` is refused when an entry has `when` and the project's path set is empty while no base-diff path was dropped outside the project: an acceptance run that would skip every scoped entry is known before the first command, and dirt in a neighbouring package of a monorepo does not lift the refusal.
- **Exit code and report.** The exit code is 1 when an executed gate is not green, and refusals exit 1 as well. When a path set is computed, a "scope: …" line names its source, base, project prefix and size before the first gate; the summary is "gates N, green M", with "not run K" and "out of scope L" when entries were not run, followed by the tree line. `--json` writes `{ gates, total, green, skipped, outOfScope, scope, tree }` to stdout and the gates' own output to stderr; a skipped entry is `{ command, when, skipped }` without `code`, `signal`, `error` and `ms`.
- **The tree snapshot** (`treeSnapshot`). After the run the report names `HEAD` — `null` in a repository without commits — and whether the tree is clean; without git there is no snapshot. In a monorepo subproject the snapshot and `--require-clean` look only at the project directory (`git status --porcelain --untracked-files=normal -- .` from the project root), and `tree.dirty` carries those porcelain lines with paths relative to the project root. Explicit `normal` includes non-ignored untracked work regardless of `status.showUntrackedFiles` and collapses untracked directories.
- **Other commands read the list.** `upgrade` rewrites the cli pin inside gate commands and keeps `when` (`rewriteGates` in `lib/upgrade.js`); `brief` lists the gate commands and, when an entry is scoped, says that skips are reported separately.

## Consequences

- Gate counts in briefs, reports and results come from the runner, not from memory; `--require-clean` turns "gates on a still tree" into a check, and the snapshot shows whether the gates themselves dirtied the tree.
- With scoped entries "gates N, green N" is not a full readiness criterion: a report names its skipped entries, and acceptance runs `--require-clean --base <branch point>`.
- The tool never judges a red gate or a dirty tree: no fix mode, no autocommit, no embedding in other commands or CI.
- The cap sends SIGTERM to the shell only, not to its process group: with macOS /bin/sh a gate's background and foreground children outlived the cap; other shells and Windows (cmd.exe) are not measured.
- A project that declares a scope must pin a tool version that reads `{ command, when }`; an older version refuses the config when it loads.
- A refusal and a red gate share exit code 1; a refusal leaves `--json` stdout empty.
- There is no result cache between runs: a cached green can be stale, and that risk would be a decision of its own.
