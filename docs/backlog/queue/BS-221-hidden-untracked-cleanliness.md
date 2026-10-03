# BS-221 · Make clean-tree reports independent of hidden untracked files

- **Order:** 1110
- **Scope:** [Orchestrator contract](../../reference/05-orchestrator-contract.md#two-shapes-of-dirty)
- **Created:** 2026-10-03
- **Dependencies:** none
- **Cost:** major

## Context

Found during BS-178 (third round of edge-case correctness testing).

Reproduced by the finder 2/2 in fresh projects; blind reproduction from this card's text alone by an independent verifier (worker:v178, claude-sonnet-5-5, 2026-10-03): reproduced 2/2 (gates --require-clean exit 0, clean, with ?? local-work.txt; tracks dirty []).

With `git config status.showUntrackedFiles no`, untracked work disappears from the clean-tree reports of `gates` and `tracks`. `lib/gates.js:12` and `lib/tracks.js:27` inherit that display setting; the separate changed-path query in `lib/util.js:159` explicitly uses `-uall`.

Evidence: run `ati-agents promptobus lease --as worker:h178 --task bs1002-t20261001-215415 -- sh repro/git-untracked.sh`. In two fresh repositories, `git status --porcelain --untracked-files=all` prints `?? local-work.txt`, exit 0, while `node <worktree>/bin/backslop.js gates --require-clean` runs lint, exits 0, and prints `gates 1, green 1` and `clean`. A sibling worktree containing the untracked worker-notes.txt is reported by `tracks --json` with `dirty: []`, exit 0. Logs: `repro/evidence/git-untracked-1.txt` and `git-untracked-2.txt`.

Counter-argument checked: ADR-045 and ADR-054 currently specify the raw porcelain commands; the orchestrator reference's Two shapes of dirty section repeats them. The implementation follows those literal commands. However, the same documents identify an empty dirty value as a clean tree, and the contract example includes untracked files. This is a contract inconsistency under a legitimate git setting, not an unhandled git failure. A full card is required to settle which promise wins. There is already an explicit project precedent: `docs/reference/02-cli.md:197` says that a new file counts even with `status.showUntrackedFiles=no` when fold checks an uncommitted directory. `test/fold.test.mjs:949` verifies that an uncommitted result is refused while plain porcelain output is empty. Inheriting this display preference is therefore not a uniform tool policy.

Deduplication: searched backlog and journal for status.showUntrackedFiles, untracked and dirty/clean. No open duplicate. BS-92 and BS-176.1 concern porcelain whitespace preservation; BS-186.2 concerns documentation artifacts, not git cleanliness.

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
node - "$BS_REPRO_ROOT/backslop.json" "$BS_REPRO_CLI" <<'CONFIG'
const fs = require('node:fs');
const [file, cli] = process.argv.slice(2);
const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
cfg.gates = ['node ' + cli + ' lint'];
fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
CONFIG
git -C "$BS_REPRO_ROOT" add -A
git -C "$BS_REPRO_ROOT" commit -qm Fixture
git -C "$BS_REPRO_ROOT" config status.showUntrackedFiles no
printf 'Unsaved local work\n' > "$BS_REPRO_ROOT/local-work.txt"
set +e
set -x
git -C "$BS_REPRO_ROOT" status --porcelain --untracked-files=all
printf 'status exit=%s\n' "$?"
bs gates --require-clean
printf 'gates exit=%s\n' "$?"
git -C "$BS_REPRO_ROOT" worktree add -b worker "$BS_REPRO_ROOT-worker"
printf 'Unsaved worker work\n' > "$BS_REPRO_ROOT-worker/worker-notes.txt"
bs tracks --json
printf 'tracks exit=%s\n' "$?"
````

Run the snippet as a script under the machine lease because it invokes gates. Expected under the proposed clean-tree contract: gates refuses with exit 1 before lint, and tracks exits 0 with worker-notes.txt represented in its dirty array. Actual: explicit `git status --porcelain --untracked-files=all` prints `?? local-work.txt`, exit 0; gates runs lint and prints `gates 1, green 1` and `clean`, exit 0; tracks reports `dirty: []` for the sibling worktree, exit 0. No ignore rule hides either file.

The saved script and output paths above are relative to the reproduction archive root and are secondary evidence; this card contains the complete fixture and command.

## Work to do

- Decide whether a clean tree includes all non-ignored untracked work regardless of the user's display configuration. Proposed behavior: include it consistently in both commands.
- If adopting that behavior, explicitly request untracked entries while retaining the documented directory collapsing of the snapshot and tracks output. Do not change JSON types or porcelain status columns.
- Align ADR-045, ADR-054, the orchestrator and CLI references, README and CHANGELOG. If the owner chooses to retain config-sensitive reporting, document the limitation and avoid presenting the observation as unconditional cleanliness.

## Out of scope

- Automatically deleting worktrees or files.
- Changing ignored-file handling or the scoped changed-path algorithm.

## Verification

- With status.showUntrackedFiles=no and an untracked file, require-clean refuses before its first command under the proposed behavior.
- A sibling worktree with untracked work has a nonempty dirty array; a genuinely clean one remains empty, and failed queries remain null.
- Cover nested untracked directories and a monorepo subproject without changing directory collapsing or path relativity.
- The reproduction must fail the old clean-tree assertion. Run focused gates/tracks tests and the full project gates with exact exit codes.
