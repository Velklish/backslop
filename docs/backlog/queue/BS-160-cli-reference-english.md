# BS-160 · Rewrite 02-cli reference in English as a synopsis table plus one section per command

- **Order:** 780
- **Scope:** [02. CLI](../../reference/02-cli.md)
- **Created:** 2026-09-25
- **Dependencies:** BS-158, BS-159, BS-108, BS-143, BS-144, BS-145, BS-146, BS-147, BS-148, BS-149, BS-150, BS-151, BS-152, BS-153, BS-154, BS-155, BS-156, BS-127

## Context

All evidence below was taken at commit 6f6318e (v0.11.0), where `node bin/backslop.js lint` exits 0. `<repo>` is the backslop checkout; throwaway projects are made with `git init -q p && cd p && node <repo>/bin/backslop.js init`.

docs/reference/02-cli.md (62,407 bytes, 78 lines) is written in Russian (`# 02. CLI и контракт для оркестратора`). It has a 21-row command table (lines 9-29), eleven long paragraphs (lines 3-5, 31-49), a `## \`status --json\`` section (51-66) and a `## Что стабильно` section (68-78). The card that removes the pre-0.9.0 legacy edits lines 19, 25, 26 and 39 of this file, so run this card after it and describe the code as it is when you start.

**Flag lists are true today (verified).** For every command, the flags in the synopsis cell equal the option keys of its `parseCommandArgs` call. Keys by file: init `dir prefix cli lang tools`; new `title queue top parent minor cost hypothesis evidence`; mv `top after restore evidence`; archive `dry-run range into`; fold `dry-run older-than embed-missing`; brief `track neighbour entry autonomy handover measurements`; seed `scan json queue-reference`; gates `keep-going require-clean dry-run json base`; upgrade `to dry-run pin-only`; merge-changelog `ours theirs base out`; changelog `since to`; adr `title`; status and tracks `json`; migrate `dry-run`; show takes none. Keep them this way.

**Unreadable table (measured).** Some command cells are thousands of characters long: line 13 (mv) has 3001 characters (5010 bytes), 14 (archive) 1824, 15 (fold N) 3140, 16 (bulk fold) 2575, 23 (gates) 2876 and 28 (merge-changelog) 3095.

**Stale or incomplete (verified)**
- The upgrade row (line 25) excludes the archive as a whole ("кроме `CHANGELOG.md`, `docs/adr/**`, архива и карточек задач"). liveMarkdown excludes only archived task directories (lib/mdwalk.js:100 ``new RegExp(`^${esc(docs)}/archive/${esc(prefix)}-\\d`)``), so archive/README.md and archive/LOG.md are live. Appending `run npx github:Velklish/backslop#v0.9.0 lint` to docs/archive/README.md makes `lint` rc=1 with `строка 19: пин github:Velklish/backslop#v0.9.0 расходится с cli`. 03-lint:32 states the set correctly.
- The seed row (line 20) lists 6 skipped directories (`dist`, `obj`, `.venv`, `vendor`, `target`, `build`) as if complete. SKIP_BUILD in lib/seed.js:22 has 12: `.venv venv vendor dist build out target obj bin coverage .tox __pycache__`. The same cell already lists `bin/*` among the candidates, so there is nothing to add about bin.
- Line 33 says that `init` rejects a config with a bad stepOverrides value. That is true but incomplete: every command that loads the config rejects it, because the reader runs validateProbe and validateAgentsConfig (lib/config.js:137-138). With `agents.stepOverrides {"1":"a<b"}`, `node <repo>/bin/backslop.js status; echo rc=$?` gives rc=1 with `✖ backslop.json: agents.stepOverrides["1"] — inline-текст без разметки: символ «<» запрещён`, and lint gives the same.
- The mv refusal list (line 13) lacks the refusal at lib/tasks.js:538-540 (``у задачи ${label} в очереди нет целого «Порядка» — сначала поправь его``) for an `--after` target in queue/ without an integer Order.
- `status --json` shows `"archive": 12` (line 62), but no text defines it. lib/status.js:33 counts `tasks.filter((t) => t.status === 'archive' && !t.into)`, and folded journal lines are tasks with status archive (lib/tasks.js:178-181). So the number is closed tasks (archive directories plus LOG.md lines), minus minor entries closed into a batch.
- The stable `backslop.json` field list (line 73) omits `agents`, which saveConfig keeps (lib/config.js:232).
- The stable command list (line 74) names `status --json`, `mv`, `new --parent …`, `archive`, `archive N.k --into M`, `fold` and `show`. It omits commands the shipped skills call: `grep -rohE "\{\{cli\}\} [a-z-]+( --[a-z-]+)?" templates/skills templates/agents-section.md templates/brief.md templates/docs | sort | uniq -c` shows `{{cli}} brief`, `{{cli}} gates`, `{{cli}} merge-changelog --ours`, `{{cli}} seed --scan` and `{{cli}} tracks`. Only `status --json` has a schema. The real `gates --json` top level (rc=0) is `gates[{command,code,signal,error,ms,when} | {command,when,skipped}]`, `total`, `green`, `skipped`, `outOfScope`, `scope{source,base,prefix,dropped,paths}` and `tree{head,clean,dirty}`. These commands do each have a row in the command table; what is missing is their stability status and a schema.
- The packed-file list (line 47) names README.ru.md. The owner's target drops README.ru.md; the BS-172 (`readme-english-rewrite`) card changes package.json, lint and the release test.

