# BS-195 · Agent hooks: a hook command that returns the turn on lint errors in the files the session changed

- **Order:** 1057
- **Scope:** [02. CLI](../../reference/02-cli.md)
- **Created:** 2026-09-30
- **Dependencies:** BS-194, BS-184, BS-186, BS-187, BS-176

## Context

Owner decision 11 of BS-183 (2026-09-30): agent hooks are a project's choice, for Claude Code, Cursor and Codex. At the end of an agent's turn a stop hook runs `lint` and returns the turn when `lint` reports an error in a file the session changed. An error in any other file never returns a turn: a project that turned red on `upgrade` must not block every agent until its migration task lands. The hook checks what `lint` checks — the tracker and the documentation — and no code style.

This card writes the command the hook records run. BS-196 installs the records. BS-194 measured each harness's protocol: the payload fields, how a turn is returned, and the trust step. Read its `result.md` in `docs/archive/` before you start. A harness item that BS-194 could not measure is implemented by the Claude Code protocol and recorded as not verified on that harness, with a minor hypothesis record.

**Cost.** `node bin/backslop.js lint` takes 0.36 s in this repository. Through a pinned `npx github:Velklish/backslop#vX` it takes about 4 s warm and 11 s cold (BS-194 Context). So the stop hook runs `lint` only when the session changed a file, and a session that changed nothing pays only for `npx` and a `git` call.

**Precedent for the loop ceiling.** promptobus's Stop guard lets a turn end after it has returned the same state a fixed number of times in a row, so that a session can always finish (`lib/guard.js`, `GUARD_BLOCK_LIMIT`, tag `v0.21.0`).

## Work to do

- A new command `hook`, added the way the module-map reference page describes: `hook <session-start|stop> --harness <claude|cursor|codex>`. It reads the harness's event JSON on stdin.
- **`session-start`** records the session's starting point: the id from the payload, `git rev-parse HEAD`, and the time. The record goes under the git directory of the working tree (`git rev-parse --git-dir`), in a `backslop/hooks/` subdirectory, one file per harness and session. It is never a tracked file, and each worktree has its own. The command prints nothing that the harness would inject and exits 0.
- **`stop`:**
  - The changed set is every path that differs between the recorded start commit and the working tree — committed since the start, staged or not — plus untracked files that are not ignored. Paths are repository-relative, in POSIX form. Without a record (the hook was installed mid-session), the start is `HEAD`.
  - An empty changed set exits 0 without running `lint`.
  - Otherwise it runs `lint` in the same process and keeps the errors whose file is in the changed set. An error with no file and every warning never return the turn.
  - No kept error: exit 0. Kept errors: return the turn by the harness's protocol from BS-194 — the error lines, then one line saying to fix them in the files named, not to bypass the hook.
  - **Loop ceiling:** when the same set of kept errors has returned the turn three times in a row for the session, the fourth stop lets the turn end, with a warning that names the errors on the harness's user-visible channel. The count lives in the session's record and resets on a clean stop.
- **The hook never breaks a session.** Outside a git repository, without `backslop.json`, with unreadable stdin, or on an internal error, it exits 0 and prints at most one note on the channel the harness shows the user. The same holds for a harness id outside the registry.
- Messages follow the localization convention in force when you start (after BS-179, the `templates/i18n/ru.mjs` lookup).
- **Tests,** with fake stdin per harness and git fixtures:
  - an error in a file the session changed returns the turn;
  - an error in an untouched file does not;
  - a file committed after `session-start` counts as changed, and so does an untracked one;
  - an empty changed set does not run `lint` — prove it without timing, for example with a project whose `lint` would fail if it ran;
  - the loop ceiling lets the fourth stop through and resets on a clean stop;
  - bad stdin, no git and no config exit 0.
  Red probes: make the changed-set filter keep every error, and make the ceiling never trigger; the matching tests turn red.
- **Documentation:**
  - `docs/reference/02-cli.md`: a `### hook` section;
  - `docs/reference/05-orchestrator-contract.md`: `hook` in the list of what is not contract for an orchestrator, because its output is the harness's protocol;
  - `docs/reference/01-layout.md`: the session records under the git directory;
  - `CHANGELOG.md` under the unreleased section.

## Out of scope

- Writing the hook records into harness files, and the `hooks` config field: BS-196.
- Running `gates` or any command other than `lint`.
- Checking code style.

## Verification

- `npm test` and `node bin/backslop.js gates` exit 0; the new tests named above exist and the red probes are recorded with their exit codes.
- A live Claude Code session in a throwaway project, with the records written by hand as BS-194 wrote them and pointing at this branch's `bin/backslop.js`: a broken anchor in a file the session edits returns the turn, and a broken anchor in an untouched file does not. Record the command, the CLI version and the evidence.
- `node bin/backslop.js lint` exits 0.
