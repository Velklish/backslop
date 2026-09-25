# BS-126 · JSON contract: null for blank status fields, a total in seed --scan, documented tree.dirty

- **Order:** 440
- **Scope:** [02. CLI](../../reference/02-cli.md) § status --json
- **Created:** 2026-09-25
- **Dependencies:** BS-92, BS-98, BS-102

## Context

`B` is the absolute path to this repo's `bin/backslop.js`; `T` is a fresh temporary directory. Line numbers refer to the v0.11.0 tree (commit 6f6318e).

Machine-readable output is a contract: `status --json` is listed as stable in docs/reference/02-cli.md, under the section on what is stable, and orchestrators parse `gates --json`, `tracks --json` and `seed --scan --json`. Inconsistencies:

1. **`status --json` blank fields: `''` vs `null`.** verified — a CLI run in an en project, with a blank `- **Created:**` in a triage task and a blank `- **Cost:**` in a minor task: the triage entry has `"created":""`, and the minor entry has `"area":null,"cost":null`. status.js:31 applies `|| null` to area and cost, while :19 (created) and :24 (taken) pass `''` through. 02-cli.md:66 documents `null` only for area and cost. lint does not flag a blank Created in triage.
2. **`--json` shapes for dirty trees and totals.** verified — CLI runs with gates `['true', {command:'false', when:['src/**']}]` and untracked files. `gates --json` gives `tree.dirty` as one newline-joined string (`"?? g.err\n?? g.json"`, gates.js:19), while `tracks --json` gives `dirty` as an array of porcelain lines (tracks.js:36). `seed --scan --json` gives `{"gates":[],"subsystems":[]}` with no `total`, while tracks (:89) and gates (:276) carry `total`. The per-entry `skipped` reason string and the dry-run-only `dryRun: true` are documented at 02-cli.md:23 and stay as they are. Consumers on 0.9.0 and later read these shapes, so nothing documented gets renamed.

## Work to do

- lib/status.js:19 and :24: apply `|| null` to `created` and `taken`. Document in docs/reference/02-cli.md (`status --json` section, current language) that a blank or missing created, taken, area or cost is `null`.
- docs/reference/02-cli.md (gates entry): document `tree.dirty` as the newline-joined `git status --porcelain` lines of the project's area, with paths relative to the project (both sides of a rename; the BS-102 (`unverified-repo-state-reports`) card), and document `total` for `seed --scan --json`. lib/seed.js:53: add `total` (number of subsystems) to the scan JSON.
- `status --json` is a contract: state the null rule in docs/reference/02-cli.md (BS-176 (`orchestrator-contract-reference`) moves it into the contract page later), and add an English CHANGELOG entry under the unreleased section for the created/taken change and the new `seed --scan` total.

## Out of scope

- Changing `tree.dirty` to an array or renaming `skipped` / `dryRun`: both are documented and read by consumers.
- How `tree.dirty` is trimmed (fixed by the BS-92 (`gates-tree-labels-globs`) card).

## Verification

- test/commands.test.mjs (status --json): a blank Created gives `created: null`, and a blank Taken in an active task gives `taken: null`.
- test/seed.test.mjs: `seed --scan --json` has a numeric `total`.
- `npm test` passes (report the count), and `node bin/backslop.js lint` gives rc=0.
