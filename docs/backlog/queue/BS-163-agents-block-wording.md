# BS-163 · AGENTS block: worker commit step, finding routes, boundary and status wording

- **Order:** 810
- **Scope:** [01. Layout](../../reference/01-layout.md) § Templates
- **Created:** 2026-09-25
- **Dependencies:** BS-90

## Context

Evidence was taken at commit 6f6318e (v0.11.0), where `npm test` (`node --test --test-timeout=60000`) runs 450 tests, all pass, rc=0, and `node bin/backslop.js lint` exits 0. `$B` below means `node <repo>/bin/backslop.js` run inside a throwaway project (`mkdir p && cd p && git init -q && $B init --lang en ...`).

Template pairs: `templates/en/<path>` is the source and `templates/<path>` is its ru twin. Edit en first, then carry the same change into ru. `templateParity` (run by `lint`) requires the same file set, the same placeholders and the same heading shape in both layers. Tests pin literal strings of the ru layer: grep `test/` for every ru sentence you change and update the assertion in the same commit.

Files: `templates/{en/,}agents-section.md` (the managed block in AGENTS.md, written for every project), the major-route sentence of `templates/{en/,}brief.md:35`, and lines 24 and 42 of `templates/{en/,}skills/backslop-task/SKILL.md`.

Constraints on the block. `init` parses steps with `STEP_RE = /^([1-7])\. /` (lib/init.js:20), and consumers override steps by number (`agents.stepOverrides`, keys "1" to "7", README.md:35). The line prefix `Worker boundaries:` (en) / `Границы worker'а:` (ru) is the anchor `WORKER_BOUNDARY_RE` (init.js:24) that ends step 7's span (init.js:236). test/init.test.mjs:222-226 asserts `^5\. \*\*Приёмка и архив\*\*` and `^Границы worker'а:`. The card therefore keeps exactly seven steps, their bold titles and that line prefix.

**Workers are never told to commit.** verified — a render (the backslop-task skill does say it). `$B init --lang en --prefix ZZ --tools none; grep -n -i commit AGENTS.md` matches only line 4 ("not because of someone else's commit"), line 14 (the step-5 acceptance commit) and line 16 (step 7). No step from 1 to 4 tells the worker to commit. The only exception is the probe sentence, rendered only when `probe` is declared: "commit first, then run the probe".
- Step 7 "Commit" comes after triage (step 6) but has no action of its own. It restates that the task is squashed into the step-5 acceptance commit.
- Neither the block nor backslop-task says how the triage-review moves (`mv N queue`, `mv N deferred`) get committed.
- backslop-task SKILL.md:36 does say "commit to their branch", so the gap is in the block.

**The major route reads as if evidence were a flag.** verified — read (the text is ambiguous, not false). agents-section.md:10 and brief.md:35 say "file `major` outside it … with `{{cli}} new <slug> --parent N[.M]` and evidence". The minor route next to it passes evidence with `--evidence`, and that flag is refused for a major. `$B new found --parent 1 --evidence a.js:1; echo rc=$?` prints "✖ --cost, --hypothesis, and --evidence are only valid together with --minor" with rc=1 (lib/new.js:58). Without the flag, `new` writes "Evidence: [TODO: file path or command output]" into the card's Context (new.js:93).

**A major or critical hypothesis gets the wrong cost.** verified — a major or critical hypothesis needs `{{cli}} new <slug> --parent N[.M] --minor --cost <level> --hypothesis --evidence "…"` (lib/new.js:61), while block step 1 routes every hypothesis to plain `--minor --evidence`, which stamps `Cost: minor`. `new m4 --parent 1 --evidence 'lib/x.js:1'` gives rc=1 `--cost, --hypothesis и --evidence имеют смысл только вместе с --minor` (lib/new.js:58).

```text
**The worker boundary contradicts the finding routes.** verified — at 6f6318e, evidence below. agents-section.md:18 says "do not touch status directories", and backslop-task SKILL.md:42 says "Status directories stay untouched". Yet step 1 and SKILL:42 tell the worker to file findings with `new`, which writes into triage/ and minor/: `$B new f1 --parent 1` prints "✔ BS-1.1: docs/backlog/triage/BS-1.1-f1.md", and `$B new f2 --parent 1 --minor --evidence x` prints "✔ BS-1.2: docs/backlog/minor/BS-1.2-f2.md". The precise rule is already in SKILL.md:19: the worker "does not move task files between directories".
```

**The block states the worker boundary twice.** verified — read (twice, not three times). Step 5 ends with "A worker does not declare their work accepted or move task files between directories." (:14), and :18 is the "Worker boundaries:" line. Line 8 defines the roles, which is a different statement. :18 is the parser anchor, so the step-5 sentence is the copy to drop.

**The status line leaves out part of the output.** verified — ran `status`. agents-section.md:4 says "`{{cli}} status` prints the queue, active work, deferred work, and triage", and ru :4 omits the same. `$B status` prints "Active (0) / Queue (1) / Deferred (0) / Triage (1) / Minor (1) / [no scope] XX-1.1 · tiny — minor / Archive: 0" (lib/status.js:58,60).

**The glossary rule has no addressee in en.** verified — quotes. ru templates/docs/README.md:18 and ru backslop-task SKILL.md:24 say "предложи владельцу" (propose to the owner), while en drops "the owner" at the same lines. agents-section.md:11 has no addressee in either language. GLOSSARY.md:5 says a term stays `[?]` "until the owner confirms it". This card settles the addressee as the owner. The docs/README.md:18 copy is removed by the BS-166 (`docs-skeleton-adr001-index`) card.

**Cost routing and the acceptance recipe are restated.** verified — a side-by-side read (part of it is by design). Cost routing appears in agents-section:10, brief.md:35, backlog/README.md:21-22, task SKILL:42 and batch SKILL:36/66. The copies do not contradict each other.
- The block must stay self-sufficient because it is written for every project. The default is `tools: []`, which installs no skills.
- The brief must stay self-contained.
- The real divergence is the two commit-subject forms: `{{prefix}}-N: closed — …` (agents-section:14, task SKILL:53) and `{{prefix}}-N: <what was done>` (agents-section:16, batch SKILL:103). This card picks one form. BS-169 (`backslop-task-skill-fixes`) and the two backslop-batch cards align to it; BS-170 (`batch-integration-steps`) owns the restatement finding and checks that each rule keeps one home.

## Work to do

- Block step 4 (both languages): add the worker commit before `{{probeRule}}`, for example "Commit to your branch with the `{{prefix}}-N:` prefix before reporting; nothing stays uncommitted." The probe's "commit first" then follows naturally.
- Block step 5: delete the last sentence ("A worker does not declare their work accepted or move task files between directories."). Delete the alternative subject `{{prefix}}-N: closed — …` and keep the single form `{{prefix}}-N: <what was done>`. Move "`{{cli}} lint` is green on the final commit, before pushing" out of step 5 into step 7.
- Block step 7: keep the number and the bold title. Give it its own action: after the acceptance commit, commit the triage-review moves of step 6 as a separate commit (not squashed into task N's commit, which should not carry other tasks' status moves); `{{cli}} lint` is green on the final commit; then push. Keep the sentence that nothing is squashed after the fold.
- Block step 1 and brief.md:35, same wording in both files: "file `major` outside it with `{{cli}} new <slug> --parent N[.M]`, then fill the `Evidence:` line of its Context". Keep the minor route as it is.
- Block step 1 (both languages): a `major` or `critical` hypothesis is filed with `{{cli}} new <slug> --parent N[.M] --minor --cost <level> --hypothesis --evidence "…"`; only a minor finding uses plain `--minor --evidence`.
- Block line 18: keep the `Worker boundaries:` / `Границы worker'а:` prefix and reword the rest: change only the assigned branch or worktree; create new finding files only with `{{cli}} new`; never move or archive existing task files (no `mv`, no `archive`); closure and triage belong to the approver.
- Block line 4: "`{{cli}} status` prints active work, the queue, deferred work, triage, and minor entries by scope".
- Block step 2 (:11): "if a required term is missing, propose it to the owner rather than silently inventing it". Use the same addressee in en backslop-task SKILL.md:24 (the ru line already has it).
- backslop-task SKILL.md:42, both languages: replace "Status directories stay untouched." with "The worker never moves or archives an existing task file." Leave the rest of the skill to the BS-169 (`backslop-task-skill-fixes`) card.
- Tests: update the ru strings pinned in test/brief.test.mjs:45-56 that carry the major-route sentence, and anything else `grep -rn` finds for the sentences you changed. Keep test/init.test.mjs:222-226 passing without editing it: the step-5 title and the boundary prefix stay.
- CHANGELOG, Unreleased section: block steps 1, 4, 5 and 7 changed (projects with `agents.stepOverrides` for these steps should review their overrides); the status line names minor entries.

