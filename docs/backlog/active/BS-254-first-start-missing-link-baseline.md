# BS-254 · Suppress pre-existing local missing-link diagnostics with a first-start observation baseline

- **Scope:** [02. CLI — hook](../../reference/02-cli.md#hook)
- **Created:** 2026-10-23
- **Dependencies:** BS-225, BS-235
- **Cost:** —
- **Previous order:** 180
- **Taken:** 2026-10-23

## Context

Research at `1e7b15ce01ab965477e33a685b82cff0f20b8dd3` reproduced the five cases in BS-225 and confirmed that the current changed-file filter sanctions them. A file match establishes neither authorship nor new-error identity. Accepted ADR-055 records the current file-level boundary. Owner decision on 2026-10-23 explicitly approves this limited observation-based contract for v1.0.0: net new local missing-link identities relative to actual first-start state, retaining conservative treatment of all other diagnostics. No true authorship guarantee or parallel ADR is approved.

Current inputs cannot exclude another session's edits in a shared worktree. A foreign post-start missing link remains reportable. Equal-count replacement of an identical diagnostic is net zero, not proof that no physical occurrence was newly written. This card must not be implemented or described as true per-session author attribution.

## Work to do

1. At `lib/lint.js`'s existing link-check boundary, add optional internal semantic identity metadata only for `checkLinks` problems with `kind === 'missing'`. Identity: project-relative source file, stable missing-link rule id and parser logical href. Exclude line/offset/localized message/label text. Preserve printed ordinary lint diagnostics. Do not introduce a localized-message parser or refactor all lint gates.
2. In `lib/hook.js`, attempt one complete in-process lint observation at the first start for each harness/session pair. Include actual pre-existing staged, unstaged and untracked project state. Store a versioned identity multiset plus compatible tool/config fingerprint in the current session record. A failed/oversized/incomplete capture leaves suppression unavailable; do not store a partial baseline as usable.
3. Preserve current changed-path eligibility against the recorded first start, plus relevant untracked paths. For supported identity `k`, retain `max(0, C(k)-B(k))`; then retain current display deduplication/sort. Match baseline quota in current source order for deterministic display without claiming occurrence provenance. Unsupported errors keep the current coarse file filter; warnings and errors without a file stay excluded.
4. Preserve the first baseline or its unavailability on repeated same-session starts, together with first start/time; reset only the report count. Never learn or refresh a baseline at stop or a later same-session start. A new session id may observe a new baseline.
5. Validate the optional baseline independently of a valid legacy start. Missing, malformed, incompatible, unsupported, unavailable or oversized baseline data falls back to current file filtering; it must not silently shift a valid start to HEAD. The bounded implementation budget is 1 MiB serialized baseline; use no truncation. Preserve operational fail-open exit 0 and note channels when hook operations fail, and usage-refusal exit 1.
6. Preserve the three-report ceiling, its clean-stop reset and changed-error counting. Preserve all three harness report/note channel and exit shapes. Do not change hook installation or payload fields.
7. Add focused tests in `test/hook.test.mjs` and a meaningful identity/multiplicity check in `test/lint.test.mjs` if the existing boundary has no such guard. Capture selected cases red on the exact base before implementation and green afterward. Keep existing own-commit/staged/untracked/ignored/protocol checks intact.
8. Under the owner-approved limited contract, rewrite ADR-055's hook decision in place for the implementation; do not create a parallel same-question ADR. Update `README.md`, `CHANGELOG.md`, `docs/reference/01-layout.md` and `docs/reference/02-cli.md` together. Change `docs/reference/03-lint.md` or process templates only if their promises become inaccurate. New visible text must use `msg` and its Russian twin. Do not put research task narratives into product documentation.
9. Measure first-start and stop cost separately on a generic generated corpus at exact candidate/base SHAs under the same Node/Git and corpus hashes, without a concurrent suite. Record command exits, wall time, memory if measured, and conditions. Current wall time, memory and large-corpus behavior are **notMeasured**. Do not generalize the generic probe batch's wall clock.

## Five-case acceptance expectations

| Case | Expected bounded behavior |
|---|---|
| Old missing link plus harmless same-file edit | Silent stop exit 0 for supported baseline debt; ordinary lint remains red. |
| Other synthetic session commits a new missing link after start | Still report it as new relative to observation, without an author claim. |
| Primary session commits a new missing link after start | Still report it with a clean working tree; preserve recorded-start eligibility. |
| Insert a line before an old missing link | Silent stop exit 0 despite changed display coordinate. |
| Add a new missing-link target in an already-red file | Report the new target only; ordinary lint still reports old and new. |

## Acceptance criteria

- The old-error/harmless-edit and line-shift tests fail against the frozen base and pass against the committed candidate; the already-red-file test fails for returning both old and new on base and passes for new only. Record complete assertions and direct exits. These are a future semantic change, not existing-contract bug tests.
- Staged, unstaged and untracked variants preserve observed baseline debt while detecting newly added targets. Own post-start commits and foreign post-start changes both remain reportable. Replacing eligibility with HEAD must make the own-commit guard fail.
- Adding a duplicate identity increases the retained net count; a set-based suppression mutation is caught. Equal-count identical replacement is explicitly tested as net zero, with no physical-occurrence promise.
- Old records without a baseline, invalid/unsupported/incompatible baseline schema, failure during capture, exact budget boundary and oversized baseline all have named cases. No fallback discards a valid recorded start; no partial capture suppresses errors; no same-session late capture hides a new error.
- Repeated start preserves first start/time/baseline while resetting returns. New session ids get their own observation. Unsupported diagnostic families retain coarse behavior; warnings/no-file errors remain excluded.
- Claude/Codex error stderr + exit 2, stdout `systemMessage` notes + exit 0, Cursor stdout `followup_message` + exit 0 and stderr notes + exit 0 remain exact. The fourth consecutive report is a note; changing identities does not reset the count; a fully suppressed/no-kept stop resets it.
- First-start/stop cost and record growth are recorded under stated conditions. No per-diagnostic subprocess, second CLI lint pass, worktree creation, network service or gates run inside the hook.
- Run focused tests and the repository gates under the coordinator's sole host test slot, with concurrency no higher than 2. Record actual commands, candidate SHA, counts/skips and direct exits; then apply the repository's committed clean-tree/base gate recipe. Keep native Windows and live harness observations separately named; fake stdin does not close them.

Proposed commands below are future verification instructions, not a claim they ran during research:

```sh
node --test --test-timeout=60000 --test-concurrency=2 test/hook.test.mjs test/lint.test.mjs
node bin/backslop.js gates
```

## Out of scope

True session/author attribution, excluding foreign edits, trusted write ledgers, per-session worktree isolation, transactionally atomic snapshots, additional diagnostic families, rename lineage, session-id authentication/collision redesign, record cleanup, new flags, harness registration or installation changes, consumer upgrades and publication. No general lint baseline or suppression of an entire red file. No HEAD-only shortcut. No broad refactor of diagnostics or adjacent code.
