// Pure task functions: names, numbers, header, queue order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  FIELD_CREATED, FIELD_ORDER, FIELD_TAKEN, SECTION_DEFERRED, appendSection, getField, idMentionRe,
  foreignTaskIds, nextNumber, nextSub, parseId, placeInQueue, readTitle, removeField, sectionBody, sectionOccurrences, setField, taskDirRe, taskFileRe,
} from '../lib/tasks.js';
import { formatId } from '../lib/ids.js';
import { FIELD, SECTION, cleanup, cli, gitAll, makeProject, put, ru, ruCard, ruExpand, ruOutcomeWord, ruRe, ruResultHeading, run } from './helpers.mjs';
import { appendLogLines, batchOf, brokenLogLines, dateFromResult, formatLogLine, hasNamedOutcome, outcomeFromResult, parseLogLine } from '../lib/log.js';

const COMPLETED = ruOutcomeWord('completed');
const MERGED_BS4 = ruOutcomeWord('merged', 'BS-4');

test('task file name: number, sub-ID and slug', () => {
  const re = taskFileRe('BS');
  assert.deepEqual('BS-12-drop-index.md'.match(re).slice(1), ['12', undefined, 'drop-index']);
  assert.deepEqual('BS-12.3-finding.md'.match(re).slice(1), ['12', '3', 'finding']);
  assert.equal('bs-12-x.md'.match(re), null);
  assert.equal('BS-12-Drop.md'.match(re), null);
  assert.equal('BS-12-.md'.match(re), null);
  assert.deepEqual('BS-7.1-a-b'.match(taskDirRe('BS')).slice(1), ['7', '1', 'a-b']);
});

test('parsing a number from an argument', () => {
  assert.deepEqual(parseId('12', 'BS'), { num: 12, sub: null });
  assert.deepEqual(parseId('BS-12.3', 'BS'), { num: 12, sub: 3 });
  assert.deepEqual(parseId('bs-4', 'BS'), { num: 4, sub: null });
  assert.throws(() => parseId('x12', 'BS'), ruRe('task number “{raw}” is invalid: expected N or N.k, optionally prefixed with {prefix}-'));
  assert.equal(formatId('BS', 12, 3), 'BS-12.3');
});

test('mentions in text: BS-12.3 is not read as BS-12', () => {
  const found = [...'see BS-12, BS-12.3 and BS-7; BSX-1 and ABS-2 are not ours'.matchAll(idMentionRe('BS'))].map((m) => m[0]);
  assert.deepEqual(found, ['BS-12', 'BS-12.3', 'BS-7']);
});

test('the next number and sub-ID are counted over all statuses and the archive', () => {
  const tasks = [
    { num: 3, sub: null, status: 'queue' },
    { num: 9, sub: null, status: 'archive' },
    { num: 9, sub: 2, status: 'triage' },
    { num: 5, sub: 1, status: 'active' },
  ];
  assert.equal(nextNumber(tasks), 10);
  assert.equal(nextSub(tasks, 9), 3);
  assert.equal(nextSub(tasks, 3), 1);
  assert.equal(nextNumber([]), 1);
});

// Header fields in file order, first occurrence wins: shows the key order setField produces.
function readFields(text) {
  const fields = new Map();
  for (const line of text.split('\n')) {
    if (line.startsWith('## ')) break;
    const m = line.match(/^- \*\*([^*:\n]+):\*\*[ \t]*(.*)$/);
    if (m && !fields.has(m[1].trim())) fields.set(m[1].trim(), m[2].trim());
  }
  return fields;
}

const HEADER = ruCard('BS-1', 'Title', { area: '[x](../reference/a.md)', created: '2026-09-03' }, [['context', 'text']]);
const REASON_LINE = ru('- **Reason:** [TODO]').replace('[TODO]', 'no runner');

test('header: title, fields, replace and insert', () => {
  assert.deepEqual(readTitle(HEADER), { id: 'BS-1', title: 'Title' });
  assert.deepEqual([...readFields(HEADER).keys()], [FIELD.area, FIELD.created]);
  const taken = setField(HEADER, FIELD_TAKEN, '2026-09-04');
  assert.deepEqual([...readFields(taken).keys()], [FIELD.area, FIELD.created, FIELD.taken]);
  const ordered = setField(taken, FIELD_ORDER, '30');
  assert.deepEqual([...readFields(ordered).keys()], [FIELD.order, FIELD.area, FIELD.created, FIELD.taken]);
  assert.equal(readFields(setField(ordered, FIELD_ORDER, '40')).get(FIELD.order), '40');
  assert.equal(removeField(removeField(ordered, FIELD_ORDER), FIELD_TAKEN), HEADER);
  assert.equal(removeField(HEADER, 'No such field'), HEADER);
});

