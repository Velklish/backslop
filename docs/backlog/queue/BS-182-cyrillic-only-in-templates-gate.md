# BS-182 · Gate: Cyrillic only in templates/, docs/backlog/ and docs/archive/

- **Order:** 959
- **Scope:** [Reference](../../reference/README.md)
- **Created:** 2026-09-25
- **Dependencies:** BS-179, BS-180, BS-181, BS-175

## Context

Owner decision: everything in this repository is English. Russian lives only in:

- `templates/` — the ru template layer and `templates/i18n/ru.mjs`;
- `docs/archive/` — the history of closed tasks;
- tracker cards under `docs/backlog/`, which may quote Russian messages.

A rule that no check holds is reverted silently by the next edit. After BS-179, BS-180 and BS-181 the rest of the repository is free of Cyrillic, and a gate keeps it that way.

## Work to do

- Add a test to `npm test` (for example `test/english-only.test.mjs`). Every file tracked by git outside `templates/`, `docs/backlog/` and `docs/archive/` contains no character in U+0400–U+04FF. A failure names each hit as file:line.
- Before adding the test, list every Cyrillic hit outside the three places. Fix each one here: translate it, or move it into `templates/i18n/ru.mjs` when it is localization. The list and what was done with each hit go to result.md.
- AGENTS.md (outside the managed block): state the language rule and the three places where Russian may live.

## Out of scope

- A `lint` gate for consumer projects: the rule is about this repository only.

## Verification

- `node bin/backslop.js gates` is green on the branch.
- Mutation probe: add a Cyrillic line to a file in `lib/` and commit it → the test turns red and names file:line. Revert → green. Record the probe with its commit, the exit codes and the red verdict name.
- A Cyrillic line in `templates/`, `docs/backlog/` or `docs/archive/` does not turn the test red.
