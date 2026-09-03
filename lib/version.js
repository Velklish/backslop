// Версия инструмента и сравнение версий. Одно число на пакет: оно же уезжает в пин `cli`
// и в штамп `version` конфига проекта.
import { readFileSync } from 'node:fs';

export const TOOL_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

// «1.2.3» или «v1.2.3» → [1, 2, 3]; иное — null. Предрелизных суффиксов у backslop нет.
export function parseVersion(raw) {
  const m = String(raw ?? '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function normalizeVersion(raw) {
  const p = parseVersion(raw);
  return p ? p.join('.') : null;
}

export function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) throw new Error(`версия не разбирается: «${pa ? b : a}»`);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

// Старшая из строк-версий без `v`; строки не по форме пропускаются.
export function latestVersion(versions) {
  let best = null;
  for (const v of versions) {
    const n = normalizeVersion(v);
    if (n === null) continue;
    if (best === null || compareVersions(n, best) > 0) best = n;
  }
  return best;
}
