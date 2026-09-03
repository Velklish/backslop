# ADR-008: Сохранение Claude adapter в legacy-проектах

**Status:** Accepted
**Date:** 2026-09-03
**Deciders:** Velklish

## Context

[ADR-006](adr-006-adapter-ownership.md) ввёл явное поле `tools` и выбрал `[]` не только для новых, но и для старых конфигов. До этого backslop всегда материализовал `.claude/skills/backslop-*`. Поэтому обычный повторный `init` или `upgrade` проекта без поля `tools` принимал отсутствие поля за отказ от Claude и молча удалял рабочие скиллы и stub `CLAUDE.md`.

Новый проект без adapter outputs действительно harness-neutral. Старый проект с материализованным `.claude/skills/backslop-task/SKILL.md` уже сделал наблюдаемый выбор Claude, хотя в его конфиге такого поля ещё не существовало.

## Варианты

- **Оставить legacy-default `tools: []`.** Формально единое умолчание, но обновление разрушает существующую интеграцию.
- **Всегда считать отсутствие `tools` выбором Claude.** Совместимо со старым поведением, но создаёт Claude-файлы в старом harness-neutral проекте, где их никогда не было.
- **Вывести legacy-выбор из owned output на диске.** При отсутствующем поле сохранить Claude только там, где лежит прежний canonical skill; явное поле всегда сильнее.

## Decision

Если в `backslop.json` нет поля `tools`, а `.claude/skills/backslop-task/SKILL.md` существует, конфиг читается как `tools: ["claude"]`. Следующий `init` сохраняет это поле и обновляет Claude outputs. Без этой улики legacy-конфиг получает `tools: []`. Явные `tools: []` или `--tools none` не переопределяются состоянием диска и снимают owned outputs как раньше.

Строка о скиллах в блоке `AGENTS.md` называет их условными: они доступны только через выбранный adapter.

## Consequences

- `init` и `upgrade` больше не удаляют прежнюю Claude-интеграцию только из-за отсутствующего поля.
- Harness-neutral legacy-проект не получает Claude adapter самопроизвольно.
- Наличие одного canonical legacy skill — одноразовая улика миграции; после `init` выбор закреплён в конфиге.
- ADR-006 заменён в части legacy-default; владение outputs, default `[]` для новых проектов и явный выбор adapter остаются без изменений.
