# BS-251 · Resolve the bounded test and comment audit findings

- **Scope:** [04. Finding verification protocol](../../reference/04-verification.md)
- **Created:** 2026-10-23
- **Dependencies:** none
- **Cost:** —
- **Previous order:** 160
- **Taken:** 2026-10-23

## Context

The owner authorized batching the local audit corrections during this implementation run. These records share a reference scope; each keeps its own evidence, preservation constraints and outcome. This batch does not merge their distinct subjects.

## Work to do

- [BS-247.6](../minor/BS-247.6-remove-subsumed-quote-probe.md): preserve the child definition, evidence and distinct acceptance outcome.
- [BS-247.19](../minor/BS-247.19-review-pipe-timeout-comment.md): preserve the child definition, evidence and distinct acceptance outcome.
- [BS-247.21](../minor/BS-247.21-fold-local-midnight-test-boundary.md): preserve the child definition, evidence and distinct acceptance outcome.

Use one editor for shared files, keep English/Russian template twins and rendered files consistent, and preserve unrelated changes. Run the child-specific checks before full acceptance. New public behavior is outside this batch.

## Out of scope

Native Windows verification, live harness observation, public history rewriting, release publication, and the separate brief-completeness and hook-attribution decisions.

## Verification

Each child has an individual recorded verdict and the exact command/output/exit evidence its Verification requires. A documentation guard must fail on the old text. Test deletion requires both different mutations and full-suite evidence from protocol step 6; a static similarity report is insufficient. The local-midnight claim remains a hypothesis until a bounded probe establishes it. Run `node bin/backslop.js gates --require-clean --base <integration-base>` on the committed implementation, with at most one suite running on the host and test file concurrency no higher than 2.
