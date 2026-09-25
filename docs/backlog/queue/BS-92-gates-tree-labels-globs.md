# BS-92 · gates: intact porcelain, root-relative diff paths, true outcome labels, `**/` rule

- **Order:** 100
- **Scope:** [02. CLI](../../reference/02-cli.md) § gates
- **Created:** 2026-09-25
- **Dependencies:** none

## Context

Line numbers refer to base commit 6f6318e (v0.11.0). `$BS` below is `node <repo>/bin/backslop.js`; throwaway projects are created with `git init -q && $BS init --lang en --tools none` unless stated otherwise.

Four verified bugs in lib/gates.js that give an orchestrator a wrong picture of the tree or of a gate. Bugs 3 and 4 were found while checking the gates ADRs against the code; the BS-149 (`gates-runner-adr`) card records the corrected behaviour.

**1. Medium — the first porcelain line of `tree.dirty` loses its leading space.** verified — reproduced on 6f6318e (git 2.54.0).
- Unstaged edits of AGENTS.md and docs/README.md: `git status --porcelain | sed -n l` → ` M AGENTS.md$`, ` M docs/README.md$`; `$BS gates --json` → `tree.dirty` = `"M AGENTS.md\n M docs/README.md\n?? g.json"` (only line 1 changed: X=`M`, Y=` ` reads as staged); `$BS gates --require-clean` → rc=1 and the refusal prints `M AGENTS.md` first. A genuinely staged `M  x` keeps both columns.
- Root cause: lib/gates.js:19 `dirty: status.stdout.trim()`; the same string is printed at lib/gates.js:227-228 and returned at :276. No doc or test pins a trimmed form (docs/reference/02-cli.md:23 and README.md:62 describe the snapshot as commit + cleanliness).

**2. Medium — with `diff.relative=true`, a monorepo subproject's changed paths are all dropped and scoped gates are skipped green.** verified — reproduced on 6f6318e (git 2.54.0).
- Repo with the project in `pkg/` (gates `{command:"…", when:["lib/**"]}`), tag `base`, commit touching `pkg/lib/x.js`. Default config: `$BS gates --base base --json` → `scope.paths` contains `lib/x.js`, gate runs. After `git config diff.relative true`: `git diff --name-only base..HEAD` in `pkg/` prints `lib/x.js`; `gates --base base --json` → `scope {prefix:'pkg/', dropped:1}`, the `lib/**` gate `skipped: the scope is untouched`, rc=0, no command ran.
- Root cause: lib/gates.js:77 runs `git diff --name-only -z --no-renames <base>..HEAD` and lib/gates.js:60-71 strip the `rev-parse --show-prefix` prefix assuming root-relative output; `diff.relative` (git ≥ 2.28) makes the output cwd-relative. The gates-scope ADR (docs/adr/adr-023-gates-scope-when.md:43 at 6f6318e) and lib/gates.js:80 state that premise.

**3. Minor — the per-gate outcome label mislabels a time cap and a signal.** verified — reproduced on 6f6318e. The gates-runner ADR (docs/adr/adr-009-gates-runner.md:31 at 6f6318e) defines three outcomes: the command's own code, death by a signal (including the 10-minute cap), failure to start. Code, lib/gates.js:162-165: `if (r.signal !== null) return …killed by signal ${r.signal} (cap ${GATE_TIMEOUT_MS / 60000} min)…; if (r.error !== null) return …did not start: ${r.error}…`.
- A gate that hits the cap and whose shell traps SIGTERM exits 0 with `error` ETIMEDOUT and no signal, so it is labelled "did not start". Repro, in a project with `gates: ["trap 'exit 0' TERM; n=0; while [ $n -lt 100 ]; do sleep 0.05; n=$((n+1)); done; exit 7"]` and the cap forced to 2 s by the `NODE_OPTIONS=--import <cap.mjs>` wrapper that test/gates.test.mjs:237-243 writes: `node <repo>/bin/backslop.js gates; echo rc=$?` -> `✖ trap … — did not start: spawnSync /bin/sh ETIMEDOUT, 2007 ms`, `✖ gates 1, green 0`, `rc=1`.
- Every signal is suffixed with the cap, even a self-kill: `gates: ["true", "kill -TERM $$", "echo hi"]`, `gates --keep-going` -> `✖ kill -TERM $$ — killed by signal SIGTERM (cap 10 min)` after a few milliseconds.
- The wrong wording is pinned by test/gates.test.mjs:251 `assert.match(r.err, /✖ trap .* — не запустился: spawnSync \S+ ETIMEDOUT, \d+ ms/);` and described as behaviour in the `gates` row of docs/reference/02-cli.md:23. The first half was previously recorded as a minor note (the ETIMEDOUT ceiling reported as "did not start"); that note is folded into this card.

