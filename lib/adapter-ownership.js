import { lstatSync, readFileSync } from 'node:fs';
import { CANONICAL_SKILL, TOOLS, adapterRootRel } from './adapters-registry.js';

export const GENERATED_MARKER = '<!-- backslop:generated -->';

const LEGACY_SOURCES = [
  CANONICAL_SKILL,
  'backslop-batch/SKILL.md',
  'backslop-batch/references/measurements.md',
  'backslop-seed/SKILL.md',
  'backslop-seed/references/adr-backfill.md',
  'backslop-seed/references/glossary.md',
  'backslop-seed/references/inventory.md',
];

// Маркер кладёт `markGenerated` в начало файла или сразу после YAML-фронтматтера.
// `includes` ловил бы цитату маркера в docs и выкидывал их из `repoMarkdown`.
const GENERATED_AT = /^(?:---\r?\n[\s\S]*?\r?\n---\r?\n)?<!-- backslop:generated -->\r?\n/;

export function cursorRel(sourceRel) {
  const [skill, ...rest] = sourceRel.split('/');
  const root = adapterRootRel('cursor');
  return rest.join('/') === 'SKILL.md'
    ? `${root}/${skill}.mdc`
    : `${root}/${skill}/${rest.join('/')}`;
}

// Путь owned output одного adapter'а по пути исходного скилла. Cursor отличается формой
// (`<skill>/SKILL.md` → `<skill>.mdc`), остальные кладут состав шаблонов под свой корень.
export function adapterRel(id, sourceRel) {
  return id === 'cursor' ? cursorRel(sourceRel) : `${adapterRootRel(id)}/${sourceRel}`;
}

export const LEGACY_ADAPTER_RELS = new Set(
  TOOLS.flatMap((id) => LEGACY_SOURCES.map((rel) => adapterRel(id, rel))),
);

export function isAdapterRel(rel) {
  return TOOLS.some((id) => rel.startsWith(`${adapterRootRel(id)}/`));
}

export function markGenerated(text) {
  const frontmatter = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  if (!frontmatter) return `${GENERATED_MARKER}\n${text}`;
  return `${frontmatter[0]}${GENERATED_MARKER}\n${text.slice(frontmatter[0].length)}`;
}

export function hasGeneratedMarker(file) {
  try {
    if (!lstatSync(file).isFile()) return false;
    return GENERATED_AT.test(readFileSync(file, 'utf8'));
  } catch {
    return false;
  }
}

export function isOwnedAdapterFile(rel, file) {
  return LEGACY_ADAPTER_RELS.has(rel) || (isAdapterRel(rel) && hasGeneratedMarker(file));
}
