# BS-124 · Route the remaining ternaries, gitOrFail and template-parity messages through tr()

- **Order:** 420
- **Scope:** [Reference](../../reference/README.md)
- **Created:** 2026-09-25
- **Dependencies:** BS-123, BS-115

## Context

`B` is the absolute path to this repo's `bin/backslop.js`; `T` is a fresh temporary directory. Line numbers refer to the v0.11.0 tree (commit 6f6318e).

User-facing text goes through `tr(lang, ru, en)` from lib/i18n.js:1-3 (373 call sites in lib/), with a bilingual `EN / RU` form only when no project language is known (the localization ADR: 'outside a project help and early errors are bilingual'). The sites below break that convention.

1. **Two-way language ternaries instead of `tr`.** verified — `grep -nE "lang === '(en|ru)'" lib/*.js`: new.js:35, 74, 78-80, 90; mv.js:162; tasks.js:77. Behaviour stays the same after the change (`tr` is `lang === 'en' ? en : ru`). Two sites look similar but are not candidates: the three-way no-project fallbacks at changelog.js:43-49 and bin/backslop.js:134, 141-146 (lang null means bilingual).
2. **`gitOrFail` drops the language.** verified — a probe: `gitOrFail(root, ['diff','--quiet'])` on a dirty repo throws `git diff --quiet: код 1`. util.js:52 calls `gitCause(r)` with no lang, so the default 'ru' applies, while all 14 other `gitCause` call sites pass lang (gates.js:79, archive.js:127, fold.js:353, show.js:64, …). The callers are tasks.js:578 (`git mv`) and archive.js:103. util.js:46-47 use raw ternaries.
3. **Template parity and slot gate messages are English-only.** verified — in a clone with `templates/en/skills/backslop-batch/SKILL.md` deleted and a `lang: ru` project whose `templates` is a symlink to that clone's templates: `lint` prints English `templates/en/… is missing`-style errors. templates.js:66-132 build the messages, and lint.js:118-131 prints them with no `tr`. These gates run only in the tool's own repository. version.js:21 and templates.js:30 are code-bug errors (plain `Error`, printed with a stack by design) and stay as they are.
4. **mv uses Russian quotes in English output.** verified — a CLI run in an en project: `mv 2 queue --top` prints `✔ BS-2: queue/ «Order» 5`. mv.js:181 has no `tr`, while mv.js:175 uses `tr(…, «…», “…”)`.

## Work to do

- Rewrite new.js:35, 74, 78-80, 90, mv.js:162 and tasks.js:77 as `tr(lang, ru, en)`. Leave changelog.js:43-49 and the bin three-way fallbacks as they are.
- lib/util.js: give `gitOrFail(root, args, lang)` a lang argument, pass `cfg.lang` from tasks.js:578 (thread it into the move helper) and archive.js:103, and write util.js:46-47 with `tr` (i18n.js has no imports, so no import cycle).
- lib/templates.js: give `templateParity(root, lang)` and `templateSlots(root, lang)` a lang argument and wrap their messages in `tr`. lint.js:118-131 passes `cfg.lang`.
- lib/mv.js:181: `tr(cfg.lang, `… «${name}» …`, `… “${name}” …`)`, as at :175.
- CHANGELOG.md, unreleased section: `git mv`/archive failures and the template-parity messages follow the project language; English `mv` output uses English quotes.

## Out of scope

- Runnable hints and the config file name — BS-123 (`cli-name-in-hints`).
- init.js messages (see the BS-122 (`init-flag-validation-messages`) card) and argv refusals from parseCommandArgs (see the BS-121 (`strict-command-argv`) card).
- version.js:21 and templates.js:30 plain Errors, which are code-bug errors by design.
- A new bilingual helper in i18n.js: the three-way fallbacks stay inline.

## Verification

- `grep -nE "lang === 'en' \?" lib/new.js lib/mv.js lib/tasks.js` finds nothing.
- New unit test for `gitOrFail(root, ['diff','--quiet'], 'en')` on a dirty repo: the message is `… exit code 1`.
- In an en project, `mv 2 queue --top` prints `“Order”`.
- `npm test` passes (report the count), and `node bin/backslop.js lint` gives rc=0.
