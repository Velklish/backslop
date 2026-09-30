# BS-194 · Agent hooks: measure the turn return of a stop hook on live Claude Code, Cursor and Codex sessions

- **Order:** 1055
- **Scope:** [01. Layout](../../reference/01-layout.md)
- **Created:** 2026-09-30
- **Dependencies:** none

## Context

Owner decision 11 of BS-183 (2026-09-30): backslop ships agent hooks for Claude Code, Cursor and Codex, as a project's choice. At the end of an agent's turn a stop hook runs `lint` and returns the turn when `lint` reports an error in a file the session changed. BS-195 writes the `hook` command, and BS-196 installs the records. Both need facts about each harness's hook protocol that no one has measured yet. This card measures them before any code is written.

What is already proven, from promptobus (github.com/Velklish/promptobus, local clone at tag `v0.21.0`), which installs a Stop guard in all three harnesses:

- **Claude Code.** Project hooks live in `.claude/settings.json` as `hooks.<Event>: [{ hooks: [{ type: "command", command }] }]`. A Stop hook that exits 2 returns the turn, and its stderr reaches the model (`lib/guard.js`, `guard`; `docs/guides/hooks-and-trust.md` § How to trust). Project hooks run only in a trusted workspace.
- **Codex.** Project hooks live in `<layer>/.codex/hooks.json` as `{ hooks: { Stop: [...], SessionStart: [...] } }`, in the same shape as Claude's. A linked worktree reads the main checkout's `.codex/`, not its own. `Stop` fired at the end of finished turns on codex-cli 0.156.1 (measured 2026-09-26). A turn returned for follow-up was never measured. Trust is reviewed with `/hooks` and is recorded in `[hooks.state]` of `config.toml` in `CODEX_HOME`, keyed by the file path with a `trusted_hash`.
- **Cursor.** Project hooks live only in `.cursor/hooks.json` as `{ version: 1, hooks: { stop: [{ command }] } }`. The events `sessionStart`, `beforeSubmitPrompt`, `stop`, `sessionEnd` and `afterFileEdit` are proven to fire (`PROVEN_HOOK_EVENTS` in `lib/driver-cursor.js`). An unknown event name silently disables every hook in the file. Whether a stop hook can return the turn was never measured: promptobus reaches a Cursor participant by driver injection, not by a hook.

**Cost of one hook call**, measured on 2026-09-30 on macOS. `node bin/backslop.js lint` in this repository takes 0.36 s (`/usr/bin/time -p`). Through the pinned CLI `npx --yes github:Velklish/backslop#v0.12.0 lint` in the promptobus clone it takes 11.15 s cold, then 3.99 s and 4.07 s warm, rc 0 each time.

**Account windows on 2026-09-30.** Codex: the session window is 98 % used and resets on 2026-10-04T01:17Z. Cursor: the monthly API pool is 96 % used and the auto pool 82 %, both resetting on 2026-10-23. A measurement needs one or two short turns per harness. A turn refused for limits is recorded as not measured, with the refusal text. PAYG is not allowed.

## Work to do

- In a throwaway git project outside this repository, per harness, install by hand a project hook file with a start event and a stop event. The events are `SessionStart` and `Stop` for Claude Code and Codex, and `sessionStart` and `stop` for Cursor. Each runs one probe script that:
  - appends its stdin JSON, its argv and its cwd to a log file;
  - on the first stop of a session, exits 2 with the stderr line "Write the word PINEAPPLE into answer.txt, then end your turn.";
  - on the second stop, exits 0.
- Run one headless session per harness with a prompt that ends the turn at once: `claude -p`, `cursor-agent -p` and `codex exec`, whichever form each CLI takes. Record the CLI version and the exact command.
- Record per harness, each item with its evidence (log line, file content, exit code):
  1. whether the start event fires, and the name of the session-id field in its payload;
  2. the stop payload's fields — the session id, the cwd, and any loop flag such as Claude's `stop_hook_active` or a loop counter;
  3. whether exit 2 returns the turn: `answer.txt` holds PINEAPPLE and the second stop fired;
  4. whether stderr reached the model, or which other output (a JSON document on stdout, such as Cursor's `followup_message` if it exists) does it; if exit 2 does not return the turn, try the documented alternative and record it;
  5. what trust step the headless run needed for the project file to run at all;
  6. for Codex and Cursor, from a linked worktree (`git worktree add`), which `hooks.json` runs: the worktree's or the main checkout's.
- Put the results as a table in `result.md` and in this repository's `docs/reference/01-layout.md`, in a short section on each harness's hook file and protocol (BS-196 extends it). The section states only what was measured, with the CLI version and the date.

## Out of scope

- Any backslop code: the `hook` command is BS-195, the installer BS-196.
- Hook events other than start and stop.

## Verification

- `result.md` has one row per harness and item 1–6, each with its evidence, or "not measured" with the reason (limits, a missing CLI, a refused trust step).
- Claude Code item 3 is measured: it is the reference the other two are compared to.
- `node bin/backslop.js lint` and `node bin/backslop.js gates` exit 0.
