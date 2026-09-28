# BS-188 · Vendor the humanizer and technical-documentation skills; adapters lay them out with licence and source

- **Order:** 1020
- **Scope:** [01. Layout](../../reference/01-layout.md)
- **Created:** 2026-09-28
- **Dependencies:** BS-142, BS-158, BS-161, BS-172

## Context

Owner decision 5 of BS-183: two MIT-licensed writing skills are vendored and laid out by the adapters in every project that selects one, for every `lang`.

**Sources,** as promptobus vendored them for v0.20.0 (github.com/Velklish/promptobus, tag `v0.20.0`, `.agents/skills/*/SOURCE.md`):

- **humanizer.** https://github.com/blader/humanizer at `9862685f575c65a8247f90369951df1b3416e3d6`: `SKILL.md` (374 lines) and `LICENSE` at the repository root. MIT, © 2025 Siqi Chen. Copied unchanged. Its 25 numbered patterns of AI writing are based on Wikipedia's "Signs of AI writing".
- **technical-documentation.** https://github.com/wondelai/skills at `c172996495bed0fcd26896a9416b2093fd7073f0`, path `plugins/code-craftsmanship/skills/technical-documentation/`: `SKILL.md` (231 lines) and seven files under `references/` (2229 lines). MIT, © 2025 Wondel.ai sp. z o.o.
  - Its "About the Source" section is the CC BY 4.0 attribution to Google's developer documentation style guide, and it stays unchanged.
  - promptobus recorded two modifications. The affiliate query `?tag=wondelai00-20` was removed from two Further Reading links, and CC BY 4.0 requires the change to be indicated. In `references/release-notes.md`, an example link to `CHANGELOG.md` became inline code, because it resolved to nothing.

**Rejected by the same research** (the body of promptobus commit `29a946bd`):

- stop-slop: it forbids passive voice and inanimate subjects, which breaks reference prose;
- plain-prose: its "name the actor" rule has the same problem;
- avoid-ai-writing: 357 KB of context;
- the-elements-of-style: no licence file;
- google-devdocs-style: its directory is not covered by the licence;
- asd-ste100: LGPL-3.0;
- skills bound to one project's house style.

Anthropic publishes no humanizer and no documentation-editing skill under a licence that permits copying.

**Adapters lay out only Markdown.** `sourceFiles` in `lib/adapters.js` (744a653) calls `srcFiles(root, '', ['.md'])`, so a `LICENSE` file would never reach a project. MIT requires the notice in every copy.

**Names.** Owned adapter outputs are named `backslop-*`, and the `.gitignore` block covers `<harness root>/backslop-*`. A project may already keep its own copies under the upstream names: promptobus tracks `.agents/skills/humanizer/` and `.agents/skills/technical-documentation/`. The upstream names would therefore collide in the codex adapter root, `.agents/skills`.

## Work to do

- **Copy from upstream at the recorded commits.** Fetch those commits; do not copy from a consumer's tree. Put the skills in `templates/vendor/humanizer/` and `templates/vendor/technical-documentation/`, each with:
  - the upstream files;
  - `LICENSE`, verbatim;
  - `SOURCE.md`: upstream URL, full sha, copy date, upstream path, the list of modifications, and the sha256 of each upstream file.

  Apply only the two technical-documentation modifications above and the frontmatter `name` change below, and list them.
- **Lay them out** with the selected adapters as `backslop-humanizer` and `backslop-techdoc`, for every `lang`, with `LICENSE` and `SOURCE.md`:
  - The frontmatter `name` becomes the laid-out name; this is a listed modification.
  - Cursor: `SKILL.md` becomes `.cursor/rules/backslop-<name>.mdc` with its description and `alwaysApply: false`; references are namespaced as for the other skills, and their links are rebased (`cursorOutput`).
  - Ownership uses the predicate that protects owned outputs today (`isOwnedAdapterFile`). The generated marker must not alter the licence text. If the marker cannot live inside `LICENSE`, own the file through its skill directory or a manifest, and document the choice.
- `templates/vendor/` is language-independent. The template parity check and `TEMPLATE_KEYS` ignore it, and nothing in it is rendered: no `{{…}}` substitution, because the text is upstream's.
- **Lifecycle.** `--tools none` removes both skills, and a repeated `init` updates them. The adapter pass of `lint` checks them: links inside must resolve in the laid-out layout.
- **Self-host test** in `npm test`. Every `templates/vendor/*/` has `LICENSE` and a `SOURCE.md` with an https upstream URL, a 40-hex sha, a copy date and a modification list. Every file not listed as modified matches the sha256 recorded in `SOURCE.md`.
- **`README.md`:** a "Third-party components" section that names both skills with their licences, copyright lines, the CC BY 4.0 attribution and the modifications.
- `package.json` `files` already ships `templates/`. Check that `npm pack --dry-run` lists the vendored files.
- **`CHANGELOG.md`** under the unreleased section: two skills are laid out by the adapters.
- **`docs/reference/01-layout.md`:** the adapter outputs table and the template layout.

## Out of scope

- The overlay skill: BS-189.
- How the process calls the skills: BS-191.
- Russian patterns: none, by decision 5.

## Verification

- A diff of each vendored file against upstream at the recorded sha: record the command and its exit code. Only the listed modifications differ.
- In a fresh project, `init --tools claude,cursor,codex --lang ru` lays out both skills with `LICENSE`, `--tools none` removes them, and `lint` exits 0 at every step.
- Mutation probe after the commit: delete a vendored `LICENSE`, then separately change one byte of an unmodified file. The provenance test turns red both times; restore, and it is green. Record the exit code of each run.
- `node bin/backslop.js gates` exits 0.
