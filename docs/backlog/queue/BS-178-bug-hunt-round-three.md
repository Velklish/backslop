# BS-178 · Third bug-hunt round with new lenses: git config matrix, encodings, monorepo, parsers, Windows

- **Order:** 960
- **Scope:** [Reference](../../reference/README.md)
- **Created:** 2026-09-25
- **Dependencies:** none

## Context

Two hunting rounds over the same code found 48 and then 30 new bugs; the second round was not empty, so the pool is not exhausted. A third round with the same prompt and a longer seen-list has diminishing returns; the areas where the second round was richest point at lenses the first two did not use.

Where the second round found the most: git configuration (`core.autocrlf`, `core.quotepath`, `diff.relative`, `commit.cleanup` each produced a bug); encodings (UTF-8 BOM in `backslop.json`, task files and markdown, non-UTF-8 files rewritten after a lossy decode); monorepo subprojects (toplevel-relative vs cwd-relative pathspecs in `git ls-tree`, `git diff`, `git ls-remote`); the `merge-changelog` parser (subgroup headings, indented bold lines, monorepo tag prefixes); `fold`/`show` round-trips through commit messages; `seed --scan` inputs; `gates`/`tracks` process and worktree edge cases.

The round follows the finding verification protocol: every finding is reproduced by the finder with the real CLI, then verified by a blind reproduction and a refutation pass before it becomes a card.

## Work to do

- Lens 1 — parser fuzzing: feed the markdown readers (`lib/tasks.js` fields and sections, `lib/links.js`, `lib/log.js` journal lines, `lib/changelog.js` and `lib/merge-changelog.js` sections and entries, `lib/mdwalk.js`) with generated and boundary inputs: empty files, only headings, CRLF and mixed EOL, BOM, nested fences, fields with markdown inside values, ids with leading zeros and `N.M.K` shapes, links with query, anchor, percent-encoding, parentheses and spaces.
- Lens 2 — git configuration matrix: run the task lifecycle (`new`, `mv`, `archive`, `fold`, `show`, `tracks`, `gates --base`, `upgrade`) under `core.autocrlf=true|input`, `core.quotepath=true` with non-ASCII paths, `diff.relative=true`, `commit.cleanup=strip|scissors`, `safe.directory` unset, `status.showUntrackedFiles=no`, a bare `.git` file (worktree and submodule), and git absent from PATH.
- Lens 3 — Windows: simulate with `path.win32` where the code calls `path`, run the suite with a CRLF checkout, check every `\n` join and every `/` string operation on paths; list the tests skipped on win32 and decide which need a Windows-shaped fixture instead of a skip.
- Lens 4 — differential ru/en: run the same command sequence in a `lang: ru` and a `lang: en` project and diff the resulting trees structurally; every difference beyond translated text is a finding (field order, missing sections, hard-coded language in outputs such as the Scope value written by `seed --queue-reference`).
- Lens 5 — skill walkthroughs: follow `templates/en/skills/backslop-task/SKILL.md` and `backslop-batch/SKILL.md` step by step as a worker and an approver in a throwaway project, including the merge-changelog and gates --base steps; every step that fails, needs a guess or contradicts the CLI is a finding.
- Lens 6 — command interactions: `new` after `mv` renumbering, `archive` then `fold` then `show` across a squash, `init` after `upgrade` with a changed `lang`, `seed` then `lint`, `mv --restore` batches mixed with `--after`, two worktrees creating numbers concurrently.
- Record each finding with title, file:line, the reproduction (command, output, exit code), severity and proposal; deduplicate against the existing bug cards before verification; verify with the protocol; file survivors as cards grouped by module with the same verified/unverified labelling as the current backlog.

## Out of scope

- Fixing the bugs found (each becomes its own card).
- Re-verifying the bugs already in the backlog.

## Verification

- A findings list with reproduction evidence per lens, including the lenses that found nothing (a lens that found nothing is recorded as run, with the inputs tried).
- Every survivor has a blind-reproduction record and a refutation record before its card is created.
- The round is declared dry only when a full pass over all six lenses adds no new survivor.
