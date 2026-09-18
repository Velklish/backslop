# BS-61 · Статус minor/: new --minor, mv, status, lint, migrate

- **Порядок:** 5
- **Область:** [01. Раскладка](../../reference/01-layout.md), [02. CLI](../../reference/02-cli.md), [03. Гейты lint](../../reference/03-lint.md)
- **Создана:** 2026-09-18
- **Зависимости:** нет

## Контекст

[ADR-022](../../adr/adr-022-cost-decides-finding-fate.md): находка идёт с меткой цены, и minor-находки вместе с гипотезами уходят не карточкой в `triage/`, а в пятый каталог статуса `minor/`, откуда их закрывают пачками. Каталога, команды и гейтов для него нет: `STATUSES` в `lib/config.js` знает четыре статуса, `new` кладёт файл только в `triage/` или `queue/`, поле «Цена» не существует.

## Что сделать

- `STATUSES` получает `minor` пятым; `init` кладёт `.gitkeep`, `migrate` до v0.9.0 создаёт каталог в существующем проекте.
- `new <slug> --parent N --minor [--cost minor|major|critical] [--hypothesis]` заводит файл из нового шаблона `minor.md` (ru и en): заголовок, «Область», «Создана», «Родитель», «Цена», раздел «Улика». Отказы: `--minor` без `--parent`, `--minor` с `--queue`, `--cost` без `--minor`, `--cost major|critical` без `--hypothesis`.
- `mv N minor` дописывает «Цена: minor», если поля нет.
- `status` печатает секцию `Minor (n)` по областям; `status --json` отдаёт `minor` с `area` и `cost`.
- `lint`: в `minor/` пустая «Область» — предупреждение, а не ошибка; отсутствующая или неразбираемая «Цена» — ошибка; `major`/`critical` без пометки «гипотеза» — ошибка; перечень статусов в тексте ошибок берётся из `STATUSES`.
- Поле «Цена» в реестре полей (`lib/tasks.js`), шаблон в `TEMPLATE_KEYS`, каталог в `test/helpers.mjs`.
- Справочник 01/02/03, `CHANGELOG.md`.

## Не входит

- Закрытие minor пачкой — [BS-62](../BS-62-archive-into/task.md).
- Тексты правил, скиллов и брифа — [BS-60](../BS-60-cost-rules-templates-docs/task.md).
- Проверка значения «Области» по существованию раздела: как и у других статусов, `lint` смотрит только на пустоту и заглушку.

## Проверки

- `node bin/backslop.js new x --parent 61 --minor` кладёт файл с номером `BS-61.k` в `docs/backlog/minor/` с четырьмя полями; каждый из четырёх отказов выходит кодом 1 с текстом причины (тесты в `test/commands.test.mjs`).
- `status --json` содержит `minor: [{ id, title, file, created, area, cost }]` (тест).
- Красная проба на каждую новую проверку `lint` в `test/lint.test.mjs`: нет каталога `minor/`; нет «Цены»; `major` без гипотезы; пустая «Область» даёт предупреждение и код 0.
- `migrate` на проекте со штампом 0.8.0 создаёт `docs/backlog/minor/.gitkeep` (тест).
- `node bin/backslop.js gates` зелёный, счёт тестов до и после назван в `result.md`.
