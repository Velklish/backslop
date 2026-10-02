// A new ADR with the next number from the template. The command writes no row into the
// docs/README.md table: the wording of topic and status is the author's call; lint demands the row.
import path from 'node:path';
import { expectDirectory, expectNameFits, loadProject } from './config.js';
import { renderProjectTemplate } from './templates.js';
import { formatAdrNumber, scanAdrs } from './adr-scan.js';
import { SLUG_RE } from './tasks.js';
import { CliError, info, ok, parseCommandArgs, today, toPosix, writeText } from './util.js';
import { msg } from './i18n.js';

export async function run(argv, { cwd, lang }) {
  const { values, positionals } = parseCommandArgs(argv, { title: { type: 'string' } }, { positionals: 1, lang });
  const { root, cfg, dirs } = loadProject(cwd);
  const slug = positionals[0];
  if (!slug) throw new CliError(msg(cfg.lang, 'slug is required: {cli} adr <slug> [--title "…"]', { cli: cfg.cli }));
  if (!SLUG_RE.test(slug)) throw new CliError(msg(cfg.lang, 'slug “{slug}”: use lowercase Latin letters, digits, and hyphens between words', { slug }));
  expectDirectory(root, dirs.adr, cfg.lang);
  const existing = scanAdrs(dirs.adr);
  const number = formatAdrNumber((existing.at(-1)?.number ?? 0) + 1);
  const file = path.join(dirs.adr, `adr-${number}-${slug}.md`);
  expectNameFits(path.basename(file), cfg.lang);
  writeText(file, renderProjectTemplate(cfg, 'adr.md', { number, title: (values.title ?? '').trim() || slug, date: today() }));
  ok(`ADR-${number}: ${toPosix(path.relative(root, file))}`);
  info(msg(cfg.lang, 'add a row to the table in {docsReadme} or lint will fail', { docsReadme: toPosix(path.relative(root, dirs.docsReadme)) }));
  return 0;
}
