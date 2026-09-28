# ADR-049: Queue order: an integer rank per file, a saved rank on leaving, restore by batch

**Status:** Accepted
**Date:** 2026-09-28
**Deciders:** Velklish

## Context

Priority must be editable on parallel branches without a shared file, so each queued task carries its own absolute rank. A task that leaves the queue loses its place unless the rank is saved. A saved number is a place, not an identical position: the queue may have been renumbered meanwhile. An orchestrator returns a whole track at once, so restoring takes a batch, and the batch must not come back inverted.

## Options

- **A shared ORDER or index file** — conflicts on every take and every reorder.
- **Order by task number** — cannot express priority.
- **Restoring the exact number** — impossible after a renumbering.

## Decision

- **The rank.** The Order field (`FIELD_ORDER` in `lib/tasks.js`) is an integer, lower first; ties go by task number, then sub-number, and a missing or non-integer Order sorts last and is never renumbered (`queueOrder`). Only `queue/` tasks carry it: `mv` writes it on entering `queue/` and removes it for any other target (`moveOne` in `lib/mv.js`).
- **Placement** (`placeInQueue` in `lib/tasks.js`). Without a position a task goes to the tail: the highest integer Order plus 10, or 10 in an empty queue (`nextRank`). `--top` takes the midpoint between 0 and the first Order; `--after M` takes the midpoint between M and the next task, or M plus 10 at the tail, and M must be a queue task with an integer Order. The midpoint is `floor((lower + upper) / 2)` when the gap is at least 2; otherwise every integer-ranked queue task is renumbered 10, 20, … and the command prints `queue renumbered in steps of 10: N files`, counting distinct files per call.
- **Entry points.** `new <slug> --queue [--top]`; `mv <N…> queue` without a flag appends each task to the tail in argument order; `mv N queue --top` or `--after M`; `mv <N…> queue --restore`. A task already in `queue/` is reordered in place and needs a position flag (`resolve` in `lib/mv.js`). `--top`, `--after` and `--restore` exclude each other and are valid only with target `queue`; `--top` and `--after` take one task, `--restore` takes a batch.
- **The saved rank.** Leaving `queue/` writes an integer Order into Previous order (`FIELD_PREV_ORDER`); a non-integer Order saves nothing. The field survives moves between other statuses and is removed on every entry into `queue/`.
- **`--restore`.** It reads Previous order of every named task before the first move and refuses the whole call, naming every offender, when any is missing or not an integer (`restoreRanks`). For a single task a free saved rank is taken exactly; a taken one places the task right before the task that holds it.
- **The batch guarantee.** Restored tasks end in ascending saved rank, ties by ascending task number, whatever the argument order. The batch is processed by descending saved rank, then number and sub-number, and the queue is re-read before each move. Every task after the first is bounded by the batch task placed just before it: a free saved rank greater than that neighbour's Order, or one taken by a task behind the neighbour, goes right before the neighbour, and `placeInQueue` answers `bounded`. The per-task lines report the rank at placement time; a later step of the same batch may renumber it, which only the summary line shows.
- **Discarding a saved rank.** Entering `queue/` without `--restore` discards Previous order and prints `<ID>: saved position N discarded — --restore would have put it back` when the saved value is an integer; a non-integer one is removed silently.
- **What lint checks.** Gate 4 (`lintStatusFields` in `lib/lint.js`) requires in `queue/` an Order that is present, an integer and unique in the queue, and it rejects a repeated Order or Previous order line — the Russian and English field names included — in any task file outside the archive. It does not check an Order outside `queue/` or a Previous order inside it; `mv` keeps those consistent.

## Consequences

- Branches conflict when they move the same task, when a move rewrites a file another branch edits (incoming links), or when both renumber the queue.
- Seeing the queue costs a command: `status` or `status --json`.
- `--restore` returns a place, not a number, and within a batch a task with a free saved number may land ahead of it.
- Tasks without Previous order cannot be restored; they get `--top` or `--after M`.
- The `mv` output lines and the field names are part of the CLI and layout contract.
