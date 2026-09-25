# BS-118 · Move shared code out of command modules: isToolRepo, probeRule, projectName, createTask

- **Order:** 360
- **Scope:** [Reference](../../reference/README.md)
- **Created:** 2026-09-25
- **Dependencies:** BS-109, BS-94, BS-106, BS-115

## Context

Several commands import helpers from other command modules or duplicate them:
- init imports `sameDir` from lint (lib/init.js:13);
- migrate imports `projectName` from init (lib/migrate.js:6);
- seed drives `new` through its argv entry (lib/seed.js:8, :203).

The probe rule is also duplicated. mv→lint and merge-changelog→lint are handled by the BS-117 (`mv-reuses-task-model`) and BS-114 (`changelog-section-parser`) cards; the JSON readers moved to BS-115 (`project-lang-fallback`).

Repro commands below run in an empty scratch directory with `B() { node "$BACKSLOP/bin/backslop.js" "$@"; }`, where `$BACKSLOP` is this repository's checkout; projects are created with `git init -q -b main && B init --tools none --lang en`.

**1. The self-host predicate** — verified — `grep -n "sameDir(" lib/*.js` at base prints lib/init.js:88 and lib/lint.js:75 (the definition), :86, :122, :130, :139.
- `sameDir(path.join(root, 'templates'), TEMPLATES_DIR)` is spelled out at lib/lint.js:86, :122 (through a local `templates`), :130 and :139, and at lib/init.js:88.
- `sameDir` is defined in the lint command (lib/lint.js:75-81: realpath, false on error), although `TEMPLATES_DIR` is owned by lib/templates.js:7.
- templates.js imports only links.js and mdwalk.js, so moving the predicate there creates no cycle. lib/lint.js:122 and :130 keep the local `templates` for `templateParity`/`templateSlots`.

**2. The probe rule rendering** — verified — read the code at base.
- lib/init.js:111-113 has `cfg.probe ? ` ${renderProjectTemplate(cfg, 'agents-probe.md', { probe: cfg.probe.trim() }).trim()}` : ''`.
- This is the same expression, leading space included, as brief's local `probeStep(cfg)` (lib/brief.js:151-153). brief's comment at :149-150 says the two must be one source.

**4. seed drives `new` through argv** — verified — read the code at base; there is no behaviour divergence.
- lib/seed.js:203 runs `await newTask([slug, '--queue', `--title=...`], { cwd: project.root })`.
- For every seeded task, `new.run` (lib/new.js:39) reloads the project, parses arguments, and runs `scanTasks` and `foreignTaskIds` (lib/new.js:66-67: a `for-each-ref`, plus an `ls-tree` and a `git show` per local branch). It prints its `✔ <id>: <path>` line (lib/new.js:137) and returns 0.
- seed then rescans with `scanTasks` and looks the task up by slug (`lastCreated`, lib/seed.js:218-221).
- The `null-<slug>.md` fallback is unreachable, because seed enforces slug uniqueness (lib/seed.js:184, :198): the only caller of `lastCreated` (lib/seed.js:206) runs right after `newTask` returned 0, which happens only after writing `${id}-${slug}.md`, so `task ? task.id : null` (:221) never yields null; if it did, :206 would build `null-<slug>.md` and fail with a raw ENOENT. test/seed.test.mjs:76-110 covers the flow.

**5. The test helper re-implements template rendering** — verified — output was compared for ru and en at base.
- test/helpers.mjs:99-103 renders result.md with `replaceAll('{{id}}', …)`, `{{date}}` and `{{prefix}}`.
- `renderTemplate` (lib/templates.js:27-33) throws on a placeholder without a key. A new placeholder would therefore fail there, but stay literal in the helper.
- The output is identical to `renderTemplate(templateRel(lang, 'result.md'), { id, date, prefix })` for ru and en. The callers are test/fold.test.mjs:196 and test/lint.test.mjs:218.

## Work to do

- lib/templates.js: export `isToolRepo(root)`, a realpath comparison of `root/templates` with `TEMPLATES_DIR` that is false when either side fails to resolve. Use it at lib/lint.js:86, :122, :130 and :139 and at lib/init.js:88. Delete `lint.sameDir`. init.js no longer imports from lint.js.
- lib/templates.js: export `probeRule(cfg)`, moved from `brief.probeStep`. Use it at lib/init.js:111-113 and in brief.js.
- Move `projectName(root)` (it reads package.json through `readJsonOrNull` since BS-115 (`project-lang-fallback`)) out of lib/init.js into a non-command module (config.js or util.js). migrate.js imports it from there.
- lib/new.js: export `createTask(project, opts) -> { id, file }`, used by `new.run`. seed calls it directly and still prints the same `✔ <id>: <path>` line per task. Delete `seed.lastCreated`.
- test/helpers.mjs:99-103: use `renderTemplate(templateRel(lang, 'result.md'), { id, date, prefix })`.
- No CHANGELOG entry: nothing user-visible changes in this card (the JSON-reader behaviour changes are in BS-115 (`project-lang-fallback`)).

## Out of scope

- The mv→lint and merge-changelog→lint imports (handled by the BS-117 (`mv-reuses-task-model`) and BS-114 (`changelog-section-parser`) cards).
- The format of seed's output.
- scripts/release.mjs's own package.json reader (optional; the script lives outside lib/).

## Verification

- test/seed.test.mjs:76-110 passes, with the same `✔ BS-N:` lines on stdout.
- For a project with a `probe`, the AGENTS.md block from `init` and the `brief` output are byte-identical before and after the change.
- `grep -n "from './lint.js'\|from './init.js'\|from './new.js'" lib/init.js lib/migrate.js lib/seed.js` → no hit.
- `npm test`: every test passes. `node bin/backslop.js lint` → rc=0.
