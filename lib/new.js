// Заведение задачи или находки: номер — по каталогам, чужим worktree и локальным веткам, файл — из
// шаблона, статус — triage, если не сказано иначе. Кроме файла — лишь «Порядок» соседей по очереди.
import path from 'node:path';
import { loadProject } from './config.js';
import { COST_LEVELS, SLUG_RE, createTask, evidenceAssumption } from './tasks.js';
import { CliError, info, ok, parseCommandArgs, toPosix } from './util.js';
import { tr } from './i18n.js';

// Отказ называет, чем улика бывает: без примеров он учит только тому, что флаг обязателен.
const EVIDENCE_REQUIRED_RU = [
  '--minor без --evidence: запись уезжает в пачку без разбора, и достраивать её там некому.',
  'Улика — одно из трёх:',
  '  путь со строкой            lib/new.js:97',
  '  команда с выводом и кодом  «backslop lint» → код 1, «осталась заглушка [TODO]»',
  '  замер числом               25 файлов из 26 называют сигнатуру',
  evidenceAssumption('ru'),
].join('\n');
const EVIDENCE_REQUIRED_EN = [
  '--minor without --evidence: the entry goes to a batch without review, and no one completes it there.',
  'Evidence is one of three:',
  '  a path with a line          lib/new.js:97',
  '  a command, output, and code “backslop lint” → exit 1, “the [TODO] placeholder remains”',
  '  a measurement with a number 25 files out of 26 name the signature',
  evidenceAssumption('en'),
].join('\n');

export async function run(argv, { cwd, lang }) {
  const { values, positionals } = parseCommandArgs(argv, {
    title: { type: 'string' },
    queue: { type: 'boolean' },
    top: { type: 'boolean' },
    parent: { type: 'string' },
    minor: { type: 'boolean' },
    cost: { type: 'string' },
    hypothesis: { type: 'boolean' },
    evidence: { type: 'string' },
  }, { positionals: 1, lang });
  const project = loadProject(cwd);
  const { root, cfg } = project;
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
  const { id, file, notes } = createTask(project, {
    slug, title: values.title, queue: values.queue, top: values.top, parent: values.parent, minor: values.minor, cost: level, hypothesis: values.hypothesis, evidence,
  });
  ok(`${id}: ${toPosix(path.relative(root, file))}`);
  for (const note of notes) info(note);
  if (!values.minor && !values.queue) info(tr(cfg.lang, 'запись лежит в triage/ до разбора; в очередь — backslop mv <N> queue', 'entry remains in triage/ until review; move it to the queue with backslop mv <N> queue'));
  if (values.minor) info(tr(cfg.lang, 'запись лежит в minor/ до пачки: пачка — карточка со списком номеров, закрытие — backslop archive N.k --into M', 'entry remains in minor/ until a batch: a batch is a card listing the numbers, closed with backslop archive N.k --into M'));
  return 0;
}
