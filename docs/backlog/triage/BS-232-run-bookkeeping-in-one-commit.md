# BS-232 · A run's tasks are created and taken one commit each: no rule batches creation, and a track taken task by task keeps every take commit

- **Scope:** [02. CLI § mv](../../reference/02-cli.md#mv)
- **Created:** 2026-10-04
- **Dependencies:** none
- **Cost:** major

## Context

Run bs020 on 2026-10-03 left 35 commits in ati-agents between `c569bec8` and `01e7e174`. Ten carry work: one squash per task and the release. The other 25 only keep the tracker:
- 9 «create task»;
- 7 «take»;
- 7 «record a finding»;
- one triage review;
- one card filing.

Source: 2026-10-04, `git log --oneline c569bec8..01e7e174` in ati-agents.

The agents-section template covers part of this:
- step 7 squashes a take commit into the acceptance commit when it took this task alone and nothing landed after it;
- the `backslop-batch` skill moves the whole track to active work with one `mv N M K active`.

In the run the teamlead took tasks one by one as slots freed. Other acceptances landed between each take and its acceptance, so step 7 kept every take commit. No rule says anything about creation commits: each `new` became its own commit.

The 7 finding commits come from ati-agents' own override of the worker rule, which BL-734 removes.

## Work to do

- State in the agents-section template and the `backslop-batch` skill that a run's planning is one commit: the tasks it creates and the track it takes, with `new` for each and one `mv N M K active`.
- State what a task taken later in the run does: its take goes into the next planning or acceptance commit rather than a commit of its own.

## Out of scope

- Squashing after a fold, which loses the task body.

## Verification

- The rendered agents section and the batch skill name the planning commit; a test on the templates fails on the old text.
