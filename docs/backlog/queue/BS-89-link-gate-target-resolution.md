# BS-89 · Link gates and seed: one href normaliser, exact-case targets, CommonMark forms, BOM

- **Order:** 70
- **Scope:** [03. Lint gates](../../reference/03-lint.md) § gate 1
- **Created:** 2026-09-25
- **Dependencies:** none

## Context

Line numbers refer to base commit 6f6318e (v0.11.0). `$BS` below is `node <repo>/bin/backslop.js`; throwaway projects are created with `git init -q && $BS init --lang en --tools none` unless stated otherwise.

Six verified bugs in how lib/links.js and the gates built on it turn an href into a target, plus one in the link rewrite of `mv`/`archive`.

**1. Major — gates 8 and 13 parse hrefs with their own logic.** verified — reproduced on 6f6318e.
- ADR row href in docs/README.md changed to `adr/adr-001-process.md?plain=1`, `/docs/adr/adr-001-process.md` or `adr/adr-001-process%2Emd` → `$BS lint` rc=1 `✖ docs/adr/adr-001-process.md: no row in README.md — the ADR table is maintained manually`, while the same hrefs in docs/note.md pass gate 1 (rc=0). Gate 13: `[b](archive/LOG.md?plain=1#bs-99)` and `LOG%2Emd#bs-9` pass although the anchor does not exist; `archive/LOG.md#bs-99` is reported.
- Root cause: lib/lint.js:566-567 `path.resolve(readmeDir, href.split('#')[0])` (a leading `/` becomes the filesystem root, `?query` is kept, no `decodeURI`) and lib/lint.js:474-478 (same for the journal anchor), whereas `brokenLinks` (lib/links.js:91, :105-109) strips `[#?]`, decodes and joins root paths onto the project root. lib/links.js:86-87 and test/links.test.mjs:174 define the query and root forms as valid. `seed --queue-reference` has the same defect: lib/seed.js:191-193 cuts with `href.split('#')[0]`, keeps `?query` and never decodes, so a `?query` row does not find its existing reference file. Gate 13 also skips `[gone2](docs/archive/LOG.md?plain=1#bs-99)` without a message while it reports the plain `docs/archive/LOG.md#bs-99`.

**2. Medium — a link whose target differs only in letter case passes on macOS/Windows.** verified — reproduced on 6f6318e on default APFS (case-insensitive) and on a case-sensitive APFS image.
- `[overview](reference/readme.md)` while git tracks `docs/reference/README.md` → `lint` rc=0 on APFS; `git ls-files --error-unmatch docs/reference/readme.md` → rc=1; on the case-sensitive volume `lint` rc=1 `broken link`. Links `docs/Roadmap.md`, `DOCS/GLOSSARY.md`, `docs/ADR/` behave the same.
- Root cause: lib/links.js:100 decides with `existsSync(resolved)` of the path built at lib/links.js:105-109. docs/reference/03-lint.md:7 describes gate 1 without a platform caveat; Linux CI and web renderers resolve case-sensitively.

**3. Low — a bare destination is cut at the first `)`.** verified — reproduced on 6f6318e.
- `docs/reference/foo(1).md` exists; `[foo](reference/foo(1).md)` in docs/README.md → rc=1 `broken link reference/foo(1`; `[foo](<reference/foo(1).md>)` passes.
- Root cause: `INLINE_LINK` bare branch `([^\s)]+)` at lib/links.js:8 (same branch in `LINK_PARTS`, lib/links.js:147). CommonMark allows balanced parentheses in a bare destination.

**4. Medium — a leading BOM hides first-line reference definitions and, with a first-line fence, every link in the file.** verified — reproduced on 6f6318e.
- `printf '\xEF\xBB\xBF[missing]: reference/nope.md\n' > docs/NOTE.md` → rc=0; without BOM → rc=1 `broken link reference/nope.md`. `printf '\xEF\xBB\xBF```\nexample\n```\n\nSee [missing](reference/nope.md).\n' > docs/NOTE.md` → rc=0 (the closing fence opens a block to EOF); without BOM → rc=1.
- Root cause: `brokenLinks`/`directoryLinks` read with `readFileSync(file, 'utf8')` (lib/links.js:90, :114); the `^`-anchored `REF_DEFINITION` (:12) and `FENCE_OPEN` (:27) miss line 1. Every other gate reads through `readText` (lib/tasks.js:348-351), which strips U+FEFF.

**5. Minor — every scheme except lowercase `http(s):`/`mailto:` is treated as a relative path.** verified — reproduced on 6f6318e.
- `[ftp](ftp://host/f.txt) [file](file:///etc/hosts) [tel](tel:+123) [up](HTTPS://example.com) [proto](//cdn.example.com/a.png)` in docs/note.md or a root *.md → rc=1 with five `broken link` lines.
- Root cause: lib/links.js:83 `hrefs.filter((href) => href && !/^(https?:|mailto:|#)/.test(href))`, same list at :21 (`EXTERNAL`) and :118 (`isDir`). The comment at lib/links.js:19-20 says external addresses are excluded. The exported `EXTERNAL = /^(https?:|mailto:|#)/` (lib/links.js:21, used once at :156) is retyped inline at lib/links.js:83 and lib/seed.js:191, and :118 uses a subset without `#`; widening one copy leaves the others behind.

