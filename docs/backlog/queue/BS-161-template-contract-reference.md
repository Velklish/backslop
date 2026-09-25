# BS-161 · Document template keys and machine-read strings; test task/minor labels; en is the source

- **Order:** 790
- **Scope:** [01. Layout](../../reference/01-layout.md) § Templates
- **Created:** 2026-09-25
- **Dependencies:** BS-158, BS-124

## Context

Evidence was taken at commit 6f6318e (v0.11.0), where `npm test` (`node --test --test-timeout=60000`) runs 450 tests, all pass, rc=0, and `node bin/backslop.js lint` exits 0. `$B` below means `node <repo>/bin/backslop.js` run inside a throwaway project (`mkdir p && cd p && git init -q && $B init --lang en ...`).

**Renaming a task heading silently drops content from `brief`.** verified — a mutation in a clone (the field and section names themselves are documented).
- The mutation: `sed -i '' 's/^## Work to do$/## Steps/' templates/en/task.md; sed -i '' 's/^## Что сделать$/## Шаги/' templates/task.md; node --test --test-timeout=60000; echo rc=$?`. It gives rc=1 with "tests 450, pass 449, fail 1". The only red test is test/commands.test.mjs:1180, which checks the ru `mv N.k minor` message.
- With the mutated clone: `init --lang en --prefix ZZ --tools none`, `new a --queue`, fill the list, `brief 1`. The brief exits 0, and the task block shows only "**Out of scope**". The work list vanished without a warning.
- Why: lib/brief.js:87 reads sections by the names in lib/tasks.js:27-44 (`FIELD_NAMES`: Scope/Область, Created/Создана, Dependencies/Зависимости, Parent/Родитель, Cost/Цена, …; `SECTION_NAMES`: Work to do/Что сделать, Out of scope/Не входит, Verification/Проверки, Context/Контекст, Evidence/Улика, Deferred/Отложено).
- Those names are already documented, with their ru/en pairs, in docs/reference/01-layout.md:57-81 (task file) and :88 (minor fields). No doc says that templates/task.md and minor.md must use exactly those names.
- docs/reference/01-layout.md:140 lists only `task.md`, `result.md`, `adr.md` as command stubs. It omits `minor.md`, `brief.md` and `agents-probe.md`.
- The same line claims "an unknown substitution stays in the text as is". That is false: `renderTemplate` (lib/templates.js:27-33) throws for a placeholder without a key.

**Strings that code reads from templates.**
- task.md and minor.md field labels and section headings (tasks.js:27-44).
- The outcome words in the first paragraph of result.md (lib/log.js:71-79, `OUTCOME_FORMS`, read by lint and fold).
- The step lines `1.`–`7.` of agents-section.md and its `Worker boundaries:` line (lib/init.js:20, :24).
- The key sets per template in `TEMPLATE_KEYS` (lib/templates.js:15-23).

**`templateParity` treats ru as the source.** verified — at 6f6318e, evidence below.
- lib/templates.js:79-80 reports "templates/en/${rel} is missing" and "templates/en/${rel} has no source counterpart".
- It requires equal placeholders and heading shapes (:86-100).
- It runs in the tool's own lint (lib/lint.js:123) and in test/templates.test.mjs:12.
- The owner decided that en is the source.

**Other couplings a template edit must respect.** verified — read at 6f6318e: a heading mutation turned exactly commands.test.mjs:1180 red.
- Tests pin literal ru template strings: brief.test.mjs:45-56, :145-152, :226-233; init.test.mjs:205-232, :342-356, :388-398; commands.test.mjs:1033, :1125, :1180; templates.test.mjs:141-167.
- `agents.stepOverrides` keys are "1" to "7".
- (At 6f6318e lib/adapter-ownership.js:6-14 `LEGACY_SOURCES` hardcoded the skill file paths; the BS-107 (`marker-only-adapter-ownership`) card removed it.)

## Work to do

- lib/templates.js `templateParity`: make en the source. Missing-file messages name the missing ru twin of an en file (e.g. "templates/<rel>: ru twin of templates/en/<rel> is missing") and an ru file without an en source. Diff messages print the en value as the reference. Keep the messages going through `tr(lang, …)` (the BS-124 (`messages-through-tr`) card gave `templateParity` a lang argument). Update the comment above the function and every test that matches the old messages (`grep -rn "has no source counterpart\|is missing" test/`).
- docs/reference/01-layout.md § Templates (write the new text in English): add a table with one row per template: the template, the command and lib file that render it, its keys (from `TEMPLATE_KEYS`), and the strings that code reads from it. Rows: agents-section.md (init; step lines 1–7 and the "Worker boundaries:" line), agents-probe.md (init, brief), task.md (new), minor.md (new --minor, mv … minor), result.md (archive; outcome words read by lint and fold), adr.md (adr), brief.md (brief), docs/** (init; backlog/README.md and archive/README.md redrawn by migrate), skills/** (adapters). State that the headings and field labels of task.md and minor.md must equal the names in the task-file and minor-file sections of the same document, and that en is the source layer.
- Check that the BS-158 (`layout-reference-english`) card replaced the false sentence "an unknown substitution stays in the text as is" with the real behaviour (a placeholder without a key is a render error); fix it if not.
- Add a test in test/templates.test.mjs: render task.md and minor.md in both languages and assert that every `## ` heading and every `- **Label:**` field is a known section or field name for that language. Assert it through the public parser that reads task files, not through new test-only exports.

## Out of scope

- Renaming any heading, label or outcome word.
- The lib module map and the orchestrator-contract reference (the BS-176 (`orchestrator-contract-reference`) and BS-177 (`lib-module-map-reference`) cards at the end of the queue).
- `LEGACY_SOURCES` (removed by the BS-107 (`marker-only-adapter-ownership`) card).

## Verification

- Mutation probe for the new test: in a scratch copy, change only `## Work to do` in templates/en/task.md to `## Steps`. The new test turns red, and `node bin/backslop.js lint` reports the heading mismatch with en as the reference. Revert.
- Move templates/task.md away temporarily: `node bin/backslop.js lint` names it as the missing ru twin of templates/en/task.md. Restore it.
- `npm test` exits 0 with no failing test (450 at the base commit, plus the tests this card adds); `node bin/backslop.js lint` exits 0 (templateParity and the key check stay clean).
