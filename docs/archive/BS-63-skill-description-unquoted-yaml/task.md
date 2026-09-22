# BS-63 · description в шаблонах скиллов — плоский скаляр с «: » внутри: front matter не разбирается как YAML-мэппинг

- **Область:** [01-layout](../../reference/01-layout.md)
- **Создана:** 2026-09-19
- **Зависимости:** нет
- **Взята:** 2026-09-22

## Контекст

Находка при переводе aivals с v0.3.1 на v0.9.0 (2026-09-19), метка major: заявленный контракт adapter output — файл скилла с YAML front matter — нарушен. `templates/skills/backslop-task/SKILL.md` и `backslop-batch/SKILL.md` дают `description` плоским скаляром, а текст содержит `: ` («Триггеры: «возьми задачу»…»), поэтому строка не разбирается как YAML-мэппинг. Улика: `grep -c '^description: "' templates/skills/backslop-task/SKILL.md templates/skills/backslop-batch/SKILL.md` → 0 и 0 на v0.9.0. У aivals это держит гейт `tests/Aivals.Tests/Infrastructure/HarnessFrontMatterTests.cs` (ADR-012 aivals): там четыре файла были закавычены руками, и `upgrade` их регенерировал без кавычек — гейт потребителя краснеет на каждом `init`. Адаптер Cursor кавычит `description` в `.mdc` уже сегодня; у Claude и Codex — нет.

**Зачем:** потребитель с проверкой front matter не может обновлять пин без ручной правки после каждого `init`; карточка потребителя — AV-248.11 в aivals.

## Что сделать

- Кавычить `description` при рендере adapter outputs Claude и Codex так же, как делает адаптер Cursor, либо в самих шаблонах; красная проба — тест на `description` с `: ` внутри, разобранный YAML-парсером.

## Разбор triage 2026-09-22 — шире карточки, и ход не в одну строку

Замер (YAML-парсер над front matter шести шаблонов скиллов, HEAD `5a02361`): падают **четыре**
файла, а не два — `templates/skills/backslop-task`, `backslop-batch` и их английский слой
`templates/en/skills/backslop-{task,batch}`; оба `seed` разбираются. Английский слой в «Что
сделать» карточки не назван.

Догадку про кавычки код подтверждает и одновременно закрывает простой ход: `lib/adapters.js:66-71`
`splitFrontmatter` берёт значение дословно (`.slice(13)`), кавычек не снимает, поэтому
`JSON.stringify` от уже закавыченного даст в `.mdc` экранированные кавычки. Значит либо кавычить
при рендере Claude и Codex, либо кавычить шаблон **и** научить `splitFrontmatter` снимать кавычки.

Красная проба — разбор front matter настоящим YAML-парсером: собственный гейт парности
(`lib/templates.js:50-52`, `frontmatterField`) построчный и к этому дефекту слеп.
