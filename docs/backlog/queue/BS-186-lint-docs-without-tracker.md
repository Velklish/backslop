# BS-186 · Lint gate: project documentation carries no task ids and no tracker links

- **Order:** 1000
- **Scope:** [03. Lint](../../reference/03-lint.md)
- **Created:** 2026-09-28
- **Dependencies:** BS-184, BS-158, BS-159, BS-172, BS-174, BS-175

## Context

Owner decisions 1–3 of BS-183: documentation stands on its own, the check lives in `lint`, and it is strict for every project. A task id or a tracker link sends the reader to a record that leaves the tree at `fold`, and to history the reader may not be able to open. Consumer projects clear their debt in their own migration tasks.

**The set** (decision 3):

- root `README*.md`;
- every `.md` under `<docs>/` except `<docs>/backlog/` and `<docs>/archive/`, ADRs included;
- in `CHANGELOG.md`, the unreleased section only: the top section, read by the same rule `merge-changelog` uses to find the unreleased section.

Released sections are history, as they are for the pin check.

**Today both pass.** verified — a repro at 744a653. In a fresh `init --lang en` project with a triage card `BS-1-alpha` (`new alpha`), `lint` exits 0. Appending `The rule came from BS-1, see [BS-1](../backlog/triage/BS-1-alpha.md).` to `docs/reference/README.md` still gives rc=0: gate 6 accepts a mention whose task file exists, and gate 1 accepts the link.

**Source.** promptobus v0.20.0 (github.com/Velklish/promptobus, tag `v0.20.0`):

- `test/docs-task-independence.test.mjs`: task ids, tracker links including same-repository URLs, untracked run artifacts;
- `scripts/docs-links.mjs`: `isConsumerDoc`, `inUnreleased` and `consumerLink`, which count links from documentation into the tracker as task dependencies.

promptobus is at zero: `git grep -P '\bPB-\d+'` over its `docs/adr` and `CHANGELOG.md` at b44b2ba9 exits 1.

**Measured debt, 2026-09-28** (grep of `<prefix>-N` over root `README*.md` and `docs/**/*.md` outside backlog and archive; the changelog was not measured):

| Project | Files | Task ids | Files with ids |
|---|---|---|---|
| consumer 1 | 71 | 1701 | 58 |
| consumer 2 | 288 | 514 | 51 |
| consumer 3 | 34 | 281 | 26 |
| consumer 4 | 31 | 0 | 0 |
| this repository at 744a653 | 48 | 131 | 30 |

Links from documentation into the tracker, counted by the promptobus collector: 91, 5, 11 and 0 for the four consumers, and 42 here. Blocks 4 and 5 remove most of this repository's.

## Work to do

- **A new gate** (the next free gate number), `lintTrackerFreeDocs`, following the "Add a lint gate" recipe of `docs/reference/06-module-map.md` when BS-177 has landed. Update every place that spells the gate count.
- **Errors in the set:**
  1. a task id of this project, `<prefix>-N` or `<prefix>-N.k`, compared as numbers as in gate 6, anywhere in the file: prose, code spans and fenced blocks alike, because an example writes `<prefix>-N`;
  2. a link, in any form the BS-184 parser reads, whose target resolves into `<docs>/backlog/` or `<docs>/archive/`, `LOG.md#…` included;
  3. an absolute URL into the same repository's backlog or archive:
     - host and path come from `git remote get-url origin`, in https and scp forms;
     - GitHub paths look like `/<owner>/<repo>/(blob|tree)/<ref>/…`, GitLab paths like `/<group…>/<repo>/-/(blob|tree)/<ref>/…`;
     - with no origin, this check is skipped and `lint` prints a note;
  4. a private run artifact: a path in a code span or a link that ends in `.json`, `.jsonl`, `.txt` or `.log`, contains `/`, and resolves to no tracked file from the file's directory or from the repository root. Skipped:
     - a path starting with `~`, `$` or `/`;
     - a path containing `<`, `>`, `{`, `}` or `*`;
     - a bare file name with no `/`. promptobus exempted bare captures by name prefix, and concrete captures got through that exemption (an open finding on its check), so the generic rule does not judge names.
- **Each error** names file, line, class and token. The hint says what to write instead: the contract, the rationale, or the measurement itself with its version and date.
- **Gate 6** keeps checking mentions outside the set: the backlog, the archive, released changelog sections. Inside the set, a mention is reported once, by the new gate.
- A fresh `init --lang en` project and a fresh `init --lang ru` project pass: the templates carry no task id.
- **This repository's own set:** count first, clear whatever blocks 4 and 5 left, and record the counts before and after.
- **Red probes** in `test/lint.test.mjs`:
  - each of the four classes;
  - the same-repository URL in both host forms;
  - the boundary between the unreleased and the released changelog sections.

  Green probes: a placeholder `<prefix>-N`, a `~/.config/x.json` path, and a bare `gates.json`.
- **Messages** follow the localization convention of BS-184.
- **Documentation:** the gate's row and rule in `docs/reference/03-lint.md`; the "Documentation checks" part of `README.md`; `CHANGELOG.md` under the unreleased section, marked as affecting projects: `lint` now fails on task ids and tracker links in documentation, and a project that carries them turns red on upgrade until its migration task clears them.
- **Glossary evidence.** `docs/GLOSSARY.md` rows for project documentation point their Evidence at ADR-055 until this card lands; repoint each to the file that now implements the term, as the glossary header requires.

## Out of scope

- Rewriting any consumer project's documentation: each does it in its own migration task.
- Links between backlog cards: they point at tasks by design.
- Released changelog sections.
- The AGENTS block sentence that states the rule: BS-191.

## Verification

- The red probes are red before the change and green after it.
- A fresh `init` project in both languages gives `lint` rc=0.
- `node bin/backslop.js lint` and `node bin/backslop.js gates` exit 0 on this repository. Record the before and after counts of the set.
- Mutation probe after the commit: disable class 2. The tracker-link probe turns red; restore, and it is green. Record the exit code of both runs.
