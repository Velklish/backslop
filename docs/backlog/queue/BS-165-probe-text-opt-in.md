# BS-165 · Probe text only when probe is declared; brief says it once; result stub names the CLI

- **Order:** 830
- **Scope:** [02. CLI](../../reference/02-cli.md) § brief
- **Created:** 2026-09-25
- **Dependencies:** BS-145, BS-118, BS-163, BS-164

## Context

Evidence was taken at commit 6f6318e (v0.11.0), where `npm test` (`node --test --test-timeout=60000`) runs 450 tests, all pass, rc=0, and `node bin/backslop.js lint` exits 0. `$B` below means `node <repo>/bin/backslop.js` run inside a throwaway project (`mkdir p && cd p && git init -q && $B init --lang en ...`).

Template pairs: `templates/en/<path>` is the source and `templates/<path>` is its ru twin. Edit en first, then carry the same change into ru. `templateParity` (run by `lint`) requires the same file set, the same placeholders and the same heading shape in both layers. Tests pin literal strings of the ru layer: grep `test/` for every ru sentence you change and update the assertion in the same commit.

The consolidated probe-command ADR (BS-145 (`probe-command-adr`)) sets the rule. The `{{probeRule}}` slot, rendered from `templates/agents-probe.md`, is the only source of the probe sentence, in three places: block step 4, backslop-task step 4, and the brief's probe bullet. Without a `probe` field in backslop.json, "the slot is empty in all three places, and there is no probe sentence in the block, the skill or the brief". The text around the slot breaks that rule.

**The unconditional probe text.** verified — a render.
- `git init -q; $B init --lang en --prefix XX --tools claude > init.out` prints "probe is not declared in backslop.json: neither the block nor the skill carries a mutation-probe requirement …" (lib/init.js:124-127).
- `grep -n -o "A mutation probe is deliberate breakage[^.]*\.\|mutation probe and live run" .claude/skills/backslop-task/SKILL.md` matches line 27 and line 52, while `grep -c -i probe AGENTS.md` gives 0.
- Probe text that renders regardless of `probe`:
  - backslop-task SKILL.md:26, the paragraph after `{{probeRule}}` that starts "A mutation probe is deliberate breakage" ("**The commit comes first:** …", "If the probe remains green …").
  - SKILL.md:28, the "second probe" paragraph.
  - SKILL.md:51, "mutation probe and live run" in the contents of result.md.
  - brief.md:36, "**The mutation probe comes after the commit** …".
  - brief.md:40, "the mutation probe — what you broke and what turned red".
  - result.md:5, "mutation probe".
- In the same project, `$B new a --queue; $B brief 1 --track T1` prints the probe bullet on stdout and "⚠ probe is not declared in backslop.json: the brief names no mutation-probe command" on stderr.

**With `probe` declared, the brief says "commit first" twice.** verified — a render with `"probe": "npx stryker run"`. Rendered brief line 46: "- **The mutation probe comes after the commit**: uncommitted means no probe — reverting the mutation would take your fix with it. Verify a test change with a mutation probe: commit first, then run the probe — `npx stryker run`. …". lib/brief.js:152 renders agents-probe.md into the slot right after the lead sentence.

**result.md names a command that may not exist.** verified — at 6f6318e, evidence below. result.md:5 (en and ru) hard-codes "gates with numbers from the `backslop gates` summary line". The result.md key set in TEMPLATE_KEYS (lib/templates.js:19) is `['date', 'id', 'prefix']`, with no `cli`. lib/archive.js:44 renders the stub with `{ id, date, prefix }`. In an npx-pinned project (`"cli": "npx github:Velklish/backslop#v0.11.0"`), `$B archive 2` writes a result.md that names `backslop gates`, which does not exist without a global install, while the same run prints "… npx github:Velklish/backslop#v0.11.0 fold XX-2 …".

Tests that pin the current strings:
- test/init.test.mjs:342-356: without `probe` the rendered skill lacks "потом проба —"; with `probe` it contains "сначала коммит, потом проба — `npm run probe`."
- test/brief.test.mjs:50-53: the seven fixed bullets include "Мутационная проба — после коммита".
- test/brief.test.mjs:226-233: the probe command in the brief.

## Work to do

- Make every probe sentence conditional on `probe`, in both languages. brief.md:36 (the whole bullet) and the probe item of :40, backslop-task SKILL.md:26 (from "A mutation probe is deliberate breakage" to "fix the input, not the gate"), SKILL.md:28 and the "mutation probe" in acceptance step 2 (:51), and result.md:5 must all render nothing about the probe when the field is absent. Choose the mechanism, e.g. a slot that renders a whole passage or bullet, or the empty string. Keep one text source per sentence, and declare every new key in `TEMPLATE_KEYS` (lint's key gate checks the pairs).
- Owner decision: the probe-slot mechanism is recorded by updating the consolidated probe-command ADR written by BS-145 (`probe-command-adr`) in place, not in a new ADR: its Decision names every slot key and place that renders probe text.
- With `probe` declared, the brief states "commit first" once. Either the bullet keeps only the reason ("reverting the mutation would take your fix with it") and the slot adds the rule with the command, or the brief renders only the command.
- result.md: add `cli` to the result.md key set (lib/templates.js:19), pass `cli: cfg.cli` from lib/archive.js:44, and write `{{cli}} gates` in both result.md templates.
- Leave the `init` and `brief` notes unchanged: after this card, the init note ("neither the block nor the skill carries …") is true.
- Tests: extend test/init.test.mjs:342-356. Without `probe`, the rendered AGENTS.md block, backslop-task skill, `brief` stdout and an `archive` result.md contain neither "probe" nor "проба". With `probe`, the brief contains the commit-first rule exactly once (count the matches). Update brief.test.mjs:50-53 (the probe bullet is no longer fixed) and :226-233. Add a test: `archive` in a project with `"cli": "npx backslop@1.2.3"` writes a result.md that contains `` `npx backslop@1.2.3 gates` ``.
- CHANGELOG, Unreleased section: without `probe`, the skill, the brief and the result stub no longer ask for a mutation probe; with it, the brief states the rule once; the result stub names the project's CLI.
- The acceptance redraws this repository's own AGENTS.md block with `node bin/backslop.js init` and commits it with the task, so later workers follow the new rules.

## Out of scope

- The meaning, form or validation of the `probe` field, and new places for the slot.
- Other backslop-task step-4 content: `gates --base`, `--keep-going`, and the restructure against the AGENTS block (the BS-169 (`backslop-task-skill-fixes`) card).
- The wording of the `init` and `brief` notes.

## Verification

- Project without `probe`: `$B init --lang en --tools claude; grep -ci probe AGENTS.md .claude/skills/backslop-task/SKILL.md` prints 0 for both files. `$B new a --queue; $B brief 1 --track x 2>/dev/null | grep -ci probe` prints 0. `$B archive 1; grep -ci probe docs/archive/*/result.md` prints 0.
- Same project with `"probe": "npm run probe"`: `$B brief 1 --track x | grep -o "commit first" | wc -l` prints 1, and the rendered skill's step 4 names `npm run probe`.
- Project whose cli is the default npx pin: after `$B archive 1`, result.md contains `<that cli> gates`.
- No new file under docs/adr; the probe-command ADR names every new slot key.
- After the acceptance commit: `node bin/backslop.js init && git diff --exit-code AGENTS.md; echo rc=$?` → rc=0 (this repository's block equals the rendered template).
- `npm test` exits 0 with no failing test (450 at the base commit, plus the tests this card adds); `node bin/backslop.js lint` exits 0 (templateParity and the key check stay clean).
