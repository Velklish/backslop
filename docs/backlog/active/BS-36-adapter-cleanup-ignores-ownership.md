# BS-36 · `cleanupAdapters` удаляет файл по пути текущего шаблона в обход предиката `isOwnedAdapterFile` — чужой файл без маркера на этом пути стирается молча, а legacy-путь, выпавший из шаблонов, наоборот переживает снятие adapter'а

- **Область:** `lib/adapters.js`, `lib/adapter-ownership.js`, [reference/01](../../reference/01-layout.md)
- **Создана:** 2026-09-06
- **Зависимости:** нет
- **Взята:** 2026-09-09

## Контекст

`cleanupAdapters` (`lib/adapters.js:147-160`):
```
const owned = ownedAdapterFiles(root, cfg.lang);
for (const tool of Object.keys(adapterRoots)) {
  const selected = cfg.tools.includes(tool);
  const current = new Set(owned[tool].map((file) => path.resolve(file)));
  for (const file of markedFiles(root, tool, cfg.lang)) {
    if (selected && current.has(path.resolve(file))) continue;
    if (removeFile(root, file, cfg.lang)) pruneEmpty(root, file, tool, cfg.lang);
  }
  if (selected) continue;
  for (const file of owned[tool]) {
    if (removeFile(root, file, cfg.lang)) pruneEmpty(root, file, tool, cfg.lang);
  }
}
```
Первый цикл идёт по `markedFiles` — файлам с маркером `<!-- backslop:generated -->` (`hasGeneratedMarker`). Второй, строки 157-159, идёт по `owned[tool]` — путям, выведенным из **текущего** состава `templates/skills/**` (`ownedAdapterFiles`, `lib/adapters.js:71-78`) — и удаляет их `removeFile` без проверки владения. Предикат `isOwnedAdapterFile` (`lib/adapter-ownership.js:53`, `LEGACY_ADAPTER_RELS` на строке 26) в `lib/adapters.js` не импортируется: используется только в `lib/mdwalk.js:6,67`.

ADR-006 задаёт другое правило («Варианты», «Decision»): «Снятие adapter удаляет только backslop-owned пути: маркер `<!-- backslop:generated -->` и известный legacy-набор», «Владение — маркером в файле плюс фиксированный legacy-список путей». Комментарий `lib/init.js:115-116` обещает то же.

Две пробы на копии репозитория (v0.4.0, HEAD ef087a2), обе воспроизведены заново:
1. Проект с `tools: []` (adapter никогда не выбирался). В `templates/skills/backslop-task/references/` добавлен файл `extra.md`, которого не было при первом `init`. После него в проекте руками положены `.claude/skills/backslop-task/references/extra.md` (путь совпал с новым шаблоном, маркера нет) и `mine.md` (маркера нет, путь ни на что не похож). Повторный `backslop init --tools none` молча удаляет `extra.md` и оставляет `mine.md` — оба без маркера, разница только в совпадении пути с текущим шаблоном.
2. Обратная сторона: из `templates/skills/backslop-batch/references/measurements.md` (входит в `LEGACY_SOURCES`) шаблон удалён; такой же файл без маркера, положенный руками по прежнему пути, переживает `init --tools none` — хотя по ADR-006 он owned через legacy-набор и должен сниматься.

`npm test` на HEAD — 134 passed; ни один тест не покрывает чужой файл на owned-пути ни в одну, ни в другую сторону.

## Что сделать

- В `cleanupAdapters` (`lib/adapters.js:147-160`) свести оба цикла к одному предикату: кандидаты на удаление — объединение `ownedAdapterFiles(root, cfg.lang)` (текущие шаблоны) и путей из `LEGACY_ADAPTER_RELS` (`lib/adapter-ownership.js:26`) для каждого `tool`; каждого кандидата перед `removeFile` пропускать через `isOwnedAdapterFile(rel, file)` — не owned (нет маркера и не legacy-путь) не удалять, а называть в предупреждении `init`, как уже сделано для пользовательского `CLAUDE.md` (`ensureClaudeStub`).
- Тесты в `test/adapter-ownership.test.mjs` или `test/init.test.mjs`: (1) файл без маркера по пути текущего шаблона переживает `init --tools none`; (2) legacy-путь без маркера, выпавший из состава шаблонов, снимается тем же `init --tools none`.
- Обновить `docs/reference/01-layout.md` (раздел про adapters/owned output): формулировка «снятые чистятся только по owned-путям» должна описывать предикат `isOwnedAdapterFile`, а не текущий состав шаблонов.

## Не входит

- Расширение `LEGACY_ADAPTER_RELS` новыми путями — список фиксирован ADR-006, задача только сводит поведение `cleanupAdapters` к уже существующему предикату.
- Форма предупреждения о неowned-файле на owned-пути — берётся как есть из уже принятой для `CLAUDE.md` (`ensureClaudeStub`), не переизобретается.

## Проверки

- Обе красные пробы из «Что сделать» становятся зелёными; `npm test` — без регрессий (134 плюс два новых теста).
- Мутационная проба: убрать вызов `isOwnedAdapterFile` в правленном `cleanupAdapters` — оба новых теста краснеют.
