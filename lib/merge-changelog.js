// Слияние двух рабочих редакций CHANGELOG.md по единицам его структуры. Стратегия git тут
// не годится: `-X ours`/`-X theirs` берут файл одной стороны целиком и молча теряют записи
// соседнего track'а. Сливается только первая секция невыпущенного — заголовки выпущенных
// секций повторяются в каждом релизе, и объединять их нечего.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { CHANGELOG_ENTRY } from './lint.js';
import { CliError, parseCommandArgs, toPosix, warn } from './util.js';
import { findRoot, loadConfig } from './config.js';
import { tr } from './i18n.js';

const CHANGELOG_FILE = 'CHANGELOG.md';
const SECTION = /^## (.+)$/;
const VERSION_IN_TITLE = /v?\d+\.\d+\.\d+/;
// Жирная подгруппа внутри секции: `**Для пользователя workspace:**` отдельной строкой.
// Под `CHANGELOG_ENTRY` она не подпадает, а принадлежность записи к ней сохраняется.
const SUBGROUP = /^\*\*.+\*\*$/;

export const CONFLICT_MARK = '<!-- backslop:conflict';

// Шапка до первой секции `## ` и сами секции; тела секций остаются строками как были.
function splitSections(text) {
  const head = [];
  const sections = [];
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(SECTION);
    if (m) {
      current = { title: m[1].trim(), lines: [] };
      sections.push(current);
      continue;
    }
    (current ? current.lines : head).push(raw);
  }
  return { head, sections };
}

function unreleasedIndex(sections) {
  return sections.findIndex((s) => !VERSION_IN_TITLE.test(s.title));
}

// Подгруппы и записи секции. `lead` — строки до первой записи и подгруппы: проза шапки
// секции остаётся на месте, а не теряется при сборке.
function parseSection(lines) {
  const groups = [{ title: null, entries: [] }];
  const lead = [];
  let group = groups[0];
  let entry = null;
  for (const raw of lines) {
    if (SUBGROUP.test(raw.trim())) {
      group = { title: raw.trim(), entries: [] };
      groups.push(group);
      entry = null;
      continue;
    }
    const m = raw.match(CHANGELOG_ENTRY);
    if (m) {
      entry = { title: m[1], lines: [raw] };
      group.entries.push(entry);
      continue;
    }
    if (entry) entry.lines.push(raw);
    else if (group.title === null) lead.push(raw);
  }
  return { lead, groups };
}

const bodyOf = (entry) => entry.lines.join('\n').trim();
const textOf = (entry) => entry.lines.join('\n').trimEnd();

// Разошедшиеся тела одного заголовка команда не выбирает — это решение агента. Обе записи
// остаются под меткой: markdown её не показывает, grep находит, а гейт 7 краснеет на дубле
// заголовка и не даёт забыть решение.
function conflictEntry(title, ours, theirs) {
  return { title, lines: [`${CONFLICT_MARK} ${title} -->`, ...textOf(ours).split('\n'), '', ...textOf(theirs).split('\n')] };
}

function indexEntries(parsed) {
  const byTitle = new Map();
  for (const group of parsed.groups) {
    for (const entry of group.entries) if (!byTitle.has(entry.title)) byTitle.set(entry.title, { entry, group });
  }
  return byTitle;
}

function countEntries(parsed) {
  return parsed.groups.reduce((n, g) => n + g.entries.length, 0);
}

// Заголовки записей невыпущенного у базы слияния: только они отличают «сторона сняла запись»
// от «у стороны её никогда не было».
function unreleasedTitles(text) {
  const { sections } = splitSections(text);
  const at = unreleasedIndex(sections);
  if (at === -1) return new Set();
  return new Set(indexEntries(parseSection(sections[at].lines)).keys());
}

