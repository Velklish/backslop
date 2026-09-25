# BS-96 · File-system shape errors from user input become CliError refusals before any write

- **Order:** 140
- **Scope:** [02. CLI](../../reference/02-cli.md)
- **Created:** 2026-09-25
- **Dependencies:** BS-94

## Context

Line numbers refer to base commit 6f6318e (v0.11.0). `$BS` below is `node <repo>/bin/backslop.js`; throwaway projects are created with `git init -q && $BS init --lang en --tools none` unless stated otherwise.

docs/reference/02-cli.md:3 fixes the contract: a refusal addressed to a human is a `CliError` printed without a stack; any other exception is a code error (bin/backslop.js:164-171 rethrows it). Five verified bugs break that contract on ordinary user input, and three of them leave a half-written state.

**1. Minor — a symlink one level below an unselected harness root makes init fail after it wrote the config and skeleton.** verified — reproduced on 6f6318e.
- `.claude/skills/backslop-task -> <shared dir>` with the claude harness not selected: `$BS init --tools cursor` (or plain `init`) → rc=1 `✖ adapter path contains a symlink: .claude/skills/backslop-task` with backslop.json and docs/ already on disk; a repeated `init` (also `--tools none`) fails the same way. Control: the link on the root `.claude/skills -> <shared>` → rc=0.
- Root cause: `cleanupAdapters` skips an unselected adapter only when its ROOT has a symlink component (lib/adapters.js:210); otherwise `cleanupCandidates` adds the template paths (lib/adapters.js:196) and `ownedPath(root, file, cfg.lang)` (lib/adapters.js:217) throws. This runs at lib/init.js:155, after `saveConfig` (lib/init.js:98) and the skeleton (lib/init.js:133-151), contradicting lib/init.js:94-95 ("checked before the first write") and docs/reference/01-layout.md:30 (a refusal happens while neither config nor skeleton exists).

**2. Low — init dies with a stack when `docs` is a file, AGENTS.md is a directory, or an adapter root is a file.** verified — reproduced on 6f6318e.
- `printf x > docs; $BS init --tools none` → rc=1, `Error: EEXIST: file already exists, mkdir '…/docs'` at lib/init.js:140, backslop.json already written. `mkdir AGENTS.md; $BS init --tools none` → rc=1 `EISDIR` at lib/init.js:291, backslop.json and docs/ written. `mkdir .cursor && printf x > .cursor/rules; $BS init --tools none` → rc=1 `ENOTDIR` from `readdirSync` at lib/adapters.js:166, config and docs written.
- Root cause: lib/init.js:140-141 `mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(…)`; lib/init.js:291 `readFileSync(file, 'utf8')` in `upsertBlock`; lib/adapters.js:159-160 `if (!existsSync(adapterRoot)) return []; return localFiles(adapterRoot)` runs for every tool in `cleanupAdapters` (lib/adapters.js:206-212) regardless of selection. lib/adapters.js:48-59 and :137-139 already convert the same fs errors into CliErrors on other paths.

**3. Minor — a layout entry that is a file instead of a directory crashes lint.** verified — reproduced on 6f6318e.
- `rm -r docs/backlog/queue && echo x > docs/backlog/queue && $BS lint` → rc=1, `Error: ENOTDIR: not a directory, scandir '…/docs/backlog/queue'` at `scanTasks` (lib/tasks.js:130) from `lintProject` (lib/lint.js:48); the same for docs/adr as a file (lib/adr.js:15; `backslop adr` crashes too) and docs/archive/BS-1-x/minor as a file (lib/tasks.js:150).
- Root cause: `if (!existsSync(dir)) continue; for (const e of readdirSync(dir, …))` — `existsSync` is true for a regular file — at lib/tasks.js:129-130, :148-150, lib/adr.js:14-15, lib/lint.js:276-277, :434-436. lib/lint.js:48 scans before any gate, so gate 3 never reports the file. test/init.test.mjs:812-820 asserts the norm: a file on a path component is refused in words.

