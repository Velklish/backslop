# Result

- **Date:** 2026-10-23
- **Outcome:** completed

## What was done

Completed the research and implementation plan. No hook behavior was changed. The five requested cases reproduce the currently documented changed-file filter; they do not establish a violation of that contract. After this research, the owner explicitly approved the limited observation-based contract for v1.0.0; implementation is the separate active BS-254 and is not claimed by this result.

## Source and evidence boundary

The frozen source is commit `1e7b15ce01ab965477e33a685b82cff0f20b8dd3`, branch `quality/hook-research-20261023`. Recorded conditions: macOS arm64, Node `v25.2.1`, Git `2.54.0 (Apple Git-157)`, 2026-10-23 in the workspace timezone. Source HEAD was unchanged and the source worktree was clean before and after the probe batch.

The public attachments contain generic scripts and their hashes, not the raw execution receipts. Raw stdout, stderr, actual stdin bytes, argv, working directories, direct exits, session records, mutations and before/after diagnostics remain in the private evidence bundle:

```text
Symbolic location: {{PRIVATE_EVIDENCE_ROOT}}/hook-research/BS-225-research.tar.gz
SHA-256: 58df35d21da11ce520377217fb4ce767a458825119962503ea449657bff1f9a2
Recorded size: 141315 bytes
Archive entries: 1136; manifest readback passed
```

`{{PRIVATE_EVIDENCE_ROOT}}` is a location placeholder, not an actual recorded working directory. The raw bundle and full private report contain local home paths and are excluded from this public package. The scripts in [attachments](attachments/README.md) reproduce the generic inputs without requiring a private consumer or historical reporter fixture.

## Current shipped behavior

All source line references here refer to the frozen commit above.

- `docs/reference/02-cli.md:366-369`, `README.md:50` and `docs/adr/adr-055-docs-rules-ship-to-projects.md:40` define a file filter: paths different from the recorded start commit, including post-start commits and staged/unstaged work, plus non-ignored untracked paths. Lint errors are retained by matching file.
- `lib/hook.js:50-53` and `:79-96` read a session id, not authenticated write or edit provenance. `:121-128` records first start/time; `:138-151` computes eligibility; `:166-169` deduplicates and sorts displayed diagnostics.
- `lib/lint.js:52` stores internal errors as project-relative `file` and localized `msg`. Link problems are structured before rendering at `lib/lint.js:324-351` and `lib/links.js:525-569`.
- `test/hook.test.mjs:283-313` explicitly protects post-start committed work, staged/untracked inclusion and ignored exclusion.
- `docs/reference/02-cli.md:374-378` defines channel shapes, the three-report ceiling and operational fail-open cases. `:378-382` defines skipped cases and distinguishes their exit 0 from usage-refusal exit 1. Implementation: `lib/hook.js:25-37`, `:54-57`, `:152-163`.

## Five required reproductions

Each case uses a separate generic repository. Ordinary lint runs before the first primary start and again after the action; stop then runs as a real CLI process with synthetic event JSON. This is not a live harness observation.

| Case | Before and action | After: current stop diagnostic lines | Direct exits: before lint / start / after lint / stop |
|---|---|---|---|
| Old broken link plus harmless edit | `sample.md` already has `broken link missing-old.md (line 3)` in the baseline commit; append harmless prose. | `docs/reference/sample.md: broken link missing-old.md (line 3)` | `1 / 0 / 1 / 2` |
| Other synthetic session commits after primary start | Baseline has no errors. Start primary, start a second id, then the controlled action adds and commits a missing link. | `docs/reference/sample.md: broken link missing-new.md (line 3)` | `0 / 0 / 1 / 2`; second start also exits 0 |
| Primary synthetic session commits after start | Baseline has no errors. Primary action adds and commits the same missing link. | `docs/reference/sample.md: broken link missing-new.md (line 3)` | `0 / 0 / 1 / 2` |
| Insert a line before an old error | Old missing-link diagnostic is on line 3; insert one harmless line before the page. | `docs/reference/sample.md: broken link missing-old.md (line 4)` | `1 / 0 / 1 / 2` |
| Add a new error to an already-red file | Old missing link is on line 3; append a different missing target on line 5. | `docs/reference/sample.md: broken link missing-new.md (line 5)` and `docs/reference/sample.md: broken link missing-old.md (line 3)` | `1 / 0 / 1 / 2` |

