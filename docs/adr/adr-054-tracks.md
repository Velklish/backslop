# ADR-054: The tracks command observes a worker run and never removes anything

**Status:** Accepted
**Date:** 2026-09-29
**Deciders:** Velklish

## Context

Cleaning up after a worker run relied on the orchestrator's memory: the `backslop-batch` skill requires removing the run's worktrees and branches and checking that none is left, but no command listed them. The cost of a mistake is asymmetric. A forgotten merged worktree is litter found on the next run. A deleted unmerged branch is lost work that nobody can restore, because the session that made it is gone.

## Options

- **A cleanup mode, or removal by default** — a tool that removes will sooner or later remove unmerged work when its measure differs from the truth, and the asymmetric risk moves from a person to the tool.
- **Listing every local branch** — every branch grown from the main branch is listed, and the list stops being useful.
- **Listing worktrees only** — a branch whose worktree was removed while its work is unmerged drops out, the costliest miss.
- **One merged verdict** — after a history rewrite a branch is not an ancestor of HEAD and yet has no task commits outside it, so a single verdict misleads either way.

## Decision

- **Observation only** (`run` in `lib/tracks.js`). `tracks [--json]` prints the run's worktrees and branches and has no cleanup option; removal stays explicit, with `git worktree remove` and `git branch -D`.
- **Git is required, and a failed listing query refuses.** Outside a repository the command is refused. A failure of the queries that build the list — `rev-parse --is-inside-work-tree` other than "not a repository" (`insideRepo` in `lib/util.js`), `rev-parse --show-toplevel`, `worktree list` (`worktrees`) and `for-each-ref` (`localBranches`) — refuses instead of printing an empty list. Per-entry queries do not refuse: a failed `merge-base` reads as not merged, a failed `git log` gives `pending: null`, a failed `git status` gives `dirty: null`, and a failed `branch --show-current` reads as no current branch.
- **What is listed.** Every worktree except the current one, always, merged or not, because it is removed as a directory. Every local branch except the current one and those checked out in a listed worktree, when it carries task commits outside HEAD or when that check failed.
- **Each entry** carries `kind` (`worktree` or `branch`), `path`, `branch`, `head`, `merged`, `pending`, `dirty`, `prunable` and `locked`; `--json` prints `{ tracks, total }`.
- **`merged`** is `git merge-base --is-ancestor <ref> HEAD`; a detached worktree is measured by its own HEAD sha.
- **`pending`** lists the ref's commits not reachable from HEAD whose subject starts with `<prefix>-<digit>` (`pendingCommits`); `--grep` only prefilters, because a squash commit carries the squashed subjects in its body. It is `null` when git could not answer, and the text output says the commits could not be checked.
- **`dirty`** is the worktree's own `git status --porcelain`: `[]` is clean, `null` is not checked — a failed query, a prunable worktree whose directory is gone, or a branch without a worktree. `prunable` and `locked` come from `git worktree list --porcelain`, and the text output names `git worktree prune` for a prunable worktree.
- **Merged and pending are printed separately**, never folded into one verdict.
- **One worktree parser.** `worktrees` in `lib/util.js` parses `git worktree list --porcelain` for `tracks`, for task numbering across worktrees and for the seed walk.

## Consequences

- The end-of-run check "no worktree or branch of the run is left" is a command, not memory.
- Worker sessions are harness state the command does not see; checking them stays with the harness.
- The tool removes nothing; a cleanup mode would be a new decision on this topic.
- Both measures are reachability, not content: a branch integrated by squash or cherry-pick stays listed as not merged, with its task commits pending, until it is deleted. Detecting integration by content would be a new decision.
- A branch whose check failed stays in the list with `pending: null`, so an unchecked branch is never read as done.
