# BS-127 · Release script: node via execPath, npm on Windows, honest refusals, git tag -d hint

- **Order:** 450
- **Scope:** [02. CLI](../../reference/02-cli.md) § release
- **Created:** 2026-09-25
- **Dependencies:** BS-108

## Context

`B` is the absolute path to this repo's `bin/backslop.js`; `T` is a fresh temporary directory. Line numbers refer to the v0.11.0 tree (commit 6f6318e).

`scripts/release.mjs` is maintainer-only and not shipped (package.json `files` holds bin, lib, templates and docs files). It still runs on every release, and Windows is a supported platform. The test helpers show the conventions: test/helpers.mjs:62 spawns `process.execPath`, and lib/gates.js:142 runs commands with `shell: true`. Items:

1. **The release script spawns `node` and `npm` by bare name.** verified — read the code. release.mjs:63 runs `command('node', ['bin/backslop.js', 'init'])`, taking whatever `node` is first on PATH instead of the running Node. release.mjs:104-106 and :118 spawn `npm` through `command()` (:15-20: `spawnSync(bin, args, {…})`, with no shell). The argv filter at :69-73 is hand-rolled, and failures are plain `Error` plus `fail()`. The script's tests shim `git` and `npm` through PATH with POSIX shebang scripts (test/release.test.mjs), so any change must keep those shims working. **The Windows failure is unverified — run the check first** (checklist in Work). The claim: on win32 `npm` is `npm.cmd`, and since Node 18.20.2 / 20.12.2 (CVE-2024-27980) `spawnSync` refuses a `.cmd` file without `shell: true` (EINVAL), while the bare name `npm` is not found at all.
2. **The fast-forward refusal mentions npm publish even with `--no-publish`.** verified — read the code. release.mjs:101 always says `…atomic push отказал бы после npm publish`, even when `publish` is false (:87 `const publish = !flags.includes('--no-publish')`). The publishing default itself is documented as intended (AGENTS.md, README, 02-cli.md:47), so it stays.
3. **A message inverts 'older'.** verified — read. release.mjs:50 (`… ${version} не старше`) says 'not older' where it means 'not newer'; the codebase uses 'старше' for 'older' (lib/brief.js:12; lib/upgrade.js:117, whose English is 'predates'). The same inversion in the comment at test/brief.test.mjs:174 is fixed by BS-108 (`drop-pre-floor-version-gates`).
4. **The push `--dry-run` failure gives no command.** verified — in a clone whose bare origin rejects pushes in `pre-receive`: `node scripts/release.mjs 0.12.0 --no-publish` gave rc=1 with `state: npm publish не запускался (--no-publish); локальный тег v0.12.0 создан; atomic push не подтверждён` and `next: git push --atomic origin main v0.12.0`; a rerun gave rc=1 with `локальный тег v0.12.0 уже существует` (`:96`). The `push --dry-run` failure message (`scripts/release.mjs:113`) says "delete the local tag and repeat release" in prose only, without the command.
5. **An owner-decision note in a comment.** verified — read: `scripts/release.mjs:85` is `// Публикация в npm не планируется (владелец отклонил BS-2.1), а тег и atomic push нужны:`; comments carry no task numbers or decision notes.

## Work to do

- Windows check, done before the npm change, as a checklist: (1) Reproduce blind on a Windows machine or a `windows-latest` runner with Node 20.12.2 or later. Run `node -e "const r=require('child_process').spawnSync('npm',['--version']);console.log(r.error&&r.error.code)"`; expected wrong output: `ENOENT`. Then run the same with `'npm.cmd'`; expected: `EINVAL`. (2) Refutation check: see whether README, AGENTS.md or 02-cli.md limits releasing to POSIX. If one does, stop and record that instead. (3) Only if the check confirms it: on win32, run npm steps as one shell command string (`spawnSync(`npm ${args.join(' ')}`, { shell: true, … })`) and keep the direct spawn on other platforms, so the POSIX PATH shims in test/release.test.mjs keep working. Add a test that stubs `process.platform` or extracts the argument builder and asserts the win32 form.
- scripts/release.mjs:63: spawn `process.execPath` with `['bin/backslop.js', 'init']`.
- scripts/release.mjs:101: word the refusal without npm publish when `publish` is false. For example, choose the tail `…would fail after npm publish` / `…atomic push would fail` by `publish`, in the file's current language.
- scripts/release.mjs:50: the refusal says `… ${version} не старше` (not older) where it means "not newer"; say "не новее".
- Item 4, test first: extend the push `--dry-run` failure test in `test/release.test.mjs` (the one using `FAKE_PUSH_DRY_FAIL`, near `:135`) with `assert.match(r.err, /git tag -d v0\.2\.0/)`, see it fail, then put the literal `git tag -d ${tag}` into the `next:` line at `scripts/release.mjs:113`.
- Item 5: rewrite the comment at `scripts/release.mjs:85` without the owner-decision/task parenthetical (at most two lines, 100 code points each).

## Out of scope

- Changing the publishing default or the documented release command.
- Replacing the hand-rolled argv filter or the `Error`/`fail()` pair in release.mjs.
- Removing the `state:` / `next:` labels, which test/release.test.mjs:140-171 asserts.

## Verification

- `node --test test/release.test.mjs` passes, including the sequence test that expects `npm publish` in the log (test/release.test.mjs:70).
- New test in test/release.test.mjs: with `--no-publish` and a non-fast-forward origin, the refusal text does not contain `npm publish`.
- `node --test --test-name-pattern='push --dry-run' test/release.test.mjs; echo rc=$?` → rc=1 before the `release.mjs` change, rc=0 after.
- `grep -n 'BS-2.1\|владел' scripts/release.mjs; echo rc=$?` → rc=1 (the comment at :85 is rewritten).
- `npm test` passes (report the count), and `node bin/backslop.js lint` gives rc=0.
