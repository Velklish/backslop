# BS-159 · Rewrite 03-lint reference in English: list every lint check, state each rule once

- **Order:** 770
- **Scope:** [03. Lint gates](../../reference/03-lint.md)
- **Created:** 2026-09-25
- **Dependencies:** BS-158, BS-143, BS-144, BS-145, BS-146, BS-147, BS-148, BS-149, BS-150, BS-151, BS-152, BS-153, BS-154, BS-155, BS-156

## Context

All evidence below was taken at commit 6f6318e (v0.11.0), where `node bin/backslop.js lint` exits 0. `<repo>` is the backslop checkout; throwaway projects are made with `git init -q p && cd p && node <repo>/bin/backslop.js init`.

docs/reference/03-lint.md (25,347 bytes, 34 lines) is written in Russian (`# 03. Гейты lint`). It has a 14-row gate table (lines 7-20) followed by seven paragraphs (22-34). Gate numbers also appear as `// N.` comments in lib/lint.js and in test names, so the numbering stays. The `01-layout.md#архив` link at line 11 is rewritten to `#archive` by the BS-158 (`layout-reference-english`) card; keep it.

**Stale or incomplete (verified — ran the tool)**
- Gate 3 (line 9) says "markdown прямо в `docs/backlog/` кроме README". verified — a repro: lintBacklogLayout errors on any entry that is not a directory, not a dot file and not README.md (lib/lint.js:296-302). Running `echo hi > docs/backlog/notes.txt; node <repo>/bin/backslop.js lint; echo rc=$?` in a fresh project gives rc=1 with `✖ docs/backlog/notes.txt: файл вне каталога статуса: задача лежит в одном из triage/, queue/, active/, deferred/, minor/`.
- Error checks the page does not describe. verified — repro and grep. In a fresh `init --tools claude` project, `rm CLAUDE.md; echo x > docs/archive/stray.txt` followed by lint gives rc=1, and `grep -n -i -E "stub|CLAUDE.md" docs/reference/03-lint.md` has no match (rc=1). The missing checks:
  - the CLAUDE.md stub (lib/lint.js:246 `нет Claude stub — запусти init`);
  - stray files in the archive (lib/lint.js:419 `в архиве только каталоги задач, README.md и LOG.md`; not in the gate 5 row, line 11);
  - a missing docs index while ADRs exist (lib/lint.js:562 `нет индекса документации, а ADR есть`; not in the gate 8 row, line 14);
  - the prose-pin check (lintProsePin, lib/lint.js:65). Paragraph 32 describes it as an error, but it has no number and is missing from the line-28 list of checks outside the fourteen gates.
- Gate 11 (line 17) names `README.md`, `README.ru.md` and `AGENTS.md`, the RELEASE_PIN_FILES of lib/lint.js:35. verified — at 6f6318e, evidence below. The owner's target drops README.ru.md; the BS-172 (`readme-english-rewrite`) card removes it from RELEASE_PIN_FILES, package.json `files` and the release test. The row must list what lib/lint.js:35 holds when you write it.

**The same rule stated twice (verified — quote)**
- The gate 4 standalone `[TODO…]` rule and its triage exemption appear in row 4 (line 10) and again in paragraph 22.
- The result.md `[TODO` predicate appears in row 5 (line 11, "тем же предикатом и текстом отказывает fold N"), in paragraph 26 and again in 02-cli:15.
- The live-pin file set appears in paragraph 32 ("Проверяются `docs/**` и корневые `*.md`, кроме `CHANGELOG.md`, `docs/adr/**`, `<docs>/archive/<prefix>-N-*/` и карточек задач … `upgrade` переписывает это же множество") and in 02-cli:25 and :43.

This file owns all three rules; 02-cli will link here.

