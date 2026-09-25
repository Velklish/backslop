# BS-170 · backslop-batch integration: squash reason, containment check, conflict mark, no ADR cite

- **Order:** 880
- **Scope:** [02. CLI](../../reference/02-cli.md) § merge-changelog
- **Created:** 2026-09-25
- **Dependencies:** BS-169, BS-148, BS-147, BS-163

## Context

Evidence was taken at commit 6f6318e (v0.11.0), where `npm test` (`node --test --test-timeout=60000`) runs 450 tests, all pass, rc=0, and `node bin/backslop.js lint` exits 0. `$B` below means `node <repo>/bin/backslop.js` run inside a throwaway project (`mkdir p && cd p && git init -q && $B init --lang en ...`).

Template pairs: `templates/en/<path>` is the source and `templates/<path>` is its ru twin. Edit en first, then carry the same change into ru. `templateParity` (run by `lint`) requires the same file set, the same placeholders and the same heading shape in both layers. Tests pin literal strings of the ru layer: grep `test/` for every ru sentence you change and update the assertion in the same commit.

File: the section "Integration and acceptance" of `templates/{en/,}skills/backslop-batch/SKILL.md` (:101-112 at 6f6318e), plus a new reference file. The rest of the skill belongs to BS-171 (`batch-run-brief-measurements`).

**The step-3 check fails on a correct merge.** verified — a repro.
- Repo: the base has Alpha; branch `w` adds Beta and w.txt; main adds Gamma. `git merge --squash w`, then `$B merge-changelog --ours HEAD --theirs w --base $BASE --out CHANGELOG.md` exits 0 ("only ours: Gamma; only theirs: Beta").
- After `git commit -qm "BS-1: merged"`, `git diff HEAD w -- CHANGELOG.md w.txt` prints
```
@@ -5,8 +5,6 @@
 - **Alpha** — base.
 - **Beta** — worker track.

-- **Gamma** — other track.
-
```
- :109-110 say this diff "must be empty", so a literal reader drops the neighbour's entry.
- `git diff $BASE w -- CHANGELOG.md w.txt | git apply -R --check` also fails (rc=1) on this correct merge, so it is not a usable replacement.

**The skill cites the tool's own ADR.** verified — at 6f6318e, evidence below; the BS-148 (`adr-closed-task-journal`) card already deleted the citation and re-anchored the test. :111 ends "… the message draft is not required there (ADR-033)." That is backslop's own docs/adr/adr-033-…. `init --lang en --tools claude` renders it into the consumer's .claude/skills/backslop-batch/SKILL.md:112, while the consumer's docs/adr holds only adr-001-process.md. `grep -rn "ADR-0[0-9][0-9]" templates | grep -v "ADR-{{"` hits only this line in both layers. test/templates.test.mjs:162 anchors on the literal '(ADR-033)'.

**The reason for cherry-picking later tasks is wrong.** verified — a repro. Branch `w` has BS-1 (edits f1) and BS-2 (edits f2); main edits f3.
- `git merge --squash $T1; git commit; git merge --squash w` exits 0 ("Automatic merge went well") and stages only f2.
- After main edits a line of f1 and commits, `git merge --squash w` exits 1 with "CONFLICT (content): Merge conflict in f1".
- :103 claims a second squash "conflicts in all its files". ru :103 says "у squash-коммита нет предка" ("has no ancestor"), which is wrong: it has a parent, it just does not record the worker branch.
- The first-task command, `git merge --squash <worker-branch>`, brings every task on the branch.

**"gate 7" and the conflict mark.** verified — at 6f6318e, evidence below.
- :105 says "both revisions stay under a `<!-- backslop:conflict … -->` mark, and gate 7 keeps `lint` red until you decide". lint prints no gate numbers, and lib/lint.js:527-548 checks only duplicate `- **…**` titles within a section.
- With the mark and two Alpha bullets, `lint` exits 1 with "✖ CHANGELOG.md: line 8: entry title “Alpha” already exists in section “Unreleased” (line 6) — keep one revision".
- With one bullet deleted and the mark line kept, `lint` exits 0.
- The next `merge-changelog` then refuses (lib/merge-changelog.js:241-247: "the unreleased section on the --ours side carries an unresolved <!-- backslop:conflict mark").
- `merge-changelog` itself prints "pick a revision and remove the mark"; the skill never says to remove it.

**The CHANGELOG bullet is a reference inside a procedure.** verified — read (371 words, not about 450). `sed -n 105p … | wc -w` gives 371 of the file's 3055 words (ru: 301). The claims in it are correct: an untagged top section gives the report "unreleased section in ours — “v0.2.0”: the version has no tag" with rc=0; after `git tag v0.2.0`, rc=1 with "✖ CHANGELOG.md on the --ours side has no unreleased section …". It buries the other two merge units (:106-107). references/measurements.md already shows the load-on-demand pattern.

**Step 4 restates the single-task recipe.** verified — a side-by-side read. :111 restates the recipe owned by backslop-task "Acceptance and archive": archive → result.md → fold > BACKSLOP_DRAFT → reset --soft → commit -F, and no commit between archive and fold. The batch-specific additions are:
- integrating by `merge --squash` or `cherry-pick -n`;
- a multi-task track leaves as one commit with archive directories and is folded in the next commit;
- a batch is folded after its entries.

