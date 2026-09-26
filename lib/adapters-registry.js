// Единый источник состава adapters: id и корень каталога в проекте, других копий нет. Модуль
// ничего не импортирует: его читают config, adapter-ownership, adapters, init и mdwalk.

const ADAPTERS = [
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
