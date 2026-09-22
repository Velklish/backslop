// Заведение задачи или находки: номер — по каталогам, файл — из шаблона, статус — triage,
// если не сказано иначе. Строк индекса нет, поэтому команда не оставляет ничего, кроме файла.
// Номер считается и по чужим worktree и локальным веткам: параллельный worker иначе берёт тот же.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadProject } from './config.js';
import { renderProjectTemplate } from './templates.js';
import {
  COST_LEVELS, FIELD_ORDER, FIELD_PARENT, SLUG_RE, findTask, foreignTaskIds, formatCost, formatId, nextNumber, nextSub, parseId, placeInQueue,
  queueOrder, readText, scanTasks, setField, writeText,
} from './tasks.js';
import { CliError, info, ok, parseCommandArgs, today, toPosix } from './util.js';
import { tr } from './i18n.js';

// Отказ называет, чем улика бывает: без примеров он учит только тому, что флаг обязателен.
const EVIDENCE_REQUIRED_RU = [
  '--minor без --evidence: запись уезжает в пачку без разбора, и достраивать её там некому.',
  'Улика — одно из трёх:',
  '  путь со строкой            lib/new.js:97',
  '  команда с выводом и кодом  «backslop lint» → код 1, «осталась заглушка [TODO]»',
  '  замер числом               25 файлов из 26 называют сигнатуру',
  'Не проверено — это не пропуск улики, а предположение: --evidence "предположительно …".',
].join('\n');
const EVIDENCE_REQUIRED_EN = [
  '--minor without --evidence: the entry goes to a batch without review, and no one completes it there.',
  'Evidence is one of three:',
  '  a path with a line          lib/new.js:97',
  '  a command, output, and code “backslop lint” → exit 1, “the [TODO] placeholder remains”',
  '  a measurement with a number 25 files out of 26 name the signature',
  'Unverified does not excuse missing evidence — it makes it an assumption: --evidence "presumably …".',
].join('\n');

// Заглушка «Области»: ссылка на справочник, когда он есть, иначе текст. Раздел в обоих
// случаях дописывает тот, кто заводит задачу.
function areaPlaceholder(lang, reference) {
  if (lang === 'en') return reference === null ? '[TODO: reference/ section]' : `[TODO: section](${reference})`;
  return reference === null ? '[TODO: раздел reference/]' : `[TODO: раздел](${reference})`;
}

