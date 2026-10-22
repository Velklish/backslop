# BS-225 · Establish the stop-hook attribution boundary before changing it

- **Order:** 40
- **Scope:** [02. CLI — hook](../../reference/02-cli.md#hook)
- **Created:** 2026-10-04
- **Dependencies:** BS-235
- **Cost:** —

## Context

The desired behavior is to distinguish errors introduced by the current session from pre-existing errors or other sessions' work. The current documented behavior is coarser: it reports lint errors in files changed since the recorded session start, plus relevant untracked files (`docs/reference/02-cli.md:368-369`, ADR-055 at `docs/adr/adr-055-docs-rules-ship-to-projects.md:40`). A file-level match does not establish who introduced each error. This is a contract/design task, not a reproduced violation of that existing filter contract.

The original report described a historical return caused by older errors in a changed README in a shared working tree. Its consumer-specific narrative is retained at `409099a689d496925d4be018394c7353c60fb3f3` in the former triage card; it is not a self-contained current reproduction. No new runtime reproduction was performed during triage at `409099a689d496925d4be018394c7353c60fb3f3`. Establish generic evidence before prescribing a fix. BS-235 remains the repository-wide current-content boundary task.

## Work to do

1. In disposable generic repositories, independently reproduce: an old broken link followed by a harmless edit in the same file; a foreign commit after session start; this session's own commit after start; a line insertion before an old error; and a new error in a file that was already failing lint. Record complete lint/hook diagnostics, commands, direct exits and session records for each case.
2. Compare each result with the current documented file filter. Classify a contract violation separately from a request for stronger provenance. Include staged and untracked changes and preserve the intentional coverage of own commits after start (`test/hook.test.mjs:283-289`).
3. Decide and document a feasible attribution boundary in an ADR before changing hook behavior. The start record (`lib/hook.js:121-128`) does not supply reliable authorship for individual edits. Subtracting raw diagnostics is not sufficient evidence: line shifts and identical messages can change the result. A HEAD-to-working-tree comparison also drops the session's own committed work. Evaluate these cases rather than selecting either shortcut in advance.
4. If a stronger contract is accepted, turn that decision into bounded implementation work and meaningful red-before/green-after tests. If it is declined, obtain the owner's rejection decision; do not silently close the request as invalid merely because the current contract is coarser.

## Out of scope

No attribution implementation in triage. Do not claim a Git diff proves session authorship, suppress every error in a previously red file, or remove lint protection for the session's own committed work. Preserve the return limit of three, staged/untracked handling, fail-open behavior and each harness's existing output/exit channel until an explicit contract change says otherwise.

## Verification

- Each generic case has an independently runnable reproduction and a comparison with the documented current filter. Tests and live harness observations remain distinct.
- The ADR identifies the chosen boundary, its limitations, compatibility and the treatment of all five cases. A stronger requirement is not presented as already shipped behavior.
- Future implementation checks, after the decision, include `node --test --test-timeout=60000 test/hook.test.mjs` and `node bin/backslop.js gates`, with exact candidate SHA, full output and exit codes. These checks are notRun for this task; the triage gate pass checks only the backlog revision.
