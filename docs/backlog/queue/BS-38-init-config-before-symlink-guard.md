# BS-38 · `init` пишет `backslop.json` и скелет docs до проверки adapter-путей на symlink — на общем `.claude` любой `init` отказывает уже после записи, а `--tools none` из этого состояния не выводит

- **Порядок:** 20
- **Область:** `lib/init.js`, `lib/adapters.js`, [reference/01](../../reference/01-layout.md)
- **Создана:** 2026-09-06
- **Зависимости:** нет

## Контекст

`lib/init.js:72` — `saveConfig(root, cfg);` — пишет конфиг раньше проверки adapter-путей: раскладка скелета `docs/` идёт следом (93-113), а `cleanupAdapters`/`renderAdapters` (117-118) — последними. Внутри них `ownedPath` (`lib/adapters.js:25-44`) обходит каждую компоненту пути под корнем проекта и бросает `CliError` на symlink (строка 36); зовёт её `markedFiles` (`lib/adapters.js:128`) — на корне каждого из трёх adapter'ов, независимо от `cfg.tools`.

Проба на проекте с `ln -s ../shared-claude .claude` (воспроизведено заново):
- `backslop init --tools claude` → `✖ adapter path содержит symlink: .claude`, код 1 — но на диске уже `backslop.json` (`tools: ["claude"]`) и весь скелет `docs/` (12 файлов). Следом `backslop lint` → 8 ошибок («нет generated output для adapter claude» ×7, «нет Claude stub»), код 1, и совет — та же команда, которая падает.
- То же в проекте без флагов вовсе (умолчание `tools: []`): `backslop init` даёт тот же отказ, тоже после записи `backslop.json` и `docs/` — `markedFiles` проверяет корень `.claude` независимо от того, выбран ли `claude` в `tools`.
- Выхода через CLI нет: `backslop init --tools none` на том же проекте падает так же (`✖ adapter path содержит symlink: .claude`, код 1). Ручная правка `backslop.json` на `tools: []` красит `lint` в зелёный, но `init` продолжает падать, пока symlink на месте — при общем harness-каталоге `init` не проходит вообще никогда.

Тестами защита не покрыта: symlink в `test/` встречается только в петле `mdwalk` и в кейсе `CLAUDE.md → AGENTS.md` (`test/init.test.mjs:135`), не для корней adapter'ов. В backlog и архиве об этом ничего нет; ADR-006 про порядок «конфиг → раскладка» и про symlink не говорит.

## Что сделать

- Переставить проверку: до первой записи (`lib/init.js:72`, `saveConfig`) прогнать `ownedPath` по adapter-корням всех трёх harness (`.claude`, `.cursor/rules`, `.agents/skills`) — тем же обходом, что уже делает `markedFiles`, только раньше; отказ должен случаться до создания `backslop.json` и скелета `docs/`.
- В текст отказа добавить причину и лечение: symlink — защита от записи/unlink сквозь чужую ссылку; чтобы `init` прошёл, на месте adapter-корня должен быть обычный каталог — явно сказать, что `--tools none` эту ситуацию не решает.
- Отдельным открытым вопросом (не решать в этой задаче) — владельцу: легитимен ли symlink, чей `realpath` лежит внутри корня проекта, и стоит ли звать `markedFiles`/`ownedPath` для adapter'а, не входящего в `cfg.tools`, если под его корнем ничего нет — иначе self-host с общим harness-каталогом никогда не пройдёт `init`.
- Тест в `test/init.test.mjs`: `init` на проекте с симлинкнутым `.claude` отказывает и не создаёт `backslop.json`.

## Не входит

- Сам ответ на вопрос «легитимен ли symlink с realpath внутри корня» — решение владельца, не код этой задачи.
- Поведение `ownedPath` внутри `write`/`removeFile` при обычной (не-init) операции — там охрана уже стоит и работает как задумано.

## Проверки

- Проба «symlink на `.claude`, любые `--tools`»: `init` отказывает, и на диске нет `backslop.json`.
- Мутационная проба: вернуть `saveConfig` перед проверкой — новый тест краснеет.
- `npm test` зелёный.