**The same rule stated in several places (verified — quote)**
- The `--require-clean` refusal on an empty change set appears in the gates refusal cell (line 23) and again in paragraph 41.
- `--restore` batch ordering appears at line 13 and in paragraph 49.
- The live-pin file set appears at lines 25 and 43; 03-lint owns it.
- The result.md `[TODO` predicate appears at line 15; 03-lint gate 5 owns it.
- The probe and stepOverrides rules appear at lines 31 and 33; the 01-layout config table owns them.
- The worker boundary appears at line 35 and in stable bullet 75; templates/brief.md:34 owns it. Bullet 75 keeps the contract fact that the worker's only write is `new --parent`.
- The fold date/outcome reading appears at lines 15-16; 01-layout owns it.

Line 15's "в поле `—` — коммит с заготовкой обязателен" legitimately describes the command's output and stays.

**Release procedure written twice (verified).** Line 45 repeats AGENTS.md:13 sentence for sentence (`npm run release -- X.Y.Z --bump` writes `version`, renames the top CHANGELOG section, stamps backslop.json through `init`). Line 47 describes the release script. `npm run release` is a repository script, not a backslop command, so it belongs to the contributor doc.

**Artifacts (verified — quote and grep)**
- 21 inline ADR citations on 13 lines: 12, 13, 14, 15, 16, 23, 25, 26, 28, 31, 33, 47 and 49. Deleting the ADR files makes lint report 21 broken links here.
- Line 47: "публикация в npm не планируется (владелец отклонил `[BS-2.1](../archive/LOG.md#bs-2.1)` 2026-09-24)". scripts/release.mjs:85 repeats it: `// Публикация в npm не планируется (владелец отклонил BS-2.1), а тег и atomic push нужны:`.
- Line 16: "Семьдесят семь тел в одно сообщение коммита не помещаются" (a count taken from this repo's own history).
- Line 17: "на котором крупный коммит ронял `show` с `ENOBUFS`".
- Rationale sentences whose trim is optional: line 25 "предсказание и факт дали бы два числа вместо одного" and line 31 "правило, которое нечем исполнить, дороже отсутствия правила". Line 33 "Список экранируемого полон по построению" is a design claim; keep it.

**Orchestrator contract.** The owner wants a standalone orchestrator-contract reference; the BS-176 (`orchestrator-contract-reference`) card at the end of the queue moves `## status --json` and `## Что стабильно` out of this file after this card translates and fixes them.

**This card closes the cross-file reference findings** (ADR citations, Russian text and Russian section names in comments, hand-kept field lists, rules restated between pages, contributor notes mixed into consumer rules, owner decisions and dated measurements). BS-158 (`layout-reference-english`) and BS-159 (`lint-reference-english`) did the file-local work in 01-layout.md and 03-lint.md; the checks below run over all three pages. The owner-decision note in the comment at `scripts/release.mjs:85` was rewritten by BS-127 (`release-script-messages-windows`).

## Work to do

- Translate docs/reference/02-cli.md to English in place and keep the filename. New shape: a short intro (entry point, flag parsing, exit codes: refusal = 1), then a synopsis table with one row per command (the synopsis with flags, plus a purpose of one line or less), then one `### <command>` section per command with bullets for Behaviour, Output (what goes to stdout and what to stderr) and Refusals (exit 1). No table cell carries prose beyond one line.
- Keep the flag lists identical to the parseCommandArgs keys listed in the context.
- Keep `## status --json` and `## What is stable` in this file, translated; the BS-176 (`orchestrator-contract-reference`) card (end of the queue) moves them into its own page.
- In those two sections: add `agents.stepOverrides` to the stable fields; define `archive` as the number of closed tasks (archive directories plus LOG.md journal lines, minor entries closed with `--into` excluded); add the `gates --json` key list verified — in the context. Owner decision: the stable list is confirmed — `brief` output and its slots, `gates --json`, `tracks --json`, `seed --scan --json`, `agents.stepOverrides`, the exit codes of `merge-changelog`, and the outcome discriminator (rc=1 with JSON on stdout is a result, rc=1 with empty stdout is a refusal) are stable; additive JSON keys are allowed, removing or renaming a key is breaking; human text is not contract.
- Fix the stale statements. Upgrade row: only archived task directories `<docs>/archive/<prefix>-N-*/` are excluded; link the live-pin set in 03-lint instead of restating it. Seed: list all 12 SKIP_BUILD names, or introduce the list with 'for example'. Line 33: every command that loads the config refuses the value, and `init` does so before writing the block. mv refusals: add 'the `--after` target sits in queue/ without an integer Order'.
- State each rule once. `--require-clean` goes only in the gates section, `--restore` ordering only in the mv section, and 'do not commit between archive N and fold N' only in the fold section. The live-pin set and the result predicate become links to 03-lint, probe and stepOverrides become links to the 01-layout config table, and the fold date/outcome reading becomes a link to 01-layout § archive. The worker boundary becomes a link to templates/brief.md, and the stable list keeps only 'the worker's only write is `new <slug> --parent N[.M]`'.
- Release: replace lines 45-47 with one line linking AGENTS.md § Release. The BS-173 (`agents-md-english-rewrite`) card owns the release procedure and carries every fact of these lines; do not carry the owner decision, BS-2.1 or the date.
- Remove any inline ADR citation the ADR consolidation cards left (21 on 13 lines at 6f6318e) and the narration at lines 16, 17 and 47. Trim the rationale at lines 25 and 31 to the rule itself. Owner decision: the reference pages carry no ADR links at all.
- Owner decision: grammar blocks and examples, the `status --json` example included, use placeholders (`<prefix>-N`, `<prefix>-N.k`, `YYYY-MM-DD`) instead of real task ids and dates.
- Packed-file list: copy it from package.json `files` as it is when you write it.
- Update the 02 row of docs/reference/README.md to the English title `02. CLI` with a one-line summary.

## Out of scope

- Full JSON schemas for tracks --json and seed --scan --json, and the exit-code taxonomy: they belong to the BS-176 (`orchestrator-contract-reference`) card.
- Changing any command behaviour, including the pre-0.9.0 removals (their own card).
- Removing README.ru.md from package.json, lint or tests (BS-172 (`readme-english-rewrite`)).

## Verification

- `head -1 docs/reference/02-cli.md` prints an English heading, and `grep -c '[А-Яа-яЁё]' docs/reference/02-cli.md` prints 0 (quoted CLI messages kept verbatim excepted; list them).
- `grep -nE 'ADR-[0-9]{3}|\.\./adr/|BS-2\.1|2026-09-24|ENOBUFS' docs/reference/02-cli.md; echo rc=$?` prints nothing and rc=1.
- `awk '{ if (length($0) > 800) print FILENAME":"NR }' docs/reference/02-cli.md` prints nothing.
- For each command, the flags in its synopsis equal the keys of its parseCommandArgs call (`grep -n -A12 'parseCommandArgs(argv' lib/<command>.js`).
- `grep -rohE '\{\{cli\}\} [a-z-]+' templates/skills templates/agents-section.md templates/brief.md | sort -u`: every command it prints has a stability status in the `What is stable` section of this file.
- The `What is stable` section names every item of the owner-confirmed list, the rule on additive and removed JSON keys, and that human text is not contract.
- With `agents.stepOverrides {"1":"a<b"}` in a throwaway project, `node <repo>/bin/backslop.js status; echo rc=$?` gives rc=1, as the text now says.
- Cross-file: `grep -nE 'ADR-[0-9]|\(\.\./adr/' docs/reference/0[123]-*.md; echo rc=$?` → rc=1.
- Cross-file: `node -e "for (const f of ['01-layout','02-cli','03-lint']) { const t=require('fs').readFileSync('docs/reference/'+f+'.md','utf8'); console.log(f,(t.match(/\p{Script=Cyrillic}/gu)||[]).length) }"` → 0 for 02-cli and 03-lint apart from quoted CLI messages kept verbatim, and for 01-layout only the RU field-alias block and the RU parser examples (BSD grep miscounts multibyte classes, so count with node); `git grep -n 'docs/reference/0[123]-[a-z]*.md, «' -- lib; echo rc=$?` → rc=1.
- Cross-file: every field of the `saveConfig` order in lib/config.js (`prefix docs cli gates probe version source lang tools agents`) has a row in the 01-layout config table, and no other reference page lists the fields by hand (`grep -n 'prefix, docs, cli' docs/reference/*.md; echo rc=$?` → rc=1).
- Cross-file: the probe and `agents.stepOverrides` rules are stated only in the 01-layout config table (02-cli links it); 'do not commit between archive N and fold N' appears only in 02-cli § fold, the result.md date and outcome reading only in 01-layout § Archive, and the live-pin file set, the gate-4 `[TODO…]` rule and the gate-5 result predicate only in 03-lint.
- Cross-file: function names, test references and implementation rationale in 01-layout.md and 03-lint.md sit only in their `Implementation notes` subsections, and 02-cli.md carries none outside such a subsection.
- Cross-file: `grep -nE 'BS-[0-9]|20[0-9]{2}-[0-9]{2}-[0-9]{2}' docs/reference/0[123]-*.md; echo rc=$?` → rc=1 (examples use `<prefix>-N`, `<prefix>-N.k` and `YYYY-MM-DD`); `grep -nE 'owner decision|владел' docs/reference/0[123]-*.md` → only the RU outcome-parser example of 01-layout § Archive that quotes «решением владельца».
- `node bin/backslop.js lint > l 2>&1; echo rc=$?` gives rc=0, and `npm test > t 2>&1; echo rc=$?` gives rc=0; record the pass count.
