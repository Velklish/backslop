# BS-236 · Make the repository tracker history English

- **Order:** 40
- **Scope:** [04. Verification](../../reference/04-verification.md)
- **Created:** 2026-10-04
- **Dependencies:** none
- **Cost:** major

## Context

The current archive contains Russian original prose although the repository is required to be English. This is distinct from supported localization resources and verbatim localized diagnostics.

Evidence: audited commit `fd85b4cb527c875f1172b4517b4a3972a4e33755`, 2026-10-04. `docs/archive/LOG.md:7-127` contains 121 lines with Cyrillic titles or outcomes. `AGENTS.md:21` and `test/english-only.test.mjs:11` exempt all tracker/archive files. `node --test --test-concurrency=1 test/english-only.test.mjs` passed 3/3 with exit 0 on this commit. One old minor card quotes a localized diagnostic; translating that quote as if the command printed English would falsify evidence.

## Work to do

- Translate original human prose in the current tracker/archive to English while preserving ids, dates, revisions, anchors and outcome semantics.
- Narrow language exceptions to actual localization resources and explicitly identified multilingual input or verbatim diagnostic evidence.
- Update the contributor language rule and verify new tracker prose cannot bypass the check.

## Out of scope

- Do not remove supported localization resources or multilingual parser tests.
- Do not rewrite historical commits or translate exact diagnostic evidence as though its original output differed.

## Verification

- The current tracked-tree language scan has no unexplained Russian original prose.
- Regression fixtures reject arbitrary Russian backlog/archive prose while accepting justified localization data.
- Run language, tracker lint and historical retrieval checks, recording case counts and exit codes.
