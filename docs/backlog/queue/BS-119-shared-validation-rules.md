# BS-119 · Share validation rules: frontmatter description, tool list, stamp, single-line value

- **Order:** 370
- **Scope:** [01. Layout](../../reference/01-layout.md) § backslop.json
- **Created:** 2026-09-25
- **Dependencies:** BS-94

## Context

Four validation rules are written twice. In one case, frontmatter, the two copies disagree, and the parity check accepts a description that the adapter output turns into an empty string.

**1. The frontmatter description is read two ways** — verified — the parity probe below was rerun at base.
- The frontmatter regex `/^---\r?\n([\s\S]*?)\r?\n---\r?\n/` appears at lib/templates.js:48-49 and lib/adapters.js:65. Composed forms appear at lib/adapter-ownership.js:18 (`GENERATED_AT`, an anchored composite) and :43.
- `templates.frontmatterField` (lib/templates.js:51) returns `line.slice(name.length + 2).trim()`, which keeps the quotes. So gate 12 parity accepts `description: ""`.
- `adapters.splitFrontmatter` (lib/adapters.js:67-68) JSON-parses a quoted value, which yields an empty Cursor description.
- lib/templates.js:62-63 says the parity check exists because an empty description once reached `.mdc` unnoticed.
- Probe: a fake templates root with `skills/x/SKILL.md` and `en/skills/x/SKILL.md`, both containing `description: ""`. `templateParity(root)` → `[]`. With a bare `description:` it returns two errors: `templates/skills/x/SKILL.md frontmatter has no description` and the same for `templates/en/...`.
- Caveat: `JSON.parse` throws a SyntaxError on a malformed quoted value, so the shared reader needs a guard, or a parity check becomes a crash.

**2. The adapter tool list rule** — verified — read the code at base. BS-94 (`config-validation-one-rule-set`) already runs the `loadConfig` checks on init's fresh config through one `validateConfig`; share the tool-list rule inside it.
- lib/init.js:203-210 and lib/config.js:126 apply the same rule against `TOOLS` (lib/adapters-registry.js): every entry known and no repeats.
- init also splits a CSV, rejects an empty list that is not `none`, and reorders by `TOOLS` (lib/init.js:204-205, :210).
- config accepts `tools: []`, which is what `init --tools none` writes.

**3. The stamp-newer-than-tool refusal** — verified — read the code and the tests at base.
- lib/init.js:54-55 and lib/migrate.js:78-79 use the same condition, `compareVersions(v, TOOL_VERSION) > 0`, and the same message head.
- lint (lib/lint.js:171-173) only warns, uses different wording (pinned by test/lint.test.mjs:347), and reuses one comparison for the `< 0` branch. Leave lint as it is.

**4. The single-line check for `agents.stepOverrides`** — verified — a `loadConfig` probe was rerun at base.
- `validateBlockValue` (lib/config.js:144-155) checks `LINE_BREAK_RE`, backticks and `BLOCK_MARKER_RE`.
- The `stepOverrides` validation (lib/config.js:206-222) repeats the `LINE_BREAK_RE` check with its own message (:217). Instead of the marker words it bans `<` (:222).
- The marker, backtick and `<` differences are by design. `upsertBlock` looks for the full `<!-- backslop:end -->` marker, which the `<` ban already excludes.
- Probe: `probe` = `run backslop:end` is rejected, and `stepOverrides["4"]` = `run backslop:end` is accepted. A U+2028 is rejected by both, with different messages.
- Tests pin the stepOverrides wording: test/config.test.mjs:176 and test/init.test.mjs:219 assert `/однострочный текст/`, while `validateBlockValue` says `однострочное значение`.

**Which behaviour wins.**
- Frontmatter: the adapters' unquoting wins, guarded against malformed values. Behaviour change: gate 12 parity rejects a quoted-empty description.
- The single-line check: pick one message and update both tests.

## Work to do

- Frontmatter: export one `FRONTMATTER` regex (or its source) and `frontmatterField(text, name)` from lib/templates.js or a small lib/frontmatter.js, not from adapter-ownership.js, whose subject is the generated marker. The function trims and unquotes JSON strings, with `JSON.parse` in try/catch. `templateParity` reports a malformed quoted value as a gate 12 error; `adapters.splitFrontmatter` fails with a CliError naming the template. lib/adapter-ownership.js:18 and :43 reuse only the pattern source.
- lib/adapters-registry.js: export `validTools(list)`: every entry is in `TOOLS`, with no repeats, and `[]` is valid. Use it at lib/init.js:207, keeping `!tools.length ||`, the CSV split and the reorder there, and at lib/config.js:126, keeping `Array.isArray`.
- lib/version.js: export the shared stamp-newer refusal head (for example `stampNewerHead(version, lang)`). Use it at lib/init.js:55 and lib/migrate.js:79, each keeping its own tail. lint is unchanged.
- lib/config.js: add `assertSingleLine(value, label, lang)` and call it from `validateBlockValue` and from the `stepOverrides` validation. Pick one wording, and update test/config.test.mjs:176 and test/init.test.mjs:219 to match. The backtick, marker and `<` rules stay where they are.
- Add a CHANGELOG entry: template parity rejects `description: ""`.

## Out of scope

- The wording of lint's stamp warning.
- The marker/`<` rule for `stepOverrides`.
- Any change to which adapters exist.

## Verification

- New tests in test/templates.test.mjs: `description: ""` gives a parity error. A malformed `description: "abc` gives a parity error and no throw.
- `node --test --test-timeout=60000 test/init.test.mjs test/adapter-ownership.test.mjs; echo rc=$?` → rc=0; the Cursor `.mdc` description assertions are not edited.
- The tests for `init --tools` and for backslop.json `tools` pass. `init` and `migrate` with a newer stamp still refuse (existing tests).
- `npm test`: every test passes. `node bin/backslop.js lint` → rc=0.
