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

// Both texts of the refusal head for a stamp newer than the tool; each command adds its own tail.
// No `tr` here: scripts/release.mjs loads this module with util.js alone.
export function stampNewerHead(version) {
  return {
    ru: `штамп v${version} новее инструмента v${TOOL_VERSION}: обнови установку или пин в cli`,
    en: `version stamp v${version} is newer than tool v${TOOL_VERSION}: update the installation or cli pin`,
  };
}

// Старшая из строк-версий без `v`; строки не по форме пропускаются.
export function latestVersion(versions) {
  let best = null;
  for (const v of versions) {
    const n = normalizeVersion(v);
    if (best === null || compareVersions(n, best) > 0) best = n;
  }
  return best;
}
