# BS-40 · Гейт `templateParity` сравнивает только состав файлов и подстановки, поэтому пустой `description` в EN-скилле и пропавший раздел проходят `lint` зелёным

- **Область:** [reference/03](../../reference/03-lint.md), [reference/01](../../reference/01-layout.md), `lib/templates.js`, `lib/adapters.js`, `test/templates.test.mjs`
- **Создана:** 2026-09-06
- **Зависимости:** нет
- **Взята:** 2026-09-09

## Контекст

`lib/templates.js:29-47`, функция `templateParity`, сравнивает ровно два множества: пути файлов (строки 31-36, через `srcFiles`) и отсортированные имена `{{подстановок}}` (строки 40-43, функция `placeholders`). Фронтматтер и содержимое файлов эта функция не читает вообще — проверено построчным чтением.

`test/templates.test.mjs:11` — единственный тест по реально собранным `templates/`, `assert.deepEqual(templateParity(), [])`, вызывает функцию напрямую, минуя `lib/lint.js`. `lib/lint.js:48-51` (`lintTemplateParity`) включает тот же гейт внутри `lint` по признаку существования файла-маркера `templates/skills/backslop-task/SKILL.md` (строка 49) — но проверка контракта фронтматтера Cursor не добавлена ни в одном из двух мест.

Adapter для Cursor берёт `description` буквальной строкой из фронтматтера SKILL.md (`lib/adapters.js:53-56`, `splitFrontmatter`: при отсутствии строки `description:` подставляется пустая строка через `?? ''`) и пишет её как есть в `.cursor/rules/*.mdc` (`lib/adapters.js:93`: `` description: ${JSON.stringify(description)} ``).

Проверено на текущем HEAD: во всех трёх `templates/en/skills/*/SKILL.md` `description` непустой (`sed -n '1,6p'` по каждому файлу) — активного повреждения сегодня нет, риск латентный. Пробы на копии дерева (не в репозитории): (а) удаление строки `description:` из `templates/en/skills/backslop-task/SKILL.md` — `npm test` 134/134 pass, `node bin/backslop.js lint` без ошибок, `init --lang en --tools cursor` кладёт `.cursor/rules/backslop-task.mdc` с `description: ""`; (б) вырезание раздела `## Verification` из `templates/en/task.md` и переименование `name: backslop-task` → `name: backslop-tsk` в SKILL.md — 134/134 pass.

Единственная в репозитории проверка «нет кириллицы в EN» — `test/init.test.mjs:246` (regexp `/[А-Яа-яЁё]/`) и утверждения на строках 249-253 — смотрит 6 файлов рендера одного тестового проекта (docs/README.md, docs/GLOSSARY.md, docs/backlog/README.md, AGENTS.md, два .cursor/rules/*.mdc), а не 18 файлов-источников под `templates/en/`.

`docs/adr/adr-005-localization.md` («Варианты») обещает буквально то, что гейт и делает: «`lint`… краснеет, если набор файлов или подстановок разошёлся» — это не отступление от ADR-005, а его дословное, но узкое исполнение; контракт фронтматтера Cursor из `docs/adr/adr-006-adapter-ownership.md:21` («Cursor: `.cursor/rules/backslop-*.mdc` с фронтматтером») этим гейтом не подкреплён нигде. Поиск по `docs/backlog` (пусто) и `docs/archive` (закрытые BS-1-english-layer и BS-3-cursor-rules-render описывают текущий узкий охват гейта, а не эту дыру) не нашёл отдельной задачи на эту тему.

## Что сделать

- Расширить `templateParity` (`lib/templates.js`) тремя механическими сравнениями пар файлов без перевода текста: (а) для каждой пары `skills/**/SKILL.md` — фронтматтер `name` и `description` непустые в обоих слоях, `name` совпадает с именем каталога скилла; (б) число и уровень markdown-заголовков (`^#{1,6} `) совпадает между ru- и en-версией файла; (в) в файлах под `templates/en/` нет кириллицы.
- Красные пробы в `test/templates.test.mjs` на fixture из `mkdtempSync`, по образцу существующего теста «называет missing, extra и mismatch placeholders» (строки 14-28): пустой/отсутствующий `description`, разное число заголовков, кириллица в en-файле.
- `docs/reference/03-lint.md:16` — дополнить описание гейта новыми проверками; если решат не покрывать содержательное расхождение без изменения числа заголовков — явно зафиксировать это ограничение там же.
- CHANGELOG.md — запись.

## Не входит

- Перевод существующего расхождения контента ru/en, если оно где-то есть, — эта задача только про гейт, не про сам текст шаблонов.
- Проверка полного текстового совпадения структуры (списки, блоки кода) — по числу заголовков ловится не любое расхождение; это сознательно остаётся на ревью.

## Проверки

- `test/templates.test.mjs`: новые красные пробы (файл без `description`, файл с другим числом заголовков, кириллица в `templates/en/`) возвращают непустой `templateParity()`; существующий зелёный кейс `assert.deepEqual(templateParity(), [])` остаётся зелёным.
- `npm test` и `node bin/backslop.js lint` зелёные на текущем дереве репозитория.
