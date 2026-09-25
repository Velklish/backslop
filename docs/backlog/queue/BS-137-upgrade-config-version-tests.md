# BS-137 · upgrade, config and version tests: probe-failure and changelog tables, split bundled tests

- **Order:** 550
- **Scope:** [02. CLI](../../reference/02-cli.md) § upgrade
- **Created:** 2026-09-25
- **Dependencies:** BS-84, BS-108, BS-113, BS-90, BS-128

## Context

Line numbers are at commit 6f6318e (v0.11.0); if a line moved, find the test by the quoted name. A *mutation probe* means: edit the named lib line in the working tree, run the named test file with `node --test --test-timeout=60000 <file>; echo rc=$?`, read the red test names (lines starting with `✖`), then restore with `git checkout -- lib bin scripts templates`. Base run at 6f6318e: full suite 450 tests, 450 pass. Bug and code cards earlier in the queue changed some of the lib lines named in the mutation probes; apply each probe to the same logic where it lives when you start.

Base run: test/upgrade.test.mjs 18 tests, 18 pass (darwin; 8 are skipped on win32).

**1. The two probe-failure tests (:386, :488) are one table over full upgrade vs `--pin-only`.** verified — mutation probe. :389-399 and :491-501 build the same broken-npx fixture (`npx` shim `exit 3`, cli `npx github:me/proj#v0.1.0`, version 0.1.0) and assert code 1, /кодом 3/, /Пин и штамп не тронуты/, unchanged cli; the probe `exec` is lib/upgrade.js:145, before the pinOnly branch at :156. M1 lib/upgrade.js:145 `exec` -> `if (!pinOnly) exec`: red :488 and :64 (:79). M2 (saveConfig of cli/gates inserted before :145): red :488 and :386. Incidental differences: releasesRepo tags (`[v<TOOL_VERSION>]` vs `[v0.1.0, v0.2.0]`), gates only in :488, version assert only in :386.

**2. `init` and `migrate` refusing a stamp newer than the tool (:401-404) hide in the win32-skipped :386.** verified — measured. They exercise lib/init.js:55 and lib/migrate.js:78-80 and need no npx shim; `grep -rn 'новее инструмента' test` -> only upgrade.test.mjs:402-403 plus lint.test.mjs:347 (the lint warning only). In a project stamped 9.9.9, `init` and `migrate` both exit 1 with `✖ штамп v9.9.9 новее инструмента v0.11.0: …`; today only stderr is matched.

**3. `upgrade без источника релизов отказывает; migrate и changelog в одиночку` (:213) runs three unrelated commands on one `makeProject({ stamp: false })`.** verified — read. upgrade refusal without source (:217-219, lib/upgrade.js:99-103); migrate on an unstamped project (:221-228); `changelog --since` v0.0.1 / v99.0.0 / latest (:230-236, lib/changelog.js:37-51, reads only the tool CHANGELOG and the project lang). :236 checks only code 1.

**4. The changelog CLI checks (:230-236 and :412-420) are one five-row table.** verified — read. Rows: `--since v0.0.1` -> /## v0\.1\.0/, 0; `--since v99.0.0` -> /записей после v99\.0\.0 и до v\d+.\d+.\d+ нет/; `--since latest` -> code 1; `--to v0.1.0` -> /## v0\.1\.0/ and not /## v0\.2\.0/; `--to v0.0.1` -> /^записей до v0\.0\.1 нет\n$/.

**5. :163-165 in :142 re-assert the lint pin-vs-stamp warning.** verified — mutation probe. Deleting lib/lint.js:174 reds `lint: предупреждения о версии не красят гейт` (lint.test.mjs:334, assert :343) and :142.

**6. :191-193 and :201-202 in the full-upgrade test :185 re-check the rules redraw.** verified — mutation probe. :244 (:261-262) asserts it directly; init skips existing docs files (lib/init.js:136-138) and :197/:200 already prove upgrade ran migrate. Deleting lib/migrate.js:104-107 reds :244, :276, :294, :185; adding GLOSSARY.md to RULES_DOCS (lib/migrate.js:43) reds :244, :276, :185, :426. :185 itself stays: it is the only full-upgrade test without the `/bin/sh` npx shim, i.e. the only one that runs on Windows.

**7. version.test.mjs:7-9 checks only the shape of TOOL_VERSION.** unverified — run the check first. Probe result not yet confirmed: package.json:3 `"0.11.0"` -> `"0.11"` reds version :7, version :31 (compareVersions throws), config :6 and :15 (makeProject stamps TOOL_VERSION; loadConfig rejects it at lib/config.js:131 with `version «0.11» — нужна форма X.Y.Z`). The test costs ~0.1 ms: removal is noise reduction only.

