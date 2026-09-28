# ADR-041: The mutation-probe command is a project field substituted into the block, the task skill and the brief

**Status:** Accepted
**Date:** 2026-09-28
**Deciders:** Velklish

## Context

The AGENTS.md block, the `backslop-task` skill and the worker brief require a mutation probe after a test change. backslop has no probe command of its own: every repository probes differently, and an invented default is worse than none. A requirement that names only the duty sends agents to build ad-hoc probes, so the rule has to carry the project's command. That value lands in generated markdown inside a managed block whose bounds are markers in the text, so the value's form is part of the contract.

## Options

- **A template sentence pointing to a project section** ("the probe is described in the project's section") — no field, but the rule stays unexecutable where nobody wrote the section, and the block promises the reader something the file does not have.
- **A condition inside `agents-section.md`** — the template grammar grows a conditional block, and the parity and slot gates, which read only `{{name}}`, would not see its markers.
- **The sentence as a string in code** — process text leaves `templates/`, the one source of process wording.
- **The bare value `{{probe}}` in each place** — each place writes its own wrapper around the command, and three wordings of one rule drift apart on the first edit.
- **The brief's note on stdout** — the note would reach the worker as part of the brief, addressed to someone else.

## Decision

- **The field.** `probe` in `backslop.json` is optional: a non-empty command string with no default. A non-string or whitespace-only value is refused (`validateProbe` in `lib/config.js`). It is set by editing the config; there is no CLI flag, and `saveConfig` writes it right after `gates`.
- **Block values are one class.** The values templates substitute inside the managed block — `prefix`, `docs`, `cli` and `probe` — share one form: no line break (`\r`, `\n`, U+2028, U+2029), no backtick, no `backslop:start` or `backslop:end` substring. `docs`, `cli` and `probe` pass one check, `validateBlockValue` in `lib/config.js`, called from `validateConfig` for a loaded config and for the config a first `init` is about to write, and for `--dir` and `--cli` before a config exists (`run` in `lib/init.js`). `prefix` is held by `PREFIX_RE`, which admits none of these. A line break would put a second paragraph into the block, a backtick would close the code span the template puts the value in. The markers are the block's own bound tokens: `readManaged` in `lib/init.js` recognises one only when it stands alone on its line, and every value sits mid-line in a code span, so the ban keeps the block safe if a template ever puts a value alone on a line. `<` is allowed: the value sits in a code span, and `{{probe}}` is the only code span of `agents-probe.md`, which a test in `test/templates.test.mjs` pins.
- **One sentence, three places.** The sentence lives in `templates/agents-probe.md` and its English twin. `probeRule` in `lib/templates.js` renders it with the trimmed value into a leading space plus the sentence, or into the empty string when `probe` is absent. `{{probeRule}}` is substituted in exactly three places, in both template layers: step 4 of the AGENTS.md block (`agents-section.md`), step 4 of the `backslop-task` skill, and the probe item of the brief (`brief.md`); `TEMPLATE_KEYS` in `lib/templates.js` declares the key for each. `agents-probe.md` is never copied into a project.
- **Without `probe`.** No probe sentence is written anywhere. `init` says so in a note on stdout (`run` in `lib/init.js`); `brief` says so on stderr, so stdout stays a clean brief (`run` in `lib/brief.js`).
- **Step 4 overrides.** An `agents.stepOverrides` entry for step 4 replaces the whole step of the block, the probe sentence included (`applyStepOverrides` runs after `probeRule` was rendered into the step). The block then no longer names the probe command, while the `backslop-task` skill and the brief still do, and `init` prints no note about it — the missing-probe note fires only when `probe` is absent. A project that wants the block to name the command puts it into the override text.

## Consequences

- A repository that declares `probe` gets the command everywhere an agent reads the rule, except the block when `agents.stepOverrides` replaces step 4, and no note is printed then. One template keeps the three places equal.
- Without `probe` no unexecutable rule is written, and `init` and `brief` say so. A project may describe its probe in a section of its own outside the block; such a section survives `init`.
- Changing the code-span shape of `agents-probe.md` means revisiting the allowed characters.
- Adding or removing a substitution place, or changing the `probe` field, is a contract change.
- `brief > file` keeps the note out of the file.
