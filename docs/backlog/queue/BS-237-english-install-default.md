# BS-237 · Make new installations English by default

- **Order:** 50
- **Scope:** [01. Layout](../../reference/01-layout.md)
- **Created:** 2026-10-04
- **Dependencies:** none
- **Cost:** major

## Context

A fresh installation selects Russian unless the caller opts into English. Align the new-install default with the English product requirement while retaining explicit localization and existing project choices.

Evidence: audited commit `fd85b4cb527c875f1172b4517b4a3972a4e33755`, 2026-10-04. `lib/config.js:32` sets `lang` to `ru`; `lib/init.js:81,91` inherits that default. `README.md:9,44` and `docs/adr/adr-051-localization.md:17` document this choice. The read-only probe `node --input-type=module -e 'import { defaults } from "./lib/config.js"; console.log(JSON.stringify(defaults()));'` returned `lang: ru`, exit 0.

This is an intentional contract change requested by the owner, not an accidental regression in the documented behaviour.

## Work to do

- Make a fresh init without a language flag produce an English config, documentation and messages.
- Preserve explicit localized initialization and the configured language of existing projects on repeated init or upgrade.
- Update the documented default and localization ADR in the same implementation.

## Out of scope

- Do not remove localization resources or force existing consumer documentation into another language.
- Do not change consumer-installed files during this audit.

## Verification

- Tests cover implicit English, explicit localization and preservation of an existing language choice.
- Check generated files and CLI messages, not only the config field.
- Run the relevant init/localization tests and repository gates with exact counts and exit codes.
