# BS-174 · Translate docs/README.md and GLOSSARY to English; fix archive, gate, slot and batch terms

- **Order:** 920
- **Scope:** [Reference](../../reference/README.md)
- **Created:** 2026-09-25
- **Dependencies:** BS-157, BS-140, BS-159, BS-160, BS-143, BS-144, BS-145, BS-146, BS-147, BS-148, BS-149, BS-150, BS-151, BS-152, BS-153, BS-154, BS-155, BS-156, BS-83

## Context

`docs/README.md` (the documentation index, which holds the ADR table and the cross-cutting principles), `docs/GLOSSARY.md` and `docs/reference/README.md` are Russian, and English readers of `README.md` are sent to them. Several glossary and index entries are wrong or ambiguous. This card translates the three files and fixes those entries.

Order: land after every ADR consolidation card. Those cards replace `docs/adr/adr-001…adr-038` with consolidated ADRs, rewrite the ADR table rows and repoint the glossary's ADR links in the same commits. This card translates and checks what they leave. The BS-157 (`remove-roadmap-from-layout`) card already dropped the ROADMAP row.

Evidence. Every item is verified at v0.11.0 (commit 6f6318e):

1. **The files are Russian.** verified — `docs/README.md`, `docs/reference/README.md` and `docs/GLOSSARY.md` are Russian. `GLOSSARY.md:5` sets the spelling "in Russian texts" and a rule for declining Latin terms. The columns are "В тексте | EN", and the retired words are Russian words. `README.md:105` points English readers to `docs/reference/`. The project `lang` switch happened in the commit that filed this card.
2. **The archive is described in one form only.** verified — at 6f6318e, evidence below. `docs/README.md:11` describes the archive as task definition and result in separate files. `GLOSSARY.md:18` defines it as the directory of `<id>-<slug>/task.md` and `result.md`. But `ls docs/archive` shows only `LOG.md` and `README.md`, a fresh `init` creates `docs/archive/LOG.md`, and `docs/archive/README.md:17` says both forms are legal and folding is optional. The same one-form row is in `templates/docs/README.md:11` and `templates/en/docs/README.md:11`.
3. **Journal vocabulary is missing.** verified — read (the concepts are defined elsewhere; the glossary is incomplete). Occurrence counts in `docs/reference`, `AGENTS.md` and the skills against the glossary:
   - "журнал": 28 against 0;
   - "свёрт…": 18 against 0;
   - "исход": 62 against 0;
   - "ревизи…": 45 against 0;
   - "заготовк…": 36 against 0;
   - "Прежний порядок": 4 against 0.

   The header row (`GLOSSARY.md:19`) omits the Previous order field defined in `lib/tasks.js:29`. The concepts are defined in `01-layout.md:65`, `:96-126` and `docs/archive/README.md:11-15`.
4. **"Slot" names three things.** verified —
   - `GLOSSARY.md:42`: the place where the harness plugs in worker transport;
   - `02-cli.md:19`: the orchestrator decisions a brief prints as a bracketed TODO placeholder;
   - `03-lint.md:18` and the `lib/lint.js:126` comment: `{{name}}` template placeholders (gate 12, "Слоты шаблонов").

   This breaks the rule at `GLOSSARY.md:3`: one concept, one name.
5. **"Gate" names two things.** verified — at 6f6318e, evidence below. `GLOSSARY.md:21` defines a gate as a `gates` entry, which is a string or `{command, when}` (`lib/config.js:156-165`). `reference/README.md:9` and `03-lint.md:1` call each numbered lint check a gate as well. That gate 9 only warns is already documented (`03-lint.md:15`).
6. **ADR gate 8 checks a link, not a table row.** verified — at 6f6318e, evidence below. After `adr foo-bar`, lint gave rc=1 ("no row in README.md — the ADR table is kept by hand"). After appending a prose line with a link to the new ADR, lint gave rc=0. `lib/lint.js:565-569` checks only that the ADR path is among the relative links of `docs/README.md`. `docs/README.md:59`, `GLOSSARY.md:33` and `03-lint.md:14` say a table row is required.
7. **Status cells disagree with the ADR files.** verified — in the current table:
   - adr-001 is "Accepted" in the table, while its file says "Superseded in part by ADR-019";
   - the table rows for adr-004 and adr-006 omit a replacement their files name;
   - ADR-029 replaces a line of ADR-022, while both the table and the ADR-022 file still say "Accepted".

   The consolidation replaces these rows. After it, every Status cell must equal the Status line of its file, and no topic cell may narrate supersession history.
