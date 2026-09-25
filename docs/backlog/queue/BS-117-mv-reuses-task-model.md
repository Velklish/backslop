# BS-117 · mv reuses task-model helpers: TODO placeholder rule, section scanner, evidence hint

- **Order:** 350
- **Scope:** [02. CLI](../../reference/02-cli.md) § mv
- **Created:** 2026-09-25
- **Dependencies:** BS-99

## Context

`mv` carries its own copies of three task-model rules. It imports the placeholder helpers from the `lint` command module. One of its copies uses a looser rule than the shared one and erases text that lint considers filled.

Repro commands below run in an empty scratch directory with `B() { node "$BACKSLOP/bin/backslop.js" "$@"; }`, where `$BACKSLOP` is this repository's checkout; projects are created with `git init -q -b main && B init --tools none --lang en`.

**1. The `[TODO]` placeholder rule** — verified — repro rerun at base 6f6318e.
- lib/mv.js:158 runs `if (target === 'minor' && /^\[TODO/.test((getField(text, FIELD_AREA) ?? '').trim())) text = setField(text, FIELD_AREA, '', cfg.lang);`. It blanks any Scope value that merely starts with `[TODO`.
- mv.js already imports `isTodoPlaceholder` from lint.js (lib/mv.js:6). That function, defined at lib/lint.js:21-24 and :381-390, requires the whole value to be the placeholder: `TODO_VALUE = /^\[TODO(?:[^\]\n]*)\](?:\s*\([^\)\n]*\))?$/`. Gate 4 uses it.
- `hasResultTodo` (lib/tasks.js:368-370) is a different, documented rule for result.md (`[TODO` anywhere outside code) and stays as it is.
- Every placeholder that `new` writes (lib/new.js:34-37) matches `TODO_VALUE`, so switching to `isTodoPlaceholder` keeps the intended blanking.
- Repro:
  - `B new area-probe`, then set the line to `- **Scope:** [TODO] owner decides; notes kept here`.
  - `B mv 1 queue`, then `B lint` → no Scope error.
  - `B mv 1 minor --evidence "lib/mv.js:158"` → rc=0.
  - `grep -n Scope docs/backlog/minor/*.md` → `3:- **Scope:**`. The owner's text has been erased.

**2. The section scanner is copied** — verified — on a CRLF text with an unclosed fence, both scanners gave the same ranges (11 = 11 lines).
- `mv.minorForm` (lib/mv.js:25-39) builds section ranges with `splitLines(blankFences(...))` and `line.match(/^ {0,3}## (.*)$/)`, closing each section at the next heading.
- That copies `headingText` (lib/tasks.js:380-383) and `sectionRanges` (lib/tasks.js:459-475).
- mv also needs every heading plus the fence-blanked lines, because it runs stub detection (`isTodoPlaceholder` on each clean line). A shared scanner must therefore return the clean lines too.

**3. The evidence-refusal closing line is duplicated** — verified — read the code and the tests at base.
- lib/new.js:21/29 and lib/mv.js:77/82 share the same closing line pair. The English line is `Unverified does not excuse missing evidence — it makes it an assumption: --evidence "presumably …".`
- The evidence kinds are presented differently on purpose: `new --minor` shows a three-line table with examples, and `mv … minor` gives an inline reminder. Tests pin both forms: test/commands.test.mjs:1076-1078 for `new` and :1175 for `mv`.

**Which behaviour wins.** `isTodoPlaceholder` (the gate 4 rule) wins at lib/mv.js:158. Behaviour change: `mv … minor` keeps a Scope value that lint considers filled.

## Work to do

- Move `TODO_VALUE`, `TODO_FIELD`, `isTodoPlaceholder` and `hasTodoPlaceholder` (lib/lint.js:21-24 and :381-390) to lib/tasks.js next to `hasResultTodo`. lint.js and mv.js import them from tasks.js.
- lib/mv.js:158: replace the regex with `isTodoPlaceholder(getField(text, FIELD_AREA) ?? '')`.
- lib/tasks.js: export `sections(text) -> { clean, list: [{ name, start, end }] }`. Build `sectionRanges` as a filter over it, and rewrite `mv.minorForm` on it, keeping only its stub/filled bookkeeping over `clean`.
- lib/tasks.js: export the closing evidence line pair (for example `evidenceAssumption(lang)`) and use it as the last element of the arrays at lib/new.js:15-30 and lib/mv.js:74-83. Keep the rest of both messages as they are.
- Add a CHANGELOG entry: `mv … minor` no longer erases a Scope value that only starts with `[TODO`.

## Out of scope

- `hasResultTodo` and the result.md placeholder rule.
- Extending `isTodoPlaceholder` to list items, checkboxes and table cells (BS-99 (`unverified-lint-gate-gaps`); move whatever it settled).
- The wording of the evidence kinds in `new` and `mv`.

## Verification

- New test in test/commands.test.mjs (the repro): after `mv 1 minor`, Scope still reads `[TODO] owner decides; notes kept here`. A Scope of `[TODO: section](../../reference/README.md)` is still blanked.
- `grep -n "from './lint.js'" lib/mv.js` → no hit.
- `node --test --test-timeout=60000 test/commands.test.mjs; echo rc=$?` → rc=0; the assertions at test/commands.test.mjs:1076-1078 and :1175 are not edited and pass.
- `npm test`: every test passes. `node bin/backslop.js lint` → rc=0.
