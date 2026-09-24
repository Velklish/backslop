# BS-80 · Пачка minor: проверка ссылок lint — reference-style и adapter outputs

- **Порядок:** 220
- **Область:** [03. Гейты lint](../../reference/03-lint.md)
- **Создана:** 2026-09-24
- **Зависимости:** [BS-79](../../archive/LOG.md#bs-79) — та же волна, соседние правки `lib/lint.js`

## Контекст

Пачка области 03 по правилу [docs/backlog/README.md](../README.md): заход 2026-09-24 трогает гейты `lint`, и единственная запись этой области закрывается вместе с ним.

## Что сделать

- [BS-69.1](../minor/BS-69.1-directory-link-check-misses-refstyle-and-adapters.md) — проверка ссылки на каталог с номером задачи (гейт 1) видит и reference-style ссылку (`[BS-2][f]` с определением `[f]: ../triage`), и generated adapter outputs: `directoryLinks` в `lib/links.js` разбирает определения ссылок, `lintAdapters` зовёт её наравне с `brokenLinks`. Исход записи — строкой в `result.md` пачки, закрытие — `node bin/backslop.js archive 69.1 --into 80` после `archive 80` и до `fold 80`.

## Не входит

- Ссылки в код-спанах и блоках кода — гейт их не видит по устройству.

## Проверки

- Вердикты в `test/lint.test.mjs` на обе формы, красные до правки; красная проба.
- `node bin/backslop.js gates` → «гейтов 2, зелёных 2».
