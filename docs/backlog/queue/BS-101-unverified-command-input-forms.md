# BS-101 · Check and fix: merge-changelog --out base dir, archive --range single ref, pin grammar

- **Order:** 190
- **Scope:** [02. CLI](../../reference/02-cli.md) § Commands
- **Created:** 2026-09-25
- **Dependencies:** BS-87, BS-84

## Context

Every item in this card is **unverified — run the check first**. The behaviour was observed once on 6f6318e; it has not been reproduced independently, and nobody has checked yet whether a doc, ADR or test sanctions it. Work each item in order: (1) reproduce blind in a throwaway project with the exact commands, (2) look for a doc, ADR or test that sanctions the behaviour, (3) fix only if (1) reproduces and (2) finds no sanction. Record the outcome of each step in the result (reproduced / not reproduced / sanctioned by <file:line>). Line numbers refer to base commit 6f6318e (v0.11.0). `$BS` is `node <repo>/bin/backslop.js`; throwaway projects start with `git init -q -b main && $BS init --lang en --tools none` unless stated otherwise. Where an ADR is cited, the path is the one at 6f6318e; the ADR consolidation cards run later in the queue.

Module: command input interpretation (lib/merge-changelog.js, lib/archive.js, lib/config.js).

- **`merge-changelog --out <relative>` is resolved against the project root, not the cwd** — unverified — run the check first. Observed: lib/merge-changelog.js:379 `writeFileSync(path.resolve(root, values.out), text)` with `root = findRoot(cwd)` (:364); the report line (:392) prints the path relative to the root. From `<project>/sub/dir`, `--out merged.md` printed `written: merged.md`, `ls merged.md` failed and `../../merged.md` existed.
- **`archive --range` accepts a single ref** — unverified — run the check first. Observed: lib/archive.js:17-18 only check that `--range` is non-empty and :126 passes it to `git log`; `--range HEAD~1` (no `..`) listed every doc in the history up to HEAD~1 as "documentation touched by BS-1", rc=0, while `HEAD~1..HEAD` listed only the last commit's doc. The help (bin/backslop.js:81) and docs/reference/02-cli.md document `--range <base>..HEAD`.
- **`parseCli` accepts pin forms that `pinRe` cannot find** — unverified — run the check first. Observed: lib/config.js:42 `NPX_GITHUB` accepts `(?:\.git)?` and `#v?(\d+\.\d+\.\d+)`; lib/config.js:70 `pinRe` builds `${spec}#v(\d+\.\d+\.\d+)` from the stripped spec, so `upgrade` (lib/upgrade.js:54) never rewrites and lint (lib/lint.js:186-190) never flags prose written as `npx github:Velklish/backslop.git#v0.9.0` or `…backslop#0.9.0`; a unit probe gave `pin: 0.9.0`, `withPin('0.11.0')` = the canonical `#v0.11.0` form, `proseMatches: 0` for both.

## Work to do

- [ ] `merge-changelog --out` base directory
    1. Blind repro: `$BS init --lang en --tools none && printf '# Changelog\n\n## Unreleased\n\n- **A** — a.\n\n## 0.1.0 — 2026-01-01\n\n- **Init** — i.\n' > CHANGELOG.md && git add -A && git commit -qm base && git tag v0.1.0 && git checkout -qb theirs && printf '# Changelog\n\n## Unreleased\n\n- **A** — a.\n- **B** — b.\n\n## 0.1.0 — 2026-01-01\n\n- **Init** — i.\n' > CHANGELOG.md && git commit -qam b && git checkout -q main && mkdir -p sub/dir && cd sub/dir && $BS merge-changelog --ours main --theirs theirs --out merged.md; echo rc=$?; ls merged.md ../../merged.md` — expected wrong output: rc=0, stderr `written: merged.md`, `ls: merged.md: No such file or directory`, `../../merged.md` listed.
    2. Refutation check: docs/reference/02-cli.md (merge-changelog row and any general rule that command paths are relative to the project root, e.g. :14) and the help text: if a project-root convention for path arguments is documented, record the sanction; then only the `written:` line needs to show the path relative to the cwd.
    3. Fix only if confirmed: resolve `--out` against the cwd (`path.resolve(cwd, values.out)`) and print it relative to the cwd; test from a subdirectory.
- [ ] `archive --range` without `..`
    1. Blind repro: `$BS new t --queue --title T && git add -A && git commit -qm t && for n in old mid new; do printf '# %s\n' $n > docs/reference/$n.md; git add -A; git commit -qm $n; done; $BS archive 1 --dry-run --range 'HEAD~1..HEAD'; $BS archive 1 --dry-run --range 'HEAD~1'; echo rc=$?` — expected wrong output: the second run exits 0 and its `documentation touched by BS-1` list contains docs/reference/old.md and mid.md (and older docs) instead of refusing.
    2. Refutation check: help (bin/backslop.js:81), docs/reference/02-cli.md archive row and test/archive.test.mjs: if a single-ref form is documented or tested, record the sanction and stop.
    3. Fix only if confirmed: refuse a `--range` without `..` with the documented form in the message; test in test/archive.test.mjs.
- [ ] Pin grammar of `cli` vs the pin matcher (lib/config.js)
    1. Blind repro: `cd <repo> && node --input-type=module -e 'import { parseCli, pinRe } from "./lib/config.js"; for (const cli of ["npx github:Velklish/backslop#0.9.0", "npx github:Velklish/backslop.git#v0.9.0"]) { const f = parseCli(cli); const prose = "`" + cli + " lint`"; console.log(JSON.stringify({ cli, pin: f.pin, withPin: f.withPin("0.11.0"), proseMatches: [...prose.matchAll(pinRe(f))].length })); }'` — expected wrong output: `pin` 0.9.0 and `proseMatches` 0 for both lines. CLI check: in a fresh project (cli `npx github:Velklish/backslop#v0.11.0`) append ``Run `npx github:Velklish/backslop.git#v0.9.0 lint`.`` to docs/README.md and run `$BS lint; echo rc=$?` — expected wrong output: rc=0, no pin error.
    2. Refutation check: docs/reference/01-layout.md § backslop.json (`cli` forms), README.md install/upgrade section and test/config.test.mjs: if the `.git` suffix and the `v`-less pin are documented as accepted forms, the pin matcher must widen; if only the canonical form is documented, `parseCli` must reject the others. Either way it is a bug; record which side the docs support.
    3. Fix only if confirmed: make both grammars one — widen `pinRe` to `(?:\.git)?#v?` (and have `upgrade` rewrite such prose to the canonical form) or reject non-canonical forms in `parseCli`/`loadConfig`; tests for upgrade rewrite and lint detection.

## Out of scope

- Verified merge-changelog and upgrade bugs — the cards this card depends on.

## Verification

- For each item the result names the outcome of steps 1–2 with the command output and rc.
- Each confirmed item has a red-then-green test; a sanctioned item has no code change (or only a doc sentence).
- `npm test` → rc=0; `node bin/backslop.js lint` → rc=0.