test('header: a field is inserted into a file without fields through blank lines', () => {
  const bare = `# BS-2 · Bare\n\n## ${SECTION.context}\n`;
  const withField = setField(bare, FIELD_ORDER, '10');
  assert.equal(withField, `# BS-2 · Bare\n\n- **${FIELD.order}:** 10\n\n## ${SECTION.context}\n`);
  assert.equal(setField(`# BS-3 · No blank\n## ${SECTION.context}\n`, FIELD_ORDER, '10'),
    `# BS-3 · No blank\n\n- **${FIELD.order}:** 10\n\n## ${SECTION.context}\n`);
});

test('header: RU and EN metadata are read together, new labels are chosen by lang', () => {
  const mixed = `# BS-4 · Mixed\n\n- **Created:** 2026-09-03\n- **${FIELD.order}:** 10\n- **Taken:** 2026-09-04\n\n## Deferred\n\nreason\n`;
  assert.equal(getField(mixed, FIELD_CREATED), '2026-09-03');
  assert.equal(getField(mixed, FIELD_ORDER), '10');
  assert.equal(getField(mixed, FIELD_TAKEN), '2026-09-04');
  assert.equal(sectionBody(mixed, SECTION_DEFERRED), 'reason');
  assert.match(setField(mixed, FIELD_ORDER, '20', 'en'), /- \*\*Order:\*\* 20/);
  assert.match(appendSection('# BS-5 · English\n', SECTION_DEFERRED, 'reason', 'en'), /## Deferred/);
});

test('header: reading and writing a duplicated field use the first occurrence and collapse aliases', () => {
  const duplicate = `# BS-6 · Duplicate\n\n- **Order:** 30\n- **${FIELD.order}:** 25\n- **Order:** 20\n`;
  assert.equal(getField(duplicate, FIELD_ORDER), '30');
  const changed = setField(duplicate, FIELD_ORDER, '5');
  assert.equal(getField(changed, FIELD_ORDER), '5');
  assert.equal((changed.match(/^- \*\*[^*]+:\*\*/gm) ?? []).length, 1);
  assert.doesNotMatch(changed, new RegExp(`Order:\\*\\* 25|Order:\\*\\* 20|${FIELD.order}:\\*\\* 25|${FIELD.order}:\\*\\* 20`));
  assert.doesNotMatch(removeField(duplicate, FIELD_ORDER), new RegExp(`Order|${FIELD.order}`));
});

test('sections: the body up to the next heading and appending at the end', () => {
  assert.equal(sectionBody(HEADER, SECTION.context), 'text');
  assert.equal(sectionBody(HEADER, SECTION.deferred), null);
  const withDeferred = appendSection(HEADER, SECTION.deferred, REASON_LINE);
  assert.equal(sectionBody(withDeferred, SECTION.deferred), REASON_LINE);
  assert.equal(sectionBody(withDeferred, SECTION.context), 'text');
  const indented = `# BS-6 · Indent\n\n  ## ${SECTION.deferred}\n\n${REASON_LINE}\n\n  ## ${SECTION.context}\n\ntext\n`;
  assert.equal(sectionBody(indented, SECTION.deferred), REASON_LINE);
  assert.equal(sectionBody(indented, SECTION.context), 'text');
  assert.equal(sectionBody(`# BS-7 · Code\n\n    ## ${SECTION.deferred}\n\n    not a section\n`, SECTION.deferred), null);
});
test('sections: a heading inside a fenced example is not counted as a repeat', () => {
  const text = `${HEADER}\n## ${SECTION.deferred}\n\nexample\n\`\`\`markdown\n## ${SECTION.deferred}\n\`\`\`\n`;
  assert.equal(sectionOccurrences(text, SECTION_DEFERRED), 1);
  assert.equal(sectionOccurrences(text.replace(`## ${SECTION.deferred}\n\nexample\n`, ''), SECTION_DEFERRED), 0);
  assert.equal(sectionBody(text.replace(`## ${SECTION.deferred}\n\nexample\n`, ''), SECTION_DEFERRED), null);
});


const row = (num, rank) => ({ task: { num, sub: null, file: `f${num}` }, rank });

test('queue place: the end, the top, after a task, the middle between neighbours', () => {
  const rows = [row(1, 10), row(2, 20), row(3, 30)];
  assert.deepEqual(placeInQueue(rows), { rank: 40, renumbered: [] });
  assert.deepEqual(placeInQueue([]), { rank: 10, renumbered: [] });
  assert.deepEqual(placeInQueue(rows, { after: { num: 1, sub: null } }, 'BS'), { rank: 15, renumbered: [] });
  assert.deepEqual(placeInQueue(rows, { after: { num: 3, sub: null } }, 'BS'), { rank: 40, renumbered: [] });
  assert.deepEqual(placeInQueue([row(1, 30)], { top: true }), { rank: 15, renumbered: [] });
  assert.throws(() => placeInQueue(rows, { after: { num: 9, sub: null } }, 'BS'), ruRe('task {label} is not in the queue — --after expects a task from queue/', { label: 'BS-9' }));
});

test('queue place: without a whole place the queue is renumbered in steps of 10', () => {
  const tight = [row(1, 1), row(2, 2), row(3, 3)];
  const top = placeInQueue(tight, { top: true });
  assert.equal(top.rank, 10);
  assert.deepEqual(top.renumbered, [['f1', 20], ['f2', 30], ['f3', 40]]);
  const mid = placeInQueue(tight, { after: { num: 1, sub: null } });
  assert.equal(mid.rank, 20);
  assert.deepEqual(mid.renumbered, [['f1', 10], ['f2', 30], ['f3', 40]]);
});

test('queue place: a saved rank no later than the batch neighbour', () => {
  const rows = [row(9, 5), row(1, 10), row(2, 20)];
  const nine = { num: 9, sub: null };
  assert.deepEqual(placeInQueue(rows, { rank: 8, before: nine }), { rank: 2, renumbered: [], bounded: true }, 'a free number behind the neighbour');
  assert.deepEqual(placeInQueue(rows, { rank: 20, before: nine }), { rank: 2, renumbered: [], bounded: true }, 'a taken number behind the neighbour');
  assert.deepEqual(placeInQueue(rows, { rank: 5, before: nine }), { rank: 2, renumbered: [] }, 'the number is taken by the neighbour itself — the usual "before the taker"');
  assert.deepEqual(placeInQueue(rows, { rank: 3, before: nine }), { rank: 3, renumbered: [] }, 'a number ahead of the neighbour is not touched by the neighbour');
  assert.deepEqual(placeInQueue(rows, { rank: 3, before: { num: 2, sub: null } }), { rank: 3, renumbered: [] });
  const tight = placeInQueue([row(1, 1), row(9, 2), row(2, 3)], { rank: 3, before: nine });
  assert.deepEqual(tight, { rank: 20, renumbered: [['f1', 10], ['f9', 30], ['f2', 40]], bounded: true }, 'tight — renumbering, the task stands before the neighbour');
});

test('queue place: a --restore batch lies in ascending order of the saved numbers — exhaustive search', () => {
  // A model of the `mv <N…> queue --restore` loop: descending saved numbers, equal ones by number,
  // each next one with `before` on the one placed before it. The seed is fixed: the search repeats.
  let seed = 30;
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = (lo, hi) => lo + Math.floor(random() * (hi - lo + 1));
  const byRank = (a, b) => a.rank - b.rank || a.task.num - b.task.num;
  const restore = (queue, batch, bound) => {
    const rows = queue.map((r) => ({ ...r }));
    let previous = null;
    let bounded = 0;
    for (const b of [...batch].sort((x, y) => y.saved - x.saved || y.task.num - x.task.num)) {
      rows.sort(byRank);
      const placed = placeInQueue(rows, { rank: b.saved, before: bound ? previous : null });
      const renumbered = new Map(placed.renumbered);
      for (const r of rows) r.rank = renumbered.get(r.task.file) ?? r.rank;
      rows.push({ task: b.task, rank: placed.rank });
      if (placed.bounded) bounded += 1;
      previous = b.task;
    }
    const got = rows.sort(byRank).filter((r) => r.task.file.startsWith('b')).map((r) => r.task.num);
    const want = [...batch].sort((x, y) => x.saved - y.saved || x.task.num - y.task.num).map((b) => b.task.num);
    return { inverted: got.join() !== want.join(), bounded };
  };

  const RUNS = 100_000;
  let inverted = 0;
  let unbounded = 0;
  let bounded = 0;
  for (let i = 0; i < RUNS; i += 1) {
    const queue = Array.from({ length: pick(1, 4) }, (_, k) => ({ task: { num: 50 + k, sub: null, file: `q${k}` }, rank: pick(1, 14) }));
    const batch = Array.from({ length: pick(2, 4) }, (_, k) => ({ task: { num: k + 1, sub: null, file: `b${k}` }, saved: pick(1, 14) }));
    const run = restore(queue, batch, true);
    if (run.inverted) inverted += 1;
    bounded += run.bounded;
    if (restore(queue, batch, false).inverted) unbounded += 1;
  }
  assert.equal(inverted, 0, `${inverted} configurations of ${RUNS} — restored not in ascending order of the saved numbers`);
  assert.ok(unbounded > 0, 'without a bounding neighbour the search must find inversions — else it does not see the defect');
  assert.ok(bounded > 0, 'the search never reached the neighbour bound');
});

// --- the journal of closed tasks -----------------------------------------------------------------

test('journal line: parsing, reassembly, a broken line is not read as an entry', () => {
  const line = `- <a id="bs-12.3"></a>\`BS-12.3-finding\` · 2026-09-03 · ${MERGED_BS4} · \`a1b2c3d4e5\` · Title · with a dot`;
  const e = parseLogLine(line, 'BS');
  assert.deepEqual(
    { id: e.id, num: e.num, sub: e.sub, slug: e.slug, date: e.date, outcome: e.outcome, commit: e.commit, title: e.title, anchor: e.anchor },
    { id: 'BS-12.3', num: 12, sub: 3, slug: 'finding', date: '2026-09-03', outcome: MERGED_BS4, commit: 'a1b2c3d4e5', title: 'Title · with a dot', anchor: 'bs-12.3' },
  );
  assert.equal(formatLogLine({ id: 'BS-12.3', slug: 'finding', date: '2026-09-03', outcome: MERGED_BS4, commit: 'a1b2c3d4e5', title: 'Title · with a dot' }), line);
  // A commit and an outcome the fold did not recognise — a long dash; the line stays parseable.
  const bare = formatLogLine({ id: 'BS-1', slug: 'a', date: '2026-09-03', outcome: '—', commit: null, title: null });
  assert.equal(bare, '- <a id="bs-1"></a>`BS-1-a` · 2026-09-03 · — · — · —');
  assert.equal(parseLogLine(bare, 'BS').commit, null);
  assert.equal(parseLogLine('- an ordinary list item', 'BS'), null);
  assert.equal(parseLogLine(`- <a id="bs-1"></a>\`BS-1-a\` · yesterday · ${COMPLETED} · — · A`, 'BS'), null);
  assert.deepEqual(brokenLogLines('- <a id="bs-1"></a>garbage\n- an ordinary item\n', 'BS').map((b) => b.line), [1]);
});

test('the outcome is read from the first paragraph of result.md, in both language forms; not named — a dash', () => {
  const result = (body) => `${ruResultHeading('BS-1')}\n\n${body}\n\n**${SECTION.verification}.** Here the word ${ruOutcomeWord('rejected')} means nothing.\n`;
  assert.equal(outcomeFromResult(result(ruExpand('**{Closed.0} 2026-09-03.** {Completed.0}. Summary.')), 'BS', 'ru'), COMPLETED);
  assert.equal(outcomeFromResult(result('**Closed 2026-09-03.** Completed. Done.'), 'BS', 'ru'), COMPLETED);
  assert.equal(outcomeFromResult(result(ruExpand('**{Closed.0} 2026-09-03.** {Rejected.0}.')), 'BS', 'en'), 'rejected');
  assert.equal(outcomeFromResult(result(ruExpand('**{Closed.0} 2026-09-03.** {Merged.0} {into} [BS-14](../BS-14-x/task.md). {Completed.0} there.')), 'BS', 'ru'), ruOutcomeWord('merged', 'BS-14'));
  assert.equal(outcomeFromResult(result('Settled by option (b).'), 'BS', 'ru'), '—');
});

test('batch: batchOf reads the batch number in RU and EN', () => {
  assert.equal(batchOf(ruExpand('{batch} BS-4')), 'BS-4');
  assert.equal(batchOf('batch BS-4'), 'BS-4');
  assert.equal(batchOf(COMPLETED), null);
});

// The heading and the first paragraph are modelled on the consumers’ history, the Russian outcome
// words are `ruExpand` tokens filled from the parser vocabulary; `cut`: the paragraph is cut short.
const expandRu = (e) => (e.id.startsWith('PB') ? e : { ...e, heading: e.heading && ruExpand(e.heading), paragraph: e.paragraph && ruExpand(e.paragraph), phrase: e.phrase && ruExpand(e.phrase), outcome: ruExpand(e.outcome) });
const EVIDENCE = JSON.parse(readFileSync(new URL('./fixtures/outcome-first-paragraphs.json', import.meta.url), 'utf8')).map(expandRu);

test('the outcome is the first dictionary word by position: entries a dictionary scan named with the wrong outcome', () => {
  assert.equal(EVIDENCE.length, 15);
  const got = EVIDENCE.map((e) => {
    const [prefix] = e.id.split('-');
    const text = `${e.heading}\n\n${e.paragraph}\n\n## ${SECTION.verification}\n\nBelow the paragraph “${ruOutcomeWord('rejected')}” and “${ruOutcomeWord('merged', `${prefix}-1`)}” are not an outcome.\n`;
    return [e.id, outcomeFromResult(text, prefix, prefix === 'PB' ? 'en' : 'ru')];
  });
  assert.deepEqual(got, EVIDENCE.map((e) => [e.id, e.outcome]));
});

test('outcome by position: a leading word beats prose, a merge — only with a number right after the form, a negation is not a merge', () => {
  const inRu = (body) => outcomeFromResult(`${ruResultHeading('BS-1')}\n\n${ruExpand(body)}\n`, 'BS', 'ru');
  assert.equal(inRu('{Merged.0} {into} BS-14. {Completed.0} there.'), ruOutcomeWord('merged', 'BS-14'));
  assert.equal(inRu('Completed. Rejected option recorded.'), COMPLETED);
  assert.equal(inRu('{Completed.0}; the option with a flag is {rejectedMasculine}.'), COMPLETED);
  assert.equal(inRu('**{Closed.0}.** {Not} {merged.0} {into} BS-3: another subject.'), COMPLETED);
  assert.equal(inRu('Closed; not merged into BS-3.'), COMPLETED);
  assert.equal(inRu('{Merged.1} {into} main.'), '—');
  assert.equal(inRu('Merged into it, BS-3 is the rest.'), '—');
  assert.equal(inRu('{Merged.0} {into} `BS-7`.'), ruOutcomeWord('merged', 'BS-7'));
  assert.equal(inRu('{Merged.0} {into} BL-7.'), '—', 'the number of a foreign project is not a merge');
  assert.equal(inRu('**{Closed.0} 2026-08-30.** The two-copies checker gate is {rejectedMasculine}: the list is short.'), COMPLETED, 'the masculine is a rejected option, not the task');
  assert.equal(inRu('{Rejected.1} by the owner’s decision.'), ruOutcomeWord('rejected'));
  assert.equal(inRu('{Closed.0} {rejected.3}.'), ruOutcomeWord('rejected'));
  assert.equal(inRu('{Rejected.3-} from the plan — in the section below.'), '—');
  assert.equal(inRu('**{Closed.0} 2026-09-24** {with} {rejected.3} from the definition: the flag is not set up.'), COMPLETED, '"with a deviation" is a course of work, not an outcome');
  // A heading "— result: <outcome>": a source equal to the brackets, weaker than a paragraph.
  assert.equal(outcomeFromResult('# PB-1 — Result: rejected\n\n**Closed 2026-09-01.**\n', 'PB', 'en'), 'rejected');
  assert.equal(outcomeFromResult(ruExpand('# BL-1 — {result}: {rejected.0}\n\n{Completed.0}.\n'), 'BL', 'ru'), COMPLETED);
  assert.equal(outcomeFromResult(ruExpand('# BL-1 · {Result}\n\n**{Closed.0}:** 2026-08-31.\n\n{result}: {rejected.0}\n'), 'BL', 'ru'), COMPLETED);
});

// The headings and the first paragraphs below are shaped like real result.md lines: keep the form.
test('closing date: the first paragraph beats the result.md heading, the heading — in the form "(<outcome> YYYY-MM-DD)"', () => {
  assert.equal(dateFromResult(ruExpand('# BL-005 — {result} ({rejected.4} 2026-08-13)\n\nThe plan changed.\n')), '2026-08-13');
  assert.equal(dateFromResult(ruExpand('# BL-001 — {result} ({completed.0} 2026-07-30)\n\n**{Outcome}:** {closed.0}.\n')), '2026-07-30');
  assert.equal(dateFromResult(ruExpand('# BL-001 — {result} ({completed.0} 2026-07-30)\n\n**{Closed.0} 2026-08-30.** Run 0830c, worker sync-doctor; review xhigh.\n')), '2026-08-30');
  assert.equal(dateFromResult('# PB-40 · Result\n\n**Outcome:** completed — closed by PB-37 (ADR-005), item by item.\n'), null);
  assert.equal(dateFromResult(ruExpand('# BS-1 · {Result} 2026-07-30\n\n**{Closed.0}.** {Completed.0}.\n')), null, 'the heading date is read only in brackets');
});

test('outcome of old archives: the heading “(<outcome> DATE)”, a bare “closed” in Russian and “Closed” / “Done” in English; a named outcome beats a bare one', () => {
  const result = (head, body) => `${ruExpand(head)}\n\n${ruExpand(body)}\n\n**${SECTION.verification}.** Gates are green.\n`;
  assert.equal(outcomeFromResult(result('# BL-005 — {result} ({rejected.4} 2026-08-13)', 'The plan changed.'), 'BL', 'ru'), ruOutcomeWord('rejected'));
  assert.equal(outcomeFromResult(result('# BL-001 — {result} ({completed.0} 2026-07-30)', 'Settled by option (b).'), 'BL', 'en'), 'completed');
  assert.equal(outcomeFromResult(result('# BL-7 · {Result}', '**{Closed.0} 2026-08-30.** Run 0830c, worker sync-doctor; review xhigh.'), 'BL', 'ru'), COMPLETED);
  assert.equal(outcomeFromResult(result('# PB-9 · Result', '**Closed 2026-09-05.** Done.'), 'PB', 'en'), 'completed');
  assert.equal(outcomeFromResult(result('# BL-8 · {Result}', '**{Outcome}:** {closed.0}.'), 'BL', 'ru'), COMPLETED);
  assert.equal(outcomeFromResult(result('# PB-40 · Result', '**Outcome:** completed — closed by PB-37 (ADR-005), item by item.'), 'PB', 'en'), 'completed');
  assert.equal(outcomeFromResult(result('# PB-41 · Result', '**Closed as dead weight removed, not as a defect fixed.**'), 'PB', 'en'), 'completed');
  // A bare "closed" is an outcome while there is no other word in the paragraph or the heading;
  // the paragraph beats the heading.
  assert.equal(outcomeFromResult(result('# BL-005 — {result} ({rejected.4} 2026-08-13)', '**{Closed.0} 2026-08-13.** The plan changed.'), 'BL', 'ru'), ruOutcomeWord('rejected'));
  assert.equal(outcomeFromResult(result('# BL-001 — {result} ({rejected.0} 2026-07-30)', '**{Closed.0} 2026-07-30.** {Completed.0}.'), 'BL', 'ru'), COMPLETED);
  assert.equal(outcomeFromResult(result('# BL-9 · {Result} ({merged.0} {into} BL-3 2026-08-01)', '{Duplicate}.'), 'BL', 'ru'), ruOutcomeWord('merged', 'BL-3'));
  // A merge and a withdrawal with a date or markup inside the form.
  assert.equal(outcomeFromResult(result('# BL-472 · {Result}', '**{Merged.0} 2026-09-03 {into} [BL-470](../BL-470-canary-env-hygiene/task.md)** while sorting Triage.'), 'BL', 'ru'), ruOutcomeWord('merged', 'BL-470'));
  assert.equal(outcomeFromResult(result('# BL-173 · {Result}', '{Closed.0}: 2026-08-27. {Outcome} — **{merged.0}** {into} [BL-172](../BL-172-reviewer-spawn-task-and-name/task.md), the work is there.'), 'BL', 'ru'), ruOutcomeWord('merged', 'BL-172'));
  assert.equal(outcomeFromResult(result('# BL-055 · {Result}', '{Closed.0}: 2026-08-27. {Outcome} — **{rejected.4} by the owner’s decision**, the live Cursor IDE run is not held.'), 'BL', 'ru'), ruOutcomeWord('rejected'));
  assert.equal(outcomeFromResult(result('# BL-107 · {Result}', '{Withdrawn.0}: 2026-08-26. Moot — the gate whose estimate it fixed is removed whole.'), 'BL', 'ru'), ruOutcomeWord('rejected'));
  // A word inside a word is not an outcome; a bare "withdrawn" is an outcome only as the first word
  // of the paragraph: a withdrawn stub does not reject the task.
  assert.equal(outcomeFromResult(result('# PB-42 · Result', 'Abandoned; the flaw was disclosed upstream.'), 'PB', 'en'), '—');
  assert.equal(outcomeFromResult(result('# BL-10 · {Result}', '**{Closed.0} 2026-08-02.** {Withdrawn.0} the transitional form, the stub is {withdrawn.0}.'), 'BL', 'ru'), COMPLETED);
});

test('the Russian and English outcome markers without a dictionary word read as a bare “closed”; the Russian marker word without a colon is not a marker', () => {
  const read = (id, body, lang = 'ru') => outcomeFromResult(ruExpand(`# ${id} · {Result}\n\n${body}\n\n## ${SECTION.verification}\n\n{Rejected.0} below the paragraph — not an outcome.\n`), id.split('-')[0], lang);
  assert.equal(read('BL-641.3', '**{Outcome}: both forms are understood, there are two levers — one per form.**'), COMPLETED);
  assert.equal(read('BL-642.1', '**{Outcome}: {withdrawnNoun} of the tool leaves no trace, and the right to remove is proved positively.**'), COMPLETED);
  assert.equal(read('BL-642.2', '**{Outcome}: in a service repository `doctor` answers, not refuses by looking for the root.**'), COMPLETED);
  assert.equal(read('PB-1', '**Outcome:** the reviewer keeps the diff.', 'en'), 'completed');
  assert.equal(read('BL-1', '**{Outcome}: {rejected.0}** — the subject is gone.'), ruOutcomeWord('rejected'), 'a dictionary word after the marker decides by itself');
  assert.equal(read('BL-1', '**{Outcome}: {withdrawn.0}** together with the subject.'), COMPLETED, 'a word outside the table or “withdrawn” not as the first word after the marker — as “Refusal: moot”');
  assert.equal(read('PB-1', '**Outcome:** abandoned; the flaw was disclosed upstream.', 'en'), 'completed');
  assert.equal(read('BL-1', '{Outcome} of the dispute will be decided by the owner.'), '—');
  assert.equal(read('BL-1', '**{Outcome} — both forms are understood.**'), '—', 'a form with a dash is not a marker');
  assert.equal(read('BL-1', '{OutcomePlural}: two, both in the section below.'), '—');
  // The marker is the fallback of folding old entries, not an outcome word: gate 5 and `fold N`
  // do not accept it.
  assert.equal(hasNamedOutcome(ruExpand('# BL-1 · {Result}\n\n**{Outcome}: both forms are understood.**\n'), 'BL'), false);
});

test('the “merged by” form with a number is a merge, like “merged into”: the project number right after the form, a negation is cut off', () => {
  const read = (body) => outcomeFromResult(ruExpand(`# BL-1 · {Result}\n\n${body}\n`), 'BL', 'ru');
  assert.equal(read('**{Closed.0} 2026-09-12 {merged.3} {into} `BL-624.1`.**'), ruOutcomeWord('merged', 'BL-624.1'));
  assert.equal(read('**{Closed.0} 2026-09-12 {merged.3} {into} `BL-604`.**'), ruOutcomeWord('merged', 'BL-604'));
  assert.equal(read('**{Closed.0} 2026-09-12 {merged.3} {into} `BL-565.2`.**'), ruOutcomeWord('merged', 'BL-565.2'));
  assert.equal(read('**{Closed.0}.** {Not} {merged.3} {into} BL-3: another subject.'), COMPLETED);
  assert.equal(read('**{Closed.0}** {merged.3} {into} main.'), COMPLETED);
  assert.equal(hasNamedOutcome(ruExpand('# BL-1 · {Result}\n\n**{Closed.0} 2026-09-12 {merged.3} {into} `BL-604`.**\n'), 'BL'), true);
});

// The first phrases of consumer entries whose outcome the journal names otherwise; “…” is a
// shortening, paths are cut.
const UNREAD = JSON.parse(readFileSync(new URL('./fixtures/outcome-unread-residue.json', import.meta.url), 'utf8')).map(expandRu);

test('known residue: “closed by refusal”, “but not completed”, “Outcome — withdrawn”, a duplicate without “merged”, a word about a foreign task — are not read by the owner’s decision, the verdict keeps the current reading', () => {
  assert.equal(UNREAD.length, 7);
  const got = UNREAD.map((e) => {
    const [prefix] = e.id.split('-');
    return [e.id, outcomeFromResult(`${ruResultHeading(e.id)}\n\n${e.phrase}\n`, prefix, prefix === 'PB' ? 'en' : 'ru')];
  });
  assert.deepEqual(got, UNREAD.map((e) => [e.id, e.outcome]));
});

test('appending to the journal: a blank line between prose and the first entry, none between entries', () => {
  const head = '# Journal\n\nProse.\n';
  const one = appendLogLines(head, ['- <a id="bs-1"></a>x']);
  assert.equal(one, '# Journal\n\nProse.\n\n- <a id="bs-1"></a>x\n');
  assert.equal(appendLogLines(one, ['- <a id="bs-2"></a>y']), '# Journal\n\nProse.\n\n- <a id="bs-1"></a>x\n- <a id="bs-2"></a>y\n');
  assert.equal(appendLogLines('', ['- <a id="bs-1"></a>x']), '- <a id="bs-1"></a>x\n');
  assert.equal(appendLogLines('# Journal\n\nProse.\n\n', ['- <a id="bs-1"></a>x']), '# Journal\n\nProse.\n\n- <a id="bs-1"></a>x\n');
});

test('foreignTaskIds: a docs path spelled ./docs or docs/ still sees the numbers taken on other branches', () => {
  for (const docs of ['./docs', 'docs/']) {
    const root = makeProject({ docs });
    try {
      put(root, 'docs/backlog/triage/BS-1-a.md', '# BS-1 · a\n');
      gitAll(root, 'BS-1: a');
      run(root, ['checkout', '-q', '-b', 'worker']);
      put(root, 'docs/backlog/triage/BS-2-b.md', '# BS-2 · b\n');
      gitAll(root, 'BS-2: b');
      run(root, ['checkout', '-q', 'main']);
      const found = foreignTaskIds({ root, cfg: { prefix: 'BS', docs } }, 'en');
      assert.deepEqual(found.map((f) => `${f.num} ${f.source}`).sort(), ['1 branch main', '2 branch worker'], docs);
    } finally {
      cleanup(root);
    }
  }
});

test('new: docs/backlog or a status directory that is a file is refused naming the path, not a stack', () => {
  const cases = [
    ['docs/backlog', ['new', 'x'], 'docs/backlog'],
    ['docs/backlog/queue', ['new', 'x', '--queue'], 'docs/backlog/queue'],
    ['docs/backlog/minor', ['new', 'x', '--parent', '1', '--minor', '--evidence', 'e'], 'docs/backlog/minor'],
  ];
  for (const [rel, args, named] of cases) {
    const root = makeProject({ git: false });
    try {
      put(root, 'docs/backlog/queue/BS-1-a.md', '# BS-1 · a\n');
      rmSync(path.join(root, ...rel.split('/')), { recursive: true, force: true });
      put(root, rel, 'x\n');
      const r = cli(root, args);
      assert.equal(r.code, 1, `${rel}: ${r.out}`);
      assert.ok(r.err.startsWith(`✖ ${ru('{rel} is a file, expected a directory', { rel: named })}`), `${rel}: ${r.err}`);
      assert.doesNotMatch(r.err, /ENOTDIR|EEXIST|node:fs|\n\s+at /, `${rel}: a stack`);
    } finally {
      cleanup(root);
    }
  }
});

test('foreignTaskIds: a status directory, archive/ or an archive minor/ that is a file in another worktree is skipped', () => {
  const root = makeProject();
  const parent = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-wt-')));
  const wt = path.join(parent, 'other');
  try {
    put(root, 'docs/backlog/triage/BS-1-a.md', '# BS-1 · a\n');
    gitAll(root, 'BS-1: a');
    run(root, ['worktree', 'add', '-q', wt, '-b', 'other']);
    put(wt, 'docs/backlog/triage/BS-2-b.md', '# BS-2 · b\n');
    put(wt, 'docs/archive/BS-3-c/task.md', '# BS-3 · c\n');
    rmSync(path.join(wt, 'docs/backlog/queue'), { recursive: true, force: true });
    put(wt, 'docs/backlog/queue', 'x\n');
    mkdirSync(path.join(wt, 'docs/archive/BS-4-d'), { recursive: true });
    put(wt, 'docs/archive/BS-4-d/minor', 'x\n');
    const found = foreignTaskIds({ root, cfg: { prefix: 'BS', docs: 'docs' } }, 'en');
    const fromWorktree = found.filter((f) => f.source.startsWith('worktree')).map((f) => f.num).sort();
    assert.deepEqual(fromWorktree, [1, 2, 3, 4]);
  } finally {
    cleanup(root);
    rmSync(parent, { recursive: true, force: true });
  }
});

test('foreignTaskIds: archive/ that is a file in another worktree is skipped, the other numbers are found', () => {
  const root = makeProject();
  const parent = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-wt-')));
  const wt = path.join(parent, 'other');
  try {
    put(root, 'docs/backlog/triage/BS-1-a.md', '# BS-1 · a\n');
    gitAll(root, 'BS-1: a');
    run(root, ['worktree', 'add', '-q', wt, '-b', 'other']);
    put(wt, 'docs/backlog/triage/BS-2-b.md', '# BS-2 · b\n');
    rmSync(path.join(wt, 'docs/archive'), { recursive: true, force: true });
    put(wt, 'docs/archive', 'x\n');
    const found = foreignTaskIds({ root, cfg: { prefix: 'BS', docs: 'docs' } }, 'en');
    const fromWorktree = found.filter((f) => f.source.startsWith('worktree')).map((f) => f.num).sort();
    assert.deepEqual(fromWorktree, [1, 2]);
  } finally {
    cleanup(root);
    rmSync(parent, { recursive: true, force: true });
  }
});
