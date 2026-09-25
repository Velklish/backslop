# BS-162 · Fix backlog/archive rules templates and LOG header; re-render the repo copies in English

- **Order:** 800
- **Scope:** [01. Layout](../../reference/01-layout.md) § Archive
- **Created:** 2026-09-25
- **Dependencies:** BS-157, BS-88, BS-86, BS-103, BS-91, BS-161

## Context

All evidence below was taken at commit 6f6318e (v0.11.0), where `node bin/backslop.js lint` exits 0. `<repo>` is the backslop checkout; throwaway projects are made with `git init -q p && cd p && node <repo>/bin/backslop.js init`.

The rules pair (backlog/README.md and archive/README.md) and the journal header (archive/LOG.md) come from templates in two layers: templates/en/docs/… (en, the source layer of templateParity since BS-161 (`template-contract-reference`)) and its ru twin templates/docs/…. Each pair must keep the same headings and placeholders (the template parity check), and the ru and en backlog README have the same line structure (55 lines each). migrate redraws the two READMEs, listed in RULES_DOCS (lib/migrate.js:43), when the stamp is below the tool version (lib/migrate.js:82). This repo's docs/backlog/README.md and docs/archive/README.md are byte-equal renders of the ru templates. test/templates.test.mjs:141-149 enforces that, but it calls `renderTemplate(rel, …)` with the ru layer whatever backslop.json `lang` says (an en render needs the `en/` prefix, lib/templates.js:9-11).

**This repository's copies are Russian, and no gate notices.** verified — measured on a clone of 6f6318e with only backslop.json `lang` switched from ru to en (what the commit that filed this card does): `npm test` rc=0 (tests 450, pass 450), `node bin/backslop.js lint` rc=0, `node --test test/templates.test.mjs` rc=0 (13/13). docs/backlog/README.md, docs/archive/README.md and the LOG.md header stay the ru renders, because test/templates.test.mjs:146 calls `renderTemplate(rel, …)` with the ru path instead of `templateRel(cfg.lang, rel)`. Whether a lang switch should redraw the pair in general is the BS-103 (`unverified-lang-switch-redraw`) card; use its fix here if it confirmed one.

**LOG.md header is not tool-owned (verified — read code and tests).** RULES_DOCS lists only the two READMEs. The 0.10.0 migration writes LOG.md only when it is missing (lib/migrate.js:33-34 `if (existsSync(file)) return;`), and fold creates it only when it is missing (lib/fold.js:74). No test compares docs/archive/LOG.md with its template; test/templates.test.mjs:145 covers only the READMEs. Today the header equals the ru render after trimEnd.

**Bulk fold is misdescribed (verified — repro).** The LOG header (en line 5; ru and the docs copy say the same) reads: "An `—` commit means that the body went into the message of the folding commit, and `show` looks it up by the `{{prefix}}-N:` subject." archive README en:13 reads: "there the body comes from history … and the journal line names the revision". But bulk fold writes `—` for a body that is not in history and drops the body unless `--embed-missing` is given (lib/fold.js:52 `const missing = single ? [] : entries.filter((e) => e.why === ABSENT)`, warning at :55-58).

Repro: exclude an archived task directory from git (`echo docs/archive/BS-5-delta/ >> .git/info/exclude`), then run `node <repo>/bin/backslop.js fold > bulk.stdout 2> bulk.stderr; echo rc=$?`. The result:
- rc=0;
- stderr: `⚠ docs/archive/BS-5-delta: тела нет в истории git — текст уходит вместе с каталогом; … fold --embed-missing` and `у строк с «—» (задач 1) тело ушло вместе с каталогом и не сохранено ни в заготовке, ни в истории`;
- the LOG line: ``- <a id="bs-5"></a>`BS-5-delta` · 2026-09-24 · выполнена · — · Delta``;
- `show 5`: rc=1 with `✖ BS-5: строка docs/archive/LOG.md коммита не называет, и коммита с заголовком «BS-5: …» в истории нет — тело не достать`.

BS-86 (`fold-keeps-bodies-retrievable`) already made the bulk draft intro (`draftMany`, lib/fold.js:297-300 at 6f6318e) name the `—` lines. Neither template mentions `--embed-missing`.

**Backlog README template problems (verified — quote, en line numbers)**
- Rules stated twice between the table and the bullets:
  - the "section exists; check the reason and return condition" message: 14 and 32;
  - the triage exemption: 20 ("the placeholder gate does not look into `triage/`") and 28;
  - the batch closing order: 16, 30 and 45.
  The bullets should own each rule (32, 28, 45), and the table should keep only the commands. Archive README:5 ("Numbers are sequential and never reused") is a fair cross-reference; leave it.
