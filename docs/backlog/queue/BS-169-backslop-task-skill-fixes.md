# BS-169 · backslop-task: point to AGENTS block steps, add gates --base and --keep-going, cut history

- **Order:** 870
- **Scope:** [02. CLI](../../reference/02-cli.md) § gates
- **Created:** 2026-09-25
- **Dependencies:** BS-165, BS-163

## Context

Evidence was taken at commit 6f6318e (v0.11.0), where `npm test` (`node --test --test-timeout=60000`) runs 450 tests, all pass, rc=0, and `node bin/backslop.js lint` exits 0. `$B` below means `node <repo>/bin/backslop.js` run inside a throwaway project (`mkdir p && cd p && git init -q && $B init --lang en ...`).

Template pairs: `templates/en/<path>` is the source and `templates/<path>` is its ru twin. Edit en first, then carry the same change into ru. `templateParity` (run by `lint`) requires the same file set, the same placeholders and the same heading shape in both layers. Tests pin literal strings of the ru layer: grep `test/` for every ru sentence you change and update the assertion in the same commit.

File: `templates/{en/,}skills/backslop-task/SKILL.md`, plus one sentence in step 4 and the Windows note in step 5 of `templates/{en/,}agents-section.md`. Line numbers are from 6f6318e. BS-163 (`agents-block-wording`) and BS-165 (`probe-text-opt-in`) run first: they settle the commit subject form, the step-7 content, and which probe sentences are conditional.

**The skill restates the AGENTS.md block rule by rule.** verified — a side-by-side read. Task SKILL en:12-32, plus :42, :50-53 and :59-61, restate agents-section en:8-18:
- role split (SKILL:14-15 / block:8);
- clean removal plus the glossary rule (SKILL:24 / block:11);
- docs in the same pass, `adr <slug>` and its row (SKILL:25 / block:12);
- "gates N, green M" and skips (SKILL:26 / block:13);
- archive → result.md → fold > BACKSLOP_DRAFT → do not commit between → reset --soft + commit -F → lint before push (SKILL:50-53 / block:14);
- triage right after closure, asking the owner only before rejecting (SKILL:59-61 / block:15);
- one commit per task (SKILL:32 / block:16);
- the worker boundary (SKILL:19, :44 / block:18).

The block is written for every project (default `tools: []`, so no skills), and `agents.stepOverrides` replaces steps only there. An overridden step is therefore contradicted by the skill's copy, and every rule fix today has to be made in four files.

