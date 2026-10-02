// The ADR files of a project: the name pattern, the scan and the number format.
// A shared module: `adr`, `init` and `lint` read it; a command module imports no command for it.
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { SLUG_SRC } from './ids.js';

export const ADR_FILE_RE = new RegExp(`^adr-(\\d{3,})-(${SLUG_SRC})\\.md$`);

export function scanAdrs(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  return readdirSync(dir)
    .map((name) => ({ name, m: name.match(ADR_FILE_RE) }))
    .filter(({ m }) => m)
    .map(({ name, m }) => ({ name, number: Number(m[1]), slug: m[2], file: path.join(dir, name) }))
    .sort((a, b) => a.number - b.number);
}

export function formatAdrNumber(n) {
  return String(n).padStart(3, '0');
}
