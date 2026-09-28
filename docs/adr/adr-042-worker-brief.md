# ADR-042: The worker brief is rendered by a command from a template

**Status:** Accepted
**Date:** 2026-09-28
**Deciders:** Velklish

## Context

An orchestrator hands each parallel worker a self-contained brief: the worker does not see the orchestrator's context, so whatever the brief leaves out, the worker does not know. Most of a brief is on disk (task definitions, the gates list, the project command) or is fixed wording (how to commit, how to report); only a few items are real per-run decisions. Hand-written briefs drop items silently, and nobody notices the gap until a worker reports without it. The brief is often rendered by a newer CLI than the one the project pins, so it can name commands the pinned version lacks. A template placeholder without a value used to reach the reader as a literal `{{name}}`.

## Options

- **A hand-written brief per run** — items drop silently.
- **A brief sent by the tool over a transport** — couples the tool to one harness and its way of starting a session.
- **Silent defaults for the decision slots** — the worker cannot tell a default from a decision.
- **Rendering with the pinned CLI only** — the orchestrator would need that exact version installed.
- **A per-flag version constant with a template branch for older pins** — one more branch per flag, in both template languages.

## Decision

- **Command and output.** `brief <N…> [--track "…"] [--neighbour "path=track"]… [--entry "…"] [--autonomy "…"] [--handover "…"] [--measurements]` (`run` in `lib/brief.js`) renders `templates/brief.md`, or `templates/en/brief.md` for a project with `lang: en` (`renderProjectTemplate` in `lib/templates.js`), and writes the brief to stdout only; how it reaches the worker is the orchestrator's choice. Config inputs: `prefix`, `cli`, `gates` (including `when`), `probe` and `lang`.
- **Refusals.** Exit code 1 and nothing on stdout for: no task numbers; a number found in no status directory and not in the archive; an archived task without `task.md`, a task folded into the journal included; a `--neighbour` value not of the form `path=track`.
- **Task blocks.** Each task block carries the id, the title (the slug when the file has none), the file path, and only the "Work to do" and "Out of scope" sections (`taskBlock`); the worker reads the file itself for the rest.
- **Five decision slots.** The orchestrator's per-run decisions are slots, each filled by a text flag:
  - the track title — `--track`;
  - the neighbours — `--neighbour "path=track"`, repeatable; renders "everything not listed below is yours" plus one line per neighbouring track (`neighbours`);
  - the entry point — `--entry`;
  - what the worker decides itself — `--autonomy`;
  - the hand-off form — `--handover`.

  An absent flag prints a `[TODO: …]` stub that says what is missing and what the gap costs, never a silent default. The `backslop-batch` skill lists the same five in both template layers.
- **Measurements.** `--measurements` adds the measurement bullet; without it the slot is empty (`measurements`).
- **Gates step** (`gatesStep`). An empty `gates` list renders a line telling the worker to ask the orchestrator what checks the task. Otherwise each entry renders as its command; when any entry carries `when`, a note says that skipped entries print as "not run N" and never add to the green count; the step names `<cli> gates` and its "gates N, green N" summary and asks for the exit code of the command, not of a pipe. The step has no branch by pin.
- **Mutation-probe item.** `{{probeRule}}` is the probe sentence of `templates/agents-probe.md` with the project's `probe` command, rendered by the same `probeRule` in `lib/templates.js` that `init` uses ([the probe ADR](adr-041-probe-command.md)). Without `probe` the item carries no sentence, and `brief` writes a note to stderr so stdout stays a clean brief.
- **Placeholder and key contract, for every template.** `renderTemplate` in `lib/templates.js` throws on a placeholder with no key in the values passed. `TEMPLATE_KEYS` in the same file declares the keys per template group. Lint gate 12 (`templateSlots`, run by `lintTemplateSlots` in `lib/lint.js`) checks both directions — a placeholder without a declared key and a declared key no template of its group uses — over both language layers, only in the tool's own repository. The template parity check (`templateParity`) keeps the English twin in step: same files, same placeholders, same headings.
- **The pin.** The brief names the commands of the CLI that renders it, which is often newer than the project's pin. When `cli` is pinned below `BRIEF_COMMANDS_SINCE`, the first version that has every command the brief names, `brief` prints a note on stderr naming what the pin lacks (`new --minor --evidence`) and `<cli> upgrade` as the remedy (`warnForMissingBriefCommands`); stdout is unchanged. A `cli` without a pin gets no note.

## Consequences

- Brief composition lives in one template pair: an item is in every brief or in none.
- Adding a slot is one move across four places: the placeholder in both templates, the key in the values `lib/brief.js` passes, the entry in `TEMPLATE_KEYS`, and the bullet in both layers of the `backslop-batch` skill.
- A key passed in the values but used by no placeholder is not caught; the gate checks declared keys, not the object a command builds.
- Output is two-stream: the brief on stdout, notes on stderr, so `brief > file` keeps notes out of the file.
- A new command the brief names raises `BRIEF_COMMANDS_SINCE` and rewrites the note, which names the version and the command in both languages; the note replaces a template branch per version.
