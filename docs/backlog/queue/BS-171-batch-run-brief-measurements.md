# BS-171 · backslop-batch: brief, tracks and triage text, measurements rules, one CLI spelling

- **Order:** 890
- **Scope:** [02. CLI](../../reference/02-cli.md) § brief
- **Created:** 2026-09-25
- **Dependencies:** BS-170, BS-167, BS-169

## Context

Evidence was taken at commit 6f6318e (v0.11.0), where `npm test` (`node --test --test-timeout=60000`) runs 450 tests, all pass, rc=0, and `node bin/backslop.js lint` exits 0. `$B` below means `node <repo>/bin/backslop.js` run inside a throwaway project (`mkdir p && cd p && git init -q && $B init --lang en ...`).

Template pairs: `templates/en/<path>` is the source and `templates/<path>` is its ru twin. Edit en first, then carry the same change into ru. `templateParity` (run by `lint`) requires the same file set, the same placeholders and the same heading shape in both layers. Tests pin literal strings of the ru layer: grep `test/` for every ru sentence you change and update the assertion in the same commit.

Files: `templates/{en/,}skills/backslop-batch/SKILL.md`, all sections except "Integration and acceptance", which BS-170 (`batch-integration-steps`) rewrote, and `templates/{en/,}skills/backslop-batch/references/measurements.md`. Line numbers are from 6f6318e.

**The skill restates the backlog README.** verified — quotes and behaviour. SKILL en:24 repeats docs/backlog/README.md:45 almost word for word: "Closing batch M: first `{{cli}} archive M`, then `{{cli}} archive N.k --into M` for each entry … `{{cli}} fold M` comes last …". The "one batch card per scope … ten or more entries" sentence appears in both. SKILL en:22 repeats README:40 (review triage before the run), and en:34 repeats README:29 (`--restore`). The copies have drifted: the skill hard-codes `backslop` where the README uses `{{cli}}`, and it drops `--title` from `new`. The backlog README is tool-owned, redrawn by `migrate`, and already linked from en:22. Behaviour check:
```text
- `archive 2; archive 1.1 --into 2; archive 1.2 --into 2`, fill result.md, then `fold 2` writes LOG lines like "`BS-1.1-f-one` · <date> · batch BS-2 · — · f-one".
```
- After that, `new f-four --parent 1 --minor --evidence x; archive 1.4 --into 2` exits 1 with "✖ batch BS-2 is folded into the journal …".

**measurements.md:15 over-promises what `--measurements` carries.** verified — read (SKILL en:71 is consistent). measurements.md:15 says "When asking a worker to measure, put this rule in their brief", right after the tree rule of :13. `--measurements` injects one bullet (lib/brief.js:96-100, :155-158): "a live wall clock measures your neighbours, an exit code is read from the command rather than the pipe, and an incomplete grep result looks as confident as a complete one. Not measured — write it as a hypothesis." These rules of the file do not reach the worker:
- CPU/op-count substitutes (:5);
- verify a zero a second way (:7);
- counting calls by argv (:11);
- gate on a byte-identical tree (:13).

**The track title does not name a session.** verified — at 6f6318e, evidence below. en:54 says the track title "becomes the worker session name". `$B brief 1 2 --track "Parser cleanup" | head -1` prints "# Parser cleanup", and `grep -rni session lib/` gives rc=1. Naming sessions is up to the harness.

**`brief` exits 0 with every slot unfilled.** verified — at 6f6318e, evidence below. `$B brief 1 2 --track "Parser cleanup" --measurements > b.out 2> b.err; echo $?; grep -c "\[TODO" b.out` prints 0 and 8: four unset decision slots plus four from unfilled cards. stderr has only the probe warning. en:55 calls the stub "your signal" but gives no mechanical check.

**`tracks` exits 0 whether or not the list is empty.** verified — at 6f6318e, evidence below. With a worktree `../wt1 -b trk1` holding a commit "BS-1: wip" and an untracked file, `$B tracks` lists it and prints "✔ tracks: worktrees and branches 2, not merged 2" with rc=0. en:116 says "make sure the list is empty". `tracks --json` exists (lib/tracks.js:40).

**measurements.md:13 restates backslop-task.** verified — at 6f6318e, evidence below. It repeats backslop-task SKILL.md:26 ("refuses on a dirty tree before the first command", the closing snapshot) and lists refusal causes whose messages already name them:
- dirty tree: rc=1, "✖ --require-clean: the tree is dirty, no gate was run: ?? dirty.txt";
- no git: rc=1, "✖ --require-clean: there is no git repository, so tree cleanliness cannot be checked";
- clean tree: rc=0, "tree: e2dfd4d…, clean";
- scoped refusals: lib/gates.js:240-247.

