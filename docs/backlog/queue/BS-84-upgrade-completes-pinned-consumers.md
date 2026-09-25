# BS-84 · upgrade: complete runs from pinned consumers, move every pin, pin a floating cli

- **Order:** 20
- **Scope:** [02. CLI](../../reference/02-cli.md) § upgrade
- **Created:** 2026-09-25
- **Dependencies:** none

## Context

Line numbers refer to base commit 6f6318e (v0.11.0). `$BS` below is `node <repo>/bin/backslop.js`; throwaway projects are created with `git init -q && $BS init --lang en --tools none` unless stated otherwise.

Five verified bugs in `upgrade` (lib/upgrade.js) and in the `migrate` step it runs; a relative `source` path is fixed separately by the BS-93 (`upgrade-source-path-from-root`) card. The first one blocks every consumer pinned to v0.9.0–v0.10.x from upgrading.

**1. Critical — a full `upgrade` from a pinned consumer fails halfway and the printed recovery fails too.** verified — reproduced on 6f6318e with a committed consumer created by a v0.9.0 checkout and with a consumer pinned `npx github:me/proj#v0.10.0` (local release source tagged v0.10.0/v0.11.0, `npx` shim on PATH).
- `node <v0.9.0 checkout>/bin/backslop.js upgrade` (and the same with the HEAD bin) → rc=1:
  ```
  pin in prose: 5 files
  → npx github:Velklish/backslop#v0.11.0 migrate
  ✖ docs/archive/README.md, docs/backlog/README.md: uncommitted edit — migrate would rewrite the file from the template and erase it with no trace in history; commit or revert the edit, then retry
  ✖ command … exited with code 1. Pin is already v0.11.0: finish manually with … migrate, then … init
  ```
- Afterwards backslop.json holds `cli …#v0.11.0` with `version 0.9.0` (half-upgraded); `git diff docs/backlog/README.md` shows only `#v0.9.0` → `#v0.11.0` replacements. The printed recovery `npx github:Velklish/backslop#v0.11.0 migrate` exits rc=1 with the same refusal.
- Root cause: lib/upgrade.js:153 `rewriteProsePins` walks `livePinFiles` (lib/mdwalk.js:126), which includes the tool-owned rules pair `docs/backlog/README.md` and `docs/archive/README.md`; lib/upgrade.js:162 then execs the new `migrate`, whose `planRules` (lib/migrate.js:60 `git status --porcelain -- <pair>`) sees the pair dirty and throws (lib/migrate.js:65). README.md:74 promises that upgrade "then runs migrate, init".
- Constraint for the fix: the `upgrade` code that runs is the consumer's installed (old) version; only `version`, `migrate`, `init` and `changelog` come from the new release. Reordering lib/upgrade.js helps future upgrades only; consumers on v0.9.0–v0.11.0 are rescued only if the NEW `migrate` accepts a rules pair whose sole uncommitted change is the pin rewrite.
- Manual sequence that worked at the time (rc=0 each, final lint rc=0): `<old cli> upgrade --pin-only`, `<new cli> migrate`, `<new cli> init`, `<new cli> upgrade`.

**2. Major — with a non-npx cli, `upgrade` reports success while nothing was upgraded.** verified — reproduced on 6f6318e with cli `node <v0.10.0 checkout>/bin/backslop.js` and `source` = the v0.11.0 repository.
- `$BS upgrade` → rc=0; the probe prints `backslop 0.10.0`, then `migrate` prints `nothing to migrate: file format did not change from v0.10.0 through v0.10.0` / `✔ migrate: project is on v0.10.0`, init runs, and the last line is `✔ upgrade: v0.10.0 → v0.11.0`; backslop.json keeps `"version": "0.10.0"`. A second run repeats the fake success.
- Root cause: lib/upgrade.js:130 `const newCli = form ? form.withPin(target) : cfg.cli;` keeps the old command when the cli is not an npx pin; lib/upgrade.js:145 `exec(`${newCli} version`, …)` checks only the exit code (stdout is inherited, never compared with the target); lib/upgrade.js:162-165 then run migrate/init with the old install and print `ok(`upgrade: ${label} → v${target}`)`. The `--pin-only` branch (lib/upgrade.js:156-158) prints `pin updated; finish manually …` although no pin exists. test/upgrade.test.mjs:185-208 covers only a non-npx cli that already runs the new tool.

