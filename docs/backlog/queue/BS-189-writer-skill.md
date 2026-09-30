# BS-189 · backslop-writer skill: the technical-writer pass with a currency ledger and a style ledger

- **Order:** 1030
- **Scope:** [01. Layout](../../reference/01-layout.md)
- **Created:** 2026-09-28
- **Dependencies:** BS-188, BS-161, BS-169, BS-171

## Context

Owner decisions 5–7 of BS-183. The technical-writer pass runs in full (currency and style) before a release commit, and narrowed to currency when a batch run closes. A `lang: ru` project uses the currency part and the structural rules of technical-documentation, with humanizer on English text only. Slop is removed by the pass, not by a mechanical gate.

**Source,** promptobus v0.20.0 (github.com/Velklish/promptobus, tag `v0.20.0`):

- `.agents/skills/tech-writer/SKILL.md`: the overlay the pass loads first, which sets precedence, scope, exemptions and local rules;
- `docs/guides/releasing.md` § Technical-writer pass. Input: the diff since the previous tag and the human-facing documentation. Output: a commit of documentation fixes, reviewed like any other piece;
- `test/release-writer.test.mjs`: vendored skills keep a pinned source, and the release guide names the step before the release commit and points at the overlay.

**Its first run, before 0.20.0, had two parts.** The currency part mapped every behaviour-changing commit since the previous tag to the documentation that states it, citing code as file:line. The style part walked all 25 humanizer patterns, one ledger row each. The orchestrator returned the pass once because only 2 of the 25 patterns had been walked. The pass then rewrote three sentences that contradicted the code and made one style edit; the other hits were kept under the overlay's local rules. So the check is the ledger row per pattern, not the number of edits.

**The next finding on the same pass** (open in promptobus): the currency part missed a stale CLI help and a stale shipped skill, because both were outside its scope. Currency must also cover the CLI help and the skills a project ships. Style stays on human-facing text.

## Work to do

- A new skill template, `templates/en/skills/backslop-writer/SKILL.md`, and its ru twin `templates/skills/backslop-writer/SKILL.md`. The adapters lay it out like the other skills.
- **Precedence:** the project's own rules (`AGENTS.md`, the glossary, its contributing or style guide when present), then `backslop-techdoc`, then `backslop-humanizer`.
- **Scope.**
  - Human-facing, for currency and style: root `README*.md`, the unreleased changelog section, `{{docs}}/**` except backlog and archive, plus the `writer.style` globs of `backslop.json`. ADRs are in scope; a style edit never changes a decision.
  - Currency only: the `writer.currency` globs, such as the CLI help source, shipped skills and prompts.
  - Agent-facing texts are exempt from style: skills, prompts, `AGENTS.md`, backlog cards, the archive.
- **Local rules,** carried from the promptobus overlay:
  - an inanimate subject is allowed ("The command exits with code 2");
  - reference text keeps uniform sentences;
  - bold only for a flag, a UI string or a run-in heading;
  - English without contractions;
  - no "What's next" tail on a procedure;
  - keep the dash style the file uses;
  - never change a behavioural statement before checking it against the code.
- **Language.** `lang: en`: both skills. `lang: ru`: currency plus the structural rules of technical-documentation, whose "Non-English documents" section skips the `[EN]` rules; humanizer applies to English passages only. A translated README (`README.<lang>.md`) is checked as a faithful counterpart of the original and is never rewritten by the English skills.
- **Two modes:**
  - release: input `git diff <previous tag>..HEAD`, currency and style;
  - batch close: input `<run base>..HEAD`, currency only.
- **Ledgers,** in the result of the pass's task:
  - currency: one row per behaviour-changing commit, with the commit, what changed, and the documentation location that states it now or the reason none is needed, citing the code as file:line;
  - style: one row per humanizer pattern, with the hits, the edits, and the hits kept together with the rule that keeps them.
- **Output:** one commit per document group (reference, guides, ADRs, README and index, changelog). Anything that needs a code change or a decision is filed as a card, not fixed in the pass. The reviewer samples rewritten passages against the code: no meaning changed, no new unverified claim.
- **`backslop.json`:** an optional `writer` object, `{ "style": [globs], "currency": [globs] }`, with globs relative to the project root. An unknown key or a non-string value is refused and the refusal names the field. `init` does not write the object.
- **Tests:**
  - template parity;
  - both layers name both modes and both ledgers (assert stable headings, not prose);
  - config validation for `writer`.
- **Documentation:** `docs/reference/01-layout.md` (the skill in the adapter outputs, the `writer` field in the configuration table); `README.md` (the skill list); `CHANGELOG.md` under the unreleased section.
- **Glossary evidence.** `docs/GLOSSARY.md` rows for writer pass, currency ledger and style ledger point their Evidence at ADR-055 until this card lands; repoint each to the file that now implements the term, as the glossary header requires.

## Out of scope

- Audit mode: BS-190.
- Process hooks (the AGENTS block, the batch skill, the task skill): BS-191.
- Vendoring: BS-188.

## Verification

- A fresh project with an adapter lays out `backslop-writer` in both languages, and `lint` exits 0.
- Config refusal probes for `writer`: an unknown key and a non-string glob. Each is refused, naming the field.
- `node bin/backslop.js gates` exits 0.
