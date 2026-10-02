// Migration of the project file format to the tool version. A new migration is an entry of
// MIGRATIONS with the version it is needed from and a function that rewrites the files.
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { LANGS, loadProject, parseCli, pinRe, pinSep, projectName, saveConfig } from './config.js';
import { LEGACY_README_LINES, LEGACY_ROADMAP } from './legacy-roadmap.js';
import { normalizeHrefTarget, relativeLinks, repoPrefix, splitHref } from './links.js';
import { logFile } from './log.js';
import { linkGateFiles, symlinkComponent } from './mdwalk.js';
import { renderProjectTemplate } from './templates.js';
import { CliError, escapeRe, git, gitCause, info, insideRepo, ok, parseCommandArgs, readText, toPosix, warn, writeText } from './util.js';
import { TOOL_VERSION, compareVersions, stampNewerHead } from './version.js';
import { msg } from './i18n.js';

// [{ since: 'X.Y.Z', title(lang), plan?, report?, run(project, plan) }] apply to a project
// stamped below `since`; `plan(project, rules)` runs for every due entry before the first write.
export const MIGRATIONS = [
  {
    since: '0.10.0',
    title: (lang) => msg(lang, 'closed task journal docs/archive/LOG.md'),
    // Creates an empty journal and nothing more: an upgrade does not drop the archive silently;
    // folding is a separate step, `fold` (ADR-044).
    run({ cfg, dirs }) {
      const file = logFile(dirs);
      if (existsSync(file)) return;
      writeText(file, renderProjectTemplate(cfg, 'docs/archive/LOG.md', { cli: cfg.cli, prefix: cfg.prefix }));
    },
  },
  {
    since: '0.12.0',
    title: (lang) => msg(lang, 'docs/ROADMAP.md leaves the layout'),
    plan: planRoadmap,
    report: reportRoadmap,
    run(project, plan) {
      if (plan.remove) rmSync(plan.remove.file);
      if (plan.edit) writeText(plan.edit.file, plan.edit.text);
    },
  },
];

// An untouched copy goes with its old docs/README.md lines; an edited or still linked one stays.
// Links count as this run leaves the files: old lines gone, the rules pair redrawn.
function planRoadmap({ root, cfg, dirs }, rules) {
  const vars = { project: projectName(root), cli: cfg.cli };
  const render = (text) => text.replace(/\{\{(project|cli)\}\}/g, (m, key) => vars[key]);
  const docs = toPosix(path.relative(root, dirs.docs));
  const roadmap = { file: path.join(dirs.docs, 'ROADMAP.md'), out: `${docs}/ROADMAP.md` };
  const readme = { file: path.join(dirs.docs, 'README.md'), out: `${docs}/README.md` };
  const plan = { remove: null, edit: null, kept: null, dangling: null, links: [], noGit: false };
  for (const f of [roadmap, readme]) {
    const link = symlinkComponent(root, f.file);
    if (link !== null) plan.links.push({ out: f.out, link });
  }
  if (plan.links.some((l) => l.out === roadmap.out)) return plan;
  const lines = LEGACY_README_LINES[cfg.lang];
  if (!plan.links.length && existsSync(readme.file)) {
    const text = readText(readme.file);
    const next = text.split(/(?<=\n)/).flatMap((line) => {
      const body = line.replace(/\r?\n$/, '');
      if (samePinned(cfg, body, render(lines.intro))) return [render(lines.introNow) + line.slice(body.length)];
      return samePinned(cfg, body, lines.row) ? [] : [line];
    }).join('');
    if (next !== text) plan.edit = { ...readme, text: next };
  }
  const exists = existsSync(roadmap.file);
  if (exists) {
    const differs = !samePinned(cfg, readText(roadmap.file), render(LEGACY_ROADMAP[cfg.lang]));
    const linkers = roadmapLinkers(root, cfg, dirs, roadmap.out, plan.edit, rules);
    if (differs || linkers.length) {
      // The warning names every file that links the kept copy, the untouched old lines included.
      plan.kept = { out: roadmap.out, differs, linkers: roadmapLinkers(root, cfg, dirs, roadmap.out, null, rules) };
      plan.edit = null;
      return plan;
    }
    plan.remove = roadmap;
  } else {
    const linkers = roadmapLinkers(root, cfg, dirs, roadmap.out, plan.edit, rules);
    if (linkers.length) plan.dangling = { out: roadmap.out, linkers };
  }
  const writes = [plan.remove, plan.edit].filter(Boolean);
  if (!writes.length) return plan;
  if (!insideRepo(root, cfg.lang)) {
    plan.noGit = true;
    return plan;
  }
  const dirty = [];
  for (const w of writes) {
    const status = git(root, ['status', '--porcelain', '--', w.out]);
    if (status.status !== 0) throw new CliError(`git status --porcelain -- ${w.out}: ${gitCause(status, cfg.lang)}`);
    if (status.stdout.trim() && !onlyPinMoved(root, cfg, w)) dirty.push(w.out);
  }
  if (dirty.length) {
    throw new CliError(msg(cfg.lang,
      '{dirty}: uncommitted edit — migrate would delete or edit the file and erase it with no trace in history; commit or revert the edit, then retry', { dirty: dirty.join(', ') }));
  }
  return plan;
}

