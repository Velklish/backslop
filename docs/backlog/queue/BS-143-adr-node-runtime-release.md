# BS-143 · One English ADR on Node runtime, npx delivery and release replaces ADR-003

- **Order:** 610
- **Scope:** [02. CLI](../../reference/02-cli.md) § release
- **Created:** 2026-09-25
- **Dependencies:** BS-127

## Context

docs/adr/adr-003-node-stdlib-npx.md (Russian) records the runtime and delivery decision, and docs/adr/adr-007-npm-pin.md carries the release checklist next to the npm pin form. Both are out of date on publication and on the release script. This card writes one English ADR on runtime, delivery and release and deletes ADR-003. ADR-007 stays until the BS-152 (`adr-pin-upgrade-migrate`) card, which depends on this one, deletes it with its pin half.

Line numbers below are at base commit 6f6318e (v0.11.0), where `npm test` passes 450 tests and `node bin/backslop.js lint` exits 0. The cards named under Dependencies change some of the cited code; read the code on the commit you start from and cite file:line from that commit, not from this card.

**Rules to record** (verified — read at 6f6318e):
- Node ≥ 20, standard library only, no dependencies and no build or prepare step (package.json:23-25 `engines`; no `dependencies`/`devDependencies` key in package.json; `grep -rhoE "from '[^']+'" bin lib scripts | grep -vE "'node:|'\./|'\.\./"` prints nothing, rc=1). The only check is the tarball test (test/release.test.mjs:239, `dependencies` empty).
- Default delivery is `npx github:Velklish/backslop#vX.Y.Z` with the tag of the version that made the layout (lib/config.js:14 `SOURCE`, :27-29 `defaultCli`); init writes it for a new config unless `--cli` is given (lib/init.js:73) and seeds gates with `<cli> lint` (lib/init.js:79).
- Inside a project the command is the `cli` field; templates render it as `{{cli}}` (lib/init.js:114-118). Recognised release forms: `npx [flags] github:owner/repo[.git][#vX.Y.Z]` and `npx [flags] backslop[@X.Y.Z|@latest]` (lib/config.js:42-43, `parseCli` :45-60); any other value — a global install, `node bin/backslop.js` in this repository — has no pin (:49). This ADR owns the list of forms; the pin/upgrade ADR states only how a pin is read and moved.
- The package is not published to npm. The npm form is supported for projects that install the tool another way and must declare `source` (lib/upgrade.js:99-104).
- Release is two steps. `npm run release -- X.Y.Z --bump` raises the package.json version (upward only), renames the top CHANGELOG section to `## vX.Y.Z — <date>` and restamps backslop.json through init (scripts/release.mjs:45-66); the agent commits. `npm run release -- X.Y.Z --no-publish` then checks version match, branch main, clean tree, tag absent locally and on origin, fetch and HEAD descending from origin/main (:89-102), runs `npm test`, lint and `npm pack --dry-run` and refuses if they changed the tree (:104-108), creates the tag and dry-runs the atomic push (:109-114), then pushes main and the tag atomically (:125-130). `--bump` with `--no-publish` is refused (:78-80). Without `--no-publish` the script also runs `npm publish` (:87, :116-118).
- In this repository lint gate 11 keeps one version number: package.json version equals the backslop.json stamp, CHANGELOG has a `## vX.Y.Z` section, and install pins in README.md and AGENTS.md name that version (lib/lint.js:83-118, list at :35).

**Text that must not carry over:**
- ADR-003:22 'package.json declares only bin, files and engines' — verified false: it also declares `type` (:5, needed for ESM), `scripts` (:18-22), `repository` (:26-29), `license` (:30), `keywords` (:31-41), `homepage` (:42). The invariant is 'no dependencies, no build step', not a field list.
- ADR-003:18 'npm publication remains a separate task and only changes the cli default' — verified stale: the task was closed as rejected (docs/archive/LOG.md:123 `BS-2.1-npm-publish · 2026-09-24 · отклонена`), scripts/release.mjs:85-86 calls `--no-publish` the standard release path.
- ADR-007:18 release checklist (verified — read): no `--bump`, no `--no-publish`, no tag-exists and tree-changed-by-gates refusals (scripts/release.mjs:71, :96-97, :107-108). Its flagless path does run `npm publish` as written, and docs/reference/02-cli.md:47 says the same; record the flagless behaviour as a fact. Whether the default should stop publishing is not decided here.

