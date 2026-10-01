---
name: backslop-writer
description: "Run the backslop technical-writer pass before a release or at batch close: check that documentation is current with behaviour changes, apply the project writing rules, and return currency and style ledgers. Its audit mode scores documentation, decides whether it is shippable and files every finding with a regression check. Use when preparing a release, closing a worker batch, auditing documentation (a score, shippability, findings) or its currency, or deciding whether docs need updates after behaviour-changing commits. Not for the initial documentation population (`backslop-seed`) or a one-task lifecycle (`backslop-task`)."
---

# backslop-writer — technical-writer pass

Run this pass when documentation must be checked against the code. It is not a mechanical lint gate: it is a reading pass with evidence, edits and a ledger. Audit mode is the exception on edits: it changes no document and files what it finds.

## Precedence

Apply the first source that answers:

1. The project's own rules: `AGENTS.md`, `{{docs}}/GLOSSARY.md`, and a contributing or style guide when the project has one.
2. `backslop-techdoc`.
3. `backslop-humanizer`.

Load this skill first, then load the two writing skills above as needed.

## Scope

Human-facing documentation gets both currency and style review:

- root `README*.md`;
- the unreleased section of `CHANGELOG.md`;
- `{{docs}}/**`, except `{{docs}}/backlog/**` and `{{docs}}/archive/**`;
- the glob patterns in `writer.style` of `backslop.json`.

ADRs are in scope. A style edit to an ADR must not change its decision; when the decision itself needs to change, file a task with evidence.

The glob patterns in `writer.currency` are currency-only scope. Use them for behaviour surfaces that are not human-facing prose but can go stale, such as CLI help source, shipped skills and prompts.

Agent-facing texts are exempt from style review: skills, prompts, `AGENTS.md`, backlog cards and the archive. They still enter currency review only when `writer.currency` names them.

## Local Rules

- An inanimate subject is allowed: "The command exits with code 2".
- Reference text keeps uniform sentences.
- Use bold only for a flag, a UI string or a run-in heading.
- Write English without contractions.
- Do not add a "What's next" tail to a procedure.
- Keep the dash style the file already uses.
- Never change a behavioural statement before checking it against the code.

## Language

For `lang: en`, apply both `backslop-techdoc` and `backslop-humanizer`.

For `lang: ru`, run the currency part and the structural rules of `backslop-techdoc`. Its "Non-English documents" section skips the `[EN]` rules. Apply `backslop-humanizer` only to English passages.

A translated README, such as `README.ru.md`, is checked as a faithful counterpart of the original: its statements of fact are checked against the original and against the code, and only a fact that contradicts the code or the original is corrected. Nothing is deleted, added or rewritten to mirror the original. A fact the original states and the translation lacks is not added by the pass: record it in the currency ledger row and file a task with evidence. Do not rewrite the translation with the English skills.

## Release Mode

Input: `git diff <previous tag>..HEAD`.

Run currency and style review over the full scope. Behaviour-changing commits drive the currency ledger, and humanizer patterns drive the style ledger.

## Batch Close Mode

Input: `<run base>..HEAD`.

Run currency review only. Select behaviour-changing commits from the input, then check every documentation or configured currency surface that describes each changed behaviour, even when that surface was not touched by the diff. Do not restyle the documentation during batch close.

## Audit Mode

Input: the documents to audit, or the documentation scope above. Run the audit under a task of its own, never inside a release or batch-close pass: it fixes nothing and only files.

For each document:

1. Load `backslop-techdoc` and read its `references/audit-checklist.md` before the first finding. Cite only rule IDs you have read there.
2. Apply the project's own rules first, as in Precedence, and name the file you honored on the report's `Local style guide` line.
3. Read the document as its reader, then check every command, flag and statement of behaviour against the code before judging style. A statement the document makes that the code cannot confirm is an unverifiable fact: a confirmed Blocking finding of the document, not a hypothesis.
4. Write the audit report, then file every finding.

A `lang: ru` document follows the checklist's "Non-English documents" section: record the skipped `[EN]` rules on the `Language` line. A translated README is audited as a faithful counterpart, as under Language: a fact the translation lacks is a finding, not a rewrite.

