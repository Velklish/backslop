// Новый ADR со следующим номером из шаблона. Строку в таблицу docs/README.md команда не пишет:
// формулировка темы и статуса — решение автора, а не подстановка; про строку напоминает lint.
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { loadProject } from './config.js';
import { renderTemplate } from './templates.js';
import { SLUG_RE, writeText } from './tasks.js';
import { CliError, info, ok, parseCommandArgs, today, toPosix } from './util.js';

export const ADR_FILE_RE = /^adr-(\d{3,})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;

export function scanAdrs(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((name) => ({ name, m: name.match(ADR_FILE_RE) }))
    .filter(({ m }) => m)
    .map(({ name, m }) => ({ name, number: Number(m[1]), slug: m[2], file: path.join(dir, name) }))
    .sort((a, b) => a.number - b.number);
}

export function formatAdrNumber(n) {
  return String(n).padStart(3, '0');
}

export async function run(argv, { cwd }) {
  const { values, positionals } = parseCommandArgs(argv, { title: { type: 'string' } });
  const slug = positionals[0];
  if (!slug) throw new CliError('нужен slug: backslop adr <slug> [--title "…"]');
  if (!SLUG_RE.test(slug)) throw new CliError(`slug «${slug}»: латиница в нижнем регистре, цифры и дефисы между словами`);
  const { root, dirs } = loadProject(cwd);
  const existing = scanAdrs(dirs.adr);
  const number = formatAdrNumber((existing.at(-1)?.number ?? 0) + 1);
  const file = path.join(dirs.adr, `adr-${number}-${slug}.md`);
  writeText(file, renderTemplate('adr.md', { number, title: values.title ?? slug, date: today() }));
  ok(`ADR-${number}: ${toPosix(path.relative(root, file))}`);
  info(`добавь строку в таблицу ${toPosix(path.relative(root, dirs.docsReadme))} — без неё lint красный`);
  return 0;
}