// Files that link the roadmap, over the set lint gate 1 checks: after a delete the gate has nothing
// to say about it; a link in code is not a link. A file this run rewrites is read as written.
function roadmapLinkers(root, cfg, dirs, out, edit, rules) {
  const after = new Map(rules.write.map((w) => [w.out, w.text]));
  if (edit) after.set(edit.out, edit.text);
  const prefix = repoPrefix(root, cfg.lang);
  const target = out.toLowerCase();
  return linkGateFiles(root, dirs).map(([, abs]) => [toPosix(path.relative(root, abs)), abs])
    .filter(([rel, abs]) => rel !== out && relativeLinks(after.get(rel) ?? readText(abs)).some((href) =>
      normalizeHrefTarget(path.posix.dirname(rel), splitHref(href).target, prefix)?.toLowerCase() === target))
    .map(([rel]) => rel).sort();
}

function reportRoadmap({ cfg }, plan, dry) {
  const mark = dry ? ' (--dry-run)' : '';
  const noGit = plan.noGit ? msg(cfg.lang, ' — no git, uncommitted edits could not be checked') : '';
  for (const { out, link } of plan.links) {
    warn(msg(cfg.lang,
      '{out}: the path goes through the symlink {link} — file left alone, the write would land behind the link', { out, link }));
  }
  if (plan.kept) {
    const { out, differs, linkers } = plan.kept;
    const why = [];
    if (differs) why.push(msg(cfg.lang, 'differs from the template of earlier versions'));
    if (linkers.length) why.push(msg(cfg.lang, 'is still linked from {linkers}', { linkers: linkers.join(', ') }));
    warn(msg(cfg.lang,
      '{out}: kept — {why}; delete it yourself or keep it as project content', { out, why: why.join(msg(cfg.lang, ' and ')) }));
  }
  if (plan.dangling) {
    const { out, linkers } = plan.dangling;
    warn(msg(cfg.lang,
      '{out}: the file is gone, yet {linkers} still link it — fix or remove those links', { out, linkers: linkers.join(', ') }));
  }
  if (plan.remove) {
    const params = { out: plan.remove.out, mark, noGit };
    info(dry
      ? msg(cfg.lang, 'would delete {out}: equals the template of earlier versions and nothing links it{mark}{noGit}', params)
      : msg(cfg.lang, 'deleted {out}: equals the template of earlier versions and nothing links it{mark}{noGit}', params));
  }
  if (plan.edit) {
    const params = { out: plan.edit.out, mark, noGit };
    info(dry
      ? msg(cfg.lang, 'would edit {out}: the ROADMAP.md link lines removed{mark}{noGit}', params)
      : msg(cfg.lang, 'edited {out}: the ROADMAP.md link lines removed{mark}{noGit}', params));
  }
}

// The rules pair belongs to the tool: below its version migrate redraws it (ADR-048); at its
// version untouched output follows `lang`. The rest of the docs skeleton belongs to the project.
const RULES_DOCS = ['backlog/README.md', 'archive/README.md'];

// The plan comes before the first write: an uncommitted edit is a refusal, a path through a
// symlink is skipped, or the write would go through the link into a foreign file (ADR-040).
function planRules({ root, cfg, dirs }, sameVersion) {
  const vars = { prefix: cfg.prefix, docs: cfg.docs, cli: cfg.cli, project: projectName(root) };
  const plan = { write: [], links: [], kept: [], noGit: false };
  const other = { ...cfg, lang: LANGS.find((lang) => lang !== cfg.lang) };
  for (const rel of RULES_DOCS) {
    const file = path.join(dirs.docs, ...rel.split('/'));
    const text = renderProjectTemplate(cfg, `docs/${rel}`, vars);
    if (existsSync(file) && readText(file) === text) continue;
    const out = toPosix(path.relative(root, file));
    // At the tool's own version only untouched output is redrawn: pins off, or the other language.
    if (sameVersion) {
      const current = existsSync(file) ? readText(file) : null;
      if (current === null || current.replace(/\r\n/g, '\n') === text) continue;
      if (!samePinned(cfg, current, text) && !samePinned(cfg, current, renderProjectTemplate(other, `docs/${rel}`, vars))) {
        plan.kept.push(out);
        continue;
      }
    }
    const link = symlinkComponent(root, file);
    if (link !== null) plan.links.push({ out, link });
    else plan.write.push({ file, text, out });
  }
  if (!plan.write.length) return plan;
  if (!insideRepo(root, cfg.lang)) {
    plan.noGit = true;
    return plan;
  }
  const dirty = [];
  for (const w of plan.write) {
    const status = git(root, ['status', '--porcelain', '--', w.out]);
    if (status.status !== 0) throw new CliError(`git status --porcelain -- ${w.out}: ${gitCause(status, cfg.lang)}`);
    if (status.stdout.trim() && !onlyPinMoved(root, cfg, w)) dirty.push(w.out);
  }
  if (dirty.length) {
    throw new CliError(msg(cfg.lang,
      '{dirty}: uncommitted edit — migrate would rewrite the file from the template and erase it with no trace in history; commit or revert the edit, then retry', { dirty: dirty.join(', ') }));
  }
  return plan;
}

