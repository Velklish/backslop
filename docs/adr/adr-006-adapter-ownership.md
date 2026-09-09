# ADR-006: Выбор harness и владение generated outputs

**Status:** Superseded in part by [ADR-008](adr-008-legacy-claude-adapter.md) (legacy-default); refined by [ADR-015](adr-015-adapter-write-preserves-foreign.md) (владение читается и при записи) and [ADR-016](adr-016-selected-adapter-roots-symlink.md) (охрана symlink на корнях — только у выбранных adapter'ов)
**Date:** 2026-09-03
**Deciders:** Velklish

## Context

Скиллы процесса безусловно лежали в `.claude/skills/backslop-*`, и репозиторий инструмента хранил их в git. Cursor и Codex видели только блок в `AGENTS.md`. Повторный `init` переписывал Claude-скиллы и создавал `CLAUDE.md`, даже когда проект этим harness не пользуется. Удалять весь каталог `.claude/` нельзя: там живут пользовательские файлы и worktrees субагентов.

## Варианты

- **Умолчание `tools: ["claude"]` и всегда писать `.claude/`.** Совместимо со старым ожиданием, но чужой harness получает ненужные файлы, а self-host репозитория остаётся привязан к Claude.
- **Поле `tools: []` по умолчанию, в том числе для старого конфига.** Legacy-часть этого варианта заменена [ADR-008](adr-008-legacy-claude-adapter.md). Adapters пишутся только по явному `--tools`. Снятие adapter удаляет только backslop-owned пути: маркер `<!-- backslop:generated -->` и известный legacy-набор. Пользовательские соседи и изменённый `CLAUDE.md` остаются.

## Decision

`tools` — список без повторов из `claude`, `cursor`, `codex`; умолчание — пустой список. Часть про legacy-конфиг заменена [ADR-008](adr-008-legacy-claude-adapter.md): там выбор для старого конфига выводится из улики на диске. `init --tools claude,cursor,codex` выбирает набор, `--tools none` очищает. Рендер:

- Claude: `.claude/skills/backslop-*` и точный stub `CLAUDE.md` (`@AGENTS.md`), если файла не было;
- Cursor: `.cursor/rules/backslop-*.mdc` с фронтматтером и namespaced `references/`;
- Codex: `.agents/skills/backslop-*`.

Владение — маркером в файле плюс фиксированный legacy-список путей. Generated outputs не входят в repository-wide перепись ссылок `mv`/`archive`; их ссылки проверяет отдельный гейт `lint`. Self-host репозитория держит `tools: []` и точечные ignore-паттерны: `templates/` — единственный источник в git.

## Consequences

- Старый проект без поля `tools` сохраняет Claude adapter при наличии прежнего canonical skill; без этой улики остаётся на `tools: []` ([ADR-008](adr-008-legacy-claude-adapter.md)).
- Пользовательский `CLAUDE.md` без `@AGENTS.md` сохраняется; `init` предупреждает, что Claude Code блок не увидит.
- Править generated skills и rules напрямую бесполезно — следующий `init` перепишет owned файлы.
