# BS-214 · CI on Windows: run the gates and verify platform and hook hypotheses

- **Scope:** [02. CLI](../../reference/02-cli.md)
- **Created:** 2026-10-03
- **Dependencies:** none

## Context

The runs that raised the original entries had no native Windows machine. Owner decision (2026-10-02): collect the seven then-open hypotheses in this verification task. Current-tree triage at `409099a689d496925d4be018394c7353c60fb3f3` finds BS-195.3 already closed and adds the still-open BS-215.1 launcher check. The five native Windows entries below are in `deferred/` by owner instruction for this run. The two live-harness entries remain separate `minor/` hypotheses; they are not Windows-specific and automated Windows gates cannot decide them. Native Windows execution and live harness observations remain separate evidence; static win32 configuration tests on macOS do not prove either.

Each open entry below is a hypothesis. The checks give the next step, not an observed result. Historical expected error strings and test counts are context; record the actual runner versions, capabilities, failing names, stdout/stderr and exits instead of forcing an old prediction to match.

- [BS-96.3](BS-96.3-slug-limit-ignores-windows-max-path.md) — a full path over MAX_PATH may fail although the file name fits 255 bytes. Check on Windows: from a checkout whose path length is known, run `node bin/backslop.js new <247-character slug> --queue` and `node bin/backslop.js adr <247-character slug>`. Confirmed: ENAMETOOLONG or ENOENT, or a queue left renumbered without the new file. Refuted: exit code 0 and the file exists. Record the path length and the `LongPathsEnabled` value of `HKLM\SYSTEM\CurrentControlSet\Control\FileSystem`, because long-path support decides the outcome (assumption: it is off by default for Node's file calls).
- [BS-127.1](BS-127.1-release-npm-spawn-on-windows.md) — `command()` in `scripts/release.mjs` spawns npm by its bare name with `spawnSync(bin, args)` and no shell. Check on Windows with Node 20.12.2 or later: `node -e "const r=require('node:child_process').spawnSync('npm',['--version']);console.log(r.error&&r.error.code,r.status)"`, then the same with `npm.cmd`. The historical entry predicted `ENOENT` for `npm` and `EINVAL` for `npm.cmd`; these predictions are not a fixed oracle across Node versions. Record both results and decide whether the actual command helper can invoke npm correctly, without publishing. A successful safe version probe refutes only the corresponding launcher failure. Never run `npm run release` itself on a runner without `--no-publish`, and not at all against `origin`.
- [BS-138.1](BS-138.1-windows-npx-launcher-unverified.md) — the `npx.cmd` shim written by the `win32` branch of `npxShim()` in `test/upgrade.test.mjs` and the 13 upgrade tests that lost their win32 skip never ran on Windows. Check: `node --test --test-timeout=60000 --test-reporter=tap test/upgrade.test.mjs` on Windows. Darwin baseline from the entry: 45 tests, 45 pass, 0 skipped. Confirmed broken: any of the unskipped tests fails; each failure is then a finding. Record the current test names and each skip reason/capability alongside the pass/fail totals; the historical expected six skips is not a current acceptance condition. No current native result is known.
- [BS-169.1](BS-169.1-windows-draft-recipe-powershell.md) — validate the documented `BACKSLOP_DRAFT` fold/commit recipe under Windows Git Bash, the shell required by `AGENTS.md:100`. In a disposable repository, save the draft with the documented command, commit with `git commit --cleanup=verbatim -F`, then compare `git log -1 --format=format:%B` with the draft bytes (the ordinary `--format=%B` adds a formatting newline). Record shell, Git and Node versions and direct exits. Historical PowerShell/cmd expectations are unverified optional portability experiments; failure of POSIX syntax in those shells is not a supported-contract defect.
- [BS-195.1](../minor/BS-195.1-hook-note-channel-not-observed.md) — whether the note `lib/hook.js` writes (`{"systemMessage": …}` on stdout for two harnesses, stderr text for the third) reaches the user. Check: a live session of each of the three harnesses with a hook that prints a note, and the screen of that session read by a person. A runner cannot do this. The overlapping documentation entry [BS-192.60](../../archive/LOG.md#bs-192.60) is closed into the documentation batch.
- [BS-195.2](../minor/BS-195.2-hook-codex-cursor-stop-not-run.md) — `hook stop` ran live only under one harness; the other two follow the protocols recorded in `docs/reference/01-layout.md` and the tests feed fake stdin only (`test/hook.test.mjs`). Check: a live Codex session and a live Cursor session (the entry says the latter works in an interactive terminal only) with the hook installed by `init --hooks`, each ended once, and the command's exit code, stdout and stderr read from the harness side. A runner cannot do this. The overlapping documentation entry [BS-192.61](../../archive/LOG.md#bs-192.61) is closed into the documentation batch.
- [BS-215.1](BS-215.1-local-hook-windows-launcher-check.md) — verify native Windows project-local launcher discovery and an installed hook with an offline local installation. The macOS logic test with a win32 config does not execute a Windows launcher. Record the generated launcher path, init and hook commands, stdout/stderr and exits; preserve the original Parent BS-215.

### Already-closed regression control

[BS-195.3](../../archive/LOG.md#bs-195.3) was closed into BS-219 (`docs/archive/LOG.md:401`). `lib/hook.js:121-128` preserves the first start and time for a repeated same-session event, and `test/hook.test.mjs:218-232` protects that behavior. Include the existing regression in the Windows gate run; do not reopen or archive BS-195.3 again as an undecided hypothesis. Live resume/compaction payload observations are additional harness evidence, not a reason to discard the recorded closure.

### Additional hypothesis: harness-root directory symlink fixture

A further static hypothesis was identified at audit baseline `44e74a32ff6a6b6c946321b3614b1881a2ccedfe`: `test/init.test.mjs:1049` declares `init: a symlink at a harness root — a refusal only for the selected adapter, before the first write` without a Windows skip, and lines 1053, 1074 and 1088 create directory symlinks. The adjacent case at line 1103 has an explicit win32 skip; `test/fold.test.mjs:547-548` and `568-569` identify the missing symlink privileges of those fixtures. These citations establish a potential fixture capability gap, not an observed Windows product failure.

On a native Windows runner without the capability to create these links, the fixture could stop in `symlinkSync` before it calls the CLI. With sufficient capabilities it may work. Neither a native Windows run nor an actual EPERM was obtained during the audit. The audit's macOS full-suite result (1240/1240, exit 0 at that SHA) does not decide this hypothesis. Preserve the seven currently open entries and the recorded closure of BS-195.3.

## Work to do

- On the native Windows runner, record the OS and Node versions and whether directory symlinks can actually be created with its current capabilities. Run `node --test --test-timeout=60000 --test-name-pattern="^init: a symlink at a harness root" test/init.test.mjs` and retain the complete output and direct exit code. This focused native run is not run in the filing pass. If the fixture fails before the CLI, distinguish that result from an incorrect selected-adapter refusal. A demonstrated defect is filed separately; any later explicit platform skip or capability-controlled fixture must be justified by that evidence and preserve Windows refusal coverage. Do not turn arbitrary EPERM into a silent skip.
- Add a CI configuration with a `windows-latest` job that checks out the repository, sets up Node 20 and the latest LTS, and runs `node bin/backslop.js gates`. Its log gives the "gates N, green N" line and the `npm test` verdicts; any red is a finding on the entries above or a new one, not a skip.
- In the same job, add steps for the checks above that a runner can run: BS-96.3 (the 247-character slug), BS-127.1 (the two `spawnSync` probes), BS-138.1 (the upgrade test file on its own), BS-215.1 (offline installed launcher/hook), and the already-existing BS-195.3 regression control. Each step prints its exit code and output into the log and does not hide a failure.
- The manual checks, by a person on a Windows machine: BS-169.1 in supported Git Bash (PowerShell/cmd are optional extra observations); BS-195.1 and BS-195.2 need live Codex and Cursor sessions, and a live session of the third harness for BS-195.1. Any extra resume/compaction observations are recorded separately from the already-closed BS-195.3 mechanism. Their results go into the entries or into a verification record, with the tool version.
- Record an individual outcome for each entry. A deferred dotted task uses its own `archive <N.M>`, completed `result.md` and `fold <N.M>` acceptance; `--into 214` is reserved for an entry still in `minor/` and requires this task to be archived first. Do not use a minor-batch command for deferred entries. Keep live-harness outcomes distinct from native Windows evidence.

## Out of scope

- Publishing or pushing from CI: the job only reads and tests; it never runs the release procedure.
- Fixing a Windows defect the job finds; each one is filed as its own finding with the run that shows it.
- A macOS or Linux job: the gates already run there by hand.

## Verification

- The additional harness-root symlink hypothesis has its own native Windows capability observation and focused-test outcome. Selected/unselected adapter cases, inside/outside targets, refusal before writes and existing-config behaviour remain protected; a passing macOS run is not used as the Windows verdict.
- The `windows-latest` job exists and its log shows the "gates N, green N" line with N equal to the number of commands in `gates` in `backslop.json`.
- For each of the seven open entries, the log or written observation names the check and confirms or refutes that hypothesis. Automated TAP output does not close the live user-visible note/stop transport checks. The symlink capability probe has a separate recorded outcome, and BS-195.3 remains a closed regression control.

## Deferred

- **Deferred:** 2026-10-03
- **Reason:** needs a Windows runner and a pushed branch; the owner merged seven hypotheses into this card on 2026-10-02.
- **Return condition:** a Windows runner is available to this repository (a CI service on the remote that offers one, or a Windows machine), and the owner allows a branch with the CI file to be pushed.
