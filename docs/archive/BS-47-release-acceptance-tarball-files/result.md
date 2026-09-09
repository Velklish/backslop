# BS-47 · Результат

**Закрыта 2026-09-09.** Выполнена. Acceptance-тест `packed tarball matches files, installs locally and its bin passes version, init and lint` (`test/release.test.mjs`) сверяет `files[].path` из уже вызываемого `npm pack --json` с контрактом: поле `files` равно перечню `bin`, `lib`, `templates`, `README.md`, `README.ru.md`, `LICENSE`, `CHANGELOG.md`; каждый отслеживаемый git файл под этими путями (`git ls-files`) упакован; сверх них — только `package.json`. Предположение карточки про отдельный `npm pack --dry-run --json` не понадобилось: перечень даёт тот же `npm pack --json`, что собирает tarball для установки. Обход диска отвергнут: `.DS_Store`, `._*`, `.gitignore` npm не пакует и внутри каталогов из `files`, и гейт краснел бы от артефакта ОС без следа в `git status`.

**Проверки.** Мутационные пробы после коммита: убрать `templates` из `files` в `package.json` — 1 из 1 красный («поле files package.json — контракт состава tarball»); положить `templates/en/.npmignore`, прячущий файл шаблона, — 1 из 1 красный («отслеживаемые файлы из files, которых нет в tarball»). На `main` перед приёмкой: `gates` — код 0, гейтов 2, зелёных 2; `npm test` — 226 из 226; `lint` — 0.

**Доки тем же ходом.** [02-cli](../../reference/02-cli.md) — абзац про релиз: что сверяет acceptance-тест; `CHANGELOG.md`; карточка заполнена (разделы были заглушками).

**Ревью.** Изолированное ревью (reviewer Claude на шине, два круга): три minor первого круга — обход диска ловит то, что npm не пакует; двойной `JSON.parse`; на Node 20.0.x `readdirSync({ recursive })` молча вырождается. Все сняты переходом на `git ls-files`. Круг 2 — без новых находок.
