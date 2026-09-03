# BS-5 · Harness-независимый self-host репозитория

- **Порядок:** 40
- **Область:** [reference/01](../../reference/01-layout.md)
- **Создана:** 2026-09-03
- **Зависимости:** нет

## Контекст

Собственный репозиторий хранит generated `.claude/skills/**` и `CLAUDE.md`, хотя канонические skill sources уже лежат в `templates/skills/**`. Из-за этого source tree привязан к Claude и дублирует generated output.

## Что сделать

- Удалить из Git `.claude/**`, `.cursor/**`, `.agents/skills/backslop-*` и generated `CLAUDE.md`.
- Добавить точечные ignore-паттерны для backslop-owned adapter outputs, не игнорируя harness-каталоги целиком.
- Зафиксировать `tools: []` в собственном `backslop.json`.
- Описать `templates/**` как единственный источник, а adapter outputs — как локальный generated результат.
- Исключить generated adapter outputs из repository-wide relink, сохранив их отдельную проверку в `lint`.

## Не входит

- Новые renderer implementations: их делает `BS-3`.

## Проверки

- `git ls-files` не возвращает harness-specific generated outputs и `CLAUDE.md`.
- Обычный self `init` не создаёт их при `tools: []` и не делает tracked tree грязным.
- Выбор adapter материализует только его owned outputs; пользовательские файлы сохраняются.
