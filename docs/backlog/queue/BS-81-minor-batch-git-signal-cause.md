# BS-81 · Пачка minor: отказ git, оборванного сигналом, называет причину в gates, upgrade, merge-changelog и lint

- **Порядок:** 180
- **Область:** [02. Команды](../../reference/02-cli.md)
- **Создана:** 2026-09-24
- **Зависимости:** нет

## Контекст

Пачка области 02 по правилу [docs/backlog/README.md](../README.md) для одной записи: BS-78.1 (пачка BS-79) перевела `show`, `fold`, `archive` и `gitOrFail` на `gitCause` из `lib/util.js`, а четыре сайта остались на старой форме причины и при обрыве git сигналом без `error` печатают «null» / «код null» / «git null». Владелец 2026-09-24 велел закрыть запись сразу, не дожидаясь следующей пачки области.

## Что сделать

- [BS-78.2](../minor/BS-78.2-git-signal-kill-still-says-code-null.md) — четыре сайта строят причину отказа через `gitCause(r, lang)`: `basePaths` в `lib/gates.js` (`git diff --name-only` к базе), `git ls-remote --tags` в `lib/upgrade.js`, `readRevision` и `taggedVersions` в `lib/merge-changelog.js`, проверка достижимости ревизий журнала в `lib/lint.js` (гейт 13; там берётся первая строка stderr — сохранить). Обрыв сигналом без `error` называется «оборван сигналом SIGKILL» / «killed by SIGKILL», остальные ветви (stderr, `error.message`, код возврата) читаются как прежде. Закрытие — `archive 78.2 --into 81` после `archive 81` и до `fold 81`.

## Не входит

- Сайты, уже переведённые BS-78.1: `show`, `fold`, `archive`, `gitOrFail`.
- Отказы не-git процессов (команды гейтов в `runGate`) — своя причина, вне записи.

## Проверки

- На каждый из четырёх сайтов — вердикт с `status: null, signal: 'SIGKILL', stderr: ''` (подмена результата `git`, как в вердикте BS-78.1 в `test/fold.test.mjs`), красный до правки: текст называет сигнал, а не «null».
- Мутационная проба на один из сайтов — записью.
- `node bin/backslop.js gates` → «гейтов 2, зелёных 2».
