# BS-196 · Agent hooks: the hooks field and owned hook records in the Claude Code, Cursor and Codex project files

- **Order:** 1058
- **Scope:** [01. Layout](../../reference/01-layout.md)
- **Created:** 2026-09-30
- **Dependencies:** BS-195, BS-188, BS-191

## Context

Owner decision 11 of BS-183 (2026-09-30): agent hooks are a project's choice, for Claude Code, Cursor and Codex, and `init` installs them. BS-195 wrote the `hook` command, and BS-194 measured each harness's hook file and protocol. This card adds the config field and writes, rewrites and removes the hook records.

**The files are shared.** A project's `.claude/settings.json`, `.cursor/hooks.json` and `.codex/hooks.json` hold the team's own settings and hooks. promptobus writes its guard records into the same files at a workspace root. So the adapter-ownership model — a whole file under an adapter root, marked with `<!-- backslop:generated -->` — does not fit: JSON has no comment, and backslop owns only its records, not the file. promptobus solved the same problem at `v0.21.0`: owned records are recognised by their command, foreign groups and unknown fields stay untouched, and a second install changes no byte (`docs/guides/hooks-and-trust.md` § What the installer edits; § How to verify).

**File shapes,** from promptobus `v0.21.0` (`src/hooks.ts`, `lib/driver-cursor.js`, `lib/driver-codex.js`); BS-194 confirmed or corrected them:

- Claude Code — `.claude/settings.json`: `{ "hooks": { "SessionStart": [{ "hooks": [{ "type": "command", "command": … }] }], "Stop": [ … ] } }`;
- Cursor — `.cursor/hooks.json`: `{ "version": 1, "hooks": { "sessionStart": [{ "command": … }], "stop": [{ "command": … }] } }`; an unknown event name disables the whole file;
- Codex — `.codex/hooks.json`: `{ "hooks": { "SessionStart": [ … ], "Stop": [ … ] } }` in Claude's group shape; a linked worktree reads the main checkout's file.

**Collision with promptobus participants** (tag `v0.21.0`). A Codex participant lift refuses a foreign `.codex/hooks.json` at the discovery path (`refuseForeignProjectLayer`). A Cursor participant lift overwrites `.cursor/hooks.json` in the worker's worktree (`prepare`). PB-311 in github.com/Velklish/promptobus asks promptobus to accept these records. Until it lands, a project that runs promptobus Codex or Cursor participants should not select those hooks.

## Work to do

- **Config field `hooks`:** a list of harness ids from the adapter registry (`claude`, `cursor`, `codex`). An absent field means an empty list. It is validated like `tools`: an unknown or repeated value is refused, naming the field. It goes after `tools` in `saveConfig`'s order. `init --hooks <list>` sets it as `--tools` sets `tools`; a repeated `init` without the flag keeps it. `init` does not select hooks by default.
- **Records.** For each selected harness, `init` writes one record per event into that harness's project file: the start event runs `<cli> hook session-start --harness <id>`, and the stop event runs `<cli> hook stop --harness <id>`. The event names and shapes are as measured by BS-194.
  - It creates a missing file and a missing parent directory.
  - It merges into an existing file and keeps every foreign key, group and record, and their order.
  - A file that is not valid JSON, or whose `hooks` is not an object, is refused before the first write, naming the file.
- **Ownership.** A record is owned when its command, with any `cli`, ends in `hook session-start --harness <id>` or `hook stop --harness <id>` and names backslop. So an `upgrade` that moves the pin rewrites the old records instead of adding new ones. A repeated `init` writes no byte when nothing changed.
- **Removal.** A harness dropped from `hooks` loses its owned records. An event array or `hooks` object left empty is removed. The file is removed only when nothing else is left in it; for Cursor, `{ "version": 1 }` alone counts as nothing.
- The symlink rules of the adapter roots apply to these paths: refused on any symlinked component under the project root.
- **lint:** a selected harness whose file lacks an owned record, or holds one with another project's `cli`, is an error that says to run `init`. An owned record for a harness that is not selected is an error as well.
- **`init` note:** when `codex` or `cursor` is selected, one line on stdout says that promptobus participants of that harness collide with the file until promptobus accepts backslop's records. Name no tracker id in it.
- **The AGENTS.md block,** both languages, rendered only when `hooks` is not empty: one sentence saying that the stop hook returns the turn on `lint` errors in the files the session changed, and that the errors are fixed, not bypassed. Declare its key in `TEMPLATE_KEYS`; with no hooks the block renders as before, byte for byte.
- **Tests:**
  - per harness: write into a missing file and into a file with foreign content, which survives byte for byte in its own keys;
  - a second `init` changes nothing;
  - a pin change rewrites the records;
  - dropping a harness removes only owned records, and removes the file only when it is empty;
  - an invalid JSON file is refused before the first write;
  - the lint errors, each with a red probe;
  - the block with and without hooks.
- **Documentation:**
  - `docs/reference/01-layout.md`: the field in the configuration table, the three files and the ownership rule, the trust step each harness needs as BS-194 measured it, and the promptobus collision;
  - `docs/reference/02-cli.md`: `init --hooks`;
  - `docs/reference/03-lint.md`: the new errors;
  - `README.md`: a short section on hooks — what they do, how to select them, the trust step per harness;
  - `CHANGELOG.md` under the unreleased section;
  - the ADR of decision 11 names the `hooks` field, because it changes the config format.

## Out of scope

- The `hook` command's behaviour: BS-195.
- Any change in promptobus: PB-311.
- Hooks in user-level harness homes (`~/.claude`, `~/.cursor`, `~/.codex`): never touched.

## Verification

- `npm test` and `node bin/backslop.js gates` exit 0; the red probes are recorded with exit codes.
- In a throwaway project: `init --lang en --hooks claude,cursor,codex`, then `init` again. `git diff --exit-code` after the second run gives rc 0, and each of the three files holds the owned records.
- The same project, with a foreign hook added by hand to each file, then `init --hooks claude`: the Cursor and Codex records are gone, the foreign hooks stay, and the Claude records stay.
- A live Claude Code session in that project runs the installed stop hook: record the evidence, as BS-195 did.
- `node bin/backslop.js lint` exits 0 on this repository, which selects no hooks.