**How to write a consolidated ADR (applies to every ADR this card creates).** Create it with `node bin/backslop.js adr <slug> --title "<title>"` (the repository runs with `lang: en`, so the English template with Context / Options / Decision / Consequences is used and the number is the next free one; if another card takes the same number first, renumber on rebase: lint gate 8 refuses duplicate numbers). Header: `Status: Accepted`, `Date:` the day you write it, `Deciders: Velklish`. The text must not mention the numbers or file names of the ADRs it replaces, task or finding numbers, run ids, commit hashes, dated measurements or "owner decision of <date>" notes. Cite code by file and function name, not by line number (line numbers below are at base commit 6f6318e and only help you find the code). Options keeps only the rejected alternatives that still explain the choice, each with its cost in one sentence. Then delete the replaced ADR files and replace their rows in `docs/README.md` with one row for the new ADR (topic in English, Status equal to the Status line of the file; keep the table's current column layout). Every remaining reference to a deleted file is handled in the same card: links in `CHANGELOG.md` lose their link markup and old ADR tokens (the CHANGELOG rewrite drops them anyway); links and citations in `docs/reference/`, `docs/GLOSSARY.md` and `AGENTS.md` are dropped, not repointed (rules there carry no ADR citations); code and test comments that cite an old ADR get the new ADR id (`ADR-NNN`) and lose quoted section names the new ADR does not have — comments stay at most two lines and 100 code points per line (`npm test` enforces it).

**Links at 6f6318e** (`git grep -n -i adr-003`): docs/README.md:14; comment test/templates.test.mjs:50; older ADRs docs/adr/adr-007-npm-pin.md:9, adr-010-brief-command.md:27, adr-011-seed-scan-queue-reference.md:34, adr-023-gates-scope-when.md:39 (all `[ADR-003](adr-003-node-stdlib-npx.md)`). test/init.test.mjs:567-568 name `adr-003-process.md`, a fixture ADR created inside a temp project, not a reference.

## Work to do

- Create the ADR: `node bin/backslop.js adr node-runtime-delivery-release --title "Zero-dependency Node runtime, npx delivery and release"`. Context: backslop lays a process into a project with one command on machines where a coding agent is already installed, with no install step and no dependencies to keep current; Node is present wherever agents are installed from npm; skills and the AGENTS.md block must not depend on how the tool was installed; release tags are the version source for upgrade.
- Decision: one bullet per rule of 'Rules to record', checked against current code.
- Options, one line each: a Python delivery (needs uv or pipx preinstalled and a rewrite of code and tests); runtime dependencies (an install step and updates to track); npm registry delivery as the default (a default pointing at an unpublished package breaks new projects).
- Consequences: git is required on the machine; the first npx run clones the repository, later runs use the npx cache, offline use needs a local or global install; without a release form in `cli` there is nothing to pin — lint pin checks are silent and upgrade refuses unless `source` is set; running the release script without `--no-publish` publishes to npm, the release path of this repository always passes `--no-publish`.
- `git rm` docs/adr/adr-003-node-stdlib-npx.md; docs/README.md: replace row 14 with one English row `| [adr/adr-NNN-node-runtime-delivery-release.md](adr/adr-NNN-node-runtime-delivery-release.md) | <H1 title> | Accepted |`.
- test/templates.test.mjs:50: replace `(ADR-003)` with the new ADR id; keep the comment within two lines of 100 characters.
- After deleting, run `git grep -n -e adr-003-node-stdlib-npx -- '*.md'`: every hit in an older ADR file that still exists (another cluster not consolidated yet) gets its link target repointed to the new ADR file, and its link text to the new ADR id; lint gate 1 walks docs/** and root *.md and turns red on a link to a deleted file. At 6f6318e that is adr-007:9, adr-010:27, adr-011:34, adr-023:39.
- Leave docs/adr/adr-007-npm-pin.md in place except for its link to adr-003; the BS-152 (`adr-pin-upgrade-migrate`) card deletes it.

## Out of scope

- Changing the release script or its default (the BS-127 (`release-script-messages-windows`) card keeps the publishing default as documented).
- The pin, upgrade and migrate rules and deleting ADR-007 — the BS-152 (`adr-pin-upgrade-migrate`) card.
- A CHANGELOG entry: nothing user-visible changes.

## Verification

- `node bin/backslop.js lint; echo rc=$?` → rc=0.
- `npm test; echo rc=$?` → rc=0; report the pass count.
- `git grep -n -i 'adr-003-node-stdlib-npx' -- .; echo rc=$?` → no output, rc=1.
- `grep -o -E 'ADR-[0-9]{3}' docs/adr/adr-NNN-node-runtime-delivery-release.md | sort -u` → only `ADR-NNN`; `grep -n -E 'BS-[0-9]|only .bin., .files. and .engines.' docs/adr/adr-NNN-node-runtime-delivery-release.md` → no output.
