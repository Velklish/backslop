import {
  existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmdirSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  GENERATED_MARKER, LEGACY_ADAPTER_RELS, adapterRel, cursorRel, hasGeneratedMarker, isOwnedAdapterFile, markGenerated,
} from './adapter-ownership.js';
import { ADAPTER_ROOTS, TOOLS, adapterRootRel } from './adapters-registry.js';
import { mapLinks } from './links.js';
import { srcFiles } from './mdwalk.js';
import { TEMPLATES_DIR, renderProjectTemplate, templateRel } from './templates.js';
import { CliError, toPosix } from './util.js';
import { tr } from './i18n.js';

export const CLAUDE_STUB = '@AGENTS.md\n';

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
      // ENOTDIR — файл на компоненте пути: ссылкой он не является, отказ на нём даёт `write`.
      if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') throw e;
    }
  }
  return target;
}

// Корни всех трёх harness — до первой записи `init`. Symlink на любом из них делает раскладку
// невозможной независимо от `tools`: корни обходит и `markedFiles` при снятии. Отказ после
// записи конфига оставил бы проект, который не чинится ни одним `--tools`.
export function checkAdapterRoots(root, lang) {
  for (const rel of Object.values(ADAPTER_ROOTS)) {
    try {
      ownedPath(root, path.join(root, ...rel), lang);
    } catch (e) {
      if (!(e instanceof CliError)) throw e;
      throw new CliError(tr(lang,
        `${e.message} — сквозь чужую ссылку backslop не пишет и не снимает файлы. Замени корень harness обычным каталогом; --tools none не поможет: корни проверяются независимо от выбранных adapters`,
        `${e.message} — backslop neither writes nor removes files through a foreign link. Replace the harness root with a plain directory; --tools none does not help: the roots are checked regardless of the selected adapters`));
    }
  }
}

function write(root, rel, text, lang) {
  const file = path.join(root, ...rel.split('/'));
  ownedPath(root, file, lang);
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  } catch (e) {
    // Файл на компоненте пути (`.claude/skills/backslop-task` обычным файлом) — отказ словами,
    // как каталог на месте самого output'а, а не стек из mkdirSync: EEXIST, когда файл — сам
    // dirname, ENOTDIR — когда он выше по пути.
    if (e.code !== 'ENOTDIR' && e.code !== 'EEXIST') throw e;
    throw new CliError(tr(lang, `на пути adapter output файл вместо каталога: ${rel}`, `a file sits where the adapter output path needs a directory: ${rel}`));
  }
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
  return Object.fromEntries(TOOLS.map((id) => [
    id, source.map((rel) => path.join(root, ...adapterRel(id, rel).split('/'))),
  ]));
}

// Cursor правит и текст: у правила свой фронтматтер с `description` из SKILL.md, а ссылки
// пересчитываются на namespaced раскладку `.cursor/rules/<skill>/…`.
function cursorOutput(rendered, sourceRel) {
  if (!sourceRel.endsWith('/SKILL.md')) return rewriteCursorLinks(rendered, sourceRel);
  const { description, body } = splitFrontmatter(rendered);
  const ruleBody = body.replace(/^\r?\n/, '');
  return `---\ndescription: ${JSON.stringify(description)}\nalwaysApply: false\n---\n\n${rewriteCursorLinks(ruleBody, sourceRel)}`;
}

// Запись читает владение тем же предикатом, что снятие (ADR-015): чужой файл без маркера на
// owned-пути остаётся и называется предупреждением, а не переписывается молча. Возвращает
// счёт записанных файлов по adapter'ам и текст предупреждения (null, когда чужих файлов нет).
export function renderAdapters(root, cfg, vars) {
  const files = sourceFiles(cfg.lang);
  const counts = Object.fromEntries(TOOLS.map((id) => [id, 0]));
  const foreign = [];
  for (const tool of cfg.tools) {
    for (const [rel] of files) {
      const outRel = adapterRel(tool, rel);
      const file = path.join(root, ...outRel.split('/'));
      // Symlink и выход за корень — отказ до чтения владения, как у снятия: сквозь чужую
      // ссылку backslop не читает и не пишет.
      ownedPath(root, file, cfg.lang);
      const stat = lstatOrNull(file);
      // Каталог на owned-пути — отказ словами, как у снятия (`removeFile`): писать в него
      // нечем, а legacy-путь owned и без маркера — до предиката владения дело не дошло бы.
      if (stat && !stat.isFile()) {
        throw new CliError(tr(cfg.lang, `owned adapter output не является файлом: ${outRel}`, `owned adapter output is not a file: ${outRel}`));
      }
      if (stat && !isOwnedAdapterFile(outRel, file)) {
        foreign.push(outRel);
        continue;
      }
      const rendered = renderProjectTemplate(cfg, `skills/${rel}`, vars);
      const text = tool === 'cursor' ? cursorOutput(rendered, rel) : rendered;
      write(root, outRel, markGenerated(text), cfg.lang);
      counts[tool] += 1;
    }
  }
  const warning = foreign.length ? tr(cfg.lang,
    `на путях adapter outputs лежат файлы без маркера ${GENERATED_MARKER} — не переписаны: ${foreign.join(', ')}; скилл backslop на этом пути не установлен — убери или переименуй файл и повтори init, либо сними adapter`,
    `files without the ${GENERATED_MARKER} marker sit at adapter output paths and were not overwritten: ${foreign.join(', ')}; the backslop skill is not installed there — remove or rename the file and rerun init, or deselect the adapter`) : null;
  return { counts, warning };
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
  const stop = path.join(root, ADAPTER_ROOTS[tool][0]);
  for (let dir = path.dirname(start); dir.startsWith(`${stop}${path.sep}`) || dir === stop; dir = path.dirname(dir)) {
    ownedPath(root, dir, lang);
    if (!existsSync(dir)) continue;
    if (readdirSync(dir).length) break;
    rmdirSync(dir);
  }
}

