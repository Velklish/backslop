# BS-203 · Messages in an unknown language are English: msgBoth is replaced

- **Scope:** [Reference](../../reference/README.md)
- **Created:** 2026-10-02
- **Dependencies:** none

## Context

Owner decision (2026-10-02): when the language of a message is unknown, the output is in the default language, English; it is not both languages joined by ` / `. The two internal refusals of `compareVersions` and `renderTemplate` already follow it: they take the project language where the caller has it and print English where it does not. The rest of the tool still prints both texts through `msgBoth` where the language may be unknown: 64 call sites in `lib/`, `bin/` and `scripts/` (`git grep -n msgBoth -- lib bin scripts | wc -l`, measured on main cb463ae). The contributor rule in `AGENTS.md` still says to use `msgBoth` there.

## Work to do

- `lib/i18n.js`: replace `msgBoth` — an unknown language gives the English text.
- Every `msgBoth` call site in `lib/`, `bin/` and `scripts/`: move to `msg` with the language the caller has, or English.
- `AGENTS.md` line 26: drop "or `msgBoth` where the language may be unknown" from the message rule.
- `docs/reference/02-cli.md` line 9 (the Language paragraph) and `docs/reference/06-module-map.md` line 24 (the Messages paragraph): state the new rule.
- The tests that pin the joined text and `templates/i18n/ru.mjs` entries that only `msgBoth` used.

## Out of scope

- Any change of the project-language messages.

## Verification

- A test per kind of call site: an `en` project and a call without a language print no Cyrillic.
- `git grep -n msgBoth -- lib bin scripts` finds nothing.
- `node bin/backslop.js gates` prints "gates 2, green 2".
