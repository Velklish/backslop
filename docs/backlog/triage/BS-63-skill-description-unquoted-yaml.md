# BS-63 · description в шаблонах скиллов — плоский скаляр с «: » внутри: front matter не разбирается как YAML-мэппинг

- **Область:** [TODO: раздел](../../reference/README.md)
- **Создана:** 2026-09-19
- **Зависимости:** нет

## Контекст

Находка при переводе aivals с v0.3.1 на v0.9.0 (2026-09-19), метка major: заявленный контракт adapter output — файл скилла с YAML front matter — нарушен. `templates/skills/backslop-task/SKILL.md` и `backslop-batch/SKILL.md` дают `description` плоским скаляром, а текст содержит `: ` («Триггеры: «возьми задачу»…»), поэтому строка не разбирается как YAML-мэппинг. Улика: `grep -c '^description: "' templates/skills/backslop-task/SKILL.md templates/skills/backslop-batch/SKILL.md` → 0 и 0 на v0.9.0. У aivals это держит гейт `tests/Aivals.Tests/Infrastructure/HarnessFrontMatterTests.cs` (ADR-012 aivals): там четыре файла были закавычены руками, и `upgrade` их регенерировал без кавычек — гейт потребителя краснеет на каждом `init`. Адаптер Cursor кавычит `description` в `.mdc` уже сегодня; у Claude и Codex — нет.

**Зачем:** потребитель с проверкой front matter не может обновлять пин без ручной правки после каждого `init`; карточка потребителя — AV-248.11 в aivals.

## Что сделать

- Кавычить `description` при рендере adapter outputs Claude и Codex так же, как делает адаптер Cursor, либо в самих шаблонах; красная проба — тест на `description` с `: ` внутри, разобранный YAML-парсером.
