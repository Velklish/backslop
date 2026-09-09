// Обход markdown репозитория — один на гейты `lint` и на команды, которые правят ссылки
// по тому же множеству (`archive`). Правила пропуска здесь, а не в каждом потребителе:
// разойдясь, два обхода дали бы гейт, зелёный по одному множеству файлов, и правку по другому.
import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { isOwnedAdapterFile } from './adapter-ownership.js';

// Чужой код и служебное: сюда обход не заходит никогда.
export const SKIP_DIRS = new Set(['.git', 'node_modules']);

// Рабочие копии агентов: субагент Claude Code в изоляции кладёт в `.claude/worktrees/<имя>`
// полный чекаут своей ветки, и битая ссылка чужой недописанной ветки красила бы `lint`
// в основном дереве. Путём, а не именем: «worktrees» встречается и осмысленно.
export const SKIP_RELS = new Set(['.claude/worktrees']);

function statOrNull(abs) {
  try {
    return statSync(abs);
  } catch {
    return null;
  }
}

function realOrNull(abs) {
  try {
    return realpathSync(abs);
  } catch {
    return null;
  }
}

// Файлы с заданными расширениями вглубь парами [путь от корня в posix-форме, абсолютный путь].
// Симлинк — не isFile() и не isDirectory(): идём по ссылке, ENOENT/ELOOP/EACCES пропускаем;
// от петли держит набор пройденных настоящих путей.
export function srcFiles(dir, rel, exts, out = [], seen = null) {
  if (!existsSync(dir)) return out;
  if (seen === null) {
    seen = new Set();
    const real = realOrNull(dir);
    if (real) seen.add(real);
  }
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (SKIP_DIRS.has(e.name) || SKIP_RELS.has(childRel)) continue;
    const child = path.join(dir, e.name);
    const st = e.isSymbolicLink() ? statOrNull(child) : e;
    if (!st) continue;
    if (st.isDirectory()) {
      const real = realOrNull(child);
      if (!real || seen.has(real)) continue;
      seen.add(real);
      srcFiles(child, childRel, exts, out, seen);
    } else if (st.isFile() && exts.some((x) => e.name.endsWith(x))) {
      out.push([childRel, child]);
    }
  }
  return out;
}

// Все .md каталога вглубь парами [путь от корня, абсолютный путь].
export function mdFiles(dir, rel, out = []) {
  return srcFiles(dir, rel, ['.md'], out);
}

// Весь markdown репозитория: файлы корня плюс каждый каталог вглубь, кроме чужого и служебного.
export function repoMarkdown(root) {
  return srcFiles(root, '', ['.md', '.mdc']).filter(([rel, file]) => !isOwnedAdapterFile(rel, file));
}

// Живой markdown проекта: `docs/**` и корневые `*.md`, без записей, которые описывают момент,
// а не команду для запуска, — `CHANGELOG.md`, ADR, архив задач и сами карточки задач: постановка
// цитирует версию как улику того, что было, и переписывать её нельзя. Тем же множеством ходят
// перепись пина в `upgrade` и предупреждение о нём в `lint`: разойдясь, они дали бы тихое
// предупреждение на файле, который команда правит, и наоборот.
export function liveMarkdown(root, docs, prefix) {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const archive = new RegExp(`^${esc(docs)}/archive/${esc(prefix)}-\\d`);
  const card = new RegExp(`^${esc(prefix)}-\\d+(?:\\.\\d+)?-.+\\.md$`);
  const files = mdFiles(path.join(root, docs), docs);
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (e.isFile() && e.name.endsWith('.md')) files.push([e.name, path.join(root, e.name)]);
  }
  return files.filter(([rel]) => rel !== 'CHANGELOG.md'
    && !rel.startsWith(`${docs}/adr/`)
    && !archive.test(rel)
    && !card.test(path.posix.basename(rel)));
}
