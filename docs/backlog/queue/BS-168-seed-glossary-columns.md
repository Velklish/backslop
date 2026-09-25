# BS-168 · Glossary templates: distinct Term and EN columns, one home for the glossary rules

- **Order:** 860
- **Scope:** [01. Layout](../../reference/01-layout.md) § Templates
- **Created:** 2026-09-25
- **Dependencies:** BS-167

## Context

Evidence was taken at commit 6f6318e (v0.11.0), where `npm test` (`node --test --test-timeout=60000`) runs 450 tests, all pass, rc=0, and `node bin/backslop.js lint` exits 0. `$B` below means `node <repo>/bin/backslop.js` run inside a throwaway project (`mkdir p && cd p && git init -q && $B init --lang en ...`).

Template pairs: `templates/en/<path>` is the source and `templates/<path>` is its ru twin. Edit en first, then carry the same change into ru. `templateParity` (run by `lint`) requires the same file set, the same placeholders and the same heading shape in both layers. Tests pin literal strings of the ru layer: grep `test/` for every ru sentence you change and update the assertion in the same commit.

Files: `templates/{en/,}docs/GLOSSARY.md` and `templates/{en/,}skills/backslop-seed/references/glossary.md`.

**The glossary columns overlap in English.** verified — at 6f6318e, evidence below.
- The en GLOSSARY.md:5 says "The “Term” column gives the spelling for prose; EN is the name in code and English text". glossary.md:25-26 says the same. In an English project both columns then claim English prose, and the only example row (glossary.md:22) is `| request | request | …`.
- The ru layer separates the columns by language, and ru glossary.md:25 adds a ru-only declension rule (worker'ы, track'а).
- templateParity compares only placeholders and headings, so it cannot see this.

**Glossary rules are restated too.** verified — at 6f6318e, evidence below. glossary.md:28-29 restates the `[?]` rule of GLOSSARY.md:5. glossary.md:41 ("propose a row rather than silently inventing it") repeats the rule that the AGENTS.md block owns (agents-section.md:11).

## Work to do

- Glossary, en first: in templates/en/docs/GLOSSARY.md:5 and glossary.md:25-26, define “Term” as the spelling in project prose and EN as the identifier in code only (drop "and English text"). Use an example row where the two differ, e.g. `booking | Reservation`. Keep the ru declension sentence as a ru-only addition (parity checks only headings and placeholders). In glossary.md, link GLOSSARY.md for the column and `[?]` rules instead of restating them (:28-29), and delete :41, since the AGENTS.md block owns that rule.
- Tests: grep `test/` for the glossary sentences you change (ru layer) and update them in the same commit.

## Out of scope

- Other backslop-seed skill fixes — BS-167 (`backslop-seed-skill-fixes`).
- The glossary of this repository (docs/GLOSSARY.md) — BS-174 (`docs-index-glossary-english`).

## Verification

- `$B init --lang en --tools claude`: in docs/GLOSSARY.md the column rule defines “Term” as the spelling in project prose and EN as the identifier in code, and the example row has two different spellings; `grep -n "and English text" docs/GLOSSARY.md .claude/skills/backslop-seed/references/glossary.md; echo rc=$?` → rc=1.
- `npm test` exits 0 with no failing test; `node bin/backslop.js lint` exits 0 (templateParity and the key check stay clean).
