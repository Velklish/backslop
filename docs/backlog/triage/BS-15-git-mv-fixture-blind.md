# BS-15 · Тестовая оснастка backslop инертна к git: `run()` в `test/helpers.mjs` не проверяет код возврата, и ни один тест не отличает переезд через `git mv` от простого `renameSync` в `moveFile`

- **Область:** `test/helpers.mjs`, `test/archive.test.mjs`, `lib/tasks.js`, `lib/util.js`, [02-cli](../../reference/02-cli.md)
- **Создана:** 2026-09-06
- **Зависимости:** нет

## Контекст

`test/helpers.mjs:29-31` — `function run(root, args) { return spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' }); }`; оба вызова в `gitAll` (строки 34-35, `add -A` и `commit -qm`) результат отбрасывают — код возврата git нигде в оснастке не проверяется.

`lib/tasks.js:446-453` (`moveFile`) решает переезд по `git(root, ['ls-files', '--error-unmatch', '--', from])` (строка 448): `tracked.status === 0` → `gitOrFail(root, ['mv', '--', from, to])` (ветка `git`), иначе `renameSync(from, to)` (ветка `fs`). Комментарий строк 444-445 объявляет цель ветки `git`: «чтобы история файла не оборвалась». Сама проверка в проде корректна — `lib/util.js:32-41`, `gitOrFail` бросает `CliError` при `status !== 0`; дефект не в проде, а в тестовой оснастке и покрытии.

Живая мутационная проба (копия репозитория в scratchpad, HEAD ef087a2): базовый `node --test` — 134 pass, 0 fail. Замена `const tracked = git(root, [...])` на `const tracked = { status: 1 }` в `lib/tasks.js:448` (ветка `moveFile` принудительно всегда идёт `fs`, `git mv` не вызывается ни разу) — повторный `node --test` снова 134 pass, 0 fail. Ни один assert не покраснел на полностью отключённой ветке `git mv`.

`docs/reference/02-cli.md:13` и `:14` обещают `git mv` для `mv` и `archive`; `:23` — «Файл вне индекса git (или репозитория нет) `mv` и `archive` переносят обычным переименованием и предупреждают». Обе ветки — заявленное поведение справочника, но тесты их не различают.

## Что сделать

- `test/helpers.mjs`: `run()` бросает при `status !== 0` (текст из `stderr`) — сломанный git-конфиг или отсутствие git должны красить прогон, а не молча переводить его на ветку `fs`
- Assert в `test/archive.test.mjs` на различение веток: на проекте с git — после `mv`/`archive` файл переехал именно через `git mv` (`git status --porcelain` пуст сразу после `gitAll`, либо `git log --follow` по новому пути видит старое имя); на `makeProject({ git: false })` — в stderr есть предупреждение «файл не в индексе git — перенесён без git mv»
- Обе правки подтвердить мутационной пробой: испортить ветку `git mv`, как в разборе, — новый assert обязан покраснеть

## Не входит

- Логика `moveFile` и `gitOrFail` не трогается — она корректна, чинится только тестовая оснастка и её покрытие

## Проверки

- Мутация `lib/tasks.js:448` → `{ status: 1 }` (принудительный `fs`) после правки красит новый assert
- Полный `node --test` — прежние 134 плюс новые ассерты зелёные
