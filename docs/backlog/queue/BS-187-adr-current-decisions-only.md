# BS-187 · ADRs hold current decisions only: gate 8 refuses a replaced status, templates state the rule

- **Order:** 1010
- **Scope:** [03. Lint](../../reference/03-lint.md)
- **Created:** 2026-09-28
- **Dependencies:** BS-158, BS-159, BS-166

## Context

Owner decision 4 of BS-183: ADRs hold current decisions only. A new decision on a question already decided rewrites that question's ADR in place: same number, the rationale that still holds. A chain of ADRs on one question folds into its highest number. An ADR that governs nothing is deleted, and git keeps its history. Allowed statuses: Proposed and Accepted.

**The template states the opposite today.** `templates/en/docs/README.md:17` at 744a653, and its ru twin at the same line:

> An accepted decision is not edited; it is superseded. A new decision on the same question gets a new ADR; the replaced ADR retains a "superseded by ADR-NNN" note.

BS-166 renumbers the index principles and keeps this one.

**Gate 8 does not read statuses.** verified — a repro at 744a653. In a fresh `init --lang en` project, `adr old-way`, then set its status line to `**Status:** Superseded by ADR-001` and add its row to `docs/README.md`: `lint` exits 0.

**Source.** promptobus v0.20.0 (github.com/Velklish/promptobus, tag `v0.20.0`):

- `test/adr-consolidation.test.mjs`: no ADR carries a status other than Accepted; the index lists exactly the ADR files present, by count and by name, each row linking its own file, with no duplicate;
- the rule in its `docs/README.md`.

promptobus folded five chains into their highest numbers and deleted nine ADRs before its 0.20.0 release.

**Measured, 2026-09-28**, the first word of each ADR's status line:

| Project | ADRs | Status | Status line naming another ADR |
|---|---|---|---|
| consumer 1 | 44 | all Accepted | 11 |
| consumer 2 | 45 | all Accepted | 0 |
| consumer 3 | 16 | all Accepted | 0 |
| consumer 4 | 15 | all Accepted | 0 |
| this repository at 744a653 | 38 | 8 `Superseded in part` | 8 |

In consumer 1, three ADRs write the status as a list item in Russian, `- **Статус:** Accepted (…)`. Its eleven chain lines read like "Accepted, refines ADR-NNN" or "Accepted (…), partly replaced by ADR-NNN". Block 4 (BS-143 … BS-156) replaces this repository's 38 ADRs with consolidated ones, so the gate lands on a clean set here.

**Minor BS-154.1** asks to gate or drop the Status column of the index table.

## Work to do

- **Gate 8, the status line.** Every ADR file has a status line: `**Status:**` or the ru label of the template layer, optionally as a list item `- **…:**`. Errors:
  - a missing status line;
  - a first word other than `Proposed` or `Accepted` (and the ru equivalents the template layer uses), for example `Superseded`, `Superseded in part`, `Deprecated` or `Rejected`;
  - a status line that names another ADR, by an `ADR-NNN` token or a link to `adr-NNN-…`: that marks a chain.

  The error quotes the line. The hint: fold the decision into the ADR that governs the question now, then delete the replaced file.
- **Gate 8, the index.** Every ADR row links an existing ADR file (gate 1 already checks the link), no file is listed twice, and the row's Status cell equals the status word of its file. This closes BS-154.1 by gating the column; the approver closes it with `archive 154.1 --into 187`.
- **Templates,** en first and then ru, keeping parity. The index principle becomes:

  > The ADR directory holds current decisions only. A new decision on a question already decided rewrites that question's ADR in place: same number, the rationale that still holds, the consequences of the change. An ADR that no longer governs anything is deleted; git keeps its history. A chain of ADRs on one question is folded into its highest number.

  `templates/{en/,}adr.md` keeps `Status: Proposed`.
- **`backslop-task` skill** (both layers): a short section, "Changing a decision":
  - rewrite the ADR in place;
  - when folding a chain, carry every constraint and measurement that still holds, measurements with their version and date;
  - list for the reviewer where each constraint of a deleted ADR went, or why it no longer governs;
  - delete the replaced files;
  - repoint every link: documentation, the unreleased changelog section, code comments, test fixtures. A released changelog section keeps its statements; its links to a deleted ADR are repointed to the survivor.
- **AGENTS block, step 3** (both languages): the ADR sentence gains "a new decision on a question already decided rewrites that ADR". BS-191 edits the same step and owns the rest of it.
- `migrate` does not redraw a project's `docs/README.md`, which belongs to the project. The changelog entry tells projects to replace their copy of the principle and to fold their chains.
- **Red probes** in `test/lint.test.mjs`: `Superseded`, `Superseded in part`, `Deprecated`, a missing status line, a status line naming another ADR, a Status cell mismatch, a duplicate row. Green probes: `Proposed`, and the list-item form `- **Status:** Accepted`.
- **Messages** follow the localization convention of BS-184.
- **Documentation:** the gate 8 row in `docs/reference/03-lint.md`; the ADR part of `docs/reference/01-layout.md`; `CHANGELOG.md` under the unreleased section, marked as affecting projects.

## Out of scope

- This repository's own consolidation: the block 4 cards.
- Any consumer project's ADRs: each project folds its chains in its own migration task.
- How `adr` numbers new files.

## Verification

- The red probes are red before the change and green after it.
- A fresh `init` project in both languages gives `lint` rc=0.
- `node bin/backslop.js lint` and `node bin/backslop.js gates` exit 0 on this repository.
- Mutation probe after the commit: accept any status word. The `Superseded` probe turns red; restore, and it is green. Record the exit code of both runs.
