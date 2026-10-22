# BS-253 · Observe stop-hook returns and notes in the installed live harnesses

- **Scope:** [02. CLI - hook](../../reference/02-cli.md#hook)
- **Created:** 2026-10-23
- **Dependencies:** none
- **Cost:** —
- **Previous order:** 170
- **Taken:** 2026-10-23

## Context

The owner expanded this run to every non-Windows backlog item before v1.0.0. BS-195.1 and BS-195.2 are unobserved live-harness hypotheses, not reproduced defects. Unit tests and synthetic stdin cannot establish the actual harness callback or its rendered note.

## Work to do

- [BS-195.1](../minor/BS-195.1-hook-note-channel-not-observed.md): observe note channels in real Claude Code, Codex and Cursor sessions on disposable generic projects.
- [BS-195.2](../minor/BS-195.2-hook-codex-cursor-stop-not-run.md): observe Stop in real Codex and Cursor, including actual return to the agent and intended protocol.
- Verify installed runtime/version/launcher and the actual hook configuration. Preserve complete event/terminal streams and source hashes. Distinguish rendered user-visible notes from raw protocol bytes.
- If live observations expose a confirmed product defect, record reproduction and fix within this hook scope with meaningful regression coverage.

## Out of scope

Unrelated refactoring, native Windows verification, package publication and remote history replacement.

## Verification

Use sequential live sessions with generic fixtures, bounded turns and exact installed runtime/source receipts. Record callback execution, payload shape, exit/channel, whether the agent receives a follow-up, and whether a note is visible. Missing authentication or unavailable harness capabilities must remain explicit blockers, never a successful unit-test substitute. No native Windows, production consumer editing or private transcripts. Fresh review and final integration gates are required.
