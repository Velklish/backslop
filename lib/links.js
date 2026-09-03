// Ссылки markdown: разбор для гейта и перепись при переезде файла. Оба потребителя читают
// один набор форм — инлайновая ссылка (голая цель, цель с заголовком, цель в угловых
// скобках) и reference-style объявление `[метка]: путь`.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Инлайновая ссылка во всех формах. Одной первой мало: ссылка с заголовком не проверялась
// бы молча, а у формы в скобках целью стала бы строка вместе с `<`/`>`.
export const INLINE_LINK = /\[[^\]]*\]\(\s*(?:<([^>\n]*)>|([^\s)]+))(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?\s*\)/g;

// Reference-style: цель объявляется отдельной строкой. По markdown объявление НЕ прерывает
// абзац — годится начало файла, строка после пустой, после заголовка или следом за таким же
// объявлением. Иначе «[Заметка]: пояснение» посреди абзаца читалась бы объявлением.
// Метка с `^` — сноска, у неё не путь, а текст.
export const REF_DEFINITION = /^ {0,3}\[(?!\^)[^\]\n]+\]:[ \t]*(?:<([^>\n]*)>|(\S+))/;

// Внешние адреса, якоря и корневые пути (`/docs/…` GitHub резолвит от корня репозитория):
// переезд файла им безразличен.
export const EXTERNAL = /^(https?:|mailto:|#|\/)/;

// Инлайновый спан закрывается ровно тем же числом кавычек, что открыло, и на другую строку
// не переходит: одинокая кавычка в тексте иначе гасила бы всё до конца файла.
const CODE_SPAN = /(`+)(?:(?!\1)[^\n])+\1/g;

const FENCE_OPEN = /^[ \t]*(`{3,}|~{3,})/;

// Блок кода — не текст: показанное в нём ничего не объявляет. Гасим пробелами, а не
// вырезаем: номера строк остаются прежними. Построчно, а не регексом: фенс закрывается
// только фенсом того же знака не короче открывающего, незакрытый идёт до конца файла, а
// отступ фенса внутри пункта списка бывает и больше трёх пробелов — такой блок тоже код.
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
  const out = [];
  let canStart = true; // начало файла, пустая строка или заголовок выше
  for (const raw of text.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const m = canStart ? REF_DEFINITION.exec(line) : null;
    if (m) out.push(m[1] ?? m[2]);
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
      resolved = target.startsWith('/')
        ? path.join(root ?? path.parse(file).root, decodeURI(target))
        : path.resolve(path.dirname(file), decodeURI(target));
    } catch {
      out.push(href);
      continue;
    }
    if (!existsSync(resolved)) out.push(href);
  }
  return out;
}

// --- перепись при переезде ---------------------------------------------------------------

// Голова `[текст](`, цель (в угловых скобках или голая), хвост с заголовком и скобкой.
const LINK_PARTS = /(\[[^\]]*\]\(\s*)(<[^>\n]*>|[^\s)]+)((?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?\s*\))/g;
const REF_PARTS = /^( {0,3}\[(?!\^)[^\]\n]+\]:[ \t]*)(<[^>\n]*>|\S+)/gm;

function mapTarget(raw, fn) {
  const angled = raw.startsWith('<') && raw.endsWith('>');
  const href = angled ? raw.slice(1, -1) : raw;
  if (EXTERNAL.test(href)) return null;
  const cut = href.search(/[#?]/);
  const target = cut === -1 ? href : href.slice(0, cut);
  const rest = cut === -1 ? '' : href.slice(cut);
  const next = fn(target);
  if (next === null) return null;
  return angled ? `<${next}${rest}>` : `${next}${rest}`;
}

// Обход ссылок текста: `fn` получает путь без якоря и возвращает новый путь либо null, если
// менять нечего. Ссылки внутри блоков кода тоже переписываются — разбирать markdown ради этого
// дороже пользы: в постановках задач ссылок-примеров на сам файл не бывает.
export function mapLinks(text, fn) {
  return text
    .replace(LINK_PARTS, (whole, head, raw, tail) => {
      const next = mapTarget(raw, fn);
      return next === null ? whole : `${head}${next}${tail}`;
    })
    .replace(REF_PARTS, (whole, head, raw) => {
      const next = mapTarget(raw, fn);
      return next === null ? whole : `${head}${next}`;
    });
}

// Ссылки ПЕРЕЕХАВШЕГО файла. Одно правило вместо перечня частных замен: цель резолвится
// от старого каталога и пересчитывается относительно нового. Каталоги — пути от корня
// репозитория в posix-форме; считает функция тоже posix'ом: в markdown разделитель всегда `/`.
export function rewriteMovedLinks(text, fromDir, toDir) {
  return mapLinks(text, (target) => {
    const abs = path.posix.normalize(path.posix.join(fromDir, target));
    const next = path.posix.relative(toDir, abs);
    return next === target ? null : next;
  });
}

// Ссылки СОСЕДЕЙ на переехавший файл: правится только та, чья цель — сам переехавший файл.
export function rewriteIncomingLinks(text, fileDir, oldPath, newPath) {
  return mapLinks(text, (target) => {
    const abs = path.posix.normalize(path.posix.join(fileDir, target));
    if (abs !== oldPath) return null;
    return path.posix.relative(fileDir, newPath);
  });
}
