# ADR-053: Seeding: the seed command extracts candidates, the agent and the owner select

**Status:** Accepted
**Date:** 2026-09-29
**Deciders:** Velklish

## Context

After installation the `backslop-seed` skill fills a project's documentation in two mechanical steps: an inventory of gate and subsystem candidates, and one "Reference: …" task per row of the reference table. Done by hand, the inventory is silently incomplete — a missed source looks like "the project has none" — and the seeding loop re-decides settled questions on every pass and duplicates tasks on a re-run. Choosing a real gate, on the other hand, needs knowledge the files do not show: whether a command needs secrets, the network or a database.

## Options

- **The command selects `gates` and writes them to `backslop.json`** — whether a command runs on a clean checkout is not visible in files, and a gate that cannot run breaks every later hand-in.
- **A slug transliterated from the row title** — it needs a mapping table in the tool and still gives disputed spellings an agent would fix by hand.
- **A full YAML parser for CI files** — the tool would gain a runtime dependency ([the runtime and delivery ADR](adr-039-node-runtime-delivery-release.md)).

## Decision

- **Two modes, one per call** (`run` in `lib/seed.js`): `seed --scan [--json]` and `seed --queue-reference`; `--json` belongs to `--scan` only.
- **`--scan` extracts and writes nothing.** Each candidate carries its evidence: the file or directory, with the line or key where there is one. `--json` prints `{ gates: [{ command, evidence }], subsystems: [{ name, evidence }], total }`, where `total` is the number of subsystems.
- **Gate candidates** (`scanGates`): `package.json` scripts named test, tests, lint, check, build, typecheck, type-check, fmt or format (`GATE_NAME`), as `npm run <name>`; targets with those names at the start of a line in `Makefile`, `makefile` and `justfile`, and at a two-space indent under `tasks:` in `Taskfile.yml` or `Taskfile.yaml`; `run:` values in `.github/workflows/*.yml|yaml` and `script:` or `before_script:` values in `.gitlab-ci.yml|yaml`, read line by line — the value on the key's line or the lines indented below it (`ciCommands`); `dotnet build` and `dotnet test` for each `*.csproj` and `*.sln`, the path double-quoted when a shell needs it, and no command but a warning for a path holding `"`, `$`, a backtick, `\` or `%`; `pytest`, `ruff` and `mypy` on lines of `pyproject.toml`, `setup.cfg` and `tox.ini`.
- **Subsystem candidates** (`scanSubsystems`): child directories of `src/`, `services/`, `apps/` and `packages/`; each `*.csproj`; the directory of each entry file `Program.cs`, `index.ts`, `index.js`, `main.go`, `main.py`, `main.ts`, `main.rs`; script files directly in `bin/` — a script extension, or no extension and a `#!` first line.
- **The tree walk** (`walk`) skips the service directories of the markdown walk, build output and environments (`SKIP_BUILD`), `.git*` entries and linked worktrees of the same repository — a submodule is walked — and does not follow symlinks.
- **`--queue-reference`** reads `<docs>/reference/README.md`, refused when it is missing, and takes the first link of each table row; an external link or a target file that exists is skipped. The slug is `describe-<basename of the target>`; two rows whose targets share a basename, or a basename that a task for another file already holds, take the parent directory into the slug with a warning; a target that yields no valid slug is named in the output and left to the agent. A re-run creates no duplicate: a row counts as seeded when a task with its slug exists whose Scope names the same file in a code span or names no file, or, for a folded task, whose journal title is the row's "Reference: <label>" in either language. The task is created by `createTask` in `lib/tasks.js`, like `new --queue`, so number, queue place and template are shared, and its Scope names the reference section in the project language.
- **The source list is the code.** The scanned sources are what `scanGates` and `scanSubsystems` read; the skill reference of `backslop-seed` must keep the sources the scan reads apart from those the agent reads by eye, and a new scanned source is added to the code.

## Consequences

- Completeness of the inventory is the code's responsibility, visible in `lib/seed.js`, not in a session's diligence.
- CI files are read line by line: YAML anchors, job templates and matrices are missed, and Taskfile targets are seen only at a two-space indent, which the format does not require. The output is a list of candidates, not a guarantee.
- Deduplication reads every task — status directories, the archive and the journal: a closed task for the same reference section blocks re-seeding it, and a new task for that section is created by hand.
- Nothing checks the skill reference against the scanner; a source named in one and not the other drifts silently.
- The current skill reference does not separate the two yet: it says the scan walks the sources of both its tables, and those tables also name sources the scan does not read.
