---
name: backslop-writer
description: "Run the backslop technical-writer pass before a release or at batch close: check that documentation is current with behaviour changes, apply the project writing rules, and return currency and style ledgers. Use when preparing a release, closing a worker batch, auditing documentation currency, or deciding whether docs need updates after behaviour-changing commits. Not for the initial documentation population (`backslop-seed`) or a one-task lifecycle (`backslop-task`)."
---

# backslop-writer — technical-writer pass

Run this pass when documentation must be checked against the code. It is not a mechanical lint gate: it is a reading pass with evidence, edits and a ledger.

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

Anything that needs a code change or a decision is not fixed in this pass. File it as a task with evidence.

The reviewer samples rewritten passages against the code: the meaning must not change, and no new unverified claim may appear.
