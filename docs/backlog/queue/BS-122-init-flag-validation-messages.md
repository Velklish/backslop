# BS-122 · init messages: localized flag errors, flag names, seed hint only with an adapter

- **Order:** 400
- **Scope:** [02. CLI](../../reference/02-cli.md) § init
- **Created:** 2026-09-25
- **Dependencies:** BS-121, BS-94, BS-119

## Context

`B` is the absolute path to this repo's `bin/backslop.js`; `T` is a fresh temporary directory. Line numbers refer to the v0.11.0 tree (commit 6f6318e).

`init` checks its flags with wording that differs from `loadConfig` and from the rest of the CLI (the rule itself — one docs-path check and one `validateConfig` for init and `loadConfig` — was unified by BS-94 (`config-validation-one-rule-set`)). The docs set the rule: ADR on localization says the human CLI speaks the config language, and only help and early errors outside a project are bilingual. `changelog.js:43` shows the pattern: bilingual only when `lang === null`, otherwise `tr(lang, …)`.

1. **Flag errors stay bilingual when `--lang` is given, and one sentence mixes both languages.** verified — CLI runs. `init --lang en --tools bogus` gives rc=1 with `✖ --tools «bogus»: comma-separated claude,cursor,codex или none / or none`. `init --lang en --prefix x` gives rc=1 with `✖ --prefix “x”: expected 2–6 uppercase … / нужны 2–6 заглавных …`. In an en project with `tools: ["vim"]`, `status` gives rc=1 with `✖ backslop.json: tools — список без повторов из claude, cursor, codex / unique array of claude, cursor, codex` (config.js:127), although `lang` is already known at config.js:101 and the checks next to it (:121, :132) use `tr(lang)`. The bilingual text is correct at `init.js:47` (`--lang` itself is invalid), and at :68 and :71 when no `--lang` is given.
2. **`--cli`/`--dir` errors name `backslop.json` on a fresh project.** verified — a CLI run. `init.js:76-77` reuses `validateBlockValue`, which prefixes every message with `${CONFIG_FILE}: ${field}` (config.js:146-152). `init --lang en --cli 'a`b'` gives rc=1 with `✖ backslop.json: cli must not contain a backtick…`, and `ls -A` shows only `.git`, so no config exists yet. Other init flag errors name the flag (init.js:68 `--prefix “…”`, :71 `--dir “…”`). test/init.test.mjs:91-95 matches only the `cli — …` text.
3. **An untranslated word in the summary.** verified — a CLI run in a ru project. `init.js:189` `info(`adapter outputs: ${… : 'none'}`)` is the only summary line not wrapped in `tr`. `init --tools none` prints `  adapter outputs: none` between Russian lines. The term 'adapter outputs' is kept in English on purpose elsewhere (adapters.js:128); only the empty value needs a translation.
4. **Success line prefix.** verified — read the code and a CLI run. `init.js:187-188` prints `✔ backslop init: docs/ (prefix BS), …`, while migrate.js:115, upgrade.js:126/165, lint.js:679 and archive.js:47 start with the bare command name. No test asserts `backslop init:` on the success line; test/commands.test.mjs:617 matches the refusal hint.
5. **The seed hint ignores missing adapters.** verified — a fresh `init` run. A fresh `init --lang en` with no adapter prints `next: … use the backslop-seed skill to populate docs`, although no skill is installed; the hint is unconditional at `lib/init.js:197-199`. `README.md:45` names the skill without the adapter condition, while `:31` and `:93` state it.

## Work to do

- lib/init.js:68, :71, :208: when `--lang` was given (or the existing config's lang is known), use `tr(lang, ru, en)`. Keep the bilingual form only when the language is unknown, following changelog.js:43. Keep `init.js:47` bilingual.
- lib/init.js:208: write the bilingual `--tools` text as two whole sentences, `EN / RU`, with no interleaving.
- lib/config.js:127: use `tr(lang, …)` like :121 and :132.
- lib/config.js `validateBlockValue`: take a label argument. `init` passes `--cli` / `--dir`, and `loadConfig` keeps `backslop.json: cli`. Keep the field-name text that test/init.test.mjs:93-95 matches.
- lib/init.js:189: `info(tr(cfg.lang, `adapter outputs: ${list || 'нет'}`, `adapter outputs: ${list || 'none'}`))`.
- lib/init.js:187-188: change the prefix to `init:`. Grep test/ for `backslop init:` and update any match.
- Item 5, test first: in `test/init.test.mjs` assert that `init --lang en` without adapters prints no `backslop-seed` hint and suggests `--tools`, and that `init --lang en --tools claude` prints the hint; see the first assertion fail; then make the `next:` line in `lib/init.js:197-199` mention the seed skill only when `cfg.tools` is non-empty (both languages via `tr`).
- CHANGELOG.md: add an English entry under the unreleased section: `init` flag errors follow `--lang` (or the existing config language), the success line starts with `init:`, and `init` suggests the seed skill only when an adapter is selected.

## Out of scope

- Other checks in validateBlockValue or loadConfig.
- Hints that print the CLI name (see the BS-124 (`messages-through-tr`) card).

## Verification

- New tests: `init --lang en --tools bogus` gives rc=1 and the text contains no Cyrillic. `init --lang en --prefix x` gives rc=1 with English only. `init --tools bogus` without `--lang` in an empty directory stays bilingual. An en project with `tools: ["vim"]` makes `status` fail in English only.
- New test: `init --lang en --cli 'a`b'` gives rc=1, the message starts with `--cli`, and no `backslop.json` is created.
- In a ru project, `init --tools none` prints `adapter outputs: нет`, and the success line starts with `✔ init:`.
- In an empty `git init` directory: `node <repo>/bin/backslop.js init --lang en` stdout has no `backslop-seed`; in another, `init --lang en --tools claude` stdout has it; both rc=0.
- `npm test` passes (report the count), and `node bin/backslop.js lint` gives rc=0.
