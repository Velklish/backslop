# BS-134 · init.test.mjs: fold duplicate tests into rows, drop subsumed tests and asserts

- **Order:** 520
- **Scope:** [02. CLI](../../reference/02-cli.md) § init
- **Created:** 2026-09-25
- **Dependencies:** BS-133

## Context

Line numbers are at commit 6f6318e (v0.11.0); if a line moved, find the test by the quoted name. A *mutation probe* means: edit the named lib line in the working tree, run the named test file with `node --test --test-timeout=60000 <file>; echo rc=$?`, read the red test names (lines starting with `✖`), then restore with `git checkout -- lib bin scripts templates`. Base run at 6f6318e: full suite 450 tests, 450 pass. Bug and code cards earlier in the queue changed some of the lib lines named in the mutation probes; apply each probe to the same logic where it lives when you start.

Base run: test/init.test.mjs 36 tests, 36 pass.

**3. `init: adapter path через symlink — отказ, за ссылку ничего не пишется` (:733) kills a subset of :628.** verified — mutation probe, full suite with the test skipped. lib/adapters.js:29 `if (link !== null) throw` -> `if (false) throw`: without :733, :628 still red. lib/mdwalk.js:39 returning an absolute path: :628 still red. Deleting the `checkAdapterRoots(root, cfg.tools, cfg.lang);` call (lib/init.js:96): only :628 red, :733 green. Its one extra assertion (nothing written behind the link, :741) belongs in :628's inner-link scenario.

**4. `init в пустом проекте: строка таблицы docs/README.md называет тот же ADR, что создан` (:578).** unverified — run the check first. Probe results not yet confirmed: in an empty project the created ADR is always 001. Deleting the row at templates/docs/README.md:12 reds :578 and :27 (lint at :51: `docs/adr/adr-001-process.md: нет строки в README.md`); hardcoding `adr-002` in that row reds :578 and :27 (`docs/README.md: битая ссылка adr/adr-002-process.md`); :482 (at :520) does the same for EN.

**5. `init: probe обрезается по краям — пробелы не уезжают в код-спан` (:137) is one input of :249.** verified — mutation probe. Both run init, set `probe`, re-init and read the step-4 text. Dropping `.trim()` at lib/init.js:112 (`probe: cfg.probe.trim()`) reds only :137 (pass 35, fail 1); :249 and :343 stay green — so its input must become a row of :249, not vanish. The row runs three inits instead of two: the merge saves code, not time.

**6. `init: скобки без определения ссылки остаются законным значением переопределения` (:179) is one override of :152.** verified — mutation probe. :152 already sets `'5': '[policy]'` and asserts exit 0 (:163) and the escaped text (:167). Removing `[` `]` from MD_PUNCT (lib/init.js:23) reds :152 and :179; rejecting `[` at lib/config.js:222 reds :152 and :179.

**7. `init: stepOverrides отклоняет переводы строк и сохраняет границы при повторе` (:194) is the slowest test in the file (1.5-1.6 s alone, 3.6 s in a loaded full-suite run).** verified — mutation probe. All 13 variants at :202-214 contain `\n` and hit the single char-class check `LINE_BREAK_RE = /[\r\n  ]/` (lib/config.js:18, :217), which config.test.mjs:162 unit-tests; setting that check to false reds both tests, and so does disabling the `<` check (lib/config.js:222). :229-230 assert template constants of `after`, already equal to `before` by :228; :233-242 repeat :110 (:128-130) and :27 (:46).

**8. Test :27 line :81 re-counts start markers implied by :80 and :46.** verified — mutation probe: only :81 goes. :82 (end-marker count) is the only end-marker count in :27 — making the first init write a second end marker (lib/init.js:288) fails :27 exactly at :82 (actual 2, expected 1).

**9. Test :749 line :757 repeats test/adapter-ownership.test.mjs:48.** verified — mutation probe. Same rel `.claude/skills/other/note.md` and expectation. :758 must stay: with :757-758 both removed, dropping `hasGeneratedMarker` from `isOwnedAdapterFile` (lib/adapter-ownership.js:58) leaves :749 green.

**Must stay:** :91, :110, :310, :368, :384, :424, :438, :526, :545, :558 (next free ADR number), :592, :610, :628, :717, :771, :799, :813, :826.

## Work to do

- Delete :733 and add `assert.ok(!existsSync(path.join(root, 'inner', 'skills')))` to :628's inner-link scenario after :655.
- Unverified — run the check first (:578): (1) blind probe: skip :578 (`test.skip`), delete the ADR row at templates/docs/README.md:12, run `node --test --test-timeout=60000 test/init.test.mjs; echo rc=$?` -> expect rc 1 with `init: раскладка, lint зелёный, …` (:27) red at :51; restore, hardcode `adr-002` in that row instead -> expect :27 red again, and `init --lang en: …` (:482) red at :520 for the EN row; (2) refutation: check that no doc or reference section names :578 as the guard of the created-ADR row (`grep -rn 'строка таблицы docs/README.md' docs test`) and that :27 and :482 still run `lint` on the fresh layout; (3) only if both probes stay red without :578, delete :578 — no test to add.
- Merge :137 into :249: add a third row `['ru', '  npm run probe  ', 'потом проба — `npm run probe`.', duty, missing]` with the probe value as a row field; the persisted-field assertion (:269) compares to the row's raw value. Delete :137.
- Merge :179 into :152: add stepOverrides `'6': 'см. таблицу [гейтов] и поле gates'` and move :179's escaped-line assertion (:188) into :152. Delete :179.
- In :194 keep one newline variant (`свой текст\n5. ложный шаг`) and one `<` variant (`свой текст <!-- backslop:end -->`) to prove at CLI level that a refusal leaves AGENTS.md unchanged; drop the other variants at :203-214, the second value at :222, :229-230 and :233-242.
- Delete :81 in :27 (keep :82).
- Delete :757 in :749 (keep :758).

## Out of scope

- The new `--prefix` and CLAUDE.md symlink guards — BS-133 (`init-test-new-guards`).
- Legacy-config tests (:449, :467): BS-107 (`marker-only-adapter-ownership`) removes :467 and cuts :449 down to its re-run half, dropping the `existsSync(templates/en)` assert at :458, together with the legacy inference.
- PREFIX_RE accepting a non-string prefix in backslop.json: a bug card, not this one.
- Any change under lib/ or templates/.

## Verification

- `node --test --test-timeout=60000 test/init.test.mjs; echo rc=$?` -> rc 0, tests 37 (40 after BS-133 (`init-test-new-guards`): -1 :733, -1 :137, -1 :179), or 36 if the :578 check confirmed and deleted it.
- Mutation probes: drop `.trim()` at lib/init.js:112 -> the :249 trimmed row red; remove `[` `]` from MD_PUNCT (lib/init.js:23) -> :152 red; delete the checkAdapterRoots call (lib/init.js:96) -> :628 red; drop hasGeneratedMarker at lib/adapter-ownership.js:58 -> :749 red at :758; LINE_BREAK_RE check -> false -> the shortened :194 and config.test.mjs:162 red.
- `npm test; echo rc=$?` -> rc 0.
