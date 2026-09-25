# BS-167 · backslop-seed skill: true end state, scanned sources, ADR migration, no ROADMAP, one CLI

- **Order:** 850
- **Scope:** [02. CLI](../../reference/02-cli.md) § seed
- **Created:** 2026-09-25
- **Dependencies:** BS-157, BS-166, BS-98, BS-156

## Context

Evidence was taken at commit 6f6318e (v0.11.0), where `npm test` (`node --test --test-timeout=60000`) runs 450 tests, all pass, rc=0, and `node bin/backslop.js lint` exits 0. `$B` below means `node <repo>/bin/backslop.js` run inside a throwaway project (`mkdir p && cd p && git init -q && $B init --lang en ...`).

Template pairs: `templates/en/<path>` is the source and `templates/<path>` is its ru twin. Edit en first, then carry the same change into ru. `templateParity` (run by `lint`) requires the same file set, the same placeholders and the same heading shape in both layers. Tests pin literal strings of the ru layer: grep `test/` for every ru sentence you change and update the assertion in the same commit.

Files: `templates/{en/,}skills/backslop-seed/SKILL.md` and its `references/{inventory,adr-backfill}.md`, and the ADR sentence of `templates/{en/,}docs/README.md`. The skill's own section headings are "Phase 1" to "Phase 4"; they are quoted below by name. Line numbers below are from 6f6318e.

**Phase 4 promises a green lint that phase 3 makes impossible.** verified — a repro.
- Commands: `$B init --lang en --cli backslop --tools claude`; append `| [Order intake](orders-api.md) | orders | src/orders |` to docs/reference/README.md; `$B seed --queue-reference` prints "✔ BS-1: docs/backlog/queue/BS-1-describe-orders-api.md"; then `$B lint; echo rc=$?`.
- Result: rc=1, with "✖ docs/reference/README.md: broken link orders-api.md", "✖ docs/backlog/queue/BS-1-describe-orders-api.md: line 10: the [TODO] placeholder remains" (also lines 14, 18 and 22) and "✖ lint: errors 5".
- SKILL.md:57 says "`backslop lint` is green". Phase 3 step 4 forbids writing the section bodies, so the broken link cannot be fixed inside the skill.
- test/seed.test.mjs:95-103 pins the red state on purpose: "the remaining fields wait for an author and are red by lint", with `assert.match(lint.err, /lint: ошибок 5/)`.
- With two rows (`api/README.md`, `worker/README.md`) the result is the same: `seed --queue-reference` rc=0, then `lint` rc=1 with `broken link api/README.md`, `broken link worker/README.md` and four placeholder errors; the default gates list runs `lint`, so `gates` is red by construction. The resolution here is the skill text; the tool is not changed.

