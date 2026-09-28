# ADR-052: A project overrides a numbered step of the AGENTS.md block from backslop.json

**Status:** Accepted
**Date:** 2026-09-29
**Deciders:** Velklish

## Context

`init` owns the managed block between `backslop:start` and `backslop:end` in `AGENTS.md` and restores it from the template on every run, so a hand edit of one numbered step disappears on the next `init`, even when the project needs a different procedure for that step. An extension point below the block would keep the project's text, but the agent would then read the template step and a contradicting note beside it — two sources for one rule. The override value lands inside markdown the agent reads, so it must stay text: a list of forbidden patterns kept finding bypasses, while escaping the whole CommonMark punctuation class is complete by construction.

## Options

- **An extension point after the block** — the step and the project's note beside it contradict each other, and the agent must reconcile them.
- **Parsing the assembled block with a CommonMark parser and refusing block constructs** — inline markup in the value would survive, but the tool would gain its first runtime dependency for one check.
- **One more forbidden pattern in the shape check** — each such rule found another bypass, and some rejected valid markdown; completeness of a list of prohibitions cannot be derived from the specification.

## Decision

- **The field.** `agents.stepOverrides` in `backslop.json` is an object whose keys are the step numbers `"1"` to `"7"` and whose values are non-empty after trimming, single-line — no CR, LF, U+2028 or U+2029 — and without `<` (`validateAgentsConfig` in `lib/config.js`). The config is checked before anything is written, and a repeated `init` reads the same overrides again.
- **What `init` replaces** (`applyStepOverrides` in `lib/init.js`). After rendering the template block, `init` replaces the whole text of each overridden step with `N. <value>`, keeping its number, the other steps and the blank line before the worker-boundary line. A step not named keeps the template text.
- **The value is escaped.** The trimmed value has every one of the 32 CommonMark ASCII punctuation characters, `!` to `~`, backslash-escaped (`MD_PUNCT`, `escapeInline` in `lib/init.js`). CommonMark makes any escaped ASCII punctuation a literal, and no markdown construct, block or inline, opens with anything but a character from this class; the exceptions where a backslash is not honoured — code spans, autolinks and raw HTML — are themselves opened by `` ` `` and `<`, which are escaped too. The step content starts a block inside the list item, so block constructs could open there; the two ways to open a block without punctuation are ruled out by the value's shape — trimming leaves no leading indent, and line breaks are refused. The `<` refusal stays as well: it closes its class before assembly.
- **Step 4 and the probe.** An override of step 4 replaces the whole step, the probe sentence included, and `init` prints no note about it ([the probe ADR](adr-041-probe-command.md)).

## Consequences

- A project changes one outdated step without forking the template or editing the generated block, and template updates of the other steps still reach it.
- Markup in an override shows as text: a code span, emphasis or link is read literally, and the source carries backslashes. Brackets without a link definition remain a legal value — escaping neutralises, it does not refuse.
- A pin inside an override is escaped, so lint pin checks do not see it and `upgrade` does not rewrite it; the pins a project runs belong in `cli`, `gates` and `probe`, which `upgrade` rewrites.
- The override is neither translated nor checked against the process; its wording is the project's decision.
- The step range 1–7 is hard-coded in `lib/config.js` and `lib/init.js` (`STEP_RE`), and nothing ties it to the step count of `templates/agents-section.md`: renaming, adding or removing a step means revisiting both and this decision.
- If the template ever puts the value at the start of a block instead of after the step number, the escaping argument must be revisited.