**Artifacts (verified — quote and grep)**
- Three inline ADR citations: line 10 (ADR-036), line 28 (ADR-015) and line 34 (ADR-016). Once the old ADR files are deleted, lint reports 3 broken links in this file.
- History narration. Line 22: "Прежде гейт держал этим и незаполненную строку «Улика» … — теперь не держит". Line 24: "Замер 2026-09-24 по множеству гейта 1 …", with a `[BS-64](…)` example. Line 26: "Разбор формы строки — «строка кончается заглушкой в скобках» — отвергнут".
- Contributor-only notes mixed into the rules: line 3 (how probes in test/lint.test.mjs are organised), line 26 (`hasResultTodo`) and line 28 (toolCopy/toolCli probes for tool-repo-only gates).
- The comment at lib/lint.js:179 cites this file by a Russian paragraph: `// история, — docs/reference/03-lint.md, абзац «Пин сверяется с `cli`…».`

## Work to do

- Translate docs/reference/03-lint.md to English in place. Keep the filename, the gate numbers 1–14 and the table columns (No., Gate, What it catches, How to fix).
- Gate 3 row: 'any file directly in docs/backlog/ other than README.md (dot files are ignored); a directory that is not a status; a missing status directory'.
- Complete the error list. Add stray archive files to the gate 5 row. Add 'no docs/README.md index while ADRs exist' to the gate 8 row. Add a named item for the CLAUDE.md stub (claude adapter selected, CLAUDE.md missing) under the adapter checks. Add a named item for the prose-pin check to the list of checks outside the fourteen gates. Do not renumber the gates.
- One owner per rule: the gate 4 `[TODO…]` rule and triage exemption only in row 4 (merge paragraph 22 into it or cut it to what the row lacks); the result.md predicate once under gate 5, saying that `fold N` refuses with the same predicate and message; the live-pin file set once (paragraph 32), phrased so that 02-cli can link to it.
- Remove the narration at lines 22, 24 and 26. Line 24 keeps the rule: 'a link whose text names a task (`<prefix>-N[.k]`) must not point to a directory; directory links without a task id are allowed'. Replace `BS-64` with a `<prefix>-N` example.
- Remove any inline ADR citation the ADR consolidation cards left (lines 10, 28, 34 at 6f6318e).
- Gate 11 row: copy the file list from RELEASE_PIN_FILES (lib/lint.js:35) as it is when you write it.
- Move contributor notes (the test-probe layout from lines 3 and 28, and function names such as hasResultTodo, lintProsePin and the lib/mdwalk.js walkers) to a trailing `Implementation notes` section.
- Update the lib/lint.js:179 comment to the English paragraph name, and the 03 row of docs/reference/README.md to the English title.

## Out of scope

- Changing any lint behaviour or gate numbering.
- Removing README.ru.md from RELEASE_PIN_FILES, package.json or the release test (BS-172 (`readme-english-rewrite`)).
- The gate-count word in docs/reference/README.md and the help text, and the recipe for adding a gate (contributor docs).
- The cross-file checks over 01/02/03 — BS-160 (`cli-reference-english`).

## Verification

- `head -1 docs/reference/03-lint.md` prints an English heading. `grep -c '[А-Яа-яЁё]' docs/reference/03-lint.md` prints 0, or only counts quoted Russian CLI messages kept verbatim as identifiers.
- `grep -nE 'ADR-[0-9]{3}|\.\./adr/|2026-|BS-64' docs/reference/03-lint.md; echo rc=$?` prints nothing and rc=1.
- In a fresh project, `echo hi > docs/backlog/notes.txt; node <repo>/bin/backslop.js lint; echo rc=$?` gives rc=1, and the gate 3 row describes exactly this case.
- `grep -n -i 'stub' docs/reference/03-lint.md` finds the CLAUDE.md item. The gate 5 row names stray archive files, and the gate 8 row names the missing index.
- `grep -c 'README.ru.md' docs/reference/03-lint.md` is 1 when lib/lint.js:35 still lists README.ru.md, and 0 otherwise.
- `node bin/backslop.js lint > l 2>&1; echo rc=$?` gives rc=0, and `npm test > t 2>&1; echo rc=$?` gives rc=0; record the pass count.
