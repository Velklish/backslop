# BS-90 · brief: name only commands the pinned CLI version has

- **Order:** 80
- **Scope:** [02. CLI](../../reference/02-cli.md) § brief
- **Created:** 2026-09-25
- **Dependencies:** none

## Context

Line numbers below are at base commit 6f6318e (v0.11.0), where `npm test` passes 450 tests and `node bin/backslop.js lint` exits 0. `$BS` is `node <repo>/bin/backslop.js`.

One verified defect where the brief does not follow the version a project pins. It was found while checking the ADRs against the code; the BS-146 (`adr-worker-brief`) card waits for this card.

**1. Major — the brief tells workers of a v0.9.x project to run a flag their CLI rejects.** verified — reproduced on 6f6318e with a project initialised by a v0.9.0 checkout.
- `git clone <repo> $V && git -C $V checkout -q v0.9.0`; in a fresh `git init -q` directory: `node $V/bin/backslop.js init && node $V/bin/backslop.js new configs --queue` (cli becomes `npx github:Velklish/backslop#v0.9.0`); `$BS brief 1 > brief.out; echo rc=$?` → rc=0 and `grep -o 'new <slug> --parent N\[\.M\] --minor --evidence "…"' brief.out` matches (templates/brief.md:34-35, templates/en/brief.md:34-35).
- `node $V/bin/backslop.js new probe-x --parent 1 --minor --evidence 'rc=1 seen'; echo rc=$?` → rc=1 `✖ Unknown option '--evidence'`. `--evidence` arrives in v0.10.0 (`git show v0.9.0:lib/new.js | grep -c evidence` → 0; v0.10.0 lib/new.js:49 `evidence: { type: 'string' }`), and argument parsing is strict (lib/util.js:90).
- The comment lib/brief.js:12-13 and ADR-017:30 claim no command other than `gates` needs a pin check; ADR-017:15 itself says briefs are rendered by a newer CLI than the pin. The support floor is 0.9.0, so v0.9.x projects are supported consumers.

## Work to do

- Defect 1, step 1 — owner decision before code; ask with these options (recommendation first): (B) `brief` compares the cli pin with 0.10.0, the first version that has every command the brief names, and for an older pin prints a stderr note naming the command the pinned version lacks and `<cli> upgrade` as the remedy, stdout unchanged; (A) a per-command constant (`EVIDENCE_SINCE = '0.10.0'`) and a template branch that renders `--minor` without `--evidence` for older pins; (C) require the brief to be rendered by the pinned CLI and drop pin awareness from brief. Record the answer in result.md.
- Defect 1, step 2 — implement the chosen option in lib/brief.js (and templates/brief.md plus templates/en/brief.md only for option A, keeping template parity and `TEMPLATE_KEYS` in step); rewrite the comment lib/brief.js:12-13 so it no longer claims only `gates` needs checking. The BS-108 (`drop-pre-floor-version-gates`) card later deletes `GATES_SINCE` and its fallback; keep the new check independent of them.
- Defect 1, test: in test/brief.test.mjs, a project whose cli is `npx backslop@0.9.0` — assert the behaviour of the chosen option (B: rc=0, stdout identical to a 0.10.0-pinned brief, stderr names `--evidence` and `upgrade`); and a project pinned at 0.10.0 or later gets no such note.
- docs/reference/02-cli.md: in the `brief` row state the chosen pin behaviour. CHANGELOG.md: one English entry under the unreleased section for the user-visible change.

## Out of scope

- The ADR text on the brief — the BS-146 (`adr-worker-brief`) card, which depends on this card.
- Every `upgrade` fix, including pinning a floating cli — BS-84 (`upgrade-completes-pinned-consumers`).
- Any support for pins below 0.9.0.

## Verification

- Defect 1 repro above after the fix: behaviour of the chosen option (B: `$BS brief 1 > b.out 2> b.err; echo rc=$?` → rc=0, `grep -c -- '--evidence' b.err` ≥ 1, `grep -c upgrade b.err` ≥ 1).
- The new brief test fails on the base code (run it once before the fix: rc=1) and passes after (rc=0).
- `npm test; echo rc=$?` → rc=0 with the pass count; `node bin/backslop.js lint; echo rc=$?` → rc=0.
