# BS-115 · One lenient project-language resolver, a null-language i18n helper, shared JSON readers

- **Order:** 330
- **Scope:** [02. CLI](../../reference/02-cli.md) § changelog
- **Created:** 2026-09-25
- **Dependencies:** BS-94, BS-109

## Context

Commands that can run outside a project resolve the message language in three different ways. The "both languages" case (`lang === null`) is written by hand at each site.

Repro commands below run in an empty scratch directory with `B() { node "$BACKSLOP/bin/backslop.js" "$@"; }`, where `$BACKSLOP` is this repository's checkout; projects are created with `git init -q -b main && B init --tools none --lang en`.

**1. Three language resolvers** — verified — all four commands below were rerun at base.
- `bin/backslop.js` `projectLang` (lines 122-128) calls `findRoot` and parses backslop.json raw. A broken config gives `'ru'`; no project gives `null` (both languages).
- `changelog` (lib/changelog.js:39-40) does `root ? loadConfig(root).lang : null`. `loadConfig` validates everything (lib/config.js:113-128), so an invalid config refuses the command, although `changelog` only reads the tool's own CHANGELOG.
- `merge-changelog` (lib/merge-changelog.js:364-365) calls `findRoot` twice and falls back to `'ru'` when there is no project.
- Repro, in a directory whose backslop.json is `{"prefix":"bs","lang":"en"}`:
  - `B help` → English help, rc=0.
  - `B changelog --since 0.10.0 --to 0.10.1` → `✖ backslop.json: prefix “bs” — expected 2–6 uppercase Latin letters or digits, starting with a letter`, rc=1.
- Repro, in a directory without backslop.json:
  - `B changelog --since bad` → `✖ --since “bad”: expected X.Y.Z / нужна форма X.Y.Z` (both languages), rc=1.
  - `B merge-changelog` → a Russian-only message about the missing `--ours`/`--theirs`, rc=1.

**2. The three-way language switch is written inline** — verified — read the code at base.
- `lang === 'en' ? … : lang === 'ru' ? … : both` appears at bin/backslop.js:134, :141-144 and :146, and at lib/changelog.js:43-44 and :46-49.
- `tr` (lib/i18n.js:1-3) has no null branch: `tr(null, ru, en)` returns Russian.
- The both-language texts at bin/backslop.js:144 and lib/changelog.js:43-44 are merged by hand (shared head and tail), so a helper that concatenates en + ru would change them.

**Which behaviour wins.** The lenient resolver in bin: a broken config never blocks a command that does not need the config, and no project means both languages.

**3. JSON readers with different BOM and error policies** — verified — repro rerun at base.
- `seed.readJsonOrNull` (lib/seed.js:250-257) runs `JSON.parse(readText(file))`, which strips the BOM, and returns null on error.
- `init.projectName` (lib/init.js:273-277) uses a raw `readFileSync` inside try/catch and falls back to the directory name.
- lib/lint.js:87-89 runs `JSON.parse(readText(pkgFile))` with no try, so a malformed package.json in the tool repository throws a SyntaxError stack. Reproduced: a project with `templates` symlinked to the tool's templates (so the self-host gate 11 is active) and a package.json of `{ "version": "0.11.0", }` → `lint` rc=1 with `SyntaxError: Expected double-quoted property name in JSON at position 23 … at lintReleaseVersions (…/lib/lint.js:89:24)`, no gate list and no `✖` summary.
- lib/config.js:94 and bin/backslop.js:126 read raw. scripts/release.mjs:71 reads raw and throws its own Error.
- Repro: package.json is a UTF-8 BOM followed by `{"name":"foo-pkg","scripts":{"test":"node t.js"}}`, in a directory named `m`.
  - `B init --tools none --lang en` → rc=0. docs/README.md line 1 is `# m documentation`: the directory name, not the package name.
  - `B seed --scan --json` → rc=0 and lists `npm run test` from `package.json → scripts.test`.
- BS-94 (`config-validation-one-rule-set`) already strips a BOM from backslop.json at lib/config.js:94 and bin/backslop.js:126; route those reads through the shared reader without changing that behaviour.

**Which JSON reader wins.** The BOM-stripping `readText` path, with a null result where the caller has a fallback and a CliError naming the file where it does not.

## Work to do

- lib/util.js: add `readJson(file)`, which strips the BOM through `readText` and throws a CliError naming the file on a parse error, and `readJsonOrNull(file)`. Use them at lib/seed.js:250-257, in `init.projectName` (lib/init.js:273-277), at lib/config.js:94 and in `projectLangOrNull` (the bin/backslop.js:126 read, moved by this card). At lib/lint.js:89 (gate 11) catch the parse failure and report it as a gate error — `err(pkgFile, tr(cfg.lang, `не разбирается: ${e.message}`, `cannot be parsed: ${e.message}`))` — and skip the version comparison, so the other gates still run and report.
- lib/config.js: export `projectLangOrNull(cwd)` with the body of bin/backslop.js:122-128, reading backslop.json through `readJsonOrNull`. Use it in bin, at lib/changelog.js:40, and at lib/merge-changelog.js:365, which keeps a single `findRoot` call for `root`.
- lib/i18n.js: add `pick(lang, ru, en, both)`, where null returns `both`. Use it at bin/backslop.js:134, :141-144 and :146, and at lib/changelog.js:43-44 and :46-49. Pass the existing hand-merged strings as `both`, so the output stays byte-identical.
- merge-changelog: for messages printed before a project is known, pass explicit `both` strings to `pick`. Behaviour change: outside a project, `merge-changelog` speaks both languages.
- Add a CHANGELOG entry: `changelog` and `merge-changelog` no longer refuse because of an otherwise invalid backslop.json; `merge-changelog` outside a project prints both languages; a BOM-prefixed package.json gives its name to `init`; a malformed package.json in the tool repository is reported by gate 11 instead of a stack trace.

## Out of scope

- The `cfg.lang === 'en' ?` ternaries inside projects (new.js, mv.js, tasks.js). They belong to BS-124 (`messages-through-tr`).
- Accepting a BOM in backslop.json (done by BS-94 (`config-validation-one-rule-set`)).

## Verification

- New test in test/init.test.mjs: with a BOM-prefixed package.json named `foo-pkg`, docs/README.md starts with `# foo-pkg documentation`.
- New test in test/lint.test.mjs: a self-host fixture with a malformed package.json makes `lint` exit 1 with a `✖ …package.json: cannot be parsed` line (or the Russian twin in a ru fixture), the other gates still report, and stderr has no `SyntaxError` stack.
- New tests: in a directory with `{"prefix":"bs","lang":"en"}`, `changelog --since 0.10.0 --to 0.10.1` exits 0 in English. Outside a project, `merge-changelog` with no arguments exits 1 with both the English and the Russian text.
- Outside a project, `node bin/backslop.js help` and `node bin/backslop.js nosuch` give byte-identical output before and after the change (compare with `diff`).
- `npm test`: every test passes. `node bin/backslop.js lint` → rc=0.
