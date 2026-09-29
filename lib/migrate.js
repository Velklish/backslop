// Миграция формата файлов проекта на версию инструмента. Новая миграция — запись в
// MIGRATIONS с версией, начиная с которой она нужна, и функцией, которая переписывает файлы.
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { LANGS, loadProject, parseCli, pinRe, pinSep, projectName, saveConfig } from './config.js';
import { LEGACY_README_LINES, LEGACY_ROADMAP } from './legacy-roadmap.js';
import { linkGateFiles } from './lint.js';
import { normalizeHrefTarget, relativeLinks, repoPrefix, splitHref } from './links.js';
import { logFile } from './log.js';
import { symlinkComponent } from './mdwalk.js';
import { renderProjectTemplate } from './templates.js';
import { CliError, escapeRe, git, gitCause, info, insideRepo, ok, parseCommandArgs, readText, toPosix, warn, writeText } from './util.js';
import { TOOL_VERSION, compareVersions, stampNewerHead } from './version.js';
import { tr } from './i18n.js';

// [{ since: 'X.Y.Z', title: { ru, en }, plan?, report?, run(project, plan) }] apply to a project
// stamped below `since`; `plan(project, rules)` runs for every due entry before the first write.
export const MIGRATIONS = [
  {
    since: '0.10.0',
    title: { ru: 'журнал закрытых docs/archive/LOG.md', en: 'closed task journal docs/archive/LOG.md' },
    // Заводит пустой журнал и больше ничего: апгрейд не сносит архив молча, свёртка — отдельным
    // ходом `fold` (ADR-044).
    run({ cfg, dirs }) {
      const file = logFile(dirs);
      if (existsSync(file)) return;
      writeText(file, renderProjectTemplate(cfg, 'docs/archive/LOG.md', { cli: cfg.cli, prefix: cfg.prefix }));
    },
  },
  {
    since: '0.12.0',
    title: { ru: 'docs/ROADMAP.md уходит из раскладки', en: 'docs/ROADMAP.md leaves the layout' },
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
    throw new CliError(tr(cfg.lang,
      `${dirty.join(', ')}: незакоммиченная правка — migrate удалил бы или поправил файл и стёр её без следа в истории; закоммить или откати правку, затем повтори`,
      `${dirty.join(', ')}: uncommitted edit — migrate would delete or edit the file and erase it with no trace in history; commit or revert the edit, then retry`));
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
  const noGit = plan.noGit ? tr(cfg.lang, ' — git нет, незакоммиченных правок проверить нечем', ' — no git, uncommitted edits could not be checked') : '';
  for (const { out, link } of plan.links) {
    warn(tr(cfg.lang,
      `${out}: путь идёт через symlink ${link} — файл не тронут, запись ушла бы за ссылку`,
      `${out}: the path goes through the symlink ${link} — file left alone, the write would land behind the link`));
  }
  if (plan.kept) {
    const { out, differs, linkers } = plan.kept;
    const why = { ru: [], en: [] };
    if (differs) {
      why.ru.push('отличается от шаблона прежних версий');
      why.en.push('differs from the template of earlier versions');
    }
    if (linkers.length) {
      why.ru.push(`на него ссылаются ${linkers.join(', ')}`);
      why.en.push(`is still linked from ${linkers.join(', ')}`);
    }
    warn(tr(cfg.lang,
      `${out}: оставлен — ${why.ru.join(' и ')}; удали его сам или держи как проектный документ`,
      `${out}: kept — ${why.en.join(' and ')}; delete it yourself or keep it as project content`));
  }
  if (plan.dangling) {
    const { out, linkers } = plan.dangling;
    warn(tr(cfg.lang,
      `${out}: файла нет, а на него ещё ссылаются ${linkers.join(', ')} — поправь или сними эти ссылки`,
      `${out}: the file is gone, yet ${linkers.join(', ')} still link it — fix or remove those links`));
  }
  if (plan.remove) {
    info(tr(cfg.lang,
      `${dry ? 'удалить' : 'удалён'} ${plan.remove.out}: совпадает с шаблоном прежних версий, ссылок на него не осталось${mark}${noGit}`,
      `${dry ? 'would delete' : 'deleted'} ${plan.remove.out}: equals the template of earlier versions and nothing links it${mark}${noGit}`));
  }
  if (plan.edit) {
    info(tr(cfg.lang,
      `${dry ? 'поправить' : 'поправлен'} ${plan.edit.out}: сняты строки со ссылкой на ROADMAP.md${mark}${noGit}`,
      `${dry ? 'would edit' : 'edited'} ${plan.edit.out}: the ROADMAP.md link lines removed${mark}${noGit}`));
  }
}

// The rules pair belongs to the tool: below its version migrate redraws it (ADR-048); at its
// version untouched output follows `lang`. The rest of the docs skeleton belongs to the project.
const RULES_DOCS = ['backlog/README.md', 'archive/README.md'];

// План идёт до первой записи: незакоммиченная правка — отказ, путь через symlink — пропуск,
// иначе запись ушла бы за ссылку в чужой файл (прецедент ADR-040).
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
    throw new CliError(tr(cfg.lang,
      `${dirty.join(', ')}: незакоммиченная правка — migrate перерисовал бы файл из шаблона и стёр её без следа в истории; закоммить или откати правку, затем повтори`,
      `${dirty.join(', ')}: uncommitted edit — migrate would rewrite the file from the template and erase it with no trace in history; commit or revert the edit, then retry`));
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
    const head = stampNewerHead(from);
    throw new CliError(tr(cfg.lang, `${head.ru}, назад формат не переводится`, `${head.en}; file formats cannot be migrated backwards`));
  }
  const due = MIGRATIONS.filter((m) => from === null || compareVersions(from, m.since) < 0);
  const sameVersion = from !== null && compareVersions(from, TOOL_VERSION) === 0;
  const rules = planRules(project, sameVersion);
  const plans = new Map(due.filter((m) => m.plan).map((m) => [m, m.plan(project, rules)]));
  if (!due.length) {
    info(tr(cfg.lang, `мигрировать нечего: формат файлов не менялся${from ? ` с v${from}` : ''} до v${TOOL_VERSION}`, `nothing to migrate: file format did not change${from ? ` from v${from}` : ''} through v${TOOL_VERSION}`));
  }
  for (const m of due) {
    info(tr(cfg.lang, `миграция до v${m.since}: ${m.title.ru}${dry ? ' (--dry-run)' : ''}`, `migration through v${m.since}: ${m.title.en}${dry ? ' (--dry-run)' : ''}`));
    if (!dry) await m.run(project, plans.get(m));
    if (m.report) m.report(project, plans.get(m), dry);
  }
  if (rules) {
    for (const out of rules.kept) {
      info(tr(cfg.lang,
        `${out}: не совпадает ни с рендером ${cfg.lang}, ни с рендером ${LANGS.find((lang) => lang !== cfg.lang)} — оставлен до следующего обновления версии`,
        `${out}: matches neither the ${cfg.lang} nor the ${LANGS.find((lang) => lang !== cfg.lang)} render — kept until the next version update`));
    }
    for (const { out, link } of rules.links) {
      warn(tr(cfg.lang,
        `${out}: путь идёт через symlink ${link} — правила не перерисованы, запись ушла бы за ссылку`,
        `${out}: the path goes through the symlink ${link} — rules not rewritten, the write would land behind the link`));
    }
    const names = rules.write.map((w) => w.out).join(', ');
    const noGit = rules.noGit ? tr(cfg.lang, ' — git нет, незакоммиченных правок проверить нечем', ' — no git, uncommitted edits could not be checked') : '';
    if (names || (!rules.links.length && !sameVersion)) {
      info(tr(cfg.lang,
        `правила ведения и архива из шаблона v${TOOL_VERSION}: ${names ? `${dry ? 'перерисовать' : 'перерисованы'} ${names}` : 'уже совпадают'}${dry ? ' (--dry-run)' : ''}${noGit}`,
        `tracking and archive rules from the v${TOOL_VERSION} template: ${names ? `${dry ? 'would rewrite' : 'rewritten'} ${names}` : 'already match'}${dry ? ' (--dry-run)' : ''}${noGit}`));
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
    info(tr(cfg.lang, `штамп версии: ${from ? `v${from}` : 'не было'} → v${TOOL_VERSION}`, `version stamp: ${from ? `v${from}` : 'missing'} → v${TOOL_VERSION}`));
  }
  ok(tr(cfg.lang, `migrate: проект на v${dry ? (from ?? '?') : TOOL_VERSION}`, `migrate: project is on v${dry ? (from ?? '?') : TOOL_VERSION}`));
  return 0;
}
