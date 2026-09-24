// Смена статуса: `git mv` файла между каталогами плюс поля, которые статус за собой ведёт.
// Уход из queue/ не стирает ранг молча: он ложится в «Прежний порядок», и `--restore` ставит
// задачу обратно по нему — иначе место очереди живёт только в памяти оркестратора. Возврат в
// queue/ без `--restore` сохранённое число отбрасывает, но говорит об этом вслух.
// `--restore` работает и на пакете: число берётся из шапки каждой задачи, поэтому одного
// места на всех ему не нужно — в отличие от `--top` и `--after`. Пакет идёт по убыванию
// сохранённых чисел, а не по порядку аргументов: место каждой считается заново, и хвост,
// поставленный первым, дальше только отодвигается вниз вместе с соседями.
// Место в очереди считается до переноса: отказ `--after` не должен оставлять файл уже в
// queue/ без порядка. Задача, уже стоящая в очереди, с `--top`/`--after` не переезжает —
// у неё меняется только «Порядок»; без флага положения это отказ, а не тихий no-op.
// Номеров может быть несколько за вызов: track захода переводится в работу одной командой.
// Все они резолвятся и проверяются до первого переноса — половина перенесённого пакета
// оставила бы оркестратора без понятного состояния каталогов.
import path from 'node:path';
import { STATUSES, loadProject } from './config.js';
import {
  FIELD_AREA, FIELD_COST, FIELD_ORDER, FIELD_PREV_ORDER, FIELD_TAKEN, SECTION_DEFERRED, fieldName, findFlatTask, findTask, formatId, parseId, placeInQueue,
  getField, orderOf, queueOrder, readText, relocateTask, removeField, sameId, scanTasks, sectionBody, appendSection, setField, writeText,
} from './tasks.js';
import { CliError, info, ok, parseCommandArgs, today, toPosix } from './util.js';
import { tr } from './i18n.js';

// Резолв одного номера и все отказы, которые видны до переноса.
function resolve(project, tasks, rawId, target, positioned) {
  const { cfg } = project;
  const id = parseId(rawId, cfg.prefix, cfg.lang);
  // Файл плоского бэклога (прямо в docs/backlog/) — тоже задача для переезда: миграция.
  const task = findTask(tasks, id, cfg.lang) ?? findFlatTask(project, id);
  if (!task) throw new CliError(tr(cfg.lang, `задачи ${formatId(cfg.prefix, id.num, id.sub)} нет ни в одном каталоге статуса`, `task ${formatId(cfg.prefix, id.num, id.sub)} was not found in any status directory`));
  if (task.status === 'archive') throw new CliError(tr(cfg.lang, `${task.id} в архиве; вернуть закрытую задачу — руками, осознанно`, `${task.id} is archived; restore a closed task manually and deliberately`));
  const reorder = task.status === 'queue' && target === 'queue';
  if (task.status === target && !reorder) throw new CliError(tr(cfg.lang, `${task.id} уже в ${target}/`, `${task.id} is already in ${target}/`));
  if (reorder && !positioned) throw new CliError(tr(cfg.lang, `${task.id} уже в queue/; место — --top, --after M или --restore`, `${task.id} is already in queue/; give a position: --top, --after M or --restore`));
  return task;
}

// Ранги, с которыми задачи пакета ушли из очереди. Поля нет или оно не целое — отказ на весь
// вызов, до первого переноса и с поимённым перечнем: молча встать в конец значило бы соврать
// про восстановленное место, а половина перенесённого пакета — оставить каталоги без смысла.
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
  if (missing.length) parts.push(tr(cfg.lang, `у ${missing.join(', ')} нет поля «${label}» — место не сохранено`, `no “${label}” field on ${missing.join(', ')} — no position was saved`));
  if (broken.length) parts.push(tr(cfg.lang, `«${label}» у ${broken.join(', ')} не целое число`, `“${label}” on ${broken.join(', ')} is not an integer`));
  if (parts.length) throw new CliError(`${parts.join('; ')}${tr(cfg.lang, '; --top или --after M', '; use --top or --after M')}`);
  return ranks;
}

