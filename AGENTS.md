# backslop — the tool's repository

## Repository

- `bin/` and `lib/` hold the CLI; `templates/` holds everything the tool lays into a project; `test/` holds the tests; `docs/` holds this repository's backlog, decision log and reference.
- This repository runs its own backlog with the tool: the command here is `node bin/backslop.js`.
- How the tool works now, by subsystem: [`docs/reference/README.md`](docs/reference/README.md).
- What an orchestrator may rely on is described on its own reference page: [`docs/reference/05-orchestrator-contract.md`](docs/reference/05-orchestrator-contract.md).
- Where a command, a lint gate or a migration lives in `lib/` is described on the module-map reference page.

## Templates are the source

- A process rule changes in `templates/en/**`, the source layer. Its Russian twin in `templates/**` keeps the same file set and changes in the same commit.
- `docs/backlog/README.md`, `docs/archive/README.md` and the header of `docs/archive/LOG.md` above its first journal line are rendered from the template of this repository's `lang`. A change to one of those templates updates its rendered file in the same commit.
- Every other file in `docs/` is project content and diverges from its template on purpose.
- `backslop.json` has `tools: []`: `init` writes no adapter outputs here.

## Contributor invariants

- Node >= 20, standard library only: no dependencies.
- Every user-facing message goes through `tr(lang, ru, en)` from `lib/i18n.js`, with the project language (`cfg.lang` where a config is loaded) and both texts written. JSON output is language-neutral.
- A printed path goes through `toPosix` from `lib/util.js`.
- Windows is supported. A test that cannot run on win32 carries `skip: process.platform === 'win32'` and says why.
- A new `{{placeholder}}` in a template is declared in `TEMPLATE_KEYS` in `lib/templates.js`.
- A new command, lint gate or migration is added as the module-map reference page describes.

## Contract changes

