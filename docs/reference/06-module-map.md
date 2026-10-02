# 06. Module map

Where things live in the tool's own code, and the routine changes spelled out step by step: a command, a lint gate, a migration, a template placeholder. Start here when you change `bin/`, `lib/`, `scripts/` or the test helpers; behaviour as a user or an orchestrator sees it is on pages [01](01-layout.md) to [05](05-orchestrator-contract.md).

The page names code by file and by identifier, not by line: find a line with `grep -n`.

## Entry point and dispatch

[bin/backslop.js](../../bin/backslop.js) is the only executable of the CLI. `main` reads the first argument and then:

1. Reads the project language and the `cli` spelling loosely with `projectHintsOrNull` (`lib/config.js`): no project gives `lang` `null`, a broken config gives `ru`. The rest of the config is not validated here.
2. Answers `help`, `--help`, `-h` and no argument with the help text, and `version`, `--version`, `-v` with `backslop <TOOL_VERSION>`; both exit 0.
3. Checks the name against the **`COMMANDS` allowlist**, a literal array in `bin/backslop.js`. A name outside it is a refusal: `unknown command “<name>”; see <cli> help`. A `lib/<name>.js` with a `run` that is not listed is never imported.
4. Imports `lib/<name>.js` dynamically and calls `run(argv, { cwd, lang })`, where `argv` is what follows the command name, `cwd` is `process.cwd()` and `lang` is the loose language of step 1.

**The return value of `run` is the exit code.** `return 0`, or no return at all (`undefined` counts as 0), is success; `return 1` is a red result such as `lint` with errors; any other integer is passed to the process as it is. `run` may be `async`.

