# ADR-057: Markdown heading anchors use a local contract

**Status:** Accepted
**Date:** 2026-10-09
**Deciders:** Repository maintainer at acceptance

## Context

The generic link checker computes heading anchors locally in [lib/links.js](../../lib/links.js). A deployment-specific renderer measurement cannot define a reproducible product contract, and a claim of full platform compatibility is broader than the fixed named-entity table the implementation supports.

## Options

- **A public renderer contract** would require independently maintained platform fixtures and a demonstrated correspondence for every supported case.
- **A precise local contract** states the current preprocessing, slug filtering, duplicate handling and entity limits and makes them reproducible without an external service. Chosen.
- **Platform selection** would add a mode without a demonstrated behaviour difference; it is not needed.

## Decision

Use the [heading-anchor contract](../reference/03-lint.md#heading-anchor-contract) as the supported rule. Preserve the existing algorithm and source/id expectations. Keep the generic checker in this product; keep organization-specific renderer measurements in the integration project. [Local tests](../../test/links.test.mjs) define heading and entity fixtures independently of any deployment.

## Consequences

- `node --test --test-concurrency=1 test/links.test.mjs` reproduces the heading and entity expectations locally.
- The named-entity table remains deliberately limited; names without a table or inherited-property lookup result remain source text before slug filtering. The inherited `constructor` property is an exception: its entity reference stringifies the Object constructor. This is an existing lookup defect, not a supported HTML entity, and requires a separate behaviour fix. This decision changes provenance and documentation, not anchor behaviour.
- Future compatibility claims need public fixtures or an explicit contract change, rather than a private measurement.
