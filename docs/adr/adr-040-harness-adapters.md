# ADR-040: Harness adapters: selection, ownership and path safety of generated outputs

**Status:** Accepted
**Date:** 2026-09-28
**Deciders:** Velklish

## Context

The process skills ship as templates and are rendered into the directories each harness reads: Claude Code, Cursor and Codex look in different places and, for Cursor, in a different file shape. Those directories also hold the user's own files, other tools' skills and harness state, so the tool must render only what the project selected, recognise what it owns, never overwrite or delete what it does not own, and never follow a link out of the project. Rendered files are derived from the templates: committing them, or keeping a hand-written ignore list in each project, gives a second copy that drifts from the source.

## Options

- **Render all three adapters always** — a project that does not use a harness gets its directory anyway.
- **Accept a link whose real path stays inside the project** — a second ownership criterion next to the marker, with its own edge cases on every read and write.
- **Check symlinks on all three roots** — a project with a shared harness directory could never run `init`, even with no adapter selected.
- **Commit rendered files** — a second copy of the templates that drifts.
- **A hand-written ignore list per project** — drifts from the set of files the tool actually writes.

## Decision

- **Registry.** There are exactly three adapters with one root each: `claude` → `.claude/skills`, `cursor` → `.cursor/rules`, `codex` → `.agents/skills` (`ADAPTERS` in `lib/adapters-registry.js`). Every other module derives the ids (`TOOLS`) and roots (`ADAPTER_ROOTS`, `adapterRootRel`) from it; there is no second copy of the three paths.
- **Selection.** `tools` in `backslop.json` is a list of unique registry ids; `[]` selects no adapter and is the default of a new config (`defaults` in `lib/config.js`). A config without `tools` is refused with an error naming the field (`validateConfig`). `init --tools a,b` sets the list, `--tools none` empties it, an empty list, unknown ids and repeated ids are refused, empty entries between commas are ignored, and the stored order is registry order (`parseTools` in `lib/init.js`). On an existing config the flag replaces the field; `init` without `--tools` keeps it.
- **Rendering.** For each selected adapter every file of the skills templates of the project language is written under the adapter root (`renderAdapters` in `lib/adapters.js`, paths from `adapterRel` in `lib/adapter-ownership.js`). Cursor turns `<skill>/SKILL.md` into `<skill>.mdc` with a frontmatter of `description` and `alwaysApply: false`, puts the other files of a skill under `.cursor/rules/<skill>/`, and rewrites relative links to that layout (`cursorRel`, `cursorOutput`). Each rendered file gets `<!-- backslop:generated -->` as its first line, or right after the YAML frontmatter (`markGenerated`).
- **Ownership is the marker alone.** A file is owned when it lies under an adapter root and is a regular file whose first line, after an optional frontmatter and an optional BOM, is the marker; CRLF is tolerated (`isOwnedAdapterFile`, `hasGeneratedMarker`). A marker quoted in the body does not count, and neither the file name nor a match with the current template makes a file owned.
- **Claude stub.** With `claude` selected and no `CLAUDE.md`, `init` writes the stub `@AGENTS.md`. A `CLAUDE.md` that is a link to `AGENTS.md` or contains `@AGENTS.md` is accepted; any other file is kept and `init` warns that Claude Code will not see the block (`ensureClaudeStub`). The AGENTS.md block always lists the skills and labels them as available only when an adapter is selected (`templates/agents-section.md`).
- **Write.** A non-owned file at an output path is left as it is and named in an `init` warning with the remedy: remove or rename it and rerun `init`, or deselect the adapter (`renderAdapters`). A directory at an output path, or a file on a component of the path, is a refusal in words (`renderAdapters`, `write`). Lint reports the same two cases for a selected adapter: an output that is not a file, and a foreign file without the marker (`lintAdapters` in `lib/lint.js`).
- **Removal.** Candidates are the marked files under an adapter root plus the current template paths (`cleanupCandidates`, `markedFiles`); a template path only names a candidate, the ownership predicate decides. A selected adapter keeps its current paths and loses stale owned ones. A non-owned candidate is kept and named in a warning; an owned one is unlinked and emptied parent directories are pruned up to the harness directory (`cleanupAdapters`, `pruneEmpty`). `CLAUDE.md` is removed only when `claude` is not selected and the file equals the stub. Owned outputs of an unselected adapter are removed unless its root path has a symlink component; then the adapter is skipped entirely, and so is an unselected root that exists and is not a directory. Inside an unselected root a candidate behind a link, or one that is not a regular file, is skipped rather than refused.
- **Path safety.** A path that escapes the project or has a symlink component is refused before ownership is read, on write, on removal and for the Claude stub (`ownedPath`). The roots of selected adapters are checked before the first write of `init`: a symlink on any component, wherever it points, is a refusal that names the remedy — a plain directory in its place, or deselecting the adapter — and a root with a file on any of its components is refused too (`checkAdapterRoots`, called from `run` in `lib/init.js` before the config is written).
- **Self-host.** In the backslop repository itself `init` with a non-empty `--tools` is refused (`run` in `lib/init.js`, `isToolRepo`): the repository keeps `tools: []` and a hand-written `.gitignore` entry in the same glob form as the managed block.
- **Link walks.** Every command that rewrites links — `mv` and `archive` through `relocateTask` in `lib/tasks.js`, `fold` through `rewriteLinks` in `lib/fold.js` — walks `repoMarkdown` (`lib/mdwalk.js`), which leaves out owned adapter files and stops at a harness root with a symlink component (`linkedHarnessRoots`). Lint gate 1 reads only `<docs>/**` and root `*.md` (`lintLinks`); adapter outputs have their own lint pass (`lintAdapters`), which also checks their links.
- **Ignore block.** `init` keeps in `.gitignore` a block between `# backslop:start` and `# backslop:end` with `<adapter root>/backslop-*` per selected adapter, and `/CLAUDE.md` only while `CLAUDE.md` is exactly the stub (`ignoreLines`, `upsertIgnore` in `lib/init.js`). The block is created only when there is something to ignore or a block already exists; with no adapter left it holds a one-line explanation. Text outside the markers is kept, and a marker that repeats or has no pair is a refusal before the first write (`readManaged`). Lint does not check the git index.

## Consequences

- Editing a rendered skill is pointless: `init` rewrites owned files. A project that wants its own variant deselects the adapter and keeps its own files.
- A hand-marked file outside `backslop-*` is owned — the next `init` removes it as a stale output — but the ignore block does not cover it.
- The ignore block does not untrack files committed before it existed; that stays a manual `git rm --cached`.
- A shared symlinked harness directory passes `init` while that adapter is unselected, and is a refusal with a named remedy once the adapter is selected.
