# BS-180 · Tests without Russian: English names, comments and messages; Russian expectations from templates

- **Order:** 957
- **Scope:** [Reference](../../reference/README.md)
- **Created:** 2026-09-25
- **Dependencies:** BS-179, BS-140, BS-142

## Context

Owner decision: everything in this repository is English; Russian lives only in `templates/`. Measured on ed498ec (a line counts when it contains a character in U+0400–U+04FF), `test/` has 2626 such lines in 26 files:

- 350 test names;
- 432 comment lines;
- 1793 code lines: assert messages, Russian expected output, Russian fixture texts.

The Russian expectations test a real product behaviour: projects with `lang: ru` get Russian output. They stay tested, but the Russian text comes from `templates/` — from `templates/i18n/ru.mjs` (after BS-179) and from the Russian templates — instead of literals in `test/`.

## Work to do

- Test names: translate every Russian test name to English, one to one, keeping the meaning. Record the rename table (old name → new name) in result.md.
- Comments and assert messages in `test/`: English.
- Russian expected output: take it from `templates/i18n/ru.mjs` through the same lookup the code uses, or from a rendered Russian template, instead of a literal. Where a test checks that Russian and English differ, keep that check.
- Russian fixture documents (task cards, results, journals of a `lang: ru` project): build them from the Russian templates and vocabularies at test time. Do not store them as literals.
- `test/fixtures/`: translate Russian texts that do not test Russian handling; generate the rest as above.
- `docs/reference/06-module-map.md`, section "Tests": say where the Russian expectations come from now (`templates/i18n/ru.mjs` and the Russian templates) instead of literals in `test/`.

## Out of scope

- Changing what any test checks. The suite keeps the same verdicts, only renamed.
- Comments in `lib/`, `bin/`, `scripts/` — the BS-181 (`english-comments-and-scripts`) card.

## Verification

- No tracked file under `test/` contains a character in U+0400–U+04FF. Record the command and its count (0), and cross-check the count by a second method.
- Test count before and after is equal. The rename table maps every old verdict name to exactly one new name: the set difference of the verdict names, taken through the table, is empty. Record both counts and the difference.
- Mutation probe: change one Russian message in `templates/i18n/ru.mjs` that a test asserts → that test turns red. The tests still check the Russian output, now through the resource. Restore → green.
- `node bin/backslop.js gates` is green.