// Перенос одного номера. Очередь читается заново на каждый: соседи по пакету уже заняли
// свои места, и общий снимок выдал бы им один «Порядок».
function moveOne(project, task, target, values, saved, before) {
  const { root, cfg, dirs } = project;
  const tasks = scanTasks(project);
  const reorder = task.status === 'queue' && target === 'queue';

  let placed = null;
  if (target === 'queue') {
    const after = values.after === undefined ? null : parseId(values.after, cfg.prefix, cfg.lang);
    if (after && sameId(after, task)) throw new CliError(tr(cfg.lang, `--after ${task.id}: задача не может стоять после самой себя`, `--after ${task.id}: a task cannot follow itself`));
    const rows = queueOrder(tasks.filter((t) => t.file !== task.file));
    placed = placeInQueue(rows, { top: Boolean(values.top), after, rank: saved, before }, cfg.lang);
  }

  const to = reorder ? task.file : path.join(dirs.statusDir[target], path.basename(task.file));
  const newRel = toPosix(path.relative(root, to));

  // Исходящие ссылки — от старого каталога к новому, как при archive: из плоского docs/backlog/
  // глубина растёт и `../reference/…` иначе рвётся; между каталогами статусов ссылка на соседа
  // из прежнего каталога получает `../<статус>/`.
  const changed = reorder ? [] : relocateTask(project, task, newRel);
  let text = readText(to);
  const outgoingChanged = changed.includes(newRel);
  // Ранг очереди переживает уход из неё отдельным полем; при возвращении в queue/ сохранённое
  // число стирается — место уже занято активным «Порядком», и второе число сбивало бы с толку.
  // Возврат без `--restore` его отбрасывает, и это единственный случай, когда сохранённое место
  // теряется навсегда: молчать о нём значило бы повторить дыру, которую поле закрыло.
  const leaving = task.status === 'queue' ? orderOf(text) : null;
  const dropped = target === 'queue' && !values.restore ? orderOf(text, FIELD_PREV_ORDER) : null;
  if (target === 'queue') text = removeField(text, FIELD_PREV_ORDER);
  else if (Number.isInteger(leaving)) text = setField(text, FIELD_PREV_ORDER, String(leaving), cfg.lang);
  if (placed) text = setField(text, FIELD_ORDER, String(placed.rank), cfg.lang);
  else text = removeField(text, FIELD_ORDER);
  if (target === 'active') text = setField(text, FIELD_TAKEN, today(), cfg.lang);
  else text = removeField(text, FIELD_TAKEN);
  const costAdded = target === 'minor' && getField(text, FIELD_COST) === null;
  if (costAdded) text = setField(text, FIELD_COST, 'minor', cfg.lang);
  // Заглушка области от `new` в minor/ стала бы ошибкой гейта заглушек, а область там необязательна.
  if (target === 'minor' && /^\[TODO/.test((getField(text, FIELD_AREA) ?? '').trim())) text = setField(text, FIELD_AREA, '', cfg.lang);
  let deferredSection = null;
  if (target === 'deferred' && sectionBody(text, SECTION_DEFERRED) === null) {
    deferredSection = 'added';
    const deferred = cfg.lang === 'en'
      ? [`- **Deferred:** ${today()}`, '- **Reason:** [TODO]', '- **Return condition:** [TODO: what must happen before this returns to the queue]']
      : [`- **Отложена:** ${today()}`, '- **Причина:** [TODO]', '- **Условие возврата:** [TODO: что должно случиться, чтобы вернуть в очередь]'];
    text = appendSection(text, SECTION_DEFERRED, deferred.join('\n'), cfg.lang);
  } else if (target === 'deferred') {
    deferredSection = 'exists';
  }
  writeText(to, text);
  for (const [otherFile, rank] of placed?.renumbered ?? []) {
    writeText(otherFile, setField(readText(otherFile), FIELD_ORDER, String(rank), cfg.lang));
  }

  const notes = [];
  if (saved !== null && placed.rank === saved) notes.push(tr(cfg.lang, `«${fieldName(FIELD_ORDER, cfg.lang)}» ${saved} восстановлен`, `“${fieldName(FIELD_ORDER, cfg.lang)}” ${saved} restored`));
  else if (placed?.bounded) notes.push(tr(cfg.lang, `сохранённое место ${saved} позади ${before.id} из того же пакета — «${fieldName(FIELD_ORDER, cfg.lang)}» ${placed.rank}, перед ней`, `saved position ${saved} falls behind ${before.id} from the same batch — “${fieldName(FIELD_ORDER, cfg.lang)}” ${placed.rank}, ahead of it`));
  else if (saved !== null) notes.push(tr(cfg.lang, `сохранённое место ${saved} занято — «${fieldName(FIELD_ORDER, cfg.lang)}» ${placed.rank}`, `saved position ${saved} is taken — “${fieldName(FIELD_ORDER, cfg.lang)}” ${placed.rank}`));
  if (Number.isInteger(dropped)) notes.push(tr(cfg.lang, `${task.id}: сохранённое место ${dropped} отброшено — вернуть его можно было --restore`, `${task.id}: saved position ${dropped} discarded — --restore would have put it back`));

  if (reorder) {
    ok(`${task.id}: queue/ «${fieldName(FIELD_ORDER, cfg.lang)}» ${placed.rank}`);
    notes.forEach((note) => info(note));
    return { renumbered: placed.renumbered.map(([file]) => file), deferredSection, costAdded: false };
  }

  // Входящие ссылки на файл — по всему markdown репозитория, как при archive: каталог сменился,
  // и ссылка из roadmap или соседней задачи иначе остаётся битой.
  const relinked = changed.filter((rel) => rel !== newRel);

  ok(`${task.id}: ${task.status}/ → ${target}/ (${newRel})`);
  notes.forEach((note) => info(note));
  if (outgoingChanged) info(tr(cfg.lang, 'исходящие ссылки пересчитаны от нового каталога', 'outgoing links recalculated from the new directory'));
  if (relinked.length) info(tr(cfg.lang, `ссылки на задачу поправлены: ${relinked.join(', ')}`, `task links updated: ${relinked.join(', ')}`));
  return { renumbered: placed?.renumbered.map(([file]) => file) ?? [], deferredSection, costAdded };
}

export async function run(argv, { cwd }) {
  const { values, positionals } = parseCommandArgs(argv, {
    top: { type: 'boolean' },
    after: { type: 'string' },
    restore: { type: 'boolean' },
  });
  const project = loadProject(cwd);
  const { cfg } = project;
  const target = positionals[positionals.length - 1];
  const rawIds = positionals.slice(0, -1);
  if (!rawIds.length || !target) throw new CliError(tr(cfg.lang, `нужны номер и статус: backslop mv <N…> <${STATUSES.join('|')}> [--top | --after M | --restore]`, `task numbers and a status are required: backslop mv <N…> <${STATUSES.join('|')}> [--top | --after M | --restore]`));
  if (!STATUSES.includes(target)) throw new CliError(tr(cfg.lang, `статус «${target}» неизвестен; есть ${STATUSES.join(', ')}. Закрытие — backslop archive`, `unknown status “${target}”; expected ${STATUSES.join(', ')}. Close tasks with backslop archive`));
  const chosen = [values.top ? '--top' : null, values.after === undefined ? null : '--after', values.restore ? '--restore' : null].filter(Boolean);
  const positioned = chosen.length > 0;
  if (positioned && target !== 'queue') throw new CliError(tr(cfg.lang, '--top, --after и --restore имеют смысл только при переводе в queue', '--top, --after and --restore are only valid when moving to queue'));
  if (chosen.length > 1) throw new CliError(tr(cfg.lang, `${chosen.join(' и ')} вместе не сочетаются: место одно`, `${chosen.join(' and ')} cannot be used together: there is one position`));
  // `--top` и `--after` называют одно место на весь вызов, и делить его между номерами не на чем.
  // `--restore` берёт число из шапки каждой задачи, поэтому пакету не мешает.
  if ((values.top || values.after !== undefined) && rawIds.length > 1) throw new CliError(tr(cfg.lang, 'место для пакета не определено одним числом: --top и --after — только с одним номером; --restore берёт число из шапки каждой задачи', 'a batch has no single position: --top and --after take one number; --restore reads the number from each task header'));

  const tasks = scanTasks(project);
  const planned = [];
  for (const rawId of rawIds) {
    const task = resolve(project, tasks, rawId, target, positioned);
    if (planned.some((t) => t.file === task.file)) throw new CliError(tr(cfg.lang, `${task.id} назван в пакете дважды`, `${task.id} is named twice in the batch`));
    planned.push(task);
  }

  // Сохранённые числа читаются все сразу: отказ по любому из них случается до первого переноса.
  const restoring = values.restore ? restoreRanks(planned, cfg) : null;
  // Убывание сохранённых чисел, при равных — номеров; каждая следующая встаёт не позже
  // поставленной перед ней, и пакет ложится по возрастанию (ADR-027, ADR-031).
  if (restoring) planned.sort((a, b) => restoring.get(b.file) - restoring.get(a.file) || b.num - a.num || (b.sub ?? 0) - (a.sub ?? 0));

  // Множество путей, а не сумма: соседи пакета перенумеровывают друг друга по очереди, и один
  // файл попадает в renumbered несколько раз — сумма посчитала бы его столько же раз.
  const renumbered = new Set();
  let deferredAdded = 0;
  let deferredExisting = 0;
  let costAdded = 0;
  let previous = null;
  for (const task of planned) {
    const moved = moveOne(project, task, target, values, restoring?.get(task.file) ?? null, restoring ? previous : null);
    previous = task;
    if (moved.costAdded) costAdded += 1;
    for (const file of moved.renumbered) renumbered.add(file);
    if (moved.deferredSection === 'added') deferredAdded += 1;
    if (moved.deferredSection === 'exists') deferredExisting += 1;
  }
  if (renumbered.size) info(tr(cfg.lang, `очередь перенумерована шагом 10: ${renumbered.size} файлов`, `queue renumbered in steps of 10: ${renumbered.size} files`));
  if (target === 'deferred' && deferredExisting) info(tr(cfg.lang, 'раздел есть, проверь причину и условие возврата', 'section exists; check the reason and return condition'));
  if (costAdded) info(tr(cfg.lang, `«${fieldName(FIELD_COST, cfg.lang)}: minor» дописана — поправь, если это гипотеза более дорогой находки`, `“${fieldName(FIELD_COST, cfg.lang)}: minor” added — adjust it if this is a hypothesis of a costlier finding`));
  if (target === 'deferred' && deferredAdded) info(tr(cfg.lang, 'заполни раздел «Отложено»: причина и условие возврата — без них lint красный', 'complete the “Deferred” section with a reason and return condition or lint will fail'));
  return 0;
}