All five starts are silent. All five primary stops use the Claude protocol: empty stdout, the diagnostic lines on stderr followed by `fix these errors in the files named above; do not bypass the hook`, then a newline. Exact primary synthetic stdin, each ending with one newline:

```json
{"session_id":"generic-primary","hook_event_name":"SessionStart","stop_hook_active":false}
```

```json
{"session_id":"generic-primary","hook_event_name":"Stop","stop_hook_active":false}
```

The second-session story is controlled by the reproducer's action log. Git and the hook do not authenticate it. The two commit cases share a generic Git identity; both leave a clean worktree and an empty HEAD-to-worktree diff, while their recorded-start diffs name the changed file. HEAD-only filtering would drop both, including the primary session's own committed error.

## Counts, commands and exits

The batch created **13 fixtures**, not 13 repository tests: the five required cases; staged and untracked controls; one protocol/ceiling/reset/bad-payload fixture for each of Claude, Cursor and Codex; duplicate-count and equal-count-replacement cases; and a dirty-at-start case.

The reproducer launched **280 child commands**. This count includes fixture Git setup/commits, version/source inspection, ordinary lint, structured diagnostic inspection and hook processes. All 280 direct exits matched their explicitly expected values, with no launch error or signal. Lint exit 1 and Claude/Codex stop exit 2 are expected observations, not failed tests. A structured diagnostic inspector exits 0 when inspection succeeds even if its returned `errors` array is nonempty; ordinary lint supplies the actual lint exit.

Commands below are **symbolic equivalents only, not the actual recorded argv or cwd**. `$NODE`, `$SOURCE`, `$PACKAGE`, `$OUTPUT` and `$FIXTURE` stand for locally resolved paths whose actual values remain in the private receipts. They are not evidence of an additional run.

| Symbolic equivalent | Recorded meaning and direct exit |
|---|---|
| `"$NODE" --check "$PACKAGE/reproduce.mjs"` | Original runner syntax check, exit 0. |
| `"$NODE" "$PACKAGE/reproduce.mjs" "$SOURCE" "$OUTPUT"` | Original serial batch, exit 0; 13 fixtures and 280 child commands. |
| `"$NODE" "$PACKAGE/verify-receipts.mjs" "$OUTPUT"` | Offline consistency check, exit 0; reads saved evidence only, no Git/CLI/test-suite subprocesses. Checked 280 command records and 13 fixtures, including stream bytes, diagnostic content, channels, counters and Git-state receipts. |
| `"$NODE" "$SOURCE/bin/backslop.js" lint` | Per-fixture before/after lint, exit 0 or 1 as shown above and in the raw receipts. |
| `"$NODE" "$SOURCE/bin/backslop.js" hook session-start --harness claude` | Per-fixture start, exit 0, with actual JSON stdin saved privately. |
| `"$NODE" "$SOURCE/bin/backslop.js" hook stop --harness claude` | Primary required-case stops, exit 2 with stderr diagnostics. |
| `git diff --name-only --no-renames HEAD --` | Empty output, exit 0, for both post-start commit cases. |
| `git diff --name-only --no-renames "$RECORDED_START" --` | Changed sample path, exit 0, for both post-start commit cases. |
| `git status --porcelain=v1 --untracked-files=all` and `git rev-parse HEAD` | Source before/after checks each exit 0; clean status and identical frozen SHA. |

Additional controls observed: staged status `M  docs/reference/sample.md`; untracked status `?? docs/reference/untracked.md`; untracked inclusion comes from `ls-files`, even when diff from start is empty. For each harness, the first three error reports use its existing channel; fourth stop is an exit-0 note, clean stop resets the count, and the next error reports with count 1. Invalid `session_id:7` fails open through that harness's note channel.

