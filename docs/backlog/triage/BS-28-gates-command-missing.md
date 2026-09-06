# BS-28 · gates в backslop.json остаётся списком без команды, которая бы его прогнала, поэтому агент копирует его в прозу вручную, и в contributing.md копия уже разошлась

- **Область:** [reference/02](../../reference/02-cli.md), `lib/config.js`, `bin/backslop.js`, `lib/upgrade.js`
- **Создана:** 2026-09-06
- **Зависимости:** нет

## Контекст

Проверено сегодня в promptobus: backslop.json:5-8 держит два гейта — `npx github:Velklish/backslop#v0.4.0 lint` и `npm run audit`; package.json:24 — `audit: node scripts/audit-public.mjs`, файл существует. bin/backslop.js:12 (COMMANDS) — init, new, mv, archive, adr, status, lint, upgrade, migrate, changelog, version; команды gates среди них нет, backslop help её не называет. Из кода gates читает и переписывает только upgrade (lib/upgrade.js:37,94, rewriteGates) — только пин внутри строк, не факт их прогона.

contributing.md:31 — «Commands in `backslop.json` `gates` must exit 0. Today that is `npx github:Velklish/backslop#v0.4.0 lint`. Also run `npm test` when you touch runtime code.» — называет только lint, не audit; npm test упомянут прозой, но гейтом не является (в gates его нет), решение запускать его или нет остаётся за работником по признаку «трогал ли runtime-код». contributing.md:79 — «See the publicity checks in the project gates when they land.» — хотя npm run audit уже стоит в gates и scripts/audit-public.mjs существует.

## Что сделать

- backslop gates [--dry-run] — читает gates из backslop.json (lib/config.js), прогоняет каждую команду оболочкой (тот же уровень доверия, что уже применяет upgrade к командам из cli/gates — lib/upgrade.js:41), печатает command → exit code, останавливается на первом отказе ненулевым кодом.
- contributing.md:31 — заменить перечисление на общую формулировку «Команды из gates в backslop.json должны быть зелёными — прогони их: npx github:Velklish/backslop#v0.4.0 gates» (по образцу templates/skills/backslop-task/SKILL.md:26-28, где список уже не дублируется); npm test остаётся отдельной строкой для правки runtime-кода, раз он не входит в gates.
- contributing.md:79 — убрать «when they land», раз audit уже в gates.
- docs/reference/02-cli.md — строка команды gates в таблице.
- CHANGELOG.md — запись о новой команде.
- test/commands.test.mjs — gates на проекте с двумя командами (одна успешная, одна с ненулевым кодом) останавливается на первой неудачной и не запускает вторую; --dry-run печатает список без исполнения.

## Не входит

- Добавление npm test в сам gates backslop.json промптобаса — решение владельца о том, всегда ли гонять полный набор тестов; эта задача только даёт команду, которая читает уже объявленный список.
- Правка описаний остальных команд в bin/backslop.js help — меняется только добавляемая строка про gates.

## Проверки

- backslop gates на подставном проекте с gates: ['true', 'false'] — печатает первую с кодом 0, вторую с кодом 1, возвращает 1 и не идёт дальше.
- backslop gates --dry-run — печатает обе команды без exit-кодов, возвращает 0.
- contributing.md после правки называет команду gates, а не перечисляет lint/audit построчно.
