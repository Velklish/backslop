// Новый ADR со следующим номером из шаблона. Строку в таблицу docs/README.md команда не пишет:
// формулировка темы и статуса — решение автора, а не подстановка; про строку напоминает lint.
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { expectDirectory, expectNameFits, loadProject } from './config.js';
import { renderProjectTemplate } from './templates.js';
import { SLUG_SRC } from './ids.js';
import { SLUG_RE } from './tasks.js';
import { CliError, info, ok, parseCommandArgs, today, toPosix, writeText } from './util.js';
import { tr } from './i18n.js';

export const ADR_FILE_RE = new RegExp(`^adr-(\\d{3,})-(${SLUG_SRC})\\.md$`);

export function scanAdrs(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  return readdirSync(dir)
    .map((name) => ({ name, m: name.match(ADR_FILE_RE) }))
    .filter(({ m }) => m)
    .map(({ name, m }) => ({ name, number: Number(m[1]), slug: m[2], file: path.join(dir, name) }))
    .sort((a, b) => a.number - b.number);
}

export function formatAdrNumber(n) {
  return String(n).padStart(3, '0');
}

export async function run(argv, { cwd, lang }) {
  const { values, positionals } = parseCommandArgs(argv, { title: { type: 'string' } }, { positionals: 1, lang });
  const { root, cfg, dirs } = loadProject(cwd);
  const slug = positionals[0];
  if (!slug) throw new CliError(tr(cfg.lang, `нужен slug: ${cfg.cli} adr <slug> [--title "…"]`, `slug is required: ${cfg.cli} adr <slug> [--title "…"]`));
  if (!SLUG_RE.test(slug)) throw new CliError(tr(cfg.lang, `slug «${slug}»: латиница в нижнем регистре, цифры и дефисы между словами`, `slug “${slug}”: use lowercase Latin letters, digits, and hyphens between words`));
  expectDirectory(root, dirs.adr, cfg.lang);
  const existing = scanAdrs(dirs.adr);
  const number = formatAdrNumber((existing.at(-1)?.number ?? 0) + 1);
  const file = path.join(dirs.adr, `adr-${number}-${slug}.md`);
  expectNameFits(path.basename(file), cfg.lang);
  writeText(file, renderProjectTemplate(cfg, 'adr.md', { number, title: (values.title ?? '').trim() || slug, date: today() }));
  ok(`ADR-${number}: ${toPosix(path.relative(root, file))}`);
  info(tr(cfg.lang, `добавь строку в таблицу ${toPosix(path.relative(root, dirs.docsReadme))} — без неё lint красный`, `add a row to the table in ${toPosix(path.relative(root, dirs.docsReadme))} or lint will fail`));
  return 0;
}
