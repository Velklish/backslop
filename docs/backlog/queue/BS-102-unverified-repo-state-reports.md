# BS-102 · Check and fix: monorepo-wide --require-clean in gates, prunable worktrees in tracks

- **Order:** 200
- **Scope:** [02. CLI](../../reference/02-cli.md) § gates
- **Created:** 2026-09-25
- **Dependencies:** BS-92, BS-88

## Context

Every item in this card is **unverified — run the check first**. The behaviour was observed once on 6f6318e; it has not been reproduced independently, and nobody has checked yet whether a doc, ADR or test sanctions it. Work each item in order: (1) reproduce blind in a throwaway project with the exact commands, (2) look for a doc, ADR or test that sanctions the behaviour, (3) fix only if (1) reproduces and (2) finds no sanction. Record the outcome of each step in the result (reproduced / not reproduced / sanctioned by <file:line>). Line numbers refer to base commit 6f6318e (v0.11.0). `$BS` is `node <repo>/bin/backslop.js`; throwaway projects start with `git init -q -b main && $BS init --lang en --tools none` unless stated otherwise. Where an ADR is cited, the path is the one at 6f6318e; the ADR consolidation cards run later in the queue.

Module: repository-state reports (lib/gates.js tree snapshot, lib/util.js `worktrees`, lib/tracks.js).

- **`gates --require-clean` and the tree snapshot are repository-wide while the path set is project-scoped** — unverified — run the check first. Observed: lib/gates.js:13 `git(root, ['status', '--porcelain'])` and :18-19 have no project-prefix filtering, unlike `changedPaths` (lib/gates.js:97-101), which strips `rev-parse --show-prefix`. With backslop.json in `pkg/` and an untracked file only in `other/`: `gates --require-clean --base HEAD~1` → rc=1 `✖ --require-clean: the tree is dirty, no gate was run:` / `?? other/b.txt`, while `gates --base HEAD~1 --json` reports `scope.prefix: "pkg/", dropped: 1, paths: ["backslop.json"]`. The gates-scope ADR (docs/adr/adr-023-gates-scope-when.md:43 at 6f6318e) states the goal of per-package acceptance in a CI matrix.
- **`tracks` lists a prunable worktree as live and merged** — unverified — run the check first. Observed: lib/util.js:62-70 parse only `worktree`, `branch`, `HEAD` lines of `git worktree list --porcelain` and drop `prunable`/`locked`; lib/tracks.js:56-69 run `git -C <deleted path> status` (exit 128) and report `dirty: null`; for a deleted worktree directory `tracks --json` gave `"merged": true, "pending": [], "dirty": null` and the text `uncommitted: could not be checked` (lib/tracks.js:109). The orchestrator removes worktrees by hand from this listing.

## Work to do

- [ ] Project scope of `--require-clean` (lib/gates.js)
    1. Blind repro: `git init -q -b main && mkdir pkg other && (cd pkg && $BS init --lang en --tools none) && echo x > other/a.txt && git add -A && git commit -qm init && node -e 'const f="pkg/backslop.json",fs=require("fs"),c=JSON.parse(fs.readFileSync(f,"utf8"));c.gates=[{command:"true",when:["src/**"]}];fs.writeFileSync(f,JSON.stringify(c,null,2)+"\n")' && git commit -qam cfg && echo y > other/b.txt && cd pkg && $BS gates --require-clean --base HEAD~1; echo rc=$?; $BS gates --base HEAD~1 --json` — expected wrong output: rc=1 with `?? other/b.txt` in the refusal, while the JSON scope has `"prefix": "pkg/"` and `"dropped": 1`.
    2. Refutation check: docs/reference/02-cli.md gates row, README.md `--require-clean` description and the gates-scope ADR (coordinate-system section): if the snapshot and `--require-clean` are stated to cover the whole repository, record the sanction and stop (add an explicit sentence if it is only implied).
    3. Fix only if confirmed: filter the snapshot through the project prefix (`git status --porcelain -- .` run from the project root, paths made project-relative like `changedPaths`), so `--require-clean` and `tree.dirty` refer to the project; test in a monorepo fixture.
- [ ] Prunable worktrees (lib/util.js, lib/tracks.js)
    1. Blind repro: `git commit -q --allow-empty -m init && git worktree add -q -b gone ../gone-wt HEAD && rm -rf ../gone-wt && git worktree list --porcelain | sed -n '/gone-wt/,/^$/p' && $BS tracks --json && $BS tracks` — expected wrong output: porcelain shows `prunable gitdir file points to non-existent location`; tracks shows the entry with `"merged": true`, `"dirty": null` and `uncommitted: could not be checked`, with no hint that the directory is gone.
    2. Refutation check: the tracks ADR (docs/adr/adr-014-tracks-observation-command.md at 6f6318e) and the `tracks --json` description in docs/reference/02-cli.md: if prunable/locked entries are declared out of scope, record the sanction and stop.
    3. Fix only if confirmed: carry `prunable` (and `locked`) from the porcelain block into the worktree record, expose it in `--json`, print `directory is gone — git worktree prune` and skip `status` for such entries; test in test/tracks.test.mjs; update the JSON description in 02-cli.md.

## Out of scope

- The verified porcelain-trim and `diff.relative` bugs — the BS-92 (`gates-tree-labels-globs`) card this card depends on.

## Verification

- For each item the result names the outcome of steps 1–2 with the command output and rc.
- Each confirmed item has a red-then-green test; a sanctioned item has a doc sentence instead of a code change.
- `npm test` → rc=0; `node bin/backslop.js lint` → rc=0.
