# BS-2.1 · Выпуск пакета в npm и переключение default CLI

- **Область:** [reference/02](../../reference/02-cli.md)
- **Создана:** 2026-09-03
- **Зависимости:** нет

## Контекст

После готовности release flow нужно выпустить первую npm-версию. До публикации default CLI обязан оставаться на GitHub spec: ссылка на отсутствующую npm-версию ломает новые проекты.

## Что сделать

- Выбрать следующую версию, обновить `package.json` и CHANGELOG.
- Повторно проверить имя пакета, npm auth и 2FA.
- Переключить default CLI на точный `npx backslop@X.Y.Z`, сохранив Git `source` для `upgrade`.
- Запустить release script: tag → `npm publish` → atomic push `main` и tag.
- Проверить `npm view backslop version` и fresh `npx --yes backslop@X.Y.Z init`.

## Не входит

- Изменение release flow: его готовит `BS-2`.

## Проверки

- Registry возвращает опубликованную версию.
- Fresh npm install создаёт тот же layout, что проверенный tarball.
- Remote `main` и tag указывают на один release commit.

## Отложено

- **Отложена:** 2026-09-03
- **Причина:** фактическая публикация, tag и push исключены из текущего захода владельцем.
- **Условие возврата:** владелец выбирает release version и подтверждает готовность npm auth/2FA к публикации.
