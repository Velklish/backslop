---
name: backslop-seed
description: "Populate the documentation skeleton after `init` — inventory the repository with evidence, ask the owner a short set of questions, then fill the glossary, backfill initial ADRs, documentation index, subsystem reference, gates in backslop.json, and task queue. Always use when asked to “populate docs”, “initialise documentation”, “create a glossary”, “describe project terms”, “write initial ADRs”, “document decisions already made”, “describe subsystems”, or “what to do after backslop init”, and when untouched templates with `[TODO]` are present in `GLOSSARY.md` or `reference/README.md`. Not for task management (`backslop-task`) or an ADR for a new decision during work (`adr` and procedure step 3)."
---

# backslop-seed — populate the documentation skeleton

`{{cli}} init` creates a skeleton: index, glossary, reference, first ADR, and task directories. Only someone who has read the repository and spoken to the owner can populate it. This skill defines that order: evidence first, then questions, then text. The documentation directory is `{{docs}}/`.

**Precondition:** `backslop.json` and the `{{docs}}/` directory exist at the root. If not, run `{{cli}} init` first; this skill does not lay out the skeleton itself.

**Three rules that hold the whole skill together:**

- **Evidence for every claim.** A term has a path to where it lives; a decision has a dependency, configuration, or commit that shows it; a gate command has the file where it is declared. Without evidence, use `[TODO]`; when a human decision is needed, use `[ASK]`.
- **Append, do not overwrite.** A file written by a human is never replaced wholesale: fill `[TODO]` locations, add table rows, and put new material beside it. A repeated run closes only gaps.
- **Asking is cheaper than confidently writing something false.** A file with an invented decision rationale is worse than an empty section because the next reader will believe it.

## Phase 1. Inventory — silent and read-only

Do not write or ask until reading the repository. The mechanical half of the first two lists is collected by `{{cli}} seed --scan` (`--json` for machine reading): it prints gate and subsystem candidates with paths as evidence from the sources in the table below. The command does not select: which entry is a real gate free of secrets, network, and databases, and which directory is a real subsystem, is for you and the owner. Terms and decisions are read by eye: see [references/inventory.md](references/inventory.md) for what and where to inspect. The phase produces four candidate lists, each entry with evidence:

| List | Destination | Source |
|---|---|---|
| build, test, and lint commands | `gates` in `backslop.json` | package manifests, Makefile, CI configuration; README and CONTRIBUTING are read by eye |
| subsystems | table in `{{docs}}/reference/README.md` | top-level directories, projects, services, entry points |
| terms | `{{docs}}/GLOSSARY.md` | entity, table, event, enum, configuration-key names, words from README and discussions |
| decisions | `{{docs}}/adr/` | major dependencies, “why” in comments and README, moves in git history |

Read existing documentation — README, ARCHITECTURE, CONTRIBUTING, `docs/**`, ADRs in another format — first: it is already canonical and must be linked from the index rather than overwritten. ADRs in another format require an owner decision: migrate into `{{docs}}/adr/`, or leave them outside it and link them from the index; a foreign-named file already inside `{{docs}}/adr/` is renamed or moved out, never left as is. The rules are in [references/adr-backfill.md](references/adr-backfill.md).

## Phase 2. Ask the owner — only what cannot be extracted

Use a survey, listing your recommendation first. Do not ask what is visible in the repository. Usually not extractable:

1. the project’s one-line purpose and its owner — for the index and ADR;
2. who reviews changes and how — for the review gate in the procedure;
3. disputed terms: two names for one concept or an old word to retire — for the glossary;
4. which decision candidates are true decisions and which are accidents of history; present the whole candidate list **before** writing, and let the owner choose; selection rules are in [references/adr-backfill.md](references/adr-backfill.md).

Record answers immediately in phase 3 artifacts, not in session memory.

## Phase 3. Populate

Work from the frame toward details; every item means editing `[TODO]` locations or adding rows, never rewriting.

1. **`{{docs}}/README.md`** — project name, discovered documents as table rows (existing READMEs, ARCHITECTURE, and others as links with “Living” status), and owner-provided principles.
2. **`{{docs}}/GLOSSARY.md`** — 10–30 terms, each with an EN pair, one- or two-sentence definition, and evidence; disputed terms use `[?]` until the owner decides; retired terms go into the bottom table with their replacements. Format and inclusion criteria are in [references/glossary.md](references/glossary.md).
3. **`{{docs}}/adr/`** — backfill selected decisions with `{{cli}} adr <slug> --title "…"`; the retrospective form and the rules for ADRs migrated from another format are in [references/adr-backfill.md](references/adr-backfill.md). Put the owner in the process ADR's Deciders (`adr-NNN-process.md`, written by `init`). Each ADR gets a row in `{{docs}}/README.md`. Rationale only with evidence; when history is sparse, say so in Context.
4. **`{{docs}}/reference/README.md`** — a subsystem table with entry points from the inventory; do not write section bodies now, create tasks instead. Write the table with links to the future section files, labelled by directory name (`[orders-api](orders-api.md)`) and run `{{cli}} seed --queue-reference`: it queues `describe-<slug>` for every row whose file is not written yet, takes the slug from the target file name, and creates no duplicates on a repeat run. A row whose target yields no slug is named in the output — create that task by hand. Then fill Context, Work to do, Out of scope and Verification of every seeded `describe-<slug>` task from the inventory: entry points and paths as evidence, what the section covers, what it leaves out, how a reader checks it. The section files themselves are written by those tasks.
5. **`backslop.json`** — `gates` from discovered commands after owner confirmation; `{{cli}} lint` remains in the list.
6. **Queue and triage** — incomplete material and open questions: reference sections go in the queue; unanswered questions become `triage/` files (`{{cli}} new <slug>` with the question and evidence).

## Phase 4. Verify and report

- `{{cli}} status` shows the seeded work. `{{cli}} lint` is not green yet, and that is the expected state. Right after `{{cli}} seed --queue-reference` it is red on the `[TODO]` fields of the seeded tasks and on the links of `reference/README.md` to sections not written yet. After Phase 3 it reports only those broken links, which the seeded describe tasks close when they write the sections; any other error is a defect to fix.
- Lint looks for `[TODO]` only in the backlog status directories and in an archive `result.md`. Run `grep -rnE '\[(TODO|ASK|\?)' {{docs}}/` and report every hit except the rule text, which names these markers itself: `backlog/README.md` and the explanation line in the `GLOSSARY.md` header.
- Report to the owner what was filled, where `[TODO]` and `[ASK]` remain, what entered the queue, which ADRs were recorded, and which candidates were rejected. Many `[ASK]` markers with sparse history are a correct outcome, not a defect.
- A repeated run follows the same order and closes only gaps.
