# ADR-007: Точный npm-пин и релизный чеклист без смены default CLI

**Status:** Accepted
**Date:** 2026-09-03
**Deciders:** Velklish

## Context

[ADR-003](adr-003-node-stdlib-npx.md) оставил доставку на `npx github:`. [ADR-004](adr-004-version-pin-upgrade.md) закрепил пин тегом git. Публикация в npm даёт короткую команду и точную версию, но ссылка на отсутствующий пакет ломает новые проекты. Источник версий для `upgrade` — git-теги: npm registry не заменяет их.

## Варианты

- **Сразу переключить `defaultCli` на `npx backslop@X.Y.Z`.** Короче для пользователя, но до публикации `init` в новом проекте не работает.
- **Поддержать форму `npx backslop@X.Y.Z` в `parseCli` и `upgrade`, default оставить на GitHub.** Релизный скрипт готовит tag → `npm publish` → atomic push; фактическая публикация и смена умолчания — отдельная задача.

## Decision

CLI понимает точный npm-пин `npx [флаги] backslop@X.Y.Z` и плавающую npm-форму `npx [флаги] backslop` / `npx [флаги] backslop@latest` с `pin: null`. Источник тегов из npm-формы не выводится: его задаёт поле `source`. Default `cli` остаётся `npx github:Velklish/backslop#vX.Y.Z`. Релиз — `npm run release -- X.Y.Z`: чистое дерево на `main`, совпадение версии, `git fetch` и fast-forward от `origin/main`, `npm test`, `lint`, `pack --dry-run`, локальный тег, `git push --atomic --dry-run`, `npm publish`, atomic push `main` и тега. Сбой на любом шаге после тега печатает состояние и следующую команду. Этот заход не создаёт тег, не публикует и не пушит.

## Consequences

- Проект на npm-пине обязан указать `source`, иначе `upgrade` отказывает.
- Смена default CLI и первая публикация — [BS-2.1](../backlog/deferred/BS-2.1-npm-publish.md), не этот ADR.
- `npx backslop` и `npx backslop@latest` точным пином не являются, но `parseCli` распознаёт их как npm-форму с `pin: null`; `lint` предупреждает, `upgrade` переставляет на точный пин из `source`.
- ADR-004 заменён в части источника релизов при npm-форме; пин тегом git и остальные следствия ADR-004 остаются без изменений.
