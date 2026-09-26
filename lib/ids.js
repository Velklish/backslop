// Task ids: the `<prefix>-N[.k]` form, its parsing, the slug and file stem, the commit subject.
// A leaf module: lib/log.js reads ids too and cannot import lib/tasks.js.
import { escapeRe } from './util.js';

export const SLUG_SRC = '[a-z0-9]+(?:-[a-z0-9]+)*';

export function formatId(prefix, num, sub = null) {
  return sub === null || sub === undefined ? `${prefix}-${num}` : `${prefix}-${num}.${sub}`;
}

// «12», «BS-12», «12.3», «bs-12.3» → { num, sub }; anything else → null.
export function matchId(raw, prefix) {
  const m = String(raw ?? '').trim().match(new RegExp(`^(?:${escapeRe(prefix)}-)?(\\d+)(?:\\.(\\d+))?$`, 'i'));
  return m ? { num: Number(m[1]), sub: m[2] === undefined ? null : Number(m[2]) } : null;
}

// Stem of a task file name or archive directory; groups: number, sub-number, slug.
export function taskStemSrc(prefix) {
  return `${escapeRe(prefix)}-(\\d+)(?:\\.(\\d+))?-(${SLUG_SRC})`;
}

// A commit subject of the task: `<prefix>-N:` or `<prefix>-N.k:`, numbers compared numerically.
export function taskSubjectRe(prefix, id) {
  return new RegExp(`^${escapeRe(prefix)}-0*${id.num}${id.sub === null ? '' : `\\.0*${id.sub}`}:`);
}
