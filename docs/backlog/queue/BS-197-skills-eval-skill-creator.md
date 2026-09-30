# BS-197 · Evaluate the backslop-task and backslop-batch skill changes of this run with skill-creator

- **Order:** 966
- **Scope:** [01. Layout](../../reference/01-layout.md)
- **Created:** 2026-09-30
- **Dependencies:** BS-165, BS-169, BS-170, BS-171

## Context

Owner decision (2026-09-30): a skill that is created or changed goes through the `skill-creator` skill — a snapshot of the old version, test runs of the new version against the old one, and a viewer for the owner. Four cards of this run changed two skills without it:

- `backslop-task` — BS-165 (the probe passages became conditional slots) and BS-169 (the skill points to the AGENTS.md block steps instead of restating them, step 4 gains `gates --base` and `--keep-going`, history cut);
- `backslop-batch` — BS-170 ("Integration and acceptance": the squash reason, the containment check, the recipe link) and BS-171 (brief, tracks, measurements, one CLI spelling).

Their checks were structural: the cards' greps, template parity, tests that pin strings, a rendered `init`, and a reviewer's reading. No run compared how an agent follows the old and the new text. Owner decision (2026-09-30): this comparison runs before v0.13.0 is released, and the owner reviews the viewer before the release.

## Work to do

- **Snapshots.** Render both skills for Claude Code with `init --lang en --tools claude` in two throwaway projects: one at `v0.12.0` (`806779d`) and one at the current `main`. The old and new `SKILL.md` and references are the two versions to compare. Do the same for `--lang ru` if the runs show a language-specific difference.
- **Test prompts.** Write 4–6 realistic prompts per skill that exercise the changed parts (for `backslop-task`: taking a task, closing it with `archive`/`fold` and the draft, gates with `--base` on a committed branch, a red first gate; for `backslop-batch`: integrating two tasks from one branch, a CHANGELOG conflict between tracks, closing a minor batch, the end-of-run check). Do not take prompts or examples from the skills themselves: a skill measured on its own example scores itself.
- **Runs.** Follow `skill-creator`: run every prompt with the old and with the new version, each in an isolated context over a throwaway project, grade the outcomes against assertions written before the runs, and build the benchmark and the viewer.
- **Report.** Send the viewer (the HTML report) and the benchmark to the orchestrator as artifacts. For every regression or gap, file a finding with `node bin/backslop.js new … --parent 197` (a cost label, the prompt, and what each version did as Evidence).
- This card changes no skill text. Fixes go through the findings.

## Out of scope

- `backslop-seed` and the AGENTS.md block, which this run did not change as skills.
- The vendored writing skills (BS-188 compares its own modifications).

## Verification

- The viewer and the benchmark reach the orchestrator; every prompt has a result for both versions, graded against its assertions.
- Every regression the runs show has a finding record; `node bin/backslop.js lint` exits 0.
