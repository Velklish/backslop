// The markdown walk of the repository: one for the `lint` gates and for the commands that fix
// links (`archive`): two walks would give the gate one set of files and the fix another.
import { lstatSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { isOwnedAdapterFile } from './adapter-ownership.js';
import { ADAPTER_ROOTS, TOOLS } from './adapters-registry.js';
import { pinRe, pinTailRe, projectHintsOrNull } from './config.js';
import { msg } from './i18n.js';
import { LOG_ENTRY_HINT, LOG_FILE } from './log.js';
import { CliError, escapeRe, readText, realpathOrNull, statOrNull, toPosix } from './util.js';
import { splitLines } from './text.js';

// Foreign code and service directories: the walk never enters them.
export const SKIP_DIRS = new Set(['.git', 'node_modules']);

// Subagent working copies (`.claude/worktrees/<name>`): a broken link of another branch would turn
// `lint` red in the main tree. By path, not by name: "worktrees" also occurs meaningfully.
export const SKIP_RELS = new Set(['.claude/worktrees']);

// The first path component under `base` that is a symlink, in posix form from `base`; null when
// there are no links. A missing component and a file on a component (ENOTDIR) are not links.
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

// A directory the walk cannot list: path and code, unless worded.
export class UnreadableDir extends CliError {
  constructor(dir, code, message = `${dir}: ${code}`) {
    super(message);
    this.dir = dir;
    this.code = code;
  }
}

export function readDirEntries(dir, options) {
  try {
    return readdirSync(dir, options);
  } catch (err) {
    if (err.code === 'EACCES' || err.code === 'EPERM') throw new UnreadableDir(dir, err.code);
    throw err;
  }
}

// The `lint` wording for an unreadable directory; `what` says what the command cannot do.
export function wordUnreadable(root, lang, what, walk) {
  try {
    return walk();
  } catch (e) {
    if (!(e instanceof UnreadableDir)) throw e;
    const rel = toPosix(path.relative(root, e.dir)) || '.';
    throw new UnreadableDir(e.dir, e.code, msg(lang,
      '{rel}: the directory is not readable ({code}) — {what}; restore read access or move it out of the project', { rel, code: e.code, what }));
  }
}

// Files in depth as [posix path from the root, absolute] pairs; symlinks are followed on purpose,
// real paths stop a loop. `skip` is a bound before reading: else a linked dir would take `seen`.
export function srcFiles(dir, rel, exts, out = [], seen = null, skip = SKIP_RELS) {
  if (!statOrNull(dir)?.isDirectory()) return out;
  if (seen === null) {
    seen = new Set();
    const real = realpathOrNull(dir);
    if (real) seen.add(real);
  }
  for (const e of readDirEntries(dir, { withFileTypes: true })) {
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

// All .md of a directory in depth as pairs [path from the root, absolute path].
export function mdFiles(dir, rel) {
  return srcFiles(dir, rel, ['.md']);
}

// A harness root reached through a link on any component is a bound of the walk: `mv` and `archive`
// would edit markdown outside the project (ADR-040). A plain symlink to a project dir is walked.
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

// The files gate 1 checks; migrate counts links to a copy it would delete over the same set.
export function linkGateFiles(root, dirs) {
  const files = [...mdFiles(dirs.docs, '')];
  files.push(...rootMarkdown(root, files));
  return files;
}

// A directory entry by its target when it is a symlink resolving inside the project; a symlink
// leading outside is not followed and stays itself.
export function resolvedEntry(root, dir, e) {
  if (!e.isSymbolicLink()) return e;
  const abs = path.join(dir, e.name);
  return (insideProject(root, abs) && statOrNull(abs)) || e;
}

export function insideProject(root, abs) {
  const real = realpathOrNull(abs);
  const base = realpathOrNull(root);
  if (!real || !base) return false;
  const rel = path.relative(base, real);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

// All markdown of the repository: root files plus every directory in depth, except foreign and
// service ones.
export function repoMarkdown(root) {
  const lang = projectHintsOrNull(root)?.lang ?? 'ru';
  return wordUnreadable(root, lang, msg(lang, 'links in it cannot be updated'),
    () => srcFiles(root, '', ['.md', '.mdc'], [], null, linkedHarnessRoots(root)))
    .filter(([rel, file]) => !isOwnedAdapterFile(rel, file));
}

// Live markdown: `docs/**` and root `*.md` without records of a moment — CHANGELOG, ADRs, the
// archive and task cards: a version in them is evidence of what was and is not rewritten.
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

// Live files with an executable pin: liveMarkdown, every package.json, the known CI files of the
// root and of CI directories — they describe the current run and move together (ADR-048).
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

// Every stale pin of the live files, read-only: a `pinRe` match off `form.pin` or a pin with a
// tail, outside a journal entry. `lint` reports these; `upgrade` rewrites only the first kind.
export function stalePins(root, docs, prefix, form, read = readText) {
  const re = pinRe(form);
  const tailed = pinTailRe(form);
  const out = [];
  for (const [rel, abs] of livePinFiles(root, docs, prefix)) {
    splitLines(read(abs)).forEach((line, i) => {
      if (isJournalLine(rel, docs, line)) return;
      for (const match of line.matchAll(re)) {
        if (match[1] !== form.pin) out.push({ abs, lineNo: i + 1, match });
      }
      for (const match of line.matchAll(tailed)) out.push({ abs, lineNo: i + 1, match, suffixed: true });
    });
  }
  return out;
}
