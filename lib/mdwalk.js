// Обход markdown репозитория — один на гейты `lint` и команды, что правят ссылки (`archive`):
// разойдясь, два обхода дали бы гейт по одному множеству файлов и правку по другому.
import { existsSync, lstatSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { isOwnedAdapterFile } from './adapter-ownership.js';
import { ADAPTER_ROOTS, TOOLS } from './adapters-registry.js';
import { LOG_ENTRY_HINT, LOG_FILE } from './log.js';
import { escapeRe, realpathOrNull, statOrNull, toPosix } from './util.js';

// Чужой код и служебное: сюда обход не заходит никогда.
export const SKIP_DIRS = new Set(['.git', 'node_modules']);

// Рабочие копии субагентов (`.claude/worktrees/<имя>`): битая ссылка чужой ветки красила бы `lint`
// основного дерева. Путём, а не именем: «worktrees» встречается и осмысленно.
export const SKIP_RELS = new Set(['.claude/worktrees']);

// Первая компонента пути под `base`, оказавшаяся symlink, — в posix-форме от `base`; null,
// когда ссылок нет. Отсутствующая компонента и файл на компоненте (ENOTDIR) ссылкой не считаются.
export function symlinkComponent(base, target) {
  let current = base;
  for (const part of path.relative(base, target).split(path.sep)) {
    current = path.join(current, part);
    try {
      if (lstatSync(current).isSymbolicLink()) return toPosix(path.relative(base, current));
    } catch (e) {
      if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') throw e;
    }
  }
  return null;
}

// Файлы вглубь парами [posix-путь от корня, абсолютный]; по symlink идём намеренно, от петли держит
// набор настоящих путей. `skip` — граница до чтения: иначе каталог за ссылкой занял бы `seen`.
export function srcFiles(dir, rel, exts, out = [], seen = null, skip = SKIP_RELS) {
  if (!existsSync(dir)) return out;
  if (seen === null) {
    seen = new Set();
    const real = realpathOrNull(dir);
    if (real) seen.add(real);
  }
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (SKIP_DIRS.has(e.name) || skip.has(childRel)) continue;
    const child = path.join(dir, e.name);
    const st = e.isSymbolicLink() ? statOrNull(child) : e;
    if (!st) continue;
    if (st.isDirectory()) {
      const real = realpathOrNull(child);
      if (!real || seen.has(real)) continue;
      seen.add(real);
      srcFiles(child, childRel, exts, out, seen, skip);
    } else if (st.isFile() && exts.some((x) => e.name.toLowerCase().endsWith(x))) {
      out.push([childRel, child]);
    }
  }
  return out;
}

// Все .md каталога вглубь парами [путь от корня, абсолютный путь].
export function mdFiles(dir, rel) {
  return srcFiles(dir, rel, ['.md']);
}

// Корень harness ссылкой на любой компоненте — граница обхода: `mv` и `archive` правили бы markdown
// за пределами проекта (ADR-016). Обычный symlink на каталог внутри проекта проходится.
function linkedHarnessRoots(root) {
  const out = new Set(SKIP_RELS);
  for (const id of TOOLS) {
    const link = symlinkComponent(path.resolve(root), path.resolve(path.join(root, ...ADAPTER_ROOTS[id])));
    if (link !== null) out.add(link);
  }
  return out;
}

// Project-root `*.md` as [name, abs]. A symlink counts when it resolves to a regular file in the
// project that no regular root file and no path of `walked` already covers: the non-link path wins.
export function rootMarkdown(root, walked = []) {
  const entries = readdirSync(root, { withFileTypes: true }).filter((e) => e.name.toLowerCase().endsWith('.md'));
  const seen = new Set();
  if (entries.some((e) => e.isSymbolicLink())) {
    for (const [, abs] of walked) seen.add(realpathOrNull(abs));
    for (const e of entries) if (e.isFile()) seen.add(realpathOrNull(path.join(root, e.name)));
  }
  const out = [];
  for (const e of entries) {
    const abs = path.join(root, e.name);
    if (e.isSymbolicLink()) {
      const real = insideProject(root, abs) && statOrNull(abs)?.isFile() ? realpathOrNull(abs) : null;
      if (real === null || seen.has(real)) continue;
      seen.add(real);
    } else if (!e.isFile()) {
      continue;
    }
    out.push([e.name, abs]);
  }
  return out;
}

