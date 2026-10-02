// The state summary: what the README index used to give is now read from disk on request.
// `--json` is the same content for the orchestrator and scripts.
import process from 'node:process';
import { loadProject } from './config.js';
import {
  FIELD_AREA, FIELD_COST, FIELD_CREATED, FIELD_RE, FIELD_TAKEN, SECTION_DEFERRED, getField, isTodoPlaceholder, queueOrder, readTitle, scanTasks, sectionBody, warnLinkedOut,
} from './tasks.js';
import { parseCommandArgs, printJson, readText } from './util.js';
import { msg } from './i18n.js';
import { splitLines } from './text.js';

function collectStatus(project) {
  const tasks = scanTasks(project);
  const row = (t, extra) => {
    const text = readText(t.file);
    const title = readTitle(text);
    return {
      id: t.id,
      title: title ? title.title : null,
      file: t.rel,
      created: getField(text, FIELD_CREATED) || null,
      ...extra(text),
    };
  };
  const queue = queueOrder(tasks).map((r) => row(r.task, () => ({ order: Number.isInteger(r.rank) ? r.rank : null })));
  const active = tasks.filter((t) => t.status === 'active').map((t) => row(t, (text) => ({ taken: getField(text, FIELD_TAKEN) || null })));
  const deferred = tasks.filter((t) => t.status === 'deferred').map((t) => row(t, (text) => ({
    deferred: deferredReason(sectionBody(text, SECTION_DEFERRED)),
  })));
  const triage = tasks.filter((t) => t.status === 'triage').map((t) => row(t, () => ({})));
  // Minor is read by area: that is how batches are cut. An empty area goes last.
  const minor = tasks.filter((t) => t.status === 'minor')
    .map((t) => row(t, (text) => ({ area: getField(text, FIELD_AREA) || null, cost: getField(text, FIELD_COST) || null })))
    .sort((a, b) => (a.area === null) - (b.area === null) || String(a.area ?? '').localeCompare(String(b.area ?? '')));
  const archive = tasks.filter((t) => t.status === 'archive' && !t.into).length;
  return { prefix: project.cfg.prefix, docs: project.cfg.docs, active, queue, deferred, triage, minor, archive };
}

// An area in the file is a link into the reference; a person gets its text printed.
function plainArea(area) {
  return area.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
}

// The Reason label of both layers, taken from the line `mv` writes into a Deferred section.
const REASON_LABELS = new Set([msg('en', '- **Reason:** [TODO]'), msg('ru', '- **Reason:** [TODO]')]
  .map((line) => line.match(FIELD_RE)[1]));

// The text of the Reason line; null for an empty value or the `[TODO]` stub. A section without a
// Reason line gives its first non-empty line that is not a field line.
function deferredReason(body) {
  if (!body) return null;
  const lines = splitLines(body).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const m = line.match(FIELD_RE);
    if (m && REASON_LABELS.has(m[1])) return m[2] === '' || isTodoPlaceholder(m[2]) ? null : m[2].trim();
  }
  return lines.find((line) => !FIELD_RE.test(line)) ?? null;
}

function renderStatus(s, lang = 'ru') {
  const lines = [];
  const name = (r) => `${r.id} · ${r.title ?? msg(lang, '(untitled)')}`;
  lines.push(`${msg(lang, 'Active')} (${s.active.length})`);
  for (const r of s.active) lines.push(`  ${name(r)}${r.taken ? ` — ${msg(lang, 'taken')} ${r.taken}` : ''}`);
  lines.push(`${msg(lang, 'Queue')} (${s.queue.length})`);
  for (const r of s.queue) lines.push(`  ${String(r.order ?? '?').padStart(4)}  ${name(r)}`);
  lines.push(`${msg(lang, 'Deferred')} (${s.deferred.length})`);
  for (const r of s.deferred) lines.push(`  ${name(r)}${r.deferred ? ` — ${r.deferred}` : ''}`);
  lines.push(`Triage (${s.triage.length})`);
  for (const r of s.triage) lines.push(`  ${name(r)}`);
  lines.push(`Minor (${s.minor.length})`);
  for (const r of s.minor) lines.push(`  [${r.area ? plainArea(r.area) : msg(lang, 'no scope')}] ${name(r)}${r.cost ? ` — ${r.cost}` : ''}`);
  lines.push(`${msg(lang, 'Archive')}: ${s.archive}`);
  return `${lines.join('\n')}\n`;
}

export async function run(argv, { cwd, lang }) {
  const { values } = parseCommandArgs(argv, { json: { type: 'boolean' } }, { positionals: 0, lang });
  const project = loadProject(cwd);
  const s = collectStatus(project);
  warnLinkedOut(project);
  if (values.json) printJson(s);
  else process.stdout.write(renderStatus(s, project.cfg.lang));
  return 0;
}