// Маркер решает сам по себе: путь под корнем не сужается до `backslop-*`. Предикат
// `isOwnedAdapterFile` признаёт owned любой маркированный файл под корнем harness, и снятие
// обязано читать то же правило — иначе файл, который `mv`, `archive` и `lint` уже не видят,
// не снимал бы никто.
function markedFiles(root, tool, lang) {
  const adapterRoot = path.join(root, ...ADAPTER_ROOTS[tool]);
  ownedPath(root, adapterRoot, lang);
  if (!existsSync(adapterRoot)) return [];
  return localFiles(adapterRoot)
    .filter(([, file]) => hasGeneratedMarker(file))
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

// ENOTDIR — файл на компоненте пути: записи под ним нет, отказ на нём даёт `write`.
function lstatOrNull(file) {
  try { return lstatSync(file); } catch (e) { if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return null; throw e; }
}

function isFileAt(file) {
  try { return statSync(file).isFile(); } catch { return false; }
}

function lexists(file) {
  return lstatOrNull(file) !== null;
}

// Кандидаты на снятие для одного adapter'а: файл с маркером под его корнем, путь текущего
// шаблона и путь из legacy-набора. Совпадение с шаблоном кандидата только называет —
// удаляет `isOwnedAdapterFile`: состав шаблонов меняется, а владение задано ADR-006.
function cleanupCandidates(root, tool, lang, ownedFiles) {
  const prefix = `${adapterRootRel(tool)}/`;
  const out = new Map();
  const add = (file) => out.set(toPosix(path.relative(root, file)), file);
  for (const file of markedFiles(root, tool, lang)) add(file);
  for (const file of ownedFiles) add(file);
  for (const rel of LEGACY_ADAPTER_RELS) {
    if (rel.startsWith(prefix)) add(path.join(root, ...rel.split('/')));
  }
  return out;
}

export function cleanupAdapters(root, cfg) {
  const owned = ownedAdapterFiles(root, cfg.lang);
  const foreign = [];
  for (const tool of TOOLS) {
    const selected = cfg.tools.includes(tool);
    const current = new Set(owned[tool].map((file) => path.resolve(file)));
    for (const [rel, file] of cleanupCandidates(root, tool, cfg.lang, owned[tool])) {
      if (selected && current.has(path.resolve(file))) continue;
      if (!lexists(file)) continue;
      // Symlink и выход за корень — отказ до предиката: владение читается из файла, а сквозь
      // чужую ссылку backslop не читает и не пишет.
      ownedPath(root, file, cfg.lang);
      if (!isOwnedAdapterFile(rel, file)) {
        foreign.push(rel);
        continue;
      }
      if (removeFile(root, file, cfg.lang)) pruneEmpty(root, file, tool, cfg.lang);
    }
  }
  const claudeFile = path.join(root, 'CLAUDE.md');
  if (!cfg.tools.includes('claude') && existsSync(claudeFile) && !lstatSync(claudeFile).isSymbolicLink()
      && lstatSync(claudeFile).isFile() && readFileSync(claudeFile, 'utf8') === CLAUDE_STUB) {
    ownedPath(root, claudeFile, cfg.lang);
    unlinkSync(claudeFile);
  }
  if (!foreign.length) return null;
  return tr(cfg.lang,
    `на путях adapter outputs лежат файлы без маркера ${GENERATED_MARKER} — оставлены как есть: ${foreign.join(', ')}`,
    `files without the ${GENERATED_MARKER} marker sit at adapter output paths and were left as is: ${foreign.join(', ')}`);
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
  // Только файлы: каталог на owned-пути `lint` называет отдельно, а читать его как файл нельзя.
  return cfg.tools.flatMap((tool) => owned[tool]
    .filter(isFileAt)
    .map((file) => [toPosix(path.relative(root, file)), file]));
}
