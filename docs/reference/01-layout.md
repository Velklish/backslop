# 01. Раскладка и форматы

## Что кладёт `init`

```
<проект>/
  backslop.json                    конфиг: prefix, docs, cli (с пином), gates, version, lang, tools
  AGENTS.md                        блок между <!-- backslop:start --> и <!-- backslop:end -->
  docs/README.md                   индекс документации и таблица ADR
  docs/ROADMAP.md  docs/GLOSSARY.md  docs/reference/README.md
  docs/adr/adr-001-process.md      первый ADR: решение вести задачи и решения по backslop
  docs/backlog/README.md           правила ведения; списка задач нет
  docs/backlog/{triage,queue,active,deferred}/.gitkeep
  docs/archive/README.md
```

Adapters — только если выбраны в `tools` ([lib/adapters.js](../../lib/adapters.js), [ADR-006](../adr/adr-006-adapter-ownership.md)):

| Adapter | Куда пишет |
|---|---|
| `claude` | `.claude/skills/backslop-*` и stub `CLAUDE.md` (`@AGENTS.md`), если файла не было |
| `cursor` | `.cursor/rules/backslop-*.mdc` и namespaced `references/` |
| `codex` | `.agents/skills/backslop-*` |

Правила идемпотентности ([lib/init.js](../../lib/init.js)): конфиг создаётся один раз, и флаги `dir`/`prefix`/`cli`, расходящиеся с ним, — отказ; `--lang` и `--tools` на повторном `init` меняют конфиг. Файлы `docs/` создаются только отсутствующие; выбранные adapter outputs переписываются, снятые чистятся только по owned-путям; блок в `AGENTS.md` заменяется между маркерами, а без маркеров дописывается в конец; штамп `version` переставляется на версию инструмента, пин в `cli` при этом не трогается — расхождение называется предупреждением. Запуск в подкаталоге уже инициализированного проекта отказывает и называет корень. Self-host репозитория держит `tools: []`: обычный `init` не создаёт harness-файлов и не делает tracked tree грязным.

Имя проекта для заголовков — `name` из `package.json` без scope, иначе имя каталога.

## `backslop.json`

| Поле | Умолчание | Смысл |
|---|---|---|
| `prefix` | `BS` | префикс номеров: 2–6 заглавных латинских букв или цифр, первая буква |
| `docs` | `docs` | каталог документации относительно корня |
| `cli` | `npx github:Velklish/backslop#v<версия>` | как звать backslop из этого проекта; подставляется в скиллы и блок AGENTS.md. Форма `npx github:owner/repo#vX.Y.Z` несёт пин, из неё `upgrade` выводит источник релизов |
| `gates` | `["<cli> lint"]` | команды, которые должны быть зелёными до сдачи; скиллы говорят «прогони гейты из конфига» |
| `version` | версия инструмента | штамп: какая версия делала раскладку; ставят `init` и `migrate`, читают `lint` и `upgrade` |
| `source` | нет | откуда `upgrade` берёт теги релизов: git-адрес или путь; без поля — из GitHub-формы `cli`; npm-пин источника не даёт |
| `lang` | `ru` | язык новых файлов и генерируемых artifacts: `ru` или `en`; старый конфиг без поля читается как `ru` |
| `tools` | `[]` | выбранные adapters: уникальный список `claude`, `cursor`, `codex`; старый конфиг без поля и с `.claude/skills/backslop-task/SKILL.md` сохраняет `["claude"]`, без этой улики — пустой список ([ADR-008](../adr/adr-008-legacy-claude-adapter.md)) |

Корень проекта — ближайший каталог с `backslop.json` вверх от текущего ([lib/config.js](../../lib/config.js)).

## Файл задачи

Имя — `<prefix>-N-<slug>.md` или `<prefix>-N.k-<slug>.md` для находки; slug — латиница в нижнем регистре, цифры, дефисы между словами. Каталог — статус. Русские и английские имена полей и разделов читаются вместе в одном бэклоге; новые файлы пишет слой `lang`.

```
# BS-1 · Заголовок

- **Порядок / Order:** 10               только в queue/; целое, шаг 10, меньше — раньше
- **Область / Scope / Area:** [раздел](../../reference/01-layout.md)
- **Создана / Created:** 2026-09-03
- **Взята / Taken:** 2026-09-04         ставит mv … active
- **Зависимости / Dependencies:** нет

## Контекст / Context
## Что сделать / Work to do
## Не входит / Out of scope
## Проверки / Verification
## Отложено / Deferred                  только в deferred/: Отложена, Причина, Условие возврата
```

Поле шапки — строка `- **Имя:** значение` между заголовком и первым разделом `## `; порядок полей произвольный, «Порядок» команды ставят первым ([lib/tasks.js](../../lib/tasks.js), `setField`). Заголовок первой строки обязан называть тот же номер, что имя файла.

Префикс, совпадающий с обычным словом (`API`, `RFC`, `HTTP`), даёт ложные срабатывания гейта упоминаний на строках вида `API-2.0` — выбирай префикс, которого нет в текстах проекта.

Номер выдаёт `new`: максимум по всем каталогам статусов и архиву плюс один; sub-ID находки — максимум `k` среди файлов `N.*` плюс один. Счётчика в файлах нет; два параллельных заведения с одним номером ловит `lint` после слияния.

## Архив

`docs/archive/<id>-<slug>/task.md` — постановка как была, с переписанными по новой глубине ссылками; `result.md` — из шаблона [templates/result.md](../../templates/result.md): дата закрытия, исход, что сделано, чем проверено, какие доки поправлены. Пока в `result.md` остаётся `[TODO]`, `lint` красный.

## ADR

`docs/adr/adr-NNN-<slug>.md`, номер трёхзначный, следующий — по максимуму существующих ([lib/adr.js](../../lib/adr.js)). Шаблон [templates/adr.md](../../templates/adr.md): Status, Date, Deciders, Context, Варианты, Decision, Consequences. Каждый ADR — строка в таблице `docs/README.md`; принятый не правится, а заменяется новым с пометкой в старом.

## Шаблоны — источник

Всё, что `init` кладёт в проект, лежит в [templates/](../../templates/): `docs/**` — скелет документации, `skills/**` — скиллы, `agents-section.md` — блок AGENTS.md, `task.md`, `result.md`, `adr.md` — заготовки команд. Английский слой — `templates/en/` с тем же составом и подстановками; `lint` репозитория инструмента краснеет при расхождении ([lib/templates.js](../../lib/templates.js), `templateParity`). Подстановки `{{prefix}}`, `{{docs}}`, `{{cli}}`, `{{project}}`, `{{date}}`; неизвестная подстановка остаётся в тексте как есть, чтобы дыра была видна.

Owned adapter output помечается `<!-- backslop:generated -->` в начале файла или сразу после YAML-фронтматтера — ровно туда кладёт `markGenerated` ([lib/adapter-ownership.js](../../lib/adapter-ownership.js)). Цитата маркера в теле docs владением не считается. Кроме маркера владение ограничено путями `.claude/skills/`, `.cursor/rules/`, `.agents/skills/` и фиксированным legacy-набором. Generated файлы не входят в `repoMarkdown`: `mv` и `archive` их ссылки не переписывают.
