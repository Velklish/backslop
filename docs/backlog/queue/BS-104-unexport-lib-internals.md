# BS-104 · Make lib names that nothing outside their file uses module-private

- **Order:** 220
- **Scope:** [Reference](../../reference/README.md)
- **Created:** 2026-09-25
- **Dependencies:** BS-89, BS-98

## Context

All evidence below was taken at commit 6f6318e (v0.11.0), where `npm test` runs 450 tests (450 pass, rc=0) and `node bin/backslop.js lint` exits 0. "Removal probe" means: the change was applied in a throwaway clone at that commit, then the full suite and lint were run.

`bin/backslop.js:149-150` loads a command module with `await import(`../lib/${name}.js`)` and touches only `mod.run`. `package.json` has no `exports` map, and no doc presents `lib/` as a programmatic API. An `export` on a name that only its own file uses therefore just widens the surface and hides dead code from review. Each entry was checked with `grep -rnw <name> lib bin scripts test templates docs`. Namespace or dynamic imports of these modules were ruled out with `grep -rn "import \* as\|import(" lib bin scripts test`: the only hit is bin/backslop.js:149.

- **Unused import in lint.js; `liveMarkdown` and `SKIP_RELS` exported for nobody.** verified — grep and a removal probe (450/450, lint rc=0). `lib/lint.js:8` is `import { liveMarkdown, livePinFiles, mdFiles } from './mdwalk.js';`, and lint.js never calls `liveMarkdown`. The grep finds it only at lint.js:8 (the import), mdwalk.js:98 (the definition), mdwalk.js:112 (a comment) and mdwalk.js:127 (a call inside `livePinFiles`). `SKIP_RELS` appeared only at mdwalk.js:14, :49 and :82; it keeps its export, because the BS-98 (`seed-scan-and-queue-reference`) card made lib/seed.js import it.
- **Duplicate import in changelog.js.** verified — grep and a probe (450/450, lint rc=0). `grep -n "from './version.js'" lib/changelog.js` prints `4:import { compareVersions, normalizeVersion } from './version.js';` and `6:import { TOOL_VERSION } from './version.js';`.
- **links.js exports names that only links.js uses.** `EXTERNAL` keeps its export: the BS-89 (`link-gate-target-resolution`) card made lib/seed.js import it. verified — grep and a probe (450/450, lint rc=0). The names are `INLINE_LINK` (:8, used at :81 and :127), `REF_DEFINITION` (:12, used at :70), `EXTERNAL` (:21, used at :156), `blankSpans` (:53, used at :58) and `mapHrefs` (:152, used at :175, :189 and :214). The test file's import at test/links.test.mjs:9 names none of them.
- **`lintChangelog` is exported for nobody, and its `lang = 'ru'` default never applies.** verified — grep and a probe (450/450, lint rc=0). The grep finds only lib/lint.js:60 `lintChangelog(root, err, cfg.lang);` and lib/lint.js:528 `export function lintChangelog(root, err, lang = 'ru') {`. `cfg.lang` is always set: loadConfig fills it in at lib/config.js:111 and rejects any value outside `LANGS` at :123. An instrumented run of the full suite recorded zero calls with `lang` undefined.
- **`lintProject` destructures `dirs` and never uses it.** verified — a probe (450/450, lint rc=0). `sed -n 42,71p lib/lint.js | grep -n dirs` prints a single hit, `const { root, cfg, dirs } = project;` at lib/lint.js:43.
- **`ADAPTERS` is exported, but only the registry module uses it.** verified — grep and a probe (450/450, lint rc=0). It appears only at lib/adapters-registry.js:4 (the definition), :10 (`TOOLS`) and :12 (`ADAPTER_ROOTS`). docs/reference/01-layout.md:28 describes the registry by its content, not by this name.
- **status.js exports `collectStatus` and `renderStatus` for nobody.** verified — grep and a probe (450/450, lint rc=0). They appear only at lib/status.js:10, :47, :67 and :68.
- **tasks.js exports `RANK_STEP`, `nextRank` and `moveFile`, which only tasks.js uses.** verified — grep and a probe (450/450, lint rc=0). The definitions are at lib/tasks.js:65, :503 and :574, with internal uses at :505, :512, :549, :557, :560, :564 and :591. Outside lib they appear only in comments at test/archive.test.mjs:125 and :148, and in prose in docs/archive/LOG.md. Nothing imports them.
- **log.js `hasLog` and `logHref` have never had a caller.** verified — grep, history and a probe (450/450, lint rc=0). `grep -rnw hasLog lib bin scripts test templates docs README.md CHANGELOG.md` finds only `lib/log.js:177:export function hasLog(dirs) {`, and the same grep for `logHref` finds only lib/log.js:211. `git log --oneline -S'hasLog(' -- lib bin test` shows only the commit that added them. The `existsSync` import at lib/log.js:3 is used only inside `hasLog`, at :178. `path.join` at :174 still needs the `path` import. Links into the journal are rewritten in lib/fold.js via `logAnchor`.
- **log.js and changelog.js export four names that only their own file uses.** verified — grep and a probe (450/450, lint rc=0). They are `UNKNOWN` (lib/log.js:11, used at :28, :60-62, :94 and :105), `logLineRe` (:23, used at :38), `LOG_ENTRY_HINT` (:35, used at :195 and :206) and `changelogSections` (lib/changelog.js:13, used at :31). The ADR on changelog merging names `changelogSections` in prose only.
- **Five more exports with no consumer outside their file.** verified — grep and a probe (450/450, lint rc=0). They are `requireRoot` (lib/config.js:84, used at :255), `upsertBlock` (lib/init.js:286, used at :160 and :270), `TEMPLATE_KEYS` (lib/templates.js:15, used at :112-132), `RULES_DOCS` (lib/migrate.js:43, used at :50) and `rewriteProsePins` (lib/upgrade.js:48, used at :153). test/templates.test.mjs:118, :120 and :130 only match the string `'TEMPLATE_KEYS:'` inside error messages, and the docs name these functions only in prose. `MIN_UPGRADE_TARGET` (lib/upgrade.js:13) is left out here because the BS-108 (`drop-pre-floor-version-gates`) card deletes it outright.
- **config.js re-exports `TOOLS` only to hand it to init.js.** verified — grep and a probe (450/450, lint rc=0). `lib/config.js:17` is `export { TOOLS };`. lib/init.js:6 is its only consumer, and lib/init.js:9 already imports `adapterRootRel` from `./adapters-registry.js`. Every other module imports `TOOLS` from the registry directly (adapter-ownership.js:2, adapters.js:8, mdwalk.js:6), and no test or script imports it.

