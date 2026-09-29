# Repository inventory

What to look for, where to look, and what counts as evidence. Read in phase 1 of `backslop-seed`. The result is four candidate lists; write nothing into documentation before collecting them.

The first two lists — gates and subsystems — are collected in part by `{{cli}} seed --scan`: it reads the sources marked “scan” in the tables and lists below and prints every entry with a path as evidence; the ones marked “by eye” it does not see. A list is not a decision: the command enumerates, you select. Terms and decisions are not searched by the command; they are read by eye.

## Project gates

| Where | What to take | Read by |
|---|---|---|
| `package.json` → `scripts` | `test`, `lint`, `build`, `typecheck` | scan |
| `*.csproj`, `*.sln` | `dotnet build`, `dotnet test` | scan |
| `Directory.Build.props` | analyzers from `PackageReference` | by eye |
| `pyproject.toml`, `setup.cfg`, `tox.ini` | `pytest`, `ruff`, `mypy` as declared | scan |
| `noxfile.py` | sessions as declared | by eye |
| `Makefile`, `justfile`, `Taskfile.yml` | `test`, `lint`, `check` targets | scan |
| `.github/workflows/*.yml`, `.gitlab-ci.yml` | What CI actually runs — the strongest evidence: the command that makes the pipeline fail | scan |
| `README.md`, `CONTRIBUTING.md` | Commands the project asks contributors to run before submitting | by eye |

`gates` contains commands that pass on a clean checkout without manual steps. A command requiring secrets, network access, or a running database does not go into `gates`; name it as a manual verification in the subsystem README.

## Subsystems

- Top-level directories and solution projects: `src/*`, `services/*`, `apps/*`, `packages/*`, `.csproj` projects (scan).
- Entry points: `Program.cs`, `index.ts`, `index.js`, `main.go`, `main.py`, `main.ts`, `main.rs`, and the scripts in `bin/` (scan).
- A bare `cli/` or `cmd/` directory without an entry file (by eye).
- Data boundaries: migrations, schemas, `docker-compose` — which stores and queues exist (by eye).
- Each subsystem is a “section → subject” row with a directory path as evidence. Name a section after the directory, not a guessed purpose.

## Terms

A candidate is a name a reader outside the project would not understand or would understand incorrectly:

- domain entities: model classes, aggregates, tables, collections;
- events and messages: queue, topic, and event type names;
- enumerations and statuses: `enum`, state constants;
- configuration keys and flags;
- words in README and discussions that differ from names in code — these are precisely the disputed terms;
- project-specific abbreviations.

Evidence for a term is a path to its definition or first use. A word found only once in a comment is not a candidate.

## Decisions

An ADR candidate is a choice with an alternative and consequences:

- major dependencies: framework, database, broker, ORM, test framework — evidence is in the package manifest;
- “why” in comments and README: lines containing “because”, “decided”, “intentionally”, `NOTE`, or `HACK` with an explanation;
- moves in history: `git log --diff-filter=R --stat`, commits with “migrate”, “replace”, or “switch”;
- structural conventions: layering, module boundaries, error format, API versioning.

Not a candidate: a tool default whose alternatives were never considered; a choice whose reason is unknown and cannot be restored from history — list it as “rationale unknown”, then the owner decides whether to write an ADR with “recorded retrospectively; reason lost”.

## What not to document as fact

- Generated output: `dist/`, `build/`, `bin/`, `obj/`, `node_modules/`, migrations generated from models.
- Stale READMEs: a claim that conflicts with code is recorded as a discrepancy, not a fact.
- Development dependencies as though they were the production stack.
