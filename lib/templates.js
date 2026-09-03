import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { srcFiles } from './mdwalk.js';

export const TEMPLATES_DIR = fileURLToPath(new URL('../templates/', import.meta.url));

export function templateRel(lang, rel) {
  return lang === 'en' ? `en/${rel}` : rel;
}

// Шаблон — файл из templates/ с подстановками `{{имя}}`. Неизвестная подстановка остаётся
// как есть: так дырка видна в результате, а не молча превращается в пустоту.
export function renderTemplate(rel, vars = {}) {
  const text = readFileSync(path.join(TEMPLATES_DIR, ...rel.split('/')), 'utf8');
  return text.replace(/\{\{([a-zA-Z_]+)\}\}/g, (m, key) => (key in vars ? String(vars[key]) : m));
}

export function renderProjectTemplate(cfg, rel, vars = {}) {
  return renderTemplate(templateRel(cfg.lang, rel), vars);
}

function placeholders(file) {
  return [...new Set(
    [...readFileSync(file, 'utf8').matchAll(/\{\{([a-zA-Z_]+)\}\}/g)].map((m) => m[1]),
  )].sort();
}

export function templateParity(root = TEMPLATES_DIR) {
  const enRoot = path.join(root, 'en');
  const ru = new Map(srcFiles(root, '', ['.md']).filter(([rel]) => !rel.startsWith('en/')));
  const en = new Map(srcFiles(enRoot, '', ['.md']));
  const errors = [];
  if (!existsSync(enRoot)) return ['templates/en/ is missing'];
  for (const rel of ru.keys()) if (!en.has(rel)) errors.push(`templates/en/${rel} is missing`);
  for (const rel of en.keys()) if (!ru.has(rel)) errors.push(`templates/en/${rel} has no source counterpart`);
  for (const [rel, ruFile] of ru) {
    const enFile = en.get(rel);
    if (!enFile) continue;
    const ruVars = placeholders(ruFile);
    const enVars = placeholders(enFile);
    if (ruVars.join('\0') !== enVars.join('\0')) {
      errors.push(`templates/en/${rel} placeholders differ: ${enVars.join(', ') || '(none)'} != ${ruVars.join(', ') || '(none)'}`);
    }
  }
  return errors;
}