**4. Minor — `mv` with a directory at the destination moves the task INTO it, then crashes with the batch half-applied.** verified — reproduced on 6f6318e (git 2.54.0).
- BS-1, BS-2 in queue/, committed; `mkdir -p docs/backlog/active/BS-2-b.md`; `$BS mv 1 2 active` → `✔ BS-1: queue/ → active/ …`, then `Error: EISDIR: illegal operation on a directory, read` at `readText` (lib/tasks.js:349) via `relocateTask` (:597) and `moveOne` (lib/mv.js:139), rc=1; `git status --short` shows `RM …/queue/BS-1-a.md -> …/active/BS-1-a.md` and `R  …/queue/BS-2-b.md -> docs/backlog/active/BS-2-b.md/BS-2-b.md`; lint afterwards reports 14 errors.
- Root cause: `resolve()` (lib/mv.js:86-97) checks only source-side refusals; `moveOne` builds `to` at lib/mv.js:134 and `moveFile` runs `git mv -- from to` (lib/tasks.js:578) without checking that `to` is free. docs/reference/02-cli.md:37 states that every refusal visible before the move happens before the first move; test/commands.test.mjs:650 requires the source-side twin of this case to refuse without a stack.

**5. Low — `new`/`adr` with an over-long slug crash with ENAMETOOLONG; `new --queue` renumbers neighbours first.** verified — reproduced on 6f6318e.
- `$BS new $(printf 'a%.0s' $(seq 1 300))` → rc=1, `Error: ENAMETOOLONG: name too long, open '…/BS-1-aaa…a.md'` at `writeText` (lib/tasks.js:355) from lib/new.js:136; `adr <300 chars>` the same from lib/adr.js:35. `new <300 chars> --queue --top` with no integer gap renumbers queue neighbours (1/2 → 20/30) and then crashes, leaving the queue changed without a new task.
- Root cause: lib/new.js:54 and lib/adr.js:31 validate the slug only with `SLUG_RE` (lib/tasks.js:64, no length bound); the renumbering at lib/new.js:133-135 runs before the failing write. docs/reference/02-cli.md:18 lists a bad slug as a refusal.

## Work to do

- Bugs 1, 2 (init): before the first write, stat the docs path, AGENTS.md, .gitignore and each SELECTED adapter root and refuse with a CliError naming the path (`docs is a file, expected a directory`, `AGENTS.md is a directory`); in cleanup, treat an unselected adapter whose candidate path has any symlink component or whose root is not a directory as nothing to clean (skip, never refuse).
- Bug 3 (lint/adr): guard each `readdirSync` of a layout directory with `statOrNull(dir)?.isDirectory()`; let gate 3 / gate 5 / gate 8 report `<path> is a file, expected a directory` as an ordinary error, and make `backslop adr` refuse with the same text.
- Bug 4 (mv): in `resolve()` (or a pre-move pass over the planned moves) compute each destination and refuse with a CliError when it exists (file or directory), before the first move.
- Bug 5 (new/adr): bound the slug so `<prefix>-<N.k>-<slug>.md` stays under 255 bytes (refuse with a CliError naming the limit), checked before any neighbour is renumbered.
- Add the regression tests listed under Verification (test/init.test.mjs, test/lint.test.mjs, test/commands.test.mjs).

## Out of scope

- Validation of backslop.json values — the BS-94 (`config-validation-one-rule-set`) card this card depends on (same init code).
- Converting ENOENT/EISDIR of `merge-changelog --out` — the BS-87 (`merge-changelog-structure-and-io`) card.

## Verification

- New tests (bugs 1, 2): each of the four shapes (`.claude/skills/backslop-task` link with claude unselected; `docs` file; `AGENTS.md` directory; `.cursor/rules` file with `--tools none`) → the link/unselected cases rc=0 with the link target untouched; the file/directory cases rc=1 with a `✖` line, no stack, and no backslop.json on disk.
- New test (bug 3): docs/backlog/queue, docs/adr and docs/archive/BS-1-x/minor as files → `lint` rc=1 with a gate message naming the path, no stack.
- New test (bug 4): directory at `docs/backlog/active/BS-2-b.md` → `mv 1 2 active` rc=1, `git status --porcelain` unchanged.
- New test (bug 5): 300-character slug → `new` and `adr` rc=1 with the slug-length refusal; with `--queue --top` the neighbours keep their ranks.
- `npm test` → rc=0; `node bin/backslop.js lint` → rc=0.
