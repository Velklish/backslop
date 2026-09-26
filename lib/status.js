// Сводка состояния: то, что раньше давал индекс в README, теперь читается с диска по запросу.
// `--json` — тот же состав для оркестратора и скриптов.
import { loadProject } from './config.js';
import {
  FIELD_AREA, FIELD_COST, FIELD_CREATED, FIELD_TAKEN, SECTION_DEFERRED, getField, queueOrder, readTitle, scanTasks, sectionBody,
} from './tasks.js';
import { parseCommandArgs, printJson, readText } from './util.js';
import { tr } from './i18n.js';
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
    deferred: firstLine(sectionBody(text, SECTION_DEFERRED)),
  })));
  const triage = tasks.filter((t) => t.status === 'triage').map((t) => row(t, () => ({})));
  // Minor читается по областям: так режутся пачки. Пустая область — в конец.
  const minor = tasks.filter((t) => t.status === 'minor')
    .map((t) => row(t, (text) => ({ area: getField(text, FIELD_AREA) || null, cost: getField(text, FIELD_COST) || null })))
    .sort((a, b) => (a.area === null) - (b.area === null) || String(a.area ?? '').localeCompare(String(b.area ?? '')));
  const archive = tasks.filter((t) => t.status === 'archive' && !t.into).length;
  return { prefix: project.cfg.prefix, docs: project.cfg.docs, active, queue, deferred, triage, minor, archive };
}

// Область в файле — ссылка на справочник; человеку печатается её текст.
function plainArea(area) {
  return area.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
}

function firstLine(body) {
  if (!body) return null;
  return splitLines(body).map((l) => l.trim()).filter(Boolean)[0] ?? null;
}

function renderStatus(s, lang = 'ru') {
  const lines = [];
  const name = (r) => `${r.id} · ${r.title ?? tr(lang, '(без заголовка)', '(untitled)')}`;
  lines.push(`${tr(lang, 'В работе', 'Active')} (${s.active.length})`);
  for (const r of s.active) lines.push(`  ${name(r)}${r.taken ? ` — ${tr(lang, 'взята', 'taken')} ${r.taken}` : ''}`);
  lines.push(`${tr(lang, 'Очередь', 'Queue')} (${s.queue.length})`);
  for (const r of s.queue) lines.push(`  ${String(r.order ?? '?').padStart(4)}  ${name(r)}`);
  lines.push(`${tr(lang, 'Отложено', 'Deferred')} (${s.deferred.length})`);
  for (const r of s.deferred) lines.push(`  ${name(r)}${r.deferred ? ` — ${r.deferred}` : ''}`);
  lines.push(`Triage (${s.triage.length})`);
  for (const r of s.triage) lines.push(`  ${name(r)}`);
  lines.push(`Minor (${s.minor.length})`);
  for (const r of s.minor) lines.push(`  [${r.area ? plainArea(r.area) : tr(lang, 'без области', 'no scope')}] ${name(r)}${r.cost ? ` — ${r.cost}` : ''}`);
  lines.push(`${tr(lang, 'Архив', 'Archive')}: ${s.archive}`);
  return `${lines.join('\n')}\n`;
}

export async function run(argv, { cwd }) {
  const { values } = parseCommandArgs(argv, { json: { type: 'boolean' } });
  const project = loadProject(cwd);
  const s = collectStatus(project);
  if (values.json) printJson(s);
  else process.stdout.write(renderStatus(s, project.cfg.lang));
  return 0;
}
