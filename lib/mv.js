// Смена статуса: `git mv` между каталогами плюс поля статуса, «Прежний порядок» и `--restore`.
// Контракт пакета, мест и отказов — docs/reference/02-cli.md, строка `mv`; ADR-049.
import { lstatSync } from 'node:fs';
import path from 'node:path';
import { STATUSES, expectDirectory, loadProject } from './config.js';
import { formatId } from './ids.js';
import {
  FIELD_AREA, FIELD_COST, FIELD_ORDER, FIELD_PREV_ORDER, FIELD_TAKEN, SECTION_CHECKS, SECTION_CONTEXT, SECTION_DEFERRED, SECTION_EVIDENCE, SECTION_OUT, SECTION_WORK,
  evidenceAssumption, fieldName, findFlatTask, findTask, parseId, placeInQueue, getField, orderOf, queueOrder, relocateTask, removeField, sameId, scanTasks,
  blankPlaceholderCells, isPlaceholderLine, isTodoPlaceholder, sectionBody, sectionName, sections, appendSection, setField,
} from './tasks.js';
import { eolOf, splitLines } from './text.js';
import { CliError, info, ok, parseCommandArgs, readText, today, toPosix, writeText } from './util.js';
import { msg } from './i18n.js';

const names = (key) => new Set([sectionName(key, 'ru'), sectionName(key, 'en')]);
const STATEMENT = new Set([...names(SECTION_WORK), ...names(SECTION_OUT), ...names(SECTION_CHECKS), ...names(SECTION_CONTEXT)]);

// Форма minor/ из карточки формы task.md (ADR-047): заглушки постановки снимаются, написанный текст
// остаётся, «Контекст» без «Улики» становится ею, `--evidence` пишет улику, как `new --minor`.
function minorForm(text, evidence, lang) {
  let lines = splitLines(text);
  const cut = (i) => lines.splice(i, !lines[i - 1]?.trim() && !lines[i + 1]?.trim() ? 2 : 1);
  const current = () => {
    const { clean, list } = sections(lines.join('\n'));
    list.forEach((sec) => {
      sec.stubs = [];
      sec.rows = [];
      sec.filled = false;
      for (let i = sec.start + 1; i < sec.end; i += 1) {
        const placeholder = clean[i].trim() && isPlaceholderLine(clean[i]);
        if (placeholder && blankPlaceholderCells(lines[i]) === null) sec.stubs.push(i);
        else {
          if (placeholder) sec.rows.push(i);
          if (lines[i].trim()) sec.filled = true;
        }
      }
    });
    return list;
  };
  const dropped = [];
  for (const sec of current().reverse()) {
    if (!STATEMENT.has(sec.name) || sec.filled) continue;
    lines.splice(sec.start, sec.end - sec.start);
    dropped.unshift(sec.name);
  }
  const evidenceNames = names(SECTION_EVIDENCE);
  let section = current().find((sec) => evidenceNames.has(sec.name));
  const context = current().find((sec) => names(SECTION_CONTEXT).has(sec.name));
  const renamed = !section && Boolean(context);
  if (renamed) lines[context.start] = `## ${sectionName(SECTION_EVIDENCE, context.name === sectionName(SECTION_CONTEXT, 'en') ? 'en' : 'ru')}`;
  const blankRows = (sec) => sec.rows.forEach((i) => { lines[i] = blankPlaceholderCells(lines[i]); });
  for (const sec of current().reverse()) {
    if (evidenceNames.has(sec.name)) continue;
    blankRows(sec);
    for (const i of [...sec.stubs].reverse()) cut(i);
  }
  section = current().find((sec) => evidenceNames.has(sec.name));
  if (evidence) {
    if (section) blankRows(section);
    const line = msg(lang, 'Evidence: {evidence}', { evidence });
    const isRow = (i) => /^(?:>\s*)?\|/.test(lines[i].trim());
    const keep = section?.stubs.find((i) => !isRow(i));
    if (keep !== undefined) {
      lines[keep] = line;
      for (const i of section.stubs.filter((k) => k !== keep).reverse()) cut(i);
    } else if (section) {
      for (const i of [...section.stubs].reverse()) cut(i);
      section = current().find((sec) => evidenceNames.has(sec.name));
      let at = section.end;
      while (at > section.start + 1 && !lines[at - 1].trim()) at -= 1;
      lines.splice(at, 0, '', line);
    } else {
      lines = splitLines(appendSection(lines.join('\n').trimEnd(), SECTION_EVIDENCE, line, lang));
    }
    section = current().find((sec) => evidenceNames.has(sec.name));
  }
  while (lines.length > 1 && !lines.at(-1).trim() && !lines.at(-2).trim()) lines.pop();
  return { text: lines.join(eolOf(text)), ok: Boolean(section?.filled && !section.stubs.length && !section.rows.length), dropped, renamed };
}

