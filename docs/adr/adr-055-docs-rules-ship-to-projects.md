# ADR-055: Documentation rules ship to projects: lint checks, writing skills, agent hooks and the writer pass

**Status:** Accepted
**Date:** 2026-09-30
**Deciders:** Velklish

## Context

Documentation drifts from the code faster under agent work than under human work. An agent changes code and updates the page it remembers; it does not walk the pages that point at that page. A heading is renamed and every link to its anchor breaks. A decision is replaced by a new ADR and the old one keeps describing behaviour that no longer exists. A sentence cites the task that introduced a feature, and that task is later folded into the journal, so the pointer leads nowhere. Text written by a model accumulates the same patterns, and a reader who spots them stops trusting the rest.

None of this shows in a green `lint`. The tracker lint checks the tracker's own files: task headers, status directories, the ADR table, the changelog structure. A broken anchor in a reference page, a task pointer in a README, a replaced ADR and an inflated sentence all pass it. An audit of one project's documentation against its code filed sixteen findings while every gate was green, so the gate measured something other than the state of the documentation.

A check that a project can turn off or postpone does not close this gap, because the drift is silent until a reader hits it. The rules therefore have to reach every project through the command each project already runs, and the judgement no script can make has to be a step of the process rather than an optional review.

## Options

- **A separate `docs` command** — a second entry point and a second `gates` line in every project, and a project that never adds the line never runs the checks.
- **One flag per check** — the defaults decide what most projects run, and the flag matrix multiplies the tests.
- **A shrink-only baseline of the existing violations** — a project would keep its debt indefinitely; clearing it in the project's own migration task is the chosen route.
- **A warning period** — warnings are not read.
- **A mechanical slop check, as a word list or through Vale** — false positives on reference prose, which the local writing rules allow (inanimate subjects, uniform sentences), and Vale is a binary outside the Node standard library.
- **A Russian slop pattern list** — new text to maintain with no upstream.
- **A writer pass only by request** — it would not run.
- **Git hooks instead of agent hooks** — `core.hooksPath` is set per clone, it collides with husky and lefthook, and it does not stop an agent at the end of its turn.
- **A stop hook that blocks on every `lint` error** — a project that is red after an upgrade would block every agent turn until its migration lands.
- **Shipping this repository's code checks (comment length, the language rule)** — they are one repository's style, not a documentation rule.

## Decision

1. **The checks live in `lint`.** `init` already writes `lint` as the project's gate, so the documentation checks reach every project through `upgrade` with no configuration change. A project does not add a command.
2. **The checks are strict for every project.** There is no baseline of existing violations, no opt-in flag and no warning period. A project whose documentation breaks a rule turns red on upgrade and clears the violations in its own migration task; `lint` lists every one of them.
3. **Project documentation is the set that carries no task records:** root `README*.md`; every `.md` under `<docs>/` except `<docs>/backlog/` and `<docs>/archive/`, ADRs included; the unreleased section of `CHANGELOG.md`. Released changelog sections are history: the pin check skips the changelog file altogether, and the documentation checks skip its released sections. The checks read this set and nothing else.
4. **ADRs hold current decisions only.** A new decision on a question that is already decided rewrites that question's ADR in place: same number, and the rationale that still holds. A chain of ADRs on one question folds into its highest number. An ADR that governs nothing is deleted; git keeps its history. The allowed statuses are Proposed and Accepted.
5. **Two writing skills ship, laid out by the adapters for every `lang`:** humanizer, which removes AI-writing patterns, and technical-documentation, which applies a developer documentation style guide. A project with `lang: ru` uses the currency part and the structural rules of technical-documentation; the English-language layer of that skill is skipped for non-English text, and humanizer applies to English text only. No Russian slop reference is written. Both skills are vendored from their MIT-licensed upstreams unchanged apart from the modifications the vendored copy lists, with the licence and the source laid out beside them. technical-documentation follows Google's developer documentation style. This is third-party text, not code, so the rule "standard library only: no dependencies" is unaffected.
6. **`gates` has no mechanical slop check.** Slop is removed by the writer pass, which walks every humanizer pattern and records one row per pattern in the style ledger.
7. **The writer pass runs at two points.** In full, currency and style, before a release commit. Narrowed, currency over the run's diff, when a batch run closes: after every track is accepted and before the push. Both forms record a currency ledger: one row per behaviour-changing commit in the pass's input, with what changed and the documentation that states it now, or why none is needed. The full pass also records the style ledger of Decision 6.
8. **A documentation assessment is a score and findings.** The audit of the technical-documentation skill is the source of the score out of 10 and of the verdict on whether the documentation is shippable, and every finding it reports is filed with evidence and a regression check.
9. **A documentation fix carries a check that fails on the old text:** a `quote:` block, a test or a lint rule. A fix without one is not closed.
10. **External URLs are checked by a separate command and never inside `gates`.** A network answer is not reproducible, so a gate that depends on it would fail for reasons outside the change.
11. **Agent hooks are a project's choice.** The `hooks` field of `backslop.json` lists the harnesses — `claude`, `cursor`, `codex` — whose project hook files carry backslop's agent hooks; it is empty by default. The stop hook, the agent hook that runs at the end of an agent's turn, runs `lint` and returns the turn when `lint` reports an error in a file the session changed. An error in any other file never returns a turn, so a project that turned red on upgrade is not blocked. All three harnesses ship together; a harness item that could not be measured ships on the Claude Code protocol and is stated as not verified.
12. **backslop ships documentation checks only.** The checks this repository runs on its own code — comment length and width, the rule on where Cyrillic may appear — stay in this repository. A project adds its own code checks to `gates`.

## Consequences

- `lint` stops being a tracker-only check. The reasoning of the comment-length ADR, that a repository's own style rule stays out of the product, keeps holding for code comments; documentation rules are the product's.
- `upgrade` turns `lint` red in a project whose documentation carries task ids, tracker links, broken anchors or replaced ADRs. The project's migration task clears the listed violations; until then its gate is red, by design.
- The writer pass costs agent time at every release and at every batch close.
- Enabling `hooks` puts agent hooks into the project hook files of the harnesses and makes the stop hook part of every agent turn there, so a project turns it on knowingly.
