# ADR-056: A placeholder left in an ADR fails lint

**Status:** Accepted
**Date:** 2026-10-03
**Deciders:** Velklish

## Context

`adr` writes a template whose Deciders line and four sections are `[TODO…]` lines. `lint` reads placeholder lines in the backlog and in a closing `result.md`, but not in an ADR: an ADR committed with the template text passes every gate once it has a status, a number, a link and a row in the index. The ADR directory holds the current decisions, so an unfinished ADR with the status `Accepted` states a decision that nobody wrote down, and a reader of the directory cannot tell it from a finished one.

## Options

- **Leave it to review** — a reviewer meets the placeholder only when reading the file, and a diff of an ADR is skimmed for its status and its row.
- **A warning** — a warning does not fail a gate that counts the exit code, and the ADR is the place where a placeholder means a missing decision, as a stub in a queued task means a missing scope.
- **An error under gate 8, with the line rule of gate 4** — chosen.
- **The whole documentation tree** — pages show the placeholder form as an example, usually in code, and a wider rule needs its own decision.

## Decision

- **An error under gate 8.** Each placeholder line of a correctly named `adr-NNN-<slug>.md` is reported as `line N: the [TODO] placeholder remains`, the message gate 4 gives for the backlog. A misnamed file gets the name error and is not read.
- **The line rule is gate 4's** (`isPlaceholderLine` in `lib/tasks.js`): a line that is entirely `[TODO…]` after a list marker, a number, a checkbox or a quote marker, a table cell that is entirely such a placeholder, and a field whose whole value is one (`**Deciders:** [TODO]`). Fenced code blocks are blanked; a `[TODO]` inside a sentence or a code span is text.
- **Status does not matter.** A `Proposed` ADR is read too: it is a decision in progress, and its text is written before it is committed.
- **The reminder.** `adr` already says that lint fails until the row is added; the placeholders are the other half of the same sentence, and the reference page for `adr` says so.

## Consequences

- An ADR made by `adr` fails `lint` until its five placeholder lines are written or removed, as a task made by `new --queue` does until its scope is chosen.
- The process ADR that `init` lays down wrote its Deciders as a placeholder, which would turn every fresh project red: both template layers now write a plain value, with no exception in the gate.
- A project that already holds placeholder lines in an ADR, the old process ADR included, turns red on upgrade. `upgrade` does not edit an ADR: the cure is to write the line or section, or delete the ADR.
- Other documentation under `docs/` is not read for placeholders.
- A placeholder in the middle of a paragraph is not seen; the rule finds the lines `adr` writes.
