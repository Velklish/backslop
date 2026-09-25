# BS-157 · Remove ROADMAP.md from the layout; migrate deletes only an untouched consumer copy

- **Order:** 750
- **Scope:** [01. Layout](../../reference/01-layout.md) § What init lays down
- **Created:** 2026-09-25
- **Dependencies:** BS-108, BS-152, BS-85, BS-118, BS-84

## Context

Evidence was taken at commit 6f6318e (v0.11.0), where `npm test` (`node --test --test-timeout=60000`) runs 450 tests, all pass, rc=0, and `node bin/backslop.js lint` exits 0. `$B` below means `node <repo>/bin/backslop.js` run inside a throwaway project (`mkdir p && cd p && git init -q && $B init --lang en ...`).

Template pairs: `templates/en/<path>` is the source and `templates/<path>` is its ru twin. Edit en first, then carry the same change into ru. `templateParity` (run by `lint`) requires the same file set, the same placeholders and the same heading shape in both layers. Tests pin literal strings of the ru layer: grep `test/` for every ru sentence you change and update the assertion in the same commit.

The owner decided that `docs/ROADMAP.md` leaves this repository and the tool layout. Templates in both languages go, `init` stops creating the file, and `migrate` deletes a consumer copy only while it still equals the rendered template. This changes the layout contract, so the card also adds a new ADR.

**1. Where the file comes from.** verified — grep and a clone run.
- `grep -rln -i roadmap templates/` lists `templates/docs/README.md`, `templates/docs/backlog/README.md`, `templates/docs/ROADMAP.md`, `templates/skills/backslop-seed/SKILL.md` and the four `templates/en/` twins.
- `init` lays out every `.md` under `templates/<lang>/docs` (lib/init.js:131-141, `srcFiles(docsTemplates, '', ['.md'])`). `grep -n -i roadmap lib/links.js lib/init.js lib/migrate.js lib/seed.js` gives rc=1, so `init` needs no code change.
- A clone run deleted both ROADMAP templates and removed the ROADMAP clauses from both `docs/README.md` and both `backlog/README.md` templates. The full suite then gave `tests 450, pass 449, fail 1`. The only failure was test/init.test.mjs:33 (`нет docs/ROADMAP.md`), because the EXPECTED list at :20-22 still names the file. Repo lint stayed at rc=0.

**2. A consumer upgrade breaks unless a migration handles the old copy.** verified — a live repro in a fresh v0.11.0 en project: `$B init --lang en; git add -A; git commit -qm s; rm docs/ROADMAP.md; $B lint; echo rc=$?`:
```
✖ docs/README.md: broken link ROADMAP.md
✖ docs/README.md: broken link ROADMAP.md
✖ docs/backlog/README.md: broken link ../ROADMAP.md
✖ lint: errors 3
rc=1
```
- `migrate` redraws `docs/backlog/README.md` (lib/migrate.js:43, `RULES_DOCS = ['backlog/README.md', 'archive/README.md']`), so that link disappears once the template drops it.
- `docs/README.md` belongs to the project and is never redrawn. It links ROADMAP.md twice: in the line-3 sentence ("for project direction, see `[ROADMAP.md](ROADMAP.md)`") and in the line-9 table row `| [ROADMAP.md](ROADMAP.md) | Direction and goals; tasks are in the backlog | Living |`.
- `migrate` cannot delete files. `grep -n 'unlink\|rmSync' lib/migrate.js` gives rc=1, and MIGRATIONS (migrate.js:16-39) only create files. `planRules` compares with a strict `===` and does not normalize CRLF (migrate.js:53).
- The rendered ROADMAP.md contains `{{project}}` and the pinned `{{cli}}`. Line 3 reads "… are in `npx github:Velklish/backslop#v0.11.0 status` …".
- Which pin the copy carries when the new `migrate` runs depends on the path. At 6f6318e a normal `upgrade` rewrites the pins in prose (`rewriteProsePins`, lib/upgrade.js:48-58, over `livePinFiles`, which includes docs markdown) before it runs `<new cli> migrate` (lib/upgrade.js:152-167), so the copy carries `cfg.cli`; BS-84 (`upgrade-completes-pinned-consumers`) moves that rewrite after `migrate` and `init`, so with a new release the copy still carries the old pin when `migrate` compares it; `upgrade --pin-only` skips the prose rewrite and the user runs `migrate` by hand. The comparison therefore has to ignore which version the pin names.
- The ROADMAP template text has not changed since v0.9.0: `git show v0.9.0:templates/docs/ROADMAP.md | shasum` starts with d442c898 (ru) and the en file with 86e9c05d. One frozen text per language therefore covers every supported consumer, since there are no consumers below 0.9.0.