const evidenceRequired = (lang, cli, ids) => [
  msg(lang, '{ids}: no evidence for minor/ — the “Evidence” section is missing, empty, or a [TODO] placeholder, and the entry goes to a batch without review.', { ids: ids.join(', ') }),
  msg(lang, 'Give it with the flag: {cli} mv N minor --evidence "…" — a path with a line, a command with its output and exit code, or a measurement with a number.', { cli }),
  evidenceAssumption(lang),
].join('\n');

// Резолв одного номера и все отказы, которые видны до переноса.
function resolve(project, tasks, rawId, target, positioned) {
  const { cfg } = project;
  const id = parseId(rawId, cfg.prefix, cfg.lang);
  // Файл плоского бэклога (прямо в docs/backlog/) — тоже задача для переезда: миграция.
  const task = findTask(tasks, id, cfg.lang) ?? findFlatTask(project, id);
  if (!task) throw new CliError(msg(cfg.lang, 'task {id} was not found in any status directory', { id: formatId(cfg.prefix, id.num, id.sub) }));
  if (task.status === 'archive') throw new CliError(msg(cfg.lang, '{id} is archived; restore a closed task manually and deliberately', { id: task.id }));
  const reorder = task.status === 'queue' && target === 'queue';
  if (task.status === target && !reorder) throw new CliError(msg(cfg.lang, '{id} is already in {target}/', { id: task.id, target }));
  if (reorder && !positioned) throw new CliError(msg(cfg.lang, '{id} is already in queue/; give a position: --top, --after M or --restore', { id: task.id }));
  if (!reorder) {
    expectDirectory(project.root, project.dirs.statusDir[target], cfg.lang);
    const to = path.join(project.dirs.statusDir[target], path.basename(task.file));
    const rel = toPosix(path.relative(project.root, to));
    if (lexists(to)) throw new CliError(msg(cfg.lang, '{rel} already exists — {id} cannot move onto it', { rel, id: task.id }));
  }
  return task;
}

function lexists(file) {
  try { lstatSync(file); return true; } catch { return false; }
}

// Ранги ушедших из очереди. Поля нет или оно не целое — отказ на весь вызов до первого переноса,
// поимённо: молча встать в конец значило бы соврать про восстановленное место.
function restoreRanks(planned, cfg) {
  const label = fieldName(FIELD_PREV_ORDER, cfg.lang);
  const ranks = new Map();
  const missing = [];
  const broken = [];
  for (const task of planned) {
    const rank = orderOf(readText(task.file), FIELD_PREV_ORDER);
    if (rank === null) missing.push(task.id);
    else if (!Number.isInteger(rank)) broken.push(task.id);
    else ranks.set(task.file, rank);
  }
  const parts = [];
  if (missing.length) parts.push(msg(cfg.lang, 'no “{label}” field on {missing} — no position was saved', { label, missing: missing.join(', ') }));
  if (broken.length) parts.push(msg(cfg.lang, '“{label}” on {broken} is not an integer', { label, broken: broken.join(', ') }));
  if (parts.length) throw new CliError(`${parts.join('; ')}${msg(cfg.lang, '; use --top or --after M')}`);
  return ranks;
}

