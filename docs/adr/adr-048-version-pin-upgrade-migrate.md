# ADR-048: Version pin, upgrade and migrate

**Status:** Accepted
**Date:** 2026-09-28
**Deciders:** Velklish

## Context

An untagged `npx github:` spec follows the head of the default branch, so every template change would silently change every project that runs the tool. Upgrading therefore has to be one deliberate command, and it has to move every place a project runs the tool from — the config, the gates, the docs, package manifests and CI — while leaving historical records as they were. It has to be performed by the new version, because only the new version knows its own file format and templates. The rules that the AGENTS.md block points to must reach consumers with each upgrade, even when an older version starts it.

## Options

- **No pin** — every project follows the head of the default branch.
- **Auto-update on every run** — updating becomes a side effect of an unrelated command.
- **Upgrade performed by the old version** — it does not know the new file format.
- **A flag on `init` or an environment variable to redraw the rules pair** — a second, forgettable path.
- **A one-shot versioned migration for the rules pair** — later rule changes would not reach consumers.

## Decision

- **Pin and stamp.** A new config gets the pinned default `cli` and `version` equal to the tool version (`run` in `lib/init.js`). A repeated `init` restamps `version` but never changes `cli`; `init` and `migrate` refuse a stamp newer than the tool (`stampNewerHead` in `lib/version.js`). A pin is a release form of `cli` carrying a whole `X.Y.Z` (`parseCli`, `pinRe` in `lib/config.js`); the list of release forms belongs to the runtime and delivery ADR.
- **Lint version notes never fail the gate** (`lintVersion` in `lib/lint.js`): a release form without a pin, a missing stamp, a stamp older or newer than the tool, and a pin that differs from the stamp are warnings.
- **The live pin set** (`livePinFiles` in `lib/mdwalk.js`), shared by lint and upgrade: markdown under `<docs>/` and root `*.md`, except root `CHANGELOG.md`, `<docs>/adr/**`, `<docs>/archive/<PREFIX>-N…/` directories and task cards (`liveMarkdown`); every file named exactly `package.json`; the known root CI files (`CI_ROOT_FILES`) and YAML under `.github/workflows`, `.github/actions`, `.circleci` and `.buildkite` (`CI_DIRS`). Never walked: `.git`, `node_modules`, `.claude/worktrees` and harness roots behind a symlink. Journal entry lines of `<docs>/archive/LOG.md` are historical: one rule, `isJournalLine`, excludes them for the lint pin check, the upgrade rewrite and its stale-pin check, while the journal header stays live. A new executable file format is added to `livePinFiles` and to its membership test in `test/mdwalk.test.mjs`; lint and upgrade follow.
- **Lint pin check** (`lintProsePin`). A live pin that differs from the `cli` pin is an error naming the file and line, and so is a pin in a `gates` entry or in `probe` that differs from it; there is no check when `cli` has no exact pin.
- **Upgrade: source and target** (`run` in `lib/upgrade.js`). The release source is `source`, resolved from the project root when it is a path, or the GitHub repository of the `cli` form; otherwise upgrade refuses, so an npm-form `cli` needs an explicit `source`. Releases are the `vX.Y.Z` tags from `git ls-remote --tags --refs`, with the login prompt off and a 60-second timeout (`listReleaseTags`). The target is `--to` — which must name an existing tag — or the latest tag. The from-version is the lower of pin and stamp: it labels the plan and starts `changelog --since`. A downgrade is refused, checked against the current version — the pin, or the stamp when `cli` has no pin.
- **Upgrade: the early exit** (`run` in `lib/upgrade.js`). Upgrade stops with "already on" only when `cli` is not a floating release form, the target equals the current version — the pin, or the stamp when `cli` has no pin — `--to` is absent, the stamp equals that version, and no live file, `gates` entry or `probe` holds a stale pin (`hasStaleLivePins`). A floating `cli` — a release form without a pin — never exits early, so it is always moved to an exact pin, even when the stamp already equals the latest tag.
- **Upgrade: the run** (`run` in `lib/upgrade.js`). `--dry-run` prints the plan and writes nothing. Before any write the new version is probed with `<new cli> version`, and a missing or different version line is a refusal with pin and stamp untouched. Then, for a release-form `cli`, `cli`, `gates` and `probe` are saved with the new pin: every pin of the spec inside a command moves, and so does the old `cli` as a whole word (`rewriteCommand`, `rewriteGates`); a scoped gate keeps its `when`. Then `<new cli> migrate` and `<new cli> init` run, then, again for a release-form `cli`, live pins in prose are rewritten (`rewriteProsePins`), skipping with a warning a file behind a symlink or not in UTF-8, and finally `<new cli> changelog --since v<from> --to v<target>` prints the entries. Every step runs through the shell with the 10-minute limit (`exec`, `runShell`). A `cli` that is not a release form is kept with a warning, and the rest of the run proceeds.
- **`--pin-only`** (`run` in `lib/upgrade.js`) saves `cli`, `gates` and `probe` only and prints the recipe to finish by hand: migrate, init, then upgrade again for the live pins. The follow-up upgrade on the same version proceeds while a live pin is stale.
- **Migrate: versioned migrations.** `MIGRATIONS` in `lib/migrate.js` run for a stamp below their `since`, or for no stamp; the only migration creates `<docs>/archive/LOG.md` from the template when it is missing.
- **Migrate: the rules pair.** `<docs>/backlog/README.md` and `<docs>/archive/README.md` belong to the tool (`RULES_DOCS`). When the stamp is below the tool version or missing, each is re-rendered from the template of the project language and written if it differs or is missing. At the tool's own version only untouched output is redrawn: a file that differs from the render only in pins of the `cli` spec and line endings, or that equals the other language's render the same way — so a `lang` change redraws the pair only when the file is that render (`planRules`, `samePinned`); any other file is kept and named until the next version update. Before any write, `--dry-run` included, a pair file behind a symlink on any path component is skipped with a warning, and an uncommitted change to a file that would be written refuses the whole run and leaves the stamp; a file whose only change since `HEAD` is a moved `cli` pin is not an edit (`onlyPinMoved`). Without a repository the rewrite proceeds and the output says so; any other git failure is a refusal before the first write. `migrate` then sets the stamp.
- **`init` never overwrites an existing skeleton file** (the skeleton loop in `run` in `lib/init.js`); it does not redraw the rules pair.

## Consequences

- Updating is a deliberate command, never a side effect.
- The old version runs `upgrade`; the new one runs `migrate` and `init`.
- Historical records keep their old pins and stay green.
- A committed local edit to the rules pair is lost on the next upgrade by design: project rules belong outside the pair.
- Running `init` of a new version without `migrate` restamps and skips the migrations and the rules rewrite, so every recipe runs `migrate` before `init`.
- `migrate` without the following `init` can leave links to skeleton files `init` has not created yet; lint gate 1 reports them.
- This repository, whose `cli` has no release source, is not updated through `upgrade`, and a test in `test/templates.test.mjs` keeps its rules pair equal to the templates.
- Network is needed on every run of a `github:` cli: npm 11.6.2 resolves a non-registry spec on every run (`getManifest` in `libnpmexec/lib/index.js`), and pacote resolves a git committish through `git ls-remote` unless it is a 40-hex SHA (`pacote/lib/git.js`).
