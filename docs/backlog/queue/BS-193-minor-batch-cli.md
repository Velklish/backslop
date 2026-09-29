# BS-193 · Minor batch: CLI — pin forms, foreign-tree guards, mv minor evidence, tracks and unreadable-dir wording

- **Order:** 1080
- **Scope:** [02. CLI](../../reference/02-cli.md)
- **Created:** 2026-09-29
- **Dependencies:** none

## Context

The `02. CLI` area of `minor/` holds eighteen records, over the batch threshold of ten. This batch takes the ten whose fix lives in `lib/`, `bin/` and `test/` and runs beside the documentation block (BS-157…182), so it stays out of the files that block rewrites. Every record is a claim measured at an older commit: verify it at the batch's base first. A record already fixed there closes as "already fixed at `<sha>`" with the command that shows it; a record whose claim no longer holds closes as "does not reproduce" with the measurement.

## Work to do

- [BS-84.1](../minor/BS-84.1-floating-cli-quoted-in-gate.md) — a floating cli inside a quoted gate command is pinned by `upgrade` like an unquoted one, or `lint` names the floating form it cannot pin.
- [BS-84.2](../minor/BS-84.2-pinre-matches-version-prefix.md) — `pinRe` ends at the version: `#v0.1.0` does not match inside `#v0.1.0x` or `#v0.1.0-rc.1`.
- [BS-88.2](../minor/BS-88.2-docs-path-spelling-hides-branches.md) — `foreignTaskIds` compares normalized paths, so `"docs": "./docs"` still sees task numbers taken on other branches.
- [BS-96.1](../minor/BS-96.1-backlog-file-still-crashes-lint-and-new.md) — a file where `docs/backlog` or a status directory is expected gives a worded refusal in `lint` and `new`, not an `ENOTDIR`/`EEXIST` stack.
- [BS-96.4](../minor/BS-96.4-foreign-worktree-file-shaped-status-dir.md) — the same guard in `foreignTaskIds` for a status directory that is a file in another worktree.
- [BS-99.1](../minor/BS-99.1-mv-minor-evidence-whole-line-rule.md) — `mv N minor` reads Evidence stubs by the same line rule as gate 4 (numbered items, task boxes, table cells), so a card that passes `mv` passes `lint`.
- [BS-102.1](../minor/BS-102.1-tracks-locked-worktree-line.md) — the text output of `tracks` names a locked worktree.
- [BS-113.1](../minor/BS-113.1-upgrade-killer-test-shell-exec.md) — the signal test of `upgrade` no longer depends on whether `/bin/sh -c` execs its last command (the record's candidate: the cli itself is the killer).
- [BS-120.1](../minor/BS-120.1-unreadable-dir-message-in-other-commands.md) — commands other than `lint` word an unreadable directory the way `lint` does (relative path, reason, what the command could not do).
- [BS-131.1](../minor/BS-131.1-mv-minor-todo-field-name-untested.md) — a test pins the refusal of `mv N minor` when the only Evidence line is a placeholder line whose field name is itself a placeholder.

## Out of scope

- `docs/reference/**`, `README.md`, `AGENTS.md`, `docs/adr/**`, `templates/**` and the released sections of `CHANGELOG.md`: the documentation block rewrites them now. A fix that changes documented behaviour lists the reference line to change in its result; the root hands it to that block.
- BS-84.3 (`lib/migrate.js`, rewritten by BS-157), BS-86.1, BS-86.2 and BS-162.2 (templates and the AGENTS recipe), BS-96.2 (`init` adapters, next to BS-163), BS-96.3, BS-127.1 and BS-138.1 (Windows only, no Windows machine in this run).

## Verification

- Per record: a verdict red before the fix and green after it, with the command and exit code; for a record closed without a fix, the measurement that closes it.
- A user-visible change gets a line under `## Unreleased` in `CHANGELOG.md`.
- `node bin/backslop.js gates` → 2 gates, 2 green; `node bin/backslop.js lint` → rc 0.
