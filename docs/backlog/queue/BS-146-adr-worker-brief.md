# BS-146 · One English ADR on the worker brief replaces ADR-010, ADR-017 and ADR-018

- **Order:** 640
- **Scope:** [02. CLI](../../reference/02-cli.md) § brief
- **Created:** 2026-09-25
- **Dependencies:** BS-108, BS-90, BS-145

## Context

Four Russian ADRs describe the `brief` command: docs/adr/adr-010-brief-command.md, adr-017-gates-step-follows-the-pin.md, adr-018-brief-decision-slots.md and adr-025-probe-rule-in-skill-and-brief.md (BS-145 (`probe-command-adr`) replaced ADR-025 including its brief sentence). Their synopses are stale and one claim is false for supported consumers. This card writes one English ADR on the brief, deletes the three files it replaces and removes the links to them.

Line numbers below are at base commit 6f6318e (v0.11.0), where `npm test` passes 450 tests and `node bin/backslop.js lint` exits 0. The cards named under Dependencies change some of the cited code; read the code on the commit you start from and cite file:line from that commit, not from this card.

Dependencies change this topic: the BS-108 (`drop-pre-floor-version-gates`) card deletes `GATES_SINCE`, `pinHasGates` and the fallback text for pins without the `gates` runner (lib/brief.js:12-14, :115-120, :143-146), so the gates step always names the runner; the BS-90 (`brief-follows-cli-pin`) card decides and implements how the brief handles a pin that lacks a command the brief names. The ADR records the code after both.

**Rules to record** (verified — read at 6f6318e against the cited lines; the brief was run live in a throwaway project):
- Command: `brief <N…> [--track] [--neighbour path=track]… [--entry] [--autonomy] [--handover] [--measurements]` (lib/brief.js:17-24) renders templates/brief.md, or templates/en/brief.md when lang is en (lib/brief.js:52, lib/templates.js:9-11, :35-37), and writes the brief to stdout only; delivery is the orchestrator's choice. Config inputs: prefix, cli, gates (including `when`), probe, lang.
```text
- Refusals, exit 1 and nothing on stdout: no task numbers (lib/brief.js:27-31); a number in no status directory or archive (:34-41, live: `brief 99` → rc=1 `✖ задачи BS-99 нет ни в одном каталоге статуса и в архиве`); an archived task without task.md (:44-48); `--neighbour` not of the form path=track (:102-106, live rc=1).
```
- Each task block carries id, title (slug fallback), file path and only the 'Work to do' and 'Out of scope' sections; the worker reads the file itself (lib/brief.js:83-92).
- Five orchestrator decisions are slots — track, neighbours, entry, autonomy, handover; an absent flag prints a `[TODO: …]` stub that says what is missing and what it costs, never a silent default (lib/brief.js:53-64, :96-101). `--neighbour` is repeatable and renders 'everything not listed is yours' plus one line per neighbour (:109-112). The batch skill lists the same five (templates/skills/backslop-batch/SKILL.md:52, en twin :52).
- `--measurements` appends the measurement bullet, otherwise the slot is empty (lib/brief.js:69, :155-159).
- Gates step (lib/brief.js:122-147): empty `gates` → ask the orchestrator what checks the task (:124-128); entries render as their command (:129-130); when any entry has `when`, a note says skipped gates print as 'not run N' and never count as green (:133-138); the step names `<cli> gates` and its 'gates N, green N' summary and asks for the exit code of the command, not of a pipe (:139-143).
- Mutation-probe bullet: `{{probeRule}}` is the rendered templates/agents-probe.md with the project's probe command, built by the same expression as init (lib/brief.js:151-153 = lib/init.js:111-113); empty when `probe` is absent, and then a note of the same kind as init's goes to stderr so stdout stays a clean brief (lib/brief.js:73-77, lib/util.js:15; live: rc=0, note on stderr, `grep -c 'потом проба' brief.out` → 0).
- Placeholder↔key contract for every template, not only the brief: `renderTemplate` throws on a placeholder with no key (lib/templates.js:27-33); `TEMPLATE_KEYS` declares keys per template group (lib/templates.js:15-23 — cite the registry, do not paraphrase its groups); lint gate 12 checks both directions over both language layers, only in the tool's own tree (lib/templates.js:110-136, lib/lint.js:128-132, sameDir at :75-81); template parity keeps the en twin in step (lib/templates.js:73-106, lib/lint.js:120-124).
- Pin rule, stated generally: the brief names the commands of the CLI that renders it, which is often newer than the pin. For a cli pinned below the first version that has every command the brief names, `brief` prints a stderr note naming what the pin lacks and `<cli> upgrade` as the remedy; stdout is unchanged. Record how the code does this after the BS-90 (`brief-follows-cli-pin`) card.

