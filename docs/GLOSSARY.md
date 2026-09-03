# Глоссарий

Нормативный словарь терминов backslop. Тексты проекта используют только имена отсюда: одно понятие — одно имя. Встретилось второе написание — либо оно попадает в «Убранные слова» как замена, либо вычищается из текста.

Колонка «В тексте» задаёт написание в русских текстах; EN — имя в коде и англоязычных текстах. Латинские термины склоняются апострофом с русским окончанием: worker'ы, track'а. Улика — где термин живёт: путь к файлу или документу.

## Термины

| В тексте | EN | Определение | Улика |
|---|---|---|---|
| задача | task | Единица работы: файл `<префикс>-N-<slug>.md`, лежащий ровно в одном каталоге статуса | [lib/tasks.js](../lib/tasks.js) |
| находка | finding | Побочное открытие мимо текущей задачи; заводится файлом с номером `N.k` в `triage/` тем, кто нашёл | [lib/new.js](../lib/new.js), флаг `--parent` |
| статус | status | Каталог, в котором лежит файл задачи: `triage`, `queue`, `active`, `deferred`; закрытые — в `archive/` | [lib/config.js](../lib/config.js), `STATUSES` |
| порядок | rank | Поле «Порядок» в шапке задачи в `queue/`: целое, шаг 10, меньше — раньше | [lib/tasks.js](../lib/tasks.js), `placeInQueue` |
| triage | triage | Каталог неразобранного: идеи и находки до разбора; файл и есть запись | [templates/docs/backlog/README.md](../templates/docs/backlog/README.md) |
| архив | archive | Каталог закрытых задач: `<id>-<slug>/task.md` и `result.md` | [lib/archive.js](../lib/archive.js) |
| шапка | header | Список полей после заголовка задачи: Порядок, Область, Создана, Взята, Зависимости | [lib/tasks.js](../lib/tasks.js), `FIELD_*` |
| улика | evidence | Путь к файлу или вывод команды, подтверждающие утверждение; без улики утверждение — предположение | [templates/skills/backslop-seed/SKILL.md](../templates/skills/backslop-seed/SKILL.md) |
| гейт | gate | Команда из `gates` в `backslop.json`, которая должна быть зелёной до сдачи; `lint` — один из гейтов | [lib/config.js](../lib/config.js) |
| скелет | skeleton | Файлы, которые кладёт `init`: конфиг, docs, скиллы, блок в AGENTS.md | [lib/init.js](../lib/init.js) |
| посев | seed | Наполнение скелета содержанием проекта по скиллу `backslop-seed` | [templates/skills/backslop-seed/SKILL.md](../templates/skills/backslop-seed/SKILL.md) |
| заход | run | Пакет работы по бэклогу одной сессии: соло или worker'ами | [templates/skills/backslop-batch/SKILL.md](../templates/skills/backslop-batch/SKILL.md) |
| track | track | Направление внутри захода, не пересекающееся с соседними по файлам; один worker — один track | [templates/skills/backslop-batch/SKILL.md](../templates/skills/backslop-batch/SKILL.md) |
| бриф | brief | Самодостаточное задание worker'у: задачи, границы, критерий готовности, состав результата | [templates/skills/backslop-batch/SKILL.md](../templates/skills/backslop-batch/SKILL.md) |
| worker | worker | Роль, которая правит и проверяет: шаги 1–4 процедуры; статусы и архив не трогает | [templates/skills/backslop-task/SKILL.md](../templates/skills/backslop-task/SKILL.md) |
| approver | approver | Роль приёмки: ревью, архив, `result.md`, разбор triage — шаги 5–7 | [templates/skills/backslop-task/SKILL.md](../templates/skills/backslop-task/SKILL.md) |
| оркестратор | orchestrator | Сессия, ведущая заход worker'ами: режет очередь, пишет брифы, принимает; под оркестрацией — approver | [templates/skills/backslop-batch/SKILL.md](../templates/skills/backslop-batch/SKILL.md) |
| reviewer | reviewer | Изолированная read-only сессия со свежим контекстом: смотрит дифф и не чинит | [templates/skills/backslop-batch/SKILL.md](../templates/skills/backslop-batch/SKILL.md) |
| ADR | ADR | Запись архитектурного решения `adr-NNN-<slug>.md` со строкой в таблице `docs/README.md` | [lib/adr.js](../lib/adr.js) |
| harness | harness | Среда, в которой работает агент и которая даёт транспорт для worker'ов: субагенты, сессии, шина | [templates/skills/backslop-batch/SKILL.md](../templates/skills/backslop-batch/SKILL.md) |
| мутационная проба | mutation probe | Проверка теста порчей кода: тест обязан покраснеть; делается после коммита, чтобы откат мутации не снёс правку | [templates/skills/backslop-task/SKILL.md](../templates/skills/backslop-task/SKILL.md) |
| review round | review round | Итерация ревью: замечания → правки → проверка закрытия; пределы кругов — норма скилла захода | [templates/skills/backslop-batch/SKILL.md](../templates/skills/backslop-batch/SKILL.md) |
| владелец | owner | Человек, принимающий решения по проекту: порядок очереди, отказ от находки, выбор ADR | [templates/skills/backslop-seed/SKILL.md](../templates/skills/backslop-seed/SKILL.md) |
| слот | slot | Место в скилле, куда окружение подставляет свой вариант: транспорт worker'ов в `backslop-batch` | [docs/reference/02-cli.md](reference/02-cli.md) |

## Убранные слова

| Не пишем | Пишем | Почему |
|---|---|---|
| инбокс | triage | каталог называется `triage/`; одно имя для каталога и понятия |
| таск | задача | одно понятие — одно имя |
| индекс бэклога | `status` | списка задач в файлах нет — сводку печатает команда |
| тимлид | оркестратор, approver | роль названа по действию, а не по должности |
| линия | track | одно имя для направления внутри захода |
