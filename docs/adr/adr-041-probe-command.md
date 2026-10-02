# ADR-041: The mutation-probe command is a project field substituted into the block, the task skill and the brief

**Status:** Accepted
**Date:** 2026-09-28
**Deciders:** Velklish

## Context

The AGENTS.md block, the `backslop-task` skill and the worker brief require a mutation probe after a test change. backslop has no probe command of its own: every repository probes differently, and an invented default is worse than none. A requirement that names only the duty sends agents to build ad-hoc probes, so the rule has to carry the project's command. The duty itself — break the code by hand and see the test fail — needs no command; only the automated probe does. That value lands in generated markdown inside a managed block whose bounds are markers in the text, so the value's form is part of the contract.

## Options

- **A template sentence pointing to a project section** ("the probe is described in the project's section") — no field, but the rule stays unexecutable where nobody wrote the section, and the block promises the reader something the file does not have.
- **A condition inside `agents-section.md`** — the template grammar grows a conditional block, and the parity and slot gates, which read only `{{name}}`, would not see its markers.
- **The sentence as a string in code** — process text leaves `templates/`, the one source of process wording.
- **The bare value `{{probe}}` in each place** — each place writes its own wrapper around the command, and three wordings of one rule drift apart on the first edit.
- **The brief's note on stdout** — the note would reach the worker as part of the brief, addressed to someone else.

## Decision

- **The field.** `probe` in `backslop.json` is optional: a non-empty command string with no default. A non-string or whitespace-only value is refused (`validateProbe` in `lib/config.js`). It is set by editing the config; there is no CLI flag, and `saveConfig` writes it right after `gates`.
- **Block values are one class.** The values templates substitute inside the managed block — `prefix`, `docs`, `cli` and `probe` — share one form: no line break (`\r`, `\n`, U+2028, U+2029), no backtick, no `backslop:start` or `backslop:end` substring. `docs`, `cli` and `probe` pass one check, `validateBlockValue` in `lib/config.js`, called from `validateConfig` for a loaded config and for the config a first `init` is about to write, and for `--dir` and `--cli` before a config exists (`run` in `lib/init.js`). `prefix` is held by `PREFIX_RE`, which admits none of these. A line break would put a second paragraph into the block, a backtick would close the code span the template puts the value in. The markers are the block's own bound tokens: `readManaged` in `lib/init.js` recognises one only when it stands alone on its line, and every value sits mid-line in a code span, so the ban keeps the block safe if a template ever puts a value alone on a line. `<` is allowed: the value sits in a code span, and `{{probe}}` is the only code span of `agents-probe.md`, which a test in `test/templates.test.mjs` pins.
- **One text source per sentence, one slot per place.** The rule sentence lives in `templates/agents-probe.md` and its English twin. `probeSlots` in `lib/templates.js` renders every probe text into a slot key: each slot except `probeManual` is the empty string when `probe` is absent, and otherwise a separator that joins the passage to the text before it, plus the passage. `init`, `brief` and `archive` spread the result into their template keys, and `TEMPLATE_KEYS` declares each key for the templates that take it. The passages other than the sentence live in `templates/probe/`, in both layers; `probe/` and `agents-probe.md` are never copied into a project.
  - `probeRule` — the sentence with the command, a leading space: step 4 of the AGENTS.md block (`agents-section.md`) and step 4 of the `backslop-task` skill.
  - `probeBreakage` (`probe/breakage.md`) — the explanation of a deliberate breakage, after `probeRule` in step 4 of the skill.
  - `probeManual` (`probe/manual.md`) — the command-free sentence, a leading space, rendered only when `probe` is absent: commit first, break the code by hand, confirm that the new test fails. It stands in place of `probeBreakage` in step 4 of the skill and names no command.
  - `probeSecond` (`probe/second.md`) — the second-probe paragraph at the end of step 4 of the skill.
  - `probeVerified` (`probe/verified.md`) — the fragment ", mutation probe" in the contents of `result.md` in the acceptance step of the skill and in the verification line of the `result.md` stub written by `archive`.
  - `probeBullet` (`probe/bullet.md`) — the probe bullet of the brief, under "How to work"; it takes `probeRule` for the rule and the command and keeps only the reason of its own, so the brief says "commit first" once.
  - `probeResult` (`probe/result.md`) — the probe item in the result contents of the brief.
- **Without `probe`.** The block, the brief and the `result.md` stub carry no probe sentence or passage. Step 4 of the `backslop-task` skill carries the command-free sentence (`probeManual`) and no other probe text, so the skill still asks for a check by hand where the project has no command to name. `init` says so in a note on stdout: the block carries no requirement and the skill carries the command-free one (`run` in `lib/init.js`); `brief` says so on stderr, so stdout stays a clean brief (`run` in `lib/brief.js`).
- **Step 4 overrides.** An `agents.stepOverrides` entry for step 4 replaces the whole step of the block, the probe sentence included (`applyStepOverrides` runs after `probeRule` was rendered into the step). The block then no longer names the probe command, while the `backslop-task` skill and the brief still do, and `init` prints no note about it — the missing-probe note fires only when `probe` is absent. A project that wants the block to name the command puts it into the override text.

## Consequences

- A repository that declares `probe` gets the command everywhere an agent reads the rule, except the block when `agents.stepOverrides` replaces step 4, and no note is printed then. One sentence template keeps the block and the skill equal, and the brief takes the same sentence through its bullet.
- Without `probe` no unexecutable rule is written: the block, the brief and the stub carry none, the skill asks for the check by hand, which needs no command, and `init` and `brief` say so. A project may describe its probe in a section of its own outside the block; such a section survives `init`.
- Changing the code-span shape of `agents-probe.md` means revisiting the allowed characters.
- Adding or removing a slot or a place that renders probe text, or changing the `probe` field, is a contract change.
- `brief > file` keeps the note out of the file.
