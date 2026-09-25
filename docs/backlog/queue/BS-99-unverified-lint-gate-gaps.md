# BS-99 · Check and fix: journal pins, monorepo root links, malformed quote markers, [TODO] forms

- **Order:** 170
- **Scope:** [03. Lint gates](../../reference/03-lint.md)
- **Created:** 2026-09-25
- **Dependencies:** BS-89, BS-95, BS-84

## Context

Every item in this card is **unverified — run the check first**. The behaviour was observed once on 6f6318e; it has not been reproduced independently, and nobody has checked yet whether a doc, ADR or test sanctions it. Work each item in order: (1) reproduce blind in a throwaway project with the exact commands, (2) look for a doc, ADR or test that sanctions the behaviour, (3) fix only if (1) reproduces and (2) finds no sanction. Record the outcome of each step in the result (reproduced / not reproduced / sanctioned by <file:line>). Line numbers refer to base commit 6f6318e (v0.11.0). `$BS` is `node <repo>/bin/backslop.js`; throwaway projects start with `git init -q -b main && $BS init --lang en --tools none` unless stated otherwise. Where an ADR is cited, the path is the one at 6f6318e; the ADR consolidation cards run later in the queue.

Module: lint gates (lib/lint.js, lib/mdwalk.js, lib/links.js).

- **Journal lines count as live prose for pins** — unverified — run the check first. Observed: lib/mdwalk.js:100 `const archive = new RegExp(`^${esc(docs)}/archive/${esc(prefix)}-\\d`)` excludes only task directories, so docs/archive/LOG.md stays in `liveMarkdown`; a probe listed `docs/archive/LOG.md` and `docs/archive/README.md` as live archive files and lint reported `docs/archive/LOG.md: line 3: pin github:Velklish/backslop#v0.1.0 differs from cli …` for a journal title quoting an old pin, while the same text in docs/archive/BS-6-y/task.md was not reported. The comment at lib/mdwalk.js:96-97 excludes records of a moment (archive, cards). Note: the LOG.md template header renders `{{cli}}` (templates/en/docs/archive/LOG.md:3), so the header must stay live.
- **Root-relative links in a monorepo subproject** — unverified — run the check first. Observed: lib/links.js:106-107 joins a leading `/` onto the project root (backslop.json directory), lib/lint.js:477 and :606 do the same; GitHub/GitLab resolve `/` against the repository root, so in `mono/pkg/a` the renderer-valid `/pkg/a/docs/README.md` was reported broken and `/docs/README.md` passed. docs/reference/03-lint.md:34 documents project-root resolution as the design.
- **Gate 10 misses a quote marker with a space and a stray closer** — unverified — run the check first. Observed: lib/lint.js:29 `QUOTE_OPEN = /^\s*<!--\s*quote:(?:(before):)?(\S+?)\s*-->\s*$/` requires `\S` right after `quote:`; `quoteBlocks` (lib/lint.js:642) handles `QUOTE_CLOSE` only when a block is open, so an unmatched `<!-- /quote -->` is ignored. A spaced marker whose body no longer matches the file passed lint rc=0.
- **Gate 4 misses `[TODO]` in numbered items, task-list boxes and table cells** — unverified — run the check first. Observed: lib/lint.js:386 `line.trim().replace(/^>\s*/, '').replace(/^[-*+]\s+/, '').trim()` strips only `-`/`*`/`+` markers before testing `TODO_VALUE`/`TODO_FIELD` (lib/lint.js:21-24); in a queue card `1. [TODO]`, `2. [TODO: command]`, `- [ ] [TODO]` and `| [TODO] | [TODO] |` were not reported while `- [TODO]` was.

## Work to do

- [ ] Journal lines and pins (lib/mdwalk.js, lib/lint.js, lib/upgrade.js)
    1. Blind repro: `printf '\n- <a id="bs-6"></a>`BS-6-y` · 2026-09-01 · completed · — · Measured with `npx github:Velklish/backslop#v0.1.0 lint`\n' >> docs/archive/LOG.md; $BS lint; echo rc=$?` — expected wrong output: rc=1 with `✖ docs/archive/LOG.md: line N: pin github:Velklish/backslop#v0.1.0 differs from cli — expected github:Velklish/backslop#v0.11.0; … upgrade rewrites it` for the journal line.
    2. Refutation check: docs/reference/03-lint.md (pin gate row) and the live-pins ADR (docs/adr/adr-019-live-pins-and-findings.md at 6f6318e): if they name docs/archive/LOG.md as live as a whole, the behaviour is sanctioned — record it and stop; if they call journal lines records of a moment (as lib/mdwalk.js:96-97 does for the archive), confirmed.
    3. Fix only if confirmed: exempt journal lines (the `- <a id="…"></a>` line form parsed by lib/log.js) from the pin gate and from `rewriteProsePins`, keep the LOG.md header live; test: old pin in a journal title → lint rc=0 and `upgrade` leaves the line; old pin in the header → still reported and rewritten.