**3. Minor — a lagging stamp is hidden: the from-version is the pin, not the stamp.** verified — reproduced on 6f6318e through the documented `--pin-only` path (no hand edit needed).
- After `upgrade --pin-only --to v0.10.0` (pin 0.10.0, stamp 0.9.0) the plan reads `upgrade: v0.10.0 → v0.11.0` and the full run executes `changelog --since v0.10.0 --to v0.11.0`, so the v0.10.0 entries are never shown. With the pin already at the latest tag and stamp 0.9.0: `upgrade: v0.11.0 → v0.11.0`, `changelog --since v0.11.0 --to v0.11.0` → `no entries after v0.11.0 and through v0.11.0`.
- Root cause: lib/upgrade.js:120 `const current = form?.pin ?? cfg.version ?? null;` and lib/upgrade.js:164 `changelog --since v${current}`.

**4. Medium — upgrade moves only a leading cli in a gate command, and gates are outside the stale-pin check.** verified — reproduced on 6f6318e (local source tagged v0.11.0/v0.12.0, npx shim).
- Gates `["<cli> lint && <cli> gates --dry-run", {"command": "cd . && <cli> lint", "when": ["docs/**"]}]`: `upgrade` rc=0 prints `gates with the new pin: 1 of 2`; afterwards the first gate reads `…#v0.12.0 lint && …#v0.11.0 gates --dry-run` and the second still holds `#v0.11.0`; `lint` rc=0 with no error.
- Root cause: lib/upgrade.js:40-41 `if (command !== oldCli && !command.startsWith(`${oldCli} `)) return gate; const next = newCli + command.slice(oldCli.length);` — a prefix match plus one splice. The stale-pin gate reads only `livePinFiles` (lib/mdwalk.js:126-146: live markdown, package.json, CI files; backslop.json is not in the set) via lib/lint.js:187, and `lintVersion` (lib/lint.js:163-176) looks only at `cfg.cli`/`cfg.version`; `grep -c 'cfg.gates' lib/lint.js` = 0. README.md:74 and docs/reference/02-cli.md:25,43 promise that upgrade moves the pin in gates.

**5. Major — upgrade never pins a floating cli once the stamp equals the latest tag, and lint keeps asking for it.** verified — reproduced on 6f6318e.
- Setup: `S=$(mktemp -d); git -C $S init -q && git -C $S commit -q --allow-empty -m r && git -C $S tag v0.11.0`; in a fresh `git init -q` project `$BS init --lang en --tools none --cli 'npx github:me/proj'`, then set `"source": "$S"` in backslop.json (stamp is 0.11.0).
- `$BS lint; echo rc=$?` → rc=0 with `⚠ backslop.json: an unpinned cli fetches a fresh version on every run — run npx github:me/proj upgrade`. `$BS upgrade; echo rc=$?` → rc=0 `✔ upgrade: project is already on v0.11.0; … has nothing newer than v0.11.0`; `grep '"cli"' backslop.json` still shows `npx github:me/proj`. The same holds for `npx backslop` and `npx backslop@latest` with a `source`. `upgrade --to 0.11.0` bypasses the exit.
- Root cause: lib/upgrade.js:120 `const current = form?.pin ?? cfg.version ?? null;` takes the stamp for a floating form; :125 exits early when target equals current, `--to` is absent, the stamp equals current and `hasStaleLivePins` is false — and it returns false for `form.pin === null` (:64). ADR-007:24 promises 'lint warns, upgrade moves to the exact pin'; lib/lint.js:167 warns forever. No test covers a floating cli on the latest version.
- Bug 3 changes :120 to take the lower of pin and stamp; apply this fix on top of that change.

## Work to do

