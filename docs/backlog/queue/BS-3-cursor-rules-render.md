# BS-3 · Рендер скиллов для Cursor

- **Порядок:** 30
- **Область:** [reference/01](../../reference/01-layout.md)
- **Создана:** 2026-09-03
- **Зависимости:** нет

## Контекст

Скиллы процесса лежат в `.claude/skills/backslop-*`, и их читает только Claude Code. Cursor получает из установки один блок в `AGENTS.md` и `docs/`: цикл задачи и заход worker'ами он не видит, а `backslop-seed` для него не существует вовсе.

## Что сделать

- Декларация инструментов при установке: `init --tools claude,cursor`, поле `tools` в `backslop.json`; умолчание — `claude`.
- Рендер тех же шаблонов скиллов в `.cursor/rules/backslop-<имя>.mdc` с фронтматтером Cursor (описание, `alwaysApply: false`); тело — SKILL.md без YAML-шапки.
- Повторный `init` переписывает рендер так же, как скиллы Claude Code.

## Не входит

- Транспорт worker'ов для Cursor: слот в `backslop-batch` остаётся описанием, а не кодом.

## Проверки

- e2e: `init --tools cursor` кладёт три файла `.mdc`, `lint` зелёный, кириллица и подстановки на месте.
- `init --tools claude` файлов `.cursor/` не создаёт.
