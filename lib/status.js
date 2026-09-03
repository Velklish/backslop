// Сводка состояния: то, что раньше давал индекс в README, теперь читается с диска по запросу.
// `--json` — тот же состав для оркестратора и скриптов.
import { loadProject } from './config.js';
import {
  FIELD_CREATED, FIELD_TAKEN, SECTION_DEFERRED, getField, queueOrder, readText, readTitle, scanTasks, sectionBody,
} from './tasks.js';
import { parseCommandArgs } from './util.js';

export function collectStatus(project) {
  const tasks = scanTasks(project);
  const row = (t, extra = {}) => {
    const text = readText(t.file);
    const title = readTitle(text);
    return {
      id: t.id,
      title: title ? title.title : null,
      file: t.rel,
      created: getField(text, FIELD_CREATED),
      ...extra(text),
    };
  };
  const queue = queueOrder(tasks).map((r) => row(r.task, () => ({ order: Number.isInteger(r.rank) ? r.rank : null })));
  const active = tasks.filter((t) => t.status === 'active').map((t) => row(t, (text) => ({ taken: getField(text, FIELD_TAKEN) })));
  const deferred = tasks.filter((t) => t.status === 'deferred').map((t) => row(t, (text) => ({
    deferred: firstLine(sectionBody(text, SECTION_DEFERRED)),
  })));
  const triage = tasks.filter((t) => t.status === 'triage').map((t) => row(t, () => ({})));
  const archive = tasks.filter((t) => t.status === 'archive').length;
  return { prefix: project.cfg.prefix, docs: project.cfg.docs, active, queue, deferred, triage, archive };
}

function firstLine(body) {
  if (!body) return null;
  return body.split('\n').map((l) => l.trim()).filter(Boolean)[0] ?? null;
}

export function renderStatus(s) {
  const lines = [];
  const name = (r) => `${r.id} · ${r.title ?? '(без заголовка)'}`;
  lines.push(`В работе (${s.active.length})`);
  for (const r of s.active) lines.push(`  ${name(r)}${r.taken ? ` — взята ${r.taken}` : ''}`);
  lines.push(`Очередь (${s.queue.length})`);
  for (const r of s.queue) lines.push(`  ${String(r.order ?? '?').padStart(4)}  ${name(r)}`);
  lines.push(`Отложено (${s.deferred.length})`);
  for (const r of s.deferred) lines.push(`  ${name(r)}${r.deferred ? ` — ${r.deferred}` : ''}`);
  lines.push(`Triage (${s.triage.length})`);
  for (const r of s.triage) lines.push(`  ${name(r)}`);
  lines.push(`Архив: ${s.archive}`);
  return `${lines.join('\n')}\n`;
}

export async function run(argv, { cwd }) {
  const { values } = parseCommandArgs(argv, { json: { type: 'boolean' } });
  const project = loadProject(cwd);
  const s = collectStatus(project);
  process.stdout.write(values.json ? `${JSON.stringify(s, null, 2)}\n` : renderStatus(s));
  return 0;
}
