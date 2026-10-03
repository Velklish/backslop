# BS-222 · Define and enforce task numbering for simultaneous worktree creation

- **Order:** 1120
- **Scope:** [Numbers](../../reference/01-layout.md#numbers)
- **Created:** 2026-10-03
- **Dependencies:** none
- **Cost:** major

## Context

Found during BS-178 (third round of edge-case correctness testing).

Reproduced by the finder 2/2 in fresh projects; blind reproduction from this card's text alone by an independent verifier (worker:v178, claude-sonnet-5-5, 2026-10-03): reproduced 2/2, and 8/8 more (both worktrees get BS-1).

Two ordinary `new` calls started together in two worktrees of one local repository can both assign the same number and exit successfully. `lib/tasks.js:759-761` scans the current and foreign trees before choosing the number; the first writes for `--queue` may update neighboring Order fields at `lib/tasks.js:825-827`, before the new card write at line 828, with no shared reservation around those operations.

Evidence: `ati-agents promptobus lease --as worker:h178 --task bs1002-t20261001-215415 -- sh repro/concurrent-new.sh`, twice in fresh repositories. The script starts `node <worktree>/bin/backslop.js new left-task --queue` and `new right-task --queue` concurrently in sibling worktrees. Both processes exit 0; both new filenames have numeric id 1, with different slugs. The script prints the exact commands, output, exit codes and both directory listings. Logs: `repro/evidence/concurrent-new-1.txt` and `concurrent-new-2.txt`. No delay injection or modified CLI is used.

Counter-argument checked: the Numbers reference describes scanning files already visible locally, and BS-11 verified a pre-existing foreign card rather than overlapping invocations. However, the rendered backlog rules explicitly promise different numbers for a worktree worker and the main-tree orchestrator, naming only clones and unfetched remote branches as collision exceptions. Sibling worktrees share the same local repository and are not an exception. Both successful calls returning the same number therefore break the existing promise; the missing design decision concerns the coordination mechanism, not whether collisions are allowed. This is not a claim that a previously passing simultaneous-allocation test regressed.

The promise in `docs/backlog/README.md:27`:

<!-- quote:before:../README.md -->
- **Numbers are sequential** and never reused after closure; `node bin/backslop.js new` assigns them across the directories and the closed-task journal lines of the current tree, the repository’s other worktrees, and all local branches, so a worker in a worktree and the orchestrator in the main tree get different numbers; when a number on another worktree or branch made it skip, the command names it. A collision remains possible with a clone or an unfetched remote branch; `node bin/backslop.js lint` catches it at merge time, and the loser recreates the file.
<!-- /quote -->

The writes that allocation must protect:

<!-- quote:before:../../../lib/tasks.js -->
```js
  for (const [otherFile, rank] of renumbered) {
    writeText(otherFile, setField(readText(otherFile), FIELD_ORDER, String(rank), cfg.lang));
  }
  writeText(file, text);
```
<!-- /quote -->

Deduplication: searched backlog and journal for concurrent, simultaneous, same number and number collision; inspected the completed BS-11 card. No open duplicate. Separate clones and remote-only branches are already excluded by the reference and are not part of this reproduction.

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
git -C "$BS_REPRO_ROOT" add -A
git -C "$BS_REPRO_ROOT" commit -qm Fixture
git -C "$BS_REPRO_ROOT" worktree add -b left "$BS_REPRO_ROOT-left"
git -C "$BS_REPRO_ROOT" worktree add -b right "$BS_REPRO_ROOT-right"
node - "$BS_REPRO_CLI" "$BS_REPRO_ROOT-left" "$BS_REPRO_ROOT-right" <<'RUN'
const { spawn } = require('node:child_process');
const { readdirSync } = require('node:fs');
const [cli, left, right] = process.argv.slice(2);
function start(cwd, slug) {
  const args = [cli, 'new', slug, '--queue'];
  console.log(new Date().toISOString(), JSON.stringify({cwd, command: process.execPath, args}));
  const child = spawn(process.execPath, args, {cwd, env: process.env});
  let output = '';
  child.stdout.on('data', x => output += x);
  child.stderr.on('data', x => output += x);
  return new Promise(resolve => child.on('close', code => {
    console.log(new Date().toISOString(), slug, output, 'exit=' + code);
    console.log(cwd, readdirSync(cwd + '/docs/backlog/queue').filter(f => f.endsWith('.md')));
    resolve();
  }));
}
// Both children start before waiting for either; there is no delay or CLI modification.
Promise.all([start(left, 'left-task'), start(right, 'right-task')]);
RUN
````

Run the snippet as a script under the machine lease. The two exact child commands are `node "$BS_REPRO_CLI" new left-task --queue` and `node "$BS_REPRO_CLI" new right-task --queue`, each in its respective worktree. Both are spawned back-to-back before either is awaited; timestamps record submission and completion. There is no delay injection or altered CLI. Expected: if both calls exit 0, their numeric ids differ. Actual in both finder runs: both exit 0 and both filenames carry numeric id 1, with their respective left-task and right-task slugs. This is a scheduling-sensitive reproduction: a run returning different ids does not establish absence of the race.

The saved script and output paths above are relative to the reproduction archive root and are secondary evidence; this card contains the complete fixture and command.

## Work to do

- Enforce the existing different-number promise for successful simultaneous calls. Choose coordination within one git common directory, including an actionable refusal/retry policy when allocation cannot complete.
- Record the decision in the appropriate ADR and update the Numbers reference, new command documentation, README and CHANGELOG.
- Protect the scan, allocation, neighboring Order renumbering and new-card write as one operation, including parent findings. Define stale-owner recovery and preserve no-git behavior; do not silently overwrite a file.
- Keep sequential detection of committed and uncommitted foreign cards.
- Update `templates/en/docs/backlog/README.md`, its Russian twin `templates/docs/backlog/README.md`, and re-render `docs/backlog/README.md` in the same implementation commit so the existing promise and the chosen retry/refusal policy agree.

## Out of scope

- Coordinating separate clones or remote-only branches.
- Renumbering existing tasks automatically after integration.

## Verification

- Start two real CLI processes concurrently in sibling worktrees. Both successes must have distinct ids under the proposed behavior; otherwise an explicit, documented refusal must leave no partial card.
- Repeat for child findings of one parent and for a project in a repository subdirectory.
- Test interruption and retry of any proposed coordination mechanism without relying only on probabilistic scheduling.
- Retain the no-git and sequential foreign-number tests, then run lint and full project gates with recorded exit codes.
