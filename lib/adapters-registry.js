// Единый источник состава adapters: id и корень каталога в проекте. Тройка путей была
// записана независимо в шести местах — TOOLS, adapterRoots, ownedAdapterFiles, counts,
// LEGACY_ADAPTER_RELS, isAdapterRel — и рассинхрон одной копии молча отключал бы чистку
// generated-файлов или гейт парности шаблонов (BS-42). Модуль ничего не импортирует:
// его читают и config, и adapter-ownership, и adapters.

export const ADAPTERS = [
  { id: 'claude', root: ['.claude', 'skills'] },
  { id: 'cursor', root: ['.cursor', 'rules'] },
  { id: 'codex', root: ['.agents', 'skills'] },
];

export const TOOLS = ADAPTERS.map(({ id }) => id);

export const ADAPTER_ROOTS = Object.fromEntries(ADAPTERS.map(({ id, root }) => [id, root]));

// Путь корня adapter'а от корня проекта в posix-форме: `.claude/skills`.
export function adapterRootRel(id) {
  return ADAPTER_ROOTS[id].join('/');
}

// Скилл, по которому узнают прежнюю раскладку: улика legacy-конфига (ADR-008) и первый
// источник legacy-набора owned-путей.
export const CANONICAL_SKILL = 'backslop-task/SKILL.md';
