# BS-47 · Acceptance-тест релиза не проверяет состав tarball по `files` из package.json

- **Область:** `test/release.test.mjs`, `scripts/release.mjs`, [02-cli](../../reference/02-cli.md)
- **Создана:** 2026-09-09
- **Зависимости:** нет
- **Взята:** 2026-09-09

## Что сделать

- В acceptance-тесте tarball (`test/release.test.mjs`) сверить состав из `npm pack --json` (`files[].path`) с полем `files` `package.json`: каждый отслеживаемый git файл под `bin`, `lib`, `templates` (`git ls-files`, а не обход диска — `.DS_Store` и подобное npm не пакует) и корневые `README.md`, `README.ru.md`, `LICENSE`, `CHANGELOG.md` упакован, сверх них — только `package.json`, а само поле `files` равно этому перечню.

## Не входит

- Отдельный вызов `npm pack --dry-run`: перечень даёт уже существующий `npm pack --json` того же теста.
- Содержимое файлов — сверяется только состав.

## Проверки

- Мутация: убрать `templates` из `files` в `package.json` — тест красный.
- `npm test` и `node bin/backslop.js lint` зелёные.

## Контекст

Находка worker'а D при работе над BS-17.1 (2026-09-09). Acceptance-тест `packed tarball installs locally and its bin passes version, init and lint` в `test/release.test.mjs` после `npm pack` и локального install дёргает у установленного бинаря только `version`, `init` и `lint`. В self-host проекте (`tools: []`) выпадение `templates/` из поля `files` в `package.json` эти три команды не поймают: `init` без adapter'ов шаблоны скиллов не рендерит. Улика: `grep -n "files" package.json` и три вызова после install в том же тесте; сверки перечня файлов tarball (`npm pack --json` → `files[].path`) с ожидаемым составом в тесте нет. Предположение, не замер: `npm pack --dry-run --json` даёт перечень без сети и без Keychain.
