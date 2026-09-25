# BS-83 · Add the finding verification protocol to docs/reference

- **Order:** 10
- **Scope:** [Reference](../../reference/README.md)
- **Created:** 2026-09-25
- **Dependencies:** none

## Context

The backlog now carries items of two kinds: findings that were independently verified, and findings that carry only the reporter's own reproduction. Every card labels each item as `verified` or `unverified`, and the unverified ones start with a check. The check itself is the same procedure everywhere, so it belongs in the reference once, as an agent-facing document, instead of being repeated in every card.

The procedure that produced the current backlog:

1. **Blind reproduction.** The verifier gets only the title and the file:line sites, not the reporter's evidence. It reads the code at the sites, builds its own reproduction in a throwaway project (`git init`, `node <repo>/bin/backslop.js …`) or in a fresh clone, and records every command with its output and exit code taken from the command itself (`cmd > out 2>&1; echo rc=$?`, never through a pipe). Only then it opens the reporter's evidence and re-runs it on the base commit.
2. **Wrong-behaviour check.** Reproduced is not the same as wrong. The verifier searches README.md, docs/reference, the ADRs, the help text and the tests for anything that sanctions the observed behaviour and cites what it finds. A behaviour that a document or a test promises is not a bug; the card becomes a documentation or contract question instead.
3. **Refutation with a citation.** A second, independent pass tries to kill the finding: a document, ADR or test that sanctions the behaviour; a misuse of the CLI; a state that no supported consumer (backslop >= 0.9.0) can be in; an invalid reproduction (environment-specific, wrong assumption); a proposal that breaks a documented contract or a named test; a duplicate of another item. A refutation without a concrete citation or demonstration does not count; doubt is recorded as doubt.
4. **Decision.** A bug survives when it is reproduced, judged wrong and not refuted. When the two passes disagree, a third pass re-reads both records, re-runs the deciding step and rules. Every pass leaves a record with commands, outputs and exit codes.
5. **Removal probe for dead code.** Prove zero uses with a grep over lib/, bin/, scripts/, test/, templates/ and docs/ (record the command and its output). In a clone, delete the code, run the suite (`node --test --test-timeout=60000`) and `node bin/backslop.js lint`, record both exit codes and the names of any red tests. Dead means green after removal, or red only in tests that test the removed thing itself. For code that only pre-0.9.0 projects need, cite the tool version that first wrote the newer form (`git log -S`) and show that a project stamped 0.9.0 or later cannot carry the old form.
6. **Mutation probe for test deletion.** In a clone, break the code the test guards (invert the condition, delete the line), run the suite and list the red tests: the candidate must be among them, otherwise the mutation is wrong. Restore the code, disable the candidate (`test.skip`), break the code again and run the suite: at least one other test must go red for the same mutation, and it is named in the record. Repeat with a second, different mutation of the same guarded code. Delete-safe means every mutation tried is caught by another test; a mutation caught only by the candidate keeps the test.
7. **Evidence format.** A claim about the code carries file:line. A claim about behaviour carries the command, its output and its exit code. A number carries what was measured, on which commit and under which conditions. Timing-sensitive tests are not run under CPU contention: at most one suite at a time per machine, `--test-concurrency` no higher than 2 when other work runs alongside; a red test whose failure is a timeout is re-run alone before it is recorded.

The document also states what the protocol does not cover: Windows behaviour is verified by reading the code unless a Windows machine runs the reproduction, and git behaviour is verified against the installed git version, which is recorded.

## Work to do

- Add `docs/reference/04-verification.md` (English) with the seven steps above as the normative procedure for confirming a finding, a dead-code candidate and a test-deletion candidate, each step with its evidence requirement and its failure condition.
- Add the file to the table in `docs/reference/README.md` and to the reference table template in `templates/en/docs/reference/README.md` and `templates/docs/reference/README.md` only if the owner decides the protocol ships to consumers; otherwise keep it repo-local and say so in the document's first paragraph.
- Point to the document from the card template's Verification section guidance in `AGENTS.md` (outside the managed block): an unverified item in a card starts with the protocol's steps 1–4 (bugs), 5 (dead code) or 6 (tests).
- Reference the document from the consolidated ADR on findings and their evidence when that ADR is written, without duplicating the steps there.

## Out of scope

- Changing the lint gates or the `new --minor --evidence` contract.
- Automating the protocol as a CLI command.

## Verification

- `node bin/backslop.js lint` exits 0 with the new file linked from the reference table.
- `grep -n '04-verification' docs/reference/README.md AGENTS.md` shows both pointers.
- A reader with only the document can run steps 5 and 6 on `lib/log.js:177 hasLog` (known dead export) and on `test/init.test.mjs:733` (known delete-safe test) and reach the recorded verdicts.
