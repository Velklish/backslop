# BS-203 · Messages in an unknown language are English: msgBoth is replaced

- **Order:** 1090
- **Scope:** [Reference](../../reference/README.md)
- **Created:** 2026-10-02
- **Dependencies:** none

## Context

Owner decision (2026-10-02): when the language of a message is unknown, the output is in the default language, English; it is not both languages joined by ` / `. The two internal refusals of `compareVersions` and `renderTemplate` already follow it: they take the project language where the caller has it and print English where it does not. The rest of the tool still prints both texts through `msgBoth` where the language may be unknown: 64 call sites in `lib/`, `bin/` and `scripts/` (`git grep -n msgBoth -- lib bin scripts | wc -l`, measured on main cb463ae). The contributor rule in `AGENTS.md` still says to use `msgBoth` there.

The call sites are not the whole of it (checked on main 287c8ce). `help` without a language prints both texts through no `msgBoth`: `const help` in `bin/backslop.js` (lines 72-75) returns `${HELP_EN}\n${RU.help(TOOL_VERSION)}` for an unknown language, so `git grep msgBoth` does not find it. The earlier rule is also stated in prose: `docs/adr/adr-051-localization.md` line 20 ("Outside a project the language is unknown, and the output carries both texts"), `docs/adr/adr-050-process.md` line 26 ("carries both languages outside a project"), `docs/reference/02-cli.md` line 401 (the `changelog` Output bullet: "outside a project it is in both languages") and `docs/reference/06-module-map.md` line 256 (`help(lang)`). The table `both` in `templates/i18n/ru.mjs` (three keys, lines 594-598) and the branch `RU.both` of `msgBoth` in `lib/i18n.js` go with the function.

## Work to do

- `lib/i18n.js`: replace `msgBoth` — an unknown language gives the English text.
- Every `msgBoth` call site in `lib/`, `bin/` and `scripts/`: move to `msg` with the language the caller has, or English.
- `AGENTS.md` line 26: drop "or `msgBoth` where the language may be unknown" from the message rule.
- `docs/reference/02-cli.md` line 9 (the Language paragraph) and `docs/reference/06-module-map.md` line 24 (the Messages paragraph): state the new rule.
- The tests that pin the joined text and `templates/i18n/ru.mjs` entries that only `msgBoth` used: the table `both` there, and the `RU.both` branch in `lib/i18n.js` with the function.
- `help` in `bin/backslop.js`: for an unknown language return `HELP_EN` only, so the Russian text is printed for `ru` alone; the test `help outside a project prints both languages` in `test/review.test.mjs` pins the joined text and changes with it. The comment above `help` in `templates/i18n/ru.mjs` already says that outside a project the English help is used; check it against the final code.
- `docs/adr/adr-051-localization.md` line 20: rewrite the Messages bullet in place, per step 3 of the AGENTS.md block: an unknown language gives the English text, and `help` prints the English text. Do the same for the sentence in `docs/adr/adr-050-process.md` line 26.
- `docs/reference/02-cli.md` line 401: the `changelog` Output bullet says that outside a project the "no entries" message is English; line 9 (the Language paragraph) covers the other commands, `help` included.
- `docs/reference/06-module-map.md` line 256: `help(lang)` prints `HELP_EN` outside a project; line 24 (the Messages paragraph) states the rule without `msgBoth`.
- The comments of `lib/config.js` (lines 169 and 195) and `lib/i18n.js` (line 21) that say the message "carries both texts": remove or rewrite them with the code they sit on.

## Out of scope

- Any change of the project-language messages.

## Verification

- A test per kind of call site: an `en` project and a call without a language print no Cyrillic.
- `git grep -n msgBoth -- lib bin scripts` finds nothing. This check does not catch `help`: a second check does, `git grep -n 'RU.help' -- bin lib` finds only the call in the `ru` branch of `help`, and a test runs `help` outside a project and finds no Cyrillic in its output.
- A test that fails on the old text: `help` outside a project prints `HELP_EN` and nothing from `RU.help`, and the `changelog` "no entries" message outside a project prints no Cyrillic.
- The documents stop stating the joined output: `git grep -n -i -E 'both (languages|texts)|both full texts|in both' -- docs/adr/adr-050-process.md docs/adr/adr-051-localization.md docs/reference/02-cli.md docs/reference/06-module-map.md` finds no line about the output outside a project. A `quote:` block in `docs/README.md` § Guarded statements holds the new Messages sentence of ADR-051 and fails on the old one.
- `node bin/backslop.js gates` prints "gates 2, green 2".
