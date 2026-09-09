# BS-46 · Четыре ветви, объявленные комментариями кода — охрана `ownedPath` от записи сквозь symlink, следование по symlink в обходе markdown, терпимость owned-маркера к CRLF и откат `moveFile` на `renameSync` с предупреждением — не закреплены ни одним из 134 тестов

- **Область:** [reference/01](../../reference/01-layout.md), `lib/adapters.js`, `lib/tasks.js`, `lib/mv.js`, `lib/archive.js`, `lib/adapter-ownership.js`, `lib/mdwalk.js`
- **Создана:** 2026-09-06
- **Зависимости:** нет
- **Взята:** 2026-09-09

## Контекст

`ownedPath` (`lib/adapters.js:25-44`, охрана на строке 35 — `if (lstatSync(current).isSymbolicLink())`) — единственная защита `init`/`cleanupAdapters` от записи и удаления файлов сквозь symlink (используется в `write` и в `removeFile`/`pruneEmpty`). Прогон `node --test` сейчас — 134/134 pass, и ни `test/init.test.mjs`, ни `test/commands.test.mjs` не проводят adapter-путь через symlink: единственный symlink в `test/init.test.mjs:135` (`.claude` → `AGENTS.md`) проверяет сохранение `CLAUDE.md` при `tools: []`, а не эту охрану.

Откат `moveFile` на `renameSync` (`lib/tasks.js:453`) с предупреждением «файл не в индексе git — перенесён без git mv» (`lib/mv.js:50`, `lib/archive.js:38`) реально срабатывает в существующих тестах — `mv`/`archive` над уже используемым в наборе некоммиченным файлом в `test/init.test.mjs`/`test/commands.test.mjs` создаёт такие файлы без `git add` — но `grep -rn 'не в индексе git' test/` не находит ни одного `assert` на этот текст: срабатывает вслепую.

Терпимость маркера owned output к CRLF: `test/adapter-ownership.test.mjs:27-39` гоняет `hasGeneratedMarker`/`markGenerated` только на LF-текстах (строки 30 и 32). Регекс маркера и фронтматтера в `lib/adapter-ownership.js` использует `\r?\n`, но ни один тест не проверяет CRLF-вариант — а маркер решает, какие файлы `repoMarkdown` (`lib/mdwalk.js`) исключает из обхода и какие `cleanupAdapters` вправе удалить.

Следование по symlink в обходе: `test/mdwalk.test.mjs:38-47` проверяет только защиту от петли (`symlinkSync(sb, .../docs/loop)` → `['docs/a.md']`). Комментарий `lib/mdwalk.js:33-34` прямо объявляет обратное намеренным поведением («Симлинк — не isFile() и не isDirectory(): идём по ссылке»), но ни один тест не проверяет, что файл, до которого дошли только через symlink-каталог, попадает в результат обхода.

(Отдельно найденная асимметрия lint/rewrite на блоках кода в `lib/links.js:121-123` — тема другой подсистемы, перепись ссылок при `archive`/`mv`, а не запись/удаление файлов через symlink — в эту задачу не входит.)

## Что сделать

- `test/init.test.mjs` — проект, где выбранный adapter-путь (например `.claude`) — symlink на соседний каталог; `init --tools claude` отказывает текстом «adapter path содержит symlink» и не пишет по ту сторону ссылки.
- `test/commands.test.mjs` (или `init.test.mjs`) — на уже используемом в наборе некоммиченном файле добавить `assert.match` на текст предупреждения «файл не в индексе git — перенесён без git mv».
- `test/adapter-ownership.test.mjs:27` — третий и четвёртый кейс: `markGenerated` на CRLF-варианте (`\r\n`) для обычного skill-файла и для файла с фронтматтером (cursor rule), оба → `hasGeneratedMarker` даёт `true`.
- `test/mdwalk.test.mjs` — к существующему тесту про петлю добавить symlink на каталог с файлом вне обхода и ожидать его в результате `mdFiles`.

## Не входит

- Асимметрия lint/rewrite на блоках кода в `lib/links.js:121-123` (переписывание ссылок внутри фенсов при `archive`/`mv`, которое `lint` не видит) — отдельная подсистема, не про запись/удаление файлов через symlink; кандидат на отдельную запись бэклога.

## Проверки

- Мутационная проба для symlink-охраны: временно убрать проверку `lstatSync(current).isSymbolicLink()` в `lib/adapters.js:35` — новый тест `init.test.mjs` должен покраснеть.
- Мутационная проба для CRLF: убрать `\r?` из регекса маркера и фронтматтера в `lib/adapter-ownership.js` — новые кейсы в `adapter-ownership.test.mjs` должны покраснеть.
- Мутационная проба для следования по symlink: заменить `e.isSymbolicLink() ? statOrNull(child) : e` на `if (e.isSymbolicLink()) continue;` в `lib/mdwalk.js:46` — новый assert в `mdwalk.test.mjs` должен покраснеть.
- Мутационная проба для fs-fallback: закомментировать `warn(...)` на `lib/mv.js:50`/`lib/archive.js:38` — новый `assert.match` должен покраснеть.
