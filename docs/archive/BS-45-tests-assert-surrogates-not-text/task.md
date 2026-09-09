# BS-45 · Тесты CLI проверяют код возврата и число файлов вместо текста отказа и перечня, а тестовая база держит `lint` с непроверяемым постоянным предупреждением

- **Область:** [reference/02](../../reference/02-cli.md), [reference/03](../../reference/03-lint.md), `test/review.test.mjs`, `test/archive.test.mjs`, `test/helpers.mjs`, `lib/archive.js`, `bin/backslop.js`
- **Создана:** 2026-09-06
- **Зависимости:** нет
- **Взята:** 2026-09-09

## Контекст

`test/review.test.mjs:71` (тест «дубль номера — отказ с обоими путями») — `assert.equal(r.code, 1)` без проверки текста. `bin/backslop.js:107-116` отдаёт код 1 и для `CliError` (адресованный человеку текст), и для любого другого исключения — `throw e` в обработчике rejection даёт unhandled rejection, и Node сам выставляет код 1. Мутационная проба на соседнем файле подтверждает подмену: замена отказа `throw new CliError(...)` на `lib/archive.js:24` на `throw new TypeError('BOOM')` не красит `node --test test/archive.test.mjs` — 2 pass / 0 fail.

Тот же паттерн — `test/archive.test.mjs:64` (`assert.equal(missing.code, 1)`) для отказа «задачи 42 нет ни в одном каталоге статуса» (текст — `lib/archive.js:24`), тоже без `assert.match`.

`test/archive.test.mjs:40` — вся проверка ветки `--dry-run` сводится к `assert.match(dry.out, /файлов с поправленными ссылками 6/)`; сам перечень, который печатает `for (const rel of changed) info(rel);` (`lib/archive.js:65`), не проверяется ни разу — закомментировав эту строку, получаем всё те же 134/134 pass.

`test/helpers.mjs:14` — `makeProject` пишет `backslop.json` без `version`/`cli`/`lang`. Проверено сейчас: `backslop lint` на такой раскладке → `stdout`: `✔ lint: ошибок нет, предупреждений 1`, `stderr`: `⚠ backslop.json: нет штампа версии — запусти npx github:Velklish/backslop#v0.4.0 upgrade или init`, код 0. Все тесты вида `assert.equal(r.code, 0)` для `lint` (`review.test.mjs:18-19`, `38-39` и другие) этого не ловят — `r.err` при успешном коде нигде не сравнивается с пустой строкой.

## Что сделать

- `test/review.test.mjs:71` и `test/archive.test.mjs:64` — добавить `assert.match(r.err, /…/)`: для review.test.mjs:71 тот же `/занят дважды/`, что уже стоит на строке 66 этого теста; для archive.test.mjs:64 — `/нет ни в одном каталоге статуса/`.
- `test/archive.test.mjs:40` — сравнивать напечатанный `--dry-run` перечень путей (`assert.deepEqual` со списком из шести файлов, заданных в `seed()`); число тогда получится само и перестанет быть магическим.
- `test/helpers.mjs` — в `makeProject` проставить по умолчанию `version: TOOL_VERSION` и `cli: 'node bin/backslop.js'`, вынеся отсутствие штампа отдельным параметром (`makeProject({ stamp: false })`) для теста, которому нужен legacy-проект без версии; в местах, где `lint` обязан быть чистым, добавить `assert.equal(r.err, '')`.

## Не входит

- Правка самого поведения `lint`/`archive` — предмет здесь исключительно проверка существующего поведения, не изменение контракта; доки (reference/CHANGELOG) правкой не затрагиваются.
- Другие тестовые файлы (`commands.test.mjs`, `init.test.mjs`, `mv.test.mjs`) — тот же паттерн `assert.equal(r.code, 1)` без текста в них не проверялся.

## Проверки

- Мутационная проба после коммита: вернуть в `lib/archive.js:24` `throw new TypeError('BOOM')` вместо `CliError` — оба переправленных assert'а в `archive.test.mjs` должны покраснеть.
- Закомментировать `for (const rel of changed) info(rel);` в `lib/archive.js:65` — переправленный тест на `archive.test.mjs:40` должен покраснеть.
- Прогнать `makeProject({ stamp: false })` и `backslop lint` — предупреждение о штампе воспроизводится; в остальных тестах `assert.equal(r.err, '')` зелёный.