**Text that must not carry over:**
- ADR-017:30 'apart from `gates` there is nothing to branch in the block' and the comment lib/brief.js:12-13. verified — a live run — the brief names `new <slug> --parent N[.M] --minor --evidence "…"` (templates/brief.md:34-35), and a project pinned at v0.9.0 rejects it: `node <v0.9.0 checkout>/bin/backslop.js new probe-x --parent 1 --minor --evidence 'x'` → rc=1 `✖ Unknown option '--evidence'` (`--evidence` arrives in v0.10.0, lib/new.js:48-49). The fix is the BS-90 (`brief-follows-cli-pin`) card.
- ADR-010:36 flag synopsis lacks `--entry/--autonomy/--handover` and names only gates/prefix/cli as inputs. verified — those were added later by ADR-018:27 and ADR-025:34/42 without marking ADR-010 refined; ADR-010:36 does name the English twin.
- ADR-010:48 'the batch skill describes only two orchestrator decisions' — verified false: SKILL.md:52 in both layers says five, and lib/brief.js:53-64 renders five.
- ADR-017:26 omits the empty-gates branch that shipped in the same commit (verified — live, a pin ≥ 0.5.0 with `gates: []` prints the ask-the-orchestrator line and no runner line); the when-scope note is recorded in the gates-scope ADR, not here.
- ADR-018:31 paraphrases the shared `TEMPLATE_KEYS` group as 'docs/ and skills/'; lib/templates.js:16 also covers agents-section.md (verified — imprecise, not contradicted).
- ADR-025:9 'a year later' — ADR-021 is dated 2026-09-16 and ADR-025 2026-09-22 (verified). The new ADR carries no timeline.
- Status lines of ADR-010/017/021 read plain Accepted though later ADRs refine them (verified — read). Moot: the rows are replaced.
- Artifacts to drop: ADR-017:13 (run dates, archive link), ADR-018:11 (bus-run measurements), ADR-025:5, :11, :24 (run id, task numbers, neighbouring-track rationale).

