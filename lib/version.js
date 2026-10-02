// The tool version and version comparison. One number per package: it is also the `cli` pin
// and the `version` stamp of the project config.
import { readFileSync } from 'node:fs';
import { msg } from './i18n.js';

export const TOOL_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

// "1.2.3" or "v1.2.3" → [1, 2, 3]; anything else → null. backslop has no prerelease suffixes.
function parseVersion(raw) {
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
  if (!pa || !pb) throw new Error(msg('ru', 'version does not parse: “{raw}”', { raw: pa ? b : a }));
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

// The refusal head for a stamp newer than the tool; each command adds its own tail.
export function stampNewerHead(version, lang) {
  return msg(lang, 'version stamp v{version} is newer than tool v{tool}: update the installation or cli pin', { version, tool: TOOL_VERSION });
}

// The highest of the version strings, without `v`; null for none. A string that does not parse
// is skipped at the start of the list and throws once a valid one precedes it.
export function latestVersion(versions) {
  let best = null;
  for (const v of versions) {
    const n = normalizeVersion(v);
    if (best === null || compareVersions(n, best) > 0) best = n;
  }
  return best;
}
