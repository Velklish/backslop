import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const HOME_PATH = /(?:\/(?:Users|home)\/|[A-Za-z]:\\Users\\)([^\s/\\<>"'`]+)[/\\]/g;
const EXAMPLE_USER = /^(?:me|user|username|example)$/i;
const PRIVATE_HOST = /\.(?:internal|intranet|corp|lan|local)$/i;

// Exact Backslop verification receipts, not a list of private names or whole-file exemptions.
export const LOCATION_EVIDENCE = [
  {
    file: 'docs/backlog/active/BS-247.1-lock-test-release-handshake.md',
    heading: '## Verification',
    sha256: 'd854a51c50e24c6840aba8efa31319deb78b3c154fc09abdfed605b08e091ecd',
  },
  {
    file: 'docs/backlog/active/BS-247.2-isolate-upgrade-fixture-signing.md',
    heading: '## Verification',
    sha256: '620a162e48cd9c471772a88cca86fd8337a369f28b497c60f1872055451ccd4f',
  },
  {
    file: 'docs/backlog/active/BS-247.3-check-init-fixture-git-results.md',
    heading: '## Verification',
    sha256: '29926688b58c9a774fc30c4fa69e4a03823b830319dae73990a16e50939c95bd',
  },
  {
    file: 'docs/backlog/active/BS-247.4-replace-node-only-startup-probe.md',
    heading: '## Evidence',
    sha256: '4fe4cd98a08e38ed800207eab90e91d5c59f50afcf75a9311ac9f514251f20c0',
  },
  {
    file: 'docs/backlog/minor/BS-247.10-correct-changelog-export-docs.md',
    heading: '## Evidence',
    sha256: 'c6a69bd7d5dcb290577ffc8322c592359c02de2d375855cceb73287126350a36',
  },
];

function prose(rel, line) {
  if (rel !== 'docs/archive/LOG.md' || !line.startsWith('- <a id="')) return line;
  const cells = line.split(' · ');
  return cells.length < 5 ? line : [cells[2], ...cells.slice(4)].join(' · ');
}

// Structural indicators only; deciding whether a narrative belongs here still requires review.
export function boundaryLines(rel, text) {
  if (rel.startsWith('templates/vendor/')) return [];
  const lines = text.replaceAll('\r\n', '\n').split('\n');
  const hits = lines.flatMap((original, i) => {
    const line = prose(rel, original).replaceAll('\\\\', '\\');
    const home = [...line.matchAll(HOME_PATH)].some((match) => !EXAMPLE_USER.test(match[1]));
    const network = [...line.matchAll(/\bhttps?:\/\/([^\s/<>"'`\\)]+)/g)]
      .some((match) => PRIVATE_HOST.test(match[1].split(/[?#]/)[0].replace(/:\d+$/, '').replace(/\.$/, '')));
    return home || network ? [i + 1] : [];
  });
  const entry = LOCATION_EVIDENCE.find((item) => item.file === rel);
  if (!entry) return hits;
  const start = lines.indexOf(entry.heading);
  if (start < 0 || lines.lastIndexOf(entry.heading) !== start) return hits;
  const next = lines.findIndex((line, i) => i > start && line.startsWith('## '));
  const end = next < 0 ? lines.length : next;
  const recorded = hits.filter((n) => n > start + 1 && n <= end);
  const digest = createHash('sha256').update(recorded.map((n) => lines[n - 1]).join('\n')).digest('hex');
  return digest === entry.sha256 ? hits.filter((n) => !recorded.includes(n)) : hits;
}

export function repositoryBoundary(root) {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0').filter((rel) => rel && existsSync(path.join(root, rel)));
  const violations = files.flatMap((rel) => boundaryLines(rel, readFileSync(path.join(root, rel), 'utf8'))
    .map((line) => `${rel}:${line}`));
  return { files, violations };
}