- [ ] Root-relative links in a monorepo subproject (lib/links.js, lib/lint.js)
    1. Blind repro: `mkdir -p mono/pkg/a && cd mono && git init -q -b main && cd pkg/a && $BS init --lang en --tools none && printf '[a](/pkg/a/docs/README.md)\n[b](/docs/README.md)\n' > docs/note.md && $BS lint; echo rc=$?` — expected wrong output: rc=1 `✖ docs/note.md: broken link /pkg/a/docs/README.md`, and `/docs/README.md` not reported.
    2. Owner decision: root-relative links `/…` resolve from the repository root, as GitHub and GitLab render them, also inside a monorepo subproject. docs/reference/03-lint.md:34, which resolves root paths `/docs/…` from the project root, describes the behaviour this item fixes; it is not a sanction.
    3. Fix only if step 1 reproduces: resolve `/…` against `git rev-parse --show-toplevel` when the project is inside a repository (fallback: project root) in `brokenLinks`, gates 8/13 and the `mv`/`archive` rewrite of incoming root links; rewrite every statement of the root-link rule in docs/reference/03-lint.md (the gate 1, 8 and 13 rows and the sentence at :34): root paths resolve from the repository root (from the project root outside a repository); test in a monorepo fixture.
- [ ] Malformed quote markers (lib/lint.js gate 10)
    1. Blind repro: `printf '# Q\n\n<!-- quote: reference/README.md -->\n\nnot the text\n\n<!-- /quote -->\n\n<!-- /quote -->\n' > docs/q.md; $BS lint; echo rc=$?` — expected wrong output: rc=0 `✔ lint: no errors`. Control: the same file with `quote:reference/README.md` (no space) → rc=1 `quote no longer matches reference/README.md: “not the text”`.
    2. Refutation check: docs/reference/03-lint.md row 10 and the quote section of docs/backlog/README.md (rules template): if either defines the spaced form as not-a-quote or says a stray closer is ignored, record the sanction and stop.
    3. Fix only if confirmed: accept optional whitespace after `quote:` and `before:`; report any line matching `/<!--\s*\/?quote\b/` that does not parse, and an unmatched `<!-- /quote -->`; tests in test/lint.test.mjs for the spaced opener and the stray closer.
- [ ] `[TODO]` forms in cards (lib/lint.js gate 4)
    1. Blind repro: `$BS new a --queue --title A; printf '\n1. [TODO]\n2. [TODO: command]\n- [ ] [TODO]\n\n| a | b |\n|---|---|\n| [TODO] | [TODO] |\n' >> docs/backlog/queue/BS-1-a.md; grep -n 'TODO' docs/backlog/queue/BS-1-a.md; $BS lint 2>&1 | grep placeholder` — expected wrong output: the appended numbered, checkbox and table lines have no `line N: the [TODO] placeholder remains` entry while the template `- [TODO]` lines do.
    2. Refutation check: docs/reference/03-lint.md gate-4 row and the comments at lib/lint.js:21-24: if they restrict the gate to bullet items and field values on purpose, record the sanction and stop.
    3. Fix only if confirmed: also strip `^\d+[.)]\s+` and `^\[[ xX]\]\s+` before the test, and test each table cell separately; tests for each form.

## Out of scope

- Verified link-gate and walker bugs — the BS-89 (`link-gate-target-resolution`) and BS-95 (`lint-walk-and-gate-coverage`) cards.

## Verification

- For each item the result names the outcome of steps 1–2 with the command output and rc (item 2: step 1 only; its step 2 is the owner decision).
- Each confirmed item has a red-then-green test in test/lint.test.mjs (or test/links.test.mjs); a sanctioned item (items 1, 3 and 4 only) has no code change.
- Item 2 after the fix: the step-1 monorepo repro gives rc=1 with `✖ docs/note.md: broken link /docs/README.md` and no error for `/pkg/a/docs/README.md`; docs/reference/03-lint.md says root paths resolve from the repository root.
- `npm test` → rc=0; `node bin/backslop.js lint` → rc=0.
