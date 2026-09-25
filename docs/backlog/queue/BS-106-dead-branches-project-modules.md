# BS-106 · Remove unused defaults and redundant guards in config, tasks, status, upgrade, gates

- **Order:** 240
- **Scope:** [Reference](../../reference/README.md)
- **Created:** 2026-09-25
- **Dependencies:** BS-104, BS-88, BS-96, BS-94, BS-92

## Context

All evidence below was taken at commit 6f6318e (v0.11.0), where `npm test` runs 450 tests (450 pass, rc=0) and `node bin/backslop.js lint` exits 0. "Removal probe" means: the change was applied in a throwaway clone at that commit, then the full suite and lint were run.

Each entry below was verified by reading every call site of the code in question and running a removal probe. Unless noted otherwise, the probe kept 450/450 and lint rc=0.

- **tasks.js: the record field `hasResult` is written in three places and read nowhere.** verified — call sites and a removal probe. It is assigned at lib/tasks.js:145 `rec.hasResult = existsSync(path.join(dirs.archive, name, 'result.md'));`, which costs one `existsSync` per archive directory on every `scanTasks`, at :156 `sub.hasResult = true;`, and at :183 `hasResult: false,`. `grep -rn hasResult lib bin scripts test templates docs` finds nothing else apart from `hasResultTodo`, which is a different identifier. No JSON output serialises task records; the `JSON.stringify` in lib/status.js:68 serialises status rows, not records.
- **status.js: the default `extra = {}` of `row()` is never used, and would throw if it were.** verified — call sites and a removal probe. `const row = (t, extra = {}) =>` is at lib/status.js:12, and :20 calls `...extra(text)`. All five callers of this local closure (:23, :24, :25, :28 and :31) pass a function. `node -e 'const row=(t,extra={})=>({...extra("x")}); try{row(1)}catch(e){console.log(e.constructor.name)}'` prints `TypeError`.
- **tasks.js: the guard in `foreignTaskIds` against a failed realpath.** verified — call sites and a removal probe; it is a race guard, not strictly unreachable code. The guard is lib/tasks.js:264 `if (!toplevel || !here) return [];`. Its only caller is lib/new.js:67. `project` comes from `loadProject`/`requireRoot` (lib/config.js:255), and `findRoot` returns a directory only after `existsSync(path.join(dir, CONFIG_FILE))` (:77), so `root` exists. `toplevel` is printed by git after `top.status !== 0` has already returned at :260. Both realpaths can fail only if the directory is deleted concurrently. Without the guard, that race surfaces as a TypeError from `path.relative(null, …)` instead of an empty list. `safeRealpath` stays because :298 uses it.
- **config.js: `defaults()` builds `gates` and `version`, and no caller reads them.** verified — call sites and a removal probe. `grep -rn 'defaults()' lib bin test scripts` finds only the definition at lib/config.js:31 and the callers at :102 and lib/init.js:66. `grep -on 'base\.[a-zA-Z]*' lib/init.js lib/config.js` shows that the callers read only prefix, docs, cli, lang and tools. init builds gates and version itself (lib/init.js:79), and loadConfig rebuilds gates from `cfg.cli` (lib/config.js:112) and deliberately never defaults version (:109). The ADR on the gates runner says `defaults()` builds `gates`; that is true today but becomes false with this change.
- **config.js: `defaultCli(version = TOOL_VERSION)` is never given a version.** verified — call sites and two removal probes (the second covers the optional step below). `grep -rnw defaultCli lib bin scripts test` finds the definition at lib/config.js:27, bare `defaultCli()` calls at lib/config.js:32 and lib/init.js:73, and a comment at test/helpers.mjs:14. A second probe also made lib/init.js:73 use `base.cli` and dropped the export and the import; that too kept 450/450 and lint rc=0.
- **init, adapters, templates: default parameters that no caller relies on.** verified — call sites and a removal probe. The defaults are `upsertBlock(file, block, lang = 'ru', …)` at lib/init.js:286, `ensureClaudeStub(root, tools, lang = 'ru')` at lib/adapters.js:237, and `vars = {}` in `renderTemplate` and `renderProjectTemplate` at lib/templates.js:27 and :35. Every call passes the argument: lib/init.js:160, :161 and :270; adr.js:35; brief.js:52 and :152; adapters.js:121; init.js:112, :124 and :141; migrate.js:36 and :52; archive.js:44; new.js:124 and :125; fold.js:74; templates.js:36; test/templates.test.mjs:135 and :146; and test/upgrade.test.mjs:191, :250 and :286. Removal does not make a missing argument fail loudly: `tr()` still yields Russian for an undefined lang (lib/i18n.js:2), and an undefined `vars` throws a TypeError from `key in vars` instead of the named 'не передан ключ' error.
- **upgrade.js: `re.lastIndex = 0` does nothing.** verified — a node probe and a removal probe. `re = pinRe(form)` is a fresh `/g` RegExp (lib/config.js:68-71), used only through `line.matchAll(re)`. `matchAll` clones the regex and never writes `lastIndex` on the source, so the reset at lib/upgrade.js:68 always writes 0 over 0. `node -e "const re=/a/g; for (const m of 'aa'.matchAll(re)){}; console.log(re.lastIndex)"` prints `0`. Caveat: `matchAll` does read the source's `lastIndex`, so the reset would matter only if someone later calls `re.test` or `re.exec` on the same regex.
- **version.js: the null-skip in `latestVersion` cannot fire from its only production caller.** verified — call sites and a removal probe. That caller is lib/upgrade.js:113, and it passes `listReleaseTags` output, which is already filtered by `/^v\d+\.\d+\.\d+$/` (:31) and normalised (:32). `parseVersion` accepts every such tag. Removing `if (n === null) continue;` at lib/version.js:33 turned exactly one test red, 'сравнение по числам, а не по строкам; старшая из списка' (test/version.test.mjs:20), because lines 25-26 feed it `'junk'`. The filter in `listReleaseTags` stays: it also guards the `--to` `tags.includes` path and the list of available versions.
- **gates.js: each `rev-parse --git-dir` probe duplicates the failure of the git call that follows.** verified — call sites and a removal probe. lib/gates.js:12 is `if (git(root, ['rev-parse', '--git-dir']).status !== 0) return null;`, and :14 already returns null when `status` fails. :88 is `git(root, ['rev-parse','--git-dir']).status === 0 ? worktreePaths(root) : null`, while `worktreePaths` returns null by itself on a failed status (:46-47). Outside a repository both commands fail the same way: `git -C nogit rev-parse --git-dir` and `git -C nogit status --porcelain -z -uall` both give rc=128. In a bare repository `rev-parse` succeeds but `status` fails, so the result is null either way. Removing both probes kept `node --test test/gates.test.mjs` at 21/21 (8 of those tests use `makeProject({ git: false })`) and the full suite at 450/450. Each call saves one git spawn. lib/show.js:25 and lib/archive.js:93 have their own probes, which are not in scope.

