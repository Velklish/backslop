# BS-227 · migrate on the same version does not redraw its own files after the cli changes

- **Scope:** [02. CLI § migrate](../../reference/02-cli.md#migrate)
- **Created:** 2026-10-04
- **Dependencies:** none
- **Cost:** minor

## Context

On 2026-10-03, in the three projects of run bs020 (promptobus, diffalanche, ati-agents), `cli` in `backslop.json` changed from a pinned `npx github:…#v0.20.0` form to `npx --no-install backslop` on the same version. `migrate --dry-run` answered with exit 0 and "nothing to migrate". Some files the tool owns kept the old call form:
- the backlog and archive READMEs;
- `ROLES.md`;
- the `LOG.md` header.

For them the tool said they "match neither the en nor the ru render — kept until the next version update".

The workaround in all three projects was to replace the call form in those files by hand and then check `migrate --dry-run` again.

## Work to do

- When `cli` changes and the version does not, redraw the files the tool owns for the new `cli`, or name each of them with the command that redraws it.

## Out of scope

- Files a project edited by hand away from both renders.

## Verification

- A fixture on v0.20.0 whose `cli` changes from a pinned `npx` form to `npx --no-install backslop`: after `migrate`, the owned files carry the new form; a test fails on the old `migrate`.
