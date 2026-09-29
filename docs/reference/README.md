# Справочник

Как backslop устроен сейчас — по коду, а не по замыслу. Замысел и обоснование — в [ADR](../README.md); здесь только поведение работающей версии. Справочник разбит по подсистемам: каждый файл правится независимо. Поле «Область» задач ссылается сюда.

| Раздел | О чём |
|---|---|
| [01. Layout and formats](01-layout.md) | what `init` lays down and how adapters own their outputs, the `backslop.json` fields, the task and minor file formats, the archive and its journal, ADRs, templates as the source |
| [02. CLI и контракт для оркестратора](02-cli.md) | команды и флаги, коды возврата, состав `status --json`, npm-пин, что стабильно |
| [03. Гейты lint](03-lint.md) | четырнадцать гейтов плюс adapters и равенство шаблонов, что каждый ловит и чем чинится |
| [04. Проверка находок](04-verification.md) | локальный протокол проверки багов, мёртвого кода и удаления тестов с требованиями к уликам |
