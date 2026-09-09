# BS-32.1 · Разбор `git worktree list --porcelain` повторён в `lib/tracks.js` и внутри `foreignTaskIds`

- **Область:** `lib/tasks.js`, `lib/tracks.js`, [02-cli](../../reference/02-cli.md)
- **Создана:** 2026-09-09
- **Зависимости:** нет
- **Взята:** 2026-09-09

## Контекст

Находка при работе над BS-32. Карточка BS-32 предписывала «переиспользовать обходчик
`foreignTaskIds` (`lib/tasks.js:178-217`)». Переиспользовать там нечего: `foreignTaskIds` —
счётчик занятых номеров задач, и разбор porcelain вшит внутрь его цикла по каталогам статусов.

Улика — `lib/tasks.js`, тело `foreignTaskIds`: строки `list.stdout.split(/\n\n+/)`,
`block.match(/^worktree (.+)$/m)` и `block.match(/^branch refs\/heads\/(.+)$/m)` стоят внутри
`for (const block of …)`, сразу за ними идёт чтение `docs/backlog/<статус>` и `docs/archive`, и
наружу функция отдаёт `[{ num, sub, source }]` — путей и веток в результате нет.

Те же шесть строк повторены в `lib/tracks.js`, функция `worktrees(root)`. Дубль сделан
сознательно: `lib/tasks.js` в этом заходе правил track B (BS-31/35), и вынос общего помощника
означал бы правку чужого файла. Согласовано с оркестратором до реализации.

## Что сделать

- Вынести разбор `git worktree list --porcelain` в один помощник — путь и ветка на каждый
  worktree, — и звать его из `foreignTaskIds` и из `worktrees` в `lib/tracks.js`.
- Место помощника выбрать при реализации: `lib/util.js` (рядом с `git`/`gitOrFail`) или
  отдельный модуль; в `lib/tasks.js` его оставлять не стоит — оттуда его тянул бы `lib/tracks.js`.

## Не входит

- Поведение `tracks` и `foreignTaskIds` — обе функции работают, задача чисто о дубле.

## Проверки

- Мутационная проба: сломать разбор в общем помощнике — краснеют и тесты `tracks`, и тест
  `new`, считающий номера по чужим worktree.
- `npm test` и `node bin/backslop.js lint` зелёные.
