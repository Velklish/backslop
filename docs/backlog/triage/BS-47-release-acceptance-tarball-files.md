# BS-47 · Acceptance-тест релиза не проверяет состав tarball по `files` из package.json

- **Область:** [TODO: раздел reference/]
- **Создана:** 2026-09-09
- **Зависимости:** нет

## Контекст

[TODO: откуда задача и что за ней стоит.]

## Что сделать

- [TODO]

## Не входит

- [TODO]

## Проверки

- [TODO]

## Контекст

Находка worker'а D при работе над BS-17.1 (2026-09-09). Acceptance-тест `packed tarball installs locally and its bin passes version, init and lint` в `test/release.test.mjs` после `npm pack` и локального install дёргает у установленного бинаря только `version`, `init` и `lint`. В self-host проекте (`tools: []`) выпадение `templates/` из поля `files` в `package.json` эти три команды не поймают: `init` без adapter'ов шаблоны скиллов не рендерит. Улика: `grep -n "files" package.json` и три вызова после install в том же тесте; сверки перечня файлов tarball (`npm pack --json` → `files[].path`) с ожидаемым составом в тесте нет. Предположение, не замер: `npm pack --dry-run --json` даёт перечень без сети и без Keychain.
