import {
  existsSync, lstatSync, readFileSync, readdirSync, realpathSync, rmdirSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  GENERATED_MARKER, adapterRel, cursorRel, isOwnedAdapterFile, markGenerated,
} from './adapter-ownership.js';
import { ADAPTER_ROOTS, TOOLS, adapterRootRel } from './adapters-registry.js';
import { FRONTMATTER, frontmatterField } from './frontmatter.js';
import { mapLinks, rebaseTarget } from './links.js';
import { srcFiles, symlinkComponent } from './mdwalk.js';
import { splitLines } from './text.js';
import { TEMPLATES_DIR, renderProjectTemplate, templateRel } from './templates.js';
import { CliError, isFileAt, statOrNull, toPosix, writeText } from './util.js';
import { expectDirectory } from './config.js';
import { msg } from './i18n.js';

export const CLAUDE_STUB = '@AGENTS.md\n';

const VENDOR_DIR = path.join(TEMPLATES_DIR, 'vendor');

// Source files as [output rel, absolute path, vendored]. A vendored skill is laid out under its
// frontmatter `name`, in every language, with its LICENSE; its text is upstream's, never rendered.
function sourceFiles(lang) {
  const root = path.join(TEMPLATES_DIR, ...templateRel(lang, 'skills').split('/'));
  const files = srcFiles(root, '', ['.md']).map(([rel, abs]) => [rel, abs, false]);
  for (const e of readdirSync(VENDOR_DIR, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const dir = path.join(VENDOR_DIR, e.name);
    const name = frontmatterField(readFileSync(path.join(dir, 'SKILL.md'), 'utf8'), 'name');
    for (const [rel, abs] of srcFiles(dir, name, ['.md'])) files.push([rel, abs, true]);
    files.push([`${name}/LICENSE`, path.join(dir, 'LICENSE'), true]);
  }
  return files;
}

function ownedPath(root, file, lang) {
  const base = path.resolve(root);
  const target = path.resolve(file);
  if (target === base || !target.startsWith(`${base}${path.sep}`)) {
    throw new CliError(msg(lang, 'adapter path escapes the project root: {file}', { file }));
  }
  const link = symlinkComponent(base, target);
  if (link !== null) throw new CliError(msg(lang, 'adapter path contains a symlink: {link}', { link }));
  return target;
}

// The roots of the selected adapters are checked before the first write of `init`: a symlink there
// is a refusal wherever it leads; the roots of unselected ones are not checked (ADR-040).
export function checkAdapterRoots(root, tools, lang) {
  for (const tool of tools) {
    const adapterRoot = path.join(root, ...ADAPTER_ROOTS[tool]);
    try {
      ownedPath(root, adapterRoot, lang);
    } catch (e) {
      if (!(e instanceof CliError)) throw e;
      throw new CliError(msg(lang,
        '{message} — backslop neither writes nor removes files through a foreign link. Replace the harness root with a plain directory or deselect the {tool} adapter: --tools without it, or --tools none if no other adapters are selected', { message: e.message, tool }));
    }
    expectDirectory(root, adapterRoot, lang);
  }
}

// A foreign link, a directory on the path or a file under it is refused in words, before the
// ownership is read; render and the pre-write check share it.
function ownedOutput(root, outRel, lang) {
  const file = path.join(root, ...outRel.split('/'));
  ownedPath(root, file, lang);
  const parts = outRel.split('/').slice(0, -1);
  for (let i = 1; i <= parts.length; i += 1) {
    const dir = statOrNull(path.join(root, ...parts.slice(0, i)));
    if (dir && !dir.isDirectory()) throw new CliError(msg(lang, 'a file sits where the adapter output path needs a directory: {rel}', { rel: outRel }));
  }
  const stat = lstatOrNull(file);
  if (stat && !stat.isFile()) throw new CliError(msg(lang, 'owned adapter output is not a file: {outRel}', { outRel }));
  return { file, stat };
}

// The refusals of the selected adapters' output paths and of CLAUDE.md, before the first write.
export function checkAdapterOutputs(root, tools, lang) {
  for (const tool of tools) {
    for (const [rel] of sourceFiles(lang)) ownedOutput(root, adapterRel(tool, rel), lang);
  }
  if (!tools.includes('claude')) return;
  const claudeFile = path.join(root, 'CLAUDE.md');
  if (statOrNull(claudeFile)?.isDirectory()) throw new CliError(msg(lang, '{name} is a directory, expected a file', { name: 'CLAUDE.md' }));
  if (!existsSync(claudeFile)) ownedPath(root, claudeFile, lang);
}

function write(root, rel, text, lang) {
  const file = path.join(root, ...rel.split('/'));
  ownedPath(root, file, lang);
  try {
    writeText(file, text, { keepBom: false });
  } catch (e) {
    // A file on a path component is refused in words, not with an mkdirSync stack: EEXIST when the
    // file is the dirname itself, ENOTDIR when it is higher on the path.
    if (e.code !== 'ENOTDIR' && e.code !== 'EEXIST') throw e;
    throw new CliError(msg(lang, 'a file sits where the adapter output path needs a directory: {rel}', { rel }));
  }
}

// Templates quote `description` as a JSON string and the quotes come off here: `cursorOutput`
// quotes it again with `JSON.stringify`, and without unquoting `.mdc` would get double escaping.
function splitFrontmatter(text, template, lang, vendored) {
  const m = text.match(FRONTMATTER);
  if (!m) return { description: '', body: text };
  const field = frontmatterField(text, 'description');
  const description = vendored && field !== null ? yamlDescription(m[1], field, template, lang) : field;
  if (description === null) {
    throw new CliError(msg(lang,
      'template {template}: the frontmatter description is not a valid JSON string', { template }));
  }
  return { description, body: text.slice(m[0].length) };
}

// A vendored skill writes `description` the YAML way: plain or quoted on one line, or a `|` block.
// The form is read from the raw line; any other form is refused: it would reach the rule mangled.
function yamlDescription(frontmatter, field, template, lang) {
  const lines = splitLines(frontmatter);
  const at = lines.findIndex((l) => l.startsWith('description: '));
  if (at < 0) return field;
  const raw = lines[at].slice('description: '.length).trim();
  const block = [];
  for (const line of lines.slice(at + 1)) {
    if (line && !/^\s/.test(line)) break;
    block.push(line);
  }
  const continued = block.some((l) => l.trim());
  if (raw === '|') {
    const indent = Math.min(...block.filter((l) => l.trim()).map((l) => l.match(/^\s*/)[0].length));
    return block.map((l) => l.slice(indent)).join('\n').trim();
  }
  if (!continued && raw.startsWith('"')) return field;
  if (!continued && raw.length > 1 && raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1).replaceAll("''", "'");
  if (!continued && !/^[|>']/.test(raw)) return raw;
  const continuedForm = msg(lang, 'a scalar continued on the next line');
  const form = /^[|>]/.test(raw) || !continued ? raw : continuedForm;
  throw new CliError(msg(lang,
    'template {template}: the frontmatter description is written as {form}; only a plain scalar, a one-line quoted string or a | block is read', { template, form }));
}

function rewriteCursorLinks(text, sourceRel) {
  const sourceDir = path.posix.dirname(sourceRel);
  const outputDir = path.posix.dirname(cursorRel(sourceRel));
  return mapLinks(text, (target) => rebaseTarget(target, sourceDir, outputDir, cursorRel));
}

export function ownedAdapterFiles(root, lang) {
  const source = sourceFiles(lang).map(([rel]) => rel);
  return Object.fromEntries(TOOLS.map((id) => [
    id, source.map((rel) => path.join(root, ...adapterRel(id, rel).split('/'))),
  ]));
}

// Cursor rewrites the text too: the rule has its own frontmatter with `description` from SKILL.md,
// and the links are recomputed for the namespaced layout `.cursor/rules/<skill>/…`.
function cursorOutput(rendered, sourceRel, source, lang, vendored) {
  if (!sourceRel.endsWith('/SKILL.md')) return rewriteCursorLinks(rendered, sourceRel);
  const template = `templates/${toPosix(path.relative(TEMPLATES_DIR, source))}`;
  const { description, body } = splitFrontmatter(rendered, template, lang, vendored);
  const ruleBody = body.replace(/^\r?\n/, '');
  return `---\ndescription: ${JSON.stringify(description)}\nalwaysApply: false\n---\n\n${rewriteCursorLinks(ruleBody, sourceRel)}`;
}

// A vendored skill with a foreign LICENSE or SOURCE.md is skipped whole: it never ships without
// its licence, and no marker could own a LICENSE written beside a foreign SOURCE.md.
function skippedSkillNames(files, tool, blocked) {
  return new Set(files
    .filter(([rel, , vendored]) => vendored && /\/(LICENSE|SOURCE\.md)$/.test(rel) && blocked.has(adapterRel(tool, rel)))
    .map(([rel]) => rel.split('/')[0]));
}

// The outputs of `tool` that `init` does not lay out: all files of a skipped vendored skill.
export function skippedVendoredOutputs(root, tool, lang) {
  const files = sourceFiles(lang);
  const blocked = new Set(files.map(([rel]) => adapterRel(tool, rel)).filter((outRel) => {
    const file = path.join(root, ...outRel.split('/'));
    return statOrNull(file)?.isFile() && !isOwnedAdapterFile(outRel, file);
  }));
  const skipped = skippedSkillNames(files, tool, blocked);
  return new Set(files
    .filter(([rel, , vendored]) => vendored && skipped.has(rel.split('/')[0]))
    .map(([rel]) => path.join(root, ...adapterRel(tool, rel).split('/'))));
}

// Ownership by the same predicate as on removal: a foreign file without the marker stays and is
// named by a warning (ADR-040). Returns the count written per adapter and the warning text.
export function renderAdapters(root, cfg, vars) {
  const files = sourceFiles(cfg.lang);
  const counts = Object.fromEntries(TOOLS.map((id) => [id, 0]));
  const foreign = [];
  const skippedSkills = [];
  for (const tool of cfg.tools) {
    // Ownership is read before the first write: a SOURCE.md written here would own the LICENSE.
    const blocked = new Set();
    for (const [rel] of files) {
      const outRel = adapterRel(tool, rel);
      const { file, stat } = ownedOutput(root, outRel, cfg.lang);
      if (stat && !isOwnedAdapterFile(outRel, file)) {
        foreign.push(outRel);
        blocked.add(outRel);
      }
    }
    const skipped = skippedSkillNames(files, tool, blocked);
    for (const name of skipped) skippedSkills.push(`${tool} ${name}`);
    for (const [rel, abs, vendored] of files) {
      const outRel = adapterRel(tool, rel);
      if (blocked.has(outRel) || (vendored && skipped.has(rel.split('/')[0]))) continue;
      // Upstream text is LF: a CRLF checkout of the tool is folded back, LICENSE included.
      const upstream = vendored ? readFileSync(abs, 'utf8').replace(/\r\n/g, '\n') : null;
      if (rel.endsWith('/LICENSE')) {
        write(root, outRel, upstream, cfg.lang);
        counts[tool] += 1;
        continue;
      }
      const rendered = upstream ?? renderProjectTemplate(cfg, `skills/${rel}`, vars);
      const text = tool === 'cursor' ? cursorOutput(rendered, rel, abs, cfg.lang, vendored) : rendered;
      write(root, outRel, markGenerated(text), cfg.lang);
      counts[tool] += 1;
    }
  }
  const warning = foreign.length ? msg(cfg.lang,
    'files without the {marker} marker sit at adapter output paths and were not overwritten: {foreign}; the backslop skill is not installed there — remove or rename the file and rerun init, or deselect the adapter', { marker: GENERATED_MARKER, foreign: foreign.join(', ') }) : null;
  const skippedNote = skippedSkills.length ? msg(cfg.lang,
    '; a vendored skill with a foreign LICENSE or SOURCE.md is not laid out at all, so it never ships without its licence: {skippedSkills}', { skippedSkills: skippedSkills.join(', ') }) : '';
  return { counts, warning: warning && warning + skippedNote };
}

function pruneEmpty(root, start, tool) {
  const stop = path.join(root, ADAPTER_ROOTS[tool][0]);
  for (let dir = path.dirname(start); dir.startsWith(`${stop}${path.sep}`) || dir === stop; dir = path.dirname(dir)) {
    if (readdirSync(dir).length) break;
    rmdirSync(dir);
  }
}

// The marker decides by itself, the path is not narrowed to `backslop-*`: removal reads the same
// rule as `isOwnedAdapterFile`, or a file `mv`, `archive` and `lint` do not see stays forever.
function markedFiles(root, tool, lang) {
  const adapterRoot = path.join(root, ...ADAPTER_ROOTS[tool]);
  ownedPath(root, adapterRoot, lang);
  if (!existsSync(adapterRoot)) return [];
  return localFiles(adapterRoot)
    .filter(([rel, file]) => isOwnedAdapterFile(`${adapterRootRel(tool)}/${rel}`, file))
    .map(([, file]) => file);
}

function localFiles(dir, rel = '', out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) localFiles(child, childRel, out);
    else if (entry.isFile() && /\.mdc?$|^LICENSE$/.test(entry.name)) out.push([childRel, child]);
  }
  return out;
}

// ENOTDIR — a file on a path component: no entry under it; `ownedOutput` refuses it.
function lstatOrNull(file) {
  try { return lstatSync(file); } catch (e) { if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return null; throw e; }
}

function isDirAt(file) {
  try { return statSync(file).isDirectory(); } catch { return false; }
}

function lexists(file) {
  return lstatOrNull(file) !== null;
}

// Removal candidates: a marked file and a current template path. A template match only names a
// candidate; `isOwnedAdapterFile` decides the removal (ADR-040).
function cleanupCandidates(root, tool, lang, ownedFiles) {
  const out = new Map();
  const add = (file) => out.set(toPosix(path.relative(root, file)), file);
  for (const file of markedFiles(root, tool, lang)) add(file);
  for (const file of ownedFiles) add(file);
  return out;
}

export function cleanupAdapters(root, cfg) {
  const owned = ownedAdapterFiles(root, cfg.lang);
  const foreign = [];
  for (const tool of TOOLS) {
    const selected = cfg.tools.includes(tool);
    // An unselected adapter behind a link is not removed (ADR-040): backslop neither reads nor
    // writes through a foreign link, and a refusal over a directory it never visits blocks init.
    const adapterRoot = path.resolve(path.join(root, ...ADAPTER_ROOTS[tool]));
    if (!selected && symlinkComponent(path.resolve(root), adapterRoot) !== null) continue;
    // Nor an unselected root that is not a directory, or a candidate behind a link or not a file.
    if (!selected && lexists(adapterRoot) && !isDirAt(adapterRoot)) continue;
    const current = new Set(owned[tool].map((file) => path.resolve(file)));
    // Ownership is read for every candidate before the first removal: SOURCE.md owns the LICENSE.
    const removed = [];
    for (const [rel, file] of cleanupCandidates(root, tool, cfg.lang, owned[tool])) {
      if (selected && current.has(path.resolve(file))) continue;
      if (!selected && symlinkComponent(path.resolve(root), path.resolve(file)) !== null) continue;
      if (!selected && lexists(file) && !lstatOrNull(file).isFile()) continue;
      if (!lexists(file)) continue;
      // A symlink and an exit beyond the root are a refusal before the predicate: ownership is read
      // from the file, and backslop neither reads nor writes through a foreign link.
      ownedPath(root, file, cfg.lang);
      if (!isOwnedAdapterFile(rel, file)) {
        foreign.push(rel);
        continue;
      }
      removed.push(file);
    }
    for (const file of removed) {
      unlinkSync(file);
      pruneEmpty(root, file, tool);
    }
  }
  const claudeFile = path.join(root, 'CLAUDE.md');
  if (!cfg.tools.includes('claude') && lstatOrNull(claudeFile)?.isFile() && readFileSync(claudeFile, 'utf8') === CLAUDE_STUB) {
    unlinkSync(claudeFile);
  }
  if (!foreign.length) return null;
  return msg(cfg.lang,
    'files without the {marker} marker sit at adapter output paths and were left as is: {foreign}', { marker: GENERATED_MARKER, foreign: foreign.join(', ') });
}

export function ensureClaudeStub(root, tools, lang) {
  if (!tools.includes('claude')) return { state: msg(lang, 'not selected'), warning: null };
  const file = path.join(root, 'CLAUDE.md');
  if (!existsSync(file)) {
    ownedPath(root, file, lang);
    writeFileSync(file, CLAUDE_STUB);
    return { state: msg(lang, 'created with @AGENTS.md'), warning: null };
  }
  try {
    if (realpathSync(file) === realpathSync(path.join(root, 'AGENTS.md'))) {
      return { state: msg(lang, 'symlink to AGENTS.md'), warning: null };
    }
  } catch {
    // Broken or unreadable custom file is reported by the ordinary read below.
  }
  const text = readFileSync(file, 'utf8');
  if (text.includes('@AGENTS.md')) {
    return { state: msg(lang, 'present'), warning: null };
  }
  return {
    state: msg(lang, 'custom file preserved'),
    warning: msg(lang,
      'CLAUDE.md has no “@AGENTS.md” import line — add it, the backslop block is in AGENTS.md'),
  };
}

export function generatedAdapterFiles(root, cfg) {
  const owned = ownedAdapterFiles(root, cfg.lang);
  // Files only: `lint` names a directory on an owned path separately; it cannot be read as a file.
  // LICENSE carries no marker and no links: only the marked Markdown is generated.
  return cfg.tools.flatMap((tool) => owned[tool]
    .filter((file) => isFileAt(file) && path.basename(file) !== 'LICENSE')
    .map((file) => [toPosix(path.relative(root, file)), file]));
}