## Work to do

- lib/tasks.js: delete the three `hasResult` assignments at :145 (including its `existsSync`), :156 and :183.
- lib/status.js:12: change `(t, extra = {}) =>` to `(t, extra) =>`.
- lib/tasks.js:264: the BS-88 (`branch-scans-new-and-tracks`) card changed how `foreignTaskIds` lists branch trees; if the guard `if (!toplevel || !here) return [];` still exists, delete it, otherwise record in result.md that it went with that card. The trade-off is accepted: a concurrent delete now surfaces as a TypeError, not as an empty foreign list.
- lib/config.js:33: drop `gates` and `version` from the object `defaults()` returns. `TOOL_VERSION` stays imported because `defaultCli` uses it. Do not edit docs/adr/ here: the BS-149 (`gates-runner-adr`) card states that the default gates list is built by init (lib/init.js:79) and by loadConfig (lib/config.js:112).
- lib/config.js:27: make it `defaultCli()` returning `` `npx ${SOURCE}#v${TOOL_VERSION}` ``. Then have lib/init.js:73 use `values.cli ?? base.cli`, drop `defaultCli` from the init.js import, and drop its `export`. Update the comment at test/helpers.mjs:14 if it names the export.
- Remove `= 'ru'` at lib/init.js:286 and lib/adapters.js:237, and `= {}` at lib/templates.js:27 and :35.
- lib/upgrade.js:68: delete `re.lastIndex = 0;`.
- lib/version.js:33: delete `if (n === null) continue;`. test/version.test.mjs:25-26: stop passing `'junk'` and keep the numeric-order assertions.
- lib/gates.js: delete :12, and replace :88 with `const dirty = worktreePaths(root);`.

## Out of scope

- The `rev-parse --git-dir` probes in lib/show.js:25 and lib/archive.js:93.
- Removing the tag filter in `listReleaseTags` (lib/upgrade.js:31-32). It stays as the single owner of tag validation.
- The legacy `tools` inference and legacy adapter paths in config.js and adapter-ownership.js. BS-107 (`marker-only-adapter-ownership`) handles them.
- Exports. The BS-104 (`unexport-lib-internals`) card and the BS-128 (`test-only-exports-and-helpers`) card handle them.
- The unreachable `lastCreated` fallback in lib/seed.js: the BS-118 (`command-module-exports`) card deletes `lastCreated` altogether.

## Verification

- `grep -rn hasResult lib | grep -v hasResultTodo` prints nothing. `grep -n "extra = {}" lib/status.js` prints nothing. `grep -n lastIndex lib/upgrade.js` prints nothing. `grep -n "rev-parse" lib/gates.js` prints nothing.
- `grep -n "gates:\|version:" lib/config.js` shows no `defaults()` field. `grep -rn "defaultCli(" lib` shows only `lib/config.js` (the definition and :32).
- `node --test test/gates.test.mjs test/version.test.mjs test/seed.test.mjs test/init.test.mjs` gives rc=0.
- `npm test > t.out 2>&1; echo rc=$?` gives rc=0 with 0 fail and the same test count as before this card.
- `node bin/backslop.js lint > l.out 2>&1; echo rc=$?` gives rc=0.
