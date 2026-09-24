// Ссылки markdown: разбор для гейта и перепись при переезде файла — один набор форм на обоих:
// инлайновая (голая цель, с заголовком, в угловых скобках) и объявление `[метка]: путь`.
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

// Инлайновая ссылка во всех формах. Одной первой мало: ссылка с заголовком не проверялась
// бы молча, а у формы в скобках целью стала бы строка вместе с `<`/`>`.
export const INLINE_LINK = /\[[^\]]*\]\(\s*(?:<([^>\n]*)>|([^\s)]+))(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?\s*\)/g;

// Объявление `[метка]: путь` абзац не прерывает: годится начало файла, строка после пустой,
// заголовка или такого же объявления. Метка с `^` — сноска, у неё текст, а не путь.
export const REF_DEFINITION = /^ {0,3}\[(?!\^)([^\]\n]+)\]:[ \t]*(?:<([^>\n]*)>|(\S+))/;

// Ссылка reference-style: `[текст][метка]`, `[метка][]` или `[метка]`; метка сравнивается без регистра.
const REF_USE = /\[([^[\]\n]*)\](?:\[([^[\]\n]*)\])?/g;
const refLabel = (label) => label.trim().replace(/\s+/g, ' ').toLowerCase();

// Внешние адреса и якоря: в дерево они не ведут. Корневой путь (`/docs/…`) сюда не входит —
// он ведёт в дерево от корня проекта, и исчезновение цели рвёт его так же, как относительный.
export const EXTERNAL = /^(https?:|mailto:|#)/;

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
export function blankSpans(text) {
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
// Корневые пути (`/…`) остаются — гейт резолвит их от корня проекта.
export function relativeLinks(text) {
  const clean = blankCode(text);
  const hrefs = [...clean.matchAll(INLINE_LINK)].map((m) => m[1] ?? m[2]);
  hrefs.push(...refDefinitions(clean));
  return hrefs.filter((href) => href && !/^(https?:|mailto:|#)/.test(href));
}

// Битые ссылки файла: относительная цель резолвится от его каталога, корневая — от корня
// проекта; якорь и query отбрасываются.
export function brokenLinks(file, root = null) {
  const out = [];
  for (const href of relativeLinks(readFileSync(file, 'utf8'))) {
    const target = href.split(/[#?]/)[0];
    if (!target) continue;
    let resolved;
    try {
      resolved = resolveTarget(file, target, root);
    } catch {
      out.push(href);
      continue;
    }
    if (!existsSync(resolved)) out.push(href);
  }
  return out;
}

function resolveTarget(file, target, root) {
  return target.startsWith('/')
    ? path.join(root ?? path.parse(file).root, decodeURI(target))
    : path.resolve(path.dirname(file), decodeURI(target));
}

// Ссылки на существующий каталог — `{ text, href }`, инлайновые и reference-style. Текст — от ближайшей
// `[` перед `]`, из исходника: незакрытая скобка раньше в абзаце не в счёт, а `` [`BS-5`](…) `` — номер.
export function directoryLinks(file, root = null) {
  const text = readFileSync(file, 'utf8');
  const clean = blankCode(text);
  const isDir = (href) => {
    const target = href.split(/[#?]/)[0];
    if (!target || /^(https?:|mailto:)/.test(target)) return false;
    try {
      const resolved = resolveTarget(file, target, root);
      return existsSync(resolved) && statSync(resolved).isDirectory();
    } catch {
      return false;
    }
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
const LINK_PARTS = /(\[[^\]]*\]\(\s*)(<[^>\n]*>|[^\s)]+)((?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?\s*\))/g;
const REF_PARTS = /^( {0,3}\[(?!\^)[^\]\n]+\]:[ \t]*)(<[^>\n]*>|\S+)/gm;

// Обход целей: `fn` получает цель целиком, с якорем (свёртке он меняется вместе с путём), и
// возвращает новую либо null. Ссылки в блоках кода тоже переписываются: примеров на сам файл нет.
export function mapHrefs(text, fn) {
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
    const cut = href.search(/[#?]/);
    const target = cut === -1 ? href : href.slice(0, cut);
    const rest = cut === -1 ? '' : href.slice(cut);
    const next = fn(target);
    return next === null ? null : `${next}${rest}`;
  });
}

// Ссылки соседей на СВЁРНУТЫЙ файл: `resolve(путь от корня без слэша на конце, цель как написана)`
// возвращает `{ path, anchor }` строки журнала либо null; корневая ссылка корневой и остаётся.
export function rewriteFoldedLinks(text, fileDir, resolve) {
  return mapHrefs(text, (href) => {
    const cut = href.search(/[#?]/);
    const target = cut === -1 ? href : href.slice(0, cut);
    if (!target) return null;
    const rooted = target.startsWith('/');
    const abs = path.posix.normalize(rooted ? target.slice(1) : path.posix.join(fileDir, target)).replace(/\/+$/, '');
    const hit = resolve(abs, href);
    if (!hit) return null;
    return `${rooted ? `/${hit.path}` : path.posix.relative(fileDir, hit.path)}#${hit.anchor}`;
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
export function rewriteIncomingLinks(text, fileDir, oldPath, newPath) {
  return mapHrefs(text, (href) => {
    const cut = href.search(/[#?]/);
    const target = cut === -1 ? href : href.slice(0, cut);
    if (!target) return null;
    const rooted = target.startsWith('/');
    const abs = path.posix.normalize(rooted ? target.slice(1) : path.posix.join(fileDir, target));
    if (abs !== oldPath) return null;
    return `${rooted ? `/${newPath}` : path.posix.relative(fileDir, newPath)}${cut === -1 ? '' : href.slice(cut)}`;
  });
}
