// Ссылки markdown: разбор для гейта и перепись при переезде файла — один набор форм на обоих:
// инлайновая (голая цель, с заголовком, в угловых скобках) и объявление `[метка]: путь`.
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { readText } from './tasks.js';
import { CliError, git, gitCause, insideRepo, toPosix } from './util.js';

// Инлайновая ссылка во всех формах. Одной первой мало: ссылка с заголовком не проверялась
// бы молча, а у формы в скобках целью стала бы строка вместе с `<`/`>`.
const INLINE_LINK = /\[[^\]]*\]\(\s*(?:<([^>\n]*)>|((?:[^\s()]|\([^\s()]*\))+))(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?\s*\)/g;

// Объявление `[метка]: путь` абзац не прерывает: годится начало файла, строка после пустой,
// заголовка или такого же объявления. Метка с `^` — сноска, у неё текст, а не путь.
const REF_DEFINITION = /^ {0,3}\[(?!\^)([^\]\n]+)\]:[ \t]*(?:<([^>\n]*)>|(\S+))/;

// Ссылка reference-style: `[текст][метка]`, `[метка][]` или `[метка]`;
// метка сравнивается без регистра.
const REF_USE = /\[([^[\]\n]*)\](?:\[([^[\]\n]*)\])?/g;
const refLabel = (label) => label.trim().replace(/\s+/g, ' ').toLowerCase();

// External addresses and anchors lead out of the tree. A root path (`/docs/…`) is not external: it
// leads into the tree from the repository root, and a missing target breaks it like a relative one.
export const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;

// Инлайновый спан закрывается ровно тем же числом кавычек, что открыло, и на другую строку
// не переходит: одинокая кавычка в тексте иначе гасила бы всё до конца файла.
const CODE_SPAN = /(`+)(?:(?!\1)[^\n])+\1/g;

const FENCE_OPEN = /^[ \t]*(`{3,}|~{3,})/;

// Блок кода гасится пробелами — номера строк прежние. Построчно: фенс закрывается фенсом того же
// знака не короче, незакрытый идёт до конца файла, отступ в пункте списка бывает больше трёх.
export function blankFences(text) {
  const lines = text.split('\n');
  let open = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (open === null) {
      const m = line.match(FENCE_OPEN);
      if (m) {
        open = m[1];
        lines[i] = line.replace(/[^\n\r]/g, ' ');
      }
      continue;
    }
    const closes = new RegExp(`^[ \\t]*${open[0] === '`' ? '`' : '~'}{${open.length},}[ \\t]*\\r?$`).test(line);
    lines[i] = line.replace(/[^\n\r]/g, ' ');
    if (closes) open = null;
  }
  return lines.join('\n');
}

// Инлайновый код — тот же блок кода, только в строке. Гасится после фенсов: внутри фенса
// кавычек уже нет.
function blankSpans(text) {
  return text.replace(CODE_SPAN, (m) => m.replace(/[^\n]/g, ' '));
}

export function blankCode(text) {
  return blankSpans(blankFences(text));
}

export function refDefinitions(text) {
  return refEntries(text).map((e) => e.href);
}

function refEntries(text) {
  const out = [];
  let canStart = true; // начало файла, пустая строка или заголовок выше
  for (const raw of text.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const m = canStart ? REF_DEFINITION.exec(line) : null;
    if (m) out.push({ label: m[1], href: m[2] ?? m[3] });
    canStart = Boolean(m) || !line.trim() || /^ {0,3}#/.test(line);
  }
  return out;
}

// Относительные ссылки текста: внешние адреса, якоря и показанное в коде сюда не попадают.
// Root paths (`/…`) stay: the gate resolves them from the repository root.
export function relativeLinks(text) {
  const clean = blankCode(text);
  const hrefs = [...clean.matchAll(INLINE_LINK)].map((m) => m[1] ?? m[2]);
  hrefs.push(...refDefinitions(clean));
  return hrefs.filter((href) => href && !EXTERNAL.test(href));
}

