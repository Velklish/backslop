# BS-184 · Lint gate 1 checks heading anchors and every Markdown link form

- **Order:** 980
- **Scope:** [03. Lint](../../reference/03-lint.md)
- **Created:** 2026-09-28
- **Dependencies:** BS-130, BS-131, BS-139, BS-159

## Context

Owner decisions 1 and 2 of BS-183: documentation checks live in `lint` and are strict for every project.

Line numbers below are at 744a653. Blocks 3–6 change these files before this card runs, so find code by name.

**Gate 1 resolves files only.** verified — a repro at 744a653. In an empty git repository run `node <repo>/bin/backslop.js init --lang en`; `lint` exits 0. Control: appending `[z](missing-file.md)` to `docs/README.md` gives rc=1 and `✖ docs/README.md: broken link missing-file.md`. Each of the following lines, appended alone to `docs/README.md` (with a file `docs/img.png` present), leaves `lint` at rc=0:

- `[a](reference/README.md#no-such-heading)`: a missing anchor in another file;
- `[b](#no-such-section)`: a missing anchor in the same file;
- `[c][nolabel]`: a reference link whose label has no definition;
- `<a href="missing-html.md">d</a>`: an HTML link to a missing file;
- `[![badge](img.png)](missing-badge.md)`: a badge whose outer destination is missing.

Why, in the code: `EXTERNAL` (lib/links.js:23) treats a `#…` href as external. `splitHref` (lib/links.js:88) cuts the anchor off before `brokenLinks` resolves the file. `relativeLinks` (lib/links.js:80) reads inline links and reference definitions only; `INLINE_LINK` matches the inner image of a badge, not its outer link. The only anchor check in `lint` is gate 13's, on `LOG.md` entries.

**The source to port.** promptobus v0.20.0 (github.com/Velklish/promptobus, tag `v0.20.0`): `scripts/docs-links.mjs` (`slugBase`, `uniqueSlugs`, `anchorsOf`, `linksOf`, `splitDest`, `collect`), `test/docs-links.test.mjs`, and the rules in `docs/guides/contributing.md` § Documentation links. The code is MIT with the same owner. Port the rules into the single link rule of `lib/links.js`: gates 1, 8, 13 and `seed` share one href rule today (the comment above `normalizeHrefTarget`), and a second parser would drift from it.

**Adoption cost.** Measured on 2026-09-28 with the promptobus collector over the gate-1 file set (`docs/**` and root `*.md`) of five projects that use backslop, this repository included:

| Files | Links | Missing anchors |
|---|---|---|
| 118 | 2559 | 0 |
| 917 | 931 | 0 |
| 409 | 1518 | 1 |
| 61 | 725 | 3 |
| 135 | 425 | 0 |

The 3 were false. Their targets (`skills/…/SKILL.md`) lay outside the collected file set, so the collector had no anchors for them. The rule that follows: anchors of a target are read from the target file itself. The real cost is about one finding per project.

**Heading slugs differ by host.** GitHub lowercases, drops punctuation except `-` and `_`, turns each space into `-`, and suffixes a repeated heading with `-1`, `-2`. GitLab's Markdown documentation says it also collapses a run of hyphens into one: a heading "A — B" would be `a--b` on GitHub and `a-b` on GitLab. This is a hypothesis from the documentation; check it on a GitLab-rendered page before relying on it. Two of the four consumer projects are hosted on GitLab.

## Work to do

- **One parser in `lib/links.js`** for every gate that reads links. It reads:
  - inline links in every form: bare, titled, in angle brackets;
  - reference links, full `[text][label]`, collapsed `[label][]` and shortcut `[label]` with a definition; the first definition wins, and labels compare case-insensitively;
  - images;
  - badges: the image and the outer destination are both links;
  - HTML `<a href="…">`;
  - autolinks `<https://…>`, which are external.

  Code spans, fenced blocks and HTML comments are not links. A fence closes only on a line of the same character, at least as long as the opening one.
- A reference link whose label has no definition is an error.
- **Anchors.** For a local Markdown target and for a same-file `#fragment`, the fragment must be an anchor the target exposes:
  - a heading slug: ATX headings outside fences and HTML comments, with trailing `#`s dropped, link and image markup reduced to its text and inline HTML dropped;
  - the duplicate suffixes `-1`, `-2` in document order;
  - an explicit `id="…"` or `<a name="…">`.

  The fragment is URL-decoded and compared exactly, then lowercased. The fragment of a non-Markdown target, such as `#L10`, is not checked.
- Anchors of a target are read from the target file, even when that file is outside the gate's file set, as long as it is inside the project.
- **Slug flavour.** A new optional `backslop.json` field `anchors`: `"github"` (the default) or `"gitlab"`. Every command that reads the project refuses any other value, naming the field, as it does for `lang`. `init` does not write the field.
- **Gate 1 says what it read.** It reports how many files it read, how many links, how many local links and how many anchors it checked. A project that has Markdown files and yields zero links is an error ("gate 1 read nothing"): a walk that reads nothing must not look like a clean tree.
- Gate 1's pass over the adapter outputs uses the same rule.
- Gate 13 keeps its journal checks. The sentence in `03-lint.md` that calls gate 13's anchor check the only one in `lint` goes.
- **Red probes** in `test/lint.test.mjs`, one per failure class:
  - each of the five repro lines above;
  - a duplicate heading: `#x-1` resolves and `#x-2` does not;
  - an anchor in a target outside `docs/`, such as the root `README.md`;
  - a GitLab-flavour case under `anchors: "gitlab"`;
  - the read-nothing refusal.

  One green probe: a link inside a fenced example or an HTML comment is ignored.
- **Messages** follow the localization convention in force when you start. After BS-179, English text goes in the code and the Russian entry in `templates/i18n/ru.mjs`, whose parity test fails without it. Before BS-179, use a `tr(lang, ru, en)` pair, which BS-179 migrates.
- **Documentation:**
  - `docs/reference/03-lint.md`: the gate 1 row and the link-rule paragraph;
  - `docs/reference/01-layout.md`: the `anchors` field in the configuration table;
  - `CHANGELOG.md` under the unreleased section, marked as affecting projects: `lint` now fails on missing anchors, undefined reference labels, HTML links and badge destinations, and upgrading can turn a project red.

## Out of scope

- External URLs: BS-185.
- Task ids and links into the tracker: BS-186.
- promptobus's delivery checks (the `npm pack` layout and its installed-skill layout): they belong to that package.
- Anchors inside non-Markdown files.

## Verification

- Each repro line of the context turns `lint` red, and the message names file, line and link. The fenced and commented examples stay green.
- A fresh `init --lang en` project and a fresh `init --lang ru` project both give `lint` rc=0: the templates carry no broken anchor.
- `node bin/backslop.js lint` and `node bin/backslop.js gates` exit 0 on this repository. Record the counts gate 1 prints.
- Mutation probe after the commit: make the anchor check always pass. The new probes turn red; restore, and they are green. Record the exit code of both runs.
