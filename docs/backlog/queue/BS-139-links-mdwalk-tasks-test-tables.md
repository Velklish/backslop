# BS-139 · links/mdwalk/tasks tests: link rewrites as tables, drop subsumed cases, test batchOf

- **Order:** 570
- **Scope:** [Reference](../../reference/README.md)
- **Created:** 2026-09-25
- **Dependencies:** BS-89, BS-112, BS-95

## Context

Line numbers are at commit 6f6318e (v0.11.0); if a line moved, find the test by the quoted name. A *mutation probe* means: edit the named lib line in the working tree, run the named test file with `node --test --test-timeout=60000 <file>; echo rc=$?`, read the red test names (lines starting with `✖`), then restore with `git checkout -- lib bin scripts templates`. Base run at 6f6318e: full suite 450 tests, 450 pass. Bug and code cards earlier in the queue changed some of the lib lines named in the mutation probes; apply each probe to the same logic where it lives when you start.

Base run: test/links.test.mjs 17 tests, 17 pass.

**1. `rewriteMovedLinks`: five tests are one input -> output table.** verified — read. :15, :27, :42, :49, :132 are each only `assert.equal(rewriteMovedLinks(<in>, FROM, TO), <out>)` with FROM/TO at :12-13 (`docs/backlog/active` -> `docs/archive/BS-42-move-breaks-links`); :15 already loops over a [before, after] table (:16-24). Rows: 5 of :15, 3 of :27 (anchor, title, angle brackets), 1 of :42 (reference definition), 1 of :49 (externals and anchors unchanged), 2 of :132 (rooted `/docs/README.md` unchanged, `?plain=1` kept).

**2. `directoryLinks`: three tests build the identical sandbox.** verified — read. :182-186, :199-203, :233-237 are the same `mkdtemp`, `docs/triage/BS-5-x.md`, `file = docs/note.md`; the bodies differ only in note.md content and the expected array. :232's row is a named regression guard (nearest-bracket text, path through a file) and stays verbatim.

**3. :165 `assert.equal(blankCode('x `y` z'), 'x     z')` sits in the reference-definition test :162.** verified — mutation probe. lib/links.js:54 -> `return text;` reds :95, :162, :181, :198; a length-changing mutation (span -> one space), which :95 misses, still reds :181, :198 and two lint tests (full suite 445 pass, 5 fail). `blankCode` is used nowhere else in the file.

**4. `исход читается из первого абзаца result.md, обеими языковыми формами; не назван — тире` (tasks.test.mjs:209) also tests dateFromResult and batchOf.** verified — mutation probe. :216-217 (dateFromResult) are covered by :260 (:263 paragraph date, :264/:265 null): three dateFromResult mutations each red :260 with :216-217 removed — delete them, do not move them. :218-220 are the only test of `batchOf` (`grep -rn batchOf lib test` -> lib/log.js:85 definition, lib/tasks.js:188 use, tests only here).

**5. `входящие ссылки: чужая ссылка рядом не трогается, якорь сохраняется` (links :76).** unverified — run the check first. Probe results not yet confirmed: lib/links.js:220 `if (abs !== oldPath) return null;` -> a comment reds :84 and :76; dropping `${cut === -1 ? '' : href.slice(cut)}` at :221 reds :84 and :76; no mutation found that reds :76 but not :84 (the relative branch is covered by :57's rows). :57 and :84 are both only `assert.equal(rewriteIncomingLinks(text, fileDir, OLD, NEW), expected)` with OLD/NEW at :54-55.

**6. `mdFiles: файл за симлинком на каталог попадает в обход` (mdwalk :77).** unverified — run the check first. Probe result not yet confirmed: lib/mdwalk.js:60 `const st = e.isSymbolicLink() ? statOrNull(child) : e;` -> `const st = e;` reds :77 and :52 (which expects `docs/link/b.md` behind a directory symlink). Both carry the same win32 skip, and mdFiles/repoMarkdown share srcFiles (lib/mdwalk.js:49-72).

**Must stay:** links :95, :121, :127, :137, :168; mdwalk :15, :38 (seen-set loop guard), :52, :90; tasks :79 and :101 (regression guards), :143 (seeded fuzz, 478 ms), :227 and :322 (their fixture-length asserts stop an emptied fixture from passing), :260, :268.

## Work to do

- Replace links :15, :27, :42, :49, :132 with one test `перенесённый файл: перепись целей` looping 12 rows `[label, before, after]`; pass the label as the assert message.
- Replace links :181, :198, :232 with one test: one sandbox, rows `[label, noteContent, expected]`, rewriting note.md per row; keep :232's row verbatim.
- Delete links :165 and `blankCode` from the import at :9.
- In tasks.test.mjs :209 delete :216-217 and move :218-220 into a new test `пачка: batchOf читает номер пачки RU/EN`; :209 keeps :210-215.
- Unverified — run the check first (links :76): (1) blind probe: `test.skip` :76, apply lib/links.js:220 -> comment, run `node --test --test-timeout=60000 test/links.test.mjs; echo rc=$?` -> expect rc 1 with :84 red; restore, drop the href tail at :221 -> expect :84 red again; (2) refutation: read :76 and :84 side by side and confirm every case of :76 (foreign link untouched, anchor kept, two links on one line) appears in :84 or :57; if one does not, keep :76 or move that case into the table as a row; (3) if confirmed, delete :76 and merge :57 and :84 into one table over `[text, fileDir, expected]` (4 rows of :57, 2 rows of :84).
- Unverified — run the check first (mdwalk :77): (1) blind probe: `test.skip` :77, set lib/mdwalk.js:60 to `const st = e;`, run `node --test --test-timeout=60000 test/mdwalk.test.mjs; echo rc=$?` -> expect rc 1 with :52 red; (2) refutation: read `mdFiles` and `repoMarkdown` in lib/mdwalk.js — if `mdFiles` has any line on the symlink path that `repoMarkdown` does not pass through, keep :77; (3) if confirmed, delete :77-88 and point the comment at :75-76 to :52 as the follow-symlink guard.

## Out of scope

- Any change under lib/.
- Other tests in tasks.test.mjs (rows there are historical consumer records; do not tidy them).

## Verification

- `node --test --test-timeout=60000 test/links.test.mjs; echo rc=$?` -> rc 0, tests 11 (17 -4 moved-links table, -2 directory-links table), or 9 if :76 was confirmed and :57/:84 merged.
- Mutation probe lib/links.js:54 `return text;` -> :95 and the directory-links table red; lib/links.js:220 -> comment -> the incoming-links test red.
- Mutation probe: make `batchOf` (lib/log.js:85) return null -> the new batchOf test red.
- `node --test --test-timeout=60000 test/tasks.test.mjs test/mdwalk.test.mjs; echo rc=$?` -> rc 0.
- `npm test; echo rc=$?` -> rc 0.
