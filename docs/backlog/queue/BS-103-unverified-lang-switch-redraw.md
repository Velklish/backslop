# BS-103 · Check and fix: changing `lang` does not redraw the tool-owned rules pair

- **Order:** 210
- **Scope:** [01. Layout](../../reference/01-layout.md) § backslop.json
- **Created:** 2026-09-25
- **Dependencies:** BS-85, BS-84

## Context

Every item in this card is **unverified — run the check first**. The behaviour was observed once on 6f6318e; it has not been reproduced independently, and nobody has checked yet whether a doc, ADR or test sanctions it. Work each item in order: (1) reproduce blind in a throwaway project with the exact commands, (2) look for a doc, ADR or test that sanctions the behaviour, (3) fix only if (1) reproduces and (2) finds no sanction. Record the outcome of each step in the result (reproduced / not reproduced / sanctioned by <file:line>). Line numbers refer to base commit 6f6318e (v0.11.0). `$BS` is `node <repo>/bin/backslop.js`; throwaway projects start with `git init -q -b main && $BS init --lang en --tools none` unless stated otherwise. Where an ADR is cited, the path is the one at 6f6318e; the ADR consolidation cards run later in the queue.

Module: tool-owned rules redraw (lib/migrate.js `planRules` and `RULES_DOCS`, lib/init.js skeleton loop).

- **Switching `lang` leaves the rules pair in the old language** — unverified — run the check first (the behaviour was observed; whether it is a bug is not settled). Observed in a fresh project: `init --tools none`, commit, set `"lang": "en"` in backslop.json. Then `node <repo>/bin/backslop.js init` gave rc=0 with `files created 0, left unchanged 9`, and `node <repo>/bin/backslop.js migrate` gave rc=0 with `nothing to migrate: file format did not change from v0.11.0 through v0.11.0`. After both, `head -1 docs/archive/README.md` still printed `# Архив закрытых задач`, line 3 of docs/backlog/README.md was still Russian, and `lint` gave rc=0. `migrate` redraws `RULES_DOCS = ['backlog/README.md', 'archive/README.md']` (lib/migrate.js:43) only when the stamp is below the tool version (lib/migrate.js:82); `init` never overwrites an existing skeleton file (lib/init.js:131-143). This repository switched to `lang: en` in the commit that filed this card, so its own copies are affected; the BS-162 (`backlog-archive-rules-english`) card re-renders them.

## Work to do

- [ ] Lang switch and the rules pair (lib/migrate.js, lib/init.js)
    1. Blind repro: `git init -q -b main && $BS init --tools none && git add -A && git commit -qm init && node -e 'const f="backslop.json",fs=require("fs"),c=JSON.parse(fs.readFileSync(f,"utf8"));c.lang="en";fs.writeFileSync(f,JSON.stringify(c,null,2)+"\n")' && $BS init; echo rc=$?; $BS migrate; echo rc=$?; head -1 docs/archive/README.md; $BS lint; echo rc=$?` — expected wrong output: init `left unchanged`, migrate `nothing to migrate`, the Russian title `# Архив закрытых задач`, lint rc=0.
    2. Refutation check: the localization ADR (docs/adr/adr-005-localization.md at 6f6318e: "a lang change does not translate existing docs"), docs/reference/01-layout.md (tool-owned rules and the `lang` row), README.md's `lang` text, test/init.test.mjs and the migrate tests in test/upgrade.test.mjs. If any of them says the pair changes language only at the next version bump, record the sanction, add that sentence to the `lang` row of 01-layout.md, and stop.
    3. Fix only if confirmed: make `migrate` (or `init`, whichever the docs name as the step after a config edit) redraw `RULES_DOCS` whenever the render in `cfg.lang` differs from the file, even when the stamp equals the tool version, keeping the uncommitted-edit refusal and the symlink skip of `planRules`. Test: a ru project switched to en has both files equal to the en render after the command.

## Out of scope

- Re-rendering this repository's docs/backlog/README.md, docs/archive/README.md and the LOG.md header — the BS-162 (`backlog-archive-rules-english`) card.
- Redrawing the LOG.md header in consumer projects (its body is data).

## Verification

- The result names the outcome of steps 1–2 with the command output and rc.
- If confirmed, a red-then-green test in test/upgrade.test.mjs (or test/init.test.mjs); if sanctioned, the 01-layout sentence and no code change.
- `npm test` → rc=0; `node bin/backslop.js lint` → rc=0.