**3. Tests.** verified — at 6f6318e, evidence below. `git grep -c -E 'docs/ROADMAP' -- test` gives archive 4, commands 7, fold 6, init 1, lint 5, upgrade 2.
- test/init.test.mjs:22 lists the file in EXPECTED.
- test/commands.test.mjs:1247-1248 puts a stub (`put(root, 'docs/ROADMAP.md', '# Roadmap\n')`) only because the redrawn backlog README links `../ROADMAP.md`. At the base commit, deleting the stub fails the test `migrate до v0.9.0 создаёт…` (0/1). After the template change it passes (1/1).
- The other 23 uses create `docs/ROADMAP.md` themselves as an arbitrary file to link to. They do not depend on the template.

**4. Repo docs and code comments that list ROADMAP as part of the layout.** verified — grep.
- docs/reference/01-layout.md:11 (layout tree) and :32 (the rest of the skeleton list)
- AGENTS.md:5
- docs/README.md:3 and :9, and docs/ROADMAP.md itself
- docs/backlog/README.md:3, the repo render that test/templates.test.mjs:141-149 keeps identical to the template
- docs/adr/adr-032-tool-owned-rules-redrawn-by-migrate.md:40 (skeleton list)
- two comments: lib/lint.js:466-467 ("…would give `ROADMAP.md` instead of `docs/ROADMAP.md`") and lib/mv.js:186-187 ("…a link from roadmap or a neighbouring task…")

## Work to do

- Templates, en first and then ru: delete `templates/en/docs/ROADMAP.md` and `templates/docs/ROADMAP.md`. In `templates/{en/,}docs/README.md`, drop the ROADMAP clause from line 3 and the ROADMAP table row (line 9). In `templates/{en/,}docs/backlog/README.md:3`, drop "For overall project direction, see `[ROADMAP.md](../ROADMAP.md)`;" and keep the archive link.
- lib/migrate.js: add a MIGRATIONS entry with `since` set to the next release version and a `{ en, ru }` title such as "docs/ROADMAP.md leaves the layout". It must: (a) keep the frozen v0.9.0–v0.11.0 ROADMAP text for ru and en, plus the old rendered docs/README.md line 3 and line 9, as constants in lib/ (the template files are gone); (b) render them with `{ project: projectName(root), cli: cfg.cli }` for `cfg.lang`; (c) compare after normalizing `\r\n` to `\n` and every pin occurrence (`pinRe(parseCli(cfg.cli))`, any version) to the current cli pin on both sides, as BS-84 (`upgrade-completes-pinned-consumers`) does for the rules pair in `planRules`; (d) delete `docs/ROADMAP.md` only if it equals the render and no markdown file links it apart from the two old docs/README.md lines; (e) replace line 3 with the new rendered line 3 and drop the line-9 row, but only for a line that equals its old rendered form; (f) refuse on an uncommitted edit of either file and skip paths through a symlink, the way `planRules` does (migrate.js:47-70); (g) in every other case keep the files and warn, naming ROADMAP.md and every file that links it, e.g. "kept: differs from the template or is still linked — delete it yourself or keep it as project content". With `--dry-run` it only prints what it would do.
- New ADR: `node bin/backslop.js adr roadmap-leaves-layout --title "ROADMAP.md is not part of the layout"`, then add its row to docs/README.md, which lint requires. Follow the ADR conventions of the consolidation cards: Status `Accepted`, the Date you write it, Deciders `Velklish`; no task numbers, no old ADR numbers, no dated owner-decision note, and do not invent a rationale the owner did not give. Context: the tool layout no longer includes a roadmap file, and the mechanics above (the project-owned docs/README.md and the redrawn backlog README). Options: keep the file; drop only the templates (consumer lint turns red, as in the repro); drop the templates and add the delete-if-unchanged migration. Decision: the third. Consequences: an edited copy stays as project content, and the migration runs once per stamp.
- adr-032 is gone (the BS-152 (`adr-pin-upgrade-migrate`) card replaced it). If the consolidated version-pin/upgrade/migrate ADR lists ROADMAP.md in the skeleton, remove it from that list.
- Repo docs: delete docs/ROADMAP.md and its two links in docs/README.md (:3, :9). Re-render docs/backlog/README.md from the ru template `templates/docs/backlog/README.md` with this repo's values (`renderTemplate('docs/backlog/README.md', { … })`, the call test/templates.test.mjs:141-149 makes): that test compares the copy byte for byte with the ru layer until BS-162 (`backlog-archive-rules-english`) switches it to the `lang` layer. Do not use `migrate` or `init` for this: backslop.json already says `lang: en`, so they render the en layer and the test turns red. Drop ROADMAP.md from AGENTS.md:5 and from docs/reference/01-layout.md:11 and :32. In 01-layout, state that `init` no longer creates the file and what `migrate` does with an old copy.
- Code comments: in lib/lint.js:466-467 and lib/mv.js:186-187, replace the ROADMAP example with a neutral one (`docs/GLOSSARY.md`, "the docs index").
- Tests: remove `'docs/ROADMAP.md'` from EXPECTED in test/init.test.mjs:20-22 and assert that `init` does not create it. The stub at test/commands.test.mjs:1247-1248 went away with the pre-0.9.0 migration test (BS-108 (`drop-pre-floor-version-gates`)); check that no other test puts a ROADMAP stub only to satisfy the backlog README link. Leave the other `docs/ROADMAP.md` fixtures in the archive, commands, fold, lint and upgrade tests: they create the file as an arbitrary link target and do not depend on the layout.
- CHANGELOG, Unreleased section: `init` no longer creates docs/ROADMAP.md. `upgrade`/`migrate` deletes an untouched copy together with its two docs/README.md links, and keeps an edited or still-linked copy with a warning.

