# BS-247 · Resolve the project quality audit follow-ups

- **Scope:** [04. Finding verification protocol](../../reference/04-verification.md)
- **Created:** 2026-10-22
- **Dependencies:** BS-247.1, BS-247.2, BS-247.3, BS-247.4, BS-247.5, BS-247.6, BS-247.7, BS-247.8, BS-247.9, BS-247.10, BS-247.11, BS-247.12, BS-247.13, BS-247.14, BS-247.15, BS-247.16, BS-247.17, BS-247.18, BS-247.19, BS-247.20, BS-247.21
- **Cost:** —
- **Previous order:** 130

## Context

The full project-quality audit reviewed the included current tree at `44e74a32ff6a6b6c946321b3614b1881a2ccedfe`: 212 text files and 41,042 lines; hidden and service files were excluded. The audit produced 19 source-backed issues, one mechanical automation opportunity and two explicitly unobserved boundary hypotheses. This is the parent record for their follow-up, not a request to implement them as one unbounded change.

The audit baseline was `node bin/backslop.js gates` at that SHA on macOS 27.0.1 arm64, Node v25.2.1, npm 11.6.2 and Git 2.54.0: gates 2/2, tests 1240/1240, failures 0, skipped 0, exit 0. These results establish the unmodified baseline; they do not prove fixes or natural-load flake rates. Before changing a reported bug or deleting a test, apply [the verification protocol](../../reference/04-verification.md), including the required independent passes and deletion mutations. A supported observation can still be refuted before implementation.

## Work to do

- Resolve the linked findings independently, preserving each card's bounded scope and verification requirements. Use the finding register below; each child remains a separate bounded change.
- Group edits to shared documentation, EN/RU template twins and guards before implementation; do not let concurrent tasks rewrite the same file without coordination.
- Keep new public CLI behaviour in the brief-completeness proposal subject to a separate contract/ADR decision; ordinary draft output remains valid until that decision.
- The Windows symlink hypothesis belongs to the existing [BS-214 - CI on Windows](BS-214-windows-ci.md), with its existing return condition. Do not create a duplicate Windows task or require an unavailable runner during this filing pass.

## Finding register

