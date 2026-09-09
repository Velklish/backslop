# Документация backslop

Канон документации проекта. Что делаем сейчас — `node bin/backslop.js status`; куда движется проект — [ROADMAP.md](ROADMAP.md); почему устроено так, а не иначе — ADR в таблице ниже. Пользовательская часть — в [README.md](../README.md) репозитория: там установка, команды и процесс; здесь устройство.

| Документ | Тема | Статус |
|---|---|---|
| [reference/](reference/README.md) | Справочник по подсистемам: раскладка и форматы файлов, CLI и контракт для оркестратора, гейты lint | Живой |
| [GLOSSARY.md](GLOSSARY.md) | Нормативный словарь терминов: одно понятие — одно имя | Живой |
| [ROADMAP.md](ROADMAP.md) | Направление и цели; задачи — в бэклоге | Живой |
| [backlog/](backlog/README.md) | Трекер задач: файл на задачу, статус — каталог, сводка — `node bin/backslop.js status` | Живой |
| [archive/](archive/README.md) | Закрытые задачи: постановка и результат раздельными файлами | Живой |
| [adr/adr-001-process.md](adr/adr-001-process.md) | Задачи и решения ведутся по backslop | Accepted |
| [adr/adr-002-status-is-directory.md](adr/adr-002-status-is-directory.md) | Статус задачи — каталог, приоритет — поле «Порядок»; индекса в git нет | Accepted |
| [adr/adr-003-node-stdlib-npx.md](adr/adr-003-node-stdlib-npx.md) | Node без зависимостей, доставка `npx github:` | Accepted |
| [adr/adr-004-version-pin-upgrade.md](adr/adr-004-version-pin-upgrade.md) | Пин версии в проекте и обновление командой `upgrade` | Superseded in part by ADR-007 (источник релизов при npm-форме) |
| [adr/adr-005-localization.md](adr/adr-005-localization.md) | Язык раскладки: поле `lang` и второй комплект шаблонов | Accepted |
| [adr/adr-006-adapter-ownership.md](adr/adr-006-adapter-ownership.md) | Выбор harness и владение generated outputs | Superseded in part by ADR-008 (legacy-default) |
| [adr/adr-007-npm-pin.md](adr/adr-007-npm-pin.md) | Точный npm-пин и релизный чеклист без смены default CLI | Accepted |
| [adr/adr-008-legacy-claude-adapter.md](adr/adr-008-legacy-claude-adapter.md) | Сохранение Claude adapter в legacy-проектах | Accepted |
| [adr/adr-009-gates-runner.md](adr/adr-009-gates-runner.md) | Раннер гейтов командой `backslop gates` | Accepted |
| [adr/adr-017-owned-outputs-gitignore.md](adr/adr-017-owned-outputs-gitignore.md) | Owned outputs не коммитятся: блок `.gitignore` пишет `init` | Accepted |
| [adr/adr-018-changelog-merge.md](adr/adr-018-changelog-merge.md) | Слияние CHANGELOG командой, а не правилом в скилле | Accepted |
| [adr/adr-019-tracks-observation-command.md](adr/adr-019-tracks-observation-command.md) | Команда `tracks` наблюдает за заходом, но не убирает | Accepted |

## Сквозные принципы

1. **Незадокументированное изменение считается незавершённым.** Справочник, README и CHANGELOG правятся тем же ходом, что и код.
2. **Принятое решение не правится — заменяется.** Новое решение по тому же вопросу — новый ADR; в заменяемом остаётся пометка «заменён ADR-NNN».
3. **Термины — только из глоссария.** Нужного имени нет — предложи владельцу, молча не выдумывай.
4. **Улика сильнее ощущения.** Число, путь к файлу или вывод команды — в постановке, результате и ADR; непроверенное пишется как предположение.
5. **Шаблоны — источник, adapter outputs — локальный generated результат.** Правило процесса меняется в `templates/`; `init` материализует выбранные adapters. Править `.claude/skills/backslop-*`, `.cursor/rules/backslop-*` или `.agents/skills/backslop-*` напрямую бесполезно — следующий `init` перепишет owned файлы.

Новый ADR — `node bin/backslop.js adr <slug>` **и строка в таблицу выше**: без строки `lint` красный.