Audit mode keeps no currency ledger and no style ledger: the report and the filed records carry the result.

## Audit Report

Write one report per audited document into the task result, in the format of the upstream audit: `backslop-techdoc`, section "Running the Audit, Rewrite, or Write". Do not restate that format here. The fields this skill relies on:

- `Score` — Quick Diagnostic rows passed, out of 10, with no partial credit;
- `Shippable` — `yes` or `no`, decided by the Blocking findings alone and never by the score: one Blocking finding makes a 9/10 document `no`;
- `Blocking` — wrong or unverifiable facts, a procedure that cannot be completed, information carried only by an image; `none` when there are none;
- `Language` and `Local style guide` — the rules skipped and the file honored;
- `Findings` — one row per hit: location, rule ID and name, before, after, severity (Blocking, High, Medium or Low).

Add a `Filed as` column to the `Findings` table with the record each finding went to. A finding with no record is not finished.

## Filing Findings

Every finding is filed, and its severity decides where. `N` is the number of the audit task.

| Severity | Cost label | Record |
|---|---|---|
| Blocking | `critical` | a card, `{{cli}} new <slug> --parent N`, with evidence; raise it at once to the orchestrator, or to the owner when there is none, without waiting for the task result |
| High | `major` | a card, `{{cli}} new <slug> --parent N`, with evidence on the `Evidence:` line of its Context |
| Medium, Low | `minor` | an entry, `{{cli}} new <slug> --parent N --minor --evidence "…"` |

- The evidence is the document's `file:line` and the code, command or output that contradicts or confirms it. A finding you could not verify yourself (the command cannot be run here, the evidence is out of reach) is an assumption, which is a different case from a document fact the code cannot confirm: file a Blocking or High one as `{{cli}} new <slug> --parent N --minor --cost <level> --hypothesis --evidence "…"`.
- Medium and Low hits that share a document and a rule are one entry, with every location listed.
- A record that quotes the old text takes `<!-- quote:before:<path> -->`, not a plain `quote`: the fix changes the quoted lines.
- Do not fix a finding in the audit, not even a one-word one.

## Regression Check

Every filed record names the check that will fail on the old text, and where that check will live. The record is written before the fix, so the check does not exist yet: the fix adds it. A card names it in its Verification; a minor entry names it in its `--evidence` text, after the evidence. The check is one of:

- a test that asserts the corrected statement;
- a lint rule;
- a `<!-- quote:<path> -->` block of gate 10 that holds the corrected text. It guards only in a documentation file that is not archived and is neither the quoted file nor the record: a block inside its own target always finds its own body, and an archived or folded record is no longer checked.

A check that also passes on the old text, or that cannot fail, is not a check.

## Release Hold

A document whose audit report says `Shippable: no` holds the release pass until every Blocking finding of that report is closed. A finding is closed when its card is archived (`{{cli}} archive N.k`), or, for a hypothesis entry, when a batch closes it (`{{cli}} archive N.k --into M`) after the hypothesis is verified or rejected. While one is open, the release pass names the document and the open records in its result and does not call the documentation ready.

Take the records from the `Filed as` column of the report, in the audit task's result (`{{cli}} show N` prints it once the task is folded). `{{cli}} status` lists open records but does not tell a `critical` one from a `major` one, so it does not find them.

## Currency Ledger

In the task result, include one row per behaviour-changing commit in the input.

Each row contains:

- the commit;
- what changed;
- the documentation location that states the behaviour now, or the reason none is needed;
- the code evidence as `file:line`.

If a statement appears stale but the code says the behaviour is unchanged, record that fact and leave the text alone.

## Style Ledger

In release mode, include one row per `backslop-humanizer` pattern.

Each row contains:

- the pattern;
- the hits found;
- the edits made;
- the hits kept, with the local or project rule that keeps them.

The row exists even when there are no edits. The pass is complete when every pattern has been walked, not when every pattern caused a rewrite.

## Output

Make one commit per document group: reference, guides, ADRs, README and index, and changelog.

Anything that needs a code change or a decision is not fixed in this pass. File it as a task with evidence. Audit mode commits only the records it files.

The reviewer samples rewritten passages against the code: the meaning must not change, and no new unverified claim may appear.
