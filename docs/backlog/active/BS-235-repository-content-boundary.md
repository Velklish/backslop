# BS-235 · Remove unrelated project internals from tracker records and boundary checks

- **Scope:** [04. Verification](../../reference/04-verification.md)
- **Created:** 2026-10-04
- **Dependencies:** BS-233, BS-234
- **Cost:** major
- **Previous order:** 30
- **Taken:** 2026-10-23

## Context

Open tracker records and the archive retain unrelated project names, private run history and implementation details. The existing boundary test protects only a narrow document set and itself embeds a consumer name.

Historical evidence: audited commit `fd85b4cb527c875f1172b4517b4a3972a4e33755`, 2026-10-04, named the Context sections of BS-225, BS-226, BS-227, BS-228, BS-231 and BS-232. Current-tree triage at `409099a689d496925d4be018394c7353c60fb3f3` locates remaining archive narratives at `docs/archive/LOG.md:330-334` and the narrow consumer-identifier guard at `test/hooks-install.test.mjs:747-750`; the old test line numbers are obsolete. BS-233 and BS-234 are closed (`docs/archive/LOG.md:421,435`). BS-225 is being restated as generic reproduction and contract/design work: its stronger attribution request is not established as a violation of the documented coarse file filter. Preserve each underlying issue's uncertainty when replacing foreign context; do not label every historical report a reproduced product defect.

No open card covers this repository-wide boundary. The closed BS-208 cleanup covered a narrower public surface.

## Work to do

- Rewrite current issue evidence as self-contained generic reproductions, preserving observed facts, uncertainty and the original defect.
- Keep consumer-specific run history and ownership details in the consumer or integration project.
- Normalize current archive descriptions and identifiers with a plan that preserves anchors, links and retrieval.
- Extend contributor rules and regression checks to the full current tracked tree. Avoid storing literal real consumer names merely to ban them.

## Out of scope

- Do not close or delete the underlying functional issues as a substitute for rewriting their evidence.
- Do not rewrite Git history or delete installed adapters, hooks or tracker documentation.
- Parser-fixture replacement is handled by BS-233; private renderer provenance by BS-234.

## Verification

- A full current-tree review finds no unrelated implementation narratives or product-specific coupling.
- Negative fixtures prove the boundary check catches violations outside the old README/reference/Unreleased subset.
- Run tracker lint and link/retrieval checks after archive text changes. Original task ids and retrieval remain valid.
