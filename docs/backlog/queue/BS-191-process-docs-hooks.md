# BS-191 · Process: a documentation fix carries a check red on the old text; the writer pass at release and at batch close

- **Order:** 1050
- **Scope:** [01. Layout](../../reference/01-layout.md)
- **Created:** 2026-09-28
- **Dependencies:** BS-187, BS-189, BS-190, BS-162, BS-163, BS-164, BS-169, BS-170, BS-171

## Context

Owner decisions 3, 7 and 9 of BS-183:

- documentation does not cite tasks;
- the writer pass runs in full before a release commit, and narrowed to currency when a batch run closes, after every track is accepted and before the push;
- every documentation fix carries a check that fails on the old text: a `quote:` block, a test or a lint rule.

The process texts do not say any of this yet. At 744a653, step 3 of the managed AGENTS block (`templates/{en/,}agents-section.md`) requires updated documentation in the same pass and an ADR for an architectural decision. It says nothing about a regression check, task citations or the writer pass. The batch skill (`templates/{en/,}skills/backslop-batch/SKILL.md`) has no closing documentation step.

The rule's origin: promptobus closed 13 documentation fixes on 2026-09-27 under the owner's requirement that each carry a check red on the old text (see BS-190).

## Work to do

- **AGENTS block,** both languages; BS-187 owns the ADR clause of step 3.
  - Step 3 gains: "A documentation fix carries a check that fails on the old text: a `quote:` block, a test or a lint rule." and "Documentation does not cite tasks: state the contract, the rationale or the measurement."
  - The Skills line names `backslop-writer`, `backslop-techdoc` and `backslop-humanizer`, still under "when an adapter is selected".
  - A release sentence outside the numbered steps, so the `agents.stepOverrides` keys `"1"`–`"7"` keep their meaning: "Before a release commit, run the `backslop-writer` pass in release mode over the diff since the previous tag."
- **`backslop-batch`** (both layers): a closing step after every track is accepted and before the push. It runs the writer pass in batch-close mode (currency over `<run base>..HEAD`), its commits are reviewed like any piece, and its findings are filed.
- **`backslop-task`** (both layers): the step-3 expansion names the regression check for a documentation fix and points to `backslop-writer` for style.
- **`templates/{en/,}docs/backlog/README.md`,** tool-owned and redrawn by `migrate`: a documentation card's Verification names a check that fails on the old text. This repository's `docs/backlog/README.md` changes in the same commit, as `AGENTS.md` requires for that pair.
- **The brief template** (`templates/{en/,}brief.md`): the same rule where the brief states verification.
- The acceptance redraws this repository's own AGENTS block with `node bin/backslop.js init` and commits it with the task.
- **Tests:** update the literal strings the suite pins for the changed sentences (grep `test/` for each sentence you change), and keep template parity.
- **`CHANGELOG.md`** under the unreleased section: block step 3, the Skills line and the release sentence changed; a project with `agents.stepOverrides` for step 3 should review its override.

## Out of scope

- The gates themselves: BS-184, BS-186, BS-187.
- The skills themselves: BS-188, BS-189, BS-190.

## Verification

- In a fresh `init --lang en` project and a fresh `init --lang ru` project, the AGENTS block carries the new step-3 sentences, the Skills line and the release sentence, and `lint` exits 0.
- `migrate` on a project stamped with the previous version redraws `docs/backlog/README.md` with the rule. Record the command and its exit code.
- `node bin/backslop.js gates` exits 0.
