# BS-214 · CI on Windows: run the gates on a Windows runner and check the seven Windows and hook hypotheses

- **Scope:** [02. CLI](../../reference/02-cli.md)
- **Created:** 2026-10-03
- **Dependencies:** none

## Context

The repository has no CI configuration (no `.github/`), and no Windows machine was available in the runs that raised the entries below. `AGENTS.md` says Windows is supported, yet every Windows statement in the code and the documentation rests on reading the code. Owner decision (2026-10-02): the seven hypothesis entries are merged into this one card. They stay in `minor/` unchanged and are closed into this card when it is done.

Each entry below is a hypothesis; the check is taken from its Evidence line, and no result is known.

- [BS-96.3](../minor/BS-96.3-slug-limit-ignores-windows-max-path.md) — a full path over MAX_PATH may fail although the file name fits 255 bytes. Check on Windows: from a checkout whose path length is known, run `node bin/backslop.js new <247-character slug> --queue` and `node bin/backslop.js adr <247-character slug>`. Confirmed: ENAMETOOLONG or ENOENT, or a queue left renumbered without the new file. Refuted: exit code 0 and the file exists. Record the path length and the `LongPathsEnabled` value of `HKLM\SYSTEM\CurrentControlSet\Control\FileSystem`, because long-path support decides the outcome (assumption: it is off by default for Node's file calls).
- [BS-127.1](../minor/BS-127.1-release-npm-spawn-on-windows.md) — `command()` in `scripts/release.mjs` spawns npm by its bare name with `spawnSync(bin, args)` and no shell. Check on Windows with Node 20.12.2 or later: `node -e "const r=require('node:child_process').spawnSync('npm',['--version']);console.log(r.error&&r.error.code,r.status)"`, then the same with `npm.cmd`. Confirmed: `ENOENT` for `npm` and `EINVAL` for `npm.cmd` (the Evidence line expects exactly these). Refuted: both print a version. Never run `npm run release` itself on a runner without `--no-publish`, and not at all against `origin`.
- [BS-138.1](../minor/BS-138.1-windows-npx-launcher-unverified.md) — the `npx.cmd` shim written by the `win32` branch of `npxShim()` in `test/upgrade.test.mjs` and the 13 upgrade tests that lost their win32 skip never ran on Windows. Check: `node --test --test-timeout=60000 --test-reporter=tap test/upgrade.test.mjs` on Windows. Darwin baseline from the entry: 45 tests, 45 pass, 0 skipped. Confirmed broken: any of the unskipped tests fails; each failure is then a finding. Refuted: all pass and the skipped count is the six that keep the win32 skip.
- [BS-169.1](../minor/BS-169.1-windows-draft-recipe-powershell.md) — the `BACKSLOP_DRAFT` recipe of `fold` in PowerShell and `cmd.exe`. Check: in a throwaway repository, write the draft in Git Bash, Windows PowerShell 5.1 (`>`), PowerShell 7 (`$d = git rev-parse --git-dir; <cli> fold N | Out-File -Encoding utf8NoBOM "$d/BACKSLOP_DRAFT"`) and `cmd.exe` (the POSIX recipe as written, to see how it fails), commit with `git commit --cleanup=verbatim -F`, and read the message back in each with `git log -1 --format=%B`, piped through `od -c | head` in Git Bash. Confirmed: NUL bytes after a `>` in PowerShell 5.1, and `$(...)` not expanded in `cmd.exe`. Refuted: the message is the draft in every shell.
- [BS-195.1](../minor/BS-195.1-hook-note-channel-not-observed.md) — whether the note `lib/hook.js` writes (`{"systemMessage": …}` on stdout for two harnesses, stderr text for the third) reaches the user. Check: a live session of each of the three harnesses with a hook that prints a note, and the screen of that session read by a person. A runner cannot do this. The overlapping documentation entry [BS-192.60](../../archive/LOG.md#bs-192.60) is closed into the documentation batch.
- [BS-195.2](../minor/BS-195.2-hook-codex-cursor-stop-not-run.md) — `hook stop` ran live only under one harness; the other two follow the protocols recorded in `docs/reference/01-layout.md` and the tests feed fake stdin only (`test/hook.test.mjs`). Check: a live Codex session and a live Cursor session (the entry says the latter works in an interactive terminal only) with the hook installed by `init --hooks`, each ended once, and the command's exit code, stdout and stderr read from the harness side. A runner cannot do this. The overlapping documentation entry [BS-192.61](../../archive/LOG.md#bs-192.61) is closed into the documentation batch.
- [BS-195.3](../../archive/LOG.md#bs-195.3) — `sessionStart` in `lib/hook.js` overwrites the record of the same harness and session, so a start event repeated on resume or compaction moves the start point. The entry names no check; this one is derived from its Evidence. Mechanism, runnable anywhere: feed `hook session-start --harness claude` the same `session_id` twice with a change between the calls, then `hook stop`, and see whether the change is in the changed set. Trigger, live only: resume and compact a live session of each harness and read the `source` value of the start payload (only `startup` has been seen).

## Work to do

- Add a CI configuration with a `windows-latest` job that checks out the repository, sets up Node 20 and the latest LTS, and runs `node bin/backslop.js gates`. Its log gives the "gates N, green N" line and the `npm test` verdicts; any red is a finding on the entries above or a new one, not a skip.
- In the same job, add steps for the checks above that a runner can run: BS-96.3 (the 247-character slug), BS-127.1 (the two `spawnSync` probes), BS-138.1 (the upgrade test file on its own) and the mechanism half of BS-195.3. Each step prints its exit code and output into the log and does not hide a failure.
- The manual checks, by a person on a Windows machine: BS-169.1 in four shells (Git Bash, PowerShell 5.1, PowerShell 7, `cmd.exe`); BS-195.1 and BS-195.2 need live Codex and Cursor sessions, and a live session of the third harness for BS-195.1; the trigger half of BS-195.3 needs live sessions as well. Their results go into the entries or into a verification record, with the tool version.
- When the checks are done, close the seven entries into this card with `archive <N.M> --into 214`, each with the log line or the observation that decided it.

## Out of scope

- Publishing or pushing from CI: the job only reads and tests; it never runs the release procedure.
- Fixing a Windows defect the job finds; each one is filed as its own finding with the run that shows it.
- A macOS or Linux job: the gates already run there by hand.

## Verification

- The `windows-latest` job exists and its log shows the "gates N, green N" line with N equal to the number of commands in `gates` in `backslop.json`.
- For each of the seven entries, the log or a written observation names the check run and whether it confirmed or refuted the hypothesis.

## Deferred

- **Deferred:** 2026-10-03
- **Reason:** needs a Windows runner and a pushed branch; the owner merged seven hypotheses into this card on 2026-10-02.
- **Return condition:** a Windows runner is available to this repository (a CI service on the remote that offers one, or a Windows machine), and the owner allows a branch with the CI file to be pushed.
