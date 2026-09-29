# Glossary: format and criteria

Read in phase 3 of `backslop-seed` before editing `GLOSSARY.md`.

## What to include

A term belongs in the glossary if at least one is true:

- a concept has two names in the project or in the owner’s speech — the glossary chooses one;
- the name is misread without a definition: an “order” in code and an “order” in the business domain may differ;
- the name is an abbreviation or internal word not found in external dictionaries;
- an agent without the glossary would invent its own name — and has already done so.

Do not include: universally known stack terms (HTTP, ORM, migration), library names, or words appearing once.

The starting size is 10–30 terms. Nobody reads a hundred-line glossary; it grows through tasks when a dispute about a word happens in work.

## Record format

| Term | EN | Definition | Evidence |
|---|---|---|---|
| booking | Reservation | A customer booking before confirmation; after confirmation it becomes an order | `src/Orders/Reservation.cs` |
| order `[?]` | PurchaseOrder | A confirmed booking with an assigned executor — or any booking? The owner has not confirmed | `src/Orders/PurchaseOrder.cs`, README §2 |

- Definition is one or two sentences distinguishing the concept from neighbours, not a code paraphrase.
- The Term, EN and Evidence columns and the `[?]` mark are defined once, in the header of `{{docs}}/GLOSSARY.md`. If the user’s speech differs from the glossary, ask rather than staying silent: “The glossary defines X as Y, but this seems to mean Z — which is correct?”

## Retired terms

| Do not use | Use | Why |
|---|---|---|
| ticket | task | One concept, one name; “ticket” was used in chats, “task” in the tracker |

This table contains words that appeared but were not chosen. A row is a commitment: new text does not use the retired word, and old text is cleaned up as it is edited.
