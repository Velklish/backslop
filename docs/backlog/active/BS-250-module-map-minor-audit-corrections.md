# BS-250 · Correct the module map export and language descriptions

- **Scope:** [06. Module map](../../reference/06-module-map.md)
- **Created:** 2026-10-23
- **Dependencies:** none
- **Cost:** —
- **Previous order:** 150
- **Taken:** 2026-10-23

## Context

The owner authorized batching the local audit corrections during this implementation run. These records share a reference scope; each keeps its own evidence, preservation constraints and outcome. This batch does not merge their distinct subjects.

## Work to do

- [BS-247.10](../minor/BS-247.10-correct-changelog-export-docs.md): preserve the child definition, evidence and distinct acceptance outcome.
- [BS-247.15](../minor/BS-247.15-template-error-language-contract.md): preserve the child definition, evidence and distinct acceptance outcome.

Use one editor for shared files, keep English/Russian template twins and rendered files consistent, and preserve unrelated changes. Run the child-specific checks before full acceptance. New public behavior is outside this batch.

## Out of scope

Native Windows verification, live harness observation, public history rewriting, release publication, and the separate brief-completeness and hook-attribution decisions.

## Verification

Each child has an individual recorded verdict and the exact command/output/exit evidence its Verification requires. A documentation guard must fail on the old text. Test deletion requires both different mutations and full-suite evidence from protocol step 6; a static similarity report is insufficient. The local-midnight claim remains a hypothesis until a bounded probe establishes it. Run `node bin/backslop.js gates --require-clean --base <integration-base>` on the committed implementation, with at most one suite running on the host and test file concurrency no higher than 2.