export function mergeChangelog(oursText, theirsText, baseText = null, lang = 'ru') {
  const ours = splitSections(oursText);
  const theirs = splitSections(theirsText);
  const oursAt = unreleasedIndex(ours.sections);
  if (oursAt === -1) {
    throw new CliError(tr(lang,
      `${CHANGELOG_FILE} стороны --ours: нет секции невыпущенного (заголовок «## …» без номера версии)`,
      `${CHANGELOG_FILE} on the --ours side has no unreleased section (a “## …” heading without a version)`));
  }
  const theirsAt = unreleasedIndex(theirs.sections);
  const oursSection = parseSection(ours.sections[oursAt].lines);
  const theirsSection = theirsAt === -1 ? { lead: [], groups: [] } : parseSection(theirs.sections[theirsAt].lines);
  const theirsByTitle = indexEntries(theirsSection);
  // Заголовок записи опознаёт её глобально в пределах секции: та же запись, стоящая у сторон
  // в разных подгруппах, иначе легла бы дважды и покрасила гейт 7.
  const baseTitles = baseText === null ? null : unreleasedTitles(baseText);

  const groups = [];
  const byGroup = new Map();
  for (const group of [...oursSection.groups, ...theirsSection.groups]) {
    if (byGroup.has(group.title)) continue;
    const merged = { title: group.title, entries: [] };
    byGroup.set(group.title, merged);
    groups.push(merged);
  }

  const report = { ours: countEntries(oursSection), theirs: countEntries(theirsSection), conflicts: [], onlyOurs: [], onlyTheirs: [], dropped: [] };
  const seen = new Set();
  const place = (groupTitle, entry) => byGroup.get(groupTitle).entries.push(entry);

  for (const group of oursSection.groups) {
    for (const entry of group.entries) {
      if (seen.has(entry.title)) continue;
      seen.add(entry.title);
      const other = theirsByTitle.get(entry.title);
      if (other) {
        if (bodyOf(entry) === bodyOf(other.entry)) place(group.title, entry);
        else {
          report.conflicts.push(entry.title);
          place(group.title, conflictEntry(entry.title, entry, other.entry));
        }
        continue;
      }
      // Без базы «запись новая у ours» и «запись снята стороной theirs» не различить —
      // запись сохраняется, а её односторонность называет отчёт.
      if (baseTitles?.has(entry.title)) {
        report.dropped.push(entry.title);
        continue;
      }
      report.onlyOurs.push(entry.title);
      place(group.title, entry);
    }
  }
  for (const group of theirsSection.groups) {
    for (const entry of group.entries) {
      if (seen.has(entry.title)) continue;
      seen.add(entry.title);
      if (baseTitles?.has(entry.title)) {
        report.dropped.push(entry.title);
        continue;
      }
      report.onlyTheirs.push(entry.title);
      place(group.title, entry);
    }
  }

  report.merged = groups.reduce((n, g) => n + g.entries.length, 0);
  const blocks = [];
  const lead = oursSection.lead.join('\n').trim();
  if (lead) blocks.push(lead);
  for (const group of groups) {
    if (!group.entries.length) continue;
    if (group.title) blocks.push(group.title);
    for (const entry of group.entries) blocks.push(textOf(entry));
  }
  const section = `## ${ours.sections[oursAt].title}\n\n${blocks.join('\n\n')}`;

  const parts = [];
  const head = ours.head.join('\n').trimEnd();
  if (head) parts.push(head);
  ours.sections.forEach((s, i) => {
    parts.push(i === oursAt ? section : `## ${s.title}\n${s.lines.join('\n').trimEnd()}`);
  });
  return { text: `${parts.join('\n\n')}\n`, report };
}

function readRevision(root, ref, lang) {
  const r = spawnSync('git', ['-C', root, 'show', `${ref}:./${CHANGELOG_FILE}`], { encoding: 'utf8' });
  if (r.status !== 0) {
    const why = (r.stderr ?? '').trim() || r.error?.message || `код ${r.status}`;
    throw new CliError(tr(lang, `не читается ${ref}:${CHANGELOG_FILE} — ${why}`, `cannot read ${ref}:${CHANGELOG_FILE} — ${why}`));
  }
  return r.stdout;
}

// Данные — в stdout или в --out, диагностика — всегда в stderr: иначе
// `merge-changelog … > CHANGELOG.md` затащил бы отчёт в файл.
function note(line) {
  process.stderr.write(`  ${line}\n`);
}

export async function run(argv, { cwd }) {
  const { values } = parseCommandArgs(argv, {
    ours: { type: 'string' }, theirs: { type: 'string' }, base: { type: 'string' }, out: { type: 'string' },
  });
  const root = findRoot(cwd) ?? path.resolve(cwd);
  const lang = findRoot(cwd) ? loadConfig(root).lang : 'ru';
  if (!values.ours || !values.theirs) {
    throw new CliError(tr(lang,
      'нужны --ours <ref> и --theirs <ref>: две редакции CHANGELOG.md из git',
      'both --ours <ref> and --theirs <ref> are required: two CHANGELOG.md revisions from git'));
  }
  const { text, report } = mergeChangelog(
    readRevision(root, values.ours, lang),
    readRevision(root, values.theirs, lang),
    values.base === undefined ? null : readRevision(root, values.base, lang),
    lang,
  );
  if (values.out === undefined) process.stdout.write(text);
  else writeFileSync(path.resolve(root, values.out), text);

  note(tr(lang,
    `записей: ours ${report.ours}, theirs ${report.theirs}, в результате ${report.merged}`,
    `entries: ours ${report.ours}, theirs ${report.theirs}, merged ${report.merged}`));
  if (values.out !== undefined) note(tr(lang, `записано: ${toPosix(path.relative(root, path.resolve(root, values.out)))}`, `written: ${toPosix(path.relative(root, path.resolve(root, values.out)))}`));
  for (const title of report.onlyOurs) note(tr(lang, `только у ours: ${title}`, `only in ours: ${title}`));
  for (const title of report.onlyTheirs) note(tr(lang, `только у theirs: ${title}`, `only in theirs: ${title}`));
  for (const title of report.dropped) note(tr(lang, `снята относительно --base: ${title}`, `removed relative to --base: ${title}`));
  if (report.conflicts.length) {
    warn(tr(lang,
      `разошлись тела одного заголовка — обе редакции оставлены под меткой ${CONFLICT_MARK}, реши сам: ${report.conflicts.join('; ')}`,
      `bodies differ under one heading — both revisions kept under the ${CONFLICT_MARK} mark, decide yourself: ${report.conflicts.join('; ')}`));
  }
  if (values.base === undefined) {
    note(tr(lang,
      'без --base снятая стороной запись неотличима от новой у соседа — односторонние записи сохранены',
      'without --base a removed entry is indistinguishable from a neighbour’s new one — one-sided entries are kept'));
  }
  return 0;
}
