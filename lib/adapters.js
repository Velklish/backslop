import {
  existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmdirSync, unlinkSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { cursorRel, hasGeneratedMarker, markGenerated } from './adapter-ownership.js';
import { mapLinks } from './links.js';
import { srcFiles } from './mdwalk.js';
import { TEMPLATES_DIR, renderProjectTemplate, templateRel } from './templates.js';
import { CliError, toPosix } from './util.js';
import { tr } from './i18n.js';

export const CLAUDE_STUB = '@AGENTS.md\n';

const adapterRoots = {
  claude: ['.claude', 'skills'],
  cursor: ['.cursor', 'rules'],
  codex: ['.agents', 'skills'],
};

function sourceFiles(lang) {
  const root = path.join(TEMPLATES_DIR, ...templateRel(lang, 'skills').split('/'));
  return srcFiles(root, '', ['.md']);
}

function ownedPath(root, file, lang) {
  const base = path.resolve(root);
  const target = path.resolve(file);
  if (target === base || !target.startsWith(`${base}${path.sep}`)) {
    throw new CliError(tr(lang, `adapter path выходит за корень проекта: ${file}`, `adapter path escapes the project root: ${file}`));
  }
  let current = base;
  for (const part of path.relative(base, target).split(path.sep)) {
    current = path.join(current, part);
    try {
      if (lstatSync(current).isSymbolicLink()) {
        throw new CliError(tr(lang, `adapter path содержит symlink: ${toPosix(path.relative(base, current))}`, `adapter path contains a symlink: ${toPosix(path.relative(base, current))}`));
      }
    } catch (e) {
      if (e instanceof CliError) throw e;
      if (e.code !== 'ENOENT') throw e;
    }
  }
  return target;
}

function write(root, rel, text, lang) {
  const file = path.join(root, ...rel.split('/'));
  ownedPath(root, file, lang);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

function splitFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!m) return { description: '', body: text };
  const description = m[1].split(/\r?\n/).find((line) => line.startsWith('description: '))?.slice(13) ?? '';
  return { description, body: text.slice(m[0].length) };
}

function rewriteCursorLinks(text, sourceRel) {
  const sourceDir = path.posix.dirname(sourceRel);
  const outputDir = path.posix.dirname(cursorRel(sourceRel));
  return mapLinks(text, (target) => {
    const sourceTarget = path.posix.normalize(path.posix.join(sourceDir, target));
    const outputTarget = cursorRel(sourceTarget);
    const next = path.posix.relative(outputDir, outputTarget);
    return next === target ? null : next;
  });
}

export function ownedAdapterFiles(root, lang) {
  const source = sourceFiles(lang).map(([rel]) => rel);
  return {
    claude: source.map((rel) => path.join(root, '.claude', 'skills', ...rel.split('/'))),
    cursor: source.map((rel) => path.join(root, ...cursorRel(rel).split('/'))),
    codex: source.map((rel) => path.join(root, '.agents', 'skills', ...rel.split('/'))),
  };
}

export function renderAdapters(root, cfg, vars) {
  const files = sourceFiles(cfg.lang);
  const counts = { claude: 0, cursor: 0, codex: 0 };
  for (const tool of cfg.tools) {
    for (const [rel] of files) {
      const rendered = renderProjectTemplate(cfg, `skills/${rel}`, vars);
      if (tool === 'claude') write(root, `.claude/skills/${rel}`, markGenerated(rendered), cfg.lang);
      if (tool === 'codex') write(root, `.agents/skills/${rel}`, markGenerated(rendered), cfg.lang);
      if (tool === 'cursor') {
        const target = cursorRel(rel);
        if (rel.endsWith('/SKILL.md')) {
          const { description, body } = splitFrontmatter(rendered);
          const ruleBody = body.replace(/^\r?\n/, '');
          const rule = `---\ndescription: ${JSON.stringify(description)}\nalwaysApply: false\n---\n\n${rewriteCursorLinks(ruleBody, rel)}`;
          write(root, target, markGenerated(rule), cfg.lang);
        } else {
          write(root, target, markGenerated(rewriteCursorLinks(rendered, rel)), cfg.lang);
        }
      }
      counts[tool] += 1;
    }
  }
  return counts;
}