// Перенос одного номера. Очередь читается заново на каждый: соседи по пакету уже заняли
// свои места, и общий снимок выдал бы им один «Порядок».
function moveOne(project, task, target, values, saved, before, evidence) {
  const { root, cfg, dirs } = project;
  const tasks = scanTasks(project);
  const reorder = task.status === 'queue' && target === 'queue';

  let placed = null;
  if (target === 'queue') {
    const after = values.after === undefined ? null : parseId(values.after, cfg.prefix, cfg.lang);
    if (after && sameId(after, task)) throw new CliError(msg(cfg.lang, '--after {id}: a task cannot follow itself', { id: task.id }));
    const rows = queueOrder(tasks.filter((t) => t.file !== task.file));
    placed = placeInQueue(rows, { top: Boolean(values.top), after, rank: saved, before }, cfg.prefix, cfg.lang);
  }

  const to = reorder ? task.file : path.join(dirs.statusDir[target], path.basename(task.file));
  const newRel = toPosix(path.relative(root, to));

  // Исходящие ссылки — от старого каталога к новому, как при archive: из плоского docs/backlog/
  // растёт глубина, а ссылка на соседа из прежнего каталога получает `../<статус>/`.
  const changed = reorder ? [] : relocateTask(project, task, newRel);
  let text = readText(to);
  const outgoingChanged = changed.includes(newRel);
  // При возвращении в queue/ «Прежний порядок» стирается — место занял активный «Порядок». Без
  // `--restore` сохранённое место теряется навсегда, поэтому об этом говорится вслух.
  const leaving = task.status === 'queue' ? orderOf(text) : null;
  const dropped = target === 'queue' && !values.restore ? orderOf(text, FIELD_PREV_ORDER) : null;
  if (target === 'queue') text = removeField(text, FIELD_PREV_ORDER);
  else if (Number.isInteger(leaving)) text = setField(text, FIELD_PREV_ORDER, String(leaving), cfg.lang);
  if (placed) text = setField(text, FIELD_ORDER, String(placed.rank), cfg.lang);
  else text = removeField(text, FIELD_ORDER);
  if (target === 'active') text = setField(text, FIELD_TAKEN, today(), cfg.lang);
  else text = removeField(text, FIELD_TAKEN);
  const shaped = target === 'minor' ? minorForm(text, evidence, cfg.lang) : null;
  if (shaped) text = shaped.text;
  const costAdded = target === 'minor' && getField(text, FIELD_COST) === null;
  if (costAdded) text = setField(text, FIELD_COST, 'minor', cfg.lang);
  // Заглушка области от `new` в minor/ стала бы ошибкой гейта заглушек,
  // а область там необязательна.
  if (target === 'minor' && isTodoPlaceholder(getField(text, FIELD_AREA) ?? '')) text = setField(text, FIELD_AREA, '', cfg.lang);
  let deferredSection = null;
  if (target === 'deferred' && sectionBody(text, SECTION_DEFERRED) === null) {
    deferredSection = 'added';
    const deferred = [
      msg(cfg.lang, '- **Deferred:** {date}', { date: today() }),
      msg(cfg.lang, '- **Reason:** [TODO]'),
      msg(cfg.lang, '- **Return condition:** [TODO: what must happen before this returns to the queue]'),
    ];
    text = appendSection(text, SECTION_DEFERRED, deferred.join('\n'), cfg.lang);
  } else if (target === 'deferred') {
    deferredSection = 'exists';
  }
  writeText(to, text);
  for (const [otherFile, rank] of placed?.renumbered ?? []) {
    writeText(otherFile, setField(readText(otherFile), FIELD_ORDER, String(rank), cfg.lang));
  }

  const notes = [];
  if (saved !== null && placed.rank === saved) notes.push(msg(cfg.lang, '“{field}” {saved} restored', { field: fieldName(FIELD_ORDER, cfg.lang), saved }));
  else if (placed?.bounded) notes.push(msg(cfg.lang, 'saved position {saved} falls behind {id} from the same batch — “{field}” {rank}, ahead of it', { saved, id: before.id, field: fieldName(FIELD_ORDER, cfg.lang), rank: placed.rank }));
  else if (saved !== null) notes.push(msg(cfg.lang, 'saved position {saved} is taken — “{field}” {rank}', { saved, field: fieldName(FIELD_ORDER, cfg.lang), rank: placed.rank }));
  if (Number.isInteger(dropped)) notes.push(msg(cfg.lang, '{id}: saved position {dropped} discarded — --restore would have put it back', { id: task.id, dropped }));

  if (reorder) {
    ok(msg(cfg.lang, '{id}: queue/ “{field}” {rank}', { id: task.id, field: fieldName(FIELD_ORDER, cfg.lang), rank: placed.rank }));
    notes.forEach((note) => info(note));
    return { renumbered: placed.renumbered.map(([file]) => file), deferredSection, costAdded: false };
  }

  // Incoming links across the repository markdown, as in archive: the directory changed, and a
  // link from the docs index or a neighbouring task would otherwise break.
  const relinked = changed.filter((rel) => rel !== newRel);

  ok(`${task.id}: ${task.status}/ → ${target}/ (${newRel})`);
  notes.forEach((note) => info(note));
  if (shaped?.dropped.length) info(msg(cfg.lang, 'placeholder-only sections removed: {sections}', { sections: shaped.dropped.map((n) => msg(cfg.lang, '“{name}”', { name: n })).join(', ') }));
  if (shaped?.renamed) info(msg(cfg.lang, '“Context” became “Evidence”'));
  if (outgoingChanged) info(msg(cfg.lang, 'outgoing links recalculated from the new directory'));
  if (relinked.length) info(msg(cfg.lang, 'task links updated: {relinked}', { relinked: relinked.join(', ') }));
  return { renumbered: placed?.renumbered.map(([file]) => file) ?? [], deferredSection, costAdded };
}

