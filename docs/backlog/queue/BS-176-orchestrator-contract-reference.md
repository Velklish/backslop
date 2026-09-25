# BS-176 · Add the English orchestrator contract page: JSON schemas, exit codes, stability list

- **Order:** 940
- **Scope:** [02. CLI](../../reference/02-cli.md) § What is stable
- **Created:** 2026-09-25
- **Dependencies:** BS-160, BS-172, BS-173, BS-174, BS-91, BS-125, BS-126

## Context

The only statement of what an orchestrator or script may rely on is the Russian section "Что стабильно" of `docs/reference/02-cli.md` (lines 68-78) plus the `status --json` block (lines 51-66). It names `status --json`, `mv`, `new --parent`, `archive`, `archive N.k --into M`, `fold` and `show`. The shipped skills also call `brief`, `tracks`, `gates --json` and `seed --scan --json`, and no document gives their JSON shapes, exit codes or stability. This card creates one English reference page for that contract and moves the contract passages out of `02-cli.md`.

The reference pages, README.md, AGENTS.md and the docs index were rewritten in English before this card; the moved passages leave `02-cli.md` as English text. The BS-160 (`cli-reference-english`) card already translated `status --json` and `What is stable`, added `agents.stepOverrides`, defined the `archive` count and gave `brief`, `gates --json`, `tracks --json`, `merge-changelog` and `seed --scan --json` a stability status; this card moves those sections and adds the schemas, exit codes and channels below. Evidence items describe the state at 6f6318e.

Evidence. Every item is verified at v0.11.0 (commit 6f6318e):

1. **Stability list misses outputs the skills parse.** verified — read `02-cli.md:74` against the skills. `02-cli.md:74` lists only `status --json`, `mv`, `new --parent N[.M]`, `new … --minor --evidence`, `archive`, `archive N.k --into M`, `fold`, `show` and their exit codes. `templates/en/skills/backslop-batch/SKILL.md:50` builds every brief with `{{cli}} brief <N…> --track …`. `SKILL.md:116` checks that the human output of `{{cli}} tracks` is empty, without `--json`. `backslop-task` uses `gates --json` (en `SKILL.md:26,40`), and the seed skill uses `seed --scan --json`.
2. **Field lists disagree.** verified — `sed -n 26p README.md`, `sed -n 73p docs/reference/02-cli.md` and `lib/config.js:232`. The stable fields at `02-cli.md:73` omit `agents.stepOverrides`, although `02-cli.md:33` documents it. `README.md:26` omits `source`, although `README.md:76` tells users to set it. `saveConfig` orders the keys as `prefix, docs, cli, gates, probe, version, source, lang, tools, agents` (`lib/config.js:232`), and `docs/reference/01-layout.md:38-49` already has a table of all ten fields.
3. **`tracks --json` schema is undocumented.** verified — ran `tracks --json` in a throwaway repo, rc=0. The repo had a worktree on branch `track-a` with one task commit and an untracked file, a branch `track-b` with one task commit, and a detached worktree. `lib/tracks.js:89` writes `{ tracks, total }`. Each entry (`:61-69`, `:77-85`) is `{kind: 'worktree'|'branch', path, branch, head, merged, pending, dirty}`. Observed values:
   - worktree: `path` absolute, `branch: 'track-a'`, `head` a full sha, `merged: false`, `pending: ['6330606 <subject>']`, `dirty: ['?? d.txt']`;
   - detached worktree: `branch: null`, `dirty: []`;
   - branch-only entry: `path: null`, `head: null`, `dirty: null`.

   `pending` items are `"<short sha> <subject>"`. `dirty: null` means "could not be checked" for a worktree and "not applicable" for a branch. `02-cli.md:24` describes the command in prose only.
