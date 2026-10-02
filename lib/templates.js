import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { frontmatterField } from './frontmatter.js';
import { blankFences } from './links.js';
import { srcFiles } from './mdwalk.js';
import { splitLines } from './text.js';
import { realpathOrNull } from './util.js';
import { msg } from './i18n.js';

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

// The keys the code puts into a template, by caller group: `init` and `adapters` — one set for
// the docs/skills layer, the other commands — their own per file. Gate 12 of `lint` checks them.
const TEMPLATE_KEYS = [
  [/^(?:docs\/|skills\/|agents-section\.md$)/, ['adrNumber', 'cli', 'date', 'docs', 'prefix', 'probeBreakage', 'probeRule', 'probeSecond', 'probeVerified', 'project']],
  [/^agents-probe\.md$/, ['probe']],
  [/^probe\/bullet\.md$/, ['probeRule']],
  [/^adr\.md$/, ['date', 'number', 'title']],
  [/^result\.md$/, ['cli', 'date', 'id', 'prefix', 'probeVerified']],
  [/^task\.md$/, ['area', 'context', 'date', 'id', 'title']],
  [/^minor\.md$/, ['area', 'context', 'cost', 'date', 'id', 'parent', 'title']],
  [/^brief\.md$/, ['autonomy', 'cli', 'entry', 'gates', 'handover', 'measurements', 'neighbours', 'prefix', 'probeBullet', 'probeResult', 'tasks', 'track']],
];

// A template is a file of templates/ with `{{name}}` substitutions. A name without a key is a
// refusal: left as is, it reaches the reader as a literal `{{…}}`, and only they see the hole.
export function renderTemplate(rel, vars) {
  const text = readFileSync(path.join(TEMPLATES_DIR, ...rel.split('/')), 'utf8').replace(/\r\n/g, '\n');
  return text.replace(/\{\{([a-zA-Z_]+)\}\}/g, (m, key) => {
    if (!(key in vars)) throw new Error(msg('ru', '{rel}: placeholder {m} is given no key {key}', { rel, m, key }));
    return String(vars[key]);
  });
}

export function renderProjectTemplate(cfg, rel, vars) {
  return renderTemplate(templateRel(cfg.lang, rel), vars);
}

function probeRule(cfg) {
  return cfg.probe ? ` ${renderProjectTemplate(cfg, 'agents-probe.md', { probe: cfg.probe.trim() }).trim()}` : '';
}

// Slot key, file under probe/, and the separator that joins the passage to the text before it.
const PROBE_PASSAGES = [
  ['probeBreakage', 'breakage.md', ' '],
  ['probeSecond', 'second.md', '\n\n   '],
  ['probeVerified', 'verified.md', ''],
  ['probeBullet', 'bullet.md', '\n'],
  ['probeResult', 'result.md', ' '],
];

// Every slot that renders probe text: no `probe` field, every slot is empty (ADR-041).
export function probeSlots(cfg) {
  const slots = { probeRule: probeRule(cfg) };
  for (const [key, file, lead] of PROBE_PASSAGES) {
    slots[key] = cfg.probe ? lead + renderProjectTemplate(cfg, `probe/${file}`, { probeRule: slots.probeRule }).trim() : '';
  }
  return slots;
}

function placeholders(text) {
  return [...new Set(
    [...text.matchAll(/\{\{([a-zA-Z_]+)\}\}/g)].map((m) => m[1]),
  )].sort();
}

const SKILL_RE = /^skills\/([^/]+)\/SKILL\.md$/;

// The ru layer: every template outside `en/` and `vendor/`, whose upstream text has no language.
function ruLayer(root) {
  return srcFiles(root, '', ['.md']).filter(([rel]) => !rel.startsWith('en/') && !rel.startsWith('vendor/'));
}
const CYRILLIC = /[\u0410-\u044F\u0401\u0451]/;

