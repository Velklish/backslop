# BS-177 · Add the English lib/ module map with recipes for commands, lint gates, migrations, tests

- **Order:** 950
- **Scope:** [Reference](../../reference/README.md)
- **Created:** 2026-09-25
- **Dependencies:** BS-176, BS-172, BS-173, BS-174

## Context

A contributor who starts cold in this repository has no map of the 29 modules in `lib/` and no recipe for the routine changes. The dispatch rules, help text, lint-gate wiring, placeholder registry and test helpers can only be learned by reading code, and adding a command from the docs alone hits each gap below. This card adds one English reference page: a module map plus recipes.

Evidence. Every item is verified at v0.11.0 (commit 6f6318e):

1. **Command dispatch has an undocumented allowlist.** verified — in a clone. After adding `lib/foo.js` with an exported `run`, `node bin/backslop.js foo --json` gave rc=1 and `✖ неизвестная команда «foo»; список — backslop help`. After adding `'foo'` to `COMMANDS`, it gave rc=0. A `run()` that returns 3 gave rc=3. The allowlist is `COMMANDS` at `bin/backslop.js:11`, checked at `:141`, and the exit code comes from `const code = await mod.run(rest, …); return code ?? 0;` (`:150-151`). The docs say only that `lib/<command>.js` exports `run(argv, { cwd })` (`docs/reference/02-cli.md:3`). `grep -rn COMMANDS README.md AGENTS.md docs templates` finds nothing (rc=1).
2. **Help is two hand-written literals, pinned by a test.** verified — in a clone: changing `bin/backslop.js:43` from `четырнадцать гейтов:` to `пятнадцать гейтов:` made `node --test test/review.test.mjs` fail (rc=1, 1 failure, `AssertionError … did not match /четырнадцать гейтов/`, `test/review.test.mjs:107`). `HELP_RU` (`:13`) and `HELP_EN` (`:68`) are template literals, with the description column at 54 characters. The language comes from `backslop.json` `lang` (`projectLang`, `:122-128`). Outside a project, both languages are printed (`:134`). `--help` on any command prints the whole help (`:145-147`). The only doc sentence about help is `02-cli.md:29`.
3. **Adding a lint gate has no recipe.** verified — read `lib/lint.js:42-71`. `lintProject` calls 20 functions in an order unrelated to gate numbers. A gate number exists only as a `// N.` comment (for example `:83` gate 11, `:134` gate 14, `:527` gate 7) and as a row in the `03-lint.md` table. Errors go through `err(file, msg)` and warnings through `note(file, msg)` (`:46-47`). Checks that run only in the tool repo are guarded with `sameDir(path.join(root, 'templates'), TEMPLATES_DIR)` (`:86`). The word for the gate count appears in five places: `docs/reference/README.md:9`, `docs/reference/03-lint.md:28`, `bin/backslop.js:43` and `:98`, and `test/review.test.mjs:107`.
4. **Test helpers are undocumented.** verified — grepping README*, AGENTS.md, `docs/` and `templates/`: only `toolCopy` and `toolCli` are named (`03-lint.md:28`). Nothing documents these:
   - `makeProject({ git, stamp })` (test/helpers.mjs; the BS-128 (`test-only-exports-and-helpers`) card dropped `prefix` and `docs`) builds a project by hand, without `init` and with `lang: 'ru'` and `tools: []` (the BS-107 (`marker-only-adapter-ownership`) card adds both fields), so messages come out in Russian and assertions match Russian text;
   - `cli(root, args)` returns `{code, out, err}` and runs with `NO_COLOR` and `--no-warnings`;
   - the helpers `put`, `read`, `gitAll` and `cleanup`;
   - `seedGreen()` (`test/lint.test.mjs:14`) plus `probe(name, mutate, regex)` (`:43`) form the red-probe DSL for tests named `lint: N. …`;
   - command tests live in `test/commands.test.mjs`;
   - `toolCopy` copies only `bin`, `lib`, `templates` and `package.json`, so a probe puts its own `CHANGELOG.md`;
   - tests that cannot run on Windows carry `skip: process.platform === 'win32'` (for example `test/upgrade.test.mjs:318`).
5. **How migrations work.** verified — read `lib/migrate.js`:
   - A `MIGRATIONS` entry is `{since, title: {ru, en}, run(project)}` (`:14-39`). It applies when the project stamp is missing or below `since` (`:79`).
   - Both existing entries are idempotent: they return early when their file exists.
   - `RULES_DOCS` (`:43`) are re-rendered from the template whenever the stamp is below the tool version. If one of those files has an uncommitted edit, `migrate` refuses (`:61-66`).
   - Migrate tests live in `test/upgrade.test.mjs:244-318`.
