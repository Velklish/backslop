# BS-166 · Trim the ADR-001 and docs index templates to what the tool-owned READMEs do not say

- **Order:** 840
- **Scope:** [01. Layout](../../reference/01-layout.md) § ADR
- **Created:** 2026-09-25
- **Dependencies:** BS-157

## Context

Evidence was taken at commit 6f6318e (v0.11.0), where `npm test` (`node --test --test-timeout=60000`) runs 450 tests, all pass, rc=0, and `node bin/backslop.js lint` exits 0. `$B` below means `node <repo>/bin/backslop.js` run inside a throwaway project (`mkdir p && cd p && git init -q && $B init --lang en ...`).

Template pairs: `templates/en/<path>` is the source and `templates/<path>` is its ru twin. Edit en first, then carry the same change into ru. `templateParity` (run by `lint`) requires the same file set, the same placeholders and the same heading shape in both layers. Tests pin literal strings of the ru layer: grep `test/` for every ru sentence you change and update the assertion in the same commit.

Files: `templates/{en/,}docs/adr/adr-001-process.md` (the process ADR that `init` writes) and `templates/{en/,}docs/README.md` (the docs index). Both are written once by `init` and belong to the project afterwards. `migrate` redraws only `RULES_DOCS = ['backlog/README.md', 'archive/README.md']` (lib/migrate.js:43). So whatever these two templates restate from the tool-owned files freezes at init and drifts, while the AGENTS.md block is re-rendered by `init` on every upgrade (init.js:124,160).

**ADR-001 and the index describe closed tasks as archive directories.** verified — a repro.
- adr-001 en/ru :15: "closed tasks live in `{{docs}}/archive/<id>-<slug>/` with `task.md` and `result.md`". The en index row at :11: "| `[archive/](archive/README.md)` | Closed tasks: task definition and result in separate files | Living |".
- Step 5 of the procedure runs `fold`, which removes the directory (lib/fold.js:363, `rmSync(e.dir, { recursive: true, force: true })`).
- Repro: `$B new alpha --queue --title Alpha; git add -A; git commit -qm a; $B archive 1`, write result.md with "Completed: did alpha.", then `$B fold 1 > ../draft.txt; echo rc=$?; ls docs/archive`. It gives rc=0 and lists `LOG.md README.md`. LOG.md gains the line "- <a id=\"bs-1\"></a>`BS-1-alpha` · <date> · completed · — · Alpha".

**ADR-001 restates the layout that the tool-owned READMEs own.** verified — a side-by-side read.
- The Decision bullets :15-16 restate the backlog and archive layout. The tool-owned archive/README.md:11-15 makes the LOG.md fold the normal form, and adr-001 has already drifted from it.
- Consequences :25 ("There is no task list in git — `{{cli}} status` provides the summary; opening the backlog README to see the queue is pointless.") repeats backlog/README.md:3 ("There is no task list here — `{{cli}} status` prints it.").

**ADR-001 points to skills a default project does not have.** verified — at 6f6318e, evidence below. adr-001 :18 names `backslop-task`, `backslop-batch` and `backslop-seed` without qualification. A default `$B init --lang en` prints "adapter outputs: none", backslop.json has `"tools": []`, and no `.claude`, `.cursor` or `.agents` directory exists. agents-section.md:6 already qualifies them: "Skills (when an adapter is selected)".

**ADR-001's gates sentence is imprecise.** verified — read (imprecise, not false). adr-001 :19 says "gates are `{{cli}} lint` plus `gates` from `backslop.json`". But `init` writes `gates: [`${cli} lint`]` (lib/init.js:79), and lib/gates.js has no lint of its own (`grep -n lint lib/gates.js` gives rc=1). The sentence also never names the `{{cli}} gates` runner. Lint must still be green on the final commit, independently of `gates`.

**The index principles restate the block.** verified — quotes. Principles 1 (:16) and 3 (:18) and the ADR sentence (:21) of the index template restate agents-section.md:11-12. They also appear in task SKILL:24-25, brief.md:29 and lib/adr.js:37. ru and en already drift at :18: ru has "предложи владельцу", en has no addressee. Principles 2 (supersede, do not edit) and 4 (evidence over intuition) are not in the block. seed SKILL:47 describes the index principles as "owner-provided", yet the template pre-fills four tool rules.

**The init hint repeats the ADR row as a second literal.** verified — read (cosmetic). lib/init.js:169-170 hard-codes "| `[adrRel](adrRel)` | Tasks and decisions are managed with backslop | Accepted |", which templates/*/docs/README.md:12 also carries. Lint only checks that each ADR is linked (lib/lint.js:569), so drift would only change the hint text. test/init.test.mjs:551 matches only the ru prefix "docs/README.md уже был: добавь в таблицу строку".

## Work to do

- adr-001 template, en first and then ru, keeping the same headings: Context stays. The Decision becomes short: tasks and decisions are managed with backslop, and the tool version is pinned in backslop.json (`cli` with a tag and the `version` stamp; update with `{{cli}} upgrade`). For the mechanics, link `{{docs}}/backlog/README.md`, `{{docs}}/archive/README.md` and the backslop section of AGENTS.md. Delete the layout bullets (:15-19). If a bullet has to stay, make it true: closed tasks fold into `{{docs}}/archive/LOG.md`; the skills exist only when an adapter is selected; gates are the commands in `gates` of backslop.json, `init` puts `{{cli}} lint` first, and `{{cli}} gates` runs them. Delete Consequences :25.
- docs/README.md template, en first and then ru: the archive row (:11) says what the folder holds after folding (the LOG.md journal plus not-yet-folded directories), or just links archive/README.md. Delete principles 1 and 3, which the AGENTS.md block owns, and renumber 2 and 4. Keep the ADR-row sentence (:21) as one line.
- lib/init.js:169-170: shorten the hint so it does not repeat the row text, e.g. "add a row linking <adrRel> to its table, otherwise lint fails", in both languages. Update test/init.test.mjs:551 if the ru prefix changes.
- Tests: grep `test/` for the adr-001 and index sentences you change (e.g. test/init.test.mjs:507-508 does a `replace` on the rendered index row; :567 checks the ADR title) and keep them consistent. The ADR title stays.

## Out of scope

- Consumer copies of ADR-001 and docs/README.md: they belong to the project, and no migration touches them.
- The ROADMAP links in the index (the BS-157 (`remove-roadmap-from-layout`) card, which this card depends on).
- The ADR stub template adr.md, and the rule for committing ADR stubs and flipping their Status (BS-167 (`backslop-seed-skill-fixes`)).

## Verification

- Fresh `$B init --lang en` and `--lang ru`: `lint` exits 0. `grep -n "archive/<id>" docs/adr/adr-*-process.md` finds nothing. `grep -ci "propose" docs/README.md` prints 0 (en).
- Repeat the fold repro from the context: the ADR and the index no longer describe a directory that `fold` removes.
- Pre-create docs/README.md, then run `$B init --lang en`: the hint names the process ADR path, and `lint` is red until the row is added.
- `npm test` exits 0 with no failing test (450 at the base commit, plus the tests this card adds); `node bin/backslop.js lint` exits 0 (templateParity and the key check stay clean).
