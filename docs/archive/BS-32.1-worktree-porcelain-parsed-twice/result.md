# BS-32.1 · Результат

**Закрыта 2026-09-09.** Выполнена. `worktrees(root)` — в `lib/util.js` рядом с `git` и `gitOrFail`: путь, ветка (`null` у detached) и `HEAD` на каждый worktree; `foreignTaskIds` (`lib/tasks.js`) и `tracks` (`lib/tracks.js`) зовут его, локальная копия в `tracks.js` удалена. Поведение обоих потребителей не менялось.

**Проверки.** Мутационная проба после коммита: сломать разбор строки `worktree` в общем помощнике — 4 из 46 красных в `test/tracks.test.mjs`, `test/commands.test.mjs`, `test/tasks.test.mjs` (тесты `tracks` и тест `new` по чужому worktree). Гейты — как у BS-19.1.

**Доки тем же ходом.** [02-cli](../../reference/02-cli.md) — строка `tracks`: разбор один, им же `new` считает чужие номера; заодно сняты пустые строки, рвавшие таблицу команд между `gates`, `tracks`, `upgrade` и `migrate`; `CHANGELOG.md`.

**Ревью.** Общее с BS-19.1: по задаче находок нет; наблюдение про разорванную таблицу `02-cli` закрыто в этом же ходе.