## Work to do

- Before dropping each export, re-run `grep -rnw <name> lib bin scripts test`: bug cards earlier in the queue may have started importing a name elsewhere; such a name keeps its export.
- lib/lint.js:8: remove `liveMarkdown` from the import list. In lib/mdwalk.js, drop `export` from `liveMarkdown` (:98); keep `SKIP_RELS` exported (lib/seed.js imports it since the BS-98 (`seed-scan-and-queue-reference`) card).
- lib/changelog.js:4,6: merge the two imports into `import { TOOL_VERSION, compareVersions, normalizeVersion } from './version.js';`.
- lib/links.js: drop `export` from `INLINE_LINK` (:8), `REF_DEFINITION` (:12), `blankSpans` (:53) and `mapHrefs` (:152); keep `EXTERNAL` exported (lib/seed.js imports it since the BS-89 (`link-gate-target-resolution`) card).
- lib/lint.js:528: drop `export` and the `= 'ru'` default from `lintChangelog`. lib/lint.js:43: remove `dirs` from the destructuring.
- lib/adapters-registry.js:4: drop `export` from `ADAPTERS`.
- lib/status.js:10,47: drop `export` from `collectStatus` and `renderStatus`.
- lib/tasks.js:65,503,574: drop `export` from `RANK_STEP`, `nextRank` and `moveFile`.
- lib/log.js: delete `hasLog` (:177-179) and `logHref` with its comment (:210-213), and remove the now-unused `existsSync` import (:3). Keep the `path` import, which `path.join` at :174 still uses.
- lib/log.js:11,23,35 and lib/changelog.js:13: drop `export` from `UNKNOWN`, `logLineRe`, `LOG_ENTRY_HINT` and `changelogSections`.
- Drop `export` from `requireRoot` (lib/config.js:84), `upsertBlock` (lib/init.js:286), `TEMPLATE_KEYS` (lib/templates.js:15), `RULES_DOCS` (lib/migrate.js:43) and `rewriteProsePins` (lib/upgrade.js:48).
- Delete `export { TOOLS };` at lib/config.js:17. Import `TOOLS` in lib/init.js from `./adapters-registry.js` by merging it into the import at line 9, and remove it from the `./config.js` import at line 6.

## Out of scope

- `MIN_UPGRADE_TARGET` (lib/upgrade.js:13). The BS-108 (`drop-pre-floor-version-gates`) card deletes it together with its guard.
- Exports whose only outside consumer is a test (`refDefinitions`, `isAdapterRel`, `readFields`, `parseVersion`, `BLOCK_MARKER_RE`, and others). BS-128 (`test-only-exports-and-helpers`) handles them.
- Never-passed parameters and unreachable branches other than the `lintChangelog` default. BS-105 (`dead-branches-markdown-journal`) and BS-106 (`dead-branches-project-modules`) handle them.
- Adding an `exports` map to package.json, or any other change to the package surface.

## Verification

- `for n in liveMarkdown INLINE_LINK REF_DEFINITION blankSpans mapHrefs lintChangelog ADAPTERS collectStatus renderStatus RANK_STEP nextRank moveFile UNKNOWN logLineRe LOG_ENTRY_HINT changelogSections requireRoot upsertBlock TEMPLATE_KEYS RULES_DOCS rewriteProsePins; do grep -rnw "export.*$n" lib; done` prints nothing.
- `grep -rnw -e hasLog -e logHref lib bin scripts test` prints nothing (rc=1). `grep -n "export { TOOLS }" lib/config.js` prints nothing (rc=1).
- `grep -c "from './version.js'" lib/changelog.js` prints 1.
- `npm test > t.out 2>&1; echo rc=$?` gives rc=0 with 0 fail and the same test count as before this card. No test is added or removed.
- `node bin/backslop.js lint > l.out 2>&1; echo rc=$?` gives rc=0.
