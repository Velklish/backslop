# BS-234 · Remove private-host provenance from the Markdown renderer contract

- **Order:** 20
- **Scope:** [03. Lint](../../reference/03-lint.md)
- **Created:** 2026-10-04
- **Dependencies:** none
- **Cost:** major

## Context

Published source and release text describe a private consumer host as the basis of the Markdown anchor contract. A generic link checker must define behaviour without private deployment knowledge.

Evidence: audited commit `fd85b4cb527c875f1172b4517b4a3972a4e33755`, 2026-10-04. `lib/links.js:287`, `docs/reference/03-lint.md:49`, `CHANGELOG.md:50` and `test/links.test.mjs:616,620,630,671` name the private renderer. `package.json` includes both `lib/` and `CHANGELOG.md` in the package.

`lib/links.js:289-290` performs a local transformation. This finding is about provenance and the supported contract, not a demonstrated network dependency.

## Work to do

- Define the supported heading-anchor behaviour using public-platform fixtures or a precise local contract.
- Replace private-host provenance in source, tests, reference and release text. Keep organization-specific renderer measurements in the integration project.
- Keep the generic link checker here and preserve the heading/entity coverage.

## Out of scope

- Do not move the generic link checker out of this product.
- Do not add a platform switch unless a behaviour difference is demonstrated.

## Verification

- No private hostname remains in the current tracked tree or package payload.
- Run `node --test --test-concurrency=1 test/links.test.mjs` and the repository gates; record counts and exits.
- Each retained entity/heading expectation has reproducible evidence independent of a private deployment.
