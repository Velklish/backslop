# BS-133 · init.test.mjs: guard the invalid --prefix and the CLAUDE.md symlink, split two tests

- **Order:** 510
- **Scope:** [02. CLI](../../reference/02-cli.md) § init
- **Created:** 2026-09-25
- **Dependencies:** BS-94, BS-122, BS-96

## Context

Line numbers are at commit 6f6318e (v0.11.0); if a line moved, find the test by the quoted name. A *mutation probe* means: edit the named lib line in the working tree, run the named test file with `node --test --test-timeout=60000 <file>; echo rc=$?`, read the red test names (lines starting with `✖`), then restore with `git checkout -- lib bin scripts templates`. Base run at 6f6318e: full suite 450 tests, 450 pass. Bug and code cards earlier in the queue changed some of the lib lines named in the mutation probes; apply each probe to the same logic where it lives when you start.

Base run: test/init.test.mjs 36 tests, 36 pass.

**1. The invalid `--prefix` check is guarded by no test.** verified — mutation probe, full suite. `init: свой префикс и каталог, существующий AGENTS.md сохраняется, конфликт флагов с конфигом — отказ` (:280) runs `init --prefix bad` (:303-304) on a project already initialised with prefix DFL, so the flag-vs-config conflict at lib/init.js:57-59 refuses first and `if (!PREFIX_RE.test(prefix)) throw` (lib/init.js:68) is never reached. That line -> `if (false) throw`: full suite 450/450, rc 0. `grep -rn -- '--prefix' test` -> only init.test.mjs:285, :300, :303. The same test also bundles five behaviours: custom --prefix/--dir layout, AGENTS.md header kept, user CLAUDE.md kept, new+lint under the custom prefix, flag conflict.

**2. `init: при tools=[] CLAUDE.md-симлинк сохраняется; --dir нормализуется` (:326) asserts nothing about the symlink.** verified — mutation probe. It checks only `r.out` /CLAUDE\.md: не выбран/ (:333, a constant state of `ensureClaudeStub` for any tools without claude, lib/adapters.js:238) and --dir normalisation (:334-335). Inserting `if (lstatSync(claudeFile, { throwIfNoEntry: false })?.isSymbolicLink()) unlinkSync(claudeFile);` before lib/adapters.js:226 deletes the user's symlink (`ls CLAUDE.md` -> No such file or directory after `init --dir docs/`), yet init.test.mjs stays 36/36 and the full suite 450/450. The test calls `symlinkSync` without a win32 skip.

**Must stay:** :91, :110, :310, :368, :384, :424, :438, :526, :545, :558 (next free ADR number), :592, :610, :628, :717, :771, :799, :813, :826.

## Work to do

- Split :280 into (a) custom `--prefix`/`--dir` layout plus `new` and `lint` under the custom prefix; (b) an existing AGENTS.md header and a user CLAUDE.md are preserved; (c) flag vs config conflict (keep the `init --prefix ZZ` refusal of :300-302, drop the `--prefix bad` call of :303-304, which never reaches PREFIX_RE).
- Add a test: fresh `emptyRepo()`, `init --prefix bad` -> exit 1, stderr matches the prefix refusal (lib/init.js:68 at 6f6318e; the BS-94 (`config-validation-one-rule-set`) and BS-122 (`init-flag-validation-messages`) cards may have moved or localized it — assert the text it prints now), and `backslop.json` is not created.
- Split :326 into (a) `--dir docs/` is normalised (:331, :334-335) and (b) a user CLAUDE.md symlink survives `init` with tools=[]: after init `lstatSync(CLAUDE.md).isSymbolicLink()` is true and `readlinkSync` returns `AGENTS.md`; give (b) `{ skip: process.platform === 'win32' }` (symlinkSync on a file needs privileges there); keep the /CLAUDE\.md: не выбран/ assertion only in (b) or drop it.

## Out of scope

- Merges and deletions of redundant init tests — BS-134 (`init-test-merges-deletions`).
- init.test.mjs:458 (`existsSync(templates/en)`): removed by the BS-140 (`comment-length-templates-tests`) card, which depends on this one.
- Legacy-config tests (:449, :467): the dead-code work for versions below 0.9.0 decides their fate.
- PREFIX_RE accepting a non-string prefix in backslop.json: a bug card, not this one.
- Any change under lib/ or templates/.

## Verification

- `node --test --test-timeout=60000 test/init.test.mjs; echo rc=$?` -> rc 0, tests 40 (36 +3 from splitting :280 and adding the invalid-prefix test, +1 from splitting :326).
- Mutation probe: disable the prefix refusal (lib/init.js:68 at 6f6318e, or its place in `validateConfig`) -> the new invalid-prefix test red (it was uncaught at base).
- Mutation probe: the symlink-unlink line before lib/adapters.js:226 -> the new symlink test red on POSIX.
- `npm test; echo rc=$?` -> rc 0.