## Out of scope

- The brief's commit rule, ru/en drift and the no-push line — BS-164 (`brief-template-wording`).
- Mutation-probe sentences (brief.md:36, :40, the `{{probeRule}}` slot, result.md): the BS-165 (`probe-text-opt-in`) card.
- Restructuring backslop-task and backslop-batch beyond SKILL.md:24 and :42: their own cards.
- Changing `STEP_RE`, `WORKER_BOUNDARY_RE`, the number of steps, or adding a migration for `stepOverrides`.
- The wording of the cost scale in docs/backlog/README.md.

## Verification

- Throwaway en project: `$B init --lang en --prefix ZZ --tools none; grep -n -i commit AGENTS.md` shows a commit instruction in step 4 and a step 7 that names the triage commit, lint and push. `grep -c "move task files between directories" AGENTS.md` = 0. `grep -c "^Worker boundaries:" AGENTS.md` = 1.
- Same project with `"agents": {"stepOverrides": {"7": "custom"}}` in backslop.json: `$B init` exits 0, and the override replaces step 7 up to the `Worker boundaries:` line. The existing override tests in test/init.test.mjs stay green.
- Throwaway en project: `$B status` output matches the words of block line 4; after `$B new t --queue --title T; $B brief 1 --track x > b.out`, the major-route bullet of b.out uses the same wording as block step 1 (evidence goes into the `Evidence:` line, not a flag).
- `npm test` exits 0 with no failing test (450 at the base commit, plus the tests this card adds); `node bin/backslop.js lint` exits 0 (templateParity and the key check stay clean).
