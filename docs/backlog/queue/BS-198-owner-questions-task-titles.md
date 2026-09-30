# BS-198 · Questions to the owner are self-contained, and a task is named with its title

- **Order:** 1059
- **Scope:** [01. Layout](../../reference/01-layout.md) § What init lays down
- **Created:** 2026-10-01
- **Dependencies:** none

## Context

The owner of this repository could not follow a run of its own backlog. Status reports named tasks by number alone ("BS-197 passed review"), and the owner had to open the queue to learn what BS-197 was. Questions to the owner used words the orchestrator had coined during the run: worker slugs such as `d179`, "piece", and review codes such as F1. The owner's standing requirements for questions to them are:
1. a question is self-contained: it can be answered without context that is not in the question;
2. it uses no term or abbreviation the agent introduced itself; a new definition is used only after the owner has confirmed it;
3. a task is named by its number and its title, never by the number alone;
4. the goal is a question the owner can actually answer, not one where they press the recommended option; they must see what is asked and why.

What the rendered rules say today (`templates/en/`, the same in the ru layer):
- `agents-section.md:15` says only "Ask the owner only before rejecting an entry";
- `skills/backslop-seed/SKILL.md:33` says "Use a survey, listing your recommendation first";
- `skills/backslop-batch/SKILL.md:116` says "Report to the owner what closed, what remains, and where decisions are needed";
- nothing says how to name a task in a report, a result, a brief or a question, or how to phrase a question to the owner.

The owner decided that the rule goes into the managed AGENTS block and the skills, and ships in v0.14.0.

## Work to do

- The managed AGENTS block (`templates/en/agents-section.md`, then its ru twin) gets one short item on talking to the owner: the four requirements of the context, in the block's own voice. The block must stand alone, so the rule lives there in full.
- `backslop-task`, `backslop-batch` and `backslop-seed` link to that item where they tell the agent to report to the owner or to ask them (the lines named in the context, and any other such line you find), instead of restating it.
- `backslop brief` output and the `result.md` template name tasks with their titles where they list tasks, if they list them by number alone today; check `lib/brief.js` and `templates/{en/,}result.md`.
- Skills change through skill-creator: snapshot the current skills, run test prompts that ask the agent to report a status and to ask the owner a decision question, compare old and new, and send the viewer to the orchestrator.
- CHANGELOG entry under `## Unreleased`.

## Out of scope

- The language of questions: the project's `lang` already decides it.
- Tools that ask questions (a survey tool, a bus): the rule is about the words, not the channel.
- Rewording existing cards and archive entries.

## Verification

- `init --lang en --tools claude` and `--lang ru` in a throwaway project: the AGENTS block carries the rule; each of the three skills links to it and does not restate it (`grep`).
- The skill-creator comparison: on a status-report prompt, the new version names every task with its title; on a decision prompt, the new version's question uses no worker slug or coined term and can be answered from the question alone. The viewer goes to the orchestrator.
- `npm test` and `node bin/backslop.js gates` exit 0; `templateParity` stays clean.
