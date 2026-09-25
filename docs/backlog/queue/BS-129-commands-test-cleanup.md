# BS-129 · commands.test.mjs: drop two subsumed tests, merge twin tests, split the mv omnibus test

- **Order:** 470
- **Scope:** [02. CLI](../../reference/02-cli.md) § mv
- **Created:** 2026-09-25
- **Dependencies:** BS-108, BS-88

## Context

Line numbers are at commit 6f6318e (v0.11.0); if a line moved, find the test by the quoted name. A *mutation probe* means: edit the named lib line in the working tree, run the named test file with `node --test --test-timeout=60000 <file>; echo rc=$?`, read the red test names (lines starting with `✖`), then restore with `git checkout -- lib bin scripts templates`. Base run at 6f6318e: full suite 450 tests, 450 pass. Bug and code cards earlier in the queue changed some of the lib lines named in the mutation probes; apply each probe to the same logic where it lives when you start.

**1. `new: без git номер считается по текущему дереву` (:175-184) is subsumed.** verified — mutation probe, full suite with and without the test. Both it and `new: даты — локальная календарная дата машины, не UTC` (:161) use `makeProject({ git: false })` and run `new`; :161 asserts exit 0 (:164) and reads `docs/backlog/triage/BS-1-east.md` (:166), i.e. number 1 computed without git. Probe M1, lib/tasks.js:260 `if (top.status !== 0) return [];` -> `throw new Error('mut')`: red with the candidate 4 tests, without it 3 (incl. :161), rc 1 both runs. Probe M2, same line -> `return [{ num: 1, sub: null, source: 'mut' }]`: red with the candidate :161 and :175, without it :161 (ENOENT on BS-1-east.md at :166).

