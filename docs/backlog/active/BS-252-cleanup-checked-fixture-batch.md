# BS-252 · Clean temporary fixture roots on checked construction failure

- **Scope:** [04. Finding verification protocol](../../reference/04-verification.md)
- **Created:** 2026-10-23
- **Dependencies:** none
- **Cost:** —
- **Previous order:** 160
- **Taken:** 2026-10-23

## Context

The owner expanded this run to every non-Windows backlog item before v1.0.0. Independent review of the first fixture changes found an inspection-only cleanup gap, filed as BS-247.22. This batch preserves that evidence and requires a bounded measurement before changing cleanup.

## Work to do

- [BS-247.22](../minor/BS-247.22-cleanup-checked-fixture-construction.md): measure the thrown-constructor path, add local cleanup-and-rethrow without losing the Git cause, and retain successful fixture shapes.
- Keep the allocating constructors local; do not introduce a general fixture layer.

## Out of scope

Unrelated refactoring, native Windows verification, package publication and remote history replacement.

## Verification

Inject setup failure, capture the allocated path, original diagnostic and direct exit. Before correction the root persists; after correction it is absent with the same failure cause. Always clean the disposable probe. Run affected files and record exact source/candidate hashes, commands, counts and exits. Fresh review and final integration gates are required.
