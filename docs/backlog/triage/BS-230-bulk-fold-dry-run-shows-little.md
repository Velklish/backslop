# BS-230 · A bulk fold --dry-run prints only directory-to-revision pairs, not the log lines or link rewrites it will make

- **Scope:** [02. CLI § fold](../../reference/02-cli.md#fold)
- **Created:** 2026-10-04
- **Dependencies:** none
- **Cost:** minor

## Context

On 2026-10-03 in diffalanche (run bs020), DA-122 folded the whole archive. `fold --dry-run` in bulk mode printed only a directory → revision pair per task. The log lines and the link rewrites became visible only on the real fold, so the worker and the reviewer could check them only after the tree had changed.

## Work to do

- Make a bulk `--dry-run` print the log lines and the link rewrites it would write, the same as the real run does.

## Out of scope

- The single-task `fold N --dry-run`.

## Verification

- In a fixture a bulk `fold --dry-run` prints every log line and link rewrite that the real bulk fold then writes, and leaves the tree unchanged; a test fails on the old output.