8. **Principle 2 conflicts with the consolidation.** verified — at 6f6318e, evidence below. Principle 2 (`docs/README.md:54`, the same text at `templates/docs/README.md:17` and `templates/en/docs/README.md:17`) says a replaced ADR keeps a "superseded by" note. The consolidation deletes the old files instead. No code or test depends on the principle.
9. **The comment-block identity is misattributed.** verified — `GLOSSARY.md:43` attributes the identity to `commentBlocks` in `test/comment-scan.mjs`, which only groups lines. The identity is `blockId` in `test/comment-length.test.mjs:23-25`: sha256 of the trimmed lines with the comment markers included, first 12 hex characters.
10. **The batch row misstates how entries close.** verified — in a throwaway project: `archive` of the batch card left its entry in `docs/backlog/minor/`, and only `archive <entry> --into <batch>` moved it. The batch must be archived first (`lib/archive.js:75`) and must not be folded yet (`:79`); the entry gets no `result.md` of its own (`:88`, `01-layout.md:132`). `GLOSSARY.md:14` says closing the batch closes its entries.
11. **Principle 5 duplicates `AGENTS.md`.** verified — at 6f6318e, evidence below. Principles 1-4 and the ADR line at `:59` mirror the consumer template `templates/docs/README.md:14-21`, so they stay. Only principle 5 (`:57`) is repo-specific, and it repeats `AGENTS.md:5` and `01-layout.md:138`.
12. **Role rows repeat step numbers.** verified — `GLOSSARY.md:29-30` repeat the step split 1-4 / 5-7 that the `backslop-task` skill and the managed block own.
13. **ADR links are coupled to the old files.** verified — counts:
    - `docs/README.md` has 38 ADR links, one per ADR file;
    - `CHANGELOG.md` has 26 links to 24 files;
    - `AGENTS.md` has 2;
    - `GLOSSARY.md` has 4 (lines 13, 23, 43, 54).

    Deleting one ADR turns lint gate 1 red in every file that links it. An ADR with no link from `docs/README.md` turns gate 8 red.

## Work to do

