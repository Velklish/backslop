# BS-121 · Parse argv strictly everywhere; help lists aliases and describes show correctly

- **Order:** 390
- **Scope:** [02. CLI](../../reference/02-cli.md) § Commands
- **Created:** 2026-09-25
- **Dependencies:** BS-97, BS-115

## Context

`B` is the absolute path to this repo's `bin/backslop.js`; `T` is a fresh temporary directory. Line numbers refer to the v0.11.0 tree (commit 6f6318e).

`parseCommandArgs` (lib/util.js:76-94) is the documented way a command reads argv: docs/reference/02-cli.md:5 says flags are parsed strictly, and a value that starts with a dash is glued to its flag unless it is a flag of that command. The BS-97 (`cli-arguments-edge-cases`) card already made `lint` call it and moved the help check into it (an exported `HelpRequest` that bin/backslop.js catches), so `--title -h` is a value. Four deviations remain, plus one help line:

1. **Extra positionals are dropped silently.** verified — CLI runs. `util.js:90` always passes `allowPositionals: true`. Only `fold.js:33` refuses a second positional: `fold 1 2` gives rc=1 with `✖ a single task number is expected…`. Everywhere else the extra is ignored with rc=0. `new ee --title My Title` creates `# BS-2 · My`, so the unquoted word `Title` is lost. The same rc=0 happens for `adr my-adr extra-word`, `status bogus`, `gates extra --dry-run`, `tracks extra`, `seed --scan extra`, `archive 1 999 --dry-run` and `init extra-positional`. `mv` and `brief` take several positionals by design: `mv.js:208-209` and `brief.js:34` read the whole list.
2. **Node's own parseArgs text reaches the user untranslated.** verified — CLI runs in a `lang: ru` project. `util.js:91-93` does `catch (e) { throw new CliError(e.message); }`. So `status --bogus` prints `✖ Unknown option '--bogus'. To specify a positional argument starting with a '-', place it at the end of the command after '--', as in '-- "--bogus"'`, and `new other --title --queue` prints `✖ Option '--title' argument is ambiguous. … use '--title=-XYZ'.` (rc=1 for both). The `--title=…` hint is the documented rule, and test/commands.test.mjs:149-151 asserts it, so keep it. The `--` hint does harm: after `--`, extra positionals pass (item 1).
3. **Help does not list the aliases the bin accepts.** verified — read the code and a CLI run. `bin:133` accepts `help|--help|-h`, `bin:137` accepts `version|--version|-v`, and every command accepts `--help`/`-h` (through `HelpRequest` since the BS-97 (`cli-arguments-edge-cases`) card). HELP_RU and HELP_EN (`bin:59-60`, `:113-114`) list only `version` and `help`, and 02-cli.md:29 mentions only the per-command `--help`. `node $B -v` gives rc=0 with `backslop 0.11.0`.
4. **`upgrade` validates `--to` after network I/O.** verified — a CLI run. `upgrade.js:106` calls `listReleaseTags(source, cfg.lang)` (`git ls-remote`) before the `normalizeVersion(values.to)` check at `:109-110`. In a project whose `source` is `/nonexistent/repo`, `upgrade --to 1` gives rc=1 with `✖ git ls-remote --tags /nonexistent/repo: fatal: … does not appear to be a git repository`, not `--to “1”: expected X.Y.Z`. `init.js:46-48` and `changelog.js:40-44` check flag form before any I/O.
5. **The help line for `show` is imprecise.** verified — read against lib/show.js. `bin/backslop.js:90` says "git show of the commit holding the body of a folded task" (ru twin at `:35`). In fact `show` prints the `git show <rev>:<path>` blobs or the bare commit message (`%B`), with the header on stderr (`lib/show.js:36-67`). `02-cli.md:17` is correct.

Build on the `parseCommandArgs` and `HelpRequest` code BS-97 (`cli-arguments-edge-cases`) left; do not reintroduce a help check in bin/backslop.js.

