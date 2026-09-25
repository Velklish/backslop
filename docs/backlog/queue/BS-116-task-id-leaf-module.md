# BS-116 · Move task id format, parsing, slug patterns and the commit-subject rule into lib/ids.js

- **Order:** 340
- **Scope:** [01. Layout](../../reference/01-layout.md) § task file
- **Created:** 2026-09-25
- **Dependencies:** BS-91, BS-105

## Context

Task id formatting, id parsing, the slug/stem patterns and the rule that recognises a task's commit subject are each written out in several places. log.js cannot import tasks.js (lib/log.js:1-2), which is one reason the copies exist. A leaf module removes that obstacle.

**1. Ids built by hand** — verified — read the code at base. The `placeInQueue` label was reproduced.
- `formatId` is at lib/tasks.js:98-100. The same string is built by hand at lib/fold.js:130 (inside the `pickOne` refusal, ru and en), at lib/log.js:42 and at lib/lint.js:270 (the parent id `${cfg.prefix}-${t.num}`). lib/fold.js:242 went away with the BS-91 (`fold-journal-eol-and-order`) card, which took batch entries from `scanTasks`.
- `placeInQueue` (lib/tasks.js:536) builds its label without the prefix: `${after.num}${after.sub === null ? '' : `.${after.sub}`}`. `--after` refusals therefore read `task 12 is not in the queue — --after expects a task from queue/`, where every other message says `BS-12`.
- `placeInQueue(rows, opts, lang)` has no prefix in scope, so the prefix has to be passed in from lib/mv.js:131. lib/new.js:129 never passes `after`.

**2. The id regex is duplicated** — verified — read the code at base.
- lib/tasks.js:104 (`parseId`) and :118 (`canonicalId`) run the same `String(raw ?? '').trim().match(new RegExp(`^(?:${prefix}-)?(\\d+)(?:\\.(\\d+))?$`, 'i'))`.
- They differ only when there is no match: `parseId` throws a CliError and `canonicalId` returns null.

**3. Slug and stem patterns are spelled out five times** — verified — read the code at base.
- The slug `[a-z0-9]+(?:-[a-z0-9]+)*` appears at lib/tasks.js:64 (`SLUG_RE`), :85 (`taskFileRe`) and :89 (`taskDirRe`), at lib/log.js:26 (`logLineRe`, which also spells `${prefix}-(\d+)(?:\.(\d+))?`) and at lib/adr.js:11 (`ADR_FILE_RE`, slug part only).
- `taskFileRe` and `taskDirRe` differ only by `\.md`.
- log.js escapes the prefix and tasks.js interpolates it raw. That is safe, because `PREFIX_RE` (lib/config.js:38, `/^[A-Z][A-Z0-9]{1,5}$/`) admits no regex metacharacters.

**4. The task commit subject rule** — verified — the tracks repro was rerun at base.
- `archive` (lib/archive.js:131-132) and `show` (lib/show.js:88) build equivalent regexes: `^<prefix>-0*N(\.0*k)?:`, with the number compared numerically and a colon required.
- `tracks` (lib/tracks.js:21) is deliberately looser: `^<prefix>-\d`. A branch without a worktree is listed only when `pendingCommits` is non-empty (lib/tracks.js:71-76), so tightening that rule would hide unmerged work.
- Repro: on branch `feat`, commit `BS-5 wip no colon` and then `BS-50x: typo number`. `B tracks` on main prints `task commits not in HEAD: 2` and lists both commits. The archive/show rule for N=5 does not match `BS-5 wip no colon`.
- The `show` row of docs/reference/02-cli.md wrongly says that show finds the commit by the same sign that `archive` and `tracks` use.

**Which behaviour wins.**
- The subject rule: `archive` and `show` share the strict rule. `tracks` keeps its loose rule, and the reference states that it does.
- The `placeInQueue` label gains the prefix. This is a user-visible message change.

## Work to do

- Create lib/ids.js, importing nothing from lib/ except lib/util.js if needed. It exports `formatId`, `matchId(raw, prefix) -> { num, sub } | null`, `SLUG_SRC`, `taskStemSrc(prefix)` and `taskSubjectRe(prefix, id)`. Point the importers of `formatId` (mv.js, new.js and others) at it; do not leave a re-export in tasks.js.
- lib/tasks.js: `parseId` becomes `matchId(...) ?? throw CliError`, and `canonicalId` becomes `matchId(...)` followed by `formatId`.
- Build `SLUG_RE`, `taskFileRe` and `taskDirRe` (lib/tasks.js:64-90), `logLineRe` (lib/log.js:26) and the slug part of `ADR_FILE_RE` (lib/adr.js:11) from `SLUG_SRC`/`taskStemSrc`.
- Use `formatId` at lib/fold.js:130, lib/log.js:42 and lib/lint.js:270.
- Add a `prefix` argument to `placeInQueue` and pass `cfg.prefix` from lib/mv.js:131. Build the label with `formatId`.
- Use `taskSubjectRe` at lib/archive.js:131-132 and lib/show.js:88. Keep lib/tracks.js:21 loose.
- Fix the `show` row in docs/reference/02-cli.md: `show` uses the `archive` rule (`<prefix>-N:`, number compared numerically), while `tracks` counts any subject that starts with `<prefix>-<digit>`.
- Add a CHANGELOG entry for the `--after` message change.

## Out of scope

- Tightening the `tracks` subject rule.
- Moving the scan logic out of tasks.js.
- Changing outcome detection in result.md, and sharing the outcome scan in lib/log.js (BS-105 (`dead-branches-markdown-journal`)).

## Verification

- New test in test/commands.test.mjs: `mv 3 queue --after 12`, when 12 is not in the queue, exits 1 with a message that contains `BS-12`.
- `node --test --test-timeout=60000 test/tasks.test.mjs test/archive.test.mjs test/show.test.mjs test/tracks.test.mjs test/commands.test.mjs; echo rc=$?` → rc=0 with the same test counts as before this card (only the new `--after` test is added).
- A grep over lib/ for the slug source `[a-z0-9]+(?:-[a-z0-9]+)*` → only lib/ids.js. No hand-built `<prefix>-<num>.<sub>` template string is left outside lib/ids.js.
- `npm test`: every test passes. `node bin/backslop.js lint` → rc=0.
