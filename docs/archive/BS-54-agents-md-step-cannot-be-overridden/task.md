# BS-54 · Нумерованный шаг блока `AGENTS.md` не переопределяется проектом, и приписка ниже агентом не читается

- **Порядок:** 40
- **Область:** генератор блока `AGENTS.md` (`init`), точки расширения блока
- **Создана:** 2026-09-12
- **Зависимости:** нет

Filed from promptobus (PB-95). Same family as BS-24 and the `quote:` report: a rule the
generator writes, which the consuming project cannot change even when its own measurement
has moved past it.

## What happens

`backslop init` writes the whole procedure into the `backslop:start` … `backslop:end`
block of `AGENTS.md`, step 4 included:

> **Gates before reporting.** … Verify a test change with a mutation probe: commit first,
> then run the probe.

That sentence describes four manual steps. This project has since replaced them with a
script — `npm run probe`, which refuses on a dirty tree instead of relying on the agent
remembering, and whose restore comes from a snapshot rather than from git. The line in
`AGENTS.md` still sends every agent through the manual dance.

It cannot be corrected in the consuming repository. Measured 2026-09-12 on backslop
v0.6.0, clean tree:

1. the line was edited in place, with a marker, and the marker was present;
2. `npx github:Velklish/backslop#v0.6.0 init --prefix PB --lang en --tools claude,cursor,codex`
   exited 0 and reported `AGENTS.md: backslop block updated`;
3. the marker was gone — the generated text was back.

The project's CI runs `init` before `lint` on every push, so even a correction that
survived locally would be undone there.

## Why it is worth a change upstream rather than a local workaround

The block is the right place for the procedure — that is the whole point of a managed
block, and nobody is asking for it to stop being managed. What is missing is a way for a
project to say "step 4 is done differently here" without either forking the template or
editing a file the tool owns.

Two shapes, and the choice is backslop's:

- **A per-step override in `backslop.json`** — a key whose value replaces or appends to the
  text of one numbered step, rendered by `init` inside the block like everything else. The
  project keeps one source of truth and `init` stays the owner of the file.
- **A stable extension point below the block** — `init` emits an `<!-- backslop:project -->`
  marker it never rewrites, and the project puts its deviations there. Cheaper to build,
  but it leaves step 4 saying one thing and the paragraph below it another, which is worse
  for an agent reading top to bottom than for a person.

The first is preferred here for that reason: an agent follows the numbered step it is
given and does not reconcile it with a note further down.

## What the consumer did in the meantime

Nothing to `AGENTS.md` — deliberately, since the edit would not survive. The script exists
(`npm run probe`), the contributing guide names it, and the CHANGELOG records that the
`AGENTS.md` line is stale and why it was left alone. An agent reading the block still gets
the old procedure, and that is the cost being reported.
