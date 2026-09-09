# BS-44 · `docs/backlog/README.md` и `docs/archive/README.md` — байт-в-байт рендер шаблона без гейта, а `AGENTS.md` называет местом правки процессного правила только шаблон

- **Область:** [reference/01](../../reference/01-layout.md), [reference/03](../../reference/03-lint.md), `AGENTS.md`, `lib/init.js`, `lib/lint.js`, `lib/templates.js`, `templates/docs/backlog/README.md`, `templates/docs/archive/README.md`
- **Создана:** 2026-09-06
- **Зависимости:** нет
- **Взята:** 2026-09-09

## Контекст

Проверено сейчас построчным сравнением: `docs/backlog/README.md` (45 строк) и `docs/archive/README.md` (7 строк) — точный рендер `templates/docs/backlog/README.md` и `templates/docs/archive/README.md` после подстановки `{{project}}`→`backslop`, `{{cli}}`→`node bin/backslop.js`, `{{prefix}}`→`BS` (0 расходящихся строк на обоих файлах). Из шести файлов скелета документации это единственная пара с нулевым расхождением — `GLOSSARY.md`, `README.md`, `ROADMAP.md`, `reference/README.md` уже осознанно наполнены проектным контентом и с шаблоном расходятся.

`lib/init.js:96-99` пропускает уже существующий файл документации при повторном `init` (`if (existsSync(target)) { skipped.push(...); continue; }`) — задокументированное поведение, `docs/reference/01-layout.md:25`: «Файлы `docs/` создаются только отсутствующие». Гейт `templateParity` (вызов на `lib/lint.js:51`, реализация в `lib/templates.js`) сверяет только `templates/` с `templates/en/` — до собственного `docs/` репозитория не доходит.

`AGENTS.md:5` называет местом правки процессного правила только `templates/skills/**` или `templates/docs/**`; `AGENTS.md:16` при этом отсылает воркеров этого репозитория к `docs/backlog/README.md` как к действующим правилам ведения бэклога — расхождение между «где менять правило» и «что реально читают» контракт не проговаривает.

Риск не гипотетический: `git log --oneline -- templates/docs/backlog/README.md docs/backlog/README.md` показывает, что оба файла (и их английский близнец в `templates/en/`) уже правились вручную синхронно в коммитах BS-10 (`3cd2c7c`) и BS-11 (`e79467f`) — то есть сегодня соответствие держится памятью автора, а не правилом или гейтом.

## Что сделать

- Добавить в `AGENTS.md` рядом со строкой 5 явное предложение: правка процессного текста в `templates/docs/backlog/README.md` или `templates/docs/archive/README.md` обязана в том же коммите обновить одноимённый файл в `docs/` этого репозитория — только эти два файла, они рендерятся 1:1 без проектного контента, в отличие от GLOSSARY/README/ROADMAP/reference.
- Новый код и новый гейт не нужны: для двух файлов одного репозитория текстовое правило соразмернее автоматической сверки (Simplicity first).

## Не входит

- Гейт автоматической сверки `docs/<файл>` с рендером шаблона — рассматривался как альтернатива (M-эффорт вместо S), отклонён как несоразмерный для двух файлов одного репозитория.
- `GLOSSARY.md`, `README.md`, `ROADMAP.md`, `docs/reference/README.md` — уже осознанно наполнены проектным контентом, вопрос синхронизации 1:1 к ним не относится.

## Проверки

- Диф коммита с правкой `AGENTS.md`: предложение о синхронной правке добавлено рядом со строкой 5.
- На следующей правке `templates/docs/backlog/README.md` или `templates/docs/archive/README.md` — построчный diff (как в этом отчёте) подтверждает, что собственный `docs/`-файл обновлён тем же коммитом.
