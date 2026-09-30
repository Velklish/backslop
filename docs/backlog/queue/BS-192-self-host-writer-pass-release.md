# BS-192 · First technical-writer pass over backslop's own documentation, then release v0.14.0

- **Order:** 1060
- **Scope:** [Documentation index](../../README.md)
- **Created:** 2026-09-28
- **Dependencies:** BS-182, BS-183, BS-184, BS-185, BS-186, BS-187, BS-188, BS-189, BS-190, BS-191, BS-194, BS-195, BS-196

## Context

The last card of the block that ports the documentation rules (BS-183). backslop applies to itself what it now ships. The pass mirrors promptobus's first pass before its 0.20.0 release: currency and style ledgers, the ledger row per pattern as the check (see BS-189).

This repository runs with `tools: []` in `backslop.json`, so `init` lays nothing out here. The worker loads the templates directly:

- `templates/vendor/technical-documentation/SKILL.md`;
- `templates/vendor/humanizer/SKILL.md`;
- `templates/en/skills/backslop-writer/SKILL.md`.

## Work to do

- **The writer pass in release mode** over `v0.13.0..HEAD` on this repository's human-facing documentation, as scoped by `backslop-writer`:
  - currency: one row per behaviour-changing commit of the range;
  - style: one row per humanizer pattern, all 25;
  - one commit per document group.
- **The audit mode** on `README.md` and each page of `docs/reference/`: a score and a shippable verdict per document, every finding filed by the cost rule of BS-190.
- **`node bin/backslop.js links --external`:** record the output, fix every dead URL, and list the unverified ones in the result.
- **Gates** on the final tree: `lint` (including the new documentation checks) and `npm test`.
- **Release v0.14.0 at the owner's checkpoint,** by `AGENTS.md` § Release:
  - `npm run release -- 0.14.0 --bump`, then review and commit the diff;
  - `npm run release -- 0.14.0 --no-publish`.

  If the auto-mode classifier refuses the script's push, run the script's steps by hand and record each command with its exit code, as was done for v0.10.1.

## Out of scope

- Consumer projects: re-pinning them and clearing their documentation happen in their own migration tasks.
- Fixing a finding that needs a code change: it is filed, not fixed in the pass.

## Verification

- The style ledger has 25 rows, and every commit of `v0.13.0..HEAD` that changes behaviour has a currency row. The reviewer samples rewritten passages against the code.
- `links --external` reports 0 dead URLs.
- `node bin/backslop.js gates` exits 0 on the release commit: record `gates N, green M` and the test count.
- The tag `v0.14.0` points at the release commit, and `git ls-remote --tags origin v0.14.0` shows it after the push.
