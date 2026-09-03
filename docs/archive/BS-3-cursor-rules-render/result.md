# BS-3 · Результат

**Закрыта 2026-09-03.** Выполнена в расширенной постановке: не только Cursor, а выбор adapters. Поле `tools` и `init --tools claude,cursor,codex` / `--tools none`. Claude пишет `.claude/skills/backslop-*` и stub `CLAUDE.md`; Cursor — `.cursor/rules/backslop-*.mdc` с фронтматтером и namespaced references; Codex — `.agents/skills/backslop-*`. Снятие adapter удаляет только owned outputs (маркер `<!-- backslop:generated -->` и legacy-набор); пользовательские соседи и custom `CLAUDE.md` остаются.

**Проверки.** e2e: `none`, каждый adapter отдельно, комбинация всех трёх, повторный render и смена набора; custom файлы и custom `CLAUDE.md` сохраняются; ссылки в generated rules проверяет `lint`. Улика: `test/init.test.mjs`, `test/lint.test.mjs`.

**Доки тем же ходом.** ADR-006, `docs/reference/01-layout.md`, `03-lint.md`, оба README, глоссарий, CHANGELOG.
