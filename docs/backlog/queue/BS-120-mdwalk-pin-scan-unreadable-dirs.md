# BS-120 · mdwalk: one stale-pin scan for lint and upgrade; srcFiles refuses an unreadable directory

- **Order:** 380
- **Scope:** [03. Lint gates](../../reference/03-lint.md) § gate 1
- **Created:** 2026-09-25
- **Dependencies:** BS-95, BS-84, BS-106, BS-99

## Context

lib/mdwalk.js says that the gates and the rewrites must use one walker (lib/mdwalk.js:1-2). Still, the stale-pin scan is copied between lint and upgrade, and `srcFiles` crashes on an unreadable directory. (The root `*.md` collector was unified by BS-95 (`lint-walk-and-gate-coverage`).)

Repro commands below run in an empty scratch directory with `B() { node "$BACKSLOP/bin/backslop.js" "$@"; }`, where `$BACKSLOP` is this repository's checkout; projects are created with `git init -q -b main && B init --tools none --lang en`.

**1. The stale-pin scan is copied** — verified — read the code at base.
- lib/lint.js:187-195 and `upgrade.hasStaleLivePins` (lib/upgrade.js:63-72) run the same `livePinFiles` + `pinRe` + `m[1] !== form.pin` scan.
- The BS-106 (`dead-branches-project-modules`) card already deleted the no-op `re.lastIndex = 0` in upgrade.
- lint reads with `readText` and upgrade with `readFileSync`. They find the same matches, because `pinRe` (lib/config.js:68-71) is unanchored.
- `rewriteProsePins` (lib/upgrade.js:53) must stay on `readFileSync`. It writes the whole text back, and `readText` would strip the BOM of every file it rewrites.

**2. `srcFiles` crashes on an unreadable directory** — verified — repro rerun at base.
- `srcFiles` calls `readdirSync` with no try (lib/mdwalk.js:56), while `seed.walk` swallows the error (lib/seed.js:227-232).
- Repro: `mkdir -p docs/locked src/locked && chmod 000 docs/locked src/locked`. `B lint` → rc=1 with an uncaught `Error: EACCES: permission denied, scandir '<project>/docs/locked'` at `srcFiles (lib/mdwalk.js:56:19)`. `B seed --scan --json` → rc=0.
- The three walkers (`srcFiles`, `seed.walk`, `adapters.localFiles` at lib/adapters.js:165-174) differ in their symlink and skip rules on purpose. Those rules are documented at lib/mdwalk.js:47-48 and lib/seed.js:19-20 and :224-225. A single parametrised walker is not wanted.

**Which behaviour wins.** One stale-pin scan, read-only; `rewriteProsePins` keeps its own raw read. An unreadable directory becomes a CliError naming the path.

## Work to do

- lib/mdwalk.js: export `stalePins(root, docs, prefix, form) -> [{ abs, lineNo, match }]` next to `livePinFiles`. lint maps it to errors with the current messages, and `upgrade.hasStaleLivePins` returns `.length > 0`. Leave `rewriteProsePins` (lib/upgrade.js:53) on `readFileSync`.
- `srcFiles` (lib/mdwalk.js:56): wrap `readdirSync` and turn EACCES/EPERM into a CliError naming the directory. Nothing else changes: ENOENT is still guarded by the `existsSync` check, and the symlink and skip rules stay as they are.
- Add a CHANGELOG entry under the unreleased section: `lint` reports an unreadable directory as an error instead of a stack trace.

## Out of scope

- Merging the three walkers into one.
- Href parsing inside the gates (handled by the BS-112 (`shared-href-resolver`) card).
- Root `*.md` collection and symlinked root files (the BS-95 (`lint-walk-and-gate-coverage`) card).

## Verification

- New test in test/mdwalk.test.mjs: an unreadable subdirectory makes `srcFiles` throw a CliError that names it. Skip this test when running as root, because root can read a `chmod 000` directory.
- `node --test --test-timeout=60000 test/lint.test.mjs test/upgrade.test.mjs; echo rc=$?` → rc=0 with the same test counts as before this card (the pin tests are not edited).
- `npm test`: every test passes. `node bin/backslop.js lint` → rc=0.
