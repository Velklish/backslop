// Слияние двух рабочих редакций CHANGELOG.md по единицам его структуры. Стратегия git тут
// не годится: `-X ours`/`-X theirs` берут файл одной стороны целиком и молча теряют записи
// соседнего track'а. Сливается только первая секция невыпущенного — заголовки выпущенных
// секций повторяются в каждом релизе, и объединять их нечего.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { CHANGELOG_ENTRY } from './lint.js';
import { CliError, bad, git, parseCommandArgs, toPosix, warn } from './util.js';
import { findRoot, loadConfig } from './config.js';
import { tr } from './i18n.js';

const CHANGELOG_FILE = 'CHANGELOG.md';
const SECTION = /^## (.+)$/;
const VERSION_IN_TITLE = /v?\d+\.\d+\.\d+/;
// Заголовок уровнем ниже секции: `### Fixed`. Под `CHANGELOG_ENTRY` он не подпадает, и без
// отдельного правила уезжал бы в тело предыдущей записи вместе со всем хвостом секции —
// отсюда и дубль заголовка при сборке, и ложное расхождение тел (BS-65).
const HEADING = /^#{3,6} \S/;
// Жирная подгруппа внутри секции: `**Для пользователя workspace:**` отдельной строкой.
// Под `CHANGELOG_ENTRY` она не подпадает, а принадлежность записи к ней сохраняется.
const SUBGROUP = /^\*\*.+\*\*$/;
// Буллет верхнего уровня без жирного заголовка. Записью он не является, но и продолжением
// соседней записи тоже: продолжение идёт с отступом, а этот начинается с первой колонки.
const PLAIN_ITEM = /^[-*+] /;

export const CONFLICT_MARK = '<!-- backslop:conflict';
// Метка — строка целиком, а не подстрока где угодно: имя метки, набранное прозой в код-спане
// («оставляет обе редакции под меткой `<!-- backslop:conflict … -->`»), стоит в CHANGELOG
// любого проекта, который про неё написал, и меткой не является. Отступ не допускается:
// `conflictEntry` ставит метку с первой колонки, а поблажка вернула бы ту же беду для имени
// метки в отступном блоке кода.
const MARK_LINE = /^<!-- backslop:conflict/;
const countMarks = (lines) => lines.filter((line) => MARK_LINE.test(line)).length;

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

// Нет секции без номера — невыпущенной считается верхняя, если у её версии нет тега: так её
// оставляет `release --bump` до релиза (ADR-030).
function unreleasedIndex(sections, released) {
  const at = sections.findIndex((s) => !VERSION_IN_TITLE.test(s.title));
  if (at !== -1 || !sections.length) return at;
  return released(sections[0].title.match(VERSION_IN_TITLE)[0].replace(/^v/, '')) ? -1 : 0;
}

const bodyOf = (block) => block.lines.join('\n').trim();
// Чем блок зовётся в отчёте: запись — своим заголовком, буллет без заголовка — началом текста.
// Безымянный блок тоже обязан называться: односторонний буллет, приехавший молча, — та самая
// поверхность, ради которой заведена BS-65, вывод команды принимают не глядя.
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

