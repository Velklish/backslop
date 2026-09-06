# BS-24 · Upgrade backslop переставляет пин только в конфиге, а прозу в docs — нет, и живые инструкции продолжают звать снятую версию инструмента

- **Область:** [reference/02](../../reference/02-cli.md), [reference/03](../../reference/03-lint.md), `lib/upgrade.js`, `lib/lint.js`, `lib/mdwalk.js`
- **Создана:** 2026-09-06
- **Зависимости:** нет

## Контекст

Замер сегодня (2026-09-06) на потребителе ati-agents (backslop.json: `cli` = `npx github:Velklish/backslop#v0.4.0`, `version` = 0.4.0): docs/archive/README.md:5 — «сводку печатает `npx github:Velklish/backslop#v0.3.1 status`»; docs/archive/README.md:7 — «Переезд делает `npx github:Velklish/backslop#v0.3.1 archive N`». По репозиторию (`git grep -o`, без `.claude/worktrees`) — 14 вхождений `backslop#v0.3.1` против 51 `#v0.4.0`; живой инструкцией остался только этот файл, остальные — CHANGELOG.md, docs/adr/adr-039-process.md и два task.md в docs/archive/BL-541.../BL-542.1.../ — исторические записи, где номер версии описывает момент, а не команду для запуска. `npx github:Velklish/backslop#v0.4.0 lint` в ati-agents сегодня печатает «✔ lint: ошибок нет».

Почему не чинится само: `rewriteGates` (lib/upgrade.js:37-38) переписывает пин только внутри `cli` и элементов `gates`; `init`, которым `upgrade` докладывает новую раскладку, существующий файл не трогает (lib/init.js:98, `if (existsSync(target)) { skipped.push(...); continue; }`) — поэтому шаблон docs/archive/README.md с плейсхолдером `{{cli}}` не перерендеривается. `lintVersion` (lib/lint.js:55-69) сверяет пин в `cli` со штампом `version` внутри самого backslop.json и не смотрит в markdown вовсе; ни один из восьми гейтов lint (docs/reference/03-lint.md) прозу не проверяет.

Цена расхождения реальна: гейт «штамп новее инструмента» стоит только в lib/init.js:48 и lib/migrate.js:20 — команда, вызванная по устаревшей прозаической инструкции, отработает молча на новой раскладке (пример: v0.3.1 брала дату по UTC вместо календарной даты машины — BS-8, исправлено в v0.4.0).

Self-host: в самом backslop README.md:59 и :63 называют `github:Velklish/backslop#v0.2.0` при установленном инструменте v0.4.0; свой `cli` в backslop.json — `node bin/backslop.js`, без пина (`parseCli` возвращает `pin: null`), поэтому механическая сверка «пин в прозе равен пину cli» там неприменима без отдельной ветки на TOOL_VERSION — предположение, не проверено кодом, требует явного решения при реализации.

## Что сделать

- lib/upgrade.js: после rewriteGates, при реальной (не --pin-only) смене cli — обходчиком lib/mdwalk.js пройти по docs/** и корневым *.md, заменить точный литерал старого cli на новый; исключить CHANGELOG.md, docs/adr/** и docs/archive/<prefix>-N-*/ — напечатать число заменённых файлов рядом со строкой «gates с новым пином: N из M».
- lib/lint.js: рядом с lintVersion — по тем же не исключённым файлам найти пин вида <репозиторий без версии>#v\d+\.\d+\.\d+ (и npm-форму @X.Y.Z), отличный от cfg.cli, вернуть предупреждение с именем файла, строкой и ожидаемым пином; когда parseCli(cfg.cli).pin === null (self-host, глобальная установка) — сравнивать с TOOL_VERSION вместо cfg.version, либо явно не проверять и сказать об этом в reference.
- docs/reference/02-cli.md: в строку контракта upgrade добавить «и совпадающие упоминания пина в docs/**».
- docs/reference/03-lint.md: в абзац предупреждений о версии — пункт про расхождение пина в прозе.
- CHANGELOG.md — запись о новом поведении upgrade/lint.
- test/upgrade.test.mjs — docs-файл со старым пином после upgrade получает новый; файлы в docs/adr/ и docs/archive/<prefix>-N-*/ — без изменений.
- test/lint.test.mjs — мутационная проба: старый пин в живом файле красит предупреждение/ошибку (форма — по решению исполнителя) с именем файла и строкой; откат мутации — снова тихо.

## Не входит

- Правка docs/adr/** и docs/archive/<prefix>-N-*/task.md — исторические записи, которые не редактируются, а замещаются новым решением.
- Версии, упомянутые в CHANGELOG.md, — они описывают историю релиза, не инструкцию.
- Смена формы самого пина (git → npm) — не эта задача.

## Проверки

- На подставном проекте с docs/archive/README.md, содержащим старый пин: upgrade --pin-only переписывает файл на новый пин; docs/adr/... и docs/archive/<prefix>-N-*/task.md остаются прежними.
- test/lint.test.mjs: мутация — вернуть старый пин в живой файл — красит предупреждение/ошибку с именем файла; откат — тихо.
- node bin/backslop.js lint в самом backslop не падает и не даёт ложных срабатываний на self-host случае (cli без пина).
