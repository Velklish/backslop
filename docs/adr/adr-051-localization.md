# ADR-051: Layout language: the lang field and a second template set

**Status:** Accepted
**Date:** 2026-09-29
**Deciders:** Velklish

## Context

Every file backslop lays into a project — the AGENTS.md block, the skills, the docs skeleton, task and ADR files — and every CLI message is text a person in the project also reads. A team that does not read Russian can use the tool only if all of that exists in English. Documents already written in a project are the project's text: the tool must not translate them. `status --json` is read by orchestrators and scripts, so its shape must not depend on the language.

## Options

- **One template set and a translator step** — the translation lives outside the repository and drifts from the placeholders and headings of the source.

## Decision

- **The `lang` field.** `backslop.json` carries `lang`, `ru` or `en` (`LANGS` in `lib/config.js`); a config without it or with another value is refused (`validateConfig`). `init --lang` sets it, a new project without the flag gets `ru`, and a repeated `init --lang` on an existing project switches it.
- **Two template sets with the same paths.** Russian templates live in `templates/**`, English ones in `templates/en/**` (`templateRel` in `lib/templates.js`). Everything a command renders from a template — the files it writes into a project and the brief it prints — comes from the set of the config language (`renderProjectTemplate`).
- **Parity is checked, not trusted.** In the tool repository lint compares the two layers (`templateParity` in `lib/templates.js`, run by `lintTemplateParity` in `lib/lint.js` only where `isToolRepo` holds) with five checks: the same file set; the same placeholder set in each pair; skill frontmatter in both layers, `name` equal to the skill directory and a non-empty `description`; the same sequence of heading levels outside code fences; no Cyrillic letter in the English layer.
- **Messages.** Human CLI output goes through `tr()` in the config language (`lib/i18n.js`). Outside a project the language is unknown: help, the unknown-command error and early refusals carry both texts (`pick`, `projectHintsOrNull` in `lib/config.js`).
- **Language-neutral data.** `status --json` has the same keys in both languages (`collectStatus` in `lib/status.js`). Header fields and section headings of a task are read under both their Russian and English names and written with the label of the config language (`fieldName`, `sectionName`, `setField` in `lib/tasks.js`), so one backlog may hold both.
- **A `lang` change does not translate the project's documents.** `init` re-renders what it owns — the AGENTS.md block and the adapter outputs — in the new language and adds missing skeleton files in it; existing docs and tasks stay as written. The rules pair, `backlog/README.md` and `archive/README.md`, is redrawn by `migrate` (`planRules` in `lib/migrate.js`): at a stamp older than the tool it is redrawn from the template of the config language like every rules redraw ([the version pin, upgrade and migrate ADR](adr-048-version-pin-upgrade-migrate.md)); at the tool's own version only a file equal, pin aside, to the render of the other language or of the same one is redrawn, and an edited file is kept with a note until the next version update.

## Consequences

- A backlog with Russian and English task files side by side is normal, not an error.
- In the tool repository a change to a Russian template without its English twin — or the other way round — fails lint.
- Strings built in code are outside the parity check; they depend on `tr()` and on tests in each language.
- Parity compares structure, not meaning: a twin that says something different with the same placeholders and headings passes.
- The language of this repository's own documentation is a separate decision.