- Bug 1, new-release side (rescues v0.9.0–v0.11.0 consumers): in `planRules` (lib/migrate.js:48-70), before refusing, compare each dirty rules doc with its HEAD blob (`git show HEAD:<path>`) after normalising every pin occurrence (`pinRe(parseCli(cfg.cli))`, any version) to the current cli pin on both sides; when the texts are then equal the file counts as clean and is redrawn. Any other difference still refuses with the existing message.
- Bug 1, upgrade side: in lib/upgrade.js move the `rewriteProsePins` call after `migrate` and `init` (both render the rules pair with the saved new cli), so a full upgrade never leaves the pair dirty when migrate checks it; keep `--pin-only` behaviour (no prose rewrite) and update the after-pin recovery text to the sequence that works.
- Bug 2: capture stdout of the `<newCli> version` probe (pipe instead of inherit for that call), parse `backslop X.Y.Z` and refuse with a CliError when it is not the target (`cli still runs vX.Y.Z — update the installation, then retry`); in that case run neither migrate nor init and print no success line. Print the `--pin-only` "pin updated" line only when `form !== null`.
- Bug 3: take the from-version as the lower of pin and stamp (`compareVersions`), use it for the plan label and for `changelog --since`; when pin and stamp differ, print both in the plan line.
- Bug 4: make `rewriteGates` replace every occurrence of the old pin inside each gate command (reuse `pinRe(form)` and the same target as `rewriteProsePins`), keeping `when`; extend the stale-pin gate (lint) to check `cfg.gates` commands and `cfg.probe` for pins that differ from the cli pin, reporting them as `backslop.json: gates[i]` errors.
- Bug 5: in lib/upgrade.js do not take the early exit when the cli is a release form without a pin (`form && form.pin === null`), so upgrade saves the exact pin, rewrites gates and continues; keep the early exit for an exact pin on the latest tag.
- Bug 5, test: in test/upgrade.test.mjs add 'upgrade pins a floating cli already on the latest version' using the same npx shim and local release source as the existing pinned-form upgrade tests (for example the probe-before-pin test near test/upgrade.test.mjs:349); assert rc=0, cli becomes `npx github:me/proj#v<latest>`, and a following `lint` prints no unpinned-cli warning. It is skipped on win32 like its neighbours; the BS-138 (`upgrade-tests-windows-npx-shim`) card lifts the skip later.
- docs/reference/02-cli.md: in the `upgrade` row state that upgrade compares the probed version with the target, takes the from-version as the lower of pin and stamp, moves every pin occurrence inside gate commands and always pins a floating release form. CHANGELOG.md: one English entry under the unreleased section (a `## ` heading without a version; create it above the newest version heading if absent) for each user-visible fix.
- Add the regression tests listed under Verification to test/upgrade.test.mjs (and a lint test for bug 4 in test/lint.test.mjs); keep docs free of task numbers and ADR citations.

## Out of scope

- Widening the pin grammar (`.git` suffix, `#X.Y.Z` without `v`) — the BS-101 (`unverified-command-input-forms`) card.
- Symlink, encoding and git-failure guards on files that upgrade/migrate/init write — handled by the BS-85 (`rewrite-guards-against-data-loss`) card.
- Migrations or legacy paths for versions below 0.9.0 (no consumers).
- A relative `source` path resolved from the wrong directory — the BS-93 (`upgrade-source-path-from-root`) card.

## Verification

- New test (bug 1, new migrate): git fixture stamped 0.10.0 with cli `npx github:me/proj#v0.10.0`, rules pair rendered with that pin and committed; rewrite the pin in the pair to v0.11.0 without committing and set backslop.json cli to v0.11.0; `$BS migrate` → rc=0, pair redrawn from the template. Same fixture plus one extra non-pin line in docs/backlog/README.md → rc=1 with `uncommitted edit`.
- New test (bug 1, full run): same consumer committed, local release source tagged v0.10.0 and v0.11.0, npx shim on PATH that execs the HEAD bin; `upgrade` → rc=0, backslop.json `version` equals the target, `git status --porcelain` shows no refusal, `$BS lint` rc=0.
- New test (bug 2): cli `node <fixture tool that prints backslop 0.10.0>`; `upgrade` → rc=1 with the `still runs v0.10.0` refusal, stamp unchanged, migrate not executed (no `✔ migrate` in output).
- New test (bug 3): pin v0.11.0, stamp 0.9.0 → `upgrade --dry-run` plan line names v0.9.0; the full run executes `changelog --since v0.9.0`.
- New test (bug 4): gates with `cd . && <cli> lint` and `<cli> lint && <cli> gates --dry-run` → after `upgrade` no old pin remains in backslop.json; a lint test with an old pin only in a gate command → rc=1 naming `gates[`.
- Bug 5 repro above after the fix: `$BS upgrade` in the floating project runs the probe and saves `"cli": "npx github:me/proj#v0.11.0"` (with an npx shim that answers `version`), then `$BS lint` shows no unpinned warning.
- `npm test` → rc=0; `node bin/backslop.js lint` → rc=0.