**2. `mv --restore: восстановленные задачи сохраняют порядок между собой` (:428-448) adds no kill.** verified — mutation probe. M7 lib/mv.js:239 `if (restoring) planned.sort(` -> `if (false) planned.sort(`: red :405, :428, :450, :476. M8 (comparator reversed) : red :405, :428, :450. M4 lib/mv.js:249 `restoring ? previous : null` -> `null` (the bound the test's comment at :431-432 says it guards): only :450 red, :428 stays green.

**3. The two `--top` on a tight queue tests (:518, :536) are one table, both rows needed.** verified — mutation probe. Both build a,b,c,d (ranks 10,5,2,1) and run `mv N queue --top`, asserting /перенумерована/ and step-10 ranks; :518 moves BS-5 from triage, :536 reorders BS-1 inside queue. M5 lib/mv.js:183 `renumbered: placed.renumbered.map(([file]) => file)` -> `renumbered: []`: only :536 red (rc 1). The setups differ beyond the source status: :536 fills «Область» (:544-545), commits (`gitAll`) and asserts `lint` exit 0 (:551); :518 does none of this, and the triage setup through the CLI gives `lint` rc 1 on [TODO] placeholders, so the shared setup must fill every card's area (including e) and commit before `mv`.

**4. The two «Область» link tests (:962 present, :996 absent) are one table.** verified — read. Same default `makeProject`, same `new … --queue`, same final `assert.doesNotMatch(cli(root, ['lint']).err, /битая ссылка/)` (:976, :1001); the only input that differs is `docs/reference/README.md`. The present row also creates a triage card and checks that the computed link target exists.

**5. RU/EN `new --minor` without `--evidence` (:1066, :1108) are one lang table; :1099-1102 re-assert :70.** verified — read. Same refusal-then-create steps modulo wording (:1074-1079 vs :1116-1119). :1099-1102 repeat the triage `[TODO]` evidence-line check of :70 (lib/new.js:96-98). The RU row checks a fifth phrase (:1080 `Не проверено — это не пропуск улики, а предположение`) that the EN row omits although the EN text has it (lib/new.js:29: `Unverified does not excuse missing evidence — it makes it an assumption`).

**6. `mv 1 2 queue --top` refusal repeated in the batch test (:766-769).** verified — mutation probe. :767 and :385 run the identical command and match two substrings of the one message thrown at lib/mv.js:218; `if ((values.top || values.after !== undefined) && rawIds.length > 1) throw` -> `if (false) throw` reds both tests (rc 1). The step changes no state.

**7. The omnibus `mv: очередь → работа ставит «Взята» и снимает порядок; deferred получает раздел; --after ставит между` (:186-235) chains four behaviours on one mutable fixture.** verified — read + timing. (a) queue->active fields :194-199; (b) in-queue reorder and refusals :201-217; (c) deferred section and repeat refusal :219-227; (d) unknown status/number refusals :228-232. Later blocks depend on earlier state (BS-1 already in active), so a red in (a) hides (b)-(d). Runtime 1.4-1.5 s on base, 3.2 s in a loaded full-suite run.

**Regression guards in this file that must stay:** :89 (numbers taken by a foreign worktree/branch), :161, :371 (the canonical check of lib/mv.js:218), :405, :450 (only guard of the batch-neighbour bound lib/mv.js:249), :476, :650 (directory named like a task file), :720, :858, :908, :943, :1322 (ls-remote output over 1 MiB).

## Work to do

- Delete the test `new: без git номер считается по текущему дереву` (:175-184).
- Delete the test `mv --restore: восстановленные задачи сохраняют порядок между собой` (:428-448).
- Replace :518 and :536 with one test looping two rows, each on a fresh project: `{ from: 'triage', target: '5', expect: { '5-e': 10, '4-d': 20, '3-c': 30, '2-b': 40, '1-a': 50 } }` and `{ from: 'queue', target: '1', expect: { '1-a': 10, '4-d': 20, '3-c': 30, '2-b': 40 } }`. Shared setup: create a,b,c,d as today (plus e in triage for row 1), fill «Область» of every card, `gitAll`, then `mv <target> queue --top`; per row assert /перенумерована/, the expected ranks and `lint` exit 0. Name the row in every assert message.
- Replace :962 and :996 with one test over `[{ reference: true, statuses: ['triage', 'queue'], expect: computed relative link that exists }, { reference: false, statuses: ['queue'], expect: '[TODO: раздел reference/]' }]`, keeping the shared `lint` assertion `/битая ссылка/` absent.
- Replace :1066 and :1108 with one test over `[{ lang: 'ru', refusal: [5 RU regexes of :1074-1080], card: <regex of :1095> }, { lang: 'en', refusal: [4 EN regexes of :1116-1119 plus /Unverified does not excuse missing evidence/], card: <regex of :1125> }]`; keep the empty/whitespace/hypothesis loop (:1084-1089) and `lint` exit 0 (:1097) once per row; drop :1099-1102.
- Delete :766-769 from `mv: пакет номеров одним вызовом; отказ по любому — всё или ничего`.
- Split :186 into four tests, each with its own minimal fixture (3x `new` + `gitAll` as today): (a) queue->active sets «Взята» and drops «Порядок» (:194-199); (b) in-queue reorder: `--top`, bare `mv 3 queue` refusal, `--after` self refusal, `--after` from triage (:201-217); (c) deferred adds the section and a repeat is refused (:219-227); (d) unknown status `done` and unknown number are refused (:228-232).

## Out of scope

- The `команды вне проекта отказывают с подсказкой про init` test (:612): its split is done in the BS-142 (`cli-help-review-ownership-tests`) card, which depends on this one.
- Moving the ENOBUFS test at :1322 into test/upgrade.test.mjs.
- Any change under lib/; renaming tests to English.

## Verification

- `node --test --test-timeout=60000 test/commands.test.mjs; echo rc=$?` -> rc 0, tests 47 (base 49: two deleted, three merges of two into one, one test split into four).
- Mutation probe lib/mv.js:183 `renumbered: []` -> the merged `--top` test is red on the queue row.
- Mutation probe lib/mv.js:239 `if (false) planned.sort(` -> :405 and :450 red; lib/mv.js:249 `null` -> :450 red.
- Mutation probe lib/tasks.js:260 `throw new Error('mut')` -> `new: даты — локальная календарная дата машины, не UTC` red.
- Mutation probe lib/mv.js:218 `if (false) throw` -> the :371 refusal test red.
- `npm test; echo rc=$?` -> rc 0; `node bin/backslop.js lint; echo rc=$?` -> rc 0.