- A behaviour change of a command updates `docs/reference/`, README and CHANGELOG in the same pass.
- A contract change — file formats, commands, the composition of `status --json` — needs a new ADR. What the contract covers is listed in [05 § What is stable](docs/reference/05-orchestrator-contract.md#what-is-stable).

## Verification protocol

- An unverified item of a card starts with the [protocol](docs/reference/04-verification.md): steps 1–4 for a bug, step 5 for dead code, step 6 for deleting a test. The evidence requirements of step 7 always apply.

## Gates

- `node bin/backslop.js gates` runs the `gates` field of `backslop.json`: `node bin/backslop.js lint` and `npm test`.
- Confirm a `lint` gate with a red probe in `test/lint.test.mjs`.
- `backslop.json` has no `probe` field, so the managed block names no probe command: commit first, then break the code by hand.

## Commits and branches

- `origin` has only `main`; there are no merge requests.
- Workers may use local branches or worktrees; `.claude/worktrees/` is ignored.
- Each task reaches `origin` as one acceptance commit.
- A commit that is not a task's starts with `BS: …` (filing, triage, recorded decisions) or has the release form `Release vX.Y.Z: version bump`.

## Comments

- In `lib/`, `test/`, `bin/` and `scripts/`, a comment is at most two lines, each at most 100 code points.
- A nuance that does not fit goes to the docs; the code keeps a short pointer, only where the nuance cannot be found without it.
- No origin notes (task numbers, dates, review remarks) and no restating of the code below.
- `test/comment-length.test.mjs` checks only length and width. Origin notes are held by the author and the reviewer.
- There is no debt list: every block over the limit fails wherever it is.

## Release

This section is the only description of the release procedure. The tool is not published to npm, and the default `cli` of `init` stays the GitHub form.

1. New CHANGELOG entries go under an unversioned top heading `## Unreleased`.
2. `npm run release -- X.Y.Z --bump` renames that heading to `## vX.Y.Z — <date>`, writes `version` in `package.json` and runs `init` with the same `node` to stamp `backslop.json`.
   - It refuses when X.Y.Z is not above the current version, and when the top section is already versioned (`## v1.2.3 — date`, `## [1.2.3] - date`, `## 1.2.3`). `--bump` with `--no-publish` is a refusal too.
   - The checks on `package.json` and `CHANGELOG.md` run before the first write; `init` runs last. If `init` refuses, both files stay bumped with the old stamp: `git checkout -- package.json CHANGELOG.md`.
   - `lint` catches drift between the three numbers and a stale install pin in README.md or AGENTS.md prose; `--bump` does not move such a pin.
3. Review the diff and commit it as `Release vX.Y.Z: version bump`. Until the tag, `merge-changelog` treats the bumped section as unreleased.
4. `npm run release -- X.Y.Z --no-publish` from a clean `main`:
   - the checks: `version` in `package.json` equals the argument; no tag `vX.Y.Z` locally or in `origin`; after `git fetch origin`, local `main` is a fast-forward from `origin/main` (it may be ahead);
   - the gates: `npm test`, `npm run lint`, `npm pack --dry-run`, and the tree is still clean;
   - a local tag `vX.Y.Z`, `git push --atomic --dry-run origin main vX.Y.Z`, then the atomic push of `main` and the tag;
   - `.claude/worktrees/` is ignored and does not fail the clean-tree check;
   - never run it without `--no-publish`: that form runs `npm publish`.
5. After a failure past the tag: an atomic-push failure with HEAD unchanged is finished by the `next:` command; in every other case `git tag -d vX.Y.Z`, fix (commit if HEAD changes), rerun step 4 — step 4 refuses while the local tag exists.
6. Open a new `## Unreleased` heading before the next entry, in a `BS: …` commit.

<!-- backslop:start -->
## Tasks and decisions — backslop

The task tracker and decision log live in `docs/` and are managed with `node bin/backslop.js` (configuration: `backslop.json`, task prefix: `BS`). There is no task list in files: `node bin/backslop.js status` prints active work, the queue, deferred work, triage, and minor entries by scope. The operating rules are in `docs/backlog/README.md`; terms are in `docs/GLOSSARY.md`. The layout version is the `version` field in `backslop.json`; update backslop with `node bin/backslop.js upgrade` when you decide to, not because of someone else's commit.

**Skills (when an adapter is selected):** `backslop-task` — the lifecycle of one task; `backslop-batch` — a worker run by tracks; `backslop-seed` — populate documentation after installation.

**Change procedure.** There are two roles: the worker implements and verifies (steps 1–4), the approver accepts and closes (5–7); a single agent performs both roles in order.

1. **Task.** Take the first queued task (`node bin/backslop.js status`) or create one: `node bin/backslop.js new <slug> --title "…"` puts it in triage; `--queue` puts it directly in the queue. A small change without a tracker record is allowed if one pass fully implements it and it does not change a contract. A finding carries a cost label: fix `critical` now, fix `major` within the current task's scope now, file `major` outside it with `node bin/backslop.js new <slug> --parent N[.M]`, then fill the `Evidence:` line of its Context, and file `minor` with `node bin/backslop.js new <slug> --parent N[.M] --minor --evidence "…"` — without evidence the command refuses. A `major` or `critical` hypothesis is filed with `node bin/backslop.js new <slug> --parent N[.M] --minor --cost <level> --hypothesis --evidence "…"`; only a minor finding uses plain `--minor --evidence`.
2. **Change.** Reverse a previous decision by clean removal, without strikethroughs or “cancelled” notes. Preserve the style of the existing file. Use terms from the glossary; if a required term is missing, propose it to the owner rather than silently inventing it.
3. **Documentation in the same pass.** An undocumented change is incomplete: update the relevant `docs/reference/` section, the affected subsystem README, and CHANGELOG. An architectural decision needs `node bin/backslop.js adr <slug>` and a row in `docs/README.md`.
4. **Gates before reporting.** `node bin/backslop.js gates` is green: the commands in `gates` in `backslop.json`, the exit code of each, and the “gates N, green M” count. An entry with a `when` scope is skipped on untouched paths: a skip goes into the separate “not run N” number, never adds to the green count, and is named in the report on a line of its own. Commit to your branch with the `BS-N:` prefix before reporting; nothing stays uncommitted. For a committed branch, run `node bin/backslop.js gates --require-clean --base <base>`, where `<base>` is the commit before the task was taken: without `--base` only uncommitted paths count and scoped gates are skipped.
5. **Acceptance and archive** are one approver pass: review the diff, run `node bin/backslop.js archive N`, complete `result.md` (outcome, what was done, verification), run `node bin/backslop.js fold N > "$(git rev-parse --git-dir)/BACKSLOP_DRAFT"` — it folds the directory into a `docs/archive/LOG.md` line and prints the task body on stdout as a commit message draft, which lands outside the working tree. Do not commit between `archive N` and `fold N`: that commit would become the journal line's revision, and a squash would drop it from history. The final acceptance commit carries the draft as its message: `git add -A`, `git reset --soft <base>`, `git commit -F "$(git rev-parse --git-dir)/BACKSLOP_DRAFT"` — keep the body; a `fixup` onto the worker's commit discards the draft. On Windows, run this recipe in Git Bash.
6. **Triage review** follows closure immediately: every entry gets a next step — merge, clarify, `node bin/backslop.js mv N queue`, or `node bin/backslop.js mv N deferred` with a return condition. Ask the owner only before rejecting an entry.
7. **Commit.** Start the message with the task number: `BS-N: <what was done>`. A task reaches the main branch as one commit: taking it and review fixes are squashed into the acceptance commit of step 5. After it, commit the changes of the triage review of step 6 as a separate commit with the subject `BS: triage after BS-N`, so task N's commit carries no other task's status moves. Nothing is squashed after the fold — a squash would discard the draft, the only storage of the task body. `node bin/backslop.js lint` is green on the final commit; then push.

Worker boundaries: change only the assigned branch or worktree; create new finding files only with `node bin/backslop.js new`; never edit, move or archive an existing task file (no `mv`, no `archive`); do not touch `docs/archive/`; closure and triage belong to the approver.
<!-- backslop:end -->
