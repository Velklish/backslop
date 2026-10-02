import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { TOOLS, adapterRootRel } from './adapters-registry.js';
import { FRONTMATTER } from './frontmatter.js';

export const GENERATED_MARKER = '<!-- backslop:generated -->';

// `markGenerated` puts the marker at the start of the file or right after the YAML frontmatter.
// `includes` would catch a quote of the marker in docs and drop them from `repoMarkdown`.
const GENERATED_AT = new RegExp(`^(?:${FRONTMATTER.source})?${GENERATED_MARKER}(?:\\r?\\n|$)`);

export function cursorRel(sourceRel) {
  const [skill, ...rest] = sourceRel.split('/');
  const root = adapterRootRel('cursor');
  return rest.join('/') === 'SKILL.md'
    ? `${root}/${skill}.mdc`
    : `${root}/${skill}/${rest.join('/')}`;
}

// The owned output path of one adapter by the path of the source skill. Cursor differs in form
// (`<skill>/SKILL.md` → `<skill>.mdc`); the others put the template set under their root.
export function adapterRel(id, sourceRel) {
  return id === 'cursor' ? cursorRel(sourceRel) : `${adapterRootRel(id)}/${sourceRel}`;
}

function isAdapterRel(rel) {
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

// A vendored LICENSE stays verbatim, without the marker: the marked SOURCE.md beside it owns it.
export function isOwnedAdapterFile(rel, file) {
  if (!isAdapterRel(rel)) return false;
  if (path.posix.basename(rel) !== 'LICENSE') return hasGeneratedMarker(file);
  return isRegularFile(file) && hasGeneratedMarker(path.join(path.dirname(file), 'SOURCE.md'));
}

function isRegularFile(file) {
  try { return lstatSync(file).isFile(); } catch { return false; }
}