function removeFile(root, file, lang) {
  let stat;
  try { stat = lstatSync(file); } catch (e) { if (e.code === 'ENOENT') return false; throw e; }
  ownedPath(root, file, lang);
  if (!stat.isFile()) {
    throw new CliError(tr(lang, `owned adapter output не является файлом: ${toPosix(path.relative(root, file))}`, `owned adapter output is not a file: ${toPosix(path.relative(root, file))}`));
  }
  unlinkSync(file);
  return true;
}

function pruneEmpty(root, start, tool, lang) {
  const stop = path.join(root, adapterRoots[tool][0]);
  for (let dir = path.dirname(start); dir.startsWith(`${stop}${path.sep}`) || dir === stop; dir = path.dirname(dir)) {
    ownedPath(root, dir, lang);
    if (!existsSync(dir)) continue;
    if (readdirSync(dir).length) break;
    rmdirSync(dir);
  }
}

function markedFiles(root, tool, lang) {
  const adapterRoot = path.join(root, ...adapterRoots[tool]);
  ownedPath(root, adapterRoot, lang);
  if (!existsSync(adapterRoot)) return [];
  const files = localFiles(adapterRoot);
  return files
    .filter(([rel, file]) => rel.split('/')[0].startsWith('backslop-') && hasGeneratedMarker(file))
    .map(([, file]) => file);
}

function localFiles(dir, rel = '', out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) localFiles(child, childRel, out);
    else if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.mdc'))) out.push([childRel, child]);
  }
  return out;
}

export function cleanupAdapters(root, cfg) {
  const owned = ownedAdapterFiles(root, cfg.lang);
  for (const tool of Object.keys(adapterRoots)) {
    const selected = cfg.tools.includes(tool);
    const current = new Set(owned[tool].map((file) => path.resolve(file)));
    for (const file of markedFiles(root, tool, cfg.lang)) {
      if (selected && current.has(path.resolve(file))) continue;
      if (removeFile(root, file, cfg.lang)) pruneEmpty(root, file, tool, cfg.lang);
    }
    if (selected) continue;
    for (const file of owned[tool]) {
      if (removeFile(root, file, cfg.lang)) pruneEmpty(root, file, tool, cfg.lang);
    }
  }
  const claudeFile = path.join(root, 'CLAUDE.md');
  if (!cfg.tools.includes('claude') && existsSync(claudeFile) && !lstatSync(claudeFile).isSymbolicLink()
      && lstatSync(claudeFile).isFile() && readFileSync(claudeFile, 'utf8') === CLAUDE_STUB) {
    ownedPath(root, claudeFile, cfg.lang);
    unlinkSync(claudeFile);
  }
}

export function ensureClaudeStub(root, tools, lang = 'ru') {
  if (!tools.includes('claude')) return { state: tr(lang, 'не выбран', 'not selected'), warning: null };
  const file = path.join(root, 'CLAUDE.md');
  if (!existsSync(file)) {
    ownedPath(root, file, lang);
    writeFileSync(file, CLAUDE_STUB);
    return { state: tr(lang, 'создан с @AGENTS.md', 'created with @AGENTS.md'), warning: null };
  }
  try {
    if (realpathSync(file) === realpathSync(path.join(root, 'AGENTS.md'))) {
      return { state: tr(lang, 'симлинк на AGENTS.md', 'symlink to AGENTS.md'), warning: null };
    }
  } catch {
    // Broken or unreadable custom file is reported by the ordinary read below.
  }
  const text = readFileSync(file, 'utf8');
  if (text === CLAUDE_STUB || text.includes('@AGENTS.md')) {
    return { state: tr(lang, 'есть', 'present'), warning: null };
  }
  return {
    state: tr(lang, 'пользовательский файл сохранён', 'custom file preserved'),
    warning: tr(lang,
      'CLAUDE.md не импортирует AGENTS.md — добавь строку «@AGENTS.md», иначе Claude Code блок не увидит',
      'CLAUDE.md does not import AGENTS.md — add “@AGENTS.md” or Claude Code will not see the backslop block'),
  };
}

export function generatedAdapterFiles(root, cfg) {
  const owned = ownedAdapterFiles(root, cfg.lang);
  return cfg.tools.flatMap((tool) => owned[tool]
    .filter(existsSync)
    .map((file) => [toPosix(path.relative(root, file)), file]));
}