6. **Module inventory.** Read from the sources; the worker re-checks each line against the file:
   - `bin/backslop.js`: CLI entry, `COMMANDS`, help, dynamic import of `lib/<cmd>.js`, `CliError` → exit 1.
   - Command modules, one per command:
     - `init.js`: layout, managed `AGENTS.md` block, `.gitignore` block.
     - `new.js`: tasks, findings, minor entries.
     - `mv.js`: status change and queue placement.
     - `archive.js`: `archive N` and `archive N.k --into M`.
     - `fold.js` and `show.js`: the journal.
     - `adr.js`: the `adr` command.
     - `brief.js`, `seed.js`, `status.js`, `gates.js`, `tracks.js`.
     - `upgrade.js`, `migrate.js`, `changelog.js`, `merge-changelog.js`.
     - `lint.js`: all lint gates.
   - Shared modules:
     - `config.js`: find, load and validate `backslop.json`; layout paths; block markers.
     - `tasks.js`: task model, ids, scan, fields, queue placement.
     - `templates.js`: strict `{{key}}` rendering, parity and slots.
     - `i18n.js`: `tr(lang, ru, en)`.
     - `util.js`: `CliError`, `ok`/`info`/`warn`/`bad`, `toPosix`, the git wrapper, `parseCommandArgs`.
     - `version.js`: `TOOL_VERSION` and version compare.
     - `mdwalk.js`: file walkers.
     - `links.js`: markdown link parse and rewrite.
     - `log.js`: `LOG.md` line format.
     - `adapters.js`, `adapters-registry.js`, `adapter-ownership.js`: harness outputs.
   - Command modules imported as libraries at 6f6318e (init imports lint, migrate imports init, mv imports lint, merge-changelog imports lint, seed imports new): the command-module, mv and section-parser cards removed these imports; record the module graph as it is when you start.
   - Code cards added leaf modules (lib/text.js, lib/ids.js, a CHANGELOG-format module, possibly lib/frontmatter.js) and moved helpers into lib/util.js and lib/templates.js (`isToolRepo`, `probeRule`, `readJson`); the table covers every file in lib/ as it is when you start.
   - `scripts/release.mjs`: bump and release.
   - `test/helpers.mjs`: project builder and CLI runner.
   - `test/comment-scan.mjs` with `test/comment-length.test.mjs`: the comment gate (`LIMIT = 2` lines, `WIDTH = 100`, trees `lib test bin scripts`).

## Work to do

- Create `docs/reference/06-module-map.md` (English, title "06. Module map", no task numbers, dates or ADR citations): entry point and dispatch (the `COMMANDS` allowlist, `run(argv, { cwd })` return value is the exit code, `CliError` for human refusals); a table of every file in `lib/` plus `bin/backslop.js`, `scripts/release.mjs` and the two test helper modules — file, responsibility, key exports — grouped as command modules and shared modules, with the command-to-command imports named (evidence item 6).
- Recipe "Add a command": `lib/<name>.js` with `run` parsing flags via `parseCommandArgs` and messages via `tr(cfg.lang, ru, en)`; add the name to `COMMANDS` (`bin/backslop.js:11`); add a line to both `HELP_RU` and `HELP_EN` keeping the 54-column alignment; a row in the `02-cli.md` command table and the README command table; tests in `test/commands.test.mjs` via `makeProject` + `cli`; a CHANGELOG entry under `## Unreleased`; an ADR only under the rule in the orchestrator contract page.
- Recipe "Add a lint gate": function `lintX(project, err)` called from `lintProject` (`lib/lint.js:42-71`), `// N. <name>` comment, `err`/`note` semantics, the tool-repo-only guard, a row in the `03-lint.md` table, a red probe `probe('N. …', mutate, /regex/)` in `test/lint.test.mjs`, and the five places that spell the gate count (evidence item 3). Link this recipe from `docs/reference/03-lint.md`.
- Recipe "Add a migration" (evidence item 5): entry shape, choosing `since`, idempotence, bilingual `title`, the `--dry-run` path, how `RULES_DOCS` differ, where tests go. Recipe "Add a template or placeholder": declare the key in `TEMPLATE_KEYS`, `renderTemplate` throws on a missing key, gate 12, ru and en files must have the same sequence of heading levels (fenced blocks ignored).
- Section "Tests": helpers with signatures and the default Russian language of `makeProject` fixtures, the `seedGreen`/`probe` DSL, where command, lint, template and release tests live, `npm test` = `node --test --test-timeout=60000`, Windows skips with `skip: process.platform === 'win32'` and a stated reason (evidence item 4). Section "Help" (evidence item 2).
- In the `02-cli.md` intro sentence about dispatch, add the allowlist and exit-code rule with a pointer to page 06. Links to the new page: a row for page 06 in `docs/reference/README.md`, the `reference/` row of `docs/README.md`, the "Working on backslop" section of README.md and the Repository section of AGENTS.md.

## Out of scope

- Code refactors suggested by the map (one constant for the gate count, a help generator, duplicated helpers, dead exports).
- Consumer-facing behaviour, which belongs to pages 01-03 and the orchestrator contract page.
- Translating the rest of pages 01-03.

## Verification

- `node bin/backslop.js lint; echo rc=$?` → rc=0; `npm test; echo rc=$?` → rc=0 with the pass count reported.
- Coverage: `for f in lib/*.js; do grep -q "$(basename $f)" docs/reference/06-module-map.md || echo missing $f; done` prints nothing; `ls lib/*.js | wc -l` equals the number of lib rows in the table.
- Recipe check in a throwaway clone: follow "Add a command" literally for a trivial `foo` → `node bin/backslop.js foo; echo rc=$?` → rc=0, `node bin/backslop.js help` shows `foo` in the project language, `npm test` rc=0; discard the clone.
- `grep -nE 'ADR-[0-9]|BS-[0-9]' docs/reference/06-module-map.md; echo rc=$?` → rc=1.
