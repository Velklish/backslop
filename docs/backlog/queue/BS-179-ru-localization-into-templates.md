# BS-179 · Move the Russian CLI localization into templates/i18n/ru.mjs

- **Order:** 955
- **Scope:** [01. Layout](../../reference/01-layout.md)
- **Created:** 2026-09-25
- **Dependencies:** BS-115, BS-121, BS-122, BS-123, BS-124, BS-125, BS-177

## Context

Owner decision: everything in this repository is English; Russian lives only in `templates/`. The Russian localization of the CLI is part of the product (projects with `lang: ru` get Russian messages), so it moves into `templates/` instead of being dropped. Owner decision: it becomes a JavaScript module, `templates/i18n/ru.mjs`; English stays in the code as the source text.

Measured on ed498ec (a line counts when it contains a character in U+0400–U+04FF): `lib/` has 1051 such lines, 623 of them comments and 428 code — the Russian side of 372 `tr(lang, ru, en)` calls and the Russian vocabularies of the parsers (field names, section names, outcome words). `bin/backslop.js` has 54 such lines, mostly `HELP_RU`. Comments are the BS-181 (`english-comments-and-scripts`) card; this card moves only the strings and vocabularies.

## Work to do

- Create `templates/i18n/ru.mjs`: a module that exports the Russian text for every English message the CLI prints, keyed by the English message with named `{param}` placeholders; values may be strings or functions of the params (plural forms, word order). It also exports the Russian help text and the Russian parser vocabularies.
- Replace every `tr(lang, ru, en)` call (and the helpers built on it, such as `pick`) with a lookup that takes the English text and params only, for example `t(lang, 'refused: {path} is a directory', { path })`. With `lang: ru` it returns the module's Russian text; at runtime a missing key falls back to English.
- Parser vocabularies: the Russian field names, section names and outcome words that `lib/` reads from `ru` projects come from the module; the English ones stay in the code.
- `bin/backslop.js`: `HELP_RU` moves into the module.
- `templates/i18n/` is a CLI resource, not a project template. `init`, `migrate` and `upgrade` never copy it into a project. The template-parity check does not require an English twin under `templates/en/`. `package.json` `files` still ships it.
- Tests: add a parity test — every English message passed to the lookup has an entry in `ru.mjs`, and every entry in `ru.mjs` is used by the code. A dead or missing entry fails and names the message.
- Documentation: `docs/reference/01-layout.md` names `templates/i18n/ru.mjs` as the CLI's Russian localization. In `docs/reference/01-layout.md`, `02-cli.md` and `03-lint.md`, the Russian field names, section names and outcome words and the quoted Russian CLI messages give way to their English text and a pointer to `templates/i18n/ru.mjs`, so no Cyrillic is left on these pages. AGENTS.md § Contributor invariants and `docs/reference/06-module-map.md` (the "Add a command" recipe and the "Help" section) describe the English-keyed lookup and `templates/i18n/ru.mjs` instead of `tr(cfg.lang, ru, en)` and `HELP_RU`. Output does not change, so no CHANGELOG entry.

## Out of scope

- Russian literals in `test/` — the BS-180 (`tests-without-russian`) card.
- Comments, `scripts/` messages and `.gitignore` — the BS-181 (`english-comments-and-scripts`) card.
- The gate that keeps Cyrillic out — the BS-182 (`cyrillic-only-in-templates-gate`) card.
- Translating or rewording any message; the Russian text moves as it is.

## Verification

- Every line in `lib/` and `bin/` that still contains Cyrillic is a comment. Count the non-comment ones with the comment scanner (`test/comment-scan.mjs`); the count is 0. Record the command and its output.
- The full suite passes unchanged: the tests still hold their Russian expectations, and they must stay green. `node bin/backslop.js gates` is green.
- The same command sequence in a throwaway `lang: ru` project gives byte-identical stdout and stderr on the base commit and on the branch: `init`, `new x`, `status`, `mv 1 queue`, `lint`, `brief 1`, `help`. Record the diff (empty).
- Mutation probe: delete one entry from `templates/i18n/ru.mjs` → the parity test turns red and names the message; restore → green.
- `init` in a throwaway project does not create `i18n/` anywhere; `npm pack --dry-run` lists `templates/i18n/ru.mjs`.
- `docs/reference/01-layout.md`, `02-cli.md` and `03-lint.md` contain no character in U+0400–U+04FF. Count with node: BSD grep miscounts multibyte classes.
