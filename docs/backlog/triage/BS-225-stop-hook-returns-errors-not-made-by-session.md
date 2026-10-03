# BS-225 · The stop hook returns the turn on lint errors the session did not make: old errors and other sessions' commits in a shared worktree

- **Scope:** [02. CLI § hook](../../reference/02-cli.md#hook)
- **Created:** 2026-10-04
- **Dependencies:** none
- **Cost:** major

## Context

The stop hook builds the set of changed files from `git diff --name-only <start>` against the working tree plus untracked files (`lib/hook.js:139–142`). It then keeps every lint error in those files (`lib/hook.js:151`). Two cases follow.

- **Old errors count.** A session that touches one line of a file with older errors gets its turn returned on all of them.
- **Other sessions' commits count.** In a worktree shared by several sessions, commits made by others after this session's `start` are part of the diff and are attributed to it.

Measured on 2026-10-03 in run bs020, a promptobus consumer on v0.20.0: a Claude Code reviewer in a shared worktree had its turn returned on four README errors it never touched. The hook stops after `RETURN_LIMIT` = 3 returns in a row (`lib/hook.js:11`), so each such session pays three extra turns. The orchestrator's workaround was a brief line: do not fix errors you did not make.

## Work to do

- Count only errors the session introduced: compare against the lint result at `start` rather than all errors in the file.
- Attribute a file to the session only for changes made in this session, not for other sessions' commits in a shared worktree.

## Out of scope

- The return limit.

## Verification

- A session that edits a file with an older lint error and adds none ends its turn without a return; a test fails on the old hook.
- A commit by another session after `start` does not return this session's turn; a test fails on the old hook.
