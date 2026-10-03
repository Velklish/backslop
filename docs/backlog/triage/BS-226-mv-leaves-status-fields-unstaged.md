# BS-226 · mv stages the rename but not the status fields it writes, so a commit of the staged change carries a bare rename

- **Scope:** [02. CLI § mv](../../reference/02-cli.md#mv)
- **Created:** 2026-10-04
- **Dependencies:** none
- **Cost:** major

## Context

`mv` moves the entry with `git mv` (`relocateTask`, `lib/mv.js:153`). After that it writes the status fields into the moved file: "Previous order", "Order", "Taken", "Cost", "Scope" (`lib/mv.js:161–171`). These edits stay unstaged.

On 2026-10-03 in ati-agents (run bs020) a take commit staged the move and committed it. The commit carried the bare rename without "Previous order" and "Taken", and lint went red on an entry in progress without a "Taken" date. The fix took a second commit, `0726bd10`.

## Work to do

- Stage the field edits together with the rename, so the staged state after `mv` is complete.

## Out of scope

- A file that git does not track: `mv` already warns and moves it without `git mv`.

## Verification

- After `mv N active`, `git diff --cached` holds the rename and the new fields, and `git diff` is empty for that file; a test fails on the old `mv`.