## Work to do

- lib/util.js: change the signature to `parseCommandArgs(argv, options, { positionals, lang })`. `positionals` is the maximum count, a number or `Infinity`. More positionals than that gives a CliError that names the first extra token.
- lib/util.js: map parseArgs errors by `e.code` (`ERR_PARSE_ARGS_UNKNOWN_OPTION`, `ERR_PARSE_ARGS_INVALID_OPTION_VALUE`; read Node's message for the ambiguous-value case) to your own messages built with `tr(lang, ru, en)`. Each message names the flag. Keep the `--flag=…` hint for a dash-leading value. Drop Node's hint about `--`. When `lang` is null (no project found), print one bilingual `EN / RU` string, as changelog.js:43 does.
- bin/backslop.js: pass the language from `projectLangOrNull` (lib/config.js, added by BS-115 (`project-lang-fallback`); null outside a project) as `mod.run(rest, { cwd, lang })`. Forward `ctx.lang` into `parseCommandArgs` in every module.
- Set the limit in each module: 0 for status, gates, tracks, seed, changelog, merge-changelog, upgrade, init, migrate and lint; 1 for new, adr, show, archive and fold; `Infinity` for mv and brief. Replace fold.js:33's own check with the shared limit, but keep its wording ('a single task number is expected: bulk folding is the same command without a number') as the fold-specific message.
- lib/lint.js: pass `{ positionals: 0, lang }` to the `parseCommandArgs` call the BS-97 (`cli-arguments-edge-cases`) card added.
- Keep the `HelpRequest` path working with the new signature: `<command> --help` and `-h` as an option token print help with rc=0, and `-h` consumed as the value of a string option is a value.
- lib/upgrade.js: move the `--to` form check (`normalizeVersion(values.to)`, :109-110) above `listReleaseTags` (:106). Keep only the 'tag exists' check after the network call.
- List the aliases in both help texts (bin:59-60, :113-114): `version | --version | -v`, `help | --help | -h`, `<command> --help`. Do the same in docs/reference/02-cli.md:29. In 02-cli.md:5, state the positional limit and the `-h`-as-value rule. Write in the file's current language.
- Help, item 5: change the `show` line in `HELP_EN` (`bin/backslop.js:90`) and `HELP_RU` (`:35`) to "print the body of a folded task (stdout) from the revision its journal line names; header on stderr" in each language, keeping the 54-column alignment; run `node --test test/review.test.mjs`.
- CHANGELOG.md: add an English entry under the unreleased section: extra positionals are now refused with exit 1, argv refusals are printed in the project language, and `upgrade --to` is checked before any network call.

## Out of scope

- Adding new flags to any command (for example a real `lint --json`).
- Rewording command messages other than the argv refusals (see the BS-124 (`messages-through-tr`) card).
- The release script's own argv handling in scripts/release.mjs.

## Verification

- New tests in test/commands.test.mjs, each asserting rc and text: `lint extra` gives rc=1; `new ee --title My Title` gives rc=1 and names `Title`; `status bogus` gives rc=1; `mv 1 2 queue` still gives rc=0; `new beta --help` gives rc=0 and prints help; in a `lang: ru` project `status --bogus` prints Russian text; outside a project `status --bogus` prints the bilingual form.
- New test in test/upgrade.test.mjs: with `source` pointing at a missing directory, `upgrade --to 1` gives rc=1, the message contains `--to “1”`, and it does not contain `ls-remote`.
- test/commands.test.mjs:149-151 (`--title=` hint) and test/review.test.mjs:115 (`--help` on a command) still pass unchanged.
- `node $B -v` still prints `backslop <version>` with rc=0, and `node $B help` output contains `-v` and `-h`.
- `node --test --test-timeout=60000 test/review.test.mjs; echo rc=$?` → rc=0 after the `show` help line change (the help tests match the literals).
- `npm test` passes (report the count of passing tests), and `node bin/backslop.js lint` gives rc=0 in this repo.
