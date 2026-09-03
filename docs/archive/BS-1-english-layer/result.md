# BS-1 · Результат

**Закрыта 2026-09-03.** Выполнена. Второй комплект шаблонов лежит в `templates/en/` с тем же составом и `{{placeholders}}`; `init --lang en` и поле `lang` в `backslop.json` выбирают слой. Команды `new`, `adr`, `archive` и человеческий CLI говорят на языке конфига; вне проекта `help` и ранние ошибки двуязычные; `status --json` не меняется. Смешанный RU/EN backlog читается одним CLI: русская «Область» и английский `Scope`/`Area` — одно поле. `README.md` английский, русский текст — `README.ru.md`. Гейт `templateParity` краснеет при расхождении состава или подстановок.

**Проверки.** `npm test` — 113 проверок зелёные, среди них полный EN lifecycle `init → new → mv → archive → adr → lint` без кириллицы в generated docs, rules и блоке `AGENTS.md`; mixed metadata в `status --json`; красные пробы parity. Улика: `test/init.test.mjs`, `test/templates.test.mjs`.

**Доки тем же ходом.** ADR-005, `docs/reference/01-layout.md`, оба README, CHANGELOG, глоссарий.
