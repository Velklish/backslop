import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { frontmatterField } from './frontmatter.js';
import { blankFences } from './links.js';
import { srcFiles } from './mdwalk.js';
import { splitLines } from './text.js';
import { realpathOrNull } from './util.js';

export const TEMPLATES_DIR = fileURLToPath(new URL('../templates/', import.meta.url));

// The tool's own repository: its `templates/` is the running tool's directory, compared by realpath
// so a symlink does not switch the self-host gates off; false when either side does not resolve.
export function isToolRepo(root) {
  const own = realpathOrNull(path.join(root, 'templates'));
  return own !== null && own === realpathOrNull(TEMPLATES_DIR);
}

export function templateRel(lang, rel) {
  return lang === 'en' ? `en/${rel}` : rel;
}

// Ключи, которые код кладёт в шаблон, по группам вызывающих: `init` и `adapters` — одним набором
// на слой docs/skills, остальные команды — своим на файл. Сверяет их гейт 12 `lint`.
const TEMPLATE_KEYS = [
  [/^(?:docs\/|skills\/|agents-section\.md$)/, ['adrNumber', 'cli', 'date', 'docs', 'prefix', 'probeRule', 'project']],
  [/^agents-probe\.md$/, ['probe']],
  [/^adr\.md$/, ['date', 'number', 'title']],
  [/^result\.md$/, ['date', 'id', 'prefix']],
  [/^task\.md$/, ['area', 'context', 'date', 'id', 'title']],
  [/^minor\.md$/, ['area', 'context', 'cost', 'date', 'id', 'parent', 'title']],
  [/^brief\.md$/, ['autonomy', 'cli', 'entry', 'gates', 'handover', 'measurements', 'neighbours', 'prefix', 'probeRule', 'tasks', 'track']],
];

// Шаблон — файл из templates/ с подстановками `{{имя}}`. Имя без ключа — отказ: оставленное
// как есть, оно уходит читателю буквальным `{{…}}`, и дырку видит только он.
export function renderTemplate(rel, vars) {
  const text = readFileSync(path.join(TEMPLATES_DIR, ...rel.split('/')), 'utf8').replace(/\r\n/g, '\n');
  return text.replace(/\{\{([a-zA-Z_]+)\}\}/g, (m, key) => {
    if (!(key in vars)) throw new Error(`${rel}: подстановке ${m} не передан ключ ${key}`);
    return String(vars[key]);
  });
}

export function renderProjectTemplate(cfg, rel, vars) {
  return renderTemplate(templateRel(cfg.lang, rel), vars);
}

// The probe step of the AGENTS.md block and of the brief: no `probe` field, no step (ADR-021).
export function probeRule(cfg) {
  return cfg.probe ? ` ${renderProjectTemplate(cfg, 'agents-probe.md', { probe: cfg.probe.trim() }).trim()}` : '';
}

function placeholders(text) {
  return [...new Set(
    [...text.matchAll(/\{\{([a-zA-Z_]+)\}\}/g)].map((m) => m[1]),
  )].sort();
}

const SKILL_RE = /^skills\/([^/]+)\/SKILL\.md$/;
const CYRILLIC = /[А-Яа-яЁё]/;

// Уровни заголовков по порядку. Блоки кода гасятся: `# ` в примере команды — не заголовок.
function headings(text) {
  return splitLines(blankFences(text))
    .filter((line) => /^#{1,6} /.test(line))
    .map((line) => line.match(/^#+/)[0].length)
    .join(',');
}

// Контракт скилла: имя каталога и непустые name/description в обоих слоях. Cursor берёт
// description буквальной строкой из фронтматтера, и пустая строка проезжала в `.mdc` молча.
function skillFrontmatter(layer, rel, skill, text, errors) {
  const name = frontmatterField(text, 'name');
  if (name === null) errors.push(`${layer}/${rel} frontmatter name is not a valid JSON string`);
  else if (!name) errors.push(`${layer}/${rel} frontmatter has no name`);
  else if (name !== skill) errors.push(`${layer}/${rel} frontmatter name is ${name}, expected ${skill}`);
  const description = frontmatterField(text, 'description');
  if (description === null) errors.push(`${layer}/${rel} frontmatter description is not a valid JSON string`);
  else if (!description) errors.push(`${layer}/${rel} frontmatter has no description`);
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

// Пара «плейсхолдер ↔ ключ» в обе стороны и по обоим языковым слоям: имя без ключа и ключ без
// места в шаблонах своей группы (docs/reference/03-lint.md, гейт 12).
export function templateSlots(root = TEMPLATES_DIR) {
  const errors = [];
  const used = TEMPLATE_KEYS.map(() => new Set());
  const files = [
    ...srcFiles(root, '', ['.md']).filter(([rel]) => !rel.startsWith('en/')),
    ...srcFiles(path.join(root, 'en'), '', ['.md']).map(([rel, abs]) => [rel, abs, 'en/']),
  ];
  for (const [rel, abs, layer = ''] of files) {
    const names = placeholders(readFileSync(abs, 'utf8'));
    if (!names.length) continue;
    const row = TEMPLATE_KEYS.findIndex(([re]) => re.test(rel));
    if (row < 0) {
      errors.push(`templates/${layer}${rel} has placeholders but no TEMPLATE_KEYS row`);
      continue;
    }
    for (const name of names) {
      if (TEMPLATE_KEYS[row][1].includes(name)) used[row].add(name);
      else errors.push(`templates/${layer}${rel} placeholder {{${name}}} has no key in vars`);
    }
  }
  TEMPLATE_KEYS.forEach(([, keys], i) => {
    for (const key of keys) {
      if (!used[i].has(key)) errors.push(`TEMPLATE_KEYS: ${key} is declared but no template uses it`);
    }
  });
  return errors;
}
