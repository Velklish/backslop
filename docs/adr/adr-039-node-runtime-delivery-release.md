# ADR-039: Zero-dependency Node runtime, npx delivery and release

**Status:** Accepted
**Date:** 2026-09-28
**Deciders:** Velklish

## Context

backslop lays a process into a project with one command, on machines where a coding agent is already installed. That command must work without an install step and must not bring dependencies that someone has to keep current. Node is present wherever agents are installed from npm. The skills and the AGENTS.md block that the tool renders are read by agents in every project, so they must not depend on how the tool was installed there. Upgrading a project needs a version source it can list and compare: release tags of the tool repository are that source.

## Options

- **Python delivery** (`uvx` or `pipx` from git) — needs `uv` or `pipx` preinstalled and a rewrite of the code and the tests.
- **Runtime dependencies** — an install step on every machine and a stream of updates to track.
- **npm registry delivery as the default** — the package is not published, and a default pointing at an unpublished package breaks every new project.

## Decision

- **Runtime.** Node ≥ 20, standard library only, no dependencies and no build or prepare step. `package.json` declares `engines.node` `>=20` and neither `dependencies` nor `devDependencies`; every import in `bin/`, `lib/` and `scripts/` is a `node:` module or a relative path. The invariant is "no dependencies, no build step", not a list of manifest fields. The only automated check is the tarball test in `test/release.test.mjs`: it asserts that `dependencies` is empty and installs the packed tarball with `--offline`.
- **Default delivery.** `npx github:Velklish/backslop#vX.Y.Z`, pinned to the tag of the version that made the layout (`SOURCE` and `defaultCli` in `lib/config.js`). `init` writes it into a new config unless `--cli` is given, and seeds `gates` with `<cli> lint`.
- **The `cli` field.** Inside a project the command is the `cli` field of `backslop.json`; templates render it as `{{cli}}`, so skills and the block name the same command however the tool was installed. `parseCli` in `lib/config.js` recognises two release forms, each with optional npx flags written as `-x`, `--name` or `--name=value`:
  - `npx [flags] github:owner/repo[.git][#[v]X.Y.Z]` — the tag may be written with or without `v`;
  - `npx [flags] backslop[@X.Y.Z|@latest]`.

  A form without an exact version (no tag, `@latest`) carries no pin. Any other value — a global install, `node bin/backslop.js` in this repository — is not a release form and has no pin. `withPin` writes a pin back as `#vX.Y.Z` or `@X.Y.Z`, and `pinRe` finds a pin in prose in the same two shapes (`[.git]#[v]X.Y.Z` and `@X.Y.Z`). This ADR owns the list of forms; the version pin and upgrade ADR states how a pin is read and moved.
- **npm form.** The package is not published to npm. The npm form is supported for projects that install the tool another way, and such a project must declare `source`: `upgrade` takes its release source from `source` or from the repository of a GitHub form, and the npm form names no repository.
- **Release is two steps** (`scripts/release.mjs`).
  - `npm run release -- X.Y.Z --bump` raises the `package.json` version (upward only), renames the top CHANGELOG section to `## vX.Y.Z — <date>` (a top section that already carries a version is refused) and restamps `backslop.json` by running `init`. The agent reviews the diff and commits it.
  - `npm run release -- X.Y.Z --no-publish` then checks that the `package.json` version equals the argument, the branch is `main`, the tree is clean, the tag exists neither locally nor on `origin`, and, after `git fetch origin`, that `origin/main` is an ancestor of `HEAD`. It runs `npm test`, `npm run lint` and `npm pack --dry-run` and refuses if they changed the tree, creates the tag, dry-runs the atomic push, then pushes `main` and the tag atomically.
  - `--bump` together with `--no-publish` is refused, and so is any other flag.
  - Without `--no-publish` the script also runs `npm publish`, between the push dry run and the atomic push. That is the script's behaviour as it stands; this ADR does not decide whether the flagless default should publish.
- **One version number in this repository.** Lint gate 11 (`lintReleaseVersions` in `lib/lint.js`) runs only in the tool repository: the `package.json` version equals the `backslop.json` stamp, `CHANGELOG.md` has a `## vX.Y.Z` section for it, and every install pin in prose in the files named by `RELEASE_PIN_FILES` names that version.

## Consequences

- git is required on the machine: the first npx run clones the repository, later runs use the npx cache, and offline use needs a local or global install.
- Without a release form in `cli` there is nothing to pin: the lint pin checks are silent outside the tool repository, and `upgrade` refuses unless `source` is set.
- Running the release script without `--no-publish` publishes to npm. The release path of this repository always passes `--no-publish`.