4. **`seed --scan --json` schema and sources.** verified — ran it in a throwaway repo, rc=0. The repo had `package.json` scripts `test`, `lint` and `start`, plus `.github/workflows/ci.yml`. `lib/seed.js:53` prints `JSON.stringify({ gates, subsystems })`. A gate item is `{command, evidence}` (`:71`), and a subsystem item is `{name, evidence}` (`:145`). The evidence strings take three forms: `package.json → scripts.test`, `.github/workflows/ci.yml:4`, or a bare path such as `src/api`. `02-cli.md:20` says candidates come from "`package.json` scripts" and lists six skipped directories. In the code, `GATE_NAME = /^(test|tests|lint|check|build|typecheck|type-check|fmt|format)$/` (`lib/seed.js:13`) filters the scripts, so `start` was dropped in the run. `SKIP_BUILD` (`lib/seed.js:22`) holds twelve directories and adds `venv`, `out`, `bin`, `coverage`, `.tox` and `__pycache__`.
5. **`gates --json`: top-level keys and failure shape.** verified — `02-cli.md:23` already documents the skipped-entry shape `{command, when, skipped}`, `outOfScope`, `scope.prefix`/`scope.dropped`, `head: null`, `code` 0 with `error`, and the `--dry-run` shape. The following is missing:
   - top-level `total` and `green`;
   - the `scope` object `{source: 'worktree'|'base+worktree', base, prefix, dropped, paths}` (`lib/gates.js:102-108`);
   - the `tree` object `{head, clean, dirty}`, where `dirty` is raw `git status --porcelain` text (`:16-20`);
   - per-result `when`;
   - after a red gate without `--keep-going`, gates that never ran are absent from `gates[]` and counted only in the top-level numeric `skipped`. The per-entry `skipped` is a string.

   Observed on a clean run, rc=0: `total 2, green 1, skipped 1, outOfScope 1, scope {source:'worktree', base:null, prefix:'', dropped:0, paths:[]}, tree {head:<sha>, clean:true, dirty:''}`. Observed with a red first gate in a directory without git: rc=1, `gates[]` holds 1 of 2 entries, `total 2, green 0, skipped 1, scope null, tree null`. `--dry-run --json` prints `{gates:[{command, when}], total, dryRun: true}`.
6. **Two shapes of `dirty`.** verified — in one `gates --json` run with an untracked `src/api/a.js`. `tree.dirty` was `'?? src/'` (porcelain without `-uall`, `lib/gates.js:13,19`), while `scope.paths` was `['src/api/a.js']` (`-z -uall`, `:45`). In `tracks --json`, `dirty` is an array of porcelain lines (`lib/tracks.js:34-36`).
7. **`status --json` details.** verified — at 6f6318e, evidence below. `title`, `created` and `taken` may be `null` (`lib/status.js:17-24`). `active`, `deferred` and `triage` are ordered by task number (`lib/tasks.js:163`); only the ordering of `queue` and `minor` is documented (`02-cli.md:66`). `archive` counts closed tasks in `archive/` plus folded `LOG.md` lines, and excludes batch-closed minor entries (`status.js:33`, `tasks.js:162`). Observed after `archive` and `fold` of one task: `"archive": 1`. The doc example already shows the raw `deferred` line (`"deferred": "- **Отложена:** 2026-09-02"`), so that part needs no change.
8. **Exit codes and how to tell outcomes apart.** verified — the doc already gives exit 1 for a refusal, a red gate and a merge-changelog conflict, case by case. Two things are missing:
   - A crash also exits 1. `bin/backslop.js:164-170` sets `exitCode = 1` for `CliError` and rethrows any other exception, and Node exits 1 on the unhandled rejection with a stack.
   - No rule tells a red result from a refusal. `gates --json` with a red gate gives rc=1 with JSON on stdout (`lib/gates.js:286`). `gates --json --require-clean` without `--base` gives rc=1, empty stdout and `✖ --require-clean without --base: …` on stderr.

   Observed rc=1 for: `new --minor` without `--evidence`, a bad slug, `mv` to the current status, `mv` to minor without evidence, an unknown id, `fold` of a stub result, `fold` of a folded task, a red gate, a gates refusal, `tracks` without git, `seed` without a mode, `brief` of a folded or unknown task, an unknown option, an unknown command, a missing or malformed `backslop.json`. Observed rc=0 for `fold` with nothing to fold.
9. **Channels.** verified — in `lib/util.js:13-17`. `ok()` and `info()` write to stdout with the prefixes `✔ ` and two spaces. `warn()` and `bad()` write to stderr with `⚠ ` and `✖ `. Refusals go to stderr and leave stdout empty. A `--json` command writes one JSON document to stdout.
10. **Channels settled by earlier cards.** Bulk `fold` with nothing to fold now reports on stderr (the BS-91 (`fold-journal-eol-and-order`) card), the routine `fold` report is an unmarked stderr note (BS-125 (`report-channels-and-dry-run`)), `status --json` blank fields are `null` and `seed --scan --json` carries `total` (BS-126 (`json-contract-nulls-total`)). Document the channels and shapes as they are when you start, with the real runs below.
11. **`brief` refuses folded tasks.** verified — after `fold`, `brief 2` gives rc=1 and `✖ <prefix>-2 is archived without task.md — there is no definition for the brief to take`. The check is `lib/brief.js:44` (`archive && !hasTask`), and journal records carry `hasTask: false` (`lib/tasks.js:182`). `02-cli.md:19` states the refusal only in general terms: no doc says a folded task gets it or points to `show N`.
12. **When a change needs an ADR is ambiguous.** verified — `AGENTS.md:5` says any change to commands needs a new ADR, while `02-cli.md:78` asks for one only when an item of the stable list changes. A new read-only command is on neither list.
13. **No pointer to the contract.** verified — the section is indexed (`docs/reference/README.md:8`, `docs/README.md:7`), but `README.md:87-89` ("For orchestrators") and `AGENTS.md` do not link it.

