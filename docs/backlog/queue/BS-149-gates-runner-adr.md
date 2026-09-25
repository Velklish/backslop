# BS-149 · One English ADR for the gates runner and path-scoped gates replaces ADR-009 and ADR-023

- **Order:** 670
- **Scope:** [02. CLI](../../reference/02-cli.md) § gates
- **Created:** 2026-09-25
- **Dependencies:** BS-113, BS-136, BS-92, BS-106

## Context

`docs/adr/adr-009-gates-runner.md` (the `gates` command) and `docs/adr/adr-023-gates-scope-when.md` (path-scoped entries `{ command, when }`, `--base`) describe one runner. The second changed what the first froze — the entry format (adr-009:35 "the `gates` format does not change"), the flag list (adr-009:29 lacks `--base`), the summary tail — but adr-009:3 and its row `docs/README.md:20` still say `Accepted` and neither file names the other (`grep -n 023 docs/adr/adr-009-gates-runner.md` -> no output). verified — read. This card writes one English ADR and deletes both. Line numbers are at 6f6318e; the BS-113 (`shared-shell-runner`) card moved `runGate`/`passed`/`outcome` from lib/gates.js into lib/util.js as `runShell`/`shellPassed`/`shellOutcome`, so cite the code where it lives when you start.

**How to write a consolidated ADR (applies to every ADR this card creates).** Create it with `node bin/backslop.js adr <slug> --title "<title>"` (the repository runs with `lang: en`, so the English template with Context / Options / Decision / Consequences is used and the number is the next free one; if another card takes the same number first, renumber on rebase: lint gate 8 refuses duplicate numbers). Header: `Status: Accepted`, `Date:` the day you write it, `Deciders: Velklish`. The text must not mention the numbers or file names of the ADRs it replaces, task or finding numbers, run ids, commit hashes, dated measurements or "owner decision of <date>" notes. Cite code by file and function name, not by line number (line numbers below are at base commit 6f6318e and only help you find the code). Options keeps only the rejected alternatives that still explain the choice, each with its cost in one sentence. Then delete the replaced ADR files and replace their rows in `docs/README.md` with one row for the new ADR (topic in English, Status equal to the Status line of the file; keep the table's current column layout). Every remaining reference to a deleted file is handled in the same card: links in `CHANGELOG.md` lose their link markup and old ADR tokens (the CHANGELOG rewrite drops them anyway); links and citations in `docs/reference/`, `docs/GLOSSARY.md` and `AGENTS.md` are dropped, not repointed (rules there carry no ADR citations); code and test comments that cite an old ADR get the new ADR id (`ADR-NNN`) and lose quoted section names the new ADR does not have — comments stay at most two lines and 100 code points per line (`npm test` enforces it).

**1. What the runner does today.** verified — read, plus runs in throwaway projects.
- Explicit command only: `gates` in COMMANDS (bin/backslop.js:11), no other module imports lib/gates.js (`git grep -n "gates.js\|from './gates" -- lib bin scripts` -> only lib/gates.js itself).
- Entries: a string always runs; `{ command, when: [glob…] }` runs only when the changed-path set touches a pattern (`gateEntry` lib/config.js:158-160; `validateGates` :163-181: non-empty `command`, `when` a non-empty array of non-empty strings; string entries are not validated). Missing `gates` defaults to `["<cli> lint"]` (lib/config.js:112); an explicit empty list is refused (lib/gates.js:182-186).
- Each command runs through the shell in the project root with a 10-minute cap (lib/gates.js:134, 138-145); stop at the first non-green gate unless `--keep-going` (:265); `--require-clean` refuses before the first command on a dirty tree or without git (:218-230); `--dry-run` runs nothing and is refused with `--require-clean` or `--base` (:188-197, 208-216); an empty `--base` is refused (:200-204).
- Changed-path set, computed only when an entry has `when` or `--base` is given (:233-235): `git status --porcelain -z -uall` with both names of a rename or copy (:44-58); with `--base <ref>` also `git diff --name-only -z --no-renames <ref>..HEAD`, de-duplicated (:76-83, :100); re-based to the project root via `git rev-parse --show-prefix`, paths outside dropped and counted (:62-72).
- `--require-clean` with a scoped entry is refused when the raw set is empty (:240-248); skipped entries are reported with reason and patterns, counted as `outOfScope` inside `skipped`, never green and never red (:124-131, :251-257, :270-273); exit 1 when an executed gate is not green, refusals also exit 1 (:286); `--json` writes `{gates, total, green, skipped, outOfScope, scope, tree}` to stdout and sends gate output to stderr (:143, :276).
- `upgrade` rewrites the cli pin inside gate commands and keeps `when` (lib/upgrade.js:37-43); `brief` lists gate commands and says skips are reported separately when an entry is scoped (lib/brief.js:122-146).

**2. Statements in the old ADRs that are wrong or incomplete.** verified.
- adr-023:49 "no git — the set is not computed and everything runs" omits two refusals: in a directory without git, `backslop.json` with `gates: [{"command":"exit 0","when":["src/**"]}]`: `node <repo>/bin/backslop.js gates --base main; echo rc=$?` -> `✖ --base main: git did not report the tree state, so the path set cannot be computed`, `rc=1`; `gates` without `--base` -> `✔ exit 0 — code 0`, `rc=0`. A failing `git diff` on a bad ref is refused too, naming the git cause (lib/gates.js:77-81).
- adr-009:43 says "the cap kills the shell, not the process group — not verified by a run". Measured on macOS `/bin/sh` with the cap forced to 2 s: gate `sleep 7 & echo $! > bg.pid; sleep 30; echo done` -> after `gates` returned (rc=1) both the background `sleep 7` and the foreground `sleep 30` were still alive (`ps -p $(cat bg.pid)` and `pgrep -f 'sleep 30'` found them). Windows (cmd.exe) was not measured. The new ADR states the limit as measured on POSIX sh and unmeasured on Windows; no code change.

**3. Corrected behaviour to record.** verified — the BS-92 (`gates-tree-labels-globs`) card fixed two defects this card found: a gate that hits the cap is labelled as timed out (even when its shell traps SIGTERM and exits 0), a signal line no longer claims the cap, and `**/` matches zero segments only at the start of a pattern or after `/` (`src**/x.js` no longer matches `srcx.js`). The ADR states these rules as they are in the code when you start; check `outcome`/`shellOutcome` and `globToRe`.

## Work to do

- Create the ADR (`node bin/backslop.js adr gates-runner --title "Gates runner and path-scoped gates"`). Context: gate rules run by hand stayed unenforced (exit code of a pipe, a tree that differs from the commit, gate counts from memory), and running every command on every change costs full suites on edits that cannot affect them while some checks must run exactly on such edits. Decision: everything in item 1, the refusals of item 2, the corrected outcome labels of item 3, the glob rule (`*` and `?` do not cross `/`, `**` does, `**/` at a segment start also matches zero segments, everything else literal). Consequences: gate counts come from the runner; with scoped entries "gates N, green N" is not a full readiness criterion — reports name skipped entries and acceptance runs `--require-clean --base <branch point>`; the tool never judges a red gate or a dirty tree (no fix mode, no autocommit, not embedded in other commands or CI); the cap kills only the shell (measured on POSIX sh, unmeasured on Windows); a project that declares a scope must pin a tool version that supports it (older versions refuse in config loading); a refusal and a red gate share exit code 1 and a refusal leaves `--json` stdout empty; no result cache between runs.
- Delete both ADR files and replace rows `docs/README.md:20` and `:34` with one row.
- Repoint code comments to the new ADR id: lib/gates.js:24, :43, :61, :86, :137, :199, :239 (drop the quoted Russian section names) and lib/config.js:157. Drop the ADR links in docs/reference/01-layout.md:43 and docs/reference/02-cli.md:23, and in the same `gates` row make the sentence on outcome labels match the corrected labels. Drop the ADR link in docs/GLOSSARY.md:54. CHANGELOG.md:49: remove the link markup to adr-023.

## Out of scope

- Killing the whole process group on the cap (documented limit, not changed).
- Changing the 10-minute cap or making it configurable.
- Validating string gate entries.
- The brief's gates step and its pin handling (the brief ADR).
- Code changes to the runner: the BS-92 (`gates-tree-labels-globs`) card and the BS-113 (`shared-shell-runner`) card made them.

## Verification

- `git grep -n -E 'ADR-0(09|23)([^0-9]|$)|adr-0(09|23)-' -- . ':!docs/archive'; echo rc=$?` -> no output, `rc=1`.
- `node bin/backslop.js lint; echo rc=$?` -> `rc=0` (gate 1 fails on any link to a deleted ADR file, gate 8 on an ADR without a `docs/README.md` link or a duplicate number).
- `npm test; echo rc=$?` -> `rc=0` (base 6f6318e: 450 tests, 450 pass).
