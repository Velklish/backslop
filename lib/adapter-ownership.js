import { lstatSync, readFileSync } from 'node:fs';
import { TOOLS, adapterRootRel } from './adapters-registry.js';
import { FRONTMATTER } from './frontmatter.js';

export const GENERATED_MARKER = '<!-- backslop:generated -->';

// Маркер кладёт `markGenerated` в начало файла или сразу после YAML-фронтматтера.
// `includes` ловил бы цитату маркера в docs и выкидывал их из `repoMarkdown`.
const GENERATED_AT = new RegExp(`^(?:${FRONTMATTER.source})?${GENERATED_MARKER}(?:\\r?\\n|$)`);

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

export function isAdapterRel(rel) {
  return TOOLS.some((id) => rel.startsWith(`${adapterRootRel(id)}/`));
}

export function markGenerated(text) {
  const frontmatter = text.match(FRONTMATTER);
  if (!frontmatter) return `${GENERATED_MARKER}\n${text}`;
  return `${frontmatter[0]}${GENERATED_MARKER}\n${text.slice(frontmatter[0].length)}`;
}

// An editor's BOM before the marker keeps the file generated.
export function hasGeneratedMarker(file) {
  try {
    if (!lstatSync(file).isFile()) return false;
    return GENERATED_AT.test(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return false;
  }
}

export function isOwnedAdapterFile(rel, file) {
  return isAdapterRel(rel) && hasGeneratedMarker(file);
}
