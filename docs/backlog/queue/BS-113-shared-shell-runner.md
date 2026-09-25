# BS-113 · upgrade runs steps through the gates shell runner: a time cap fails and the cause is named

- **Order:** 310
- **Scope:** [02. CLI](../../reference/02-cli.md) § upgrade
- **Created:** 2026-09-25
- **Dependencies:** BS-84, BS-92

## Context

`upgrade` and `gates` run shell commands with the same `spawnSync` options, but they decide success differently. They also report failures differently.

**1. Success predicate** — verified — the demo below was rerun at base with Node's `spawnSync`.
- `upgrade.exec` (lib/upgrade.js:79-85) runs `spawnSync(command, { cwd, shell: true, stdio: 'inherit', timeout: 10 * 60 * 1000 })` and then only checks `if (r.status !== 0) throw ...`.
- `gates.runGate` (lib/gates.js:138-159) uses the same options with `passed(r) = r.code === 0 && r.error === null`. Its comment explains why: a hit time cap gives ETIMEDOUT together with exit code 0 when the shell survives SIGTERM.
- Demo: `spawnSync("trap 'exit 0' TERM; sleep 5 & wait", { shell: true, stdio: 'inherit', timeout: 1500 })` → `{"status":0,"signal":null,"error":"ETIMEDOUT"}`. The upgrade rule reports failure: false, so upgrade would continue. The gates rule reports success: false.

**2. Failure message** — verified — read the code at base.
- lib/upgrade.js:83 reports the step "exited with code `${r.status ?? r.signal}`" and ignores `r.error`. A time cap is therefore reported as code SIGTERM, and a spawn error as code null. Reproduced: a project with `cli` = `sh killer.sh`, where the script runs `kill -KILL $$`, and a local `source` repo tagged v99.0.0 → `upgrade` rc=1 with `✖ command “sh …/killer.sh version” exited with code SIGKILL. Pin and version stamp were not changed…`. The spawn at lib/upgrade.js:81 uses `stdio: 'inherit'`, so `r.stderr` is null and a cause built like `gitCause` falls through to error, signal and code.
- `util.gitCause` (lib/util.js:42-48) uses this order: stderr, then `error.message`, then signal, then code.
- test/helpers.mjs:43 falls back to stdout on purpose, because git prints "nothing to commit" only on stdout. Keep it.
- scripts/release.mjs:13-25 is a different runner (argv without a shell, no cap, an allow-list, and it already checks `result.error` first). Leave it.

**Which behaviour wins.** The gates predicate and a cause-naming message. BS-92 (`gates-tree-labels-globs`) already corrected the gate outcome labels (time cap vs signal vs failure to start); move them as they are.

## Work to do

- Move `runGate`, `passed` and `outcome` (lib/gates.js:138-166) to lib/util.js as `runShell(command, { cwd, quiet, timeout })`, `shellPassed(r)` and `shellOutcome(r, lang)`. `gates` uses them with no change in behaviour or output.
- Rewrite `upgrade.exec` (lib/upgrade.js:79-85) on `runShell` with stdio `inherit`. Fail when `!shellPassed(r)`. Build the message tail from `shellOutcome` so it names a time cap, a signal or a spawn error, and keep upgrade's recovery text.
- Let a test set the time cap, for example with a `timeout` option passed down from the step runner. Keep the 10-minute default.
- Add a CHANGELOG entry: `upgrade` stops on a step that hit the time cap even when the shell exited 0, and the message names the cause.

## Out of scope

- scripts/release.mjs's runner and messages.
- The stdout fallback in test/helpers.mjs:43.
- Changing the 10-minute cap.

## Verification

- New test (test/upgrade.test.mjs or a util test): a step `trap 'exit 0' TERM; sleep 5 & wait` with a cap of at least 2 s makes upgrade exit 1, and the message names the time cap. Use a cap of at least 2 s, because a shorter one makes the trap stand flaky.
- New test in test/upgrade.test.mjs (skip on win32): with the killer-script setup above, `upgrade` exits 1 and names `SIGKILL` as a signal (e.g. `killed by SIGKILL`), not as an exit code.
- `node --test --test-timeout=60000 test/gates.test.mjs; echo rc=$?` → rc=0 with the same test count as before this card (the time-cap and signal outcome tests are not edited).
- `npm test`: every test passes. `node bin/backslop.js lint` → rc=0.