// Heading levels in order. Code blocks are blanked: `# ` in a command example is not a heading.
function headings(text) {
  return splitLines(blankFences(text))
    .filter((line) => /^#{1,6} /.test(line))
    .map((line) => line.match(/^#+/)[0].length)
    .join(',');
}

// The skill contract: the directory name and a non-empty name/description in both layers. Cursor
// takes the description as a literal frontmatter string, and an empty one slipped into `.mdc`.
function skillFrontmatter(layer, rel, skill, text, errors, lang) {
  const file = `${layer}/${rel}`;
  const name = frontmatterField(text, 'name');
  if (name === null) errors.push(msg(lang, '{file} frontmatter name is not a valid JSON string', { file }));
  else if (!name) errors.push(msg(lang, '{file} frontmatter has no name', { file }));
  else if (name !== skill) errors.push(msg(lang, '{file} frontmatter name is {name}, expected {skill}', { file, name, skill }));
  const description = frontmatterField(text, 'description');
  if (description === null) errors.push(msg(lang, '{file} frontmatter description is not a valid JSON string', { file }));
  else if (!description) errors.push(msg(lang, '{file} frontmatter has no description', { file }));
}

// en is the source layer; each ru twin is compared with it mechanically, without translation:
// file set, placeholders, skill frontmatter, heading levels in order; no Cyrillic in the en layer.
export function templateParity(root = TEMPLATES_DIR, lang = 'ru') {
  const enRoot = path.join(root, 'en');
  const ru = new Map(ruLayer(root));
  const en = new Map(srcFiles(enRoot, '', ['.md']));
  const errors = [];
  if (!existsSync(enRoot)) return [msg(lang, 'templates/en/ is missing')];
  for (const rel of en.keys()) if (!ru.has(rel)) errors.push(msg(lang, 'templates/{rel}: ru twin of templates/en/{rel} is missing', { rel }));
  for (const rel of ru.keys()) if (!en.has(rel)) errors.push(msg(lang, 'templates/{rel} has no en source templates/en/{rel}', { rel }));
  for (const [rel, enFile] of en) {
    const ruFile = ru.get(rel);
    if (!ruFile) continue;
    const ruText = readFileSync(ruFile, 'utf8');
    const enText = readFileSync(enFile, 'utf8');
    const ruVars = placeholders(ruText);
    const enVars = placeholders(enText);
    if (ruVars.join('\0') !== enVars.join('\0')) {
      const none = msg(lang, '(none)');
      errors.push(msg(lang, 'templates/{rel} placeholders differ from the en source templates/en/{rel}: expected {expected}, found {found}', { rel, expected: enVars.join(', ') || none, found: ruVars.join(', ') || none }));
    }
    const skill = rel.match(SKILL_RE)?.[1];
    if (skill) {
      skillFrontmatter('templates', rel, skill, ruText, errors, lang);
      skillFrontmatter('templates/en', rel, skill, enText, errors, lang);
    }
    const ruHeads = headings(ruText);
    const enHeads = headings(enText);
    if (ruHeads !== enHeads) {
      const none = msg(lang, '(none)');
      errors.push(msg(lang, 'templates/{rel} headings differ from the en source templates/en/{rel}: expected {expected}, found {found}', { rel, expected: enHeads || none, found: ruHeads || none }));
    }
  }
  for (const [rel, enFile] of en) {
    if (CYRILLIC.test(readFileSync(enFile, 'utf8'))) errors.push(msg(lang, 'templates/en/{rel} contains Cyrillic', { rel }));
  }
  return errors;
}

// The pair "placeholder ↔ key" both ways and in both language layers: a name without a key and a
// key without a place in the templates of its group (docs/reference/03-lint.md, gate 12).
export function templateSlots(root = TEMPLATES_DIR, lang = 'ru') {
  const errors = [];
  const used = TEMPLATE_KEYS.map(() => new Set());
  const files = [
    ...ruLayer(root),
    ...srcFiles(path.join(root, 'en'), '', ['.md']).map(([rel, abs]) => [rel, abs, 'en/']),
  ];
  for (const [rel, abs, layer = ''] of files) {
    const names = placeholders(readFileSync(abs, 'utf8'));
    if (!names.length) continue;
    const row = TEMPLATE_KEYS.findIndex(([re]) => re.test(rel));
    if (row < 0) {
      errors.push(msg(lang, 'templates/{layer}{rel} has placeholders but no TEMPLATE_KEYS row', { layer, rel }));
      continue;
    }
    for (const name of names) {
      if (TEMPLATE_KEYS[row][1].includes(name)) used[row].add(name);
      else errors.push(msg(lang, 'templates/{layer}{rel} placeholder {{{name}}} has no key in vars', { layer, rel, name }));
    }
  }
  TEMPLATE_KEYS.forEach(([, keys], i) => {
    for (const key of keys) {
      if (!used[i].has(key)) errors.push(msg(lang, 'TEMPLATE_KEYS: {key} is declared but no template uses it', { key }));
    }
  });
  return errors;
}