| Follow-up | Audit item | Cost / route |
|---|---|---|
| [BS-247.1 - Keep the real lock holder alive until the waiter confirms contention](../../archive/LOG.md#bs-247.1) | PQA-001 | completed; native archive outcome |
| [BS-247.2 - Make upgrade Git fixtures independent of user signing configuration](../../archive/LOG.md#bs-247.2) | PQA-002 | completed; native archive outcome |
| [BS-247.3 - Fail init fixtures immediately when Git preparation fails](../../archive/LOG.md#bs-247.3) | PQA-003 | completed; native archive outcome |
| [BS-247.4 - Make the missing-CLI startup test guard the Backslop instruction contract](../../archive/LOG.md#bs-247.4) | PQA-004 | completed; native archive outcome |
| [BS-247.5 - Assert full URL order in the mixed external-links test](../../archive/LOG.md#bs-247.5) | PQA-005 | completed; native archive outcome |
| [BS-247.6 - Remove the weaker diverged-quote probe after two deletion proofs](../minor/BS-247.6-remove-subsumed-quote-probe.md) | PQA-006 | minor; minor |
| [BS-247.7 - Say ADR lint requires a link while a table row is a convention](../../archive/LOG.md#bs-247.7) | PQA-007 | completed; native archive outcome |
| [BS-247.8 - Describe -X ours and -X theirs as hunk choices in both batch skills](../minor/BS-247.8-correct-batch-merge-option-description.md) | PQA-008 | minor; minor |
| [BS-247.9 - Update writer skills to acknowledge status Cost output](../minor/BS-247.9-correct-writer-status-cost-description.md) | PQA-009 | minor; minor |
| [BS-247.10 - Replace obsolete CHANGELOG_ENTRY documentation with entryTitle](../minor/BS-247.10-correct-changelog-export-docs.md) | PQA-010 | minor; minor |
| [BS-247.11 - Align stale-lock instructions and refusal text with identity-checked takeover](../minor/BS-247.11-stale-lock-takeover-contract.md) | PQA-011 | minor; minor |
| [BS-247.12 - Remove the obsolete claim that seed inventory does not distinguish scan and manual reading](../minor/BS-247.12-seed-adr-current-inventory-contract.md) | PQA-012 | minor; minor |
| [BS-247.13 - Make the init measurement note independent of an unnamed acceptance commit](../minor/BS-247.13-self-contained-init-measurement-note.md) | PQA-013 | minor; minor |
| [BS-247.14 - Limit the documented major-cost refusal to minor-mode hypotheses](../active/BS-247.14-new-major-refusal-minor-condition.md) | PQA-014 | major; active |
| [BS-247.15 - Document the selected language and English default of missing-template-key errors](../minor/BS-247.15-template-error-language-contract.md) | PQA-015 | minor; minor |
| [BS-247.16 - Align the localization ADR with same-version migration of a previous complete CLI render](../minor/BS-247.16-localization-adr-cli-redraw-contract.md) | PQA-016 | minor; minor |
| [BS-247.17 - Include ROLES.md in the module map's owned-render contract](../active/BS-247.17-module-map-owned-roles-document.md) | PQA-017 | major; active |
| [BS-247.18 - Describe ADR and non-triage backlog placeholder lint in the seed skills](../minor/BS-247.18-seed-placeholder-lint-scope.md) | PQA-018 | minor; minor |
| [BS-247.19 - Remove the unsupported pipe-regression explanation from the review test comment](../minor/BS-247.19-review-pipe-timeout-comment.md) | PQA-019 | minor; minor |
| [BS-247.20 - Add an opt-in mechanical completeness check for generated briefs](../active/BS-247.20-brief-opt-in-completeness-check.md) | PQA-020 | ordinary feature; active |
| [BS-247.21 - Verify and bound the local-midnight date race in the fold journal test](../minor/BS-247.21-fold-local-midnight-test-boundary.md) | PQA-021 | minor (hypothesis); minor |
| [BS-214 - CI on Windows: run the gates and verify platform and hook hypotheses](BS-214-windows-ci.md) | PQA-022 | Hypothesis; existing deferred task |

### Scheduling and shared files

- Start with the independent lock, Git-signing and init-fixture cards. The later Windows check retains its existing deferred return condition.
- Coordinate the ADR hint, stale-lock explanation, acceptance-commit pointer and refusal-condition wording: they share CLI/layout reference pages and guarded excerpts in `docs/README.md`.
- Assign one editor to the module-map corrections (current export name, template-error language, owned ROLES set). These are distinct facts in one file.
- Keep EN/RU template twins and existing guards in the same change. Coordinate edits to `test/templates.test.mjs`; do not open competing edits of its text assertions.
- Prove both different deletion mutations before removing the weaker quote test. Treat the local-midnight claim as a hypothesis until its bounded boundary probe decides it.
- Decide the proposed opt-in brief contract after the batch/writer wording corrections. Preserve default draft output and keep dispatch decisions with the orchestrator.

## Out of scope

- Product, template, documentation-contract or test fixes in the filing pass.
- A dead-code removal: the audit established no safe production deletion.
- Running release, publishing packages, adding a detector dependency or modifying remote history.

## Verification

- Every audit item has a linked follow-up or an explicit existing-card mapping; the two hypotheses remain marked as unobserved.
- Every child includes source evidence, a bounded change, preservation constraints and meaningful future acceptance checks. Historical audit commands and their exit codes remain distinct from not-run post-fix checks.
- For a documentation correction, the child names a guard that fails on the previous text. Test deletion requires both different mutations from protocol step 6, not two repeats of one mutation.
- Before accepting the implementation batch, record exact source/candidate SHAs and commands. Run `node bin/backslop.js gates --require-clean --base <integration-base>` on the final committed implementation, with the existing concurrency limit; this future acceptance is not run by the filing pass.

## Deferred

- **Deferred:** 2026-10-22
- **Reason:** This umbrella is blocked on the 21 independent follow-ups in Dependencies; it is not executable as one cleanup change.
- **Return condition:** Every dependency has a recorded outcome, including decisions or hypothesis verdicts; then reconcile the register and perform final integration acceptance on the committed implementation.
