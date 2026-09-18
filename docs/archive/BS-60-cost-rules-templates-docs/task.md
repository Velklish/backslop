# BS-60 · Цена находки решает её судьбу: правила, шаблоны, доки

- **Порядок:** 40
- **Область:** [01. Раскладка](../../reference/01-layout.md) — шаблоны как источник; `templates/docs/backlog/README.md`, `templates/skills/backslop-task/SKILL.md`, `templates/skills/backslop-batch/SKILL.md`, `templates/brief.md`, `templates/agents-section.md` и их близнецы в `templates/en/`
- **Создана:** 2026-09-18
- **Зависимости:** [BS-61](../BS-61-minor-status/task.md), [BS-62](../BS-62-archive-into/task.md)

## Контекст

Замер 2026-09-18 по трекерам двух потребителей (скрипты по `docs/archive` и `docs/backlog`, коммиты b366ccf9 и d2b37357): в ati-agents 378 из 794 карточек — находки (47 %), в promptobus 121 из 339 (36 %); закрытие одной задачи давало до девяти дочерних; отклонено 27 из 765 закрытых (3,5 %). Причина в сумме правил backslop: любое наблюдение обязано стать карточкой без порога цены, разбор triage не умеет отказывать, карточка одинаково дорога для любой находки. Решение — [ADR-022](../../adr/adr-022-cost-decides-finding-fate.md); механика — BS-61 и BS-62. Здесь — тексты, по которым работают агенты.

## Что сделать

- `templates/docs/backlog/README.md` (+ en): строка `minor/` в таблице каталогов; правило маршрутизации по цене в «Как вести» (метка обязательна; critical чинится сейчас, major в своей области чинится сейчас, major вне области — карточка, minor и гипотеза — `minor/`); резка `minor/` на пачки по области перед заходом, порог десяти записей, заказ владельца, закрытие `archive N.k --into M` в «Такт разбора triage».
- `templates/docs/archive/README.md` (+ en): подкаталог `minor/` у каталога пачки, без `result.md`.
- `templates/agents-section.md` (+ en), шаг 1: маршрутизация находки по цене.
- `templates/brief.md` (+ en): та же маршрутизация вместо «Находки — файлом»; critical в чужих файлах — сообщение оркестратору сразу.
- `templates/skills/backslop-task/SKILL.md` и `backslop-batch/SKILL.md` (+ en): находки в результате worker'а, пачки в «До резки».
- Зеркала в репозитории: `docs/backlog/README.md`, `docs/archive/README.md`; блок `AGENTS.md` перегенерировать `init`; `docs/GLOSSARY.md` — термины «цена находки», «пачка», статус `minor`; `README.md`, `README.ru.md`, `CHANGELOG.md`.

## Не входит

- Тексты потребителей (promptobus, ati-agents): их пины и правила — отдельной задачей после релиза.
- Переразбор уже открытых карточек по новому правилу.

## Проверки

- Гейты parity и слотов шаблонов зелёные; `test/brief.test.mjs` обновлён под новый текст брифа и зелёный.
- `diff` зеркал `docs/backlog/README.md` и `docs/archive/README.md` с отрендеренными шаблонами показывает только подстановки `{{cli}}` и `{{project}}`.
- `node bin/backslop.js gates` зелёный.
