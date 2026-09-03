# BS-3 · Рендер скиллов для выбранных harness

- **Порядок:** 30
- **Область:** [reference/01](../../reference/01-layout.md)
- **Создана:** 2026-09-03
- **Зависимости:** нет

## Контекст

Скиллы процесса безусловно лежат в `.claude/skills/backslop-*`. Cursor и Codex получают только блок в `AGENTS.md` и `docs/`, поэтому не видят полный цикл задачи, batch-заход и `backslop-seed`.

## Что сделать

- Декларация инструментов при установке: `init --tools claude,cursor,codex`, поле `tools` в `backslop.json`; умолчание — пустой список.
- Повторный `init --tools` меняет выбранные adapters; `--tools none` очищает список.
- Claude renderer пишет skill tree в `.claude/skills/` и создаёт `CLAUDE.md`, только если выбран Claude.
- Рендер тех же шаблонов скиллов в `.cursor/rules/backslop-<имя>.mdc` с фронтматтером Cursor (описание, `alwaysApply: false`); тело — SKILL.md без YAML-шапки.
- Cursor references копируются в namespaced support-каталоги, относительные ссылки переписываются.
- Codex renderer пишет canonical skill tree в `.agents/skills/backslop-*`.
- Повторный `init` переписывает выбранные outputs и удаляет только backslop-owned outputs снятых adapters.

## Не входит

- Транспорт worker'ов для Cursor: слот в `backslop-batch` остаётся описанием, а не кодом.

## Проверки

- e2e: `none`, каждый adapter отдельно и комбинация всех трёх дают точный layout и зелёный `lint`.
- Повторный init чинит owned outputs, а смена tools не трогает пользовательские файлы и custom `CLAUDE.md`.
- Все относительные ссылки в generated skills и rules разрешаются.
