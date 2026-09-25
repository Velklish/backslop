# BS-94 · backslop.json: one validator for init and every command; BOM, prefix type, gate strings

- **Order:** 120
- **Scope:** [01. Layout](../../reference/01-layout.md) § backslop.json
- **Created:** 2026-09-25
- **Dependencies:** none

## Context

Line numbers refer to base commit 6f6318e (v0.11.0). `$BS` below is `node <repo>/bin/backslop.js`; throwaway projects are created with `git init -q && $BS init --lang en --tools none` unless stated otherwise.

Five verified bugs where backslop.json is validated inconsistently: init writes values later refused, valid input is refused, invalid input crashes with a stack.

**1. Medium — a UTF-8 BOM makes backslop.json unreadable for every command.** verified — reproduced on 6f6318e.
- `init`, then prepend `EF BB BF` to backslop.json: `$BS lint`, `$BS status`, `$BS init` → rc=1 `✖ backslop.json: cannot be parsed / не разбирается — Unexpected token '﻿', "﻿{ …` (the offending character is invisible); `$BS help` and an unknown command print Russian text although the file says `lang: en`. Stripping the BOM restores rc=0.
- Root cause: lib/config.js:94 `JSON.parse(readFileSync(file, 'utf8'))` keeps U+FEFF; bin/backslop.js:126-127 does the same parse for the help language and silently falls back to `ru`. Task files already tolerate a BOM (lib/tasks.js:348-351; docs/reference/02-cli.md:37). PowerShell 5 `Set-Content -Encoding UTF8` writes a BOM; Windows is supported.

**2. Low — a non-string `prefix` passes validation and crashes later.** verified — reproduced on 6f6318e.
- `"prefix": ["BS"]` → `lint`, `status`, `new`, `brief` rc=1 with `TypeError: s.replace is not a function` from lib/log.js:20 (`upgrade` from lib/mdwalk.js:99); `adr`, `tracks`, `gates` coerce it silently.
- Root cause: lib/config.js:113 `if (!PREFIX_RE.test(cfg.prefix))` — `RegExp.test` stringifies `['BS']`; `docs` and `cli` have explicit `typeof` checks (lib/config.js:116, :120). docs/reference/01-layout.md:40 defines `prefix` as a string.

**3. Minor — string gate entries are not validated.** verified — reproduced on 6f6318e.
- `"gates": [""]` → `$BS gates` rc=1 with `TypeError [ERR_INVALID_ARG_VALUE]: The argument 'file' cannot be empty` stack from `runGate` (lib/gates.js:140); `"gates": ["   "]` → rc=0 `✔ gates 1, green 1`; the object form `{"command": ""}` gets the CliError `gates[0].command must be a non-empty command string`.
- Root cause: lib/config.js:169 `if (typeof gate === 'string') return;` versus lib/config.js:173 `if (typeof gate.command !== 'string' || !gate.command.trim())`. The same silent-zero-coverage is refused for `when: []` (test/config.test.mjs:92-94).

**4. Minor — first `init` accepts `--dir`/`--cli` values that every later command refuses.** verified — reproduced on 6f6318e.
- `$BS init --dir docs..v2` → rc=0; then `lint` and a repeated `init` → rc=1 `✖ backslop.json: docs “docs..v2” — expected a relative path inside the project`. `$BS init --cli ''` (or `'  '`) → rc=0, writes `"cli": ""` and `"gates": [" lint"]`; then `status`/`lint`/`init` → rc=1 `backslop.json: cli must be a non-empty command string`. Only a hand edit repairs the project.
- Root cause: lib/init.js:70 rejects `..` only as a whole segment while lib/config.js:116 rejects any substring; lib/init.js:73 `values.cli ?? defaultCli()` accepts a blank string while lib/config.js:120 requires `cfg.cli.trim()`; the fresh-config branch (lib/init.js:65-84) never runs loadConfig's checks before `saveConfig` (lib/init.js:98). lib/init.js:74-75 and test/init.test.mjs:88-107 state that first init must reject such values before the first write. The same divergence bites the other way: `init --dir my..docs --tools none` → rc=0 (`✔ backslop init: my..docs/ …`), then `lint` and a repeated `init` → rc=1 `docs «my..docs» — нужен относительный путь внутри проекта`. **Rule that wins:** `..` is refused only as a path segment after splitting on `/` and `\` (Windows is supported), so `my..docs` and `docs..v2` are valid everywhere, and `../x` or `a\..\b` are refused everywhere.

**5. Minor — repeated `init --dir docs/` is refused as a flag/config conflict.** verified — reproduced on 6f6318e.
- `init --dir docs/` → rc=0 (stored `docs`); the same command again → rc=1 `✖ backslop.json already sets docs = "docs"; change it in the config, not with this flag`; `--dir ./docs` likewise; `--dir docs` → rc=0.
- Root cause: lib/init.js:57-58 compare the raw `values[flag]` with `cfg[key]`, while lib/init.js:69 normalises `--dir` on first init (`toPosix(path.normalize(values.dir)).replace(/\/+$/, '')`; test/init.test.mjs:331 asserts `docs/` → `docs`).

## Work to do

- Bug 1: strip a leading U+FEFF before `JSON.parse` in `loadConfig` and in the help-language read in bin/backslop.js; `saveConfig` keeps writing without a BOM (state it in docs/reference/01-layout.md § backslop.json).
- Bugs 2–4: extract the field checks of `loadConfig` into one `validateConfig(cfg, lang)` in lib/config.js and call it from `loadConfig` and from init's fresh-config branch before `saveConfig`; add `typeof cfg.prefix !== 'string'` to the prefix check; refuse blank string gate entries with the same message as a blank object command; implement the docs-path rule once (reject empty, `.`, absolute paths and any `..` segment after splitting on `/` and `\`) and call it from both places.
- Bug 5: normalise `--dir` with the same expression before comparing it with `cfg.docs` (hoist the normalisation above the existing-config branch).
- CHANGELOG.md, unreleased section: backslop.json with a BOM loads; `init --dir` follows the same path rule as every other command (a `..` inside a name is allowed).
- Add the regression tests listed under Verification to test/config.test.mjs and test/init.test.mjs.

## Out of scope

- Widening the accepted cli pin grammar — the BS-101 (`unverified-command-input-forms`) card.
- Validating `when` glob patterns beyond the documented alphabet (documented contract, not a bug).

## Verification

- New test (bug 1): BOM-prefixed backslop.json with `lang: en` → `lint` rc=0 and `help` prints the English banner.
- New tests (bugs 2, 3): `prefix: ["BS"]` → every command rc=1 with the prefix CliError, no stack; `gates: [""]` and `gates: ["  "]` → rc=1 with the `gates[0]` CliError.
- New test (bug 4): `init --cli ''`, `init --dir ../x` and `init --dir 'a\..\b'` → rc=1 and no backslop.json on disk; `init --dir my..docs --tools none` then `lint` → rc=0 both.
- New test (bug 5): `init --dir docs/` twice and `init --dir ./docs` after it → rc=0 each.
- `npm test` → rc=0; `node bin/backslop.js lint` → rc=0.
