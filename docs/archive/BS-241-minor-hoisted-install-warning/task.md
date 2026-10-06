# BS-241 · Minor batch: hoisted local installation diagnostics

- **Order:** 7
- **Scope:** [02. CLI](../../reference/02-cli.md#init)
- **Created:** 2026-10-06
- **Dependencies:** shared-machine concurrency-setting fix for final gates
- **Cost:** minor

## Context

BS-215.2 is confirmed by independent source and genuine offline npm workspace probes on 2026-10-06 at 9c3c67078188f01dbdeff0fa4c185336c3ec2f0c. npm 11.6.2 installed the declared workspace dependency into the ancestor node_modules; child npx --offline --no-install backslop version and the Codex hook both exited 0. Child init nevertheless printed the missing-install warning because the helpers checked only child node_modules. Full commands, output and environment are in triage-refuter-evidence.json (BS-215.2-raw.json).

## Work to do

- BS-215.2: detect the ancestor local installation used by npm workspace resolution and use the corresponding installed version for init diagnostics.
- Preserve project dependency declaration and existing CLI selection contracts; distinguish truly missing local installations.

## Out of scope

- Global PATH installation, fetching packages, changing hook command selection, or claiming actual Windows execution.
- Existing tracker or archive edits by the implementation worker.

## Verification

- Genuine offline npm workspace installation: resolved child command and Codex hook work, init emits no false missing-install warning and reads the correct installed version.
- Root-local, nearest local installation precedence and absent-install warnings retain deciding controls.
- Old code fails the new hoisted-install regression; committed meaningful mutation is detected, restoration is clean and green.
- Full final clean gates run with accepted concurrency setting under machine lease.
- Accepting side archives BS-215.2 into this batch before folding BS-241.