The commit subject form is the single form the BS-163 (`agents-block-wording`) card set (`{{prefix}}-N: <what was done>`).

**The draft recipe is POSIX-only.** verified — no doc covers Windows; the failure mode is unverified (no Windows host). Same recipe at :111, and the same situation as in backslop-task.

## Work to do

- Step 1 (:103), en first and then ru: the reason becomes "a squash commit does not record the worker branch as a parent, so the next squash diffs from the branch point again and conflicts wherever main has changed the first task's lines since (review fixes, acceptance edits)". Give one per-task command for every task, the first included: `git cherry-pick -n <task commits>`, or `git merge --squash <last commit of the task>` for the first. Keep "when worker commits are separable by prefix".
- Steps 2-3 (:109-110): replace "must be empty" with a containment check. For worker files that no other track changed since the branch point, `git diff HEAD <worker-head> -- <those files>` is empty. For shared files, every line the worker added (the `+` lines of `git diff <branch-point> <worker-head> -- <file>`) is present in HEAD, and any remaining difference is the other side's. Do not suggest `git apply -R --check`.
- CHANGELOG bullet (:105): move the merge-changelog details into a new `references/merge-changelog.md` in both layers (a new pair; templateParity requires both files). Carry the mark wording the BS-147 (`adr-changelog-merge`) card set ("an unresolved mark in the unreleased section of --ours or --theirs"). In that file, replace "gate 7" with lint's printed message ("entry title … already exists in section …"), and add that a leftover mark passes lint but makes the next `merge-changelog` refuse. Step 2 keeps one line: run `{{cli}} merge-changelog --ours … --theirs … --base … --out CHANGELOG.md`; a non-zero exit means a conflict or a refusal; read the report, keep one revision, and delete the `<!-- backslop:conflict … -->` line.
- Step 4 (:111): replace the restated recipe with a link to backslop-task "Acceptance and archive" and keep only the batch-specific additions listed in the context. (The BS-148 (`adr-closed-task-journal`) card already deleted "(ADR-033)".) Use the single subject form.
- Windows note next to the recipe: reuse the sentence the BS-169 (`backslop-task-skill-fixes`) card wrote next to its recipe word for word (it carries either the forms it verified per shell or 'on Windows, run this recipe in Git Bash'). If it wrote none, follow the same checklist: run the recipe in Git Bash, PowerShell 5.1 and PowerShell 7, check `git log -1 --format=%B | od -c`, write only the verified forms, and without a Windows host write only "on Windows, run this recipe in Git Bash".
- Tests: test/templates.test.mjs:151-167 anchors on the step line starting `4. ` that contains `` `backslop archive N` ``, on `` `backslop fold N `` and the `git commit -F "$(git rev-parse --git-dir)/BACKSLOP_DRAFT"` string, and on the one-commit-track phrase the BS-148 (`adr-closed-task-journal`) card chose. Re-anchor the track assertion on the multi-task-track sentence if your rewrite removes that phrase, and assert the recipe link instead of the restated commands. In test/init.test.mjs:388-398, add the cursor/claude output assertion for references/merge-changelog.md next to measurements.md.

## Out of scope

- The sections above "Integration and acceptance" (brief, tracks, measurements) and the skill-wide `{{cli}}` spelling (BS-171 (`batch-run-brief-measurements`)).
- The merge-changelog code and lint gate numbering.
- `LEGACY_SOURCES`: a new reference file is written with the generated marker and does not belong to the legacy set.

## Verification

- Recreate the Alpha/Beta/Gamma repo from the context and apply the new step-3 check literally: it passes on the correct merge, and it fails when Gamma or Beta is dropped.
- Recreate the two-task branch: follow the new step 1 for both tasks. Each command takes exactly one task, and the fresh case has no spurious conflict.
- `$B init --lang en --tools claude,cursor`: `grep -c "ADR-0" .claude/skills/backslop-batch/SKILL.md` prints 0; both .claude/skills/backslop-batch/references/ and .cursor/rules/backslop-batch/references/ contain merge-changelog.md.
- The step-2 CHANGELOG line of templates/en/skills/backslop-batch/SKILL.md is at most 60 words (`wc -w`).
- Windows note (owner of the finding for both skills): `grep -n -i -E 'git bash|powershell' templates/skills/backslop-task/SKILL.md templates/en/skills/backslop-task/SKILL.md templates/skills/backslop-batch/SKILL.md templates/en/skills/backslop-batch/SKILL.md` shows the same note next to the `BACKSLOP_DRAFT` recipe in all four files.
- One home per rule (owner of the restatement finding for all templates): `grep -rlF 'BACKSLOP_DRAFT' templates` lists only `agents-section.md` (the block must stand alone) and `skills/backslop-task/SKILL.md` in each layer (the batch skill links the task skill); `grep -rlF 'Worker boundaries:' templates/en` lists only `agents-section.md`; `grep -rlw critical templates/en` lists the files that state the cost routing; record in result.md that every file beyond the AGENTS block and the backlog README links instead of restating.
- `npm test` exits 0 with no failing test (450 at the base commit, plus the tests this card adds); `node bin/backslop.js lint` exits 0 (templateParity and the key check stay clean).
