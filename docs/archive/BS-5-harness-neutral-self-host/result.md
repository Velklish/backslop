# BS-5 · Результат

**Закрыта 2026-09-03.** Выполнена. Из git сняты `.claude/skills/backslop-*` и `CLAUDE.md`. В `.gitignore` — точечные паттерны owned outputs, не целые harness-каталоги. Собственный `backslop.json` держит `tools: []`. `repoMarkdown` исключает owned adapter files, поэтому `mv`/`archive` их не переписывают; `lint` проверяет выбранные outputs отдельно.

**Проверки.** `git ls-files` не возвращает generated Claude/Cursor/Codex outputs и `CLAUDE.md`. `init` при `tools: []` не создаёт их. Выбор одного adapter не материализует соседей. Улика: `test/init.test.mjs`, `test/mdwalk.test.mjs`, `test/commands.test.mjs` (relink).

**Доки тем же ходом.** ADR-006, `AGENTS.md` (шаблоны — источник), `docs/README.md` принцип 5, `docs/reference/01-layout.md`, CHANGELOG.