export async function run(argv, { cwd }) {
  const { values, positionals } = parseCommandArgs(argv, {
    title: { type: 'string' },
    queue: { type: 'boolean' },
    top: { type: 'boolean' },
    parent: { type: 'string' },
    minor: { type: 'boolean' },
    cost: { type: 'string' },
    hypothesis: { type: 'boolean' },
    evidence: { type: 'string' },
  });
  const project = loadProject(cwd);
  const { root, cfg, dirs } = project;
  const slug = positionals[0];
  if (!slug) throw new CliError(tr(cfg.lang, 'нужен slug: backslop new <slug> [--title "…"] [--queue [--top]] [--parent N[.M] [--minor --evidence "…" [--cost <уровень>] [--hypothesis]]]', 'slug is required: backslop new <slug> [--title "…"] [--queue [--top]] [--parent N[.M] [--minor --evidence "…" [--cost <level>] [--hypothesis]]]'));
  if (!SLUG_RE.test(slug)) throw new CliError(tr(cfg.lang, `slug «${slug}»: латиница в нижнем регистре, цифры и дефисы между словами`, `slug “${slug}”: use lowercase Latin letters, digits, and hyphens between words`));
  if (values.top && !values.queue) throw new CliError(tr(cfg.lang, '--top имеет смысл только вместе с --queue', '--top is only valid together with --queue'));
  if (values.minor && values.parent === undefined) throw new CliError(tr(cfg.lang, '--minor — находка: нужен --parent N[.M]', '--minor is a finding: --parent N[.M] is required'));
  if (values.minor && values.queue) throw new CliError(tr(cfg.lang, '--minor и --queue вместе не сочетаются: minor ждёт пачки, а не очереди', '--minor and --queue cannot be used together: a minor waits for a batch, not for the queue'));
  if ((values.cost !== undefined || values.hypothesis || values.evidence !== undefined) && !values.minor) throw new CliError(tr(cfg.lang, '--cost, --hypothesis и --evidence имеют смысл только вместе с --minor', '--cost, --hypothesis, and --evidence are only valid together with --minor'));
  const level = (values.cost ?? 'minor').trim().toLowerCase();
  if (values.minor && !COST_LEVELS.includes(level)) throw new CliError(tr(cfg.lang, `--cost ${values.cost}: уровни — ${COST_LEVELS.join(', ')}`, `--cost ${values.cost}: levels are ${COST_LEVELS.join(', ')}`));
  if (values.minor && level !== 'minor' && !values.hypothesis) throw new CliError(tr(cfg.lang, `--cost ${level} без --hypothesis: critical и major с уликой чинятся сейчас, а не ждут пачки; гипотеза — с флагом --hypothesis`, `--cost ${level} without --hypothesis: critical and major with evidence are fixed now, not queued for a batch; a hypothesis takes --hypothesis`));
  // Отказ стоит до scanTasks и до любой записи: minor уезжает в пачку без разбора, и карточка
  // без улики там уже никем не достраивается. Гипотеза исключением не служит — ADR-029.
  const evidence = (values.evidence ?? '').trim();
  if (values.minor && !evidence) throw new CliError(tr(cfg.lang, EVIDENCE_REQUIRED_RU, EVIDENCE_REQUIRED_EN));
  const tasks = scanTasks(project);
  const foreign = foreignTaskIds(project, cfg.lang);
  const all = [...tasks, ...foreign];

  let num;
  let sub = null;
  let parentTask = null;
  let blocker = null; // чужой номер, из-за которого свой сдвинулся
  let context = cfg.lang === 'en' ? '[TODO: where the task came from and what motivates it.]' : '[TODO: откуда задача и что за ней стоит.]';
  if (values.parent !== undefined) {
    const parent = parseId(values.parent, cfg.prefix, cfg.lang);
    parentTask = findTask(tasks, parent, cfg.lang);
    if (!parentTask) throw new CliError(cfg.lang === 'en'
      ? `task ${formatId(cfg.prefix, parent.num, parent.sub)} was not found in any status directory or archive`
      : `задачи ${formatId(cfg.prefix, parent.num, parent.sub)} нет ни в одном каталоге статуса и в архиве`);
    num = parent.num;
    sub = nextSub(all, num);
    blocker = foreign.find((f) => f.num === num && f.sub === sub - 1) ?? null;
    // В minor/ улику даёт флаг, и заглушке взяться неоткуда; в triage/ она остаётся заданием
    // тому, кто заводит запись, — там её достраивают при разборе.
    context = values.minor
      ? tr(cfg.lang,
        `Находка при работе над ${parentTask.id}.\n\nУлика: ${evidence}`,
        `Finding discovered while working on ${parentTask.id}.\n\nEvidence: ${evidence}`)
      : cfg.lang === 'en'
        ? [
          `Finding discovered while working on ${parentTask.id}.`,
          'Evidence: [TODO: file path or command output]',
          'Quote a file inside a “<!-- quote:path --> … <!-- /quote -->” block rather than by line number: numbers drift silently, the block is guarded by lint. If unverified, state it as an assumption.',
        ].join('\n')
        : [
          `Находка при работе над ${parentTask.id}.`,
          'Улика: [TODO: путь к файлу или команда с выводом]',
          'Цитату файла оборачивай в блок «<!-- quote:путь --> … <!-- /quote -->», а не давай номером строки: номера уезжают молча, за блоком следит lint. Не проверено — написать как предположение.',
        ].join('\n');
  } else {
    num = nextNumber(all);
    blocker = foreign.find((f) => f.sub === null && f.num === num - 1) ?? null;
  }

  // Находка наследует форму номера родителя: у `BS-007` — `BS-007.1`, не `BS-7.1`.
  // Для родителя-задачи сохраняется прежняя форма `N.M`. Для родителя-находки схема номеров
  // не расширяется до трёх уровней: ребёнок получает следующий `N.k`, а точное ребро хранится
  // в поле «Родитель». Корень номера наследует ведущие нули родителя (`BS-007.1` → `BS-007.2`).
  const parentRoot = parentTask?.id.split('.')[0];
  const parentIsFinding = parentTask !== null && parentTask.sub !== null;
  const id = parentTask
    ? parentIsFinding ? `${parentRoot}.${sub}` : `${parentTask.id}.${sub}`
    : formatId(cfg.prefix, num);
  const status = values.minor ? 'minor' : values.queue ? 'queue' : 'triage';
  const file = path.join(dirs.statusDir[status], `${id}-${slug}.md`);
  // Глубину пути до справочника считает команда: раздел выбирает тот, кто заводит задачу, а
  // число `../` — механика, и вручную она разъезжается при каждом заведении. Справочника в
  // проекте может не быть — тогда заглушка остаётся текстом: битая ссылка красила бы гейт 1.
  const reference = existsSync(path.join(dirs.reference, 'README.md'))
    ? `${toPosix(path.relative(dirs.statusDir[status], dirs.reference))}/README.md`
    : null;
  // В minor/ область заполняет approver при резке пачек: пустое поле — предупреждение lint,
  // заглушка [TODO] была бы ошибкой и требовала бы раздел от того, кто его не выбирает.
  const vars = { id, title: values.title ?? slug, date: today(), area: values.minor ? '' : areaPlaceholder(cfg.lang, reference), context };
  let text = values.minor
    ? renderProjectTemplate(cfg, 'minor.md', { ...vars, parent: parentTask.id, cost: formatCost(level, Boolean(values.hypothesis), cfg.lang) })
    : renderProjectTemplate(cfg, 'task.md', vars);
  if (parentIsFinding && !values.minor) text = setField(text, FIELD_PARENT, parentTask.id, cfg.lang);
  const renumbered = [];
  if (status === 'queue') {
    const placed = placeInQueue(queueOrder(tasks), { top: Boolean(values.top) }, cfg.lang);
    text = setField(text, FIELD_ORDER, String(placed.rank), cfg.lang);
    renumbered.push(...placed.renumbered);
  }
  for (const [otherFile, rank] of renumbered) {
    writeText(otherFile, setField(readText(otherFile), FIELD_ORDER, String(rank), cfg.lang));
  }
  writeText(file, text);
  ok(`${id}: ${toPosix(path.relative(root, file))}`);
  if (blocker) info(tr(cfg.lang, `${formatId(cfg.prefix, blocker.num, blocker.sub)} занят: ${blocker.source}`, `${formatId(cfg.prefix, blocker.num, blocker.sub)} is taken: ${blocker.source}`));
  if (renumbered.length) info(tr(cfg.lang, `очередь перенумерована шагом 10: ${renumbered.length} файлов`, `queue renumbered in steps of 10: ${renumbered.length} files`));
  if (status === 'triage') info(tr(cfg.lang, 'запись лежит в triage/ до разбора; в очередь — backslop mv <N> queue', 'entry remains in triage/ until review; move it to the queue with backslop mv <N> queue'));
  if (status === 'minor') info(tr(cfg.lang, 'запись лежит в minor/ до пачки: пачка — карточка со списком номеров, закрытие — backslop archive N.k --into M', 'entry remains in minor/ until a batch: a batch is a card listing the numbers, closed with backslop archive N.k --into M'));
  return 0;
}
