# BS-183 · ADR: documentation rules ship to projects through lint, the writing skills and the writer pass

- **Order:** 970
- **Scope:** [Documentation index](../../README.md)
- **Created:** 2026-09-28
- **Dependencies:** BS-143, BS-144, BS-145, BS-146, BS-147, BS-148, BS-149, BS-150, BS-151, BS-152, BS-153, BS-154, BS-155, BS-156, BS-174

## Context

On 2026-09-28 the owner decided that the documentation checks and writing skills promptobus adopted for its release 0.20.0 become part of backslop: every project that runs backslop gets them through `lint` and through the adapters. This card records the decision as one ADR. The cards BS-184 … BS-192 implement it and cite this card for the decisions below.

The source is public: github.com/Velklish/promptobus, tag `v0.20.0` (commit `41a822e5`). Files: `scripts/docs-links.mjs`, `test/docs-links.test.mjs`, `test/docs-task-independence.test.mjs`, `test/adr-consolidation.test.mjs`, `test/release-writer.test.mjs`, `.agents/skills/humanizer/`, `.agents/skills/technical-documentation/`, `.agents/skills/tech-writer/`, `docs/guides/releasing.md`, `docs/guides/contributing.md` § Documentation links.

What made promptobus add them: on 2026-09-27 an audit of its documentation against the code filed 16 findings while every gate was green. The owner then required each documentation fix to carry a check that fails on the old text (13 fixes, each with its test), a link check with heading anchors, a check that documentation carries no task records, an ADR set of current decisions only, and a technical-writer pass before every release.

**Owner decisions, 2026-09-28** (numbered so the implementing cards can cite them):

1. The mechanical documentation checks live in `lint`. `init` already writes `gates: ["<cli> lint"]` (lib/init.js:85 at 744a653), so the checks reach every project through `upgrade`, with no configuration change.
2. They are strict for every project: no baseline of existing violations, no opt-in flag, no warning period. A project whose documentation breaks a rule turns red on upgrade and clears it in its own migration task.
3. Project documentation, the set that carries no task records: root `README*.md`; every `.md` under `<docs>/` except `<docs>/backlog/` and `<docs>/archive/` (ADRs included); the unreleased section of `CHANGELOG.md`. Released changelog sections are history, as they are for the pin check.
4. ADRs hold current decisions only. A new decision on a question already decided rewrites that question's ADR in place: same number, the rationale that still holds. A chain of ADRs on one question folds into its highest number. An ADR that governs nothing is deleted, and git keeps its history. Allowed statuses: Proposed and Accepted.
5. Two MIT-licensed writing skills are vendored and laid out by the adapters for every `lang`: humanizer (AI-writing patterns) and technical-documentation (Google's developer documentation style). A `lang: ru` project uses the currency part and the structural rules of technical-documentation; its `[EN]` layer is skipped for non-English text, and humanizer applies to English text only. No Russian slop reference is written.
6. There is no mechanical slop check in `gates`. Slop is removed by the writer pass, which walks every humanizer pattern and records one ledger row per pattern.
7. The writer pass runs in full (currency and style) before a release commit. It runs narrowed (currency over the run's diff) when a batch run closes, after every track is accepted and before the push.
8. The documentation assessment is both a score and filed findings: the technical-documentation audit report (score X/10, shippable yes or no), and every finding filed with evidence and a regression check.
9. A documentation fix carries a check that fails on the old text: a `quote:` block, a test or a lint rule.
10. External URLs are checked by a separate command and never inside `gates`: a network answer is not reproducible.

**Owner decisions, 2026-09-30:**

11. Agent hooks are a project's choice. A `hooks` field in `backslop.json` lists the harnesses (`claude`, `cursor`, `codex`) whose project hook files carry backslop's records; it is empty by default. At the end of an agent's turn the stop hook runs `lint` and returns the turn when `lint` reports an error in a file the session changed. An error in any other file never returns a turn, so a project that turned red on upgrade is not blocked. All three harnesses ship in one release; a harness item that could not be measured ships on the Claude Code protocol and is stated as not verified.
12. backslop ships documentation checks only. The checks this repository runs on its own code — comment length and width, the rule on where Cyrillic may appear — stay in this repository; a project adds its own code checks to `gates`.

## Work to do

- Create the ADR: `node bin/backslop.js adr docs-rules-ship-to-projects --title "Documentation rules ship to projects: lint checks, writing skills and the writer pass"`. Follow the house style of the consolidated ADRs of BS-143 … BS-156: `Status: Accepted`, `Deciders: Velklish`, and no task or finding numbers, run ids, commit hashes or owner-decision notes in the text.
- Context: why documentation drifts from the code under agent work, and why a green tracker lint does not show it. Broken anchors, task pointers, replaced ADRs and AI-writing patterns all pass a gate that checks only the tracker's own files.
- Decision: decisions 1–12 above, each as a rule a project can follow. Decision 11 names the `hooks` field of `backslop.json`, because it changes the config format.
- Options, only the rejected ones that still explain the choice, each with its cost in one sentence:
  - a separate `docs` command: a second entry point and a second `gates` line in every project;
  - one flag per check: the defaults decide everything, and the flag matrix multiplies the tests;
  - a shrink-only baseline of the existing violations: the owner chose to clear the debt in each project's migration task instead;
  - a warning period: warnings are not read;
  - a mechanical slop check, as a word list or through Vale: false positives on reference prose, which the local rules allow (inanimate subjects, uniform sentences), and Vale is a binary outside the Node standard library;
  - a Russian slop pattern list: new text to maintain with no upstream;
  - a writer pass only by request: it would not run.
  - git hooks instead of agent hooks: `core.hooksPath` is set per clone, it collides with husky and lefthook, and it does not stop an agent at the end of its turn;
  - a hook that blocks on every `lint` error: a project red after an upgrade would block every agent turn until its migration task lands;
  - shipping this repository's code checks (comment length, the language rule): they are one repository's style, not a documentation rule.
- Consequences:
  - `lint` stops being a tracker-only check. The comment-gate ADR's reasoning, that a repository's own style rule stays out of the product, keeps holding for code comments; documentation rules are the product's.
  - `upgrade` turns `lint` red in a project whose documentation carries task ids, tracker links, broken anchors or replaced ADRs. `lint` lists every violation, so the project's migration task can clear them.
  - The writer pass costs agent time at every release and at every batch close.
- `docs/README.md`: a row for the ADR.
- `docs/GLOSSARY.md`: rows, in the glossary format in force, for project documentation (the set of decision 3), writer pass, currency ledger, style ledger and documentation audit.

## Out of scope

- The implementation: BS-184 … BS-192.
- Clearing any consumer project's documentation: each does it in its own migration task.
- A CHANGELOG entry: this card changes no behaviour, and each implementing card writes its own.

## Verification

- `node bin/backslop.js lint; echo rc=$?` prints `rc=0`: gate 8 finds the ADR row, and gate 6 finds a file for every task number the new text mentions.
- `node bin/backslop.js gates; echo rc=$?` prints `rc=0`.
- The reviewer finds each of decisions 1–12 in the ADR's Decision section and no task number, commit hash or run id in the ADR text: `grep -nE 'BS-[0-9]|\b[0-9a-f]{7,40}\b' docs/adr/adr-*-docs-rules-ship-to-projects.md; echo rc=$?` prints `rc=1`.
