import { splitLines } from './text.js';

// YAML frontmatter at the head of a file: skills carry it, and a cursor rule gets its own.
export const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;

// One `name: value` line; a JSON-quoted value is unquoted. Missing is '', malformed is null.
export function frontmatterField(text, name) {
  const m = text.match(FRONTMATTER);
  const line = m ? splitLines(m[1]).find((l) => l.startsWith(`${name}: `)) : undefined;
  if (line === undefined) return '';
  const value = line.slice(name.length + 2).trim();
  if (!value.startsWith('"')) return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
