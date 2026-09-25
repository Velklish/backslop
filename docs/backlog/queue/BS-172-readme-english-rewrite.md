# BS-172 · Rewrite README.md as the only README: all commands, init defaults, README.ru.md dropped

- **Order:** 900
- **Scope:** [Reference](../../reference/README.md)
- **Created:** 2026-09-25
- **Dependencies:** BS-158, BS-159, BS-160, BS-121, BS-122

## Context

`README.md` becomes the only README. `README.ru.md` is dropped, and the README must list every shipped command, state the `init` defaults, and describe the fold step. It must also stop carrying reference-grade detail that `docs/reference/` owns (BS-176 (`orchestrator-contract-reference`) and BS-177 (`lib-module-map-reference`) add the links to their pages).

Order: land after the card that translates `docs/reference/` into English. This card moves README detail into the reference, and for English readers the README is the only English copy until the reference is translated.

Evidence. Every item is verified at v0.11.0 (commit 6f6318e):

1. **The command table is incomplete.** verified — comparing the table with `COMMANDS` and running `grep -n -i -E "fold|show|brief|tracks|merge-changelog|LOG\.md|seed|--range" README.md`, which matches only "briefs", the skill name `backslop-seed` and "brief". `COMMANDS` (`bin/backslop.js:11`) has 17 names. The table (`README.md:49-62`) has no `fold`, `show`, `brief`, `seed`, `tracks` or `merge-changelog`. The `archive` row (`:54`) lacks `--range <base>..HEAD`, which `HELP_EN` (`:81`) documents. `README.md:17` says closed tasks move to `archive/` as `task.md` + `result.md` and never mentions `archive/LOG.md`. The closure flow at `:82` leaves out the `fold` step that `templates/en/agents-section.md:14` requires.
2. **The default `lang` is not stated.** verified — at 6f6318e, evidence below. A plain `init` in an empty git repo wrote `"lang": "ru"` and a Russian `docs/backlog/README.md` (rc=0). The default comes from `lib/config.js:33` and `:101`. The quick start (`README.md:6`) has no `--lang`, and `:43`/`:51` list `--lang ru|en` without a default. Only the Russian `01-layout.md:47` states it.
3. **Deleting `README.ru.md` has hidden couplings.** verified — in a clone:
   - `git rm README.ru.md` alone → `node bin/backslop.js lint` rc=1, with two broken links from `README.md:11` and `:109`.
   - `node --test test/release.test.mjs` then still gives rc=0 (11/11): `npm pack` skips the missing file, so the stale `package.json:14` entry goes unnoticed — the tarball test does not check that every `files` entry exists.
   - Removing that entry as well → rc=1, 10 pass / 1 fail (`packed tarball matches files…`), until `REQUIRED` in `test/release.test.mjs:243` changes too.

   The other sites that name the file:
   - `lib/lint.js:35` `RELEASE_PIN_FILES`, the prose-pin files of gate 11. A missing file is skipped by `existsSync` at `:107`.
   - `docs/reference/02-cli.md:47`, the list of packed files.
   - `docs/reference/03-lint.md:17`, the gate 11 row.
4. **The npm description is Russian.** verified — `sed -n 4p package.json` shows a Russian description, while `README.md:3` has the English tagline. No test reads the description.
5. **The `.gitignore` claim is wrong after `--tools none`.** verified — `init --tools claude,cursor,codex` followed by `init --tools none` leaves `.gitignore` with a block of `# backslop:start`, `# no adapters selected — nothing is generated` and `# backslop:end`. A fresh `init` creates no `.gitignore`. `README.md:43` says a project with no adapters gets no `.gitignore`.
6. **The help line for `show`** is fixed by BS-121 (`strict-command-argv`), which owns both help literals.
7. **The README misstates the `prefix` check.** verified — `README.md:33` says `prefix` shares one check with `docs`, `cli` and `probe`. `validateBlockValue` is called only for `docs` (`lib/config.js:119`), `cli` (`:121`), `probe` (`:189`) and in `init.js:76-77`. `prefix` is checked only by `PREFIX_RE = /^[A-Z][A-Z0-9]{1,5}$/` (`:38`). `01-layout.md:53` states the rule correctly.
8. **Reference-grade detail is duplicated in the README.** verified — word counts: `:33` = 149, `:35` = 120, `:53` = 156, `:61` = 67, `:62` = 176, `:74` = 215. The same content lives in `01-layout.md`, `02-cli.md` and `03-lint.md`.
9. **The worker boundary is stated twice.** verified — `README.md:82` and `:85` both say the worker files a new finding with `new --parent N[.M]` on its branch and does not edit an existing card. Keep `:85`, which also carries the `--minor --evidence` form.
10. **The seed hint ignores missing adapters.** The code half (`lib/init.js:197-199` prints the hint unconditionally) is fixed by BS-122 (`init-flag-validation-messages`); `README.md:45` still names the skill without the adapter condition, while `:31` and `:93` state it.
11. **`upgrade --dry-run` does not preview migrations.** verified — on a v0.9.0 consumer: `upgrade --dry-run` gives rc=0 and a generic plan, returning before `migrate` (`lib/upgrade.js:139-141`). Only `<new cli> migrate --dry-run` shows `migration through v0.10.0: closed task journal docs/archive/LOG.md (--dry-run)` and `tracking and archive rules from the v0.11.0 template: would rewrite docs/backlog/README.md, docs/archive/README.md (--dry-run)`.
12. **No post-upgrade checklist.** verified — at 6f6318e, evidence below. After `migrate` and `init` of v0.11.0 on a v0.9.0 consumer with one archived task, `git status --short` shows `M AGENTS.md`, `M backslop.json`, `M docs/archive/README.md`, `M docs/backlog/README.md` and `?? docs/archive/LOG.md`. `lint` then gives rc=1 with `result.md names no outcome word…` for a `result.md` that v0.9.0 accepted. The old archive directories stay unfolded (`lib/migrate.js:30`). Parts of this appear in CHANGELOG v0.10.0 entries, which `upgrade` prints; README Updating mentions none of it.
13. **Two lines imply a future npm release.** verified — `README.md:64` ("Before publishing to npm the command is long") and `:95` ("Publishing to npm is prepared (`npx backslop@X.Y.Z` pins work; `npm run release`)") suggest the tool will be published to npm. The tool is not published to npm. `upgrade` prints the tool's own CHANGELOG between the two versions (`lib/upgrade.js:164`).

