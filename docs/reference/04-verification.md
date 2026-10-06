# 04. Finding verification protocol

This protocol is repo-local: backslop does not ship it to consumer projects. Use steps 1–4 to confirm a reported bug, step 5 to assess a dead-code candidate, and step 6 to assess a test-deletion candidate. Step 7 applies to every record. A candidate remains unverified until its applicable steps pass.

1. **Reproduce blindly.** Give the verifier only the finding title and the reported file:line sites. The verifier reads those sites and builds an independent reproduction in a throwaway project (for example, `git init` followed by `node <repo>/bin/backslop.js …`) or a fresh clone. Only after recording its own attempt does it read the reporter's evidence and rerun that reproduction on the base commit. **Evidence:** commands, complete outputs and exit codes taken from the commands themselves, such as `cmd > out 2>&1; echo rc=$?`, for both attempts. **Failure:** the independent attempt cannot reproduce the behaviour, or the recorded commands do not establish what ran and how it exited. Do not infer an exit code through a pipe.

2. **Check that the behaviour is wrong.** Search `README.md`, `docs/reference/`, ADRs, CLI help and tests for a promise or precedent that sanctions what was observed. Cite the relevant text and compare it with the reproduction. **Evidence:** the observed behaviour and exact citations from the searched sources, including any contrary source. **Failure:** a document or test promises the behaviour; route the item as a documentation or contract question instead of confirming a bug.

3. **Try to refute the finding independently.** A second pass checks for a sanctioned behaviour, CLI misuse, an impossible state for a supported consumer (backslop >= 0.9.0), an invalid or environment-specific reproduction, a proposed fix that breaks a documented contract or named test, or a duplicate. **Evidence:** a concrete citation or demonstration for each refutation; record unresolved doubt as doubt. **Failure:** any demonstrated refutation defeats the bug claim. An unsupported objection does not defeat it.

4. **Decide from the two passes.** Confirm a bug only when it is reproduced, wrong by the documented contract, and not refuted. If the passes disagree, a third pass reads both records, reruns the deciding step and rules on the disagreement. **Evidence:** each pass's commands, outputs and exit codes, plus the cited basis for the decision. **Failure:** a missing record, an unresolved disagreement, or a reproduction that was not judged wrong leaves the item unverified.

5. **Probe removal of dead code.**
   - a. Search for uses across `lib/`, `bin/`, `scripts/`, `test/`, `templates/` and `docs/`; record the search command and output. Mentions in backlog cards (`docs/backlog/`) and the archive (`docs/archive/`) quote the candidate and are not uses.
   - b. In a clone, run `npm test` before removal to establish the baseline.
   - c. Remove the candidate.
   - d. Rerun that suite.
   - e. Rerun `node bin/backslop.js lint`.
   - f. Record each exit code and every red test by name.
   - g. Compare red test names and assertion text with the baseline.
   - h. Record each unchanged pre-existing red as coverage the probe could not use, and keep that coverage open in the verdict until the test is rerun green before and after removal under the same conditions. A baseline red whose name or assertion changes after removal, or that turns green, is an unmatched baseline failure.
   - i. Rule on the claim: code is dead only if lint is green, removal adds no red test beyond tests of the removed code itself, and no coverage remains open.
   - j. For code claimed to serve only projects older than 0.9.0, use `git log -S` to cite the version that first wrote the newer form and show why a project stamped 0.9.0 or later cannot hold the old form.
   - **Evidence:** use search, removal diff, baseline and removal outputs and exit codes, red test names and assertions, and version history when relevant.
   - **Failure:** a live use, a new red test for behaviour beyond the removed code itself, a red lint check, an unmatched baseline failure, or an unproven version boundary defeats the dead-code claim.

6. **Probe deletion of a test.**
   - a. In a clone, run the unmutated suite as a baseline.
   - b. Mutate the code the candidate guards (for example, invert a condition).
   - c. Run the suite.
   - d. Name all red tests.
   - e. Count only tests newly red for that mutation, comparing names and assertion text with the baseline. The candidate must turn red; otherwise the mutation is invalid for this test.
   - f. Restore the code.
   - g. Disable the candidate with `test.skip`.
   - h. Apply the same mutation.
   - i. Rerun the suite.
   - j. Name at least one other test that turns red.
   - k. Repeat the full sequence with a second, different mutation of the same guarded code.
   - **Evidence:** baseline, both mutations, restoration and skip changes, suite commands, outputs, exit codes and red test names for every run.
   - **Failure:** an invalid mutation, a mutation caught only by the candidate, a pre-existing red counted as another guard, or an uncaught second mutation means deletion is not established. Delete-safe means another test catches every mutation tried.

7. **Make the evidence auditable.** Give every code claim a file:line citation and every behaviour claim its command, output and exit code. Give every number its measured quantity, commit and conditions. Run timing-sensitive tests without CPU contention: at most one suite per machine, with `--test-concurrency` no higher than 2 when other work runs alongside. Rerun a timeout failure alone before recording it as a finding. **Evidence:** those citations and run conditions, including the isolated rerun where required. **Failure:** a missing provenance or an unresolved timeout does not support a verdict.

The repository's `npm test` runs the full suite with `--test-timeout=60000 --test-concurrency=2`: at most two test files run concurrently. Keep these settings for baseline and candidate runs on a shared machine.

Windows behaviour is verified by reading the code unless a Windows machine runs the reproduction. For git-dependent behaviour, record the installed git version used for verification.
