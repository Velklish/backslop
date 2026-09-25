# BS-100 · Check and fix: BOM loss on card rewrite, mv rename on git failure

- **Order:** 180
- **Scope:** [02. CLI](../../reference/02-cli.md) § mv
- **Created:** 2026-09-25
- **Dependencies:** BS-88

## Context

Every item in this card is **unverified — run the check first**. The behaviour was observed once on 6f6318e; it has not been reproduced independently, and nobody has checked yet whether a doc, ADR or test sanctions it. Work each item in order: (1) reproduce blind in a throwaway project with the exact commands, (2) look for a doc, ADR or test that sanctions the behaviour, (3) fix only if (1) reproduces and (2) finds no sanction. Record the outcome of each step in the result (reproduced / not reproduced / sanctioned by <file:line>). Line numbers refer to base commit 6f6318e (v0.11.0). `$BS` is `node <repo>/bin/backslop.js`; throwaway projects start with `git init -q -b main && $BS init --lang en --tools none` unless stated otherwise. Where an ADR is cited, the path is the one at 6f6318e; the ADR consolidation cards run later in the queue.

Module: file I/O helpers (lib/tasks.js `readText`/`writeText`/`moveFile`).

- **`readText` drops a UTF-8 BOM and `writeText` never restores it** — unverified — run the check first. Observed: lib/tasks.js:348-351 strips U+FEFF, lib/tasks.js:353-356 writes the stripped text; after `mv 1 active` a card that started with `EF BB BF` started with `# B`; a queue neighbour touched only by renumbering (lib/mv.js:169, :171; lib/new.js:134) loses its BOM too. lint has no BOM rule.
- **`moveFile` treats any `git ls-files` failure as "not tracked"** — unverified — run the check first. Observed: lib/tasks.js:576-582 `const tracked = git(root, ['ls-files', '--error-unmatch', '--', from]); if (tracked.status === 0) { gitOrFail(root, ['mv', …]); return 'git'; } renameSync(from, to); return 'fs';` — with a git shim that `kill -9`s itself on `--error-unmatch`, `mv 1 active` printed `⚠ file is not tracked by git — moved without git mv` and rc=0, and `git status --short` showed ` D docs/backlog/queue/BS-1-a.md` + `?? docs/backlog/active/BS-1-a.md` for a tracked file.

## Work to do

- [ ] BOM kept on card rewrite (lib/tasks.js)
    1. Blind repro: `$BS new bom --queue --title Bom && { printf '\xEF\xBB\xBF'; cat docs/backlog/queue/BS-1-bom.md; } > t && mv t docs/backlog/queue/BS-1-bom.md && git add -A && git commit -qm bom && head -c 3 docs/backlog/queue/BS-1-bom.md | od -An -tx1 && $BS mv 1 active; echo rc=$?; head -c 3 docs/backlog/active/BS-1-bom.md | od -An -tx1` — expected wrong output: `ef bb bf` before, rc=0, `23 20 42` after (BOM gone).
    2. Refutation check: docs/reference/02-cli.md:37 says task files "are read without BOM, line endings are preserved" and lib/tasks.js:346-347 says the same for EOL only. Owner decision: a UTF-8 BOM is preserved when a card is rewritten; neither sentence sanctions the loss.
    3. Fix only if confirmed: remember the BOM in `readText` (return it with the text or keep a flag) and re-emit it in `writeText`; say in docs/reference/02-cli.md:37 that a BOM is kept on rewrite; test that `mv` and renumbering keep `ef bb bf`.
- [ ] Rename fallback on a git failure (lib/tasks.js `moveFile`)
    1. Blind repro (shim outside the project): `$BS new a --queue --title A && git add -A && git commit -qm a; S=$(mktemp -d); REAL=$(command -v git); printf '#!/bin/sh\nfor a in "$@"; do [ "$a" = "--error-unmatch" ] && kill -9 $$; done\nexec %s "$@"\n' "$REAL" > $S/git; chmod +x $S/git; PATH=$S:$PATH $BS mv 1 active; echo rc=$?; git status --short` — expected wrong output: `⚠ file is not tracked by git — moved without git mv`, rc=0, status ` D docs/backlog/queue/BS-1-a.md` and `?? docs/backlog/active/BS-1-a.md`.
    2. Refutation check: docs/reference/02-cli.md:37 sanctions a plain rename only for a file outside the git index or without a repository; check test/commands.test.mjs for a test that expects a rename on a failed git call. If none, confirmed.
    3. Fix only if confirmed: treat only exit 1 of `ls-files --error-unmatch` and a `not a git repository` exit 128 as untracked; on `r.error`, `r.signal`, `status === null` or another failure throw a CliError with `gitCause(r)` before touching the file; test with the shim (reuse the git-failure helper introduced by the BS-88 (`branch-scans-new-and-tracks`) card if present).

## Out of scope

- BOM handling of links and backslop.json — verified in the BS-89 (`link-gate-target-resolution`) and BS-94 (`config-validation-one-rule-set`) cards.

## Verification

- For each item the result names the outcome of steps 1–2 with the command output and rc.
- Each confirmed item has a red-then-green test; a sanctioned item (item 2 only) has a doc sentence instead of a code change.
- `npm test` → rc=0; `node bin/backslop.js lint` → rc=0.
