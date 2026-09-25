# BS-110 · Leaf lib/text.js for line splitting; init blocks and adapter outputs keep line endings

- **Order:** 280
- **Scope:** [Reference](../../reference/README.md)
- **Created:** 2026-09-25
- **Dependencies:** BS-109, BS-91, BS-87, BS-85

## Context

Line splitting and end-of-line (EOL) preservation are handled differently at each site. `tasks.splitLines` and `tasks.eolOf` exist, but other parsers split by hand. Writers insert LF into files that use CRLF, and adapter outputs come out mixed when the tool's own checkout is CRLF. This matters on Windows checkouts with `core.autocrlf=true`.

Repro commands below run in an empty scratch directory with `B() { node "$BACKSLOP/bin/backslop.js" "$@"; }`, where `$BACKSLOP` is this repository's checkout; projects are created with `git init -q -b main && B init --tools none --lang en`.

**1. Line splitting** — verified — sites read at base. The two strip variants were compared with `splitLines` on sample inputs.
- `tasks.splitLines` (lib/tasks.js:362-364) is `text.split(/\r?\n/)`.
- lib/links.js:68-69 and lib/lint.js:533-534 do `split('\n')` and then strip one trailing `\r`. They match `splitLines` except for a final bare `x\r` with no `\n`: `["x"]` versus `["x\r"]`.
- Bare `split('\n')` is used at lib/lint.js:108, lib/lint.js:188, lib/upgrade.js:67, lib/seed.js:187 and lib/status.js:44. These only feed unanchored regexes or `trim()`, so a leftover `\r` is harmless there today.
- An inline `/\r?\n/` is used at lib/changelog.js:16, lib/merge-changelog.js:34, lib/log.js:151, :159, :184, :194 and :205, and lib/seed.js:247.
- The helper cannot stay in tasks.js, because tasks.js imports log.js and links.js and that would create a cycle. It needs a leaf module.

**2. EOL preservation** — verified — the init repro rerun at base.
- Edits in tasks.js keep CRLF through `eolOf` (lib/tasks.js:346-347 and its uses at :414, :444, :486).
- `init.upsertBlock` (lib/init.js:280-303, separators at :288 and :301) always inserts `\n`.
- Repro init: `printf 'Intro\r\nline\r\n' > AGENTS.md && B init --tools none --lang en` → rc=0. AGENTS.md then has 2 CRLF lines out of 22.

**Which behaviour wins.** The EOL of the existing file, as `eolOf` reports it, wins. A new file gets LF.

**3. More writers and splitters.**
- **init appends its AGENTS.md and .gitignore blocks with LF.** verified — a CLI run: `printf '# Project\r\n\r\nOwn rules\r\n' > AGENTS.md; printf 'node_modules\r\n' > .gitignore; node $B init --lang en --tools claude` gives rc=0, then AGENTS.md has 3 CRLF lines out of 23 and .gitignore has 1 out of 6. A rerun gives the same counts. `upsertBlock` (init.js:286-303) writes the block and its separators with `\n` in both the replace branch (:295) and the append branch (:300-301).
- **Adapter generation assumes LF templates.** verified — a CLI run for cursor and a probe for markGenerated. In a clone of the tool with `templates/en/skills/backslop-batch/SKILL.md` converted to CRLF (`perl -pi -e 's/\n/\r\n/'`, which is what a Windows autocrlf checkout of the tool produces; the repo has no .gitattributes), `init --lang en --tools cursor` gives rc=0 and `.cursor/rules/backslop-batch.mdc` has 111 CRLF lines out of 117, with LF frontmatter. cursorOutput (adapters.js:95) writes `---\ndescription: …`. `markGenerated` (adapter-ownership.js:44-45) inserts the marker plus `\n` into CRLF text: the probe `markGenerated('---\r\nname: x\r\n---\r\nbody\r\n')` returns `---\r\nname: x\r\n---\r\n<!-- backslop:generated -->\nbody\r\n`. These outputs are whole files the tool owns, so the fix is LF input: normalize at the one template reader, not a per-writer `eolOf`.
- **lint splits lines three ways.** verified — `grep -n "split('\\\\n')\|splitLines\|endsWith('\\\\r')" lib/lint.js`: `splitLines` at :318, :382, :630, :662; bare `split('\n')` at :108 and :188; a manual `\r` strip at :533-534. It produces no wrong output today because the pin regexes stop before `\r`. This is consistency only.

The fold journal EOL (lib/fold.js:75) is fixed by BS-91 (`fold-journal-eol-and-order`) and the CHANGELOG EOL of `merge-changelog` by BS-87 (`merge-changelog-structure-and-io`); this card only moves `eolOf` under them. This card owns the `upsertBlock` EOL finding (item 2).

## Work to do

- Create lib/text.js with no lib imports. Move `splitLines` and `eolOf` from lib/tasks.js into it and point every importer at the new module.
- Use `splitLines` at lib/links.js:68-69, lib/lint.js:533-534 (delete the manual `\r` strip at :534), lib/lint.js:108 and :188, lib/upgrade.js:67, lib/seed.js:187 and :247, lib/status.js:44, lib/changelog.js:16, lib/merge-changelog.js:34, and lib/log.js:151, :159, :184, :194, :205. Check that no caller depends on the bare `x\r` edge case.
- `init.upsertBlock` (lib/init.js:280-303): take `eol = eolOf(existing)`, using LF for a new file, and convert both the separators and the block (`block.replace(/\r?\n/g, eol)`) in both the replace branch (:295) and the append branch (:300-301). This covers the AGENTS.md block and the .gitignore block.
- lib/templates.js `renderTemplate` (:27-28): normalize the text read from disk with `.replace(/\r\n/g, '\n')` before substitution, so `markGenerated` and `cursorOutput` receive LF text and neither needs to change (adapter outputs are whole files the tool owns).
- Leave the splits of git stdout in lib/lint.js (:497, :501) alone.
- Add a CHANGELOG entry under the unreleased section: `init` keeps a CRLF AGENTS.md and .gitignore CRLF; adapter outputs are LF even when the tool's checkout is CRLF.

## Out of scope

- BOM handling in `readText`/`writeText`.
- The fold journal and merge-changelog EOL fixes.
- Adding a .gitattributes file (the code-side normalization makes it unnecessary).

## Verification

- New test in test/init.test.mjs: `init` on a CRLF AGENTS.md and a CRLF .gitignore leaves every line of both files CRLF. The existing LF fixtures stay LF.
- New test in test/init.test.mjs: use the tool-copy helper in test/helpers.mjs, convert `templates/en/skills/backslop-batch/SKILL.md` to CRLF in the copy, run `init --lang en --tools cursor`; the resulting `.cursor/rules/backslop-batch.mdc` contains no `\r`. A rerun of `init` on the CRLF AGENTS.md leaves it byte-identical.
- Rerun the init repro from the context: `22 of 22` CRLF lines after `init`.
- A grep over lib/ for an inline `split(/\r?\n/)` → only lib/text.js.
- `npm test`: every test passes. `node bin/backslop.js lint` → rc=0.