**Step 4 never mentions `--base`.** verified — a repro (the skip is reported, not silent, and the tool's README.md:62 and docs/reference/02-cli.md:23 document `--base`, but no consumer template does). Setup: gates `[lint, {command: 'node -e "process.exit(0)"', when: ['src/**']}]`, with src/a.js committed on top of `$BASE`.
- `$B gates` prints "scope: git status --porcelain, paths 0", then "node -e … — skipped: the scope is untouched (src/**), 0 paths in the set", then "✔ gates 2, green 1, not run 1 (out of scope 1)", and exits 0.
- `$B gates --require-clean` prints "✖ --require-clean without --base: on a clean tree the changed path set is empty, so every scoped entry would be skipped. Name the base: --base <ref>" and exits 1.
- `$B gates --require-clean --base $BASE` prints "scope: git diff --name-only <base>..HEAD plus git status --porcelain, paths 3" and runs the scoped gate.
- Code: lib/gates.js:100 takes the scope from the dirty tree when `--base` is absent; :240-247 holds the refusal.

**"not run N" also counts gates never reached.** verified — a repro (the tool reference docs/reference/02-cli.md:23 states it; the consumer templates do not). lib/gates.js:265 is `if (!passed(result) && !keepGoing) break;` and :272 is `const skipped = outOfScope + (gates.length - results.length);`.
- With a red first gate, `$B gates --require-clean --base $BASE` prints "✖ gates 2, green 0, not run 1" with no "(out of scope)" suffix and exits 1.
- With `--keep-going` it prints "✖ gates 2, green 1" and exits 1.
- SKILL en:26 says "What path filtering skips is counted separately", and :40 asks for "how many were skipped by path", as if not-run meant only path skips. `--keep-going` is not mentioned.

**History in the rules.** verified — at 6f6318e, evidence below. The same anecdote appears twice, at :19 and :67 ("three tasks were archived before any review, and the owner had to restore them"). :69 restates :59, and :70 restates :26. Only :68 carries a rule the skill does not state elsewhere: record a finding in the same pass in which you read it. The owner's rule: no history or incident notes in rules.

**ru/en drift.** verified — read (emphasis only). en:31 drops "by the approver". en:48 says "using backslop-batch" where ru says "by the table of backslop-batch". en:59 says "review every entry" where ru says "give each entry a next step". ru:63 adds "grep takes seconds".

**The CLI spelling mixes pin and alias.** verified — read (the alias is defined at :8). Line 8 reads "`{{cli}}` is the command recorded in backslop.json; below it is simply called `backslop`". With the default npx pin, the rendered skill has 1 pinned and 12 bare `backslop` command lines. Decision for all three skills: `{{cli}}` in every runnable command, and no alias sentence.

**The draft recipe is POSIX-only.** verified — no doc covers Windows. The failure mode is unverified: there was no Windows host.
- The recipe at :52-53: `backslop fold N > "$(git rev-parse --git-dir)/BACKSLOP_DRAFT"` and `git commit -F "$(git rev-parse --git-dir)/BACKSLOP_DRAFT"`.
- `grep -rn -i -E 'powershell|windows|git bash|cmd\.exe' README.md AGENTS.md docs templates` finds only an ADR remark about Python on Windows and two archive log lines. Windows is a supported platform.
- Expected failures, taken from shell documentation and not reproduced: cmd.exe does not expand `$(...)`, and Windows PowerShell 5.1 `>` writes UTF-16LE, which `git commit -F` reads with NUL bytes.

## Work to do

- Restructure "Task flow", en first and then ru with the same headings: open with "Steps 1–7 are in the backslop section of AGENTS.md; below, each step gets only what the block does not say." Remove every restated normative sentence listed in the context. Keep only the expansions: who moves a task to active; the code-comment rule; reviewing the whole doc set including templates and linked neighbours; the gate invocation details below; the unchanged-tree rule; the second probe, which the BS-165 (`probe-text-opt-in`) card made conditional (keep it conditional). Keep "Acceptance and archive" as the full single-task recipe with exact commands: the batch skill links to it. Use the subject form set in the AGENTS block.
- Step 4: for a committed branch, the invocation is `{{cli}} gates --require-clean --base <base>`, where `<base>` is the commit before the task was taken, the same `<base>` as in acceptance step 4. Without `--base` only uncommitted paths count and scoped gates are skipped. Gates stop at the first red unless `--keep-going`. In "not run N (out of scope K)" only K is path filtering, and N−K were never reached. Add one sentence with the `--base` invocation to block step 4 (agents-section, both languages).
- Worker report bullet (:40): report "not run N" and "out of scope K" as two numbers.
- Delete the anecdote at :19 and the "Real failures" section (:65-70) in both languages. Move the one rule of :68 (record a finding in the same pass in which you read it) into "What a worker does instead of closing".
- Drift: make en explicit and carry it into ru. :31 "by the approver"; :48 "using the review table in `backslop-batch`"; :59 "give every entry a next step"; :63 either both languages say "grep takes seconds" or neither does.
- Command spelling: `{{cli}}` in every runnable command, and delete the alias sentence at :8. Skill names such as `backslop-batch` stay.
- Windows note next to the draft recipe, as a checklist. (1) On a Windows host, in a throwaway project, run `<cli> fold 1 > "$(git rev-parse --git-dir)/BACKSLOP_DRAFT"` and then `git commit -F "$(git rev-parse --git-dir)/BACKSLOP_DRAFT"` in Git Bash, Windows PowerShell 5.1 and PowerShell 7. Check `git log -1 --format=%B | od -c | head` each time. Expected: intact in Git Bash; NUL bytes (UTF-16LE) in PowerShell 5.1; a failure in cmd.exe. (2) Write one line with the working form verified per shell, e.g. PowerShell 7: `$d = git rev-parse --git-dir; <cli> fold N | Out-File -Encoding utf8NoBOM "$d/BACKSLOP_DRAFT"`. (3) Without a Windows host, write only "on Windows, run this recipe in Git Bash" and file a `minor` finding with `--hypothesis` for the PowerShell form.
- Owner decision: the Windows note "on Windows, run this recipe in Git Bash" also goes next to the BACKSLOP_DRAFT recipe in step 5 of the AGENTS block, in both languages (templates/agents-section.md and templates/en/agents-section.md).
- Tests: grep `test/` for literal strings of this skill that you change or delete (e.g. test/init.test.mjs:342-356 reads the rendered step 4) and update them in the same commit.
- The acceptance redraws this repository's own AGENTS.md block with `node bin/backslop.js init` and commits it with the task, so later workers follow the new rules.

## Out of scope

- The probe paragraphs themselves (the BS-165 (`probe-text-opt-in`) card).
- AGENTS-block wording other than the `--base` sentence in step 4 and the Windows note in step 5.
- The backslop-batch skill, and any change to the gates or lint code.

## Verification

- In the scoped-gate project from the context, follow the new step 4 literally: the scoped gate runs ("paths" > 0), and a red first gate with `--keep-going` reports every gate.
- `$B init --lang en --tools claude`: `grep -c "Real failures" .claude/skills/backslop-task/SKILL.md` prints 0, `grep -n "simply called" …` finds nothing, and `` grep -nE '`backslop (status|mv|new|gates|archive|fold|lint|adr) ' … `` finds nothing.
- `$B init --lang en` and `$B init --lang ru` in throwaway projects: step 5 of AGENTS.md carries the Windows note next to the BACKSLOP_DRAFT recipe.
- After the acceptance commit: `node bin/backslop.js init && git diff --exit-code AGENTS.md; echo rc=$?` → rc=0 (this repository's block equals the rendered template).
- `npm test` exits 0 with no failing test (450 at the base commit, plus the tests this card adds); `node bin/backslop.js lint` exits 0 (templateParity and the key check stay clean).