export async function run(argv, { cwd, lang }) {
  const { values, positionals } = parseCommandArgs(argv, {
    top: { type: 'boolean' },
    after: { type: 'string' },
    restore: { type: 'boolean' },
    evidence: { type: 'string' },
  }, { positionals: Infinity, lang });
  const project = loadProject(cwd);
  const { cfg } = project;
  const target = positionals[positionals.length - 1];
  const rawIds = positionals.slice(0, -1);
  if (!rawIds.length || !target) throw new CliError(msg(cfg.lang, 'task numbers and a status are required: {cli} mv <N…> <{statuses}> [--top | --after M | --restore] [--evidence "…"]', { cli: cfg.cli, statuses: STATUSES.join('|') }));
  if (!STATUSES.includes(target)) throw new CliError(msg(cfg.lang, 'unknown status “{target}”; expected {statuses}. Close tasks with {cli} archive', { target, statuses: STATUSES.join(', '), cli: cfg.cli }));
  const chosen = [values.top ? '--top' : null, values.after === undefined ? null : '--after', values.restore ? '--restore' : null].filter(Boolean);
  const positioned = chosen.length > 0;
  if (positioned && target !== 'queue') throw new CliError(msg(cfg.lang, '--top, --after and --restore are only valid when moving to queue'));
  if (chosen.length > 1) throw new CliError(msg(cfg.lang, '{flags} cannot be used together: there is one position', { flags: chosen.join(msg(cfg.lang, ' and ')) }));
  // `--top` и `--after` называют одно место на весь вызов, и делить его между номерами не на чем.
  // `--restore` берёт число из шапки каждой задачи, поэтому пакету не мешает.
  if ((values.top || values.after !== undefined) && rawIds.length > 1) throw new CliError(msg(cfg.lang, 'a batch has no single position: --top and --after take one number; --restore reads the number from each task header'));
  if (values.evidence !== undefined && target !== 'minor') throw new CliError(msg(cfg.lang, '--evidence is only valid when moving to minor'));
  if (values.evidence !== undefined && rawIds.length > 1) throw new CliError(msg(cfg.lang, '--evidence takes one number: each entry has evidence of its own'));
  const evidence = (values.evidence ?? '').trim();

  const tasks = scanTasks(project);
  const planned = [];
  for (const rawId of rawIds) {
    const task = resolve(project, tasks, rawId, target, positioned);
    if (planned.some((t) => t.file === task.file)) throw new CliError(msg(cfg.lang, '{id} is named twice in the batch', { id: task.id }));
    planned.push(task);
  }

  // Улика в minor/ — до первого переноса и по всему пакету, как у `new --minor` (ADR-047).
  const bare = target === 'minor' ? planned.filter((t) => !minorForm(readText(t.file), evidence, cfg.lang).ok).map((t) => t.id) : [];
  if (bare.length) throw new CliError(evidenceRequired(cfg.lang, cfg.cli, bare));

  // Сохранённые числа читаются все сразу: отказ по любому из них случается до первого переноса.
  const restoring = values.restore ? restoreRanks(planned, cfg) : null;
  // Убывание сохранённых чисел, при равных — номеров; каждая следующая встаёт не позже
  // поставленной перед ней, и пакет ложится по возрастанию (ADR-049).
  if (restoring) planned.sort((a, b) => restoring.get(b.file) - restoring.get(a.file) || b.num - a.num || (b.sub ?? 0) - (a.sub ?? 0));

  // Множество путей, а не сумма: соседи пакета перенумеровывают друг друга по очереди, и один
  // файл попадает в renumbered несколько раз — сумма посчитала бы его столько же раз.
  const renumbered = new Set();
  let deferredAdded = 0;
  let deferredExisting = 0;
  let costAdded = 0;
  let previous = null;
  for (const task of planned) {
    const moved = moveOne(project, task, target, values, restoring?.get(task.file) ?? null, restoring ? previous : null, evidence);
    previous = task;
    if (moved.costAdded) costAdded += 1;
    for (const file of moved.renumbered) renumbered.add(file);
    if (moved.deferredSection === 'added') deferredAdded += 1;
    if (moved.deferredSection === 'exists') deferredExisting += 1;
  }
  if (renumbered.size) info(msg(cfg.lang, 'queue renumbered in steps of 10: {renumbered} files', { renumbered: renumbered.size }));
  if (target === 'deferred' && deferredExisting) info(msg(cfg.lang, 'section exists; check the reason and return condition'));
  if (costAdded) info(msg(cfg.lang, '“{field}: minor” added — adjust it if this is a hypothesis of a costlier finding', { field: fieldName(FIELD_COST, cfg.lang) }));
  if (target === 'deferred' && deferredAdded) info(msg(cfg.lang, 'complete the “Deferred” section with a reason and return condition or lint will fail'));
  return 0;
}
