# BS-249 · Correct the CLI workflow documentation audit findings

- **Order:** 140
- **Scope:** [02. CLI](../../reference/02-cli.md)
- **Created:** 2026-10-23
- **Dependencies:** none
- **Cost:** —

## Context

The owner authorized batching the local audit corrections during this implementation run. These records share a reference scope; each keeps its own evidence, preservation constraints and outcome. This batch does not merge their distinct subjects.

## Work to do

- [BS-247.9](../minor/BS-247.9-correct-writer-status-cost-description.md): preserve the child definition, evidence and distinct acceptance outcome.
- [BS-247.12](../minor/BS-247.12-seed-adr-current-inventory-contract.md): preserve the child definition, evidence and distinct acceptance outcome.
- [BS-247.16](../minor/BS-247.16-localization-adr-cli-redraw-contract.md): preserve the child definition, evidence and distinct acceptance outcome.
- [BS-247.18](../minor/BS-247.18-seed-placeholder-lint-scope.md): preserve the child definition, evidence and distinct acceptance outcome.

Use one editor for shared files, keep English/Russian template twins and rendered files consistent, and preserve unrelated changes. Run the child-specific checks before full acceptance. New public behavior is outside this batch.

## Out of scope

Native Windows verification, live harness observation, public history rewriting, release publication, and the separate brief-completeness and hook-attribution decisions.

## Verification

Each child has an individual recorded verdict and the exact command/output/exit evidence its Verification requires. A documentation guard must fail on the old text. Test deletion requires both different mutations and full-suite evidence from protocol step 6; a static similarity report is insufficient. The local-midnight claim remains a hypothesis until a bounded probe establishes it. Run `node bin/backslop.js gates --require-clean --base <integration-base>` on the committed implementation, with at most one suite running on the host and test file concurrency no higher than 2.