**How to write a consolidated ADR (applies to every ADR this card creates).** Create it with `node bin/backslop.js adr <slug> --title "<title>"` (the repository runs with `lang: en`, so the English template with Context / Options / Decision / Consequences is used and the number is the next free one; if another card takes the same number first, renumber on rebase: lint gate 8 refuses duplicate numbers). Header: `Status: Accepted`, `Date:` the day you write it, `Deciders: Velklish`. The text must not mention the numbers or file names of the ADRs it replaces, task or finding numbers, run ids, commit hashes, dated measurements or "owner decision of <date>" notes. Cite code by file and function name, not by line number (line numbers below are at base commit 6f6318e and only help you find the code). Options keeps only the rejected alternatives that still explain the choice, each with its cost in one sentence. Then delete the replaced ADR files and replace their rows in `docs/README.md` with one row for the new ADR (topic in English, Status equal to the Status line of the file; keep the table's current column layout). Every remaining reference to a deleted file is handled in the same card: links in `CHANGELOG.md` lose their link markup and old ADR tokens (the CHANGELOG rewrite drops them anyway); links and citations in `docs/reference/`, `docs/GLOSSARY.md` and `AGENTS.md` are dropped, not repointed (rules there carry no ADR citations); code and test comments that cite an old ADR get the new ADR id (`ADR-NNN`) and lose quoted section names the new ADR does not have — comments stay at most two lines and 100 code points per line (`npm test` enforces it).

**Links at 6f6318e:** docs/README.md:21, :28, :29, :36; comments lib/brief.js:2 (ADR-010), :12 (ADR-017, deleted with `GATES_SINCE` by the dependency); CHANGELOG.md:51 (ADR-025 link, next to an ADR-021 link that is not this card's), :73 (ADR-018), :75 (ADR-017). No other ADR file, reference page, template or test cites ADR-010/017/018/025. ADR-010:27 links adr-003 (another cluster) and disappears with the file.

## Work to do

- Create the ADR: `node bin/backslop.js adr worker-brief --title "The worker brief is rendered by a command from a template"`. Context: an orchestrator hands each parallel worker a self-contained brief; most of it is on disk or fixed wording, only a few items are real per-run decisions; hand-written briefs drop items silently; the brief is often rendered by a newer CLI than the pin; a placeholder without a value used to reach the reader as a literal `{{name}}`.
- Decision: one bullet per rule of 'Rules to record', checked against current code, with the gates step as it is after the BS-108 (`drop-pre-floor-version-gates`) card (no pin branch) and the pin rule as implemented by the BS-90 (`brief-follows-cli-pin`) card.
- Options, one line each: a hand-written brief per run (items drop silently); a brief sent by the tool over a transport (couples the tool to one harness); silent defaults for the decision slots (the worker cannot tell a default from a decision); rendering with the pinned CLI only (the orchestrator would need that exact version installed); a per-flag version constant with a template branch for older pins (one more branch per flag, in both template languages).
- Consequences: brief composition lives in one template pair, an item is in every brief or in none; adding a slot is one move — placeholder in both templates, key in vars, entry in `TEMPLATE_KEYS`, bullet in both batch-skill layers; an extra key passed but unused is not caught; output is two-stream, brief on stdout, notes on stderr.
- ADR-025 is already gone (probe-command ADR card): the Decision's mutation-probe bullet links the probe ADR by its new id.
- `git rm` docs/adr/adr-010-brief-command.md, adr-017-gates-step-follows-the-pin.md, adr-018-brief-decision-slots.md.
- docs/README.md: replace rows 21, 28, 29 (numbers at 6f6318e) with one English row `| [adr/adr-NNN-worker-brief.md](adr/adr-NNN-worker-brief.md) | <H1 title> | Accepted |`.
- CHANGELOG.md:73, :75: delete the ADR link, keep the rest of the entry.
- lib/brief.js:2 and, if it still exists, :12: replace the old id with the new ADR id; keep each comment within two lines of 100 characters.
- After deleting, run `git grep -n -e adr-010-brief-command -e adr-017-gates-step-follows-the-pin -e adr-018-brief-decision-slots -- '*.md'`: every hit in an older ADR file that still exists (another cluster not consolidated yet) gets its link target repointed to the new ADR file, and its link text to the new ADR id; lint gate 1 walks docs/** and root *.md and turns red on a link to a deleted file.

## Out of scope

- Code changes to brief — the BS-108 (`drop-pre-floor-version-gates`) and BS-90 (`brief-follows-cli-pin`) cards.
- The probe rule for the AGENTS.md block and the backslop-task skill, and ADR-021 — the probe-command consolidation.
- The when-scope rule of `gates` itself (docs/adr/adr-023-gates-scope-when.md) — the gates consolidation.
- A CHANGELOG entry: nothing user-visible changes.

## Verification

- `node bin/backslop.js lint; echo rc=$?` → rc=0.
- `npm test; echo rc=$?` → rc=0; report the pass count.
- `git grep -n -i -E 'adr-0(10|17|18)' -- . ':!docs/archive/LOG.md'; echo rc=$?` → no output, rc=1.
- `grep -o -E 'ADR-[0-9]{3}' docs/adr/adr-NNN-worker-brief.md | sort -u` → only `ADR-NNN`; `grep -n -E 'BS-[0-9]|a year' docs/adr/adr-NNN-worker-brief.md` → no output.
- The Decision names all six flags, all four refusals and five slots; `grep -c -- '--entry\|--autonomy\|--handover' docs/adr/adr-NNN-worker-brief.md` ≥ 3.
