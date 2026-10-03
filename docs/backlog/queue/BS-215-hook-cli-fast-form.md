# BS-215 · init picks a fast hook cli when backslop is installed, npx otherwise

- **Order:** 1110
- **Scope:** [01. Layout](../../reference/01-layout.md)
- **Created:** 2026-10-03
- **Dependencies:** BS-213

## Context

Owner decision (2026-10-02), taken after the measurement of [BS-213](../../archive/LOG.md#bs-213): `init` offers the fast form. When `backslop` is on `PATH` or in the project's devDependencies, `init` takes the fast form for the hook cli; otherwise it keeps the `npx` form.

The measurement is in [the Measurement section of BS-213](../../archive/LOG.md#bs-213). The default hook command `<cli> hook <event> --harness <id>`, with `<cli>` set to `npx github:Velklish/backslop#v0.12.0`, has a warm-cache median of 2457 ms for session-start and 2421 ms for stop, against 143 and 153 ms for `node <abs path>/bin/backslop.js`; a cold cache took 6904 and 5789 ms. The tagged npx runs exited 1 before the hook ran, because the tag `v0.12.0` has no `hook` command; with a hook-bearing package through npx (a `git+file` spec, no network) the medians are 1206 and 1968 ms, against 171 and 221 ms for the node form. The harness runs the command on every stop and session-start event. Measured on a loaded machine, one run per cold cell and 7 per warm cell.

Candidate forms, medians for session-start and stop in ms, from the same section:

- `backslop` from a global install: 173 and 224 (measured by the absolute path of the installed bin, not through `PATH`). Needs `npm i -g github:Velklish/backslop#<tag>` on each machine and a manual update.
- a devDependency run as `npx --no-install backslop`: 507 and 688. Needs a `package.json` in the project and `npm i -D github:Velklish/backslop#<tag>`; Node projects only.
- `node <abs path to a clone>/bin/backslop.js`: 171 and 221. The path is machine-specific, so it cannot be detected from the project and is not part of this card's rule.

`hookCommand` in `lib/hooks-install.js` takes the `cli` of `backslop.json`, and the same `cli` fills the managed block, the `next:` lines of `init` and the pin check, so a second value for the hook alone is a new notion.

## Work to do

- Settle the detection rule: `backslop` resolvable on `PATH` (how it is looked up on Windows, where the launcher is a `.cmd`), and `backslop` in the `devDependencies` of the `package.json` at the project root. Which wins when both are present.
- Settle what `init` writes in each case: the hook command only, or the `cli` of `backslop.json` as a whole; whether a non-npx form still counts as pinned for the pin check and the `unpinned` warning of `init`, and for `upgrade`.
- Settle where the fast form is written. The hook files `.claude/settings.json`, `.cursor/hooks.json` and `.codex/hooks.json`, and the `cli` of `backslop.json`, are committed, shared files. A `PATH` install exists on one machine only: a teammate without it gets a hook that fails on every event, and `init` run on another machine would flip the command back and forth. State what a second machine without the install receives, including a fresh checkout of a project whose `npm install` has not run, and how a rerun of `init` on another machine behaves. The devDependency form travels with `package.json`, but `npx --no-install backslop` fails on a checkout where `npm install` has not run. If the `PATH` branch cannot be written into a committed file, the worker brings it back to the owner before writing code.
- Settle what happens when the chosen form disappears later (the install is removed, `PATH` changes): the hook fails on every event, so decide between a refusal or warning at `init` and `lint` time and silence. Record the decision and its reason.
- Implement the rule in `init` and `upgrade`, with tests for each branch (neither, `PATH`, devDependency, both) and for the existing hook command when nothing is installed.
- Update `docs/reference/01-layout.md`, `docs/reference/02-cli.md` (`init`), the README and the CHANGELOG in the same pass; the contract decision needs an ADR or a rewrite of the ADR that decides it.

## Out of scope

- Detecting a clone path for the `node <abs path>` form.
- Changing the form for an `init` run without `--hooks`.
- Measuring again; the numbers above are the evidence.

## Verification

- `init --hooks claude` in a project with `backslop` resolvable on `PATH` writes the `PATH` form, with `backslop` only in `devDependencies` writes `npx --no-install backslop`, with both present writes the form the first item of Work to do chose, and with neither writes `npx github:Velklish/backslop#v<version>`; a test per branch fails on the code before the change.
- The documentation and the test state where the `PATH` form is written, what a second machine without the install gets, and what a rerun of `init` on another machine does; if the owner was asked, the answer is recorded in the card or the ADR.
- `node bin/backslop.js gates` is green.
