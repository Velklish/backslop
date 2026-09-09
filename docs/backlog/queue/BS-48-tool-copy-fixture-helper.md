# BS-48 · Оснастка «копия инструмента» продублирована в test/init.test.mjs и test/lint.test.mjs — вынести в helpers.mjs

- **Порядок:** 60
- **Область:** `test/helpers.mjs`, `test/init.test.mjs`, `test/lint.test.mjs`, [03-lint](../../reference/03-lint.md)
- **Создана:** 2026-09-09
- **Зависимости:** нет

## Что сделать

- [TODO]

## Не входит

- [TODO]

## Проверки

- [TODO]

## Контекст

Находка worker'а A при закрытии BS-42 (2026-09-09). Пробы, которым нужен self-host (снятие adapter'а по предикату владения в BS-36, парность шаблонов и гейт релиза после смены признака self-host в BS-42), поднимают копию инструмента — `bin`, `lib`, `templates`, `package.json` в `mkdtemp`, `init` в копии, `lint` копийным bin — и эта оснастка (`toolProject`, около 15 строк с гашением предупреждений Node через `NODE_OPTIONS=--no-warnings`) живёт в двух файлах: `test/init.test.mjs` и `test/lint.test.mjs`. Улика: `grep -n toolProject test/init.test.mjs test/lint.test.mjs`. Общее место просится в `test/helpers.mjs` рядом с `makeProject`; при переносе учесть, что копия не несёт `CHANGELOG.md` и пробы кладут его сами.
