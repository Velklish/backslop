# BS-14 · В backslop нет команды-раннера для `gates` — worker гоняет их по одной вручную, и «N гейтов, M зелёных» вместе с неподвижностью дерева в брифе, отчёте и result.md держатся на его памяти

- **Область:** `bin/backslop.js`, `lib/config.js`, `lib/upgrade.js`, новый `lib/gates.js`, [02-cli](../../reference/02-cli.md), [03-lint](../../reference/03-lint.md), `templates/skills/backslop-task/SKILL.md`, `templates/skills/backslop-batch/SKILL.md`, `templates/skills/backslop-batch/references/measurements.md`, `templates/result.md`
- **Создана:** 2026-09-06
- **Зависимости:** нет

## Контекст

`bin/backslop.js:12` — `const COMMANDS = ['init', 'new', 'mv', 'archive', 'adr', 'status', 'lint', 'upgrade', 'migrate', 'changelog'];` — команды-раннера для `gates` нет вовсе. Поле `gates` только читается и переставляется: `lib/config.js:26` (`defaults()`) и `:99` (дефолт `[cli lint]`, если поле не задано), `lib/upgrade.js:37-38` (`rewriteGates`) и `:94,98,112` — везде это перестановка пина в строках, не исполнение. Готовый паттерн исполнения уже есть — `lib/upgrade.js:41-46`, `exec(command, cwd, recovery, lang)`: `spawnSync(command, { cwd, shell: true, stdio: 'inherit', timeout: 600000 })`, при `status !== 0` бросает `CliError` с кодом самой команды.

Шаг 4 `templates/skills/backslop-task/SKILL.md:26` дословно: «Гони гейты до отчёта, а не после. ... Гейты гони на неподвижном дереве: правка файлов во время прогона даёт красное с уводящим диагнозом.» Обе установки — порядок прогона и неподвижность дерева — не проверяются инструментом, только текстом инструкции. `templates/skills/backslop-batch/references/measurements.md:7` предупреждает о ровно той ловушке, в которую попадает агент, вручную собирающий код возврата гейта через пайп: «Код возврата смотри у самой команды, а не у пайпа: `grep … | wc -l` на упавшем грепе печатает `0` кодом `0`». Там же `:13` — «Гейт на дереве, не равном коммиту побайтно, ничего не доказывает про коммит» — тоже держится на памяти. `templates/skills/backslop-batch/SKILL.md:52` называет критерием готовности «гейты из `backslop.json` зелёные» без числа, а `templates/result.md:5` — «Проверки. [TODO: чем проверено — гейты числом...]» — число в `result.md` approver вписывает по памяти, инструмент его не считает.

Проверено: `grep -rni "gates\|раннер\|runner" docs/backlog docs/archive` в backslop не находит предложенной команды — только пассивные упоминания поля `gates` в `docs/backlog/README.md:26` и в задачах BS-2/BS-4 (там `gates` — предмет пина, не прогона).

## Что сделать

- Новая команда `backslop gates [--keep-going] [--json] [--require-clean]` в новом `lib/gates.js`: читает `gates` из `backslop.json`, гоняет каждую команду тем же паттерном `exec()` (`spawnSync(command, { shell: true, stdio: 'inherit' })`), печатает по строке на гейт — команду, код возврата самой команды, время; без `--keep-going` останавливается на первом красном; в конце — «N гейтов, M зелёных» и снимок дерева (`git rev-parse HEAD`, пусто ли `git status --porcelain`, если `.git` есть)
- `--require-clean` отказывает на грязном дереве до первого запуска — механическая проверка условия «неподвижное дерево» из SKILL.md:26
- `--json` отдаёт тот же состав машиночитаемо — для подстановки в бриф оркестратора и в `result.md`
- `bin/backslop.js` — добавить `'gates'` в `COMMANDS`
- Доки тем же ходом: строка новой команды в таблице `docs/reference/02-cli.md`; `templates/skills/backslop-task/SKILL.md:26` и `:40` — заменить ручное «Гони гейты…» на вызов `backslop gates`; `templates/skills/backslop-batch/SKILL.md:52` и `references/measurements.md:13` — сослаться на встроенный снимок дерева вместо ручной проверки; `templates/result.md:5` — подставлять число гейтов из `--json`
- Красная проба: фикстура с двумя гейтами, один падает — без `--keep-going` код 1 и второй гейт не запущен; с `--keep-going` код 1, оба гейта запущены, в выводе «2 гейта, 1 зелёный»; `--require-clean` на грязном дереве — отказ до первой команды

## Не входит

- Решать, дефект ли красный гейт и законна ли грязь дерева, — остаётся агенту, инструмент только докладывает факт
- Встраивать раннер в `upgrade`, `archive` или CI — только явный вызов `backslop gates`
- Менять формат поля `gates` в `backslop.json`

## Проверки

- На подставном проекте с двумя гейтами (второй — `exit 1`): `backslop gates` без `--keep-going` — код 1, вывод останавливается после первого гейта; с `--keep-going` — код 1, оба гейта в выводе, итоговая строка «2 гейта, 1 зелёный»
- `backslop gates --require-clean` на грязном дереве — отказ без вызова первой команды из `gates`
- `backslop gates --json` — валидный JSON с полями команды, кода и длительности по каждому гейту и снимком дерева
