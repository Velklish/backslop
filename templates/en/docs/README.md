# {{project}} documentation

The canonical project documentation. For current work, use `{{cli}} status`; for why the system is arranged this way, see the ADRs in the table below.

| Document | Topic | Status |
|---|---|---|
| [reference/](reference/README.md) | Subsystem reference: how the current code works | Living |
| [GLOSSARY.md](GLOSSARY.md) | Normative terminology: one concept, one name | Living |
| [backlog/](backlog/README.md) | Task tracker: one file per task, status is the directory, summary is `{{cli}} status` | Living |
| [archive/](archive/README.md) | Closed tasks: the `LOG.md` journal and the directories not yet folded into it | Living |
| [adr/adr-{{adrNumber}}-process.md](adr/adr-{{adrNumber}}-process.md) | Tasks and decisions are managed with backslop | Accepted |

## Cross-cutting principles

1. **An accepted decision is not edited; it is superseded.** A new decision on the same question gets a new ADR; the replaced ADR retains a “superseded by ADR-NNN” note.
2. **Evidence is stronger than intuition.** Put a number, file path, or command output in task definitions, results, and ADRs; state unverified claims as hypotheses.

Create a new ADR with `{{cli}} adr <slug>` **and add a row to the table above**: without the row, `{{cli}} lint` fails.