**A human refusal is a `CliError`** (`lib/util.js`). A command throws it for anything the reader can fix: a bad flag, an unknown task number, a config that breaks a rule. The entry point prints `✖ <message>` on stderr and exits 1, with no stack trace. Any other exception is a crash: the stack goes to stderr and the exit code is 1 as well; a crash is a code error and is never thrown on purpose. The table of exit codes and output channels is in [05](05-orchestrator-contract.md#exit-codes).

**Output helpers** (`lib/util.js`): `ok` prints `✔ <msg>` on stdout, `info` an indented line on stdout, `warn` prints `⚠ <msg>` on stderr, `bad` prints `✖ <msg>` on stderr without exiting, and `note` an unmarked indented line on stderr. JSON goes out through `printJson`. A printed path goes through `toPosix`.

**Flags.** `parseCommandArgs(argv, options, { positionals, lang })` wraps `util.parseArgs` in strict mode. `options` is the `parseArgs` option map; `positionals` is the most positional arguments the command takes. It returns `{ values, positionals }`. It throws `CliError` for an unknown flag or an extra argument, and `HelpRequest` for `-h` or `--help`, which `main` catches and answers with the help text, exit 0. Every command calls it before it loads the project.

**Messages.** Every user-facing message is written once, in English, as the key of `msg(lang, en, params)` from `lib/i18n.js`: `{name}` in the text takes `params.name`, and a function param is called with the language of the text it fills. For `en` the lookup returns the English text; otherwise it returns the Russian entry of the same key in [templates/i18n/ru.mjs](../../templates/i18n/ru.mjs), the CLI's Russian localization, and a key without an entry falls back to the English. An entry is a string with a subset of the key's placeholders, or a function of the params, for word order, plural forms and a text that differs by context. Once the config is loaded the language is `cfg.lang`; before that, it is the `lang` passed to `run`. Outside a project that `lang` is `null`, and `msgBoth(lang, en, params)` returns both texts, `en / ru`, or the entry of the same key in `both` of that module when the two-language form is another. The key is a string literal at the call: `test/i18n.test.mjs` reads every key in `lib/` and `bin/` and fails on a key without an entry, on an entry no call uses, on a key written twice in the module, on one English text under two keys that differ only in placeholder names, and on a call whose params object has no param for a placeholder of its key. JSON output is language-neutral.

## Modules

`lib/` has 37 files. Every command is one module; the rest are shared. `lib/<name>.js` that exports `run` is a command only if it is in `COMMANDS`.

### Command modules

| File | Responsibility | Key exports |
|---|---|---|
| `lib/init.js` | `init`: the layout of a project: `backslop.json`, the docs skeleton, the skills of the selected adapters, the managed `AGENTS.md` block, the `.gitignore` block; idempotent | `run`, `readManaged` |
| `lib/new.js` | `new`: a task, a finding or a minor entry; the file comes from a template, the number from `createTask` in `lib/tasks.js` | `run` |
| `lib/mv.js` | `mv`: a status change with `git mv`, the status fields, queue placement, `--restore` | `run` |
| `lib/archive.js` | `archive N` and `archive N.k --into M`: the move into the archive, the `result.md` draft, links fixed both ways | `run` |
| `lib/fold.js` | `fold`: an archived task directory becomes one line of `LOG.md`; the body stays in git | `run` |
| `lib/show.js` | `show N`: the body of a folded task, read from git | `run` |
| `lib/adr.js` | `adr`: the next numbered ADR from a template | `run` |
| `lib/brief.js` | `brief`: the worker brief, printed on stdout from disk data and the flags the orchestrator passes | `run` |
| `lib/seed.js` | `seed`: candidates for `gates` and for subsystems with evidence; `--queue-reference` queues the reference tasks | `run` |
| `lib/status.js` | `status`: the summary of active work, the queue, deferred work, triage and minor entries; `--json` | `run` |
| `lib/lint.js` | `lint`: every lint gate, in `lintProject`, which also returns what gate 1 read; the exit code is 1 with errors | `lintProject`, `run` |
| `lib/gates.js` | `gates`: runs the `gates` list of `backslop.json`, the exit code of each command, the tree snapshot | `run`, `globToRe` |
| `lib/tracks.js` | `tracks`: worktrees and run branches, merged or not, what is left and what is dirty | `run` |
| `lib/links.js` | `links`: `links --external`, the http(s) addresses of the gate 1 file set, one request at a time, the class of each answer, the exit code. Also the one parser of every link form that gates 1, 8, 13 and 15 and `seed` read, heading anchors, the gate 1 check of a file, directory links, the rewrite on a move, a fold or an archive (every form gate 1 reads, in the syntax it was written) | `run`, `classifyStatus`, `externalUrls`, `linksOf`, `localLinks`, `relativeLinks`, `checkLinks`, `anchorsOf`, `anchorReader`, `slugOf`, `uniqueSlugs`, `hasAnchor`, `directoryLinks`, `mapLinks`, `rebaseTarget`, `rewriteMovedLinks`, `rewriteFoldedLinks`, `blankFences`, `CODE_SPAN` |
| `lib/hook.js` | `hook`: the agent hook command; the session record in the git directory, the changed set, the errors of `lintProject` in it, the protocol of each harness, the loop ceiling | `run` |
| `lib/upgrade.js` | `upgrade`: the tag, the trial run, the pins in `cli`, `gates` and live files; then it starts `migrate` and `init` of the new version as child processes and prints the CHANGELOG entries | `run`, `listReleaseTags`, `rewriteCommand`, `rewriteGates`, `rewriteProsePins` |
| `lib/migrate.js` | `migrate`: the `MIGRATIONS` list and the redraw of the rules pair; writes the version stamp | `MIGRATIONS`, `run` |
| `lib/changelog.js` | `changelog`: the tool's CHANGELOG entries between two versions | `run`, `changelogSince` |
| `lib/merge-changelog.js` | `merge-changelog`: a merge of two `CHANGELOG.md` revisions by entry heading | `run`, `mergeChangelog`, `CONFLICT_MARK` |

**Commands that import commands.** Five imports cross from one command module to another, all for a function and never for `run`; `test/module-imports.test.mjs` fails on any import outside its `ALLOWED` list:

- `lib/lint.js` imports the link functions of gate 1 from `lib/links.js`;
- `lib/migrate.js`, `lib/seed.js` and `lib/fold.js` import link functions from `lib/links.js`.
- `lib/hook.js` imports `lintProject` from `lib/lint.js`.

What command modules share lives in shared modules: the ADR scan in `lib/adr-scan.js`, which `adr`, `init` and `lint` import, and `livePinText` in `lib/mdwalk.js`, which `lint` and `upgrade` import.

`lib/links.js` is a command module that shared modules import too: `lib/adapters.js`, `lib/tasks.js` and `lib/templates.js` read its parser. It imports `config`, `i18n`, `mdwalk` and `util` for its command, none of which reaches `links` back.

`upgrade` does not import `migrate` or `init`: it runs them as `<new cli> migrate` and `<new cli> init`, so the new version does the work.

### Shared modules

| File | Responsibility | Key exports |
|---|---|---|
| `lib/config.js` | find, load and validate `backslop.json`; the layout paths; the managed-block markers; the `cli` spelling and its pin | `loadProject`, `loadConfig`, `validateConfig`, `saveConfig`, `layout`, `findRoot`, `projectHintsOrNull`, `CONFIG_FILE`, `STATUSES`, `LANGS`, `BLOCK_MARKERS`, `parseCli`, `pinRe`, `SOURCE` |
| `lib/tasks.js` | the task model: a scan of the status directories and the archive, names and headers, the field and section names, queue order and placement, `createTask` | `scanTasks`, `findTask`, `getField`, `setField`, `sectionBody`, `queueOrder`, `placeInQueue`, `relocateTask`, `createTask`, `COST_LEVELS`, `SLUG_RE` |
| `lib/templates.js` | strict `{{key}}` rendering, the `TEMPLATE_KEYS` registry, the ru/en parity check, the probe slots, the tool-repository sign | `renderTemplate`, `renderProjectTemplate`, `templateRel`, `templateParity`, `templateSlots`, `probeSlots`, `isToolRepo`, `TEMPLATES_DIR` |
| `lib/i18n.js` | the message lookup by English key, and the Russian localization `templates/i18n/ru.mjs` as `RU`: its messages, help text and parser words | `msg`, `msgBoth`, `RU` |
| `lib/util.js` | `CliError` and `HelpRequest`, the output helpers, `parseCommandArgs`, `toPosix`, file read and write, the git wrapper and its helpers, the shell runner | `CliError`, `HelpRequest`, `parseCommandArgs`, `ok`, `info`, `warn`, `bad`, `note`, `printJson`, `toPosix`, `today`, `git`, `insideRepo`, `readText`, `writeText`, `readJson`, `runShell` |
| `lib/version.js` | the tool version and version comparison | `TOOL_VERSION`, `compareVersions`, `normalizeVersion`, `latestVersion`, `stampNewerHead` |
| `lib/mdwalk.js` | the markdown walkers: one set of files for the gates and for the commands that rewrite links, with `linkGateFiles`, the set gate 1 checks and `migrate` and `links --external` read; the live-pin files | `mdFiles`, `rootMarkdown`, `linkGateFiles`, `repoMarkdown`, `srcFiles`, `livePinFiles`, `livePinText`, `stalePins`, `symlinkComponent`, `UnreadableDir` |
| `lib/adr-scan.js` | the ADR files of a project: the file name pattern, the scan by number and the number format; `adr`, `init` and `lint` read it | `scanAdrs`, `formatAdrNumber`, `ADR_FILE_RE` |
| `lib/log.js` | the line format of `LOG.md`: parse, format, anchors, reading and appending | `parseLogLine`, `formatLogLine`, `logFile`, `readLogText`, `appendLogLines`, `logAnchor`, `brokenLogLines` |
| `lib/ids.js` | task ids `<prefix>-N[.k]`: parsing, formatting, the slug and file-stem patterns, the commit subject pattern. Imports only `util` | `formatId`, `matchId`, `SLUG_SRC`, `taskStemSrc`, `taskSubjectRe` |
| `lib/text.js` | lines and line endings of a text file. A leaf module | `eolOf`, `splitLines` |
| `lib/frontmatter.js` | a YAML frontmatter field of a skill file | `FRONTMATTER`, `frontmatterField` |
| `lib/changelog-format.js` | the structure of `CHANGELOG.md` shared by `changelog`, `merge-changelog`, `lint` and `scripts/release.mjs` | `CHANGELOG_ENTRY`, `sectionVersion`, `splitSections`, `unreleasedIndex`, `taggedVersions` |
| `lib/adapters.js` | the harness outputs of the selected adapters: render, remove, and the Claude stub | `renderAdapters`, `cleanupAdapters`, `checkAdapterRoots`, `ownedAdapterFiles`, `generatedAdapterFiles`, `ensureClaudeStub`, `CLAUDE_STUB` |
| `lib/adapters-registry.js` | the single list of adapters with the root directory of each; it imports nothing | `TOOLS`, `ADAPTER_ROOTS`, `adapterRootRel`, `validTools` |
| `lib/adapter-ownership.js` | the generated marker: what makes an adapter output owned by the tool | `markGenerated`, `hasGeneratedMarker`, `isOwnedAdapterFile`, `adapterRel`, `GENERATED_MARKER` |
| `lib/hooks-install.js` | the agent hook records of the selected `hooks` in the project hook files of the harnesses: the plan `init` writes and removes, the `lint` errors | `planHooks`, `applyHooks`, `hookErrors`, `hookFileRel`, `hookCommand`, `promptobusCollisions` |
| `lib/legacy-roadmap.js` | the text of the retired `docs/ROADMAP.md` and its `docs/README.md` lines, which the migration compares against | `LEGACY_ROADMAP`, `LEGACY_README_LINES` |

**Import rules that keep the graph acyclic.** `lib/text.js`, `lib/i18n.js` and `lib/adapters-registry.js` import nothing from `lib/`, and `lib/version.js` and `lib/legacy-roadmap.js` only `i18n`; `lib/frontmatter.js` imports only `text`, and `lib/ids.js` only `util`. `lib/log.js` does not import `lib/tasks.js` because `tasks` reads the journal; a helper that both need goes into the lower module. `lib/links.js` imports `lib/mdwalk.js` and not the other way round, which is why `linkGateFiles` lives in `mdwalk`.

### Everything outside `lib/`

| File | Responsibility | Key exports |
|---|---|---|
| `bin/backslop.js` | the CLI entry: `COMMANDS`, the English help literal, the dynamic import of `lib/<command>.js`, the exit code | none |
| `scripts/release.mjs` | `npm run release`: `--bump` and the release checks; it uses `lib/util.js`, `lib/changelog-format.js` and `lib/version.js` | none |
| `test/helpers.mjs` | the project builder, the CLI runner, the tool copy for self-host probes | `makeProject`, `cli`, `run`, `gitAll`, `put`, `read`, `cleanup`, `toolCopy`, `toolCli`, `changelogTool`, `resultTemplateParagraphs`, `BIN`, `REPO` |
| `test/comment-scan.mjs` | the comment scanner behind the comment gate: `LIMIT` is 2 lines, `WIDTH` is 100 code points, over the trees `lib`, `test`, `bin` and `scripts` | `LIMIT`, `WIDTH`, `maskedLines`, `scannedCode`, `longBlocks`, `wideLines` |

## Recipe: add a command

Take `foo` as the name; the command is a read-only one that prints a line.

1. **The module.** Create `lib/foo.js`:

   ```js
   import { loadProject } from './config.js';
   import { ok, parseCommandArgs } from './util.js';
   import { msg } from './i18n.js';

   export async function run(argv, { cwd, lang }) {
     parseCommandArgs(argv, {}, { positionals: 0, lang });
     const { cfg } = loadProject(cwd);
     ok(msg(cfg.lang, 'foo: done in {docs}', { docs: cfg.docs }));
     return 0;
   }
   ```

   Parse flags with `parseCommandArgs` before anything else, with the `lang` that `run` received (the project is not loaded yet). Load the project with `loadProject(cwd)`; from then on use `cfg.lang`. Throw `CliError` for a refusal a human can fix. Every message is an English key with its Russian entry in `messages` of [templates/i18n/ru.mjs](../../templates/i18n/ru.mjs): here the key `'foo: done in {docs}'` and its Russian text with the same `{docs}`; see [Messages](#entry-point-and-dispatch). A path in a message goes through `toPosix`. A command that only needs the language, as `changelog` does, skips `loadProject`.
2. **The allowlist.** Add `'foo'` to `COMMANDS` in `bin/backslop.js`. Without it the command answers `unknown command “foo”` with exit 1.
3. **The help.** Add one line to `HELP_EN` in `bin/backslop.js` and one to `help` in `templates/i18n/ru.mjs`, in the same position, following the rules of [Help](#help): the description starts at column 54, and a synopsis longer than that puts the description on the next line. Nothing else in the help text changes unless the command adds a gate count or a shared rule.
4. **The docs.** A row in the command table of [02. CLI](02-cli.md) and a `### foo` section under it; the list of positional-argument counts in the "Flag parsing" paragraph of that page; a row in the command table of the README. If an orchestrator will depend on the command, [05](05-orchestrator-contract.md) gets its channel and exit-code lines.
5. **The tests.** In `test/commands.test.mjs`, a test that builds a project with `makeProject()`, runs `cli(root, ['foo'])` and asserts `code`, `out` and `err`; see [Tests](#tests). Add the command to the two tests that loop over every command: "an extra positional is refused" in `test/commands.test.mjs`, with one argument beyond the command's limit, and "a non-string prefix is refused by every command" in `test/config.test.mjs` when it loads the config.
6. **The CHANGELOG.** One entry under `## Unreleased` in `CHANGELOG.md`, with a bold title that is unique within the section (lint gate 7).
7. **The ADR.** A contract change — file formats, commands, the composition of `status --json` — needs an ADR: a new one for a new question, or the ADR that decides the question rewritten in place (docs/README.md, principle 2), as [05 § Changing the contract](05-orchestrator-contract.md#changing-the-contract) states it; what the contract covers is listed in [05 § What is stable](05-orchestrator-contract.md#what-is-stable).

## Recipe: add a lint gate

A gate is a function in `lib/lint.js` that `lintProject` calls. Gates are numbered; the number exists only in a `// N.` comment and in the docs.

1. **The function.** Write `function lintX(project, err)`; `project` is `{ root, cfg, dirs }`, destructured in the signature as the others do. Add `note` as a third argument when the gate also warns. `err(file, msg)` records an error that turns `lint` red (exit 1); `file` is an absolute path and is printed relative to the project root. `note(file, msg)` records a warning that is printed and does not change the exit code. The message is `msg(cfg.lang, en, params)` with its Russian entry in `templates/i18n/ru.mjs`.
2. **The comment.** Put `// N. <what the gate checks>` above the function, where `N` is the next free number. The call order in `lintProject` is unrelated to the numbers: several functions may share a number (gate 4), and some calls carry none (the adapter outputs, the version warning, the live pins, template parity are checks outside the numbered gates).
3. **The call.** Add `lintX(project, err);` to `lintProject`, destructuring what it needs there.
4. **The tool-repository guard.** A gate that only makes sense in the tool's own repository starts with `if (!isToolRepo(root)) return;`. `isToolRepo` (`lib/templates.js`) compares the realpath of `<root>/templates` with the running tool's `templates/`; gates 11, 12 and 14 and template parity use it.
5. **The docs.** A row in the table of [03. Lint gates](03-lint.md): the gate, what it catches, how to fix it. The [link rule](03-lint.md#link-rule) and the other sections change only if the gate touches them.
6. **The red probe.** In `test/lint.test.mjs` add `probe('N. <case>', (root) => put(root, '<path>', '<bad text>'), errRe('<file>', '<English message key>', { params }))`. `probe` builds a green project with `seedGreen`, applies the mutation, runs `lintProject` in process and asserts that some error matches the regular expression; a gate that cannot be reddened is not a gate. The case the gate accepts goes in `greenProbe(name, mutate)`, which asserts no errors. Extend `seedGreen` only when the new gate needs content that the green project lacks, and keep it green for every other probe; a fixture that rewrites every Markdown file keeps at least one link, or gate 1 reports `gate 1 read nothing`. A tool-repo-only gate is probed with `toolProbe(name, mutate, regex)`, or with `toolProject` when the probe also needs a green half, because the plain fixture never switches the gate on; see [The lint probe DSL](#the-lint-probe-dsl).
7. **The count.** The number of gates is spelled as a word in five places; change every one, or the help, the docs and a test disagree:
   - `HELP_EN` in `bin/backslop.js`, in the `lint` line (`fifteen gates:`), with the list of what the gates check;
   - `help` in `templates/i18n/ru.mjs`, in the same line in Russian, with the same list;
   - the row of page 03 in [docs/reference/README.md](README.md);
   - the heading `## Checks outside the fifteen gates` in [03-lint.md](03-lint.md), and the link to its anchor `#checks-outside-the-fifteen-gates` in the table of that page;
   - the assertion `/fifteen gates/` in `test/review.test.mjs`, the help test; the Russian count word has no literal check: the Russian help is compared whole with `RU.help` and its grid is pinned, but the word itself is not.
8. **The CHANGELOG.** An entry under `## Unreleased`.

## Recipe: add a migration

A migration rewrites the files of a project when its layout format changes. It is an entry in the `MIGRATIONS` array of `lib/migrate.js`:

```js
{
  since: '0.13.0',
  title: (lang) => msg(lang, '…'),
  plan(project, rules) { … },       // optional: decides what to do, writes nothing
  report(project, plan, dry) { … }, // optional: prints what happened or would happen
  run(project, plan) { … },         // does the writing
}
```

- **`since`** is the release whose stamp the project must be below for the migration to run: it runs when `backslop.json` has no `version` stamp or the stamp is lower than `since`. It is the version that ships the format change. The entry may not name a version above `TOOL_VERSION`: `test/version.test.mjs` fails on it, because at the tool's own version the stamp is never written again and such an entry would print as due on every start. `since` is the version the release will ship; how and when the package version is raised is in [AGENTS.md § Release](../../AGENTS.md#release), and the test wants the number raised before the entry lands.
- **`title`** is a function of the language that returns a message, with the Russian entry in `templates/i18n/ru.mjs`. `migrate` prints it as `migration through v<since>: <title>` in the project language, and appends `(--dry-run)` in a dry run.
- **Idempotence.** The body must be safe to run twice: `migrate` runs again on a project at a lower stamp, and `upgrade` calls it on every update. The journal entry returns at once when `LOG.md` exists; the roadmap entry plans only a file that still equals the retired text, so a second pass finds nothing.
- **`--dry-run`.** `migrate --dry-run` calls `plan`, never calls `run`, calls `report(project, plan, true)` and never writes the stamp. A migration that can refuse (an uncommitted edit of a file it would replace) decides in `plan`, so the refusal also happens in a dry run and before the first write. Without `plan` and `report` the dry run prints only the title line of that migration.
- **`RULES_DOCS` are not migrations.** The rules pair (`backlog/README.md` and `archive/README.md`) is redrawn from the template by `planRules` on every `migrate`, below the tool's version or, at the same version, only when the file is an untouched render (or the render of the other language). It has no `since`, it refuses on an uncommitted edit before the first write, and a path behind a symlink is skipped with a warning. A change to those two templates needs no `MIGRATIONS` entry.
- **Docs.** The `migrate` section of [02. CLI](02-cli.md) lists each migration and its refusal, and [01](01-layout.md) describes the format. A format change that an orchestrator reads is a contract change, see [05 § Changing the contract](05-orchestrator-contract.md#changing-the-contract).
- **Tests.** Migration tests are in `test/upgrade.test.mjs`, which builds a project with `makeProject({ stamp: false })` or an older stamp and runs `cli(root, ['migrate'])` and `cli(root, ['migrate', '--dry-run'])`; the journal migration also has a test in `test/fold.test.mjs`, and the language of the migration messages is in `test/commands.test.mjs`. A test per case: due without a stamp, dry run writes nothing, a second run changes nothing, a refusal leaves the stamp untouched.
- **CHANGELOG.** An entry, placed as [AGENTS.md § Release](../../AGENTS.md#release) describes.

## Recipe: add a template or placeholder

Everything the tool lays into a project comes from `templates/`. `templates/en/**` is the source layer, and its Russian twin in `templates/**` keeps the same file set. The two layers change in one commit. `templates/vendor/` holds third-party skills outside both layers: no twin, no rendering.

1. **The pair.** Add or edit the file in `templates/en/<rel>` and in `templates/<rel>`. Render with `renderProjectTemplate(cfg, '<rel>', vars)`, which picks the layer by `cfg.lang` (`templateRel`), or with `renderTemplate(rel, vars)` for a path that already names the layer.
2. **The placeholder.** `{{name}}` is letters and underscores. Pass every name in `vars` at each call. `renderTemplate` throws an `Error` when a placeholder has no key in `vars` (`<rel>: placeholder {{name}} is given no key name`, printed in Russian in every project): a literal `{{name}}` never reaches a reader, and the throw is a crash, not a refusal.
3. **The key registry.** Declare the key in `TEMPLATE_KEYS` in `lib/templates.js`: one row per template group, a regular expression over the path below `templates/` and the list of keys the callers pass. The docs, skills and `agents-section.md` templates share one row, because `init` and the adapter renderer fill them with one set of variables. A new template file whose path no row matches needs a new row.
4. **Gate 12** (tool repository only) checks the registry in both directions and in both layers: a placeholder with no key in its group, a file with placeholders and no row, and a declared key that no template of its group uses. It calls `templateSlots`.
5. **Parity** (a check outside the numbered gates, tool repository only) calls `templateParity`, which skips `templates/vendor/`: the same set of files in both layers, the same set of placeholders in each pair, skill frontmatter with `name` equal to the directory name and a non-empty `description`, no Cyrillic in the English layer, and the same sequence of heading levels in each pair. The heading levels are read outside fenced code blocks, so a `# ` inside a fence is not a heading.
6. **Rendered files in `docs/`.** The templates of `docs/backlog/README.md`, `docs/archive/README.md` and the header of `docs/archive/LOG.md` are rendered into this repository's own `docs/` in the project language (`en`). Change the template and the rendered file in the same commit, or `npm test` fails on "self-host: the rules pair and the LOG header in docs/ are the render of the template in the project language" in `test/templates.test.mjs`. Every other file in `docs/` is project content and diverges from its template on purpose.
7. **The tests.** `test/templates.test.mjs` holds the parity, slot, `renderTemplate` and self-host render tests; the gate 12 probe is in `test/lint.test.mjs` (`withSlot`), and it asserts red without the key and green with it. The check on the Russian twin is by sequence of heading levels and placeholders only: grep the twin for the sentence you changed.

## Tests

`npm test` is `node --test --test-timeout=60000`: Node's test runner over `test/*.test.mjs`, 60 seconds per test, no dependencies. `node --test test/lint.test.mjs` runs one file. The repository gates are `node bin/backslop.js lint` and `npm test`.

### Helpers

Both helper modules are in `test/`; everything below is exported from [test/helpers.mjs](../../test/helpers.mjs) unless noted.

| Helper | What it does |
|---|---|
| `makeProject({ docs = 'docs', git = true, stamp = true } = {})` | A temporary project built by hand, not by `init`, so an `init` defect does not redden another test. `backslop.json` has prefix `BS`, `gates: []`, `lang: 'ru'` and `tools: []`; `stamp: false` omits the `version` stamp. It creates the status directories, `archive/`, `adr/`, `reference/` and minimal READMEs — `docs/README.md` with one link, since Markdown files without any link fail gate 1 as `gate 1 read nothing` — and with `git: true` a repository on `main` with a test identity. Because `lang` is `ru`, messages come out in Russian, and a test builds its expectation through the Russian helpers below, never from a Russian literal; a test of an English message rewrites `lang` to `en` in `backslop.json` first |
| `cli(root, args, { cwd = root, env = {} } = {})` | Runs `bin/backslop.js` as a real process and returns `{ code, out, err }`. `NO_COLOR` is set and `--no-warnings` is appended to `NODE_OPTIONS` |
| `put(root, rel, text)`, `read(root, rel)` | Write a file, creating directories, and read one; `rel` is a posix path below the project |
| `run(root, args)` | Runs `git -C root …` and throws when it exits non-zero |
| `gitAll(root, message)` | `git add -A` and a commit |
| `cleanup(root)` | Removes the project; call it in `finally` |
| `toolCopy(mutate)` | A temporary copy of the tool with only `bin`, `lib`, `templates` and `package.json`; `mutate(dir)` edits it before the first run. It has no `CHANGELOG.md`, so a probe that reads the CHANGELOG puts its own |
| `toolCli(tool, args, { cwd = tool, env })` | `cli` for a tool copy: runs that copy's `bin/backslop.js`, by default in the copy itself (self-host) |
| `changelogTool()` | A tool copy with a fixture `CHANGELOG.md` of known sections |
| `resultTemplateParagraphs(lang, …)` | The paragraphs of the `result.md` template as `archive` lays them, for placeholder probes |
| `BIN`, `REPO` | The path of `bin/backslop.js` and of the repository root |
| `test/comment-scan.mjs` | `LIMIT`, `WIDTH`, `longBlocks`, `wideLines` and friends; used by `test/comment-length.test.mjs`, the comment gate of `npm test` |

### Russian in tests

No file in `test/` holds a Cyrillic letter: `rg '[\x{0400}-\x{04FF}]' test` finds nothing, test names, comments, assert messages and fixtures included. The Russian that a test needs comes from the places the tool itself reads it from:

| Need | Helper |
|---|---|
| A Russian message, or a pattern for it, from its English key | `ru(en, params)`; `ruRe(en, params, flags)` — a literal pattern in which a placeholder without a param, or given `ANY`, matches any text; `ruHeadRe(en)` — the text before the first placeholder; `killedRe(command)` and `KILLED` — "killed by a signal" |
| Task header field names and section names | `FIELD` and `SECTION` (`RU.fieldNames`, `RU.sectionNames` of `templates/i18n/ru.mjs`); `fieldSrc(key)` and `fieldRe(key, valueSrc, flags)` — a header line as a pattern; `RU_COMMANDS` — the "Commands:" line of the Russian help |
| A Russian fixture document | `ruCard(id, title, fields, sections)` — a task card; `ruResult(id, date, rest)` and `ruResultHeading(id)` — `result.md` from the Russian template; `ruOutcome(kind, target)` and `ruOutcomeWord(kind, target)` — the outcome word as a result and as a journal line spell it |
| A Russian template, as rendered or as written | `ruTemplate(rel, vars)`, `ruTemplateLines(rel)`; `ruTwinLine(rel, en)` — the line of the Russian template that is the twin of the English line holding `en`; `ruTextRe(text, fill)` and `ruLineRe(rel, en, fill)` — a template text or twin line as a pattern |
| A Russian sentence that holds vocabulary words | `ruExpand(text)` fills the tokens from `RU.parserWords` |

`ruExpand` tokens: `{word}` is the first spelling of the vocabulary word `closed`, `merged`, `rejected`, `withdrawn`, `completed`, `outcome`, `batch`, `result`, `not` or `into`; `{word.N}` is its spelling number N (alternatives and one-letter classes of the vocabulary source, in order); `{word-}` drops the last letter, for a test of a stem; a capital first letter (`{Closed}`) capitalises the word; `{with}` is the preposition inside the spelling of `rejected` that has one. `{rejectedMasculine}`, `{withdrawnNoun}`, `{outcomePlural}`, `{byRefusal}`, `{refusal}`, `{duplicate}` and `{done}` are look-alike forms that no vocabulary holds.

Inputs that cannot come from a Russian source are built from code points: the look-alike forms above (`String.fromCodePoint` in `LOOKALIKES` of the helpers), the non-ASCII directory names of the git `quotePath` tests (`NON_ASCII_DIR` in `test/commands.test.mjs`, `DOCS_DIR` in `test/upgrade.test.mjs`), the non-ASCII names in `PKG` of `test/gates.test.mjs`, `ELKA` of `test/links.test.mjs` and `STEM` of `test/util.test.mjs`, and the cp1251 bytes in `test/init.test.mjs`. A test that asserts the absence of Russian uses `/\p{Script=Cyrillic}/u`.

### The lint probe DSL

[test/lint.test.mjs](../../test/lint.test.mjs) holds one red probe per gate, named `lint: N. <case>`:

- `seedGreen(root)` fills a `makeProject` with a project that has no errors: an ADR and its row, tasks in each status, an archived task, a reference page, a CHANGELOG and a README;
- `probe(name, mutate, regex)` — `seedGreen`, then `mutate(root)`, then `lintProject` in process; passes when some error line `<file>: <msg>` matches `regex`, which is the Russian message built from its English key (see [Russian in tests](#russian-in-tests));
- `greenProbe(name, mutate)` — the same, and passes when there are no errors;
- `problems(root)` and `warnings(root)` return the error and warning lines;
- `toolProject(mutate)` — for gates that run only in the tool's own repository: a `toolCopy()`, `init` on it, `mutate(dir)`, then `lint` as a process; it returns `{ dir, code, out, err }`, and the caller removes `dir` with `cleanup`;
- `toolProbe(name, mutate, regex)` — `toolProject`, then asserts exit code 1 and that stderr matches `regex`. Gate 11, template parity and the adapter-output check use it; a probe that also needs a green half or a git index (gates 12 and 14) calls `toolProject` directly.

A probe is a mutation of a green project. A gate is confirmed by a probe that goes red on the mutation and stays green on the fixture.

### Where tests live

| Area | File |
|---|---|
| A command as a process with `makeProject` and `cli`: `new`, `mv`, `status`, `adr` and the flag, language and refusal rules shared by all commands | `test/commands.test.mjs` |
| One file for a command with its own cases | `archive`, `brief`, `fold` (with `show`), `gates`, `hook`, `init`, `links` (`--external`, in `test/links-external.test.mjs`), `merge-changelog`, `seed`, `tracks`, `upgrade` (with `migrate`): `test/<name>.test.mjs` |
| Lint gates and checks outside the numbered gates | `test/lint.test.mjs` |
| Lint in a fresh `git worktree`, where ignored adapter outputs are absent | `test/lint-worktree.test.mjs` |
| Templates: parity, slots, rendering | `test/templates.test.mjs`; the gate 12 probe is in `test/lint.test.mjs` |
| Vendored writing skills: `LICENSE`, `SOURCE.md`, and how the adapters lay them out | `test/vendor.test.mjs` |
| The `backslop-writer` skill templates and the `writer` field of `backslop.json` | `test/writer.test.mjs` |
| Release script | `test/release.test.mjs` |
| Help, versions and review regressions | `test/review.test.mjs` |
| Shared modules | `test/config.test.mjs`, `test/tasks.test.mjs`, `test/links.test.mjs`, `test/mdwalk.test.mjs`, `test/util.test.mjs`, `test/version.test.mjs`, `test/adapter-ownership.test.mjs`, `test/hooks-install.test.mjs` |
| The comment limit | `test/comment-length.test.mjs` |
| The imports between command modules: only those listed in `ALLOWED` of the test | `test/module-imports.test.mjs` |
| The language rule: Cyrillic only in templates/, docs/backlog/ and docs/archive/ | `test/english-only.test.mjs` |
| The Russian localization: key parity of `lib/` and `bin/` with `templates/i18n/ru.mjs`, and the lookup | `test/i18n.test.mjs` |

### Windows

Windows is supported. A test that cannot run on win32 (a symlink, a shell shim with a shebang, a file mode) is written as `test('<name>', { skip: process.platform === 'win32' }, …)` and names the reason in the test name or in a comment above it. An unreadable-directory test adds a condition for running as root: `skip: process.platform === 'win32' || asRoot`.

## Help

The help text is two hand-written template literals: `HELP_EN` in `bin/backslop.js` and `help` in `templates/i18n/ru.mjs`, a function of the tool version; there is no generator.

- `help(lang)` in `bin/backslop.js` returns `HELP_EN` for `en` and the Russian text for `ru`: the project language decides, and outside a project both texts are printed, English first.
- The language is read from `backslop.json` by `projectHintsOrNull`; a broken config gives Russian.
- `help`, `--help`, `-h` and no argument print it; so does `<command> --help`, through `HelpRequest` from `parseCommandArgs`. The exit code is 0, inside a project or outside.
- **Alignment.** A command line starts with two spaces, then the synopsis, then spaces up to the description, which starts at column 54 (54 characters before it). A synopsis that does not fit in that width ends its line, and the description goes on the next line indented by 54 spaces; `brief` and `merge-changelog` are written so. Keep every line of both literals on that grid. The help test in `test/review.test.mjs` checks the grid of both literals: every command line holds its description at column 54, or ends with its synopsis and is followed by a line that opens with 54 spaces.
- **Two texts, one structure.** An edit of one literal has its counterpart in the other, in the same position.
- **The gate count.** The `lint` line names the number of gates as a word, in both literals, and `test/review.test.mjs` matches the English word; the Russian word has no literal check, the Russian help is only compared whole with `RU.help`. The full list of places is in step 7 of [Recipe: add a lint gate](#recipe-add-a-lint-gate).
- **What tests pin.** The help test matches the Russian and English texts, and the `mv` line of the help against the usage refusal of `mv` itself, so the two name the same flags. A new command line gets no test of its own; add one next to the help test if the text must not drift.
