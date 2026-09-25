# BS-93 · upgrade: resolve a relative `source` path from the project root

- **Order:** 110
- **Scope:** [02. CLI](../../reference/02-cli.md) § upgrade
- **Created:** 2026-09-25
- **Dependencies:** BS-84

## Context

Line numbers refer to base commit 6f6318e (v0.11.0). `$BS` below is `node <repo>/bin/backslop.js`; throwaway projects are created with `git init -q && $BS init --lang en --tools none` unless stated otherwise.

One verified bug in how `upgrade` lists release tags from a local `source`.

**1. Medium — a relative `source` path is resolved against the git toplevel or the shell cwd, not the project root.** verified — reproduced on 6f6318e in a monorepo subproject and in a project without git.
- Monorepo `mono/` with the project in `pkg/a` and `"source": "../tool"` (`pkg/tool` exists): `$BS upgrade --dry-run` from `pkg/a` → rc=1 `✖ git ls-remote --tags ../tool: fatal: '../tool' does not appear to be a git repository`; the toplevel-relative spelling `pkg/tool` works. Without git, running from a subdirectory of the project fails the same way while running from the root works.
- Root cause: lib/upgrade.js:18-23 `spawnSync('git', ['ls-remote', '--tags', '--refs', source], {…})` has no `cwd` and passes `source` verbatim, while every other step runs with `cwd: root` (lib/upgrade.js:81, called at :145, :162-164). docs/reference/01-layout.md:46 documents `source` as "a git address or a path" without saying what the path is relative to.

## Work to do

- Run `git ls-remote` for a local `source` from the project root (pass `root` to `listReleaseTags` and use `cwd: root`); state in docs/reference/01-layout.md § backslop.json that a path in `source` is relative to the project root.
- Add the regression test listed under Verification to test/upgrade.test.mjs; CHANGELOG.md, unreleased section: a relative `source` is resolved from the project root.

## Out of scope

- Other `upgrade` fixes (probe, from-version, gate rewrite, floating cli, write order) — BS-84 (`upgrade-completes-pinned-consumers`).

## Verification

- New test: git repo with the project in `pkg/a` and `source: "../tool"` pointing at a tagged repo → `upgrade --dry-run` rc=0 from `pkg/a` and from `pkg/a/sub`.
- `npm test` → rc=0; `node bin/backslop.js lint` → rc=0.