## Work to do

- Create `docs/reference/04-orchestrator-contract.md` (English, title "04. Orchestrator contract", no task numbers, dates, owner-decision notes or ADR citations) with sections: scope and audience (files + CLI are the only API; pin via `cli`; an untagged `cli` is no contract); invocation (`<cli> <command>`, strict flag parsing, project found by walking up to `backslop.json`, `lang` changes only human text); output channels (evidence item 9; `--json` = one document on stdout; `fold`/`show` stdout = draft/body only; `fold`/`show`/`archive` stderr is a human report; `⚠` marks a real warning, not a failure).
- Exit-code section: table from evidence item 8 plus the discriminator rule — rc=1 with JSON on stdout is a result (red gate), rc=1 with empty stdout is a refusal, a stack trace on stderr is a crash (also rc=1).
- Schema sections, each with a JSON example taken from a real run and nullability/ordering rules: `status --json` (move the block from `02-cli.md:51-66`, add item 7), `gates --json` and `gates --dry-run --json` (item 5, including the `skipped` arithmetic and `scope`/`tree` null cases), `tracks --json` (item 3), `seed --scan --json` (item 4; point at `GATE_NAME` and `SKIP_BUILD` in `lib/seed.js` instead of copying lists; say evidence is a human-readable pointer, not a parseable locator), and a note on the two `dirty` shapes (item 6).
- `brief` section: stdout is the brief, stderr notes; orchestrator decision slots are printed as a bracketed TODO placeholder the orchestrator must replace; refusals, naming folded tasks explicitly with `show N` as the way to read their body (item 11).
- Sections for mutating commands used by an orchestrator (`new --parent`, `new --minor`, `mv` incl. several numbers in one call and `--restore`, `archive`, `archive N.k --into M`, `fold` single and bulk, `show`): refusals and the all-checks-before-first-move guarantee; the worker/approver boundary; the managed `AGENTS.md` block (markers, replace/append/refuse rules, `agents.stepOverrides`, `probe`); `backslop.json` fields — all ten including `source` and `agents.stepOverrides`, `gates` entry as string or `{command, when}` (item 2).
- Stability section: explicit stable list extended with `brief` output and its slots, `gates --json`, `tracks --json` (plus the human `tracks` emptiness check the batch skill relies on), `seed --scan --json` and `agents.stepOverrides`; additive JSON keys are allowed, removing or renaming a key is breaking. Before closing, confirm this list with the owner (the recommendation is to declare all of them stable because shipped skills depend on them). Add a "Not contract" list: human text, glyphs, colours, info-line order, JSON key order, stderr reports, placeholder wording after its TODO marker, lint message text.
- One ADR rule in the stability section (item 12): an ADR is required when an item of the stable list changes or a new machine-readable output is promised as stable; any other command change needs only the reference and a CHANGELOG entry.
- Move out of `docs/reference/02-cli.md`: the `status --json` and "What is stable" sections, the exit-code/glyph sentences of the intro (line 3), the JSON and exit sentences of the `gates` row (line 23), the JSON part of the `tracks` (24) and `seed --scan` (20) rows, the contract part of the `brief` row (19); leave one-line pointers. Add a row for page 04 to `docs/reference/README.md`.
- Links to the new page: one line in `README.md` § "For orchestrators" (replacing the pointer to 02-cli § What is stable), the contract-change line of `AGENTS.md` points at the stability section, a row for page 04 in `docs/reference/README.md`, and the `reference/` row of `docs/README.md` names it.

## Out of scope

- Changing any JSON shape, including unifying the two `dirty` shapes — that would be a versioned contract change with its own ADR.
- Code changes: the output channels were settled by BS-91 (`fold-journal-eol-and-order`), BS-125 (`report-channels-and-dry-run`) and BS-126 (`json-contract-nulls-total`).
- Translating or restructuring the rest of `docs/reference/02-cli.md` beyond the moved passages.
- Rewriting README.md or AGENTS.md beyond the pointer lines (their cards ran earlier).

## Verification

- `node bin/backslop.js lint; echo rc=$?` → rc=0 (links, ADR index).
- `npm test; echo rc=$?` → rc=0; report the pass count.
- In a fresh throwaway repo: `git init -q && node <repo>/bin/backslop.js init --lang en`, then run `status --json`, `gates --json`, `gates --json --dry-run`, `tracks --json`, `seed --scan --json`; for each output print the key sets with `node -e` and confirm every printed key is documented and every documented key appears (or is documented as absent in that case).
- `grep -nE 'ADR-[0-9]|BS-[0-9]' docs/reference/04-orchestrator-contract.md; echo rc=$?` → rc=1 (no matches).
- `grep -n 'status --json' docs/reference/02-cli.md` shows only pointer lines and table mentions, no JSON block.
