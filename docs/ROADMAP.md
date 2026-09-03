# Roadmap

Куда движется backslop: цели и их обоснование. Документ живой: цель — направление, а не обязательство. Конкретные задачи со статусами — `node bin/backslop.js status` и каталоги [backlog/](backlog/README.md).

## Цели

1. **Английский слой.** Шаблоны docs, скиллы и README на английском по флагу `init --lang en`. Задача — [BS-1](archive/BS-1-english-layer/task.md).
2. **Публикация в npm.** Подготовка пина и релизного скрипта — [BS-2](archive/BS-2-npm-publish/task.md); фактическая публикация и смена default CLI — [BS-2.1](backlog/deferred/BS-2.1-npm-publish.md).
3. **Рендер для выбранных harness.** Скиллы процесса в `.claude/skills/`, `.cursor/rules/` и `.agents/skills/` из тех же шаблонов по полю `tools`. Задача — [BS-3](archive/BS-3-cursor-rules-render/task.md).
4. **Обновление без сюрпризов.** Пин версии в `backslop.json`, команда `upgrade`, штамп версии для миграций формата. Задача — [BS-4](archive/BS-4-upgrade-and-pin/task.md).
5. **Harness-neutral self-host.** `templates/` — единственный источник в git; generated adapter outputs не коммитятся. Задача — [BS-5](archive/BS-5-harness-neutral-self-host/task.md).
6. **Стык с оркестраторами.** `status --json` и команды статусов — стабильный контракт; варианты транспорта worker'ов подключаются страницей к слоту в `backslop-batch`, а не правкой CLI. Цель держится справочником [reference/02-cli.md](reference/02-cli.md) и меняется только новым ADR.

## Принцип приоритизации

Порядок задаёт боль из живого применения: правило, которое пришлось объяснять руками, поднимается выше гипотезы о будущем удобстве. Владелец разворачивает порядок очереди, когда ему нужно иначе.