// An href is its target and the rest — `?query` and `#anchor` — cut at the first `#` or `?`.
export function splitHref(href) {
  const cut = href.search(/[#?]/);
  return cut === -1 ? { target: href, rest: '' } : { target: href.slice(0, cut), rest: href.slice(cut) };
}

// The project directory under the repository toplevel (`pkg/a/`), '' outside a repository: a root
// link `/…` starts at the toplevel, as GitHub and GitLab render it. Memoized: git is asked once.
const prefixes = new Map();
export function repoPrefix(root, lang = 'ru') {
  if (prefixes.has(root)) return prefixes.get(root);
  let prefix = '';
  if (insideRepo(root, lang)) {
    const r = git(root, ['rev-parse', '--show-prefix']);
    if (r.status !== 0) throw new CliError(`git rev-parse --show-prefix: ${gitCause(r, lang)}`);
    prefix = r.stdout.trim();
  }
  prefixes.set(root, prefix);
  return prefix;
}

// A root link `/…` as a posix path from the project root, given the project's `repoPrefix`.
function rootedRel(target, prefix) {
  return prefix ? path.posix.relative(`/${prefix}`, path.posix.normalize(target)) : path.posix.normalize(target.slice(1));
}

// The one href rule of gates 1, 8, 13 and seed: a decoded posix path from the project root, `/`
// from the repository root, anything else from `fromDir`; null when a `%`-escape is malformed.
export function normalizeHrefTarget(fromDir, target, prefix = '') {
  let decoded;
  try {
    decoded = decodeURI(target);
  } catch {
    return null;
  }
  return decoded.startsWith('/') ? rootedRel(decoded, prefix) : path.posix.normalize(path.posix.join(fromDir, decoded));
}

// Broken links of a file as `{ href, real }`: `real` is the target's real spelling when only the
// letter case differs, null when nothing is there. Anchor and query are dropped.
export function brokenLinks(file, root, prefix = '') {
  const fromDir = toPosix(path.relative(root, path.dirname(file)));
  const listings = new Map();
  const out = [];
  for (const href of relativeLinks(readText(file))) {
    const { target } = splitHref(href);
    if (!target) continue;
    const rel = normalizeHrefTarget(fromDir, target, prefix);
    if (rel === null) {
      out.push({ href, real: null });
      continue;
    }
    const real = caseMismatch(root, rel, listings);
    if (real !== null) out.push({ href, real });
    else if (!existsSync(path.join(root, rel))) out.push({ href, real: null });
  }
  return out;
}

// Linux CI and web renderers resolve case-sensitively, so each component is matched against its
// parent's listing: the real path when some component differs only in case, otherwise null.
function caseMismatch(base, rel, listings) {
  const real = [];
  let dir = base;
  let differs = false;
  for (const part of rel.split('/').filter((p) => p && p !== '.')) {
    if (part === '..') {
      real.push(part);
      dir = path.dirname(dir);
      continue;
    }
    if (!listings.has(dir)) listings.set(dir, listing(dir));
    const names = listings.get(dir);
    const name = names.includes(part) ? part : names.find((n) => n.toLowerCase() === part.toLowerCase());
    if (name === undefined) return null;
    differs ||= name !== part;
    real.push(name);
    dir = path.join(dir, name);
  }
  return differs ? real.join('/') : null;
}

function listing(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function resolveTarget(file, target, root, prefix) {
  const rel = normalizeHrefTarget(toPosix(path.relative(root, path.dirname(file))), target, prefix);
  return rel === null ? null : path.join(root, rel);
}

// Ссылки на существующий каталог — `{ text, href }`, инлайновые и reference-style. Текст — из
// исходника, от последней `[` перед `]`, а `` [`BS-5`](…) `` — номер.
export function directoryLinks(file, root, prefix = '') {
  const text = readText(file);
  const clean = blankCode(text);
  const isDir = (href) => {
    const { target } = splitHref(href);
    if (!target || EXTERNAL.test(href)) return false;
    const resolved = resolveTarget(file, target, root, prefix);
    return resolved !== null && existsSync(resolved) && statSync(resolved).isDirectory();
  };
  const out = [];
  for (const m of clean.matchAll(INLINE_LINK)) {
    const href = m[1] ?? m[2];
    if (!isDir(href)) continue;
    const close = m[0].indexOf(']');
    const open = m[0].lastIndexOf('[', close);
    out.push({ text: text.slice(m.index + open + 1, m.index + close), href });
  }
  const defined = new Map();
  for (const { label, href } of refEntries(clean)) if (!defined.has(refLabel(label))) defined.set(refLabel(label), href);
  for (const m of clean.matchAll(REF_USE)) {
    if (m[2] === undefined && /[(:]/.test(clean[m.index + m[0].length] ?? '')) continue;
    const href = defined.get(refLabel(m[2] || m[1]));
    if (href !== undefined && isDir(href)) out.push({ text: text.slice(m.index + 1, m.index + 1 + m[1].length), href });
  }
  return out;
}

// --- перепись при переезде ---------------------------------------------------------------

// Голова `[текст](`, цель (в угловых скобках или голая), хвост с заголовком и скобкой.
const LINK_PARTS = /(\[[^\]]*\]\(\s*)(<[^>\n]*>|(?:[^\s()]|\([^\s()]*\))+)((?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?\s*\))/g;
const REF_PARTS = /^( {0,3}\[(?!\^)[^\]\n]+\]:[ \t]*)(<[^>\n]*>|\S+)/gm;

// Обход целей: `fn` получает цель целиком, с якорем (свёртке он меняется вместе с путём), и
// возвращает новую либо null. Ссылки в блоках кода тоже переписываются: примеров на сам файл нет.
function mapHrefs(text, fn) {
  const map = (raw) => {
    const angled = raw.startsWith('<') && raw.endsWith('>');
    const href = angled ? raw.slice(1, -1) : raw;
    if (EXTERNAL.test(href)) return null;
    const next = fn(href);
    if (next === null) return null;
    return angled ? `<${next}>` : next;
  };
  return text
    .replace(LINK_PARTS, (whole, head, raw, tail) => {
      const next = map(raw);
      return next === null ? whole : `${head}${next}${tail}`;
    })
    .replace(REF_PARTS, (whole, head, raw) => {
      const next = map(raw);
      return next === null ? whole : `${head}${next}`;
    });
}

// Обход ссылок текста: `fn` получает путь без якоря и возвращает новый путь либо null, если
// менять нечего; якорь и query сохраняются какими были.
export function mapLinks(text, fn) {
  return mapHrefs(text, (href) => {
    // Корневой путь от каталога файла не зависит: ссылки переехавшего файла он не трогает.
    if (href.startsWith('/')) return null;
    const { target, rest } = splitHref(href);
    const next = fn(target);
    return next === null ? null : `${next}${rest}`;
  });
}

// Ссылки соседей на СВЁРНУТЫЙ файл: `resolve(путь от корня без слэша на конце, цель как написана)`
// возвращает `{ path, anchor }` строки журнала либо null; корневая ссылка корневой и остаётся.
export function rewriteFoldedLinks(text, fileDir, resolve, prefix = '') {
  return mapHrefs(text, (href) => {
    const { target } = splitHref(href);
    if (!target) return null;
    const rooted = target.startsWith('/');
    const abs = (rooted ? rootedRel(target, prefix) : path.posix.normalize(path.posix.join(fileDir, target))).replace(/\/+$/, '');
    const hit = resolve(abs, href);
    if (!hit) return null;
    return `${rooted ? `/${prefix}${hit.path}` : path.posix.relative(fileDir, hit.path)}#${hit.anchor}`;
  });
}

// Ссылки ПЕРЕЕХАВШЕГО файла: цель резолвится от старого каталога и пересчитывается от нового.
// Каталоги — posix-пути от корня репозитория: в markdown разделитель всегда `/`.
export function rewriteMovedLinks(text, fromDir, toDir) {
  return mapLinks(text, (target) => {
    const abs = path.posix.normalize(path.posix.join(fromDir, target));
    const next = path.posix.relative(toDir, abs);
    return next === target ? null : next;
  });
}

// Ссылки СОСЕДЕЙ на переехавший файл: правится только та, чья цель — сам переехавший файл;
// корневая остаётся корневой.
export function rewriteIncomingLinks(text, fileDir, oldPath, newPath, prefix = '') {
  return mapHrefs(text, (href) => {
    const { target, rest } = splitHref(href);
    if (!target) return null;
    const rooted = target.startsWith('/');
    const abs = rooted ? rootedRel(target, prefix) : path.posix.normalize(path.posix.join(fileDir, target));
    if (abs !== oldPath) return null;
    return `${rooted ? `/${prefix}${newPath}` : path.posix.relative(fileDir, newPath)}${rest}`;
  });
}
