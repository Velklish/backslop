# BS-228 · The LOG.md and archive README headers describe columns and order that bulk-folded lines do not have

- **Scope:** [02. CLI § fold](../../reference/02-cli.md#fold)
- **Created:** 2026-10-04
- **Dependencies:** none
- **Cost:** minor

## Context

The `LOG.md` template header (`templates/en/docs/archive/LOG.md:3`) says each line names the "closing commit" and that "a bulk fold adds its lines by closing date, equal dates by number". The archive README template (`templates/en/docs/archive/README.md:3`) says that every closed task is a directory with `task.md` and `result.md`.

After a bulk fold neither holds:
- the revision a line names is the commit `show N` reads the body from, not always the closing commit;
- the archive holds `LOG.md` and the README, with no task directories.

The reviewer of promptobus PB-317 reported both header lines on 2026-10-03 (run bs020). ati-agents records the same for its bulk fold of 2026-09-23 in its `AGENTS.md`: 116 lines name the last edit of the task directory, and the lines lie by number, not by closing date.

## Work to do

- Check the order a bulk fold writes on v0.20.0 against the header and correct whichever is wrong.
- Word both headers so that they hold for single and bulk folds: what the revision column is, and what the archive holds after a bulk fold.

## Out of scope

- Rewriting existing log lines.

## Verification

- A fixture after a bulk fold: the rendered headers describe its `LOG.md` and directory as they are; a test fails on the old templates.
