# BS-200 · Release v0.14.0

- **Order:** 1080
- **Scope:** [Documentation index](../../README.md)
- **Created:** 2026-10-02
- **Dependencies:** BS-192, BS-192.46, BS-192.47, BS-192.48, BS-192.49, BS-192.50, BS-192.51, BS-192.52, BS-192.53, BS-192.54, BS-192.55, BS-192.56, BS-192.57, BS-192.58, BS-192.59, BS-192.60, BS-192.61

## Context

The release step of the first technical-writer pass, split out of BS-192 — First technical-writer pass over backslop's own documentation. The pass itself, its ledgers and its audit are BS-192; this card holds the release, which runs at the owner's checkpoint by `AGENTS.md` § Release.

The release waits for the sixteen critical hypotheses BS-192.46 to BS-192.61 listed in Dependencies. Each states what another product does (how a harness runs a project hook, where it reads skills and rules, how promptobus treats a hook file) and the audit could not confirm it in the pass. The owner decided on 2026-10-02 that such a statement is handled strictly by the audit rule for evidence out of reach (`templates/en/skills/backslop-writer/SKILL.md:102`), so the release is held and each of them is closed first, either by the live run that its Verification names, with the commands and exit codes in the closing commit message, or by rewording the statement to what this repository can show. The documents that carry them are `README.md`, `docs/reference/01-layout.md`, `docs/reference/02-cli.md`, `docs/reference/03-lint.md`, `docs/reference/05-orchestrator-contract.md`, `docs/GLOSSARY.md` and the unreleased section of `CHANGELOG.md`.

The ten `major` cards of the audit (BS-192.7, BS-192.8, BS-192.9, BS-192.18, BS-192.19, BS-192.20, BS-192.26, BS-192.27, BS-192.31, BS-192.36) wait until after the release: they are findings of structure and style, not statements that are wrong, and none of them blocks it.

## Work to do

- Close each critical hypothesis BS-192.46 to BS-192.61: run its live check, or reword the statement; archive the entry by the batch that closes it.
- Release v0.14.0 at the owner's checkpoint, by `AGENTS.md` § Release:
  - `npm run release -- 0.14.0 --bump`, then review and commit the diff;
  - `npm run release -- 0.14.0 --no-publish`.

  If the auto-mode classifier refuses the script's push, run the script's steps by hand and record each command with its exit code, as was done for v0.10.1.

## Out of scope

- Consumer projects: re-pinning them and clearing their documentation happen in their own migration tasks.
- The ten `major` audit cards listed in Context: they are worked after the release.
- Fixing a finding that needs a code change.

## Verification

- None of BS-192.46 to BS-192.61 is left in `docs/backlog/minor/` at the release commit.
- `node bin/backslop.js gates` exits 0 on the release commit: record `gates N, green M` and the test count.
- The tag `v0.14.0` points at the release commit, and `git ls-remote --tags origin v0.14.0` shows it after the push.
