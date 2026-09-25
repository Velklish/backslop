# BS-97 · CLI arguments: lint parses argv, blank --title falls back, -h/--help as an option value

- **Order:** 150
- **Scope:** [02. CLI](../../reference/02-cli.md) § Commands
- **Created:** 2026-09-25
- **Dependencies:** none

## Context

Line numbers refer to base commit 6f6318e (v0.11.0). `$BS` below is `node <repo>/bin/backslop.js`; throwaway projects are created with `git init -q && $BS init --lang en --tools none` unless stated otherwise.

Three verified bugs in argument handling. docs/reference/02-cli.md:5 states that flags are parsed strictly through `parseCommandArgs`, and that a value starting with a dash is accepted without `=` when it does not match a flag name of the command.

**1. Minor — `lint` ignores argv.** verified — reproduced on 6f6318e in a fresh project.
- `$BS lint --bogus`, `lint --json`, `lint foo bar`, `lint --title --queue`, `lint --nope --json foo` → all `✔ lint: no errors` rc=0; control `$BS status --bogus` → rc=1 `✖ Unknown option '--bogus'`.
- Root cause: lib/lint.js:669 `export async function run(argv, { cwd }) { const project = loadProject(cwd); …` never reads `argv`; the other 17 commands call `parseCommandArgs` (lib/util.js:76-94, `parseArgs` strict). The help lists `lint` without options (bin/backslop.js:43). A typo such as `lint --jsno` runs the plain lint and exits 0, and a gate configured as `lint --json` passes without doing what it asks for. A patch that calls `parseCommandArgs(argv, {})` kept 450/450 and lint rc=0. Extra positionals are ignored by `status` and `gates` too (`allowPositionals: true`, lib/util.js:90); the positional limit for every command belongs to the BS-121 (`strict-command-argv`) card.

**2. Minor — `--title ""` writes a heading that readTitle and lint reject.** verified — reproduced on 6f6318e.
- `$BS new alpha --queue --title ""` → rc=0; first line `# BS-1 · ` (od: `#  B S - 1  302 267 \n`); `status` prints `BS-1 · (untitled)`; `lint` → rc=1 `first line is not “# BS-1 · Title”`. `--title "   "` gives a whitespace-only title. `$BS adr x --title ""` → rc=0, first line `# ADR-002: `.
- Root cause: lib/new.js:122 and lib/adr.js:35 `title: values.title ?? slug` (`??` passes an empty string); `TITLE_RE` (lib/tasks.js:82, `/^# (\S+) · (.+)$/`) needs a non-empty title. lib/new.js:64-65 already refuses a blank `--evidence` with `.trim()`.

**3. Minor — `-h`/`--help` as the value of an option prints help, rc=0, and creates nothing.** verified — reproduced on 6f6318e (the counter-reading that `--help` is a flag of every command does not hold: the documented known-flag collision `--title --queue` refuses with rc=1, while this case exits 0 silently).
- `$BS new x --title -h`, `new y --title --help`, `adr q --title -h` → the 52-line help, rc=0, no file; `new z --title=--help`, `--title=-h`, `--title -x` and `--title "-h is a value"` create BS-N.
- Root cause: bin/backslop.js:145 `if (rest.includes('--help') || rest.includes('-h'))` runs before `parseCommandArgs`; the dash-value rule is implemented in lib/util.js:82 and promised by the help (bin/backslop.js:62-63, :116-117). test/review.test.mjs:115 pins `new --help` → rc=0 with help.

## Work to do

- Bug 1: call `parseCommandArgs(argv, {})` at the top of `lint.run`, before `loadProject`, so an unknown flag fails with the same CliError as in other commands.
- Bug 2: Owner decision: a blank or whitespace-only `--title` falls back to the slug. In lib/new.js and lib/adr.js use `const title = (values.title ?? '').trim() || slug`; docs/reference/02-cli.md states the fallback.
- Bug 3: register `help: { type: 'boolean', short: 'h' }` inside `parseCommandArgs` and, when it is set, throw an exported `HelpRequest`; bin/backslop.js catches it and prints the help it prints today, and the blanket `rest.includes('--help') || rest.includes('-h')` check at bin/backslop.js:145 goes away. Every module calls `parseCommandArgs` before touching the project, so `<command> --help` still works outside a project; `--title -h` is then glued as a value, because the dash-value rule matches only `--long` names of the command. `new --help` must keep printing help with rc=0.
- CHANGELOG.md, unreleased section: unknown `lint` flags are refused with exit 1; `-h`/`--help` given as the value of an option no longer prints help.
- Add the regression tests listed under Verification (test/lint.test.mjs, test/commands.test.mjs, test/review.test.mjs).

## Out of scope

- Other refusal/stack cases (slug length, file shapes) — the BS-96 (`fs-shape-refusals-not-stacks`) card; positional limits and localized parse errors — the BS-121 (`strict-command-argv`) card.

## Verification

- New test (bug 1): `lint --bogus` → rc=1 with `Unknown option` naming `--bogus`; `lint` alone unchanged.
- New test (bug 2): `new a --title ""` → rc=0, first line `# BS-1 · a`; a whitespace-only `--title "   "` falls back to the slug the same way; same for `adr`.
- New test (bug 3): `new x --title -h` and `new x --evidence --help` and `adr x --title -h` → a task/ADR titled `-h`/`--help` is created, rc=0; `new --help` → help, rc=0.
- `npm test` → rc=0; `node bin/backslop.js lint` → rc=0.
