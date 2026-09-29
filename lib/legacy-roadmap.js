// docs/ROADMAP.md and its two docs/README.md lines as v0.9.0–v0.11.x rendered them: the
// migration that drops the file deletes or edits only what still equals these, pins aside.
export const LEGACY_ROADMAP = {
  ru: [
    '# Roadmap',
    '',
    'Куда движется {{project}}: цели и их обоснование. Документ живой: цель — направление, а не обязательство; приоритет и состав определяются сигналом от пользователей, а не этим списком. Конкретные задачи со статусами — `{{cli}} status` и каталоги [backlog/](backlog/README.md).',
    '',
    '## Цели',
    '',
    '[TODO: 3–7 целей. У каждой — что, зачем, от чего зависит, и ссылка на ADR или задачу, где цель прослеживается.]',
    '',
    '## Принцип приоритизации',
    '',
    '[TODO: чем решается порядок — болью из реальной работы, запросом владельца, дедлайном. Гипотеза уступает требованию, пришедшему из живой задачи.]',
    '',
  ].join('\n'),
  en: [
    '# Roadmap',
    '',
    'Where {{project}} is going: goals and their rationale. This is a living document: a goal is direction, not a commitment; user signals determine priority and scope, not this list. Concrete tasks with statuses are in `{{cli}} status` and [backlog/](backlog/README.md).',
    '',
    '## Goals',
    '',
    '[TODO: 3–7 goals. For each: what, why, dependencies, and a link to an ADR or task that traces the goal.]',
    '',
    '## Prioritisation principle',
    '',
    '[TODO: what determines ordering — pain from real work, an owner request, a deadline. A hypothesis yields to a requirement from a live task.]',
    '',
  ].join('\n'),
};

// Line 3 as it was, the same line as v0.12.0 lays it, and the old table row of line 9.
export const LEGACY_README_LINES = {
  ru: {
    intro: 'Канон документации проекта. Что делаем сейчас — `{{cli}} status`; куда движется проект — [ROADMAP.md](ROADMAP.md); почему устроено так, а не иначе — ADR в таблице ниже.',
    introNow: 'Канон документации проекта. Что делаем сейчас — `{{cli}} status`; почему устроено так, а не иначе — ADR в таблице ниже.',
    row: '| [ROADMAP.md](ROADMAP.md) | Направление и цели; задачи — в бэклоге | Живой |',
  },
  en: {
    intro: 'The canonical project documentation. For current work, use `{{cli}} status`; for project direction, see [ROADMAP.md](ROADMAP.md); for why the system is arranged this way, see the ADRs in the table below.',
    introNow: 'The canonical project documentation. For current work, use `{{cli}} status`; for why the system is arranged this way, see the ADRs in the table below.',
    row: '| [ROADMAP.md](ROADMAP.md) | Direction and goals; tasks are in the backlog | Living |',
  },
};