// Контейнеры секции и их блоки. Разбор обратим: склейка `open` и строк блоков подряд даёт
// ровно те строки, что пришли. Поэтому аддитивное слияние — вставка блоков, а не пересборка
// файла, и косметическая переразметка в дифф не попадает.
//
// `lead` — строки до первого заголовка, подгруппы и записи: проза шапки секции остаётся на
// месте. Контейнер — пара «заголовок + подгруппа»: `### Added` открывает свой, вложенная
// `**Для агента:**` — свой под ним. Блок — запись `- **…**` или буллет без жирного
// заголовка; блок без заголовка опознаётся собственным текстом.
function parseSection(lines) {
  const lead = [];
  const containers = [];
  let heading = null;
  let container = null;
  let block = null;

  const start = (nextHeading, subgroup, open) => {
    heading = nextHeading;
    container = { key: `${nextHeading ?? ''}\u0000${subgroup ?? ''}`, open, blocks: [] };
    containers.push(container);
    block = null;
  };

  for (const raw of lines) {
    if (HEADING.test(raw)) { start(raw.trim(), null, [raw]); continue; }
    if (SUBGROUP.test(raw.trim())) { start(heading, raw.trim(), [raw]); continue; }
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

// Разошедшиеся тела одного заголовка команда не выбирает — это решение агента. Обе записи
// остаются под меткой: markdown её не показывает, grep находит, гейт 7 краснеет на дубле
// заголовка, а сама команда выходит ненулём и называет метку.
function conflictEntry(ours, theirs) {
  const body = withoutTail(ours.lines);
  return {
    id: ours.id,
    title: ours.title,
    lines: [`${CONFLICT_MARK} ${ours.title} -->`, ...body, '', ...withoutTail(theirs.lines), ...ours.lines.slice(body.length)],
  };
}

// Повтор блока внутри одной стороны: второе вхождение того же опознания в результат не
// попадёт. Молчать об этом нельзя — снаружи слияние проверяют разностью строк, и «+N / −0»
// в таком прогоне уже неверно. Считается по стороне, а не по ходу слияния: в общем `seen`
// повтор у theirs неотличим от блока, который просто уже пришёл от ours.
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

// Куда встаёт односторонняя запись theirs. Сразу за ближайшей предшествующей ей у theirs
// записью, которая уже лежит в результате: соседство сохраняется. Такой нет — значит запись
// стояла у своей стороны первой, и первой же встаёт здесь, это и есть конвенция «новое
// сверху». Общей записи в контейнере нет вовсе — опереться не на что, и запись дописывается
// в конец, как решил ADR-013.
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

const headingKey = (raw) => (HEADING.test(raw) || SUBGROUP.test(raw.trim()) ? raw.trim() : null);
const entryKey = (raw) => raw.match(CHANGELOG_ENTRY)?.[1] ?? null;

// Самопроверка результата до его выдачи. В v0.9.0 команда отдавала файл с дублем заголовка,
// тремя вхождениями одной записи и переразметкой всего CHANGELOG — и выходила нулём, потому
// что собственный вывод не смотрела (BS-65). Нарушенный инвариант — отказ с названной
// причиной, а не предупреждение в stderr: вызывающий не обязан читать stderr глазами.
function checkInvariants(merged, oursLines, theirsLines, report, lang) {
  const fails = [];
  const mergedHeads = countLines(merged, headingKey);
  const oursHeads = countLines(oursLines, headingKey);
  const theirsHeads = countLines(theirsLines, headingKey);
  for (const [title, n] of mergedHeads) {
    const limit = Math.max(oursHeads.get(title) ?? 0, theirsHeads.get(title) ?? 0);
    if (n > limit) {
      fails.push(tr(lang,
        `заголовок «${title}» встречается в секции ${n} раз, у сторон не больше ${limit}`,
        `heading “${title}” occurs ${n} times in the section, at most ${limit} on either side`));
    }
  }

  // Граница — не сумма по сторонам: сумма недостижима, потому что заголовок опознаёт запись
  // один раз, и проверка была бы мёртвой. Достижимая граница — одно вхождение, а под меткой
  // конфликта два: ровно столько кладёт `conflictEntry`, оставляя обе редакции.
  const mergedEntries = countLines(merged, entryKey);
  const conflicted = new Set(report.conflicts);
  for (const [title, n] of mergedEntries) {
    const limit = conflicted.has(title) ? 2 : 1;
    if (n > limit) {
      fails.push(tr(lang,
        `запись «${title}» встречается в секции ${n} раз, допустимо ${limit}`,
        `entry “${title}” occurs ${n} times in the section, ${limit} allowed`));
    }
  }

  // Аддитивное слияние — то, в котором ничто не снято по базе. В нём ни одна строка
  // содержания стороны ours не имеет права пропасть: дифф результата против неё чисто
  // добавочный, и это то самое `+N / −0`, которым слияние проверяется снаружи.
  if (!report.dropped.length) {
    const seen = countLines(merged, (raw) => (raw.trim() === '' ? null : raw.trim()));
    const lost = [];
    for (const [line, n] of countLines(oursLines, (raw) => (raw.trim() === '' ? null : raw.trim()))) {
      if ((seen.get(line) ?? 0) < n) lost.push(line);
    }
    if (lost.length && report.duplicatesOurs.length) {
      // Единственный достижимый путь сюда: сторона ours несёт два блока с одним опознанием,
      // и второй снят как дубль. Причина — повтор, а не потеря, и называть надо её.
      fails.push(tr(lang,
        `сторона ours несёт повтор блока, второе вхождение снято: ${report.duplicatesOurs.map((d) => `«${d}»`).join(', ')}`,
        `the ours side carries a repeated block and the second occurrence was dropped: ${report.duplicatesOurs.map((d) => `“${d}”`).join(', ')}`));
    } else if (lost.length) {
      fails.push(tr(lang,
        `аддитивное слияние потеряло строк стороны ours: ${lost.length}, первая — «${lost[0]}»`,
        `an additive merge lost ${lost.length} line(s) of the ours side, the first being “${lost[0]}”`));
    }
  }

  if (fails.length) {
    throw new CliError(tr(lang,
      `слияние не прошло собственную проверку, файл не отдан: ${fails.join('; ')}`,
      `the merge failed its own check and the file was not handed over: ${fails.join('; ')}`));
  }
}

// `released(version)` — выпущена ли версия `X.Y.Z`; по умолчанию выпущена любая.
export function mergeChangelog(oursText, theirsText, baseText = null, lang = 'ru', released = () => true) {
  const ours = splitSections(oursText);
  const theirs = splitSections(theirsText);
  const oursAt = unreleasedIndex(ours.sections, released);
  if (oursAt === -1) {
    throw new CliError(tr(lang,
      `${CHANGELOG_FILE} стороны --ours: нет секции невыпущенного (заголовок «## …» без номера версии или верхняя секция с версией без тега)`,
      `${CHANGELOG_FILE} on the --ours side has no unreleased section (a “## …” heading without a version, or a top section whose version has no tag)`));
  }
  const theirsAt = unreleasedIndex(theirs.sections, released);
  const oursLines = ours.sections[oursAt].lines;
  const theirsLines = theirsAt === -1 ? [] : theirs.sections[theirsAt].lines;
  // Метка прошлого слияния во входной секции — не данные, а незакрытый конфликт. Сливать
  // поверх неё нельзя: обе редакции под меткой идут под одним заголовком, и вторая пропала бы
  // как дубль. Ищется строка-метка и только в сливаемой секции: подстрока по всему файлу
  // считала меткой собственное имя метки, набранное прозой в код-спане, и команда отказывала
  // на любом CHANGELOG, который про неё написан.
  for (const [side, lines] of [['--ours', oursLines], ['--theirs', theirsLines]]) {
    if (countMarks(lines)) {
      throw new CliError(tr(lang,
        `секция невыпущенного стороны ${side} несёт незакрытую метку ${CONFLICT_MARK}: разбери прошлое слияние, прежде чем сливать поверх`,
        `the unreleased section on the ${side} side carries an unresolved ${CONFLICT_MARK} mark: close the previous merge before merging on top of it`));
    }
  }
  const oursSection = parseSection(oursLines);
  const theirsSection = theirsAt === -1 ? { lead: [], containers: [] } : parseSection(theirsLines);
  const theirsById = indexBlocks(theirsSection);
  // Заголовок записи опознаёт её глобально в пределах секции: та же запись, стоящая у сторон
  // в разных контейнерах, иначе легла бы дважды и покрасила гейт 7.
  const base = baseText === null ? null : baseUnreleased(baseText, released);
  const baseIds = base?.ids ?? null;

  const report = { section: { ours: ours.sections[oursAt].title, theirs: theirsAt === -1 ? null : theirs.sections[theirsAt].title, base: base?.title ?? null }, ours: countEntries(oursSection), theirs: countEntries(theirsSection), conflicts: [], onlyOurs: [], onlyTheirs: [], onlyOursPlain: [], onlyTheirsPlain: [], dropped: [], duplicatesOurs: repeatedBlocks(oursSection), duplicatesTheirs: repeatedBlocks(theirsSection) };
  const merged = [];
  const byKey = new Map();
  const seen = new Set();

  // Сторона ours задаёт раскладку: её контейнеры и блоки переносятся как есть, в том же
  // порядке и с теми же пустыми строками. Пустой контейнер тоже переносится — его заголовок
  // написан рукой, и выбрасывать его значило бы удалять строку.
  for (const c of oursSection.containers) {
    const out = { key: c.key, open: c.open, blocks: [] };
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
      // Без базы «запись новая у ours» и «запись снята стороной theirs» не различить —
      // запись сохраняется, а её односторонность называет отчёт. Буллет без жирного
      // заголовка по базе не снимается вовсе: он опознаётся собственным текстом, и «сняли»
      // от «переписали» там неотличимо, а потеря текста хуже дубля.
      if (b.title && baseIds?.has(b.id)) {
        report.dropped.push(b.title);
        continue;
      }
      (b.title ? report.onlyOurs : report.onlyOursPlain).push(label(b));
      out.blocks.push(b);
    }
  }

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
      let target = byKey.get(c.key);
      if (!target) {
        target = { key: c.key, open: c.open, blocks: [] };
        merged.push(target);
        byKey.set(c.key, target);
      }
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
  const text = out.join('\n');
  return { text: text.endsWith('\n') ? text : `${text}\n`, report };
}

function readRevision(root, ref, lang) {
  const r = git(root, ['show', `${ref}:./${CHANGELOG_FILE}`]);
  if (r.status !== 0) {
    const why = (r.stderr ?? '').trim() || r.error?.message || `код ${r.status}`;
    throw new CliError(tr(lang, `не читается ${ref}:${CHANGELOG_FILE} — ${why}`, `cannot read ${ref}:${CHANGELOG_FILE} — ${why}`));
  }
  return r.stdout;
}

// Выпущенной версию делает тег `vX.Y.Z` или `X.Y.Z`: пустой список тегов при сбое git молча
// сделал бы невыпущенной любую верхнюю секцию.
function taggedVersions(root, lang) {
  const r = git(root, ['tag', '--list']);
  if (r.status !== 0) {
    const why = (r.stderr ?? '').trim() || r.error?.message || `код ${r.status}`;
    throw new CliError(tr(lang, `не читается список тегов — ${why}`, `cannot read the tag list — ${why}`));
  }
  const tags = new Set(r.stdout.split('\n').map((t) => t.trim()).filter(Boolean));
  return (version) => tags.has(`v${version}`) || tags.has(version);
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
    taggedVersions(root, lang),
  );
  if (values.out === undefined) process.stdout.write(text);
  else writeFileSync(path.resolve(root, values.out), text);

  note(tr(lang,
    `записей: ours ${report.ours}, theirs ${report.theirs}, в результате ${report.merged}`,
    `entries: ours ${report.ours}, theirs ${report.theirs}, merged ${report.merged}`));
  if (report.section.theirs === null) {
    note(tr(lang, 'у theirs нет секции невыпущенного — записи theirs не читались', 'theirs has no unreleased section — its entries were not read'));
  }
  for (const [side, title] of Object.entries(report.section)) {
    if (title !== null && VERSION_IN_TITLE.test(title)) {
      note(tr(lang, `секция невыпущенного у ${side} — «${title}»: тега у версии нет`, `unreleased section in ${side} — “${title}”: the version has no tag`));
    }
  }
  if (values.out !== undefined) note(tr(lang, `записано: ${toPosix(path.relative(root, path.resolve(root, values.out)))}`, `written: ${toPosix(path.relative(root, path.resolve(root, values.out)))}`));
  for (const title of report.onlyOurs) note(tr(lang, `только у ours: ${title}`, `only in ours: ${title}`));
  for (const title of report.onlyTheirs) note(tr(lang, `только у theirs: ${title}`, `only in theirs: ${title}`));
  // Буллеты без жирного заголовка идут отдельными строками и в счёт записей не входят: запись
  // опознаётся заголовком, а этот блок — своим текстом, и смешивать их счёт нельзя.
  for (const what of report.onlyOursPlain) note(tr(lang, `только у ours, буллет без заголовка: ${what}`, `only in ours, bullet with no bold heading: ${what}`));
  for (const what of report.onlyTheirsPlain) note(tr(lang, `только у theirs, буллет без заголовка: ${what}`, `only in theirs, bullet with no bold heading: ${what}`));
  // Снятый повтор называется всегда, а не только когда до отказа дошло: при `--base`,
  // снявшем хоть одну запись, отказа нет, а строка содержания всё равно пропала.
  for (const what of report.duplicatesOurs) note(tr(lang, `повтор блока у ours, второе вхождение снято: ${what}`, `repeated block in ours, the second occurrence dropped: ${what}`));
  for (const what of report.duplicatesTheirs) note(tr(lang, `повтор блока у theirs, второе вхождение снято: ${what}`, `repeated block in theirs, the second occurrence dropped: ${what}`));
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
  // Незакрытый конфликт — не успех. Счёт берётся по строкам-меткам сливаемой секции: то же
  // правило, что и на входе, иначе проза в код-спане выпущенной секции давала бы ложный отказ.
  const marks = report.marks;
  if (marks) {
    bad(tr(lang,
      `в результате осталось меток ${CONFLICT_MARK}: ${marks} — конфликт не закрыт, выбери редакцию и убери метку`,
      `${marks} ${CONFLICT_MARK} mark(s) left in the result — the conflict is not closed: pick a revision and remove the mark`));
    return 1;
  }
  return 0;
}
