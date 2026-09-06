# BS-20 · Правило не коммитить owned outputs нигде не задокументировано — три потребителя backslop завели три разных `.gitignore`, один держит его вне git

- **Порядок:** 220
- **Область:** `lib/init.js`, `lib/adapter-ownership.js`, `.gitignore`, [reference/01](../../reference/01-layout.md)
- **Создана:** 2026-09-06
- **Зависимости:** нет

## Контекст

lib/init.js:117-118 — `cleanupAdapters(root, cfg)` и `renderAdapters(root, cfg, vars)` кладут adapter outputs и `CLAUDE.md`, но `.gitignore` не трогают ни строкой; шаблона `.gitignore` в `templates/` нет вовсе, то есть это не «уже сделано», а действие, которого `init` никогда не совершал. Слово «gitignore» отсутствует в README.md, README.ru.md, docs/reference/** и templates/** (grep пуст) — единственное упоминание во всём репозитории: закрытая задача docs/archive/BS-5-harness-neutral-self-host/result.md:3 («В `.gitignore` — точечные паттерны owned outputs, не целые harness-каталоги»), исторический отчёт о выполненной задаче, а не действующее правило.

Три реальных `.gitignore` подтверждены построчно сегодня: backslop/.gitignore:4-18 и external/promptobus/.gitignore:11-25 — побайтово одинаковый 14-строчный блок, кончающийся `.claude/skills/backslop-*` в поимённой форме (`.claude/skills/backslop-task/`, `.cursor/rules/backslop-task.mdc` и т.д.) и `/CLAUDE.md`; repos/agent-workspace/ati-agents/.gitignore:4-7 — другая, glob-форма (`.claude/skills/backslop-*`, `.cursor/rules/backslop-*`, `.agents/skills/backslop-*`, `CLAUDE.md`), и в ней вовсе нет строки `.claude/worktrees/`. В ati-agents этот путь игнорируется не из `.gitignore`, а из машинно-локального `.git/info/exclude:12` (`**/.claude/worktrees/`) — подтверждено `git check-ignore -v .claude/worktrees`.

Механизм для такого блока в коде уже есть и используется для другого файла: `upsertBlock` (lib/init.js, вызывается на строке 123 для AGENTS.md) заменяет содержимое между маркерами или дописывает в конец. Восемь гейтов `lint` (docs/reference/03-lint.md) не проверяют, что owned output (набор путей в lib/adapter-ownership.js) не лежит в индексе git — такой проверки нет.

## Что сделать

- Выбрать один механизм и реализовать: (а) `init` пишет/обновляет блок `.gitignore` между маркерами backslop через `upsertBlock` (как для AGENTS.md), состав строк — по факту выбранных `cfg.tools` плюс `/CLAUDE.md`; или (б) девятый гейт `lint`: owned-output путь, попавший в индекс git (`git ls-files --error-unmatch`), — ошибка с перечнем строк для `.gitignore`.
- Абзац в README.md/README.ru.md и в docs/reference/01-layout.md рядом с таблицей adapters, называющий выбранное поведение явно.
- CHANGELOG: запись о новом поведении.

## Не входит

- Правка `.gitignore` в external/promptobus и repos/agent-workspace/ati-agents напрямую — это отдельные репозитории, они получают исправление через собственный `init`/`upgrade`.
- Машинно-локальное правило `.git/info/exclude` в ati-agents — вне backslop.
- Одновременная реализация обоих вариантов (init-блок и lint-гейт) — выбрать один.

## Проверки

- Свежий проект: `init --tools claude` (или другой набор) — выбранным механизмом либо `.gitignore` содержит пути owned outputs, либо явное добавление owned output в индекс красит `lint` с перечнем строк.
- Абзац в README/справочнике на месте и называет `.gitignore`.
- `node bin/backslop.js lint` на self-host дереве backslop (`tools: []`) остаётся зелёным.