**`seed --scan` sources are overclaimed.** verified — a repro.
- inventory.md:5 says "`{{cli}} seed --scan`: it walks the sources of both tables below". The tables list README.md/CONTRIBUTING.md (:16), noxfile.py and Directory.Build.props analyzers (:12-13), data boundaries such as migrations, schemas and docker-compose (:24), and the entry points `main`, `cli/`, `cmd/` (:23). SKILL.md:24 gives the source column as "package manifests, Makefile, CI configuration, README".
- What the code scans (lib/seed.js:13-18, :64-112, :139-168):
  - gates: package.json scripts matching `/^(test|tests|lint|check|build|typecheck|type-check|fmt|format)$/`, Makefile/justfile/Taskfile, .github/workflows, .gitlab-ci, *.csproj/*.sln, and pyproject.toml/setup.cfg/tox.ini;
  - subsystems: src|services|apps|packages, *.csproj, the entry files Program.cs, index.ts, index.js and main.{go,py,ts,rs}, and bin/* scripts.
- Repro: a project with README ("npm run verify"), CONTRIBUTING ("make ci"), noxfile.py, Directory.Build.props (StyleCop), migrations/001.sql, docker-compose.yml, cli/index.js and cmd/tool/main.go. `$B seed --scan` exits 0 and lists these gate candidates: `npm run test` and `npm run typecheck`, both from package.json scripts. The subsystem candidates are `orders — src/orders`, `app — app/main.py`, `cli — cli/index.js` and `cmd/tool — cmd/tool/main.go`. None of README, CONTRIBUTING, noxfile, Directory.Build.props, migrations or docker-compose appears.

**Foreign ADRs cannot keep their numbers after init.** verified — a repro.
- adr-backfill.md:30 and SKILL.md:29 say to migrate foreign ADRs "while preserving numbers and dates (then backslop continues their numbering)".
- The skill runs after `init`, which has already written adr-001-process.md. Numbering sees only files that match `/^adr-(\d{3,})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/` (lib/adr.js:11).
- Repro: add `docs/adr/0001-use-pg.md`, then run `$B adr next-one`. It prints "✔ ADR-002: docs/adr/adr-002-next-one.md", ignoring the foreign file.
- Rename it to adr-001-use-pg.md, add the rows, then run `$B lint`. It gives rc=1 with "✖ docs/adr/adr-001-use-pg.md: ADR number 1 is already used by adr-001-process.md".

**[TODO] and [ASK] outside the backlog are invisible to lint.** verified — at 6f6318e, evidence below.
- lint checks `[TODO]` only in the backlog status directories, triage excepted (lib/lint.js:308-322).
- A fresh init plus `adr next-one` leaves `[TODO]` in GLOSSARY.md (1), reference/README.md (1) and the ADR stub (5), yet `lint` exits 0.
- `grep -rn '\[ASK\]' templates docs README.md AGENTS.md lib | grep -v backslop-seed` gives no output (rc=1). `[ASK]` exists only in the seed skill (SKILL.md:14, :58).
- No template says when an ADR goes from `Proposed` (adr.md:3) to `Accepted`, or that an ADR stub with `[TODO]` must not be committed.

**The skill mixes `{{cli}}` with the alias `backslop`.** verified — read (line 8 defines the alias, so the commands are runnable; the tautology appears only with `--cli backslop`).
- Line 8 reads "`{{cli}}` is called `backslop` below". With `--cli backslop` it renders as "`backslop` is called `backslop` below".
- Commands mix `{{cli}} seed --scan` (:20) and `{{cli}} seed --queue-reference` (:50) with bare `backslop adr` (:49), `backslop new` (:53), `backslop lint` and `backslop status` (:52, :57), plus adr-backfill.md:13 and :20.
- With the default npx pin, the rendered skill has 3 pinned and 5 bare command lines.
- The same decision applies to all three skills: `{{cli}}` in every runnable command, and no alias sentence.

**The reference-table example contradicts inventory.md.** verified — read (only the label conflicts). inventory.md:25 says "Name a section after the directory, not a guessed purpose", while SKILL.md:50's example is `[Order intake](orders-api.md)`. The file name is the slug source (lib/seed.js:193, `describe-${basename(href, '.md').toLowerCase()}`); the label is used only in warnings.

**adr-backfill names sections the ADR template does not have.** verified — at 6f6318e, evidence below. adr-backfill.md:25 warns against "Decision Drivers and Pros/Cons". `grep -n '^## ' templates/en/adr.md` prints Context, Options, Decision, Consequences. :17 of the same file already covers Options.

**ADR rules are restated between SKILL.md and adr-backfill.md.** verified — read (the supersede rule serves a different reader and stays in the index).
- SKILL.md:29 repeats adr-backfill.md:30 (foreign-format ADRs).
- SKILL.md:49 restates the retrospective form of adr-backfill.md:13-20 (status Accepted, the original date, the "recorded retrospectively" note) without linking there.

**The skill still mentions ROADMAP.md, which BS-157 (`remove-roadmap-from-layout`) took out of the layout.** verified — grep.
- en:3: the description trigger says "…untouched templates with `[TODO]` are present in `GLOSSARY.md`, `ROADMAP.md`, or `reference/README.md`".
- en:8: "creates a skeleton: index, glossary, roadmap, reference, first ADR, and task directories".
- en:36: survey question 2, "near-term goals and how ordering is decided — for `ROADMAP.md`".
- en:51: step 5 of the "Phase 3" section, "**`{{docs}}/ROADMAP.md`** — goals from the survey".
- The ru file has the same lines. Removing a numbered list item does not change the heading count, so templateParity stays green.

## Work to do

- `templates/{en/,}skills/backslop-seed/SKILL.md`: remove ROADMAP from the description (:3), from the skeleton list (:8, the word "roadmap"), from survey question 2 (:36) and from step 5 of the "Phase 3" section (:51). Renumber the remaining survey questions and fill steps. Do this last: the line numbers below are from 6f6318e.
- Phase 4 (:57-58): replace "`backslop lint` is green" with the real end state. After seeding, `{{cli}} lint` reports only broken links from reference/README.md to sections not written yet; everything else is green. Phase 3 step 4 must now tell the agent to fill Context, Work to do, Out of scope and Verification of every seeded `describe-<slug>` task from the inventory. Also add the check for markers outside the backlog: lint looks for `[TODO]` only under `{{docs}}/backlog`, so run `grep -rnE '\[(TODO|ASK|\?)' {{docs}}/` and report every hit.
- Phase 1: in inventory.md, mark in each table which rows `seed --scan` reads (the sources listed in the context) and which are read by eye (README, CONTRIBUTING, noxfile, analyzers, data boundaries, and a bare `cli/` or `cmd/` without an entry file). Replace "it walks the sources of both tables" to match. In SKILL.md:24, remove README from the scanned sources or mark it manual.
- Foreign ADRs: state the constraint once, in adr-backfill.md (:30). Migrated files must be renamed to `adr-NNN-<slug>.md`. After `init`, number 001 belongs to the process ADR, so migrated ADRs take the next free numbers and keep the original number in their text. Keeping the original numbers requires renumbering the process ADR first, with the owner's consent. SKILL.md:29 and :49 shrink to pointers to references/adr-backfill.md.
- adr-backfill.md:25: delete the bullet (line 17 already covers Options), or reword it against the real sections: "do not fill Options or Consequences with alternatives or effects nobody weighed".
- SKILL.md:50 example: use a directory-named label, e.g. `[orders-api](orders-api.md)`.
- `[ASK]`: keep the definition at SKILL.md:14 and include the marker in the "Phase 4" check above.
- ADR commit rule: next to the ADR-row sentence in templates/{en/,}docs/README.md, add one line: an ADR is committed with no `[TODO]` left, and its Status stays `Proposed` until the owner accepts it, then `Accepted`.
- Command spelling: use `{{cli}}` in every runnable command of the seed skill and its references, and delete the alias sentence at :8. Skill names such as `backslop-task` stay. Update any test that pins literal seed-skill commands (`grep -rn "backslop-seed" test/`).

## Out of scope

- Any lint change: exempting a reference link whose describe task exists, or a `[TODO]` gate in docs/adr/ (either needs an owner decision and an ADR).
- Changing which sources `seed --scan` reads (lib/seed.js).
- Deleting the ROADMAP templates and the migration (BS-157 (`remove-roadmap-from-layout`), done before this card).
- test/seed.test.mjs:95-103: the red lint after seeding stays the documented state.

## Verification

- Follow phase 3 step 4 as rewritten, in a fresh en project (the repro from the context, with the seeded task filled): `$B lint` reports exactly what phase 4 says, i.e. only the broken link to the unwritten section.
- Follow the new adr-backfill migration text with docs/adr/0001-use-pg.md: after the migration, `$B lint` exits 0 and `$B adr x` takes the next free number.
- `$B init --lang en --cli backslop --tools claude; grep -rn "is called" .claude/skills/backslop-seed/` finds nothing. With the default pin, `` grep -rnE '`backslop (adr|new|lint|status|init|seed)' .claude/skills/backslop-seed/ `` finds nothing.
- `npm test` exits 0 with no failing test (450 at the base commit, plus the tests this card adds); `node bin/backslop.js lint` exits 0 (templateParity and the key check stay clean).