**4. Minor — `**/` matches zero segments in the middle of a segment.** verified — reproduced on 6f6318e. The gates-scope ADR (docs/adr/adr-023-gates-scope-when.md:39 at 6f6318e) and the comment at lib/gates.js:23-24 say `**/` means "zero segments too" only at the start of a segment; `globToRe` (lib/gates.js:25-40) emits `(?:.*/)?` for any `**/`. `node -e "import('./lib/gates.js').then(({globToRe})=>{for (const [p,s] of [['src**/x.js','srcx.js'],['src**/x.js','srcfoo/x.js']]) console.log(p,'|',s,'=>',globToRe(p).test(s), String(globToRe(p)))})"; echo rc=$?` -> `src**/x.js | srcx.js => true /^src(?:.*\/)?x\.js$/` and `src**/x.js | srcfoo/x.js => true`, `rc=0`. The glob table test (test/gates.test.mjs:420-431) covers only segment-initial `**/`. The code is fixed to the documented rule.

## Work to do

- Bug 1: keep porcelain lines intact — `dirty: status.stdout.replace(/\n$/, '')` and `clean: status.stdout === ''`; use the same string in the `--require-clean` refusal.
- Bug 2: pass `--no-relative` to the diff at lib/gates.js:77 (or run it with `-c diff.relative=false`).
- Bug 3, test first: change the assertion at test/gates.test.mjs:251 to expect the timeout label (ru: `превысил потолок 10 мин`, en: `timed out after the 10-min cap`, or wording of your choice that names the cap), and in `gates: исход различает код, сигнал и незапуск; формат строки гейта закреплён` (:465) add a human-output run of the SIGTERM self-kill gate asserting `/— прерван сигналом SIGTERM, \d+ ms$/m` with no cap text. Run them red.
- Bug 3, fix the label in lib/gates.js `outcome` (the BS-113 (`shared-shell-runner`) card later moves it into lib/util.js unchanged): a spawn error with code `ETIMEDOUT` -> the timeout label (it wins over a signal, since a cap kill also carries SIGTERM); a signal without a timeout -> `killed by signal <SIG>` with no cap suffix; any other spawn error -> `did not start: <message>`; otherwise `code <N>`. Keep `passed` as it is and keep the `--json` gate object shape unchanged (read the error code in the runner; do not add a field to the JSON).
- Bug 4, test first: add rows to the glob table at test/gates.test.mjs:420: `['src**/x.js', ['srcfoo/x.js', 'src/a/x.js'], ['srcx.js']]` and a zero-segment row that must keep working, e.g. `['a/**/b.md', ['a/b.md', 'a/c/d/b.md'], ['ab.md']]`. Then emit `(?:.*/)?` in `globToRe` only when `**/` starts the pattern or follows `/`; elsewhere `**` stays `.*` and the `/` is literal.
- Add an English CHANGELOG entry under the unreleased top section (open `## Unreleased` above the newest version heading if there is none): `gates` names a gate that hit the time cap as timed out instead of "did not start", a signal line no longer claims the cap, and a `when` pattern with `**/` inside a segment (e.g. `src**/x.js`) no longer matches zero directories.
- Add the regression tests listed under Verification to test/gates.test.mjs.

## Out of scope

- Whether `--require-clean` and the tree snapshot should be scoped to the project in a monorepo — the BS-102 (`unverified-repo-state-reports`) card.
- Killing the whole process group on the cap, and changing or configuring the 10-minute cap.
- The shell-runner extraction shared with `upgrade` (the BS-113 (`shared-shell-runner`) card).

## Verification

- New test (bug 1): unstaged edit as the first porcelain entry → `gates --json` `tree.dirty` starts with ` M `.
- New test (bug 2): monorepo fixture with `git config diff.relative true` → `gates --base base --json` has `dropped: 0` and the `lib/**` gate runs.
- `node --test --test-timeout=60000 test/gates.test.mjs; echo rc=$?` -> `rc=0`; the new assertions were red before the fix.
- Repro of bug 3 again -> `✖ trap … — timed out after the 10-min cap, <ms> ms` (or your wording), `rc=1`; the self-kill gate -> `killed by signal SIGTERM, <ms> ms` with no cap text.
- Repro of bug 4 again -> `src**/x.js | srcx.js => false`, `src**/x.js | srcfoo/x.js => true`; `**/*.md` still matches `a.md` (existing table row).
- `npm test` → rc=0; `node bin/backslop.js lint` → rc=0.
- In result.md say that the former minor note about the ETIMEDOUT wording ("did not start" for a gate that ran until the ceiling) is resolved by this card.
