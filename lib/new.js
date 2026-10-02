// Creating a task or a finding: the number from directories, other worktrees and local branches,
// the file from the template, triage by default. Besides the file, only neighbours' "Order" moves.
import path from 'node:path';
import { loadProject } from './config.js';
import { COST_LEVELS, SLUG_RE, createTask, evidenceAssumption } from './tasks.js';
import { CliError, info, ok, parseCommandArgs, toPosix } from './util.js';
import { msg } from './i18n.js';

// The refusal names what evidence can be: without examples it teaches only that the flag is needed.
const evidenceRequired = (lang) => [
  msg(lang, '--minor without --evidence: the entry goes to a batch without review, and no one completes it there.'),
  msg(lang, 'Evidence is one of three:'),
  msg(lang, '  a path with a line          lib/new.js:97'),
  msg(lang, '  a command, output, and code “backslop lint” → exit 1, “the [TODO] placeholder remains”'),
  msg(lang, '  a measurement with a number 25 files out of 26 name the signature'),
  evidenceAssumption(lang),
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
  if (!slug) throw new CliError(msg(cfg.lang, 'slug is required: {cli} new <slug> [--title "…"] [--queue [--top]] [--parent N[.M] [--cost critical|major] [--minor --evidence "…" [--cost <level>] [--hypothesis]]]', { cli: cfg.cli }));
  if (!SLUG_RE.test(slug)) throw new CliError(msg(cfg.lang, 'slug “{slug}”: use lowercase Latin letters, digits, and hyphens between words', { slug }));
  if (values.top && !values.queue) throw new CliError(msg(cfg.lang, '--top is only valid together with --queue'));
  if (values.minor && values.parent === undefined) throw new CliError(msg(cfg.lang, '--minor is a finding: --parent N[.M] is required'));
  if (values.minor && values.queue) throw new CliError(msg(cfg.lang, '--minor and --queue cannot be used together: a minor waits for a batch, not for the queue'));
  if ((values.hypothesis || values.evidence !== undefined) && !values.minor) throw new CliError(msg(cfg.lang, '--hypothesis and --evidence are only valid together with --minor'));
  if (values.cost !== undefined && !values.minor && values.parent === undefined) throw new CliError(msg(cfg.lang, '--cost is a finding label: --parent N[.M] is required'));
  const level = (values.cost ?? 'minor').trim().toLowerCase();
  if (values.cost !== undefined && !COST_LEVELS.includes(level)) throw new CliError(msg(cfg.lang, '--cost {cost}: levels are {levels}', { cost: values.cost, levels: COST_LEVELS.join(', ') }));
  if (values.cost !== undefined && !values.minor && level === 'minor') throw new CliError(msg(cfg.lang, '--cost minor needs --minor: a minor finding waits in minor/ for a batch'));
  if (values.minor && level !== 'minor' && !values.hypothesis) throw new CliError(msg(cfg.lang, '--cost {level} without --hypothesis: critical and major with evidence are fixed now, not queued for a batch; a hypothesis takes --hypothesis', { level }));
  // The refusal stands before scanTasks and any write: a minor goes to a batch unreviewed, and a
  // card without evidence is never completed there. A hypothesis is no exception (ADR-047).
  const evidence = (values.evidence ?? '').trim();
  if (values.minor && !evidence) throw new CliError(evidenceRequired(cfg.lang));
  const { id, file, notes } = createTask(project, {
    slug, title: values.title, queue: values.queue, top: values.top, parent: values.parent, minor: values.minor, cost: values.minor || values.cost !== undefined ? level : null, hypothesis: values.hypothesis, evidence,
  });
  ok(`${id}: ${toPosix(path.relative(root, file))}`);
  for (const note of notes) info(note);
  if (!values.minor && !values.queue) info(msg(cfg.lang, 'entry remains in triage/ until review; move it to the queue with {cli} mv <N> queue', { cli: cfg.cli }));
  if (values.minor) info(msg(cfg.lang, 'entry remains in minor/ until a batch: a batch is a card listing the numbers, closed with {cli} archive N.k --into M', { cli: cfg.cli }));
  return 0;
}
