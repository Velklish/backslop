// Markdown links: one parser for the gates, seed and rewrite, every form below.
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { loadProject } from './config.js';
import { msg } from './i18n.js';
import { linkGateFiles } from './mdwalk.js';
import { CliError, insideRepo, parseCommandArgs, printJson, readText, realpathOrNull, showPrefix, statOrNull, toPosix } from './util.js';

// A declaration `[label]: path` never interrupts a paragraph: it fits at the start of a file or
// after a blank line, a heading or another declaration. A `^` label is a footnote, not a path.
const REF_DEFINITION = /^ {0,3}\[(?!\^)([^\]\n]+)\]:[ \t]*(?:<([^>\n]*)>|(\S+))/;

// Blockquote markers and a list item marker in front of a line: a heading or a declaration may
// stand inside them.
const CONTAINER = /^(?: {0,3}>[ \t]?)*( {0,3}(?:[-*+]|\d{1,9}[.)])[ \t]+)?/;

// A reference-style label is compared case-insensitively, with one space for any run of whitespace.
const refLabel = (label) => label.trim().replace(/\s+/g, ' ').toLowerCase();

// The destination right after `]`: bare (balanced parentheses one level deep, so `foo(1).md`) or in
// angle brackets, with an optional title. The second form is `[text][label]` or `[text][]`.
const INLINE_DEST = /\(\s*(?:<([^>\n]*)>|((?:[^\s()]|\([^\s()]*\))+))(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?\s*\)/y;
const REF_USE = /\[([^[\]\n]*)\]/y;
const HTML_LINK = /<a\b[^>]*?\shref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const AUTOLINK = /<([a-z][a-z0-9+.-]{1,31}:[^\s<>]*)>/gi;

// External addresses and anchors lead out of the tree. A root path (`/docs/…`) is not external: it
// leads into the tree from the repository root, and a missing target breaks it like a relative one.
export const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;

// An inline span closes with exactly as many backticks as opened it and never crosses a line: a
// lone backtick in the text would otherwise blank everything to the end of the file.
export const CODE_SPAN = /(`+)(?:(?!\1)[^\n])+\1/g;
const CODE_SPAN_AT = new RegExp(CODE_SPAN.source, 'y');

const FENCE_OPEN = /^[ \t]*(`{3,}|~{3,})/;

// A code block is blanked with spaces, so line numbers stay. Line by line: a fence closes with one
// of the same character, not shorter; an unclosed fence runs to the end; list indents exceed three.
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

// Inline code is a code block within a line. Blanked after the fences: no backticks are left inside
// a fence by then.
function blankSpans(text) {
  return text.replace(CODE_SPAN, (m) => m.replace(/[^\n]/g, ' '));
}

export function blankCode(text) {
  return blankSpans(blankFences(text));
}

// Fenced blocks blanked like `blankFences`, also behind blockquote markers or a list marker; a
// fence opened in a blockquote ends with it.
function blankContainedFences(text) {
  const lines = text.split('\n');
  let open = null;
  for (let i = 0; i < lines.length; i += 1) {
    const [prefix] = lines[i].match(CONTAINER);
    const depth = prefix.split('>').length - 1;
    if (open !== null && depth < open.depth) open = null;
    if (open === null) {
      const m = lines[i].slice(prefix.length).match(FENCE_OPEN);
      if (!m) continue;
      open = { mark: m[1], depth };
    } else {
      // Inside a fence only its own quote markers are markup: `> ```` in a top-level fence is code.
      const rest = lines[i].replace(new RegExp(`^(?: {0,3}>[ \\t]?){${open.depth}}`), '');
      if (new RegExp(`^[ \\t]*${open.mark[0] === '`' ? '`' : '~'}{${open.mark.length},}[ \\t]*\\r?$`).test(rest)) open = null;
    }
    lines[i] = lines[i].replace(/[^\n\r]/g, ' ');
  }
  return lines.join('\n');
}

// Code and HTML comments blanked, offsets kept. Spans and comments are taken left to right, so a
// backtick inside a comment and `<!--` inside a span are both text; an unclosed comment is text.
function blankProse(text) {
  const src = blankContainedFences(text);
  const opener = /`+|<!--/g;
  let out = '';
  let last = 0;
  for (let m = opener.exec(src); m; m = opener.exec(src)) {
    let end = -1;
    if (m[0] === '<!--') {
      const close = src.indexOf('-->', m.index + 4);
      if (close !== -1) end = close + 3;
    } else {
      CODE_SPAN_AT.lastIndex = m.index;
      if (CODE_SPAN_AT.test(src)) end = CODE_SPAN_AT.lastIndex;
    }
    if (end === -1) continue;
    out += src.slice(last, m.index) + src.slice(m.index, end).replace(/[^\n\r]/g, ' ');
    last = end;
    opener.lastIndex = end;
  }
  return out + src.slice(last);
}

// Declarations with their offsets, also behind blockquote markers or a list marker; label and
// target are read from the source line: code in a label is part of the label.
function refEntries(clean, text) {
  const out = [];
  let canStart = true; // start of file, or a blank line, a heading or a declaration above
  let depth = 0;
  let at = 0;
  for (const line of clean.split('\n')) {
    const [prefix, item] = line.match(CONTAINER);
    const quotes = prefix.split('>').length - 1;
    const body = line.slice(prefix.length);
    const from = at + prefix.length;
    // A list item or a deeper blockquote opens a block, and with it a paragraph.
    const m = canStart || item || quotes > depth ? REF_DEFINITION.exec(body) : null;
    if (m) {
      const raw = REF_DEFINITION.exec(text.slice(from, from + body.length)) ?? m;
      const href = raw[2] ?? raw[3];
      const head = raw[0].match(/^ {0,3}\[(?!\^)[^\]\n]+\]:[ \t]*/)[0].length;
      const hrefStart = from + head + (raw[2] === undefined ? 0 : 1);
      out.push({
        label: raw[1], href, start: from, end: from + m[0].length,
        hrefStart, hrefEnd: hrefStart + href.length,
      });
    }
    canStart = Boolean(m) || !body.trim() || /^ {0,3}#/.test(body);
    depth = quotes;
    at += line.length + 1;
  }
  return out;
}

// The `]` closing the `[` at `open`, or -1: brackets nest, a backslash escapes the next character,
// and a blank line ends the paragraph a link text may span.
function closingBracket(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    const c = src[i];
    if (c === '\\') i += 1;
    else if (c === '[') depth += 1;
    else if (c === ']') {
      depth -= 1;
      if (depth === 0) return i;
    } else if (c === '\n') {
      let k = i + 1;
      while (src[k] === ' ' || src[k] === '\t' || src[k] === '\r') k += 1;
      if (k >= src.length || src[k] === '\n') return -1;
    }
  }
  return -1;
}

// Every link with href offsets in the source. `linksOf` below keeps the public shape.
function linksWithPositions(text) {
  const src = blankProse(text);
  const found = [];
  const defs = new Map();
  const starts = [0];
  for (let i = src.indexOf('\n'); i !== -1; i = src.indexOf('\n', i + 1)) starts.push(i + 1);
  const lineOf = (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  let scan = src;
  for (const d of refEntries(src, text)) {
    const key = refLabel(d.label);
    if (key && !defs.has(key)) defs.set(key, d.href);
    found.push({
      at: d.start, form: 'definition', href: d.href, line: lineOf(d.start),
      hrefStart: d.hrefStart, hrefEnd: d.hrefEnd,
    });
    scan = scan.slice(0, d.start) + ' '.repeat(d.end - d.start) + scan.slice(d.end);
  }
  const taken = [];
  const visit = (from, to) => {
    for (let i = from; i < to; i += 1) {
      if (scan[i] === '\\') {
        i += 1;
        continue;
      }
      if (scan[i] !== '[') continue;
      const close = closingBracket(scan, i);
      if (close === -1 || close >= to) continue;
      const at = scan[i - 1] === '!' ? i - 1 : i;
      const link = { at, line: lineOf(at), text: text.slice(i + 1, close) };
      let end = -1;
      INLINE_DEST.lastIndex = close + 1;
      REF_USE.lastIndex = close + 1;
      const inline = scan[close + 1] === '(' ? INLINE_DEST.exec(scan) : null;
      const use = !inline && scan[close + 1] === '[' ? REF_USE.exec(scan) : null;
      if (inline) {
        INLINE_DEST.lastIndex = close + 1;
        const raw = INLINE_DEST.exec(text);
        const positions = {};
        if (raw) {
          const href = raw[1] ?? raw[2];
          const offset = raw[1] === undefined ? raw[0].match(/^\(\s*/)[0].length : raw[0].indexOf('<') + 1;
          positions.hrefStart = close + 1 + offset;
          positions.hrefEnd = positions.hrefStart + href.length;
        }
        Object.assign(link, {
          form: at < i ? 'image' : 'inline',
          href: inline[1] ?? inline[2],
          ...positions,
        });
        end = close + 1 + inline[0].length;
      } else if (use) {
        const written = text.slice(close + 2, close + use[0].length);
        const label = written.trim() ? written : link.text;
        const href = defs.get(refLabel(label));
        if (refLabel(label)) {
          Object.assign(link, { form: href === undefined ? 'unresolved' : 'reference', href: href ?? null, label });
          end = close + 1 + use[0].length;
        }
      } else if (!/[(:]/.test(scan[close + 1] ?? '') && defs.has(refLabel(link.text))) {
        Object.assign(link, { form: 'reference', href: defs.get(refLabel(link.text)), label: link.text });
        end = close + 1;
      }
      if (end === -1) continue;
      found.push(link);
      taken.push([at, end]);
      // A link's text may hold an image: a badge is two links, the image and the outer destination.
      visit(i + 1, close);
      i = end - 1;
    }
  };
  visit(0, scan.length);
  const free = (at) => !taken.some(([a, b]) => at >= a && at < b);
  for (const m of scan.matchAll(HTML_LINK)) {
    if (free(m.index)) {
      const href = m[1] ?? m[2];
      const value = m[0].match(/\shref\s*=\s*(?:"|')/i);
      const hrefStart = m.index + value.index + value[0].length;
      found.push({
        at: m.index, form: 'html', href, hrefStart,
        hrefEnd: hrefStart + href.length, line: lineOf(m.index),
      });
    }
  }
  for (const m of scan.matchAll(AUTOLINK)) {
    if (free(m.index)) found.push({ at: m.index, form: 'autolink', href: m[1], line: lineOf(m.index) });
  }
  return found.sort((a, b) => a.at - b.at).map(({ at, ...link }) => link);
}

// Every link of a Markdown text in document order, as `{ form, href, line, text?, label? }`. Forms:
// inline, image, reference, unresolved (no declaration; href null), definition, html, autolink.
export function linksOf(text) {
  return linksWithPositions(text).map(({ hrefStart, hrefEnd, ...link }) => link);
}

// Local links of a text as `{ href, line }`: no external address or bare anchor, a use of a
// declaration counted as its target. A root path (`/…`) stays: it starts at the repository root.
export function localLinks(text) {
  return linksOf(text).filter((l) => l.href && l.form !== 'reference' && !EXTERNAL.test(l.href))
    .map(({ href, line }) => ({ href, line }));
}

export function relativeLinks(text) {
  return localLinks(text).map((l) => l.href);
}

// --- anchors ---------------------------------------------------------------------------------

// GitHub's heading slug, which gitlab.ati.st renders alike: lowercase, punctuation dropped except
// `-` and `_`, each space a hyphen.
export function slugOf(heading) {
  return heading.trim().toLowerCase().replace(/[^\p{L}\p{M}\p{N} _-]/gu, '').replace(/ /g, '-');
}

// Unique slugs in document order: a repeated heading takes `-1`, then `-2`, as GitHub does.
export function uniqueSlugs(bases) {
  const seen = Object.create(null);
  return bases.map((base) => {
    let slug = base;
    while (Object.hasOwn(seen, slug)) {
      seen[base] += 1;
      slug = `${base}-${seen[base]}`;
    }
    seen[slug] = 0;
    return slug;
  });
}

// The named entities the renderer decodes to a character the slug then drops. A letter entity such
// as `&eacute;` is not here: it would have to give its letter, and the full table is not vendored.
const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', ensp: '\u2002', emsp: '\u2003', thinsp: '\u2009',
  iexcl: '\u00a1', cent: '\u00a2', pound: '\u00a3', curren: '\u00a4', yen: '\u00a5', brvbar: '\u00a6', sect: '\u00a7',
  uml: '\u00a8', copy: '\u00a9', laquo: '\u00ab', not: '\u00ac', reg: '\u00ae', macr: '\u00af', deg: '\u00b0',
  plusmn: '\u00b1', acute: '\u00b4', para: '\u00b6', middot: '\u00b7', cedil: '\u00b8', raquo: '\u00bb',
  iquest: '\u00bf', times: '\u00d7', divide: '\u00f7', ndash: '\u2013', mdash: '\u2014', lsquo: '\u2018',
  rsquo: '\u2019', sbquo: '\u201a', ldquo: '\u201c', rdquo: '\u201d', bdquo: '\u201e', dagger: '\u2020',
  bull: '\u2022', hellip: '\u2026', permil: '\u2030', prime: '\u2032', lsaquo: '\u2039', rsaquo: '\u203a',
  euro: '\u20ac', trade: '\u2122', larr: '\u2190', uarr: '\u2191', rarr: '\u2192', darr: '\u2193', harr: '\u2194',
};

// Heading prose as rendered: a link, image or autolink as its text, a tag dropped, `_` emphasis
// unwrapped (not an escaped or intraword `_`), the ENTITIES and numeric ones decoded.
function renderedProse(s) {
  let text = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\](?:\([^)]*\)|\[[^\]]*\])/g, '$1')
    .replace(AUTOLINK, '$1').replace(/<\/?[A-Za-z][\w-]*(?:\s[^>]*)?\/?>/g, '');
  for (let prev = ''; prev !== text;) {
    prev = text;
    text = text.replace(/(^|[^\p{L}\p{N}\\])(_+)(?=\S)(.*?[^\s\\])\2(?![\p{L}\p{N}])/u, '$1$3');
  }
  return text.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (m, dec, hex, name) => {
    const code = dec || hex ? parseInt(dec ?? hex, dec ? 10 : 16) : 0;
    if (code > 0 && code <= 0x10ffff) return String.fromCodePoint(code);
    return name ? (ENTITIES[name.toLowerCase()] ?? m) : m;
  });
}

// The visible text of heading source; a code span keeps its content.
function headingText(body) {
  let out = '';
  let last = 0;
  for (const m of body.matchAll(/(`+)(.+?)\1(?!`)/g)) {
    out += renderedProse(body.slice(last, m.index)) + m[2];
    last = m.index + m[0].length;
  }
  return out + renderedProse(body.slice(last));
}

const ATX = /^ {0,3}#{1,6}(?:[ \t]|\r?$)/;
const SETEXT = /^ {0,3}(?:=+|-+)[ \t]*\r?$/;
const BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*\r?$/;

// Anchors a Markdown text exposes: slugs of ATX and setext headings, also in a blockquote or a list
// item, with duplicate suffixes, `id="…"` and `<a name="…">`; code and HTML comments hold none.
export function anchorsOf(text) {
  const clean = blankProse(text);
  const raw = text.split('\n');
  const bases = [];
  let para = [];
  let itemIndent = 0;
  clean.split('\n').forEach((line, i) => {
    const [prefix, item] = line.match(CONTAINER);
    const body = line.slice(prefix.length);
    const source = raw[i].slice(prefix.length).replace(/\r$/, '');
    if (ATX.test(body)) {
      bases.push(slugOf(headingText(source.replace(/^ {0,3}#{1,6}/, '').replace(/[ \t]+#+[ \t]*$/, ''))));
      para = [];
    } else if (para.length && !item && SETEXT.test(body) && body.search(/\S/) >= itemIndent) {
      // A setext underline closes the paragraph above it, inside a list item only when indented
      // to the item's text; the paragraph lines join with a space.
      bases.push(slugOf(headingText(para.join(' '))));
      para = [];
    } else if (!body.trim() || BREAK.test(body)) {
      para = [];
    } else {
      if (!para.length) itemIndent = item ? item.length : 0;
      para.push(source.trim());
    }
  });
  const anchors = new Set(uniqueSlugs(bases));
  for (const m of clean.matchAll(/\sid\s*=\s*(?:"([^"]+)"|'([^']+)')/gi)) anchors.add(m[1] ?? m[2]);
  for (const m of clean.matchAll(/<a\b[^>]*\sname\s*=\s*(?:"([^"]+)"|'([^']+)')/gi)) anchors.add(m[1] ?? m[2]);
  return anchors;
}

// A fragment matches when, URL-decoded, it names an anchor as written or lowercased.
export function hasAnchor(anchors, fragment) {
  let decoded = fragment;
  try {
    decoded = decodeURIComponent(fragment);
  } catch {
    // A malformed escape is compared as written.
  }
  return anchors.has(decoded) || anchors.has(decoded.toLowerCase());
}

// A fragment the renderer resolves with no heading or id behind it: `#top`, the top of any page,
// and a source-view line `#L12` or `#L12-L20` after `?plain=1`.
function renderedFragment(fragment, query) {
  let decoded = fragment;
  try {
    decoded = decodeURIComponent(fragment);
  } catch {
    return false;
  }
  if (decoded.toLowerCase() === 'top') return true;
  return /^\?(?:.*&)?plain=1(?:&|$)/.test(query) && /^L\d+(?:-L\d+)?$/.test(decoded);
}

// Anchors of a file by absolute path, each file read once: a regular file inside the project, the
// real path counted; null for anything else, whose anchors are not checked.
export function anchorReader(root) {
  const base = realpathOrNull(root);
  const cache = new Map();
  return (abs) => {
    if (!cache.has(abs)) {
      const real = realpathOrNull(abs);
      const rel = real && base ? path.relative(base, real) : '..';
      const inside = rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
      cache.set(abs, inside && statOrNull(real)?.isFile() ? anchorsOf(readText(real)) : null);
    }
    return cache.get(abs);
  };
}

// --- the link rule -----------------------------------------------------------------------------

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
  if (insideRepo(root, lang)) prefix = showPrefix(root, lang);
  prefixes.set(root, prefix);
  return prefix;
}

// A root link `/…` as a posix path from the project root, given the project's `repoPrefix`.
function rootedRel(target, prefix) {
  return prefix ? path.posix.relative(`/${prefix}`, path.posix.normalize(target)) : path.posix.normalize(target.slice(1));
}

// The one href rule of gates 1, 8, 13, 15 and seed: a decoded posix path from the project root, `/`
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

// Gate 1 over one file: its problems in document order and the counts it read. `anchorsAt` is an
// `anchorReader`; `skipAnchors(rel)` leaves a target's anchors to another gate.
export function checkLinks(file, root, prefix = '', anchorsAt = anchorReader(root), skipAnchors = () => false) {
  const fromDir = toPosix(path.relative(root, path.dirname(file)));
  const listings = new Map();
  const counts = { links: 0, local: 0, anchors: 0 };
  const problems = [];
  for (const link of linksOf(readText(file))) {
    const { href, line } = link;
    counts.links += 1;
    if (link.form === 'unresolved') {
      problems.push({ kind: 'label', line, text: link.text, label: link.label });
      continue;
    }
    // A use of a declaration is checked once, at the declaration.
    if (link.form === 'reference' || (EXTERNAL.test(href) && !href.startsWith('#'))) continue;
    counts.local += 1;
    const { target, rest } = splitHref(href);
    const hash = rest.indexOf('#');
    let abs = file;
    let rel = null;
    if (target) {
      rel = normalizeHrefTarget(fromDir, target, prefix);
      const mismatch = rel === null ? null : caseMismatch(root, rel, listings);
      if (mismatch !== null) {
        problems.push({ kind: mismatch.kind, line, href, real: mismatch.real });
        continue;
      }
      abs = rel === null ? null : path.join(root, rel);
      if (abs === null || !existsSync(abs)) {
        problems.push({ kind: 'missing', line, href });
        continue;
      }
      if (!/\.md$/i.test(rel)) continue;
    }
    if (hash === -1 || hash === rest.length - 1 || (rel !== null && skipAnchors(rel))) continue;
    const fragment = rest.slice(hash + 1);
    if (renderedFragment(fragment, rest.slice(0, hash))) continue;
    const anchors = anchorsAt(abs);
    if (anchors === null) continue;
    counts.anchors += 1;
    if (!hasAnchor(anchors, fragment)) problems.push({ kind: 'anchor', line, href, fragment, target: rel });
  }
  return { counts, problems };
}

// Linux CI and web renderers resolve byte-exact, so each component is matched against its parent's
// listing: the real path with `case` or `normalization` (Unicode form only) as the kind, else null.
function caseMismatch(base, rel, listings) {
  const real = [];
  let dir = base;
  let kind = null;
  for (const part of rel.split('/').filter((p) => p && p !== '.')) {
    if (part === '..') {
      real.push(part);
      dir = path.dirname(dir);
      continue;
    }
    if (!listings.has(dir)) listings.set(dir, listing(dir));
    const names = listings.get(dir);
    const nfc = part.normalize('NFC');
    const name = names.includes(part) ? part
      : names.find((n) => n.normalize('NFC') === nfc) ?? names.find((n) => n.normalize('NFC').toLowerCase() === nfc.toLowerCase());
    if (name === undefined) return null;
    if (name !== part) kind = kind === 'case' || name.normalize('NFC') !== nfc ? 'case' : 'normalization';
    real.push(name);
    dir = path.join(dir, name);
  }
  return kind === null ? null : { kind, real: real.join('/') };
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

// Links to an existing directory as `{ text, href, line }`: every form with a link text. The text
// is read from the source, so `` [`BS-5`](…) `` keeps its number.
export function directoryLinks(file, root, prefix = '') {
  const out = [];
  for (const { text, href, line } of linksOf(readText(file))) {
    if (text === undefined || !href || EXTERNAL.test(href)) continue;
    const { target } = splitHref(href);
    if (!target) continue;
    const resolved = resolveTarget(file, target, root, prefix);
    if (resolved !== null && existsSync(resolved) && statSync(resolved).isDirectory()) out.push({ text, href, line });
  }
  return out;
}

// --- rewrite on move ---------------------------------------------------------------

// Walks the targets: `fn` gets the whole target with its anchor (a fold changes it with the path)
// and returns a new one or null. Positions come from `linksWithPositions`, the parser of gate 1.
function mapHrefs(text, fn) {
  const edits = [];
  for (const link of linksWithPositions(text)) {
    const { hrefStart, hrefEnd } = link;
    if (hrefStart === undefined || hrefEnd === undefined || link.form === 'reference') continue;
    const href = text.slice(hrefStart, hrefEnd);
    if (!href || EXTERNAL.test(href)) continue;
    const next = fn(href);
    if (next !== null) edits.push([hrefStart, hrefEnd, next]);
  }
  if (!edits.length) return text;
  let out = '';
  let last = 0;
  for (const [start, end, next] of edits.sort((a, b) => a[0] - b[0])) {
    out += text.slice(last, start) + next;
    last = end;
  }
  return out + text.slice(last);
}

// Walks the links of a text: `fn` gets the path without the anchor and returns a new path, or null
// when nothing changes; the anchor and the query stay as they were.
export function mapLinks(text, fn) {
  return mapHrefs(text, (href) => {
    // A root path does not depend on the file's directory: a moved file's links leave it alone.
    if (href.startsWith('/')) return null;
    const { target, rest } = splitHref(href);
    const next = fn(target);
    return next === null ? null : `${next}${rest}`;
  });
}

// Neighbours' links to a FOLDED file: `resolve(path, href)` gets the path from the root without a
// trailing slash and the href as written; returns `{ path, anchor }` of a journal line or null.
export function rewriteFoldedLinks(text, fileDir, resolve, prefix = '') {
  return mapHrefs(text, (href) => {
    const { target } = splitHref(href);
    if (!target) return null;
    const abs = normalizeHrefTarget(fileDir, target, prefix);
    // A malformed `%` escape is never rewritten; its raw path reaches `resolve` for the report.
    const hit = resolve((abs ?? rawHrefTarget(fileDir, target, prefix)).replace(/\/+$/, ''), href);
    if (!hit || abs === null) return null;
    const next = target.startsWith('/') ? `/${prefix}${hit.path}` : path.posix.relative(fileDir, hit.path);
    return `${respell(target, next)}#${hit.anchor}`;
  });
}

// A relative target resolved from `fromDir`, passed through `map`, made relative to `toDir`;
// null when it reads the same. Shared with the Cursor adapter, which maps to its own layout.
export function rebaseTarget(target, fromDir, toDir, map = (p) => p) {
  const next = path.posix.relative(toDir, map(path.posix.normalize(path.posix.join(fromDir, target))));
  return next === target ? null : next;
}

// The path of an href as written, not decoded: `%25` decodes back to `%`.
function rawHrefTarget(fromDir, target, prefix) {
  return normalizeHrefTarget(fromDir, target.replace(/%/g, '%25'), prefix);
}

// A rewritten path is percent-encoded when the href it replaces was.
function respell(target, next) {
  return decodeURI(target) === target ? next : encodeURI(next);
}

// Links of a MOVED file: the target resolves from the old directory and is rebased to the new one.
// Directories are posix paths from the repository root: a markdown separator is always `/`.
export function rewriteMovedLinks(text, fromDir, toDir) {
  return mapLinks(text, (target) => {
    let decoded;
    try {
      decoded = decodeURI(target);
    } catch {
      // A malformed `%` escape is never decoded: the link is rebased as written.
      return rebaseTarget(target, fromDir, toDir);
    }
    const next = rebaseTarget(decoded, fromDir, toDir);
    return next === null ? null : respell(target, next);
  });
}

// Neighbours' links to the moved file: only a link whose target is the moved file itself changes;
// a root link stays a root link.
export function rewriteIncomingLinks(text, fileDir, oldPath, newPath, prefix = '') {
  return mapHrefs(text, (href) => {
    const { target, rest } = splitHref(href);
    if (!target || normalizeHrefTarget(fileDir, target, prefix) !== oldPath) return null;
    const next = target.startsWith('/') ? `/${prefix}${newPath}` : path.posix.relative(fileDir, newPath);
    return `${respell(target, next)}${rest}`;
  });
}

// `links --external`: the http(s) addresses of the gate 1 file set, requested one at a time and
// classified by the answer. The network never reaches `lint` or `gates` (02-cli.md).
const TIMEOUT_MS = 20000;
const USER_AGENT = 'backslop-links';
const HTTP_URL = /^https?:\/\//i;

// ok: 2xx and 3xx; unverified: the server did not decide (auth, rate limit, 408, 5xx); else dead.
export function classifyStatus(status) {
  if (status >= 200 && status < 400) return 'ok';
  if ([401, 403, 408, 429].includes(status) || (status >= 500 && status <= 599)) return 'unverified';
  return 'dead';
}

// Distinct http(s) addresses in document order; the fragment is not part of the address.
export function externalUrls(root, dirs) {
  const urls = new Set();
  for (const [, abs] of linkGateFiles(root, dirs)) {
    for (const { href } of linksOf(readText(abs))) {
      if (href && HTTP_URL.test(href)) urls.add(href.replace(/#.*$/, ''));
    }
  }
  return [...urls];
}

async function check(url) {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'user-agent': USER_AGENT },
    });
    await res.body?.cancel();
    return { url, class: classifyStatus(res.status), status: res.status, error: null };
  } catch (e) {
    return { url, class: 'unverified', status: null, error: e.cause?.code ?? e.name };
  }
}

export async function run(argv, { cwd, lang }) {
  const { values } = parseCommandArgs(argv, {
    external: { type: 'boolean' },
    json: { type: 'boolean' },
  }, { positionals: 0, lang });
  const { root, cfg, dirs } = loadProject(cwd);
  if (values.external !== true) {
    throw new CliError(msg(cfg.lang,
      'links needs --external: local links are checked by {cli} lint', { cli: cfg.cli }));
  }
  const asJson = values.json === true;
  const results = [];
  for (const url of externalUrls(root, dirs)) {
    const row = await check(url);
    results.push(row);
    if (!asJson) console.log(`${row.class} ${row.status ?? row.error} ${row.url}`);
  }
  const count = (kind) => results.filter((r) => r.class === kind).length;
  const dead = count('dead');
  const unverified = count('unverified');
  if (asJson) {
    printJson({ total: results.length, ok: count('ok'), dead, unverified, results });
  } else {
    console.log(msg(cfg.lang, 'links: {urls} urls, {dead} dead, {unverified} unverified',
      { urls: results.length, dead, unverified }));
  }
  if (dead) return 1;
  return unverified ? 2 : 0;
}
