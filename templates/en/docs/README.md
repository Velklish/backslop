# {{project}} documentation

The canonical project documentation. For current work, use `{{cli}} status`; for why the system is arranged this way, see the ADRs in the table below.

| Document | Topic | Status |
|---|---|---|
| [reference/](reference/README.md) | Subsystem reference: how the current code works | Living |
| [GLOSSARY.md](GLOSSARY.md) | Normative terminology: one concept, one name | Living |
| [ROLES.md](ROLES.md) | Who decides what in the tracker: worker, approver, owner | Living |
| [backlog/](backlog/README.md) | Task tracker: one file per task, status is the directory, summary is `{{cli}} status` | Living |
| [archive/](archive/README.md) | Closed tasks: the `LOG.md` journal and the directories not yet folded into it | Living |
| [adr/adr-{{adrNumber}}-process.md](adr/adr-{{adrNumber}}-process.md) | Tasks and decisions are managed with backslop | Accepted |

## Cross-cutting principles

1. **The ADR directory holds current decisions only.** A new decision on a question already decided rewrites that question's ADR in place: same number, the rationale that still holds, the consequences of the change. An ADR that no longer governs anything is deleted; git keeps its history. A chain of ADRs on one question is folded into its highest number.
2. **Evidence is stronger than intuition.** Put a number, file path, or command output in task definitions, results, and ADRs; state unverified claims as hypotheses.

Create a new ADR with `{{cli}} adr <slug>` **and add a row with its link to the table above**: without the link, `{{cli}} lint` fails.
