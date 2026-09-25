# BS-147 · One English ADR on merge-changelog replaces ADR-013, 024 and 030

- **Order:** 650
- **Scope:** [02. CLI](../../reference/02-cli.md) § merge-changelog
- **Created:** 2026-09-25
- **Dependencies:** BS-87, BS-105, BS-114

## Context

Three Russian ADRs describe `merge-changelog`: docs/adr/adr-013-changelog-merge.md, adr-024-changelog-merge-keeps-layout.md and adr-030-changelog-merge-untagged-version-section.md. ADR-013 keeps a superseded ordering sentence in its body, ADR-024 overstates the parse and names the wrong CHANGELOG versions, and all three carry commit hashes, task numbers and measurements. This card writes one English ADR, deletes the three files and removes the links to them, and fixes two wordings in the reference and the batch skill.

Line numbers below are at base commit 6f6318e (v0.11.0), where `npm test` passes 450 tests and `node bin/backslop.js lint` exits 0. The cards named under Dependencies change some of the cited code; read the code on the commit you start from and cite file:line from that commit, not from this card.

Dependencies change this topic: the BS-87 (`merge-changelog-structure-and-io`) card parses a subgroup only at column 0, places a theirs-only subgroup under its parent heading, keeps the EOL of --ours, refuses an empty `--base` and turns `--out` fs errors into refusals; the BS-105 (`dead-branches-markdown-journal`) card deletes the two unreachable self-checks (lib/merge-changelog.js:186-197, :213-217); the BS-114 (`changelog-section-parser`) card moves `splitSections`, the version rule and `CHANGELOG_ENTRY` into a shared leaf module. The ADR records the code after all three. As accepted, BS-87 also brings a heading ours lacks together with its subgroups, placed after the nearest preceding theirs container already in the result (the heading-less top group included). Heading-less content forms the top group of the section, and stderr names each placement in one of four forms: heading added before, heading added at the end of the section, subgroup added under, heading-less entries added at the start. An existing `--out` file keeps its own line endings.

**Rules to record** (verified — read at 6f6318e; `node --test --test-timeout=60000 test/merge-changelog.test.mjs` → rc=0, 31 pass):
- Command: `merge-changelog --ours <ref> --theirs <ref> [--base <ref>] [--out <file>]`, --ours and --theirs required (lib/merge-changelog.js:361-370); each revision is read with `git show <ref>:./CHANGELOG.md`, unreadable = refusal (:333-340).
- Unreleased section: the first `## ` section whose title has no version; if none, the top section when its version has no tag `vX.Y.Z` or `X.Y.Z` (:11-12, :48-52); same rule for --ours, --theirs and --base (:231, :237, :141-146); the command reads `git tag --list`, unreadable = refusal (:344-352); the library takes `released(version)` as fifth argument, default 'every version released' (:228).
- --ours without an unreleased section is a refusal naming both criteria (:232-236); --theirs without one is read as empty and the report says so (:239, :250, :384-386). Only the unreleased section is merged; header and other sections come from --ours (:324-328).
- Parse: a container is a `###`–`######` heading plus an optional bold subgroup line; a block is an entry `- **Title**` (`CHANGELOG_ENTRY`, shared with lint gate 7) or a top-level `-`/`*`/`+` bullet; other lines, blank lines included, belong to the preceding block (:15, :18, :21, :79-98).
- Identity: an entry by its title across the whole unreleased section; a plain bullet by its trimmed text (:100, :252-253).
- Layout from --ours: its containers and blocks in order with its blank lines; containers only --theirs has come after them (:262-289, :301-306, :318-320).
- Insertion of a theirs-only block: after the nearest preceding block of the same --theirs container that already sits in the same result container; otherwise first when that container shares any block with the result; otherwise last (:148-156, :307).
- Same title, same trimmed body → one entry; different bodies → a conflict pair: `<!-- backslop:conflict <title> -->`, the --ours block, a blank line, the --theirs block; the command never picks a winner (:104-113, :271-277).
- With --base a titled entry present in the base section and missing on one side is dropped and named; plain bullets are never dropped; without --base one-sided entries are kept and named (:280-285, :296-299, :393-413).
- A block repeated within one side keeps its first occurrence and every repeat is named (:117-127, :269, :294, :401-402).
- A conflict mark is a column-0 line starting `<!-- backslop:conflict`, counted only in the unreleased section (:23-27); a mark in the unreleased section of --ours or --theirs is a refusal before merging; --base is not checked (:240-248).
- Self-check before output, a violation is a refusal and nothing is written (:170-225, :322): a heading or subgroup line may not occur more often than on the side that has more of it (:174-184); an additive merge may not lose a non-blank --ours line, and the refusal names a repeated --ours block (:199-212).
- Output: the merged file to stdout or --out, the report always to stderr (:354-358, :378-408); `## ` titles are trimmed (:37, :326). Exit 1 when conflict marks remain, with their count, and --out is still written (:414-422).

