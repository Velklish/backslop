# BS-207 · status prints the Deferred date line where a reader expects the reason

- **Scope:** [05. Orchestrator contract](../../reference/05-orchestrator-contract.md) § status --json
- **Created:** 2026-10-02
- **Dependencies:** none

## Context

Evidence: `status` and `status --json` show a deferred card by the first line of its Deferred section, and `mv … deferred` writes the date line first. `lib/status.js:28` reads `firstLine(sectionBody(text, SECTION_DEFERRED))`; `lib/mv.js:176-178` writes the section as `- **Deferred:** <date>`, then `- **Reason:** …`, then `- **Return condition:** …`. Measured on c9c6f54 after moving ten cards with `node bin/backslop.js mv … deferred` and filling their Reason: `node bin/backslop.js status` prints `BS-192.7 · 01 Layout and formats: no first paragraph states the reader and the task — - **Deferred:** 2026-10-02` (rc 0), and `node bin/backslop.js status --json` prints `"deferred":"- **Deferred:** 2026-10-02"` for the same card (rc 0).

The line in `lib/status.js` dates from v0.1.0 (`git log -L28,28:lib/status.js c089b72` ends at `affdef0`), so no later task introduced it.

It is documented as is: `docs/reference/05-orchestrator-contract.md` line 83 shows `"deferred": "- **Deferred:** YYYY-MM-DD"` and line 111 says `deferred` is the first non-empty line of the Deferred section, as written in the file and in its language. Line 406 makes the keys of `status --json` stable; the value of `deferred` is not in that table, so by line 420 (what the table does not name is described behaviour, not a guarantee) it is described behaviour. A fix updates lines 83 and 111 of 05 and the CHANGELOG, without an ADR.

## Work to do

- For the owner to choose: keep the documented value (the first non-empty line of the Deferred section, which `mv` makes the date line), or print the Reason line without its markup.
- If the Reason line is chosen: `lib/status.js`, `docs/reference/05-orchestrator-contract.md` lines 83 and 111 and the CHANGELOG entry; no ADR.

## Out of scope

- The order of the three lines that `mv` writes into the Deferred section.

## Verification

- If the Reason line is chosen: a test that moves a card to `deferred`, fills its Reason, and expects `status` and `status --json` to carry the Reason text, failing on the old line; lines 83 and 111 of 05 state the new value.
- If the documented value stays: the owner decision is recorded in the card, and the card is closed as rejected.
