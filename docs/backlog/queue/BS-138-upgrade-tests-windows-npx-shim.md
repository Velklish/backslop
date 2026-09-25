# BS-138 · Run the pinned-form upgrade tests on Windows: a node-based npx shim instead of /bin/sh

- **Order:** 560
- **Scope:** [02. CLI](../../reference/02-cli.md) § upgrade
- **Created:** 2026-09-25
- **Dependencies:** BS-137

## Context

Line numbers are at commit 6f6318e (v0.11.0); if a line moved, find the test by the quoted name. A *mutation probe* means: edit the named lib line in the working tree, run the named test file with `node --test --test-timeout=60000 <file>; echo rc=$?`, read the red test names (lines starting with `✖`), then restore with `git checkout -- lib bin scripts templates`. Base run at 6f6318e: full suite 450 tests, 450 pass. Bug and code cards earlier in the queue changed some of the lib lines named in the mutation probes; apply each probe to the same logic where it lives when you start.

Windows is a supported platform, yet every pinned-form upgrade test is skipped there. verified — read: `grep -n "skip: process.platform === 'win32'" test/upgrade.test.mjs` -> lines 64 121 142 318 349 386 426 488. Six of them skip only because the `npx` stand-in is a POSIX script: `npxShim()` (:339-347) writes `#!/bin/sh\nwhile [ $# -gt 0 ]; do case "$1" in -*) shift ;; *) shift; break ;; esac; done\nexec "<node>" "<BIN>" "$@"` — it drops npx flags and the package spec and runs the local bin; :64, :142, :349, :426 use it, and :386, :488 write a broken `npx` (`#!/bin/sh\nexit 3`). The other two skips are platform-specific on purpose: :121 kills git with a signal through a `/bin/sh` git shim, :318 needs a symlink. upgrade runs its commands with `spawnSync(command, { shell: true })` (lib/upgrade.js:81), so on Windows `cmd.exe` resolves `npx` through PATHEXT (`npx.cmd`) — the path that ships to Windows users and that no test exercises.

Related, verified — a scratch probe but not part of this card: every upgrade test uses `makeProject({ git: false })` except :295, which calls `migrate` alone; a full `upgrade` on a git project with a pinned npx cli and a committed rules pair rendered with the old pin rewrites docs/backlog/README.md via `rewriteProsePins` and then its own `migrate` refuses it as an uncommitted edit (rc 1, pin already moved, stamp left at 0.1.0). That bug and its regression test belong to BS-84 (`upgrade-completes-pinned-consumers`).

## Work to do

- Move the argument-stripping logic of `npxShim()` into a small node script written by the helper (e.g. `npx.mjs`: drop leading `-…` flags and the first non-flag argument, then spawn `process.execPath BIN ...rest` with inherited stdio and exit with its code).
- Have the helper write the launcher for the current platform: on POSIX an executable `npx` (`#!/bin/sh` + `exec "<node>" "<dir>/npx.mjs" "$@"`), on win32 an `npx.cmd` (`@"<node>" "<dir>\npx.mjs" %*`).
- Give the broken-shim tests the same helper with a script that exits 3 (after the BS-84 (`upgrade-completes-pinned-consumers`) card, the probe-failure table replaces :386/:488).
- Remove `{ skip: process.platform === 'win32' }` from the tests that now depend only on this helper (:64, :142, :349, :426 and the probe-failure table); keep the skip on :121 (git signal shim) and :318 (symlink).

## Out of scope

- The full-upgrade refusal on a pinned git project and its regression test (bug card).
- The git signal shim of :121 and the symlink test :318.
- Any change under lib/.

## Verification

- POSIX: `node --test --test-timeout=60000 test/upgrade.test.mjs; echo rc=$?` -> rc 0 with the same test count as before this card, 0 skipped on darwin.
- Mutation probe on POSIX: lib/upgrade.js:145 `if (!pinOnly) exec` -> the `--pin-only` probe-failure row and :64 red (the node shim still drives the probe).
- Windows, if a machine is available: `npm test` -> rc 0 and `skipped` equals 2 in upgrade.test.mjs (:121, :318). If no Windows machine is available, say so in the result: the Windows launcher is then unverified.
- `npm test; echo rc=$?` -> rc 0.