**Text that must not carry over:**
- ADR-013:40 'entry order: --ours first, then the missing --theirs entries'. verified — the status line ADR-013:3 already records the supersession; repro (library, ours `### Added` X / `### Fixed` Common, theirs `### Added` Common, NewT, X) gives `### Added: NewT, X`. Only the insertion rule survives.
- ADR-024:35 'blocks concatenate to the original lines byte for byte' and :61 'released sections and header are carried as lines'. verified — `split(/\r?\n/)` (:34), trimmed titles (:37, :326), LF join (:329); repro: a CRLF CHANGELOG committed with `core.autocrlf=false` merged with itself → rc=0, `git diff --stat` 9 insertions, 9 deletions; `## v0.1.0 — 2026-01-01  ` comes out without the trailing spaces. After the BS-87 (`merge-changelog-structure-and-io`) card the output keeps the EOL of --ours; record that and the title trimming, not 'byte for byte'.
- ADR-024:63 and docs/reference/02-cli.md:28 place a theirs-only entry 'after the nearest preceding theirs entry already in the result'. verified — the code searches only the same container (:151-155); same repro puts NewT first in `### Added` although Common precedes it on theirs and sits under `### Fixed`.
- ADR-024:65 'a mark in an input revision is a refusal', same wording at 02-cli.md:28 and templates/en/skills/backslop-batch/SKILL.md:105. verified — the code checks --ours and --theirs only (:242); a mark in --base passes (library repro: no refusal, marks=0); ADR-024:67 limits marks to the merged section.
- ADR-024:67 names v0.7.0 and v0.10.0 as the CHANGELOG versions that mention the mark in prose; verified they are v0.5.0 (CHANGELOG.md:130) and v0.10.0 (:48). Drop the self-reference entirely.
- ADR-024:72 presents the entry-multiplicity check as live. verified — with title identity it cannot fire (fuzz of 200000 random sections: `{"entry":0,"lost":0,…}`); ADR-024:73 already calls the lost-line arm unreachable. The BS-105 (`dead-branches-markdown-journal`) card deletes both; list only the checks that remain.
- Artifacts to drop: ADR-013:9 (old help list), :11, :20, :31, :54 (task numbers, run date); ADR-024:11-20 (commit hashes, task number, measurement table), :84, :88; ADR-030:5 (run id, 'not proofread by the owner'), :13, :17-27, :63-66, :84-86, :97-98.

