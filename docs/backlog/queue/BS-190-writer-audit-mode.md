# BS-190 · backslop-writer audit mode: a score and shippability report, every finding filed with a regression check

- **Order:** 1040
- **Scope:** [01. Layout](../../reference/01-layout.md)
- **Created:** 2026-09-28
- **Dependencies:** BS-189

## Context

Owner decisions 8 and 9 of BS-183. The documentation assessment is both a score and filed findings, and a documentation fix carries a check that fails on the old text.

**The upstream audit** is technical-documentation, vendored by BS-188: `SKILL.md` § "Running the Audit, Rewrite, or Write" and `references/audit-checklist.md`. Its report format:

- `Score: X/10` over ten Quick Diagnostic rows;
- `Shippable: yes | no`, decided by Blocking findings: a wrong or unverifiable fact, a procedure that cannot be completed, information carried only by an image;
- severities Blocking, High, Medium and Low, and rule IDs;
- the project's local style guide first;
- a section on non-English documents.

**promptobus on 2026-09-27** (github.com/Velklish/promptobus, closed tasks of that date in its `docs/archive/LOG.md`). An audit of its documentation against the code filed 16 findings. The owner then required each fix to add a check that fails on the old text, and 13 fixes closed that day, each with its check.

## Work to do

- **An audit mode in `backslop-writer`** (both layers). It runs under a task of its own and writes the upstream audit report for each audited document into that task's result.
- **Every finding is filed,** and the process's cost rule decides where it goes:
  - Blocking is `critical`: a card, raised to the orchestrator at once;
  - High is `major`: a card, `{{cli}} new <slug> --parent N` with evidence;
  - Medium and Low are `minor`: `{{cli}} new <slug> --parent N --minor --evidence "…"`, one entry per document and rule when several hits share them.
- **The regression check.** Every filed card or entry names, in its Verification, the check that will fail on the old text: a `<!-- quote:… -->` block of gate 10, a test or a lint rule.
- **Release rule.** A document with `Shippable: no` holds the release pass until its Blocking findings are closed. This is a rule in the skill text.
- **Tests:** template parity, and both layers name the audit mode, the report fields and the cost mapping (assert stable headings, not prose).
- **Documentation:** `docs/reference/01-layout.md`, the skill description; `CHANGELOG.md` under the unreleased section.

## Out of scope

- Computing a score in `lint`: there is no mechanical gate.
- Fixing findings inside the audit.
- The release and batch hooks: BS-191.

## Verification

- Template parity holds, and the structure tests pass in both layers.
- A fresh project with an adapter lays out the updated skill, and `lint` exits 0.
- `node bin/backslop.js gates` exits 0.
