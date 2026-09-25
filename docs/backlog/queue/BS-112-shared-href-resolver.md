# BS-112 · mv, archive and fold link rewrites resolve hrefs through the shared link helpers

- **Order:** 300
- **Scope:** [02. CLI](../../reference/02-cli.md) § mv
- **Created:** 2026-09-25
- **Dependencies:** BS-89, BS-105

## Context

The BS-89 (`link-gate-target-resolution`) card added `splitHref` and `normalizeHrefTarget` to lib/links.js and moved gates 1, 8, 13 and `seed --queue-reference` onto them: cut at the first `#` or `?`, `decodeURI` inside try/catch (a URIError means "cannot resolve", never a throw), `/x` from the project root. The link rewrites of `mv`, `archive` and `fold` still carry their own copies of the prologue and never decode, so a percent-encoded link is left pointing at the old directory.

Repro commands below run in an empty scratch directory with `B() { node "$BACKSLOP/bin/backslop.js" "$@"; }`, where `$BACKSLOP` is this repository's checkout; projects are created with `git init -q -b main && B init --tools none --lang en`.

**1. The link-rewrite prologue is duplicated, and no rewrite decodes** — verified — repro C rerun at base.
- `rewriteFoldedLinks` (lib/links.js:190-194) and `rewriteIncomingLinks` (lib/links.js:215-219) repeat the same cut → rooted → `path.posix.normalize` steps. `rewriteFoldedLinks` also strips a trailing `/`.
- `rewriteMovedLinks` (lib/links.js:204-207) and `adapters.rewriteCursorLinks` (lib/adapters.js:71-79) share the same normalize → relative → compare core.
- None of these rewrites decodes, while `resolveTarget` does.
- Repro C:
  - `B init --tools none --lang en --dir "my docs"`, then `B new link-probe`.
  - README.md: `[encoded](my%20docs/backlog/triage/BS-1-link-probe.md) and [angled](<my docs/backlog/triage/BS-1-link-probe.md>)`.
  - `B lint` → `✔ lint: no errors`.
  - `B mv 1 queue` → rc=0 and prints `task links updated: README.md`, but only the angled link now points to `queue/`.
  - `B lint` → `✖ README.md: broken link my%20docs/backlog/triage/BS-1-link-probe.md`, rc=1.

**Which behaviour wins.** The gate-1 rule of the shared helpers. A second helper variant must not appear.

## Work to do

- Rebuild `rewriteFoldedLinks` (lib/links.js:188-197) and `rewriteIncomingLinks` (lib/links.js:213-222) on the shared `splitHref` + `normalizeHrefTarget` and compare decoded paths. Emit a rewrite only when the decoded target actually changes. Re-encode the new path with `encodeURI` only when the original href differed from its decoded form. Leave an undecodable href untouched. Behaviour change: `mv`, `archive` and `fold` now rewrite percent-encoded links.
- Extract the rebase core shared by `rewriteMovedLinks` (lib/links.js:204-207) and `adapters.rewriteCursorLinks` (lib/adapters.js:71-79): normalize from the source dir, make it relative to the output dir, return null when unchanged. If decoding is applied here, a link whose target differs only in encoding must not be rewritten. Package templates carry no encoded links, so decoding in `rewriteCursorLinks` is optional.
- Docs in the same change: the link-rewrite text of `mv`, `archive` and `fold` in docs/reference/02-cli.md states the same href rule as gate 1. Add a CHANGELOG entry under the unreleased section: `mv`, `archive` and `fold` now rewrite percent-encoded links.

## Out of scope

- Line splitting inside lib/links.js (handled by the BS-110 (`text-lines-eol-module`) card).
- Recognising new link syntaxes. The set of forms (inline, reference-style, angled) stays as it is.
- Gate 1's BOM and first-line handling of `brokenLinks`/`directoryLinks` input (fixed by the BS-89 (`link-gate-target-resolution`) card).
- The gate side of the href rule (gates 1, 8, 13, seed) — done by the BS-89 (`link-gate-target-resolution`) card.

## Verification

- New command test (repro C): after `mv 1 queue`, the `%20` link points to `queue/` and stays percent-encoded, and `lint` exits 0.
- New unit test in test/links.test.mjs: `rewriteMovedLinks` with `fromDir === toDir` returns the text unchanged for `a%20b.md`, so encoding alone never triggers a rewrite.
- Rerun repro C from the context: `lint` rc=0 after `mv`.
- `npm test`: every test passes. `node bin/backslop.js lint` → rc=0.
