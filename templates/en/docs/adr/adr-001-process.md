# ADR-{{adrNumber}}: Tasks and decisions are managed with backslop

**Status:** Accepted
**Date:** {{date}}
**Deciders:** the project owner

## Context

The project needs a task tracker and decision log that live alongside code, can be read by an agent without external services, and do not conflict when branches are worked on in parallel. A task list in one file conflicts on every closure; decisions scattered across chats cannot be found when needed.

## Decision

Tasks and decisions are managed with backslop. The tool version is pinned in `backslop.json` (`cli` with a tag and the `version` stamp); update with `{{cli}} upgrade`, while `migrate` changes file formats between versions.

The mechanics are not repeated here: see [backlog/README.md](../backlog/README.md), [archive/README.md](../archive/README.md) and the backslop section of `AGENTS.md`.

## Consequences

- The cost is discipline: `lint` maintains links, numbers, and fields, but authors maintain the substance of task definitions and results.