**How to write a consolidated ADR (applies to every ADR this card creates).** Create it with `node bin/backslop.js adr <slug> --title "<title>"` (the repository runs with `lang: en`, so the English template with Context / Options / Decision / Consequences is used and the number is the next free one; if another card takes the same number first, renumber on rebase: lint gate 8 refuses duplicate numbers). Header: `Status: Accepted`, `Date:` the day you write it, `Deciders: Velklish`. The text must not mention the numbers or file names of the ADRs it replaces, task or finding numbers, run ids, commit hashes, dated measurements or "owner decision of <date>" notes. Cite code by file and function name, not by line number (line numbers below are at base commit 6f6318e and only help you find the code). Options keeps only the rejected alternatives that still explain the choice, each with its cost in one sentence. Then delete the replaced ADR files and replace their rows in `docs/README.md` with one row for the new ADR (topic in English, Status equal to the Status line of the file; keep the table's current column layout). Every remaining reference to a deleted file is handled in the same card: links in `CHANGELOG.md` lose their link markup and old ADR tokens (the CHANGELOG rewrite drops them anyway); links and citations in `docs/reference/`, `docs/GLOSSARY.md` and `AGENTS.md` are dropped, not repointed (rules there carry no ADR citations); code and test comments that cite an old ADR get the new ADR id (`ADR-NNN`) and lose quoted section names the new ADR does not have — comments stay at most two lines and 100 code points per line (`npm test` enforces it).

**Links at 6f6318e** (`git grep -n -i -E 'adr-0(13|24|30)'`): CHANGELOG.md:24, :48, :130; docs/README.md:24, :35, :41; docs/reference/02-cli.md:28 (ADR-030 and ADR-024); comments lib/merge-changelog.js:2, :47, :70, :149, :171. README, AGENTS.md, templates and tests: none. The three files link only each other.

## Work to do

- Create the ADR: `node bin/backslop.js adr changelog-merge --title "merge-changelog merges the unreleased section structurally and refuses rather than guess"`. Context: every parallel worker edits CHANGELOG.md; `-X ours`/`-X theirs` drop a neighbour's entries or duplicate hunks; a merge driver needs per-clone git config; the merge must be reproducible in any clone, never pick a winner, keep the author's layout so the diff shows only additions, and report through its exit code; a version bump before work leaves the top section untagged.
- Decision: one bullet per rule of 'Rules to record', checked against current code (after the dependency cards: column-0 subgroups, subgroup placement under its heading, EOL of --ours, empty `--base` refused, `--out` errors as refusals, two unreachable checks gone, shared section parser).
- Options, one line each: git merge strategies `-X ours/theirs` (drop hunks silently); a git merge driver (per-clone config); ordering 'ours first, then theirs' (loses the author's position); a sum bound across sides for the entry count (never fires).
- Consequences: a conflict pair duplicates a title, so lint gate 7 stays red until one revision is kept and the mark removed, exit code 1 meanwhile; callers handle refusals with no file (--out untouched); the result depends on the tags in the clone — a clone without the release tag treats the released top section as unreleased and the report line says so (`git fetch --tags`); after a bump entries merge into the bumped section until a heading without a version is added above it on --ours; when only --theirs carries the bump the title comes from --ours and gate 11 flags the missing section in this repository; the same subgroup added under different headings on each side is refused and merged by hand; the parse must stay the exact inverse of the assembly or the additive check fails.
- `git rm` docs/adr/adr-013-changelog-merge.md, adr-024-changelog-merge-keeps-layout.md, adr-030-changelog-merge-untagged-version-section.md.
- docs/README.md: replace rows 24, 35, 41 with one English row `| [adr/adr-NNN-changelog-merge.md](adr/adr-NNN-changelog-merge.md) | <H1 title> | Accepted |`.
- docs/reference/02-cli.md:28: delete the two ADR citations; reword the insertion sentence to the container-scoped rule above and the mark sentence to 'a mark in the unreleased section of --ours or --theirs'.
- templates/en/skills/backslop-batch/SKILL.md:105 and the matching sentence of templates/skills/backslop-batch/SKILL.md: 'an unresolved mark in an input revision' → 'an unresolved mark in the unreleased section of --ours or --theirs' (same meaning in each language); keep placeholders unchanged so template parity stays green.
- CHANGELOG.md:24, :48, :130: delete the ADR links and ids, keep the rest of each entry.
- Comments lib/merge-changelog.js:2, :47, :70, :149, :171 (those that still exist): replace the old id with the new ADR id; keep each comment within two lines of 100 characters.
- After deleting, run `git grep -n -e adr-013-changelog-merge -e adr-024-changelog-merge-keeps-layout -e adr-030-changelog-merge-untagged-version-section -- '*.md'`: every hit in an older ADR file that still exists (another cluster not consolidated yet) gets its link target repointed to the new ADR file, and its link text to the new ADR id; lint gate 1 walks docs/** and root *.md and turns red on a link to a deleted file.

## Out of scope

- Code changes to merge-changelog — the four dependency cards.
- Rewriting CHANGELOG.md content beyond removing the ADR links (the BS-175 (`changelog-compress-english`) card).
- A CHANGELOG entry: nothing user-visible changes.

## Verification

- `node bin/backslop.js lint; echo rc=$?` → rc=0.
- `npm test; echo rc=$?` → rc=0; report the pass count.
- `git grep -n -i -E 'adr-0(13|24|30)' -- . ':!docs/archive/LOG.md'; echo rc=$?` → no output, rc=1.
- `grep -o -E 'ADR-[0-9]{3}' docs/adr/adr-NNN-changelog-merge.md | sort -u` → only `ADR-NNN`; `grep -n -E 'BS-[0-9]|byte for byte|v0\.7\.0' docs/adr/adr-NNN-changelog-merge.md` → no output.
- `grep -n 'input revision' templates/en/skills/backslop-batch/SKILL.md docs/reference/02-cli.md; echo rc=$?` → no output, rc=1.