// An older upgrade moved the pin in the pair before migrate: a file whose only change since HEAD
// is a pin of the cli spec loses nothing when redrawn.
function onlyPinMoved(root, cfg, { file, out }) {
  const form = parseCli(cfg.cli);
  if (form === null || form.pin === null || !existsSync(file)) return false;
  const head = git(root, ['show', `HEAD:./${out}`]);
  return head.status === 0 && samePinned(cfg, head.stdout, readFileSync(file, 'utf8'));
}

// Equal once CRLF reads as LF and the cli spec — pinned or floating, a whole word — as the cli pin.
function samePinned(cfg, a, b) {
  const form = parseCli(cfg.cli);
  if (!form?.pin) return a.replace(/\r\n/g, '\n') === b.replace(/\r\n/g, '\n');
  const pin = `${form.spec}${pinSep(form)}${form.pin}`;
  const floating = new RegExp(`(?<![\\w./:@-])${escapeRe(form.spec)}(?:@latest)?(?![\\w./:@#-])`, 'g');
  const norm = (text) => text.replace(/\r\n/g, '\n').replace(pinRe(form), pin).replace(floating, pin);
  return norm(a) === norm(b);
}

export async function run(argv, { cwd, lang }) {
  const { values } = parseCommandArgs(argv, { 'dry-run': { type: 'boolean' } }, { positionals: 0, lang });
  const dry = values['dry-run'] === true;
  const project = loadProject(cwd);
  const { root, cfg } = project;
  const from = cfg.version ?? null;
  if (from && compareVersions(from, TOOL_VERSION) > 0) {
    throw new CliError(msg(cfg.lang, '{head}; file formats cannot be migrated backwards', { head: stampNewerHead(from, cfg.lang) }));
  }
  const due = MIGRATIONS.filter((m) => from === null || compareVersions(from, m.since) < 0);
  const sameVersion = from !== null && compareVersions(from, TOOL_VERSION) === 0;
  const rules = planRules(project, sameVersion);
  const plans = new Map(due.filter((m) => m.plan).map((m) => [m, m.plan(project, rules)]));
  if (!due.length) {
    info(from
      ? msg(cfg.lang, 'nothing to migrate: file format did not change from v{from} through v{version}', { from, version: TOOL_VERSION })
      : msg(cfg.lang, 'nothing to migrate: file format did not change through v{version}', { version: TOOL_VERSION }));
  }
  for (const m of due) {
    info(msg(cfg.lang, 'migration through v{since}: {title}{mark}', { since: m.since, title: m.title(cfg.lang), mark: dry ? ' (--dry-run)' : '' }));
    if (!dry) await m.run(project, plans.get(m));
    if (m.report) m.report(project, plans.get(m), dry);
  }
  if (rules) {
    for (const out of rules.kept) {
      info(msg(cfg.lang,
        '{out}: matches neither the {lang} nor the {other} render — kept until the next version update', { out, lang: cfg.lang, other: LANGS.find((lang) => lang !== cfg.lang) }));
    }
    for (const { out, link } of rules.links) {
      warn(msg(cfg.lang,
        '{out}: the path goes through the symlink {link} — rules not rewritten, the write would land behind the link', { out, link }));
    }
    const names = rules.write.map((w) => w.out).join(', ');
    const noGit = rules.noGit ? msg(cfg.lang, ' — no git, uncommitted edits could not be checked') : '';
    if (names || (!rules.links.length && !sameVersion)) {
      let what = msg(cfg.lang, 'already match');
      if (names) what = dry ? msg(cfg.lang, 'would rewrite {names}', { names }) : msg(cfg.lang, 'rewritten {names}', { names });
      info(msg(cfg.lang,
        'tracking and archive rules from the v{version} template: {what}{mark}{noGit}', { version: TOOL_VERSION, what, mark: dry ? ' (--dry-run)' : '', noGit }));
    }
    if (!dry) {
      for (const { file, text } of rules.write) {
        writeText(file, text);
      }
    }
  }
  if (!dry && from !== TOOL_VERSION) {
    cfg.version = TOOL_VERSION;
    saveConfig(root, cfg);
    info(from
      ? msg(cfg.lang, 'version stamp: v{from} → v{version}', { from, version: TOOL_VERSION })
      : msg(cfg.lang, 'version stamp: missing → v{version}', { version: TOOL_VERSION }));
  }
  ok(msg(cfg.lang, 'migrate: project is on v{version}', { version: dry ? (from ?? '?') : TOOL_VERSION }));
  return 0;
}