- Line 30 (1431 characters) repeats the draft-commit rule of archive README:11 ("Committing with that draft is mandatory when the line's commit field is `—` …"). The archive README owns that rule. Lines 24, 28 and 43 are not over-dense; leave them. What does need to change is line 26's parenthetical about the scan mechanism, `(git show <branch>:<docs>/archive/LOG.md: …)`.
```text
- Line 28: "The `Evidence:` line of a finding from `{{cli}} new <slug> --parent N[.M]` falls under the same exception: unfilled, it no longer fails the gate — the approver asks for the evidence during review. In `minor/` that line still fails the gate." lint has no per-line exception; it skips the whole triage/ directory (lib/lint.js:314). `new --parent N --queue` is accepted (lib/new.js:57 refuses only `--minor` with `--queue`), and its Evidence line then fails. Repro: `new f3 --parent 1 --queue --title F3` gives rc=0, then `lint` gives rc=1 with `queue/BS-1.1-f3.md: строка 11: осталась заглушка [TODO]`. "no longer" and "still" narrate a past change.
```
- Line 26 says the command "names the foreign number it skipped". The BS-88 (`branch-scans-new-and-tracks`) card made `new` name a foreign number only when it caused a skip; word the sentence to match.
- The "review is complete" criterion has drifted (verified — read). ru README:55 reads "у каждой записи `triage/` есть ход: слита, переехала в другой каталог или закрыта решением владельца", while templates/skills/backslop-task/SKILL.md:61 reads "`triage/` пуст или у каждой оставшейся записи есть названный ход". The skills name the backlog README as the owner (en task SKILL.md:59: "Both, and the review rules, are in `{{docs}}/backlog/README.md`"). backslop-batch SKILL.md:24 restates README:45's batch cut and closing order. Moving the role protocol out of the README is not supported and is left to the owner.

## Work to do

- In both layers (en and ru, keeping headings and placeholders identical per pair), backlog README (the BS-157 (`remove-roadmap-from-layout`) card already dropped the ROADMAP sentence from line 3): make the table (lines 11-16) command-only: remove the 'section exists' prose (14) and the batch-order prose (16). Keep the triage exemption only in bullet 28, the deferred rule only in 32, and the batch order only in 45.
- Line 26: drop the `git show <branch>:…` parenthetical, and word the reported number to match the fixed `new`, e.g. 'when a number on another worktree or branch made it skip, the command names it'.
- Line 28: replace the two Evidence sentences with: 'a finding from `new --parent` lands in triage/, where placeholders are not checked; once it moves to queue/ or minor/, an unfilled Evidence line fails lint'.
- Line 30: cut to one sentence (close with `{{cli}} archive N`, complete result.md, then `{{cli}} fold N`) and link ../archive/README.md for the draft and commit rule.
- Line 55: settle on one completion criterion. Suggested wording: 'every entry still in triage/ has a named next step: merged, moved, or closed by the owner's decision'. Replace templates/{,en/}skills/backslop-task/SKILL.md:61 with a link to it. (The BS-171 (`batch-run-brief-measurements`) card later replaces the restated batch order in backslop-batch SKILL.md:24 with a link to this rule.)
- archive README (both layers): :11 keeps the draft-commit rule. At :13, add: 'a body missing from history is dropped with a warning unless `{{cli}} fold --embed-missing` puts it into the draft, which must then be committed; its journal line carries `—` in the commit field'.
- LOG.md header, line 5 (both layers): describe both meanings of a `—` commit. After `fold N`, the body is only in the fold commit's message (commit the draft). After a bulk fold, the body was not in history; it is in the draft if `--embed-missing` was given, and otherwise it is lost.
- Re-render docs/backlog/README.md and docs/archive/README.md (with the lang-switch fix if the BS-103 (`unverified-lang-switch-redraw`) card confirmed and fixed it, otherwise by hand) from the en templates with this repo's values (cli and prefix from backslop.json, project = package.json name). Rewrite docs/archive/LOG.md lines 1-5 to the en header render and leave the journal entries untouched.
- test/templates.test.mjs:141-149: render with the layer of `cfg.lang` (renderProjectTemplate(cfg, …) or templateRel(cfg.lang, rel)) (the lang switch alone leaves this test green on the ru copies, as measured above). Extend the test to the LOG.md header: the text before the first `- <a id=` line, compared after trimEnd with the rendered LOG template.

## Out of scope

- Moving the worker/approver/owner role protocol out of the backlog README (minor hypothesis BS-162.1).
- Having migrate redraw the LOG.md header in consumer projects (minor hypothesis BS-162.2; the body is data).
- Deleting the ROADMAP templates, the init change and the delete-if-unchanged migration (the BS-157 (`remove-roadmap-from-layout`) card); the lang-switch redraw in code (the BS-103 (`unverified-lang-switch-redraw`) card).
- The fold report streams (stdout vs stderr, the ⚠ glyph on routine lines).

## Verification

- `node --test test/templates.test.mjs > t 2>&1; echo rc=$?` gives rc=0: parity, the self-host render in the `cfg.lang` layer and the new LOG header check all pass.
- `head -1 docs/archive/README.md docs/archive/LOG.md docs/backlog/README.md` prints `# Closed task archive`, the English journal title and `# Backlog`.
- `grep -c 'section exists' templates/en/docs/backlog/README.md` prints 1. `grep -n 'ROADMAP\|no longer\|still fails' templates/en/docs/backlog/README.md docs/backlog/README.md; echo rc=$?` gives rc=1.
- Excluded-directory bulk fold repro from the context: the LOG header and archive README now describe what happens.
- `grep -c "is mandatory when the line's commit field" docs/reference/0*.md docs/backlog/README.md docs/archive/README.md` → a total of 1 (the archive README owns the draft-commit rule; 01-layout and 02-cli link it instead of restating it).
- `npm test > t 2>&1; echo rc=$?` gives rc=0, and `node bin/backslop.js lint > l 2>&1; echo rc=$?` gives rc=0; record the pass count.
