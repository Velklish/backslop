# BS-35 · Инвентаризацию источников гейтов/подсистем и заведение задач «Справочник: …» скилл backslop-seed описывает как механическое извлечение по уликам, но CLI не даёт для них ни одной команды — оба шага агент выполняет вручную

- **Область:** `templates/skills/backslop-seed/SKILL.md`, `templates/skills/backslop-seed/references/inventory.md`, `lib/new.js`, `lib/tasks.js`, [reference/02](../../reference/02-cli.md)
- **Создана:** 2026-09-06
- **Зависимости:** нет
- **Взята:** 2026-09-09

## Контекст

`templates/skills/backslop-seed/SKILL.md:20` (фаза 1, инвентаризация): «Ничего не пиши и не спрашивай, пока не прочитал репозиторий... Итог фазы — четыре списка кандидатов, каждый пункт с уликой» — таблица строк 22-25 называет источники: команды гейтов из манифестов/Makefile/CI/README, подсистемы из каталогов верхнего уровня и точек входа. `SKILL.md:50` (фаза 3, шаг 4): «backslop new describe-<подсистема> --queue --title "Справочник: <подсистема>" (slug — латиница в нижнем регистре и дефисы: describe-orders-api)» — транслитерацию и заведение задачи по каждой строке таблицы подсистем агент делает вручную.

Команды для этого сегодня нет: `node bin/backslop.js help` не называет `seed`, `--scan` или `--queue-reference`; `grep -rn 'seed|--scan|queue-reference' lib/ bin/` находит только список файлов-шаблонов в `lib/adapter-ownership.js:9-12` (`LEGACY_SOURCES`) и упоминание скилла в подсказке `init` (`lib/init.js:158-159`) — самой команды нет. Slug-правило, на которое опирается предложение, уже в коде: `SLUG_RE` (`lib/tasks.js:43`), используется `new` (`lib/new.js:25`) и `adr` (`lib/adr.js:31`).

В backlog (`docs/backlog/{triage,queue,active,deferred}`, сейчас пуст, кроме `.gitkeep`) и в архиве идея не заведена: `grep -rln 'seed|scan|queue-reference' docs/backlog docs/archive` находит только `BS-7` (`scanAdrs`), `BS-11` (`scanTasks`), `BS-3`, `BS-9`, `BS-1` — все про другой `scan`/`seed`, не про эту доработку. `ADR-001` называет существование скилла `backslop-seed` как факт («наполнение документации — backslop-seed»), а не решение вести инвентаризацию и посев очереди руками.

Обе процедуры алгоритмичны без переноса суждения на код: сканирование фиксированных мест (`package.json` scripts, цели Makefile/justfile/Taskfile, шаги CI-конфигов, `*.csproj`/`pyproject.toml`) и перечисление каталогов верхнего уровня — извлечение по улике, а не понимание содержания; правило отбора («без секретов/сети/БД», какие каталоги — настоящие подсистемы) и формулировка терминов остаются за агентом и владельцем. Цикл по строкам таблицы подсистем — такой же формальный обход с уже существующим `SLUG_RE` и проверкой на дубль по имени файла задачи.

## Что сделать

- `backslop seed --scan [--json]`: печатает кандидатов в `gates` (цели `test`/`lint`/`build`/`typecheck` из `package.json` scripts, цели Makefile/justfile/Taskfile, шаги `.github/workflows/*.yml` и `.gitlab-ci.yml`, `dotnet build/test` из `*.csproj`/`*.sln`, `pytest`/`ruff`/`mypy` из `pyproject.toml`/`setup.cfg`) и кандидатов в подсистемы (`src/*`, `services/*`, `apps/*`, `packages/*`, `*.csproj`, точки входа `main`/`Program.cs`/`index.ts`/`bin/cli`) — каждый пункт с путём-уликой; какие из них реальный гейт без секретов/сети/БД и какие каталоги — настоящие подсистемы, по-прежнему решают агент и владелец.
- `backslop seed --queue-reference`: читает таблицу `{{docs}}/reference/README.md`, для каждой строки без готового файла раздела заводит `backslop new describe-<slug> --queue --title "Справочник: <раздел>"` тем же `SLUG_RE` (`lib/tasks.js:43`), пропуская строки, для которых задача уже заведена (по существующему файлу с этим slug), чтобы повторный посев не плодил дублей.
- Новый файл `test/seed.test.mjs`: `--scan` на подставном репозитории (`package.json` + `Makefile` + `.github/workflows/*.yml`) печатает ожидаемых кандидатов с путями; `--queue-reference` заводит задачу на строку без раздела и не создаёт вторую при повторном запуске.
- Обновить `docs/reference/02-cli.md` (строка `seed --scan|--queue-reference` в таблице команд) и `templates/skills/backslop-seed/SKILL.md` (фаза 1, строка 20 — сослаться на `--scan` вместо ручного чтения; фаза 3, шаг 4 на строке 50 — сослаться на `--queue-reference`), а также `templates/skills/backslop-seed/references/inventory.md`.

## Не входит

- Формулировка терминов, глоссария и выбор ADR-кандидатов (остальные шаги фаз 2-3 скилла) — остаются суждением агента и владельца, эти команды их не касаются.
- Семантическая оценка «что из перечисленного — настоящий гейт или подсистема»: команды только перечисляют кандидатов с уликами, отбор не автоматизируется.

## Проверки

- `backslop seed --scan --json` на тестовом репозитории с `package.json` (scripts test/lint), `Makefile` (target `check`) и `.github/workflows/ci.yml` — вывод называет кандидатов из всех трёх источников с путями-уликами.
- `backslop seed --queue-reference` на `reference/README.md` с одной строкой подсистемы без раздела — создаёт ровно один файл `describe-<slug>.md` в `queue/`; повторный запуск не создаёт второго.
- `npm test` зелёный.
