# BS-135 · merge-changelog.test.mjs: bump and marker tables, drop re-asserts, split bundled tests

- **Order:** 530
- **Scope:** [02. CLI](../../reference/02-cli.md) § merge-changelog
- **Created:** 2026-09-25
- **Dependencies:** BS-87, BS-114

## Context

Line numbers are at commit 6f6318e (v0.11.0); if a line moved, find the test by the quoted name. A *mutation probe* means: edit the named lib line in the working tree, run the named test file with `node --test --test-timeout=60000 <file>; echo rc=$?`, read the red test names (lines starting with `✖`), then restore with `git checkout -- lib bin scripts templates`. Base run at 6f6318e: full suite 450 tests, 450 pass. Bug and code cards earlier in the queue changed some of the lib lines named in the mutation probes; apply each probe to the same logic where it lives when you start.

Base run: test/merge-changelog.test.mjs 31 tests, 31 pass, 5.1 s. Mutation names below are one-string edits of lib/merge-changelog.js.

Below, `lib:NNN` means lib/merge-changelog.js:NNN (the mutated line) and `test:NNN` means test/merge-changelog.test.mjs:NNN.

**1. Three bump-permutation tests (test:179, test:191, test:200) share helpers and the identical expected entries.** verified — mutation probe. All call `mergeChangelog(ours, theirs, base|null, 'ru', onlyFirstTagged)` and assert `entries(text)` = `['Своя ours', 'Общее', 'Своя theirs', 'Старое']` (test:188, test:197, test:206); they differ by which side is bumped (base only in test:179) plus small extras (dropped, headings, `report.theirs`). M5 (lib:237, the theirs `released` argument -> `() => true`) turns test:179, test:200 and test:237 red; M6 (lib:231, the same for ours) turns test:179, test:191 and test:237 red; M7 (lib:143, the same for base) turns test:179 and test:237 red. No row is uniquely load-bearing (test:179 kills all three); keep the rows as scenarios.

**2. Three marker-prose false-positive tests (test:494, test:507, test:613) differ only by where the prose sits.** verified — mutation probe. Each builds ours/theirs = header + unreleased section with prose `<!-- backslop:conflict` + own entry and asserts `report.marks === 0` (test:501, test:514, test:620); test:613 asserts less. M2 (lib:26, `MARK_LINE` unanchored) turns test:507 and test:613 red; M3 (lib:26, `MARK_LINE` = `/^\s*<!--/`) turns only test:613 red; M27 (lib:329, marks counted as substrings over the whole output) turns test:494, test:507, test:520 and test:613 red; M28 (lib:329, substrings counted in released sections) turns test:494 and test:520 red. Keep test:494 as a cheap unit row and keep test:520: it is the only test red on M4, an edit of the CLI mark count at lib:416 (`const marks = report.marks;`) that also counts prose marks, for example `text.split(CONFLICT_MARK).length - 1` — rerun M4 to confirm that before relying on it. test:520's name promises "а строка-метка — 1" but its body only checks rc 0 — the rc-1 half lives in test:467.

**3. test:331-335 (CLI without `--base`) repeat a default already pinned by other CLI tests.** verified — mutation probe. M10 (lib:374, base defaults to `--ours`) is red in test:214, test:270 and test:314; the unit test test:122 cannot reach the CLI default.

**4. test:284 re-counts `- **Общее**` already pinned.** verified — mutation probe. The unit test test:38 asserts the exact merged text for the same OURS/THEIRS, and test:285 (`в результате 3`) fails on a duplicate too; M8 (lib:294, the `seen` skip dropped) is red in 20 tests including test:38 and test:270.

**5. The input-mark refusal (test:482-488) hides inside the CLI conflict-exit test test:467.** verified — mutation probe. The refusal is thrown inside `mergeChangelog` (lib:242-248), so a unit `assert.throws` covers it without git; M9 (lib:243 `if (countMarks(lines))` -> `if (false)`) is red only in test:467 — the moved assertion must keep that kill.

**6. test:341 bundles stdout routing, the missing-argument refusal and the unreadable-ref refusal.** verified — mutation probe. M24 (lib:378, stdout -> stderr) is red only in test:341; `grep -n 'нужны --ours\|не читается' test/*.mjs` finds the two refusal strings only here (test:352, test:355). Low value on its own.

**Must stay:** :38, :60, :106, :122, :141, :158, :168, :209, :214, :237, :270 (minus :284), :293 (1 MiB CHANGELOG), :361 (signal-killed git), :429 (### heading), :441, :449, :459, :520, :540, :549, :570, :594.

## Work to do

- Replace :179, :191, :200 with one test looping rows `{ ours, theirs, base, section, extra }`: row 1 both bumped with a base carrying «Снятая» (section v0.2.0 on all three, dropped `['Снятая']`, headings); row 2 ours bumped, theirs not, base null (`section.ours` 'v0.2.0 — 2026-02-01', `section.theirs` 'Не выпущено'); row 3 theirs bumped only (mirror, `report.theirs` 2). Assert the section and the shared entries list per row.
- Replace :494, :507, :613 with one unit test over rows {released-section code span, merged-section code span, indented code block in the merged section}, asserting `report.marks === 0` and the theirs entry present, plus `conflicts` empty and `insertionsOver(ours, text) === 2` for rows 1-2.
- Rename :520 so it no longer claims the marker-line -> exit 1 half (that half is :467).
- Delete :331-335 from the `--base` CLI test (:314).
- Delete :284 from the read/`--out` CLI test (:270); keep :282-283 and :285-287.
- Move :482-488 into a unit test `assert.throws(() => mergeChangelog(textWithMarkLine, THEIRS), /секция невыпущенного стороны --ours несёт незакрытую метку/)` (optionally a `--theirs` row); keep :467-480 as the CLI exit-1 test.
- Split :341 into `stdout routing without --out` and one refusal table `[{ argv: ['--ours=HEAD'], err: /нужны --ours <ref> и --theirs <ref>/ }, { argv: ['--ours=HEAD', '--theirs=нет-такой-ветки'], err: /не читается нет-такой-ветки:CHANGELOG\.md/ }]`.

## Out of scope

- Any change under lib/.
- Renaming :158 (it tests that released sections come from ours).

## Verification

- `node --test --test-timeout=60000 test/merge-changelog.test.mjs; echo rc=$?` -> rc 0, tests 29 (31 -2 bump merge, -2 prose merge, +1 unit refusal, +1 split of :341).
- Mutation probes M5 (lib/merge-changelog.js:237), M6 (:231), M7 (:143) -> the bump table red; M2 and M3 (lib/merge-changelog.js:26) -> the prose table red; M4 (lib/merge-changelog.js:416) -> test/merge-changelog.test.mjs:520 red; M9 (lib/merge-changelog.js:243) -> the new unit refusal red; M24 (lib/merge-changelog.js:378) -> the stdout test red; M10 (lib/merge-changelog.js:374) -> test/merge-changelog.test.mjs:214 and :270 red.
- `npm test; echo rc=$?` -> rc 0.
