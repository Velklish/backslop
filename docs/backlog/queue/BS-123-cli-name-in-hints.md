# BS-123 · Print the project's cli in every runnable hint; name the config through CONFIG_FILE

- **Order:** 410
- **Scope:** [02. CLI](../../reference/02-cli.md) § Commands
- **Created:** 2026-09-25
- **Dependencies:** BS-121, BS-98, BS-115

## Context

`B` is the absolute path to this repo's `bin/backslop.js`; `T` is a fresh temporary directory. Line numbers refer to the v0.11.0 tree (commit 6f6318e).

A convention holds at most call sites but not all of them: a runnable hint prints the project's command from `cfg.cli` (README documents `cli` as the project command; show.js:15 `${cfg.cli} show <N>`, and more than 50 other sites), and the config file is named through `CONFIG_FILE`. The sites below break it.

1. **Runnable hints print a hard-coded `backslop` or no CLI at all.** verified — CLI runs in an en project with `"cli": "npx mybs"` in backslop.json. `new` gives rc=1 with `✖ slug is required: backslop new <slug> …`. `adr` gives `✖ slug is required: backslop adr <slug> [--title "…"]`. `mv` gives `✖ … backslop mv <N…> …`. `archive` gives `✖ … backslop archive <N> …`. `seed` gives `✖ exactly one mode is required: backslop seed --scan …`. By contrast `show` gives `✖ task number is required: npx mybs show <N>`. The hard-coded sites are new.js:53, 140, 141; mv.js:210, 211; adr.js:30; archive.js:16, 75; brief.js:29-30; seed.js:36-37; lint.js:292; and bin/backslop.js:142-144 (unknown command, when a project exists). These sites omit the CLI: mv.js:76 and :81 (`mv N minor --evidence …`, module-level constants), lint.js:174 (`run upgrade`) and lint.js:350 (`mv N queue --top`).
2. **The config file name is a literal.** verified — `git grep -n 'backslop\.json' -- bin lib`: bin/backslop.js:126 `path.join(root, 'backslop.json')` (moved into lib/config.js by BS-115 (`project-lang-fallback`)) and brief.js:126-127 in a message, while config.js:8 exports `CONFIG_FILE` (54 uses, including brief.js:75).

## Work to do

- Use `${cfg.cli}` at new.js:53, 140, 141; mv.js:210, 211; adr.js:30; archive.js:16, 75; brief.js:29-30; seed.js:36-37; lint.js:174, 292, 350. Turn mv.js:76 and :81 from module constants into functions of `cfg` and prefix `cfg.cli`.
- bin/backslop.js:142-144: when a project is found, print its `cli` in the unknown-command hint. Read the project `cli` from the same lenient read that `projectLangOrNull` (lib/config.js, added by BS-115 (`project-lang-fallback`)) does — for example make it return `{ lang, cli }` — and use `CONFIG_FILE` instead of a `'backslop.json'` literal there. With no project, keep the literal `backslop`, and keep config.js:86 unchanged.
- lib/brief.js:126-127: use `${CONFIG_FILE}`.
- CHANGELOG.md, unreleased section: every runnable hint in an error message names the project's `cli`.

## Out of scope

- Language ternaries, `gitOrFail` language, template-parity messages and mv quotes — BS-124 (`messages-through-tr`).
- init.js messages (see the BS-122 (`init-flag-validation-messages`) card) and argv refusals from parseCommandArgs (see the BS-121 (`strict-command-argv`) card).
- The seed Scope text (the BS-98 (`seed-scan-and-queue-reference`) card) and the no-project language of `merge-changelog` (the BS-115 (`project-lang-fallback`) card): both done earlier.

## Verification

- New test: in a project with `"cli": "npx mybs"`, `new`, `adr`, `mv`, `archive`, `seed` and `brief` with no arguments each fail with a message containing `npx mybs`, and `node $B frob` contains `npx mybs help`. Outside a project, `node $B frob` still says `backslop help`.
- `grep -nE "backslop (new|mv|archive|brief|seed|adr)" lib/*.js` finds no message strings (comments are allowed).
- `npm test` passes (report the count), and `node bin/backslop.js lint` gives rc=0.
