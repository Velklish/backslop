# BS-41 · README.md и README.ru.md называют пин `v0.2.0` при текущей версии `0.4.0` — команда установки из README ставит релиз на три тега позади актуального

- **Область:** [reference/01](../../reference/01-layout.md), `README.md`, `README.ru.md`
- **Создана:** 2026-09-06
- **Зависимости:** нет

## Контекст

README.md:59 «If installed globally (`npm i -g github:Velklish/backslop#v0.2.0`), change `cli` to `backslop`» и README.md:63 «`cli` is `npx github:Velklish/backslop#v0.2.0`»; те же две строки в README.ru.md:59 и :63 (`grep -n "v0\.2\.0" README.md README.ru.md` — 4 совпадения). Текущая версия — package.json:3, `"version": "0.4.0"`. Между v0.2.0 и текущей вышли v0.3.0, v0.3.1, v0.4.0 (git tag -l).

Фактическое поведение init расходится со строкой README.md:63 не только количественно: lib/config.js:20, `defaultCli(version = TOOL_VERSION)`, формирует `` npx github:Velklish/backslop#v${TOOL_VERSION} ``, что для сегодняшнего инструмента даёт `#v0.4.0`, а не `#v0.2.0` — то есть строка прямо неверно описывает то, что делает init, а не просто устарела как иллюстрация.

docs/reference/01-layout.md:35 уже использует обобщённую форму той же строки: `` npx github:Velklish/backslop#v<версия> `` — решение уже применено в одном месте репозитория и не перенесено в README/README.ru.

Гейта, который сверял бы версию в примерах README с package.json или последним тегом, нет: гейт «Номера» (docs/reference/03-lint.md) проверяет номера задач, а версии в тексте README — нет.

## Что сделать

- README.md:59,63 и README.ru.md:59,63 — заменить литерал `#v0.2.0` на обобщённую форму `#v<версия>`, как в docs/reference/01-layout.md:35.
- CHANGELOG.md — запись, что пример установки больше не называет конкретный тег.

## Не входит

- Гейт/тест, автоматически сверяющий версию в README с TOOL_VERSION или последним тегом, — отдельное усиление, оформляется отдельной задачей при необходимости.

## Проверки

- `grep -n "v0\.2\.0" README.md README.ru.md` — пусто.
- `grep -n "v<версия>" README.md README.ru.md` — по 2 совпадения в каждом файле.
- `npm test` и `node bin/backslop.js lint` зелёные.
