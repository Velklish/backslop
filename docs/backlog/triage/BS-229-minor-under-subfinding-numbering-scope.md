# BS-229 · new --parent N.M --minor numbers the entry N.k under the root and leaves Scope empty, which lint then flags

- **Scope:** [02. CLI § new](../../reference/02-cli.md#new)
- **Created:** 2026-10-04
- **Dependencies:** none
- **Cost:** minor

## Context

On 2026-10-03 in diffalanche (run bs020), `new <slug> --parent 110.6 --minor --evidence …` created DA-110.7 with "Parent: DA-110.6". The number is the next one under the root DA-110, not a number under DA-110.6. The entry's "Scope" was empty, and `lint` then warned about it. So the command produces an entry that lint flags, and the number does not show the parent the entry names.

## Work to do

- Decide the numbering for a finding of a finding, and state it in 02. CLI § new: under the root with "Parent: N.M", or N.M.k.
- Fill "Scope" from the parent, or ask for it, so that a fresh entry passes lint.

## Out of scope

- Renumbering existing entries.

## Verification

- `new --parent N.M --minor --evidence …` in a fixture gives the documented number and an entry that `lint` passes without a warning; a test fails on the old `new`.