## Out of scope

- Other backslop-seed fixes: the lint promise of the skill's "Phase 4" section, the `seed --scan` source lists, ADR backfill and glossary rules (the BS-167 (`backslop-seed-skill-fixes`) card).
- Other docs/README.md template changes: the principles list, the ADR row and the archive row (the BS-166 (`docs-skeleton-adr001-index`) card).
- Rewriting other consolidated ADRs beyond the skeleton list.
- Dropping README.ru.md and compressing the CHANGELOG.
- Any lint gate for `[TODO]` outside the backlog.
- The ROADMAP lines of the backslop-seed skill — BS-167 (`backslop-seed-skill-fixes`), which depends on this card.
- Renaming the `docs/ROADMAP.md` link-target fixtures in tests.

## Verification

- `grep -rln -i roadmap templates AGENTS.md docs/reference docs/README.md docs/backlog; echo rc=$?` lists only `templates/{en/,}skills/backslop-seed/SKILL.md` (BS-167 (`backslop-seed-skill-fixes`) removes those lines); `grep -rn -i roadmap lib` shows only the frozen constants of the new migration.
- Fresh `init --lang en` and `init --lang ru` in throwaway projects: no docs/ROADMAP.md, and `lint` exits 0.
- New migrate tests, for ru and for en, in a project that has the v0.11.0 layout: write the frozen ROADMAP.md, the old docs/README.md lines and stamp 0.11.0, then commit. (1) An untouched copy: `migrate` deletes ROADMAP.md and the two docs/README.md links, then `lint` exits 0. (2) An edited ROADMAP.md: kept, the warning names it, docs/README.md is untouched, `lint` exits 0. (3) A CRLF copy: deleted. (4) A pristine copy that another doc also links: kept, and the warning names the linking file. (5) An uncommitted edit: refused with rc=1 and nothing written. (6) `--dry-run`: nothing deleted. (7) `upgrade --pin-only` followed by `migrate`, with the old pin still in the prose: deleted (pins are normalized). (8) A normal `upgrade` from an old pin with the new release order (migrate before the prose rewrite): deleted.
- `npm test` exits 0 with no failing test (450 at the base commit, plus the tests this card adds); `node bin/backslop.js lint` exits 0 (templateParity and the key check stay clean).
