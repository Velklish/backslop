# BS-220 · Preserve fenced Markdown content during changelog merges

- **Order:** 535
- **Scope:** [merge-changelog](../../reference/02-cli.md#merge-changelog)
- **Created:** 2026-10-03
- **Dependencies:** none
- **Cost:** critical

## Context

Found during BS-178 (third round of edge-case correctness testing).

Reproduced by the finder 2/2 in fresh projects; blind reproduction from this card's text alone by an independent verifier (worker:v178, claude-sonnet-5-5, 2026-10-03): reproduced 2/2 (exit 0, entries: ours 1, theirs 2, merged 2; output ends at an open fence).

The shared section parser in `lib/changelog-format.js:46-50` treats a `##` line inside a fenced Markdown example as a real section boundary. `merge-changelog` then drops the remainder of the theirs-only example and a later real unreleased entry, exits 0, and writes an unterminated fence. This loses content in the merged output; the source git revisions remain intact. Cost is critical because a normal conflict-resolution step silently drops content and reports success; recoverability from source revisions does not lower that cost.

Evidence: `sh repro/changelog-fence.sh`, twice in fresh repositories, invokes `node <worktree>/bin/backslop.js merge-changelog --ours ours --theirs theirs --base base --out merged.md`. Both runs exit 0 and report `entries: ours 1, theirs 2, merged 2`; the source has three real entries. The output ends with the opening code fence of the Guide entry; Example heading, its closing fence, and the Added entry are absent. Full commands, output and exit codes are in `repro/evidence/changelog-fence-1.txt` and `changelog-fence-2.txt`.

Counter-argument checked: ADR-043 defines sections by `##` and promises only the unreleased section is merged. Its Parse paragraph also explicitly describes raw line patterns, so changing how fenced lines are classified needs that decision clarified. The input is an ordinary fenced example within an entry; there is no documented ban on examples. Silently truncating a supported Markdown file is the problem. File this as a full format-decision card, not an assumption that the parser can simply discard code blocks.

Deduplication: searched `docs/backlog/` and `docs/archive/LOG.md` for merge-changelog, fenced headings and changelog fences. No open card covers this. BS-95 made lint gate 7 fence-aware; this is a separate shared-parser/merge path, not a claim that the same fix regressed.

### Self-contained reproduction

Run this POSIX shell snippet with Node and git installed. Export BACKSLOP_SOURCE as the absolute path to a backslop checkout. It builds a fresh project under TMPDIR, or /tmp when unset; no previous script or fixture is needed.

````sh
#!/bin/sh
set -eu
BS_REPRO_CLI="${BACKSLOP_SOURCE:?set BACKSLOP_SOURCE to a backslop checkout}/bin/backslop.js"
BS_REPRO_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/bs-card.XXXXXX")
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=QA GIT_AUTHOR_EMAIL=qa@example.invalid
export GIT_COMMITTER_NAME=QA GIT_COMMITTER_EMAIL=qa@example.invalid
git init -q -b main "$BS_REPRO_ROOT"
bs() { (cd "$BS_REPRO_ROOT" && node "$BS_REPRO_CLI" "$@"); }
bs init --lang en --tools none --hooks none --cli "node $BS_REPRO_CLI"
cat > "$BS_REPRO_ROOT/CHANGELOG.md" <<'CHANGELOG'
# Changes

## Unreleased

- **Existing** Stable entry.
CHANGELOG
git -C "$BS_REPRO_ROOT" add -A
git -C "$BS_REPRO_ROOT" commit -qm Base
git -C "$BS_REPRO_ROOT" branch base
git -C "$BS_REPRO_ROOT" branch ours
cat > "$BS_REPRO_ROOT/CHANGELOG.md" <<'CHANGELOG'
# Changes

## Unreleased

- **Existing** Stable entry.

- **Guide** Example format:

```md
## Example heading
```

- **Added** New user-visible behavior.
CHANGELOG
git -C "$BS_REPRO_ROOT" add CHANGELOG.md
git -C "$BS_REPRO_ROOT" commit -qm Theirs
git -C "$BS_REPRO_ROOT" branch theirs
set +e
set -x
bs merge-changelog --ours ours --theirs theirs --base base --out "$BS_REPRO_ROOT/merged.md"
BS_REPRO_RC=$?
printf 'merge exit=%s\n' "$BS_REPRO_RC"
cat "$BS_REPRO_ROOT/merged.md"
````

Expected: exit 0, three merged entries, the complete Guide example including both fence lines and Example heading, followed by the Added entry. Actual: exit 0, `entries: ours 1, theirs 2, merged 2`; the output contains Existing, Guide and its opening fence, then ends. The example heading, closing fence and Added entry are missing. Base and ours are identical in this fixture.

The saved script and output paths above are relative to the reproduction archive root and are secondary evidence; this card contains the complete fixture and command.

## Work to do

- Decide and document how fenced code and headings inside entry examples are classified, updating ADR-043 in place.
- Make the structural merge preserve the complete fenced example and following entries. Keep raw source lines for output; use fence state only for classification.
- Apply the same classification to section and container boundaries. Review the other consumers of `splitSections` for the same mismatch.
- Update the CLI reference, README and CHANGELOG with the chosen behavior.

## Out of scope

- Changing release-tag selection or entry identity.
- Reformatting entries or translating their contents.

## Verification

- The reproduction above is red before the fix: assert every example line, its closing fence, and Added are present in the merged output.
- Cover backtick and tilde fences, longer outer fences, headings and bold bullets inside a fence, CRLF, and a following real section.
- A supported merge exits 0 with complete content; an unsupported shape refuses before writing instead of succeeding with a partial result.
- Run the relevant changelog tests, lint and the full project gates; record exact exit codes.
