// Слияние двух редакций CHANGELOG.md по единицам структуры: `-X ours`/`-X theirs` молча теряют
// записи соседа (ADR-043). Сливается только секция невыпущенного, выпущенные — у ours.
import { statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { CHANGELOG_ENTRY, sectionVersion, splitSections } from './changelog-format.js';
import { CliError, bad, git, gitCause, note, parseCommandArgs, readText, toPosix, warn, writeText } from './util.js';
import { eolOf } from './text.js';
import { findRoot } from './config.js';
import { msg, msgBoth } from './i18n.js';

const CHANGELOG_FILE = 'CHANGELOG.md';
// Заголовок `### Fixed` — не запись: без отдельного правила он уезжал бы в тело предыдущей записи
// вместе с хвостом секции, давая дубль заголовка и ложное расхождение тел.
const HEADING = /^#{3,6} \S/;
// Жирная подгруппа внутри секции: `**Для пользователя workspace:**` отдельной строкой.
// Под `CHANGELOG_ENTRY` она не подпадает, а принадлежность записи к ней сохраняется.
const SUBGROUP = /^\*\*.+\*\*$/;
// Буллет верхнего уровня без жирного заголовка. Записью он не является, но и продолжением
// соседней записи тоже: продолжение идёт с отступом, а этот начинается с первой колонки.
const PLAIN_ITEM = /^[-*+] /;

export const CONFLICT_MARK = '<!-- backslop:conflict';
// Метка — строка целиком с первой колонки, как её ставит `conflictEntry`: имя метки прозой в
// код-спане или в отступном блоке кода меткой не является (docs/reference/02-cli.md).
const MARK_LINE = /^<!-- backslop:conflict/;
const countMarks = (lines) => lines.filter((line) => MARK_LINE.test(line)).length;

// No heading without a leading version: the top section is the unreleased one while its version
// has no tag, as `release --bump` leaves it before the release (ADR-043).
function unreleasedIndex(sections, released) {
  const at = sections.findIndex((s) => sectionVersion(s.title) === null);
  if (at !== -1 || !sections.length) return at;
  return released(sectionVersion(sections[0].title)) ? -1 : 0;
}

const bodyOf = (block) => block.lines.join('\n').trim();
// Имя блока в отчёте: запись — заголовком, буллет без заголовка — началом текста; безымянный
// тоже называется — односторонний буллет не должен приехать молча.
const label = (block) => {
  if (block.title) return block.title;
  const first = block.lines[0].replace(/^[-*+] /, '').trim();
  return first.length > 60 ? `${first.slice(0, 57)}…` : first;
};
// Строки блока без хвостовых пустых: сами пустые строки — это отбивка до следующего блока,
// и она едет вместе с блоком, чтобы раскладка файла не менялась от перестановки.
const withoutTail = (lines) => {
  let n = lines.length;
  while (n > 0 && lines[n - 1].trim() === '') n -= 1;
  return lines.slice(0, n);
};

// Разбор обратим: `lead`, `open` и строки блоков подряд дают ровно пришедшие строки (ADR-043).
// Контейнер — «### заголовок + жирная подгруппа», блок — запись `- **…**` или буллет без заголовка.
function parseSection(lines) {
  const lead = [];
  const containers = [];
  let heading = null;
  let container = null;
  let block = null;

  const start = (nextHeading, subgroup, open) => {
    heading = nextHeading;
    container = { key: `${nextHeading ?? ''}\u0000${subgroup ?? ''}`, heading: nextHeading, subgroup, open, blocks: [] };
    containers.push(container);
    block = null;
  };

  for (const raw of lines) {
    if (HEADING.test(raw)) { start(raw.trim(), null, [raw]); continue; }
    if (SUBGROUP.test(raw.trimEnd())) { start(heading, raw.trim(), [raw]); continue; }
    const m = raw.match(CHANGELOG_ENTRY);
    if (m || PLAIN_ITEM.test(raw)) {
      if (!container) start(null, null, []);
      block = { title: m ? m[1] : null, lines: [raw] };
      container.blocks.push(block);
      continue;
    }
    if (block) block.lines.push(raw);
    else if (container) container.open.push(raw);
    else lead.push(raw);
  }
  for (const c of containers) for (const b of c.blocks) b.id = b.title ?? `\u0001${bodyOf(b)}`;
  return { lead, containers };
}

// Разошедшиеся тела одного заголовка выбирает агент: обе записи — под меткой, гейт 7 краснеет на
// дубле заголовка, команда выходит ненулём и называет метку.
function conflictEntry(ours, theirs) {
  const body = withoutTail(ours.lines);
  return {
    id: ours.id,
    title: ours.title,
    lines: [`${CONFLICT_MARK} ${ours.title} -->`, ...body, '', ...withoutTail(theirs.lines), ...ours.lines.slice(body.length)],
  };
}

// Повтор блока внутри стороны в результат не попадёт, и «+N / −0» тогда неверно — отчёт его
// называет. Считается по стороне: в общем `seen` повтор у theirs неотличим от блока ours.
function repeatedBlocks(parsed) {
  const seen = new Set();
  const repeats = [];
  for (const c of parsed.containers) {
    for (const b of c.blocks) {
      if (seen.has(b.id)) repeats.push(label(b));
      else seen.add(b.id);
    }
  }
  return repeats;
}

function indexBlocks(parsed) {
  const byId = new Map();
  for (const c of parsed.containers) for (const b of c.blocks) if (!byId.has(b.id)) byId.set(b.id, b);
  return byId;
}

function countEntries(parsed) {
  return parsed.containers.reduce((n, c) => n + c.blocks.filter((b) => b.title !== null).length, 0);
}

// Опознание блоков невыпущенного у базы слияния: только оно отличает «сторона сняла запись»
// от «у стороны её никогда не было».
function baseUnreleased(text, released) {
  const { sections } = splitSections(text);
  const at = unreleasedIndex(sections, released);
  if (at === -1) return { title: null, ids: new Set() };
  return { title: sections[at].title, ids: new Set(indexBlocks(parseSection(sections[at].lines)).keys()) };
}

// Односторонняя запись theirs встаёт за ближайшей предшествующей ей у theirs записью, уже лежащей
// в результате; такой нет — первой, общей в контейнере нет вовсе — в конец (ADR-043).
function insertionPoint(target, blocks, from) {
  for (let j = from - 1; j >= 0; j -= 1) {
    const at = target.blocks.findIndex((b) => b.id === blocks[j].id);
    if (at !== -1) return at + 1;
  }
  return blocks.some((b) => target.blocks.some((t) => t.id === b.id)) ? 0 : target.blocks.length;
}

const countLines = (lines, key) => {
  const counts = new Map();
  for (const raw of lines) {
    const k = key(raw);
    if (k !== null) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
};

const headingKey = (raw) => (HEADING.test(raw) || SUBGROUP.test(raw.trimEnd()) ? raw.trim() : null);

// Самопроверка результата до выдачи: нарушенный инвариант — отказ с причиной, а не предупреждение
// в stderr, который вызывающий не обязан читать (ADR-043).
function checkInvariants(merged, oursLines, theirsLines, report, lang) {
  const fails = [];
  const mergedHeads = countLines(merged, headingKey);
  const oursHeads = countLines(oursLines, headingKey);
  const theirsHeads = countLines(theirsLines, headingKey);
  for (const [title, n] of mergedHeads) {
    const limit = Math.max(oursHeads.get(title) ?? 0, theirsHeads.get(title) ?? 0);
    if (n > limit) {
      fails.push(msgBoth(lang,
        'heading “{title}” occurs {n} times in the section, at most {limit} on either side', { title, n, limit }));
    }
  }

  // Аддитивное слияние (ничто не снято по базе) не теряет ни строки ours: дифф против неё —
  // чистое `+N / −0`.
  if (!report.dropped.length) {
    const seen = countLines(merged, (raw) => (raw.trim() === '' ? null : raw.trim()));
    const lost = [];
    for (const [line, n] of countLines(oursLines, (raw) => (raw.trim() === '' ? null : raw.trim()))) {
      if ((seen.get(line) ?? 0) < n) lost.push(line);
    }
    if (lost.length && report.duplicatesOurs.length) {
      // Ours lines go missing when ours carries two blocks with one identity and the second is
      // dropped as a repeat: the refusal names the repeat, not a loss.
      fails.push(msgBoth(lang,
        'the ours side carries a repeated block and the second occurrence was dropped: {blocks}', {
          blocks: (l) => report.duplicatesOurs.map((d) => msg(l, '“{name}”', { name: d })).join(', '),
        }));
    }
  }

  if (fails.length) {
    throw new CliError(msgBoth(lang,
      'the merge failed its own check and the file was not handed over: {fails}', { fails: fails.join('; ') }));
  }
}

// `released(version)` — выпущена ли версия `X.Y.Z`; по умолчанию выпущена любая.
export function mergeChangelog(oursText, theirsText, baseText = null, lang = 'ru', released = () => true, eol = eolOf(oursText)) {
  const ours = splitSections(oursText);
  const theirs = splitSections(theirsText);
  const oursAt = unreleasedIndex(ours.sections, released);
  if (oursAt === -1) {
    throw new CliError(msgBoth(lang,
      '{changelog} on the --ours side has no unreleased section (a “## …” heading that does not start with a version, or a top section whose version has no tag)', { changelog: CHANGELOG_FILE }));
  }
  const theirsAt = unreleasedIndex(theirs.sections, released);
  const oursLines = ours.sections[oursAt].lines;
  const theirsLines = theirsAt === -1 ? [] : theirs.sections[theirsAt].lines;
  // Метка прошлого слияния в сливаемой секции — незакрытый конфликт: поверх неё вторая редакция
  // пропала бы как дубль. Ищется строка-метка и только в этой секции (docs/reference/02-cli.md).
  for (const [side, lines] of [['--ours', oursLines], ['--theirs', theirsLines]]) {
    if (countMarks(lines)) {
      throw new CliError(msgBoth(lang,
        'the unreleased section on the {side} side carries an unresolved {mark} mark: close the previous merge before merging on top of it', { side, mark: CONFLICT_MARK }));
    }
  }
  const oursSection = parseSection(oursLines);
  const theirsSection = theirsAt === -1 ? { lead: [], containers: [] } : parseSection(theirsLines);
  const theirsById = indexBlocks(theirsSection);
  // Заголовок записи опознаёт её глобально в пределах секции: та же запись, стоящая у сторон
  // в разных контейнерах, иначе легла бы дважды и покрасила гейт 7.
  const base = baseText === null ? null : baseUnreleased(baseText, released);
  const baseIds = base?.ids ?? null;

  const report = { section: { ours: ours.sections[oursAt].title, theirs: theirsAt === -1 ? null : theirs.sections[theirsAt].title, base: base?.title ?? null }, ours: countEntries(oursSection), theirs: countEntries(theirsSection), conflicts: [], onlyOurs: [], onlyTheirs: [], onlyOursPlain: [], onlyTheirsPlain: [], dropped: [], duplicatesOurs: repeatedBlocks(oursSection), duplicatesTheirs: repeatedBlocks(theirsSection), placed: [] };
  const merged = [];
  const byKey = new Map();
  const seen = new Set();

  // Раскладку задаёт ours: контейнеры и блоки — как есть, с теми же пустыми строками. Пустой
  // контейнер тоже: его заголовок написан рукой.
  for (const c of oursSection.containers) {
    const out = { key: c.key, heading: c.heading, open: c.open, blocks: [] };
    merged.push(out);
    byKey.set(c.key, out);
    for (const b of c.blocks) {
      if (seen.has(b.id)) continue;
      seen.add(b.id);
      const other = theirsById.get(b.id);
      if (other) {
        if (bodyOf(b) === bodyOf(other)) out.blocks.push(b);
        else {
          report.conflicts.push(b.title);
          out.blocks.push(conflictEntry(b, other));
        }
        continue;
      }
      // Без базы новизну от снятия не отличить — запись остаётся, отчёт называет её. Буллет без
      // заголовка по базе не снимается: «сняли» от «переписали» не отличить, потеря хуже дубля.
      if (b.title && baseIds?.has(b.id)) {
        report.dropped.push(b.title);
        continue;
      }
      (b.title ? report.onlyOurs : report.onlyOursPlain).push(label(b));
      out.blocks.push(b);
    }
  }

  const lastOf = (heading) => merged.findLastIndex((m) => m.heading === heading);
  const insert = (at, c) => {
    const out = { key: c.key, heading: c.heading, open: c.open, blocks: [] };
    merged.splice(at, 0, out);
    byKey.set(c.key, out);
    return out;
  };
  // A theirs-only container goes after the last one of its heading; a heading ours lacks comes
  // with its nearest theirs heading line, after the nearest group before it already placed.
  const place = (c) => {
    if (c.heading !== null && lastOf(c.heading) === -1) {
      const all = theirsSection.containers;
      const head = all.slice(0, all.indexOf(c) + 1).findLast((t) => t.heading === c.heading && t.subgroup === null);
      const prev = all.slice(0, all.indexOf(head)).findLast((t) => lastOf(t.heading) !== -1);
      const at = prev ? lastOf(prev.heading) + 1 : merged.length;
      const added = insert(at, head);
      report.placed.push({ heading: c.heading, subgroup: null, before: merged[at + 1]?.heading ?? null });
      if (head === c) return added;
    }
    report.placed.push({ heading: c.heading, subgroup: c.subgroup });
    return insert(c.heading === null && c.subgroup === null ? 0 : lastOf(c.heading) + 1, c);
  };

  for (const c of theirsSection.containers) {
    for (let i = 0; i < c.blocks.length; i += 1) {
      const b = c.blocks[i];
      if (seen.has(b.id)) continue;
      seen.add(b.id);
      if (b.title && baseIds?.has(b.id)) {
        report.dropped.push(b.title);
        continue;
      }
      (b.title ? report.onlyTheirs : report.onlyTheirsPlain).push(label(b));
      const target = byKey.get(c.key) ?? place(c);
      target.blocks.splice(insertionPoint(target, c.blocks, i), 0, b);
    }
  }

  report.merged = merged.reduce((n, c) => n + c.blocks.filter((b) => b.title !== null).length, 0);

  const section = [...oursSection.lead];
  for (const c of merged) {
    section.push(...c.open);
    for (const b of c.blocks) section.push(...b.lines);
  }
  // Отбивку до следующей секции задаёт ours: снятый по базе последний блок уносил её с собой.
  const tail = (lines) => lines.length - withoutTail(lines).length;
  for (let n = tail(oursLines) - tail(section); n > 0; n -= 1) section.push('');
  report.marks = countMarks(section);
  checkInvariants(section, oursLines, theirsLines, report, lang);

  const out = [...ours.head];
  ours.sections.forEach((s, i) => {
    out.push(`## ${s.title}`);
    out.push(...(i === oursAt ? section : s.lines));
  });
  const text = out.join(eol);
  return { text: text.endsWith(eol) ? text : `${text}${eol}`, report };
}

function readRevision(root, ref, lang) {
  const r = git(root, ['show', `${ref}:./${CHANGELOG_FILE}`]);
  if (r.status !== 0) {
    throw new CliError(msgBoth(lang, 'cannot read {ref}:{changelog} — {cause}', { ref, changelog: CHANGELOG_FILE, cause: (l) => gitCause(r, l) }));
  }
  return r.stdout;
}

// Выпущенной версию делает тег `vX.Y.Z` или `X.Y.Z`: пустой список тегов при сбое git молча
// сделал бы невыпущенной любую верхнюю секцию.
function taggedVersions(root, lang) {
  const r = git(root, ['tag', '--list']);
  if (r.status !== 0) {
    throw new CliError(msgBoth(lang, 'cannot read the tag list — {cause}', { cause: (l) => gitCause(r, l) }));
  }
  const tags = new Set(r.stdout.split('\n').map((t) => t.trim()).filter(Boolean));
  return (version) => tags.has(`v${version}`) || tags.has(version);
}

// An fs failure on --out is a refusal naming the path and the code, not a node:fs stack.
function onOut(file, lang, step) {
  try {
    return step();
  } catch (e) {
    throw new CliError(msgBoth(lang, 'cannot write --out {file}: {cause}', { file, cause: e.code ?? e.message }));
  }
}

export async function run(argv, { cwd, lang }) {
  const { values } = parseCommandArgs(argv, {
    ours: { type: 'string' }, theirs: { type: 'string' }, base: { type: 'string' }, out: { type: 'string' },
  }, { positionals: 0, lang });
  const root = findRoot(cwd) ?? path.resolve(cwd);
  if (!values.ours || !values.theirs) {
    throw new CliError(msgBoth(lang,
      'both --ours <ref> and --theirs <ref> are required: two CHANGELOG.md revisions from git'));
  }
  if (values.base !== undefined && !values.base.trim()) {
    throw new CliError(msgBoth(lang,
      '--base is empty: pass --base <ref>, the merge-base revision, or drop the flag'));
  }
  const out = values.out === undefined ? null : path.resolve(cwd, values.out);
  // An existing --out keeps its line endings: with core.autocrlf the blob is LF, the file CRLF.
  const onDisk = out === null ? '' : onOut(out, lang, () => (statSync(out, { throwIfNoEntry: false })?.isFile() ? readText(out) : ''));
  const oursText = readRevision(root, values.ours, lang);
  const { text, report } = mergeChangelog(
    oursText,
    readRevision(root, values.theirs, lang),
    values.base === undefined ? null : readRevision(root, values.base, lang),
    lang,
    taggedVersions(root, lang),
    onDisk.includes('\n') ? eolOf(onDisk) : eolOf(oursText),
  );
  if (out === null) process.stdout.write(text);
  else onOut(out, lang, () => writeText(out, text));

  note(msgBoth(lang,
    'entries: ours {ours}, theirs {theirs}, merged {merged}', { ours: report.ours, theirs: report.theirs, merged: report.merged }));
  if (report.section.theirs === null) {
    note(msgBoth(lang, 'theirs has no unreleased section — its entries were not read'));
  }
  for (const [side, title] of Object.entries(report.section)) {
    if (title !== null && sectionVersion(title) !== null) {
      note(msgBoth(lang, 'unreleased section in {side} — “{title}”: the version has no tag', { side, title }));
    }
  }
  if (out !== null) note(msgBoth(lang, 'written: {out}', { out: toPosix(path.relative(cwd, out)) }));
  for (const title of report.onlyOurs) note(msgBoth(lang, 'only in ours: {title}', { title }));
  for (const title of report.onlyTheirs) note(msgBoth(lang, 'only in theirs: {title}', { title }));
  // Буллеты без жирного заголовка идут отдельными строками и в счёт записей не входят: запись
  // опознаётся заголовком, а этот блок — своим текстом, и смешивать их счёт нельзя.
  for (const what of report.onlyOursPlain) note(msgBoth(lang, 'only in ours, bullet with no bold heading: {what}', { what }));
  for (const what of report.onlyTheirsPlain) note(msgBoth(lang, 'only in theirs, bullet with no bold heading: {what}', { what }));
  const section = `## ${report.section.ours}`;
  for (const { heading, subgroup, before } of report.placed) {
    if (subgroup !== null) note(msgBoth(lang, 'subgroup {subgroup} added under {heading}', { subgroup, heading: heading ?? section }));
    else if (heading === null) note(msgBoth(lang, 'entries without a heading added at the top of {section}', { section }));
    else if (before !== null) note(msgBoth(lang, 'heading {heading} added before {before}', { heading, before }));
    else note(msgBoth(lang, 'heading {heading} added at the end of {section}', { heading, section }));
  }
  // Снятый повтор называется всегда, а не только когда до отказа дошло: при `--base`,
  // снявшем хоть одну запись, отказа нет, а строка содержания всё равно пропала.
  for (const what of report.duplicatesOurs) note(msgBoth(lang, 'repeated block in ours, the second occurrence dropped: {what}', { what }));
  for (const what of report.duplicatesTheirs) note(msgBoth(lang, 'repeated block in theirs, the second occurrence dropped: {what}', { what }));
  for (const title of report.dropped) note(msgBoth(lang, 'removed relative to --base: {title}', { title }));
  if (report.conflicts.length) {
    warn(msgBoth(lang,
      'bodies differ under one heading — both revisions kept under the {mark} mark, decide yourself: {conflicts}', { mark: CONFLICT_MARK, conflicts: report.conflicts.join('; ') }));
  }
  if (values.base === undefined) {
    note(msgBoth(lang,
      'without --base a removed entry is indistinguishable from a neighbour’s new one — one-sided entries are kept'));
  }
  // Незакрытый конфликт — не успех. Счёт берётся по строкам-меткам сливаемой секции: то же
  // правило, что и на входе, иначе проза в код-спане выпущенной секции давала бы ложный отказ.
  const marks = report.marks;
  if (marks) {
    bad(msgBoth(lang,
      '{marks} {mark} mark(s) left in the result — the conflict is not closed: pick a revision and remove the mark', { marks, mark: CONFLICT_MARK }));
    return 1;
  }
  return 0;
}