- `docs/README.md` in English (project content, it intentionally differs from the template): intro (current work via `node bin/backslop.js status`, rationale in the ADRs); document table with rows for `reference/` (the BS-176 (`orchestrator-contract-reference`) and BS-177 (`lib-module-map-reference`) cards add their pages), `GLOSSARY.md`, `backlog/`, and `archive/` described in both forms (a task directory until folded, then a line in `archive/LOG.md`, evidence item 2).
- ADR table: exactly one row per file in `docs/adr/` as left by the consolidation — English topic, Status equal to the Status line in the file, no supersession narration (evidence item 7). Principles: translate 1, 3 and 4 using the wording of `git show 6f6318e:templates/en/docs/README.md` (lines 14-17; the BS-166 (`docs-skeleton-adr001-index`) card later removes principles 1 and 3 from the template); principle 2 states the rule for future decisions of the process ADR: a topic has one ADR, and a changed decision rewrites it, in place or as a new file that replaces it; a replaced file is deleted and nothing cites its number (no "Superseded by" chains); principle 5 becomes one sentence linking `AGENTS.md` (evidence item 11); the closing line reads: every ADR must be linked from this file — lint gate 8 checks the link — and the link is kept as a row of the table above (evidence item 6).
- `docs/GLOSSARY.md` in English with the column layout of `templates/en/docs/GLOSSARY.md` (Term | EN | Definition | Evidence); drop the Russian spelling/declension sentence; evidence cells point at code or reference sections, never at ADR numbers.
- Glossary fixes: archive in two forms (item 2); batch — an ordinary card listing the minor entries of one area; after the batch is archived and before it is folded, each entry is closed with `archive N.k --into M` and its outcome is named in the batch's `result.md` (item 10); gate = an entry of `gates` (string or `{command, when}`) vs lint gate = one numbered lint check (item 5); slot split into harness slot, brief slot and template placeholder (item 4); header fields including Previous order; new rows for journal (`docs/archive/LOG.md`), fold, revision, fold draft, outcome (item 3); worker and approver defined without step numbers, linking the `backslop-task` skill (item 12); comment block: no identity sentence (the BS-140 (`comment-length-templates-tests`) card removed the debt list and its `blockId`, item 9); ADR = linked from `docs/README.md` (item 6).
- Retired terms: keep only rows whose "do not use" word can appear in English prose (inbox → triage; backlog index → `status`; team lead → orchestrator/approver; line → track); drop rows that exist only as Russian words; add that a multi-number `mv` call is not called a batch (batch is the minor-batch card).
- Name gate 12 "Template placeholders" in `docs/reference/03-lint.md` and in the `// 12.` comment at `lib/lint.js:126` (keep the file's comment language); call the brief decisions "brief slots" where `02-cli.md` or the orchestrator contract page names them; reword the gate 8 row of `03-lint.md` as "ADR not linked from docs/README.md".
- `docs/reference/README.md` in English if it is still Russian, listing pages 01-04 (04-verification comes from BS-83 (`finding-verification-protocol`); the BS-176 (`orchestrator-contract-reference`) and BS-177 (`lib-module-map-reference`) cards add 05 and 06). Archive row of `templates/docs/README.md:11` and `templates/en/docs/README.md:11`: both forms (same meaning in each language) — the BS-166 (`docs-skeleton-adr001-index`) card already changed this row in both templates; check that it describes both forms.

## Out of scope

- ADR content and the consolidation itself (ADR cards).
- Principle 2 in `templates/docs/README.md` and `templates/en/docs/README.md` (consumer policy, unchanged).
- Making gate 8 require a table row (code).
- The ROADMAP row and file (removed by the BS-157 (`remove-roadmap-from-layout`) card).
- Translating reference pages 01-03.

## Verification

- `node bin/backslop.js lint; echo rc=$?` → rc=0 (gate 1 links, gate 8 ADR index); `npm test; echo rc=$?` → rc=0 with the pass count (template parity and self-host tests).
- Cyrillic count with node (BSD grep miscounts multibyte classes): `node -e "for (const f of ['docs/README.md','docs/GLOSSARY.md','docs/reference/README.md']) console.log(f,(require('fs').readFileSync(f,'utf8').match(/[\u0400-\u04FF]/g)||[]).length)"` → 0 for each.
- ADR table check: `ls docs/adr/*.md | wc -l` equals `grep -c '](adr/' docs/README.md`; a node script comparing each file's `**Status:**` line with its table cell reports no difference.
- `grep -nE 'ADR-[0-9]' docs/GLOSSARY.md; echo rc=$?` → rc=1.
- `git grep -n 'Слоты шаблонов'` → no match.
- Residual links to the replaced ADR files, after every ADR card: `git grep -n -F -f <(git ls-tree --name-only 6f6318e docs/adr/ | sed 's#.*/##') -- . ':!docs/archive' ':!templates' ':!test/init.test.mjs'; echo rc=$?` → rc=1 (test/init.test.mjs names `adr-00N-process.md` fixtures inside temp projects); `git grep -nE 'ADR-0(0[1-9]|[12][0-9]|3[0-8])\b' -- lib bin scripts test AGENTS.md README.md docs/reference docs/GLOSSARY.md` shows only consumer-fixture text (test/tasks.test.mjs, test/fixtures/).