**6. Low — `mv`/`archive` rewrite a card's link to itself to the old directory.** verified — reproduced on 6f6318e.
- Card docs/backlog/triage/BS-1-a.md containing `[self](BS-1-a.md#context)`: `mv 1 queue` → `../triage/BS-1-a.md#context`, `lint` rc=1 `broken link`; `archive 1` → `../../backlog/triage/BS-1-a.md#context` in docs/archive/BS-1-a/task.md.
- Root cause: lib/tasks.js:598 `rewriteMovedLinks(before, dirname(task.rel), dirname(newRel))` re-bases every relative target (lib/links.js:203-209) without special-casing the moved file itself; lib/tasks.js:605 skips `newRel`/`task.rel` in the incoming pass. docs/reference/02-cli.md:13 promises outgoing links are recalculated for the new directory.

## Work to do

- Bug 1: add two helpers to lib/links.js and use them everywhere an href becomes a target: `splitHref(href) -> { target, rest }` (cut at the first `#` or `?`, the `href.search(/[#?]/)` form of lib/links.js:178) and `normalizeHrefTarget(fromDirPosix, target) -> repo-relative posix path | null` (`decodeURI` in try/catch, null on URIError; a leading `/` resolves from the project root; otherwise `path.posix.normalize(path.posix.join(fromDir, target))`). Rebuild `brokenLinks`, `directoryLinks` and `resolveTarget` (lib/links.js:88-125) on them without changing gate-1 output (a malformed `%`-escape is still a broken link). Gate 8 (lib/lint.js:565-569) compares the normalised paths; gate 13 (lib/lint.js:474-478) takes the anchor from `rest` after `#` and resolves the target the same way; `seed --queue-reference` (lib/seed.js:191-193) uses the same split and resolution. No second variant of the rule may remain.
- Bug 2: after `existsSync`, verify the exact spelling of each path component against `readdirSync` of its parent (cache per directory); report `link target differs in case: <real name>` as a gate-1 error.
- Bug 3: use a balanced-parentheses bare destination in `INLINE_LINK` and `LINK_PARTS`: `((?:[^\s()]|\([^\s()]*\))+)` instead of `([^\s)]+)`.
- Bug 4: read markdown in `brokenLinks` and `directoryLinks` through `readText` (BOM stripped).
- Bug 5: one shared external-href predicate — `/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//') || href.startsWith('#')` — exported as `EXTERNAL` (lib/links.js:21) and used by `relativeLinks` (:83), `isDir` (:118) and lib/seed.js:191; no inline copy remains.
- Bug 6: in `relocateTask`, map a target whose normalised path equals the moved file (`task.rel`) to the new basename relative to the new directory (`task.md` for `archive`) before the generic rewrite.
- Docs in the same change: the gate 1, 8 and 13 rows of docs/reference/03-lint.md state one href rule (cut at `#`/`?`, decoded, `/` from the project root); add a CHANGELOG entry under the unreleased section naming the behaviour changes (root-absolute and `?query` ADR rows count for gate 8, gate 13 checks anchors behind `?query`, other schemes are external, case-only mismatches are errors).
- Add the regression tests listed under Verification to test/links.test.mjs, test/lint.test.mjs and the mv/archive tests.

## Out of scope

- Resolving root-relative `/…` links against the git toplevel in a monorepo — the BS-99 (`unverified-lint-gate-gaps`) card.
- Walker coverage (symlinked root files, `.MD` extension) — the BS-95 (`lint-walk-and-gate-coverage`) card.
- Decoding inside the link rewrites of `mv`, `archive` and `fold` — the BS-112 (`shared-href-resolver`) card rebuilds them on these helpers.

## Verification

- New tests (bug 1): docs/README.md linking the ADR as `/docs/adr/adr-001-process.md`, `adr/adr-001-process.md?plain=1` and `adr/adr-001-process%2Emd` → gate 8 green; `archive/LOG.md?plain=1#bs-99` with no such anchor → gate 13 error; a link with a malformed escape (`a%E0%A4%A.md`) → a gate 1 error and no throw from gate 13; `seed --queue-reference` with a `(section.md?plain=1)` row whose file exists creates no task.
- New test (bug 2): link `reference/readme.md` to a tracked `reference/README.md` → rc=1 with the case message on any filesystem.
- New tests (bugs 3–5): `foo(1).md` bare link green when the file exists; BOM fixtures for the first-line reference definition and the first-line fence → broken link reported; `ftp:`, `file:`, `tel:`, `HTTPS:`, `//host/` hrefs not reported.
- New test (bug 6): card with a self-link, `mv 1 queue` and `archive 1` → the link still resolves; `lint` rc=0.
- `npm test` → rc=0; `node bin/backslop.js lint` → rc=0.
