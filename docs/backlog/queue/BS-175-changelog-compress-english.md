# BS-175 · Compress CHANGELOG to short English user-visible entries; decouple tests from its history

- **Order:** 930
- **Scope:** [02. CLI](../../reference/02-cli.md) § changelog
- **Created:** 2026-09-25
- **Dependencies:** BS-137, BS-143, BS-144, BS-145, BS-146, BS-147, BS-148, BS-149, BS-150, BS-151, BS-152, BS-153, BS-154, BS-155, BS-156

## Context

`CHANGELOG.md` is 100 KB of Russian text full of production artifacts, and consumers read it. `upgrade` prints the new version's `changelog --since … --to …` in the consumer project. This card compresses every released section to its user-visible gist in English and keeps the headings the tools depend on. It also moves three tests off the real file's history.

Order: start from `main` after every ADR consolidation card has merged. Each of those cards drops or repoints the CHANGELOG links to the ADR files it deletes, in the same commit. Land this card alone: no other branch may edit released CHANGELOG sections while it is open, because `merge-changelog` takes released sections from `--ours` only (item 8). Entries that other cards add under `## Unreleased` are kept as they are.

Evidence. Every item is verified at v0.11.0 (commit 6f6318e):

1. **What the file holds.** verified — a node recount over the `## ` sections at 6f6318e, cross-checked with `wc -c`: 100,126 bytes in 13 sections with 102 entries. The artifacts:
   - 114 task-id tokens (103 distinct);
   - 31 ADR tokens and 26 ADR links (24 files);
   - 38 links in all, including 8 into `docs/reference` and 1 into `docs/archive`;
   - batch-card titles on lines 5-8 and 8 nested bullets on lines 9-16;
   - dates in entry bodies on lines 25, 30, 34 (twice), 42 and 130;
   - owner-decision wording on lines 30, 42, 44, 58, 105 and 115.

   Bytes per section:

   | Section | Bytes |
   |---|---|
   | v0.11.0 | 30,994 |
   | v0.10.1 | 3,082 |
   | v0.10.0 | 19,740 |
   | v0.9.0 | 6,116 |
   | v0.8.0 | 3,460 |
   | v0.7.0 | 2,516 |
   | v0.6.0 | 6,660 |
   | v0.5.0 | 17,257 |
   | v0.4.0 | 4,053 |
   | v0.3.1 | 1,251 |
   | v0.3.0 | 2,596 |
   | v0.2.0 | 1,601 |
   | v0.1.0 | 775 |
2. **Consumers read it verbatim.** verified — in a fresh `init --lang en --tools none` project: `backslop changelog --since v0.9.0` gave rc=0 with the headings v0.11.0, v0.10.1 and v0.10.0. The output was 53,815 bytes, with 20,137 Cyrillic characters, 57 task ids and 16 ADR links. The code path:
   - `lib/upgrade.js:164` runs the new version's `changelog`;
   - `lib/changelog.js:10` reads the tool's own shipped file;
   - only the empty-result message is localized (`:45-50`);
   - `package.json` `files` ships `CHANGELOG.md` but not `docs/`, so repo-relative links never resolve for a consumer.

   Every consumer on 0.9.0 or later prints v0.10.0 through v0.11.0 on its next upgrade. Already-published tags keep the old text.
3. **The heading form must stay byte-identical.** verified — in a clone with every heading rewritten to `## [X.Y.Z] - date`:
   - `node bin/backslop.js lint` gave rc=1 with `✖ CHANGELOG.md: нет секции «## v0.11.0»` (`lib/lint.js:100` requires `^## v${version}\b`);
   - `node scripts/release.mjs 0.12.0 --bump` gave rc=0 and renamed the released `## [0.11.0] - 2026-09-24` to `## v0.12.0 — …`, because `release.mjs:56` treats only `/^## v\d/` as released.

   Dropping the `v` gives the same gate-11 failure.
4. **Three tests read the real history.** verified — they assert only headings. `test/upgrade.test.mjs:199`, `:232` and `:417` match `## v0\.1\.0` in CLI output that comes from the real file.
   - Folding v0.1.0..v0.3.0 into v0.3.1 → `node --test test/upgrade.test.mjs` rc=1 (18 tests, 3 fail).
   - Compressing bodies under kept headings → 18/18 green.
   - A full compression in a clone (all 13 headings kept, at most 5 English entries per section, no ids, no links, 3,780 bytes) passed: `lint` rc=0 and `npm test` rc=0 with 450/450.
