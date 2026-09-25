# BS-164 · Brief template: one commit rule in both languages, aligned wording, a no-push line

- **Order:** 820
- **Scope:** [02. CLI](../../reference/02-cli.md) § brief
- **Created:** 2026-09-25
- **Dependencies:** BS-163, BS-90

## Context

Evidence was taken at commit 6f6318e (v0.11.0), where `npm test` (`node --test --test-timeout=60000`) runs 450 tests, all pass, rc=0, and `node bin/backslop.js lint` exits 0. `$B` below means `node <repo>/bin/backslop.js` run inside a throwaway project (`mkdir p && cd p && git init -q && $B init --lang en ...`).

Template pairs: `templates/en/<path>` is the source and `templates/<path>` is its ru twin. Edit en first, then carry the same change into ru. `templateParity` (run by `lint`) requires the same file set, the same placeholders and the same heading shape in both layers. Tests pin literal strings of the ru layer: grep `test/` for every ru sentence you change and update the assertion in the same commit.

File: `templates/{en/,}brief.md` (the worker brief). The major-route sentence at brief.md:35 was aligned with the block by BS-163 (`agents-block-wording`).

**The brief's commit rule differs between en and ru.** verified — quotes. en brief.md:33 says "one commit per task, prefixed `{{prefix}}-N:` — including review fixes and your task's CHANGELOG entry". ru :33 says "коммиты по задаче" (commits per task). The en wording contradicts itself, because review fixes arrive after the first commit. It also conflicts with backslop-task SKILL.md:32 (review fixes are intermediate commits squashed at closure) and with backslop-batch SKILL.md:103 ("integrate by task when worker commits are separable by prefix").

**Other ru/en wording drift in the brief.** verified — read (the meaning is recoverable from context). ru brief.md:34 says "между каталогами и `archive`", where en says "between status directories or `archive/`". ru :35 says "в чужих файлах", where en says "in another track's files".

**The brief lacks the push ban and the owner rule.** verified — read (brief.md:3 already covers the main tree). `$B brief 1 2 --track "Parser cleanup" --measurements > b.out; grep -niE "push|owner|main tree" b.out` gives rc=1, no match. backslop-batch SKILL.md:40, :64 and :67 list both rules as worker requirements.

## Work to do

- brief.md:33 en: "commits per task, each prefixed `{{prefix}}-N:` — including review fixes and your task's CHANGELOG entry". Carry the same meaning into ru, which already has it.
- brief.md:34-35 ru: align the wording to en: "между каталогами статусов и в `archive/`" and "в файлах чужого track'а".
- brief.md, both languages: add one fixed line under "How to work": "Do not push. Decision points go to the orchestrator, never to the owner directly."
- Tests: update the ru strings pinned in test/brief.test.mjs:45-56 (the seven fixed bullets) and anything else `grep -rn` finds for the sentences you changed.
- CHANGELOG, Unreleased section: the brief gains the no-push / no-owner-contact line and states one commit rule in both languages.

## Out of scope

- The AGENTS block wording — BS-163 (`agents-block-wording`).
- Mutation-probe sentences of the brief (brief.md:36, :40) — BS-165 (`probe-text-opt-in`).

## Verification

- `$B new t --queue --title T; $B brief 1 --track x | grep -niE "push|owner"` matches the new line in an en project; in a ru project the Russian twin of the line is present.
- `grep -n 'one commit per task' templates/en/brief.md; echo rc=$?` → rc=1, and the ru and en commit bullets say the same (commits per task, each prefixed).
- `npm test` exits 0 with no failing test (450 at the base commit, plus the tests this card adds); `node bin/backslop.js lint` exits 0 (templateParity and the key check stay clean).