Claude/Codex reports use stderr + exit 2 and notes use stdout JSON `systemMessage` + exit 0. Cursor reports use stdout JSON `followup_message` + exit 0 and notes use stderr + exit 0. Harness consumption or display of these outputs was not observed. The generic repositories have no origin remote, so lint explicitly notes that tracker-URL checks into the repository were not performed.

The integrating coordinator reported the isolated research review as **critical 0, major 0, minor 1**. The minor finding concerned citation anchors. This public text uses the corrected `lib/lint.js:52` and `docs/reference/02-cli.md:378-382` anchors. This records that supplied review result; it does not claim a new behavior run or a completed review of a future implementation.

## Supported model and its limits

Raw rendered-message subtraction misclassifies the moved old line as new. Suppressing an entire previously red file hides the genuinely new target in the fifth case. A HEAD-only diff loses own committed work. None of those alternatives establishes session authorship.

The bounded proposal is a first-start observation baseline for **local missing-link identities only**. Preserve current eligible paths. At the first start, observe actual working state, including pre-existing staged, unstaged and untracked content. Store a versioned multiset keyed by project-relative file, missing-link rule id and logical href, excluding line/offset/localized text. For current count `C(k)` and baseline count `B(k)`, retain `max(0, C(k)-B(k))`. Preserve current coarse filtering for all unsupported diagnostics.

This suppresses old missing links after harmless edits or line shifts, still reports a new target in an already-red file, and preserves own committed work. A foreign post-start error also remains reportable. Equal-count replacement of an identical diagnostic is net zero: the model cannot identify the physical new occurrence. A duplicate identity requires counts, not a set; deterministic display-line selection is not an author claim. Baseline capture is a multi-read observation, not an atomic shared-worktree snapshot.

The proposal requires a versioned schema/compatibility fingerprint, conservative fallback for old/invalid/incompatible/unavailable baselines without discarding a valid start, no late capture at stop or repeated start, and preservation of existing return limits and channels. The 1 MiB serialized-baseline budget is a bounded implementation choice requiring boundary tests, not a measured requirement. Partial or oversized baselines must not suppress errors. One first-start lint pass and `O(D)` comparison/storage are proposed; wall time, peak memory and large-corpus behavior are **notMeasured**.

The shipped contract remains unchanged. The ADR-055 clarification records only that existing file-level boundary. The owner subsequently approved the limited baseline contract in a separate explicit decision; active `BS-254` implements it. This research result does not claim that implementation is complete. True exclusion of another session's edits requires a separately defined isolation or trusted provenance mechanism. No parallel ADR is proposed for this already-decided hook question.

## Unclosed work

- No implementation is claimed by this research. The later owner-approved semantic change is tracked independently as BS-254.
- Full repository tests, gates, candidate red/green acceptance, native Windows, installed launchers and live harness observations are **notRun**. The recorded macOS subprocesses do not close those boundaries.
- Performance and shared-worktree atomicity are **notMeasured/notEstablished**. The reproducer uses `/private/tmp` under the recorded macOS conditions; it is not a portability promise.
- Unsupported diagnostic families retain the existing file filter in the proposed first scope. Duplicate replacement and foreign post-start changes remain explicit limits.
- The coordinator owns tracker identifiers, the ADR-055 update, archive/attachment commits, folding, integration and publication. The original researcher prepared the package outside Git without changing repository files or task status; the coordinator subsequently applied the archive and documentation changes in the attachment acceptance.

## Integration

Documentation updated: ADR-055 clarifies current file eligibility, post-start own commits and the absence of authorship evidence; CHANGELOG records that boundary. The later BS-254 acceptance updates the ADR in place for the approved semantic baseline. Full combined integration gates are pending; their exact committed SHA, counts and direct exits will be recorded separately in the external execution report after all source changes are integrated. The research review had no critical or major finding; its two minor citation anchors are corrected above. Multi-task planning commits stay separate. The attachment acceptance retains these scripts in history before the separate native fold commit; no squash after the fold is permitted.