5. **Task ids inside code spans still count.** verified — gate 6 blanks only fenced blocks (`lib/lint.js:512-525`, regex at `lib/tasks.js:95`), so an entry naming an id with no task file, even inside a code span, gave lint rc=1 ("упоминает …, а файла задачи нет"). Removing all 114 ids is gate-safe.
6. **Entry titles must be unique per section.** verified — two `- **Fixed** — …` entries in one section gave lint rc=1 ("заголовок записи «Fixed» уже есть в секции …"), from gate 7 (`lib/lint.js:527-549`, entry regex at `:28`).
7. **A comment misstates the output order.** verified — the comment at `lib/changelog.js:29` says the output runs from newest to oldest, but `changelogSince` only filters and maps. `changelogSince('## v0.1.0\n- **a**\n\n## v0.2.0\n- **b**\n', null, '0.2.0')` returns v0.1.0 first. The output order is the file's order.
8. **`merge-changelog` drops the other side's edits to released sections.** verified — in a throwaway repo. Ours compressed a released section. Theirs rewrote a link in that section and added an unreleased entry. `merge-changelog --ours ours --theirs theirs --base main` gave rc=0, and the report named only the unreleased entry: theirs' edit to the released section was gone (`lib/merge-changelog.js:324-328`). This is documented behaviour (`backslop-batch` `SKILL.md:105`, `02-cli.md:28`), so the fix is sequencing, not code.
9. **`README.ru.md` in the history.** verified — `git grep -n "README\.ru" CHANGELOG.md` finds `:126` (a file list) and `:159` (v0.3.0, "Russian text in README.ru.md"). The mentions in the archive journal and the ADRs are not part of this card.

## Work to do

- Keep every `## vX.Y.Z — YYYY-MM-DD` heading byte-identical (`v` prefix, em dash U+2014), newest first, one section per released version; do not merge or drop old sections; leave any `## Unreleased` section and its entries untouched.
- Rewrite every released section body in English as entries of the form `- **<specific user-visible effect, no inner bold>** — <one or two sentences on what the user now gets or must do, commands in code spans>.`: titles unique within a section; at most 300 characters per entry, 8 entries and 2,000 bytes per section; whole file about 20 KB. Upgrade actions become one entry titled `Upgrade: …`.
- Drop from every section: task-id tokens (examples use `<prefix>-N`), ADR tokens and links, links into `docs/reference/` and `docs/archive/` and any other repo-relative link, batch-card titles, nested bullets, owner/decision wording, dates inside bodies. Line 159 becomes "English README"; line 126 loses its file list. Do not relink entries to the consolidated ADRs.
- Priority and depth: v0.11.0, v0.10.1, v0.10.0 first (printed to every consumer on upgrade), then v0.5.0, v0.6.0, v0.9.0; v0.1.0-v0.3.1 are translated nearly one to one.
- Tests on their own fixture, test first where possible: the full-upgrade test (test/upgrade.test.mjs:185 at 6f6318e) and the changelog CLI table the BS-137 (`upgrade-config-version-tests`) card built from :213 and :412 run the CLI from `toolCopy()` (`test/helpers.mjs`, copies `bin`, `lib`, `templates`, `package.json`, not `CHANGELOG.md`) with a fixture `CHANGELOG.md` put into the copy — sections `## v${TOOL_VERSION}`, `## v0.2.0`, `## v0.1.0` — invoked via `toolCli(tool, args, { cwd: root })`; the upgrade test's `cli` points at the copy's `bin/backslop.js`. Keep the regex assertions; they now read the fixture.
- Fix the comment at `lib/changelog.js:29`: sections come out in the file's order (the file is kept newest first); keep the file's comment language.
- Owner decision: no owner review before merge; result.md carries a table mapping every old entry to its new entry or to "dropped".

## Out of scope

- Keep-a-Changelog or any other heading form; hardening `scripts/release.mjs:56` against other version-heading forms.
- Linking entries to the consolidated ADRs (rationale lives in the ADR index).
- `docs/archive/LOG.md` history lines and already-published tags.
- Localizing `changelog` output per project language (code).

## Verification

- `node bin/backslop.js lint; echo rc=$?` → rc=0; `npm test; echo rc=$?` → rc=0 with the pass count (baseline at v0.11.0: 450 tests).
- Headings unchanged: `diff <(git show <base>:CHANGELOG.md | grep '^## v') <(grep '^## v' CHANGELOG.md)` prints nothing, where `<base>` is the commit this card started from.
- `grep -nE 'BS-[0-9]|ADR-[0-9]' CHANGELOG.md; echo rc=$?` → rc=1; `grep -nE '\]\([^h]' CHANGELOG.md; echo rc=$?` → rc=1 (no repo-relative links).
- `node -e "console.log((require('fs').readFileSync('CHANGELOG.md','utf8').match(/[\u0400-\u04FF]/g)||[]).length)"` → 0; `wc -c < CHANGELOG.md` is about 20,000 or less.
- Decoupling probe: in a throwaway copy of the repo delete the `## v0.1.0` section from the real `CHANGELOG.md` and run `node --test test/upgrade.test.mjs` → still rc=0 (it failed 3 tests before the fixture change); discard the copy.
- In an `init --lang en` project: `node <repo>/bin/backslop.js changelog --since v0.9.0` prints no Cyrillic and no `docs/` link.
- result.md has one table row per entry of the released sections at `<base>` (102 at 6f6318e), each naming its new entry or "dropped".
