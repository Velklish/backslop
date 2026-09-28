# Документация backslop

Канон документации проекта. Что делаем сейчас — `node bin/backslop.js status`; куда движется проект — [ROADMAP.md](ROADMAP.md); почему устроено так, а не иначе — ADR в таблице ниже. Пользовательская часть — в [README.md](../README.md) репозитория: там установка, команды и процесс; здесь устройство.

| Документ | Тема | Статус |
|---|---|---|
| [reference/](reference/README.md) | Справочник по подсистемам: раскладка и форматы файлов, CLI и контракт для оркестратора, гейты lint, протокол проверки находок | Живой |
| [GLOSSARY.md](GLOSSARY.md) | Нормативный словарь терминов: одно понятие — одно имя | Живой |
| [ROADMAP.md](ROADMAP.md) | Направление и цели; задачи — в бэклоге | Живой |
| [backlog/](backlog/README.md) | Трекер задач: файл на задачу, статус — каталог, сводка — `node bin/backslop.js status` | Живой |
| [archive/](archive/README.md) | Закрытые задачи: постановка и результат раздельными файлами | Живой |
| [adr/adr-001-process.md](adr/adr-001-process.md) | Задачи и решения ведутся по backslop | Accepted |
| [adr/adr-002-status-is-directory.md](adr/adr-002-status-is-directory.md) | Статус задачи — каталог, приоритет — поле «Порядок»; индекса в git нет | Accepted |
| [adr/adr-005-localization.md](adr/adr-005-localization.md) | Язык раскладки: поле `lang` и второй комплект шаблонов | Accepted |
| [adr/adr-009-gates-runner.md](adr/adr-009-gates-runner.md) | Раннер гейтов командой `backslop gates` | Accepted |
| [adr/adr-011-seed-scan-queue-reference.md](adr/adr-011-seed-scan-queue-reference.md) | Механика посева — команда `seed`, отбор кандидатов — агент и владелец | Accepted |
| [adr/adr-014-tracks-observation-command.md](adr/adr-014-tracks-observation-command.md) | Команда `tracks` наблюдает за заходом, но не убирает | Accepted |
| [adr/adr-020-agents-step-overrides.md](adr/adr-020-agents-step-overrides.md) | Переопределение шагов блока AGENTS.md из конфига | Accepted |
| [adr/adr-023-gates-scope-when.md](adr/adr-023-gates-scope-when.md) | Запись `gates` несёт область `when`, пропуск считается отдельно от зелёных | Accepted |
| [adr/adr-027-previous-order-restores-place.md](adr/adr-027-previous-order-restores-place.md) | Ранг очереди переживает уход из неё полем «Прежний порядок» | Superseded in part by ADR-031 (порядок пакета при `--restore` — гарантия контракта) |
| [adr/adr-028-two-line-comment-rule-and-its-gate.md](adr/adr-028-two-line-comment-rule-and-its-gate.md) | Правило двух строк для комментариев и гейт на него — тест в наборе со снимком долга | Superseded in part by ADR-035 (носитель долга в пробе обхода — фикстура вне обхода), ADR-038 (гейт судит и ширину строки блока — не шире 100 знаков) |
| [adr/adr-031-restore-batch-keeps-order.md](adr/adr-031-restore-batch-keeps-order.md) | Пакет `--restore` возвращает задачи в порядке их сохранённых чисел: каждая следующая встаёт не позже соседа по пакету | Accepted |
| [adr/adr-035-comment-debt-swept-to-zero-probe-debtor-is-fixture.md](adr/adr-035-comment-debt-swept-to-zero-probe-debtor-is-fixture.md) | Долг комментариев сведён в ноль: носитель долга в пробе гейта — фикстура вне обхода | Accepted |
| [adr/adr-038-comment-line-width-under-gate.md](adr/adr-038-comment-line-width-under-gate.md) | Гейт комментариев судит и ширину строки: не шире 100 знаков, знак — кодпоинт | Accepted |
| [adr/adr-039-node-runtime-delivery-release.md](adr/adr-039-node-runtime-delivery-release.md) | Zero-dependency Node runtime, npx delivery and release | Accepted |
| [adr/adr-040-harness-adapters.md](adr/adr-040-harness-adapters.md) | Harness adapters: selection, ownership and path safety of generated outputs | Accepted |
| [adr/adr-041-probe-command.md](adr/adr-041-probe-command.md) | The mutation-probe command is a project field substituted into the block, the task skill and the brief | Accepted |
| [adr/adr-042-worker-brief.md](adr/adr-042-worker-brief.md) | The worker brief is rendered by a command from a template | Accepted |
| [adr/adr-043-changelog-merge.md](adr/adr-043-changelog-merge.md) | merge-changelog merges the unreleased section structurally and refuses rather than guess | Accepted |
| [adr/adr-044-closed-task-journal.md](adr/adr-044-closed-task-journal.md) | Closed tasks fold into a journal line; the body stays in git | Accepted |
| [adr/adr-047-findings.md](adr/adr-047-findings.md) | Findings: numbering under a parent, cost label, the minor/ status and batch closing | Accepted |
| [adr/adr-048-version-pin-upgrade-migrate.md](adr/adr-048-version-pin-upgrade-migrate.md) | Version pin, upgrade and migrate | Accepted |

## Сквозные принципы

1. **Незадокументированное изменение считается незавершённым.** Справочник, README и CHANGELOG правятся тем же ходом, что и код.
2. **Принятое решение не правится — заменяется.** Новое решение по тому же вопросу — новый ADR; в заменяемом остаётся пометка «заменён ADR-NNN».
3. **Термины — только из глоссария.** Нужного имени нет — предложи владельцу, молча не выдумывай.
4. **Улика сильнее ощущения.** Число, путь к файлу или вывод команды — в постановке, результате и ADR; непроверенное пишется как предположение.
5. **Шаблоны — источник, adapter outputs — локальный generated результат.** Правило процесса меняется в `templates/`; `init` материализует выбранные adapters. Править `.claude/skills/backslop-*`, `.cursor/rules/backslop-*` или `.agents/skills/backslop-*` напрямую бесполезно — следующий `init` перепишет owned файлы.

Новый ADR — `node bin/backslop.js adr <slug>` **и строка в таблицу выше**: без строки `lint` красный.
