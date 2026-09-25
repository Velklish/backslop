# BS-181 · English comments and maintainer messages in lib/, bin/, scripts/ and .gitignore

- **Order:** 958
- **Scope:** [Reference](../../reference/README.md)
- **Created:** 2026-09-25
- **Dependencies:** BS-179, BS-180, BS-150

## Context

Owner decision: everything in this repository is English; Russian lives only in `templates/`. Measured on ed498ec (a line counts when it contains a character in U+0400–U+04FF):

- 623 comment lines in `lib/`, 5 in `bin/backslop.js`, 8 in `scripts/release.mjs`;
- 23 code lines in `scripts/release.mjs` — Russian-only maintainer messages, not localized;
- `.gitignore:4`, a hand-written Russian comment.

A rewritten comment has to stay true to the code it sits on. In an earlier sweep of 174 comment blocks, three rewritten blocks contradicted the code. A comment is translated against the code, not paraphrased from the old text.

## Work to do

- Translate every Russian comment in `lib/`, `bin/` and `scripts/` to English. Keep the comment rules: at most two lines, at most 100 characters per line, no origin notes (task numbers, dates, review remarks); keep existing `ADR-NNN` pointers. For each rewritten comment, read the code under it and make the text true for that code.
- `scripts/release.mjs`: its messages become English only; the script is for the maintainer and is not localized.
- `.gitignore`: translate the comment on line 4.

## Out of scope

- Russian strings that are localization (they live in `templates/i18n/ru.mjs` after BS-179).
- `test/` (BS-180), `templates/` (Russian by design).

## Verification

- No tracked file under `lib/`, `bin/` or `scripts/`, and not `.gitignore`, contains a character in U+0400–U+04FF. Record the command and the count (0), and cross-check it by a second method.
- Behaviour unchanged. Strip comments with the comment scanner and compare `lib/` and `bin/` between the base commit and the branch: the difference is empty. `scripts/release.mjs` differs only in message strings.
- The comment gate in `npm test` is green, and so is `node bin/backslop.js gates`.
- result.md lists the rewritten comments that needed more than a translation because the old text was not true for the code. Each gets file:line and one line on what was wrong.
