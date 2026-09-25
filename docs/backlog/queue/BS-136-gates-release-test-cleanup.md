# BS-136 · gates/release tests: cut the slowest test to two runs, table refusals and recovery states

- **Order:** 540
- **Scope:** [02. CLI](../../reference/02-cli.md) § gates
- **Created:** 2026-09-25
- **Dependencies:** BS-92, BS-113, BS-127

## Context

Line numbers are at commit 6f6318e (v0.11.0); if a line moved, find the test by the quoted name. A *mutation probe* means: edit the named lib line in the working tree, run the named test file with `node --test --test-timeout=60000 <file>; echo rc=$?`, read the red test names (lines starting with `✖`), then restore with `git checkout -- lib bin scripts templates`. Base run at 6f6318e: full suite 450 tests, 450 pass. Bug and code cards earlier in the queue changed some of the lib lines named in the mutation probes; apply each probe to the same logic where it lives when you start.

Base runs: test/gates.test.mjs 21 tests, 21 pass, 14 s; test/release.test.mjs 11 tests, 11 pass. Suite profile at base (two full runs, 450 tests, `duration_ms` 47 s in run 1): the slowest test is the gates ETIMEDOUT test below (7.0 s and 6.6 s, ~15 % of the run, variance only 6 %); the next ones are release tests at 2-5 s that spawn node and git per case and vary 40-90 % between runs.

**1. `gates: гейт с ошибкой запуска при коде 0 — не зелёный, итог и код возврата красные` (:233-271) waits 2 s three times.** verified — mutation probe. :242 patches `cp.spawnSync` to force `timeout: 2000` for every `shell: true` spawn, and `cli()` runs at :249, :256, :261, each waiting the full cap. Deleting the human `--keep-going` run (:256-259) and adding `assert.deepEqual(ran(root), ['after'])` after `assert.equal(report.green, 1);` keeps it green in 4.33-4.37 s (was 6.5 s) and still red on lib/gates.js:158 -> `return r.code === 0;` and on lib/gates.js:265 -> `if (!passed(result)) break;`. Lowering the 2000 ms cap was refuted: the injected timeout also bounds the node `after` gate, so at 5 ms the `after` gate itself is killed (5/5 red); 300 ms passed 10/10 at load ~4 but leaves node cold start and the trap race inside a few hundred ms. Keep 2000 ms.

**2. :126 `assert.equal(report.tree.head.length, 40)` is weaker than :108 `/^[0-9a-f]{40}$/`.** verified — mutation probe. lib/gates.js:17 -> `head: null,` reds :93 at :108 and :116 at :126; :116 keeps its unique checks (clean:false on a dirty tree, tree:null without git).

**3. :459 greps bin/backslop.js for `'gates'`.** verified — mutation probe. bin/backslop.js has one `'gates'` literal (COMMANDS, :11); removing it reds 20 of 21 tests. `readFileSync` is imported at :6 and used only at :459.

**4. The two `--dry-run` flag-pair refusals (:445-447 in :433, and :493) share one shape.** verified — mutation probe. `lib/gates.js:188` -> `if (false && …)` reds only :493; `lib/gates.js:193` -> same reds only :433. Both rows needed.

**5. release.test.mjs: four recovery tests and two sequence tests are two tables.** verified — mutation probe. Recovery rows: :135 (`FAKE_PUSH_DRY_FAIL`, message scripts/release.mjs:113), :148 (`FAKE_NPM_FAIL=publish`, :120), :164 (`FAKE_GIT_FAIL='push --atomic origin main v0.2.0'` with publish, :128), and :289's second half :312-319 (same failure with `--no-publish`, :128 with published=false, expecting /npm publish не запускался \(--no-publish\)/ and not /опубликован/). Shape: `fixture(); runRelease(f, args, env)`; code 1; err regexes; optional log-tail and absent regexes (:164 has no absent regex, :312 no log tail). Sequence rows: :52 (:57-72) and :289's first half (:294-308) are the same deepEqual list modulo `npm publish`; :309 `assert.doesNotMatch(r.log, /npm publish/)` is implied: scripts/release.mjs:116 `if (publish)` -> `if (true)` fails :289 at :294 first.

**Regression guards that must stay:** gates :25, :46, :65, :77, :93, :140, :176, :211 (signal-killed git diff named), :233, :275 (monorepo prefix), :332, :364, :386 (require-clean on unscoped lists), :400, :420, :465, :508; release :78 (gates dirtying the tree before tag), :92 (preflight table), :121, :212, :225 (tarball contract), :264.

## Work to do

- In :233 delete :256-259 (the human `--keep-going` run) and add `assert.deepEqual(ran(root), ['after']);` after `assert.equal(report.green, 1);`; keep the 2000 ms cap and fix any comment that still counts three runs.
- Delete :126.
- Delete :459 and drop `readFileSync` from the import at :6; keep the help usage assertion at :458.
- Replace :493 and :445-447 with one test on one committed project with a dirty file over rows `[['--dry-run', '--base', 'HEAD'], /--dry-run и --base вместе бессмысленны/]` and `[['--dry-run', '--require-clean'], /--dry-run и --require-clean вместе бессмысленны/]`: exit 1, err match, `ran(root)` equals `[]`. :433 keeps only the dry-run listing (:438-443).
- In release.test.mjs define the command sequence once (SEQ) and replace :52 and :289's first half with one test over `[{ args: ['0.2.0'], log: SEQ }, { args: ['0.2.0', '--no-publish'], log: SEQ without 'npm publish', out: /npm publish не запускался/ }]`; drop :309.
- Replace :135, :148, :164 and :289's second half (:312-319) with one recovery test over rows `{ args, env, errRes, logTailRe?, absentRe? }`; :289 disappears as a separate test.

## Out of scope

- Lowering or scoping the 2000 ms timeout cap (would need the cap applied only to the trapped command) — a separate change.
- Running the tarball test (:225) only in CI.
- Any change under lib/ or scripts/.

## Verification

- `node --test --test-timeout=60000 test/gates.test.mjs; echo rc=$?` -> rc 0, tests 21.
- `node --test --test-reporter=spec --test-name-pattern='ошибкой запуска' test/gates.test.mjs` -> rc 0, the test takes about 4.4 s instead of about 6.5 s.
- Mutation probes lib/gates.js:158 `return r.code === 0;` and lib/gates.js:265 `if (!passed(result)) break;` -> the ETIMEDOUT test red; lib/gates.js:188 and :193 `if (false && …)` -> the flag-pair table red; lib/gates.js:17 `head: null,` -> :93 red.
- `node --test --test-timeout=60000 test/release.test.mjs; echo rc=$?` -> rc 0, tests 8 (base 11; five tests become two tables).
- Mutation probe scripts/release.mjs:116 `if (true)` -> the sequence table red; editing the state text at scripts/release.mjs:113, :120 or :128 -> the matching recovery row red.
- `npm test; echo rc=$?` -> rc 0.
