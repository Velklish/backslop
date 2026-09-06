# BS-43 · Перепись ссылок при переезде задачи продублирована в mv.js и archive.js — archive не подхватывает `findFlatTask`, и `archive N` на файле из плоского `docs/backlog/` отказывает там, где `mv N` тот же файл находит

- **Область:** [reference/02](../../reference/02-cli.md), `lib/mv.js`, `lib/archive.js`, `lib/tasks.js`
- **Создана:** 2026-09-06
- **Зависимости:** нет
- **Взята:** 2026-09-06

## Контекст

Исходящие ссылки: lib/mv.js:57 — `rewriteMovedLinks(text, path.posix.dirname(task.rel), path.posix.dirname(newRel))`; lib/archive.js:44 — тот же вызов, тот же порядок аргументов. Входящие ссылки: lib/mv.js:83-91 и lib/archive.js:50-57 — идентичный цикл `for (const [rel, abs] of repoMarkdown(root)) { ...; rewriteIncomingLinks(...); writeText(abs, after) }`, различие только в поддержке `--dry-run` у archive.

`findFlatTask` (lib/tasks.js:152, `export function findFlatTask({ root, cfg, dirs }, id)`) используется только в lib/mv.js:31 (`findTask(tasks, id, cfg.lang) ?? findFlatTask(project, id)`); в lib/archive.js:23 — только `findTask`, без запасного варианта. Проверено чтением: `archive N` на файле из плоского docs/backlog/ (без совпадения по `findTask`) вернёт ошибку «задачи ${id} нет ни в одном каталоге статуса» (archive.js:24) — там, где `mv N <статус>` тот же файл находит и переносит. test/commands.test.mjs:346-365 покрывает этот сценарий для mv (создаёт docs/backlog/BS-5-flat.md, `mv 5 queue` успешно переезжает и переписывает и исходящие, и входящие ссылки); эквивалентного теста для `archive N` на плоском файле в репозитории нет (grep по test/*.mjs подтверждает).

docs/reference/02-cli.md:13 описывает у mv отдельно этот случай («Файл, лежащий плоско в docs/backlog/ (миграция чужого трекера), тоже переезжает — с пересчётом ссылок на выросшую глубину»); строка :14 про archive этого не упоминает вовсе — документация уже фиксирует асимметрию, не называя её дефектом.

История: docs/archive/BS-4.1-mv-relinks-incoming/task.md — «mv переписывает входящие ссылки на задачу, как archive» (закрытая задача добавляла в mv то, что archive уже умел); docs/archive/BS-9-mv-from-flat-dir-keeps-links/task.md — «mv файла из плоского docs/backlog/ … не переписывает исходящие ссылки на глубину +1» (вторая закрытая задача — тот же догон, тем же направлением). Обе задачи чинили именно mv вслед за archive; сегодняшняя находка — то же расхождение в обратную сторону (archive не умеет то, что теперь умеет mv), то есть третий случай одной и той же истории, а не гипотетический риск.

## Что сделать

- Вынести перенос задачи с переписью ссылок в общую функцию (например, `relocateTask(project, task, newRel, { dry })` в lib/tasks.js), возвращающую список поправленных файлов; вызывать её из lib/mv.js и lib/archive.js вместо двух копий.
- В archive.js подключить findFlatTask как запасной вариант поиска задачи (как в mv.js:31), чтобы `archive N` находил файл из плоского docs/backlog/.
- Тест на archive для плоского файла — по образцу test/commands.test.mjs:346-365 для mv: docs/backlog/BS-N-flat.md, archive N, проверка, что исходящие и входящие ссылки пересчитаны так же, как при mv.
- docs/reference/02-cli.md:14 — уточнить описание archive после исправления, если потребуется.

## Не входит

- Новые правила переписи ссылок (rewriteMovedLinks/rewriteIncomingLinks сами по себе) — эта задача про то, где вызывается существующая логика, а не про то, что она делает.

## Проверки

- Новый тест: docs/backlog/BS-N-flat.md с исходящей и входящей ссылкой (по образцу test/commands.test.mjs:346), archive N — код возврата 0, ссылки пересчитаны, lint зелёный после.
- `npm test` и `node bin/backslop.js lint` зелёные.
