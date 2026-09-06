# BS-29 · Релиз backslop не бампит версию и не гейтит рассинхрон — README держит устаревший пин `#v0.2.0` три релиза спустя после `0.4.0`

- **Область:** [reference/02](../../reference/02-cli.md), [reference/03](../../reference/03-lint.md), `scripts/release.mjs`, `lib/lint.js`, `README.md`, `README.ru.md`, `AGENTS.md`
- **Создана:** 2026-09-06
- **Зависимости:** нет

## Контекст

Проверено на текущем HEAD (`backslop.json`: `version: "0.4.0"`, `package.json`: `"version": "0.4.0"`). `AGENTS.md:11` сам называет границу: «Этот скрипт сам не меняет версию `package.json`». В `scripts/release.mjs:47-48` единственная проверка версии — `if (actualVersion !== version) throw ...`: скрипт читает `package.json`, но не пишет ни его, ни `backslop.json`, ни `CHANGELOG.md` — совпадение версий в обоих файлах сегодня держится только ручной дисциплиной.

`lib/lint.js:55-67` (`lintVersion`) сравнивает штамп `cfg.version` с `TOOL_VERSION` (`lib/version.js`, читает `package.json`) и с пином в `cli`, но результат идёт только в `note(...)` — предупреждение. Гейт (`lib/lint.js:265-277`, функция `run`) красит код возврата исключительно по `errors.length` (строка 271); `lintVersion` вызывается на строке 43 и в список гейтов, красящих `errors`, не входит. `docs/reference/03-lint.md:16` и справка `bin/backslop.js:26` оба говорят «восемь гейтов» — рассинхрон версии в их число не входит намеренно (это гейт для чужого проекта с отставшей раскладкой, не для релиза самого backslop).

Реальный дрейф, не гипотетический: `README.md:59,63` и `README.ru.md:59,63` сегодня содержат `github:Velklish/backslop#v0.2.0`, тогда как единственный источник правды — `defaultCli()` (`lib/config.js:20-21`) — при `TOOL_VERSION=0.4.0` отдаёт `#v0.4.0`. Пин в README не менялся через релизы `v0.3.0`, `v0.3.1`, `v0.4.0` (CHANGELOG.md, секции этих версий не упоминают README). Задачи про этот рассинхрон нет ни в одном каталоге бэклога backslop (`docs/backlog/{queue,active,triage}` — пусты, `docs/backlog/deferred/` содержит только `BS-2.1-npm-publish.md` — про фактическую публикацию в npm, не про синхронизацию версии или пина) и не в архиве.

## Что сделать

- `scripts/release.mjs`: шаг `--bump`, исполняемый до preflight-проверок — пишет `version` в `package.json`, вызывает `node bin/backslop.js init` (идемпотентен, сам ставит штамп из `TOOL_VERSION`, `lib/init.js:137-139`), переименовывает верхнюю секцию `CHANGELOG.md` в `## vX.Y.Z — <today()>` (`lib/util.js:21`, `today`). После `--bump` агент проверяет дифф и коммитит сам — скрипт релиза дальше не пишет коммитов.
- Девятый гейт в `lib/lint.js`, включаемый тем же self-host-маркером, что `lintTemplateParity` (`existsSync(templates/skills/backslop-task/SKILL.md)`, строка 49-50): ошибка, если `package.json.version !== backslop.json.version`; ошибка, если в `CHANGELOG.md` нет секции с текущей версией; ошибка, если любое вхождение `github:Velklish/backslop#v<X.Y.Z>` или `backslop@<X.Y.Z>` в `README.md`, `README.ru.md`, `AGENTS.md` не совпадает с `defaultCli()`/`npx backslop@${TOOL_VERSION}`.
- Обновить `docs/reference/03-lint.md` («восемь гейтов» → «девять») и справку `bin/backslop.js` (`HELP_RU`, `HELP_EN`) тем же числом.
- Обновить `docs/reference/02-cli.md`: строка о флаге `--bump` в разделе релиза.
- Запись в `CHANGELOG.md`.
- Заодно поправить сам литерал `#v0.2.0` → `#v0.4.0` в `README.md:59,63` и `README.ru.md:59,63` — новый гейт иначе сразу красный на существующем дереве.

## Не входит

- Публикация в npm и смена default `cli` с GitHub-формы на npm-форму — это `BS-2.1` (deferred), не текущая задача.
- Общий раннер гейтов из `backslop.json` (`gates`) как абстракция — здесь только конкретный девятый гейт `lint`, без новой инфраструктуры.

## Проверки

- `node bin/backslop.js lint` в самом репозитории backslop зелёный после исправления литералов README.
- Красная проба в `test/lint.test.mjs`: временный проект с `backslop.json.version` не равным `package.json.version` — лint красный с этим сообщением; совпавшие версии — тишина по этому гейту.
- Отдельная проба: `README.md`/`AGENTS.md` с устаревшим `#vX.Y.Z` при текущем `TOOL_VERSION` — лint красный.
- `npm run release -- X.Y.Z --bump` (или ручной прогон шага) на подставном чистом дереве: после шага `package.json`, `backslop.json` и заголовок секции `CHANGELOG.md` совпадают по версии.