**Must stay:** upgrade :41, :64 (only guard of the `form?.repoUrl` fallback, lib/upgrade.js:99), :89, :104, :112, :121 (signal-killed ls-remote), :142, :185, :244, :276, :294, :318, :349, :426; config :25, :35, :49, :76, :140, :162 (config.test.mjs:126-128 is deleted by the BS-128 (`test-only-exports-and-helpers`) card); version :11, :20, :31.

Earlier cards changed this file: the BS-108 (`drop-pre-floor-version-gates`) card rebased :176 and the migrate half of :213 on the 0.10.0 migration, and the BS-113 (`shared-shell-runner`) card changed the step-failure message of `upgrade` so it names the cause; match the text it prints now (the exit code 3 of the broken shim) instead of the old `/кодом 3/`.

## Work to do

- Replace :386's probe half and :488 with one test `upgrade: сбой пробного запуска не пишет пин, гейты и штамп` over argv rows `['upgrade']` and `['upgrade', '--pin-only']`: one releasesRepo whose newest tag is above 0.1.0, gates `['npx github:me/proj#v0.1.0 lint', 'npm test']` in the config; assert code 1, the step-failure text naming exit code 3, /Пин и штамп не тронуты/, and cli, gates and version unchanged for both rows. Keep the win32 skip (the broken shim is `/bin/sh`).
- Move :401-404 into a new test `init и migrate отказывают на штампе новее инструмента` (makeProject + setConfig version 9.9.9, no skip); assert exit 1 and the stderr text for both commands.
- Split :213 into (a) `upgrade без источника релизов отказывает` (:217-219) and (b) `migrate без штампа: все миграции должны, штамп «не было → v»` (:221-228); move :230-236 into the changelog table.
- Replace :412 and :213's :230-236 with `changelog CLI: границы --since/--to и пустая выжимка` over the five rows above (argv, code, match, doesNotMatch); the `--since latest` row also matches the error text (read it from lib/changelog.js), not only code 1.
- Delete :163-165 in :142 and drop `, lint предупреждает` from its name.
- Delete :191-193 and :201-202 in :185; keep the rest of :185.
- Unverified — run the check first (version.test.mjs:7-9): (1) blind probe: skip :7 (`test.skip`), set package.json:3 to `"0.11"`, run `node --test --test-timeout=60000 test/version.test.mjs test/config.test.mjs; echo rc=$?` -> expect rc 1 with version :31 red; config.test.mjs :6 and :15 are removed by the BS-107 (`marker-only-adapter-ownership`) card, so version :31 is the only red test; restore package.json; (2) refutation: check that no doc or release step relies on this test's message (`grep -rn 'форма X.Y.Z' docs scripts`), and that scripts/release.mjs does not run version.test.mjs alone; (3) only if both hold, delete :7-9 — no test to add.

## Out of scope

- The legacy config tests (config.test.mjs:6, :15): removed by the BS-107 (`marker-only-adapter-ownership`) card together with the legacy inference.
- Running the pinned-form upgrade tests on Windows (the BS-138 (`upgrade-tests-windows-npx-shim`) card, which depends on this one).
- The refusal of a full upgrade on a pinned git project and its regression test: done by the BS-84 (`upgrade-completes-pinned-consumers`) card.
- Switching the changelog CLI rows to a fixture CHANGELOG: the BS-175 (`changelog-compress-english`) card moves this table onto a fixture later.
- Any change under lib/.

## Verification

- `node --test --test-timeout=60000 test/upgrade.test.mjs; echo rc=$?` -> rc 0, tests 19 on darwin (18 -1 probe-failure merge, +1 stamp-newer test, +1 from splitting :213; :412 becomes the changelog table).
- Mutation probes: lib/upgrade.js:145 `if (!pinOnly) exec` -> the `--pin-only` row and :64 red; saveConfig before lib/upgrade.js:145 -> both rows red; removing the refusal at lib/init.js:55 or lib/migrate.js:78 -> the new stamp-newer test red; deleting lib/lint.js:174 -> lint.test.mjs:334 red; deleting lib/migrate.js:104-107 -> :244 red.
- `node --test --test-timeout=60000 test/config.test.mjs test/version.test.mjs; echo rc=$?` -> rc 0.
- `npm test; echo rc=$?` -> rc 0.
