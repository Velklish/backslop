# Справочник

Как backslop устроен сейчас — по коду, а не по замыслу. Замысел и обоснование — в [ADR](../README.md); здесь только поведение работающей версии. Справочник разбит по подсистемам: каждый файл правится независимо. Поле «Область» задач ссылается сюда.

| Раздел | О чём |
|---|---|
| [01. Layout and formats](01-layout.md) | what `init` lays down and how adapters own their outputs, the `backslop.json` fields, the task and minor file formats, the archive and its journal, ADRs, templates as the source |
| [02. CLI](02-cli.md) | every command with its flags, behaviour, output and refusals, the `status --json` shape, and what is stable for an orchestrator |
| [03. Lint gates](03-lint.md) | the fourteen gates, the checks outside them (adapter outputs, template parity, live pins), warnings, and what each catches and how to fix it |
| [04. Проверка находок](04-verification.md) | локальный протокол проверки багов, мёртвого кода и удаления тестов с требованиями к уликам |
