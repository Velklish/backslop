# BS-233 · Replace copied consumer histories with synthetic parser fixtures

- **Order:** 10
- **Scope:** [04. Verification](../../reference/04-verification.md)
- **Created:** 2026-10-04
- **Dependencies:** none
- **Cost:** major

## Context

The parser fixtures retain unrelated consumers' implementation histories rather than only the grammatical inputs the outcome parser needs. This violates the required repository boundary.

Evidence: audited commit `fd85b4cb527c875f1172b4517b4a3972a4e33755`, 2026-10-04. `test/fixtures/outcome-first-paragraphs.json:69,76,83,90,97,104` describes another product's storage, cleanup, hooks, module layout and protocol. `test/fixtures/outcome-unread-residue.json:29` retains a foreign decision. `test/tasks.test.mjs:243-253` couples fixture language to a real consumer prefix. `lib/log.js:155` also retains a consumer-specific historical example.

This is content and test-data coupling; the audit did not demonstrate a production runtime dependency.

## Work to do

- Replace copied histories with minimal synthetic English examples and explicit language metadata for localization cases.
- Preserve a before/after mapping of paragraph position, negation, completed/rejected/merged outcomes, task ids, links and incomplete or unknown outcomes.
- Remove foreign implementation narratives and identifiers from fixtures, examples and language selection. Their original history belongs in the owning project.

## Out of scope

- Do not delete parser cases, change outcome semantics or introduce an integration dependency.
- Do not remove localization support or rewrite Git history.

## Verification

- Every old parser case maps to a synthetic replacement with the same expected result.
- Run `node --test --test-concurrency=1 test/tasks.test.mjs` and record its case count and exit code.
- Run the repository gates. Inspect the changed fixtures for foreign implementation descriptions, not just product-name matches.