**`\s` in `git grep -E`.** verified — on macOS only. measurements.md:9 says "`git grep -E` does not understand `\s`; use POSIX classes." On macOS (git 2.54.0 Apple Git-157), with a file containing "foo bar": `git grep -E 'foo\sbar'` exits 1, and `git grep -E 'foo[[:space:]]bar'` exits 0. The behaviour on Linux (glibc) and on Git for Windows is unverified, so the new wording must not claim it.

**An undefined sentence.** verified — read (the second sentence is usable). measurements.md:11 opens with "**A call count without parsing argv does not define a task boundary.**" "Task boundary" and "argv" appear nowhere else in templates, docs, README or AGENTS. The next sentence carries the rule: "Count not “how often it was called” but “how often what the check names was called”."

**The CLI spelling mixes pin and alias.** verified — read (line 8 defines the alias). Line 8 reads "`{{cli}}` is called `backslop` below". With the default pin, the rendered skill mixes pinned lines (51, 106, 117) with bare `backslop` lines (24, 34, 36, 111). Decision for all three skills: `{{cli}}` in every runnable command, and no alias sentence.

## Work to do

- en:22, :24 and :34, en first and then ru: first confirm that templates/{en/,}docs/backlog/README.md carries each rule you drop (the three pairs quoted in the context). Then shrink each paragraph to one sentence plus a link to `{{docs}}/backlog/README.md`, keeping only the orchestrator's timing: review triage in full before splitting; cut minor batches at the same point; move a whole track to active in one `{{cli}} mv … active` call and return it with `{{cli}} mv … queue --restore`.
- en:54: "it becomes the brief heading (`# <title>`); pass the same title as the session or agent name when the harness takes one".
- en:55: add "`brief` exits 0 even with stubs: check the output for `[TODO` before sending it".
- en:116: Owner decision: the skill checks that nothing is left with `{{cli}} tracks --json` (`total` is 0), not with the human summary line, because human text is not contract; add that `tracks` exits 0 either way.
- measurements.md:15 (and SKILL :60 and :71 if needed): `--measurements` carries only the three-point summary; any other rule from this file goes into the brief by hand, e.g. through `--handover`.
- measurements.md:13: keep the rule (a gate proves nothing about a commit unless the tree is byte-identical; use `{{cli}} gates --require-clean`) and drop the list of refusal causes.
- measurements.md:9: "`\s` in `git grep -E` is not portable: on macOS it silently matches nothing. Use POSIX classes such as `[[:space:]]`." Say nothing about other platforms.
- measurements.md:11: replace it with a concrete rule and an example: "When counting calls, count calls of exactly what the check names, filtered by arguments: `git` invocations are not `git merge` invocations."
- Command spelling: `{{cli}}` in every runnable command of the skill and its references, and delete the alias sentence at :8. Skill names stay.
- Tests: test/templates.test.mjs:151-157 asserts `` `backslop archive N.k --into M` `` and `` `backslop fold M` `` in both batch skill layers. If the batch closing order leaves the skill, move that assertion to templates/{en/,}docs/backlog/README.md. Otherwise update it to the `{{cli}}` spelling. Adjust the step-4 assertions of BS-170 (`batch-integration-steps`) to the new spelling as well.

## Out of scope

- The "Integration and acceptance" section (BS-170 (`batch-integration-steps`)).
- brief.md fixed lines and the `--measurements` bullet text in lib/brief.js.
- Changing the exit codes of `tracks` or `brief`.

## Verification

- `$B init --lang en --tools claude` with the default pin: `` grep -nE '`backslop [a-z]' .claude/skills/backslop-batch/SKILL.md .claude/skills/backslop-batch/references/*.md `` finds nothing (skill names such as `backslop-task` do not match), and `grep -n "is called"` finds nothing.
- `grep -n "archive N.k --into M" templates/en/docs/backlog/README.md` still matches, and so do the `--restore` and pre-run triage rules.
- The rendered batch skill checks the end state with `tracks --json` and quotes no human summary: `grep -c 'not merged 0' .claude/skills/backslop-batch/SKILL.md` prints 0.
- All three skills in both layers (owner of the `{{cli}}` spelling finding): `grep -rnE '(^|[^{}a-z-])backslop (lint|status|new|adr|mv|gates|fold|archive|seed|brief|tracks)' templates/skills templates/en/skills; echo rc=$?` → rc=1 (50 matches at 6f6318e), and `grep -rn 'is called' templates/skills templates/en/skills; echo rc=$?` → rc=1.
- `npm test` exits 0 with no failing test (450 at the base commit, plus the tests this card adds); `node bin/backslop.js lint` exits 0 (templateParity and the key check stay clean).
