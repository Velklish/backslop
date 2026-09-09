import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { blankFences } from './links.js';
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

function placeholders(text) {
  return [...new Set(
    [...text.matchAll(/\{\{([a-zA-Z_]+)\}\}/g)].map((m) => m[1]),
  )].sort();
}

const SKILL_RE = /^skills\/([^/]+)\/SKILL\.md$/;
const CYRILLIC = /[А-Яа-яЁё]/;

function frontmatterField(text, name) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  const line = m ? m[1].split(/\r?\n/).find((l) => l.startsWith(`${name}: `)) : undefined;
  return line === undefined ? '' : line.slice(name.length + 2).trim();
}

// Уровни заголовков по порядку. Блоки кода гасятся: `# ` в примере команды — не заголовок.
function headings(text) {
  return blankFences(text).split(/\r?\n/)
    .filter((line) => /^#{1,6} /.test(line))
    .map((line) => line.match(/^#+/)[0].length)
    .join(',');
}

// Контракт скилла: имя каталога и непустые name/description в обоих слоях. Cursor берёт
// description буквальной строкой из фронтматтера, и пустая строка проезжала в `.mdc` молча.
function skillFrontmatter(layer, rel, skill, text, errors) {
  const name = frontmatterField(text, 'name');
  if (!name) errors.push(`${layer}/${rel} frontmatter has no name`);
  else if (name !== skill) errors.push(`${layer}/${rel} frontmatter name is ${name}, expected ${skill}`);
  if (!frontmatterField(text, 'description')) errors.push(`${layer}/${rel} frontmatter has no description`);
}

// Сравнение механическое, без перевода текста: состав файлов, подстановки, контракт
// фронтматтера скиллов, число и уровень заголовков, кириллица в английском слое.
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
    const ruText = readFileSync(ruFile, 'utf8');
    const enText = readFileSync(enFile, 'utf8');
    const ruVars = placeholders(ruText);
    const enVars = placeholders(enText);
    if (ruVars.join('\0') !== enVars.join('\0')) {
      errors.push(`templates/en/${rel} placeholders differ: ${enVars.join(', ') || '(none)'} != ${ruVars.join(', ') || '(none)'}`);
    }
    const skill = rel.match(SKILL_RE)?.[1];
    if (skill) {
      skillFrontmatter('templates', rel, skill, ruText, errors);
      skillFrontmatter('templates/en', rel, skill, enText, errors);
    }
    const ruHeads = headings(ruText);
    const enHeads = headings(enText);
    if (ruHeads !== enHeads) {
      errors.push(`templates/en/${rel} headings differ: ${enHeads || '(none)'} != ${ruHeads || '(none)'}`);
    }
  }
  for (const [rel, enFile] of en) {
    if (CYRILLIC.test(readFileSync(enFile, 'utf8'))) errors.push(`templates/en/${rel} contains Cyrillic`);
  }
  return errors;
}
