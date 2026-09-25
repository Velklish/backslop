# BS-142 · Split bundled help and mv tests, guard the mv usage line, prune adapter-ownership tests

- **Order:** 600
- **Scope:** [02. CLI](../../reference/02-cli.md) § help
- **Created:** 2026-09-25
- **Dependencies:** BS-129, BS-97, BS-121, BS-107

## Context

Line numbers are at commit 6f6318e (v0.11.0); if a line moved, find the test by the quoted name. A *mutation probe* means: edit the named lib line in the working tree, run the named test file with `node --test --test-timeout=60000 <file>; echo rc=$?`, read the red test names (lines starting with `✖`), then restore with `git checkout -- lib bin scripts templates`. Base run at 6f6318e: full suite 450 tests, 450 pass. Bug and code cards earlier in the queue changed some of the lib lines named in the mutation probes; apply each probe to the same logic where it lives when you start.

Base runs: review 5 tests, adapter-ownership 5, commands 49 (47 after the BS-129 (`commands-test-cleanup`) card), all pass.

**1. `команды вне проекта отказывают с подсказкой про init` (commands.test.mjs:612) bundles two behaviours and constant help prose.** verified — mutation probe. :615-617 test the refusal outside a project. :618-620 test that help outside a project prints both languages — the only guard of bin/backslop.js:134 (`lang === 'en' ? HELP_EN : lang === 'ru' ? HELP_RU : `${HELP_EN}\n${HELP_RU}``): replacing the bilingual branch with `HELP_RU` reds only this test, review.test.mjs stays 5/5. :621-624 match fixed help prose from bin/backslop.js:47, :62, :101, :116 and guard nothing but the literal text.

**2. `help, version, --help у команды, неизвестная команда` (review.test.mjs:102) bundles four surfaces and overclaims.** verified — mutation probe. help content (:105-112), version (:113-114), `new --help` (:115-117), unknown command (:118-120); :108's regex is a prefix of `flags` (:124), matched at :125 on a second, identical `help` spawn. The comment at :122-123 says the mv help line and the command's own usage are both checked, but no test asserts lib/mv.js:210: dropping ` | --restore` from the RU usage there keeps the full suite 450/450 green; `grep -rn 'нужны номер и статус\|--restore\]' test` -> no matches (rc 1).

**3. `mv --after на чужую задачу отказывает до переноса; дубль номера — отказ с обоими путями` (review.test.mjs:52) bundles two behaviours.** verified — read. :58-62: `mv 2 queue --after 7` refuses before moving; :64-73: a second BS-1 file makes `mv 1 active` and `new f --parent 1` refuse naming both paths (lib/tasks.js:228). The lint tests with «занят дважды» (lint.test.mjs:130, :392) check a different message.

**4. `cursorRel: SKILL.md становится mdc, references остаются каталогом` (adapter-ownership.test.mjs:22-25) is covered by init tests.** verified — mutation probe, full suite with the test skipped. lib/adapter-ownership.js:23 `=== 'SKILL.md'` -> `!==`: without the test still 6 init/lint tests red. Line 25 `${root}/${skill}/${rest.join('/')}` -> `${root}/${rest.join('/')}`: without the test still red `init: adapters имеют canonical layout; deselect удаляет только owned outputs` (a single guard, asserting `.cursor/rules/backslop-batch/references/measurements.md`).

**5. `hasGeneratedMarker` LF (:27) and CRLF (:67) tests are one table.** verified — read. Both write `markGenerated(text)` into `scratch()` and assert `hasGeneratedMarker(file) === true` for a plain and a frontmatter text against the single regex at lib/adapter-ownership.js:18; :27 adds the quoted-marker negative (:31/:34), :67 the CRLF placement regex (:76).

**Must stay:** review :10 (CRLF and BOM, Windows), :33, :81 (stdout through a slow pipe); adapter-ownership :41, :55.

## Work to do

- In commands.test.mjs :612 keep :615-617 and remove :618-624.
- Split review.test.mjs :102 into (a) help content RU and EN, reusing `r.out` from :105 instead of spawning `help` again at :125, dropping :108; in the same test run `mv` without arguments and match the usage with `[--top | --after M | --restore]` in stderr (the only guard of lib/mv.js:210), and rewrite the comment at :122-123 to say what is checked; (b) one table `{ args, code, stream, regex }` for `version`, `new --help` and an unknown command.
- Add a test `вне проекта справка печатается на обоих языках` with the check moved from commands.test.mjs:618-620 (help run from `path.dirname(root)`, /Commands:/ and /Команды:/).
- Split review.test.mjs :52 into `mv --after на чужую задачу отказывает до переноса` (:55-62) and `дубль номера: mv и new отказывают с обоими путями` (:64-73); no assertion dropped.
- Delete adapter-ownership.test.mjs :22-25 and `cursorRel` from its import.
- Replace adapter-ownership.test.mjs :27 and :67 with one test over rows `{ text, expect }`: LF plain, LF frontmatter, CRLF plain, CRLF frontmatter (true), a raw quoted marker in the body (false); keep the :76 placement regex for the CRLF frontmatter row.

## Out of scope

- Changing command hint texts or usage lines (a code card owns them); if lib/mv.js:210 changes there, update the usage regex here.
- Asserting constant help prose.
- Any change under lib/ or bin/.

## Verification

- `node --test --test-timeout=60000 test/review.test.mjs test/adapter-ownership.test.mjs test/commands.test.mjs; echo rc=$?` -> rc 0; review 8 tests (5 +1 split of :102, +1 bilingual help, +1 split of :52), adapter-ownership 3, commands unchanged by this card.
- Mutation probe lib/mv.js:210 drop ` | --restore` from the RU usage -> the help test red (green at base).
- Mutation probe: make the no-project branch of the help selection (bin/backslop.js:134 at 6f6318e; `pick(…)` after the BS-115 (`project-lang-fallback`) card) return `HELP_RU` -> the bilingual help test red.
- Mutation probes lib/adapter-ownership.js:23 `!==` and :25 without `${skill}/` -> `init: adapters имеют canonical layout; …` red; GENERATED_AT at lib/adapter-ownership.js:18 `\r?\n` -> `\n` -> the CRLF rows red.
- `npm test; echo rc=$?` -> rc 0.
