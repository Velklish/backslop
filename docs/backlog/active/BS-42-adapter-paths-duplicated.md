# BS-42 · Пути трёх harness-каталогов и имя скилла `backslop-task` продублированы в шести и более местах — рассинхрон одной копии молча отключает гейт парности или чистку generated-файлов

- **Область:** [reference/01](../../reference/01-layout.md), `lib/adapters.js`, `lib/config.js`, `lib/adapter-ownership.js`, `lib/lint.js`, `.gitignore`
- **Создана:** 2026-09-06
- **Зависимости:** нет
- **Взята:** 2026-09-09

## Контекст

Тройка путей `{claude: ['.claude','skills'], cursor: ['.cursor','rules'], codex: ['.agents','skills']}` записана независимо минимум в шести местах: lib/config.js:15 — `export const TOOLS = ['claude', 'cursor', 'codex'];`; lib/adapters.js:14-18 — `const adapterRoots = {...}`; lib/adapters.js:74-76 — те же пути литералами внутри `ownedAdapterFiles`; lib/adapters.js:82 — `const counts = { claude: 0, cursor: 0, codex: 0 };`; lib/adapters.js:86-88 — те же строки внутри `renderAdapters`; lib/adapter-ownership.js:26-30 — `LEGACY_ADAPTER_RELS` собирает те же три префикса ещё раз; lib/adapter-ownership.js:32-36 — `isAdapterRel` проверяет те же три префикса построчно; .gitignore:6-17 — 12 строк с именами трёх скиллов (backslop-task, backslop-batch, backslop-seed) по трём harness-каталогам.

Отдельно имя канонического скилла backslop-task зашито ещё в трёх местах: lib/config.js:92-93 (существование `.claude/skills/backslop-task/SKILL.md` — улика legacy-конфига по ADR-008), lib/lint.js:49 (тот же путь как признак «это репозиторий инструмента», включающий гейт `templateParity` через `lintTemplateParity`), lib/adapter-ownership.js:6 (первый элемент `LEGACY_SOURCES`).

Все копии сегодня согласованы (проверено чтением каждого места) — активного расхождения нет. `templateParity()` вызывается напрямую из test/templates.test.mjs:11, в обход `lintTemplateParity` — то есть переименование canonical-скилла, которое погасит маркер в lib/lint.js:49 и тем самым выключит гейт внутри `lint`, этот тест не заметит.

Утверждение из одной из исходных находок — «слот для нового harness объявлен в docs/reference/02-cli.md как штатное расширение» — не подтвердилось: docs/reference/02-cli.md:49 говорит только «Оркестратор любого harness работает с backslop через файлы и CLI; другого API нет», без анонса четвёртого adapter. Поиск по gemini|windsurf|copilot|zed и по docs/backlog/{triage,queue,active,deferred} (сейчас пусты, кроме BS-2.1) ничего не даёт — четвёртый harness нигде не запланирован. Это снижает срочность, но не отменяет цену будущей правки состава adapters или переименования canonical-скилла — обычной правки templates/skills/**, разрешённой AGENTS.md.

## Что сделать

- Свести три пути и имена adapters к одной таблице (например, в lib/adapter-ownership.js или новом lib/adapters-registry.js): `{ id, root: ['.claude','skills'] }` на каждый adapter, и `CANONICAL_SKILL = 'backslop-task/SKILL.md'` рядом с `LEGACY_SOURCES`.
- Вывести из этой таблицы: `TOOLS` (lib/config.js:15), `adapterRoots` и ключи `counts` (lib/adapters.js), `ownedAdapterFiles`/`isAdapterRel`/`LEGACY_ADAPTER_RELS` (lib/adapter-ownership.js).
- lib/config.js:93 и lib/lint.js:49 — брать `CANONICAL_SKILL` из общего модуля вместо литерала; признак «репозиторий инструмента» в lint.js — по существованию каталога templates/skills/, а не конкретного файла-маркера.
- Тест: переименовать canonical-скилл в фикстуре и убедиться, что гейт парности продолжает срабатывать, а не молча выключается.
- docs/reference/01-layout.md:17-23,40 — уточнить формулировку после сведения к одному источнику, если понадобится.

## Не входит

- Добавление четвёртого harness (gemini/windsurf и т. п.) — не запланировано нигде в репозитории; эта задача только сводит существующие три к одному источнику.
- Замена перечисления в .gitignore на шаблон, если синтаксис git не подходит для конкретного legacy-набора файлов — тогда список остаётся явным, но берётся из общего источника.

## Проверки

- `npm test` и `node bin/backslop.js lint` зелёные.
- Новый тест: переименование canonical-скилла в фикстуре не оставляет `lintTemplateParity` молча выключенным.
- `grep -rn "'.claude', 'skills'\|'.cursor', 'rules'\|'.agents', 'skills'" lib/` — после правки совпадения только в новом едином источнике.
