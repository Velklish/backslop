# BS-141 · brief/archive/tracks tests: merge slot and twin tests, drop duplicate asserts

- **Order:** 590
- **Scope:** [02. CLI](../../reference/02-cli.md) § brief
- **Created:** 2026-09-25
- **Dependencies:** BS-108, BS-90

## Context

Line numbers are at commit 6f6318e (v0.11.0); if a line moved, find the test by the quoted name. A *mutation probe* means: edit the named lib line in the working tree, run the named test file with `node --test --test-timeout=60000 <file>; echo rc=$?`, read the red test names (lines starting with `✖`), then restore with `git checkout -- lib bin scripts templates`. Base run at 6f6318e: full suite 450 tests, 450 pass. Bug and code cards earlier in the queue changed some of the lib lines named in the mutation probes; apply each probe to the same logic where it lives when you start.

Base runs: brief 9 tests, archive 7, tracks 7, all pass.

**1. brief slot tests :67 and :143 are one table.** verified — read. Both `seed(root)`, render `['brief', '3']` bare (:71, :147) and then with flags, asserting placeholder-without-flag / value-with-flag per slot (lib/brief.js:53-69, `values.X ?? tr(… '[TODO: …]')`). Rows are not uniform: `--measurements` has no placeholder (text absent/present, :74/:81), `--neighbour` takes a repeated pair, :143 alone checks section headers (:149) and the `{{` leak (:154); the malformed `--neighbour` refusal (:83-85) stays separate.

**2. Duplicate brief assertions.** verified — mutation probe. lib/brief.js:152 `: ''` -> `: '{{leak}}'` reds :143 (at :154) and :215 (at :222), both on the default seed config without `probe`. :48 `/`npx backslop@1\.2\.3 new <slug> --parent N\[\.M\]`/` is a literal substring of the :58 regex on the same `r.out`.

**3. archive twins :145 (untracked file in a repo) and :161 (no repo) are one table, both rows needed.** verified — mutation probe. Identical bodies (put BS-1-a.md, `archive 1`, code 0, stderr /файл не в индексе git — перенесён без git mv/, task.md exists); :145 adds `status --porcelain` without /^R/m. lib/tasks.js:577 `tracked.status === 0` -> `!== 1` reds only :161; lib/tasks.js:576 `['ls-files', '--error-unmatch', '--', from]` -> `['rev-parse', '--git-dir']` reds only :145.

**4. tracks :41 (text) and :64 (`--json`) build the same two-worktree fixture twice.** verified — read + timing. Both `makeProject(); seedRun(root)` (:16-34) and differ only by `--json`; 426 ms and 412 ms; the assertion sets differ (:46-58 vs :69-83) and both are kept.

**Must stay:** brief :91, :108, :129 (archive entry without task.md), :154, :170, :195 (object gate entry), :215; archive :32 including :72-74 (the only guard of the repeat-archive refusal on plain `archive N`: limiting lib/archive.js:24 to `--into` is killed only by :74), :83, :98, :127, :174 (root incoming link); tracks :89, :104, :133, :144 (squash bodies), :163 (detached worktree); seed.test.mjs unchanged.

## Work to do

- Replace brief :67 and :143 with one bare render of `['brief', '3']` plus a table `{ flagArgs, placeholderRegex | absentText, valueRegex }` for neighbour (`['--neighbour', 'test/=tests', '--neighbour', 'bin/=cli']`), entry, autonomy, handover, measurements (absent text without the flag); keep the header check (:149), the `{{` check (:154) and the malformed `--neighbour` refusal (:83-85) as separate asserts.
- Delete brief :222 and :48.
- Replace archive :145 and :161 with one test over `[{ label: 'untracked file in a repo', git: true, assertNoRenameInIndex: true }, { label: 'no git repository', git: false, assertNoRenameInIndex: false }]`.
- Replace tracks :41 and :64 with one test: `seedRun` once, run `['tracks']` with the text assertions of :46-58 and `['tracks', '--json']` with the JSON assertions of :69-83.

## Out of scope

- The brief's pin handling: the BS-108 (`drop-pre-floor-version-gates`) card deleted `pinHasGates` and its fail-open branch, and the BS-90 (`brief-follows-cli-pin`) card added the new pin check with its own tests.
- Any change under lib/.

## Verification

- `node --test --test-timeout=60000 test/brief.test.mjs test/archive.test.mjs test/tracks.test.mjs; echo rc=$?` -> rc 0; brief: the count before this card minus 2 (slot merge, :48/:222 are assertions, not tests), archive 6, tracks 6.
- Mutation probe lib/brief.js:152 `: '{{leak}}'` -> the merged slot test red at the `{{` assert.
- Mutation probes lib/tasks.js:577 `!== 1` and lib/tasks.js:576 `rev-parse --git-dir` -> the archive table red on the matching row.
- `npm test; echo rc=$?` -> rc 0.