## Work to do

- Rewrite `README.md` in English as the single README: tagline; quick start `npx github:Velklish/backslop init --lang en` with one line saying the default `lang` is `ru`; "What it is" including that closed tasks are later folded into one line of `docs/archive/LOG.md` (`fold N`, body kept in git history, read back with `show N`); "What appears" with the `backslop.json` field list including `source`, linking the field table in `docs/reference/01-layout.md`.
- Commands table: one row per `COMMANDS` entry (17 names; `version`/`help` may share a row), a one-line purpose each, signatures matching `HELP_EN`, including `archive <N> [--dry-run] [--range <base>..HEAD]`; edge cases (the `mv`, `lint`, `gates` cells, probe and `agents.stepOverrides` paragraphs, evidence item 8) replaced by links to the relevant reference sections. State the `prefix` rule correctly (evidence item 7) or leave it to the reference.
- Updating: how (`upgrade`, `--dry-run` does not include `migrate` output — preview format migrations and the rules-pair redraw with `npx github:Velklish/backslop#v<new> migrate --dry-run`), what it touches, what is lost (committed edits in the tool-owned `docs/backlog/README.md` / `docs/archive/README.md`), that the printed summary is the tool CHANGELOG between the two versions, and a numbered post-upgrade checklist: review and commit the diff, run `<cli> lint` and fix what newer gates report, optionally `<cli> fold` directories archived before 0.10.
- How work proceeds: short lifecycle ending archive → complete `result.md` → `fold N` into the draft → one acceptance commit carrying the draft; state the worker boundary once. For orchestrators: one sentence plus a link to the `What is stable` section of docs/reference/02-cli.md (the BS-176 (`orchestrator-contract-reference`) card repoints it to its page). Limitations: not published to npm — install from GitHub tags (drop the `npx backslop@X.Y.Z` and `npm run release` wording at `:64`, `:95`); the no-adapter `.gitignore` wording from evidence item 5; seed skill only with an adapter selected (evidence item 10). Replace "Development" with "Working on backslop": links to `AGENTS.md`, `docs/reference/`, and `node bin/backslop.js gates` (the BS-177 (`lib-module-map-reference`) card adds its page link); say Windows is supported.
- Delete `README.ru.md` and in the same commit: remove both `[Russian version]` links (`README.md:11`, `:109`), the `"README.ru.md"` entry in `package.json` `files`, the entry in `REQUIRED` at `test/release.test.mjs:243`, set `RELEASE_PIN_FILES` in `lib/lint.js:35` to `['README.md', 'AGENTS.md']`, and drop the file from the packed-files list in `docs/reference/02-cli.md` and from the gate 11 row in `docs/reference/03-lint.md`.
- test/release.test.mjs: assert that every `package.json` `files` entry exists in the tree (a missing entry fails with its name), so a stale entry can no longer hide behind `npm pack` skipping it.
- Set `package.json` `description` to the English README tagline.
- Add entries under a top `## Unreleased` heading of `CHANGELOG.md` (create it if absent): `README.ru.md` is no longer shipped.

## Out of scope

- Changing the default `lang` of `init` (it stays `ru` and is documented).
- Historical `README.ru.md` mentions in CHANGELOG released sections, ADRs and `docs/archive/LOG.md` (CHANGELOG and ADR cards; the archive journal is history).
- Removing `docs/ROADMAP.md` from the layout (the BS-157 (`remove-roadmap-from-layout`) card).
- Making `upgrade --dry-run` run `migrate --dry-run` (code change; only documented here).
- Translating the reference pages beyond the two `README.ru.md` mentions.

## Verification

- `git grep -n 'README\.ru'` → matches only in `CHANGELOG.md`, `docs/adr/` and `docs/archive/LOG.md`.
- `node bin/backslop.js lint; echo rc=$?` → rc=0; `npm test; echo rc=$?` → rc=0 with the pass count; `node --test test/release.test.mjs` passes with the new `REQUIRED`.
- Probe for the new `files` assertion: in a scratch copy after this card, put `"README.ru.md"` back into `package.json` `files` (the file itself stays deleted) → `node --test test/release.test.mjs; echo rc=$?` → rc=1 naming the entry; discard the copy.
- `npm pack --dry-run 2>&1 | grep README` lists only `README.md`.
- Command coverage: `node -e "const fs=require('fs');const c=eval(fs.readFileSync('bin/backslop.js','utf8').match(/const COMMANDS = (\[[^\]]*\])/)[1]);const r=fs.readFileSync('README.md','utf8');console.log(c.filter(x=>!r.includes('`'+x)))"` → `[]`.
- `grep -nE 'ADR-[0-9]|BS-[0-9]|README\.ru' README.md; echo rc=$?` → rc=1.
