# BS-2 · Результат

**Закрыта 2026-09-03.** Выполнена в суженной постановке: подготовка, не публикация. `parseCli` понимает точный npm-пин `npx [флаги] backslop@X.Y.Z`; источник тегов из этой формы не выводится — нужен `source`. `npm run release -- X.Y.Z` гоняет preflight, гейты, `pack --dry-run`, локальный тег, `npm publish`, atomic push; сбой после тега печатает состояние и следующую команду. Default `cli` и версия `0.2.0` не менялись. Фактическая публикация отложена в [BS-2.1](../../backlog/deferred/BS-2.1-npm-publish.md).

**Проверки.** Unit на npm-пин и `upgrade --pin-only` с explicit `source`; release tests через fake `git`/`npm` — порядок операций, грязное дерево, красный gate, конфликт тега, recovery после publish/push; tarball ставится во временный проект и проходит `version`, `init`, `lint`. Улика: `test/upgrade.test.mjs`, `test/release.test.mjs`.

**Доки тем же ходом.** ADR-007, `docs/reference/02-cli.md`, чеклист в `AGENTS.md`, оба README, CHANGELOG.
