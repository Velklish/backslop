# BS-48 · Оснастка «копия инструмента» продублирована в test/init.test.mjs и test/lint.test.mjs — вынести в helpers.mjs

- **Область:** `test/helpers.mjs`, `test/init.test.mjs`, `test/lint.test.mjs`, [03-lint](../../reference/03-lint.md)
- **Создана:** 2026-09-09
- **Зависимости:** нет
- **Взята:** 2026-09-09

## Что сделать

- Вынести копию инструмента в `test/helpers.mjs`: `toolCopy(mutate)` — `bin`, `lib`, `templates`, `package.json` в `mkdtemp`, `mutate` правит копию до первого запуска; `toolCli(tool, args, { cwd })` — команда копийным bin с тем же окружением, что у `cli` (без цвета, без предупреждений Node в stderr).
- `test/init.test.mjs` и `test/lint.test.mjs` берут оснастку оттуда; `toolProject` в lint.test остаётся тонкой обёрткой «init в копии → мутация → lint».

## Не входит

- Предмет самих проб — не меняется; меняется только, откуда берётся копия.
- Копия `CHANGELOG.md`: пробы, которым он нужен, кладут его сами, как раньше.

## Проверки

- `grep -n "cpSync(path.join(REPO" test/*.mjs` — совпадение только в `helpers.mjs`.
- `npm test` и `node bin/backslop.js lint` зелёные; число тестов не меняется.

## Контекст

Находка worker'а A при закрытии BS-42 (2026-09-09). Пробы, которым нужен self-host (снятие adapter'а по предикату владения в BS-36, парность шаблонов и гейт релиза после смены признака self-host в BS-42), поднимают копию инструмента — `bin`, `lib`, `templates`, `package.json` в `mkdtemp`, `init` в копии, `lint` копийным bin — и эта оснастка (`toolProject`, около 15 строк с гашением предупреждений Node через `NODE_OPTIONS=--no-warnings`) живёт в двух файлах: `test/init.test.mjs` и `test/lint.test.mjs`. Улика: `grep -n toolProject test/init.test.mjs test/lint.test.mjs`. Общее место просится в `test/helpers.mjs` рядом с `makeProject`; при переносе учесть, что копия не несёт `CHANGELOG.md` и пробы кладут его сами.
