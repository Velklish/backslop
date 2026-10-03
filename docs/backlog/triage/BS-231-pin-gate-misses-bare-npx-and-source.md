# BS-231 · The pin gate does not catch a bare npx backslop call, and no gate checks the source field

- **Scope:** [03. Lint § Live-pin files](../../reference/03-lint.md#live-pin-files)
- **Created:** 2026-10-04
- **Dependencies:** none
- **Cost:** minor

## Context

`lintProsePin` returns at once when `cli` carries no pin (`lib/lint.js:188`). With `cli` = `npx --no-install backslop` (backslop as a devDependency, the form all three projects of run bs020 moved to on 2026-10-03), the gate has nothing to compare. A bare `npx backslop` left in a live file therefore passes lint. Outside a project with the dependency installed, that call fetches from the npm registry, where the package does not exist: `npm error 404 Not Found - GET https://registry.npmjs.org/backslop`.

`source` in `backslop.json`, from which `upgrade` takes the tags, is checked by no gate either. The reviewer of promptobus PB-317 reported both on 2026-10-03.

## Work to do

- With an unpinned `npx --no-install` cli, flag a live-file call that differs from it, a bare `npx backslop` among them.
- Validate `source`: a value `upgrade` cannot resolve is an error.

## Out of scope

- Historical files, which the live-pin rule already leaves alone.

## Verification

- A fixture with `cli` = `npx --no-install backslop` and a live file calling `npx backslop` fails lint by name; a test fails on the old gate.
- A `backslop.json` with an unresolvable `source` fails lint; a test fails on the old gate.
