import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const TEMPLATES_DIR = fileURLToPath(new URL('../templates/', import.meta.url));

// Шаблон — файл из templates/ с подстановками `{{имя}}`. Неизвестная подстановка остаётся
// как есть: так дырка видна в результате, а не молча превращается в пустоту.
export function renderTemplate(rel, vars = {}) {
  const text = readFileSync(path.join(TEMPLATES_DIR, ...rel.split('/')), 'utf8');
  return text.replace(/\{\{([a-zA-Z_]+)\}\}/g, (m, key) => (key in vars ? String(vars[key]) : m));
}
