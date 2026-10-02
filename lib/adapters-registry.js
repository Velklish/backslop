// The single source of the adapter set: the id and the directory root in a project, no other
// copies. The module imports nothing: config, adapter-ownership, adapters, init and mdwalk read it.

const ADAPTERS = [
  { id: 'claude', root: ['.claude', 'skills'] },
  { id: 'cursor', root: ['.cursor', 'rules'] },
  { id: 'codex', root: ['.agents', 'skills'] },
];

export const TOOLS = ADAPTERS.map(({ id }) => id);

export const ADAPTER_ROOTS = Object.fromEntries(ADAPTERS.map(({ id, root }) => [id, root]));

// The adapter root path from the project root in posix form: `.claude/skills`.
export function adapterRootRel(id) {
  return ADAPTER_ROOTS[id].join('/');
}

// A tools list: every id known, none repeated; `[]` is valid and selects no adapter.
export function validTools(list) {
  return list.every((tool) => TOOLS.includes(tool)) && new Set(list).size === list.length;
}
