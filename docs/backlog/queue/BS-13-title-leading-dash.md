# BS-13 · --title со значением, начинающимся с дефиса, падает в parseArgs

- **Порядок:** 30
- **Область:** [02-cli](../../reference/02-cli.md)
- **Создана:** 2026-09-05
- **Зависимости:** нет

## Контекст

Наблюдение 2026-09-05 в external/promptobus: `new strategy-flag --title "--strategy on spawn and review, …" --queue` → «Option '--title' argument is ambiguous. Did you forget to specify the option argument for '--title'?» (node `parseArgs`, strict). Воспроизведено при заведении этой записи: `new title-leading-dash --title "--title со значением…"` упал тем же текстом; форма `--title=…` прошла. Сообщение `parseArgs` подсказывает `--title=-XYZ`, справка `help` — нет.

## Что сделать

- `parseCommandArgs`: значение строкового флага, идущее следующим токеном и начинающееся с дефиса, принимать, если токен не является известной опцией команды (`--известная` или `--известная=…`); техника — переписать пару в `--флаг=значение` до `parseArgs`.
- Значение, совпадающее с известной опцией (`--title --queue`), остаётся неоднозначным: отказ с подсказкой формы `--title=…`.
- Справка (RU и EN) называет форму `--title=…` для значений с ведущим дефисом; справочник 02 и CHANGELOG.

## Не входит

- Смена парсера аргументов.

## Проверки

- `test/commands.test.mjs`: `new x --title "--strategy on spawn"` создаёт задачу с этим заголовком; `new x --title --queue` — код 1 с подсказкой `--title=`; `adr x --title "-x"` проходит.