// A directory entry by its target when it is a symlink resolving inside the project; a symlink
// leading outside is not followed and stays itself.
export function resolvedEntry(root, dir, e) {
  if (!e.isSymbolicLink()) return e;
  const abs = path.join(dir, e.name);
  return (insideProject(root, abs) && statOrNull(abs)) || e;
}

function insideProject(root, abs) {
  const real = realpathOrNull(abs);
  const base = realpathOrNull(root);
  if (!real || !base) return false;
  const rel = path.relative(base, real);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

// Весь markdown репозитория: файлы корня плюс каждый каталог вглубь, кроме чужого и служебного.
export function repoMarkdown(root) {
  return srcFiles(root, '', ['.md', '.mdc'], [], null, linkedHarnessRoots(root))
    .filter(([rel, file]) => !isOwnedAdapterFile(rel, file));
}

// Живой markdown: `docs/**` и корневые `*.md` без записей о моменте — CHANGELOG, ADR, архива и
// карточек задач: версия в них — улика того, что было, и переписывать её нельзя.
function liveMarkdown(root, docs, prefix) {
  const archive = new RegExp(`^${escapeRe(docs)}/archive/${escapeRe(prefix)}-\\d`);
  const card = new RegExp(`^${escapeRe(prefix)}-\\d+(?:\\.\\d+)?-.+\\.[Mm][Dd]$`);
  const files = mdFiles(path.join(root, docs), docs);
  files.push(...rootMarkdown(root, files));
  return files.filter(([rel]) => rel.toLowerCase() !== 'changelog.md'
    && !rel.startsWith(`${docs}/adr/`)
    && !archive.test(rel)
    && !card.test(path.posix.basename(rel)));
}

// Живые файлы с исполняемым пином: liveMarkdown, каждый package.json, известные CI-файлы корня и
// CI-каталогов — они описывают текущий запуск и поднимаются одной командой (ADR-019).
const CI_ROOT_FILES = new Set([
  '.gitlab-ci.yml', '.gitlab-ci.yaml', '.travis.yml', '.circleci.yml',
  'azure-pipelines.yml', 'azure-pipelines.yaml', 'bitbucket-pipelines.yml',
  '.drone.yml', 'appveyor.yml', 'buildspec.yml', 'Jenkinsfile',
]);
const CI_DIRS = [
  ['.github/workflows', ['.yml', '.yaml']],
  ['.github/actions', ['.yml', '.yaml']],
  ['.circleci', ['.yml', '.yaml']],
  ['.buildkite', ['.yml', '.yaml']],
];

// A journal entry of `<docs>/archive/LOG.md` records a moment, its header stays live: one rule for
// the pin gate, the `upgrade` rewrite and its stale-pin check.
export function isJournalLine(rel, docs, line) {
  return rel === `${docs}/archive/${LOG_FILE}` && LOG_ENTRY_HINT.test(line);
}

export function livePinFiles(root, docs, prefix) {
  const files = liveMarkdown(root, docs, prefix);
  // exact package.json basename; suffixes such as old-package.json are historical or fixtures.
  for (const file of srcFiles(root, '', ['.json'], [], null, linkedHarnessRoots(root))) {
    if (path.posix.basename(file[0]) === 'package.json') files.push(file);
  }
  for (const name of CI_ROOT_FILES) {
    const abs = path.join(root, name);
    if (statOrNull(abs)?.isFile()) files.push([name, abs]);
  }
  for (const [dir, exts] of CI_DIRS) {
    for (const file of srcFiles(path.join(root, dir), dir, exts)) files.push(file);
  }
  return files;
}
