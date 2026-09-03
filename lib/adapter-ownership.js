import { lstatSync, readFileSync } from 'node:fs';

export const GENERATED_MARKER = '<!-- backslop:generated -->';

const LEGACY_SOURCES = [
  'backslop-task/SKILL.md',
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
  return rest.join('/') === 'SKILL.md'
    ? `.cursor/rules/${skill}.mdc`
    : `.cursor/rules/${skill}/${rest.join('/')}`;
}

export const LEGACY_ADAPTER_RELS = new Set([
  ...LEGACY_SOURCES.map((rel) => `.claude/skills/${rel}`),
  ...LEGACY_SOURCES.map((rel) => `.agents/skills/${rel}`),
  ...LEGACY_SOURCES.map(cursorRel),
]);

export function isAdapterRel(rel) {
  return rel.startsWith('.claude/skills/')
    || rel.startsWith('.cursor/rules/')
    || rel.startsWith('.agents/skills/');
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
