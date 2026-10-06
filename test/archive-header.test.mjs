import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parseLogLine, renderOutcome } from '../lib/log.js';
import { renderProjectTemplate } from '../lib/templates.js';
import { cleanup, cli, gitAll, makeProject, put, read, run } from './helpers.mjs';

for (const lang of ['en', 'ru']) {
  test(`archive header fixture: ${lang} bulk fold keeps body revisions and batch adjacency`, () => {
    const root = makeProject();
    try {
      const cfg = { ...JSON.parse(read(root, 'backslop.json')), lang, cli: 'node bin/backslop.js' };
      put(root, 'backslop.json', `${JSON.stringify(cfg, null, 2)}\n`);
      const vars = { cli: cfg.cli ?? 'backslop', prefix: cfg.prefix };
      const archiveReadme = renderProjectTemplate(cfg, 'docs/archive/README.md', vars);
      put(root, 'docs/archive/README.md', archiveReadme);
      const command = (...args) => {
        const result = cli(root, args);
        assert.equal(result.code, 0, `${args.join(' ')}: ${result.err}`);
        return result;
      };
      command('new', 'parent', '--title', 'Parent');
      command('new', 'batch', '--title', 'Batch');
      command('new', 'later', '--title', 'Later');
      command('new', 'earlier', '--title', 'Earlier');
      command('new', 'finding', '--parent', '1', '--minor', '--evidence', 'A recorded finding.');
      for (const [number, slug, date] of [[2, 'batch', '2026-09-03'], [3, 'later', '2026-09-03'], [4, 'earlier', '2026-09-02']]) {
        command('archive', String(number));
        put(root, `docs/archive/BS-${number}-${slug}/result.md`,
          `# BS-${number} — result\n\n**Closed ${date}.** ${renderOutcome('completed', null, lang)}. Initial result.\n`);
      }
      command('archive', '1.1', '--into', '2');
      gitAll(root, 'Close the fixture tasks');
      const closing = run(root, ['rev-parse', 'HEAD']).stdout.trim();
      const batch = 'docs/archive/BS-2-batch';
      put(root, `${batch}/result.md`, `${read(root, `${batch}/result.md`)}\nA result edit after closure.\n`);
      gitAll(root, 'Edit the batch result after closure');
      const resultRevision = run(root, ['rev-parse', 'HEAD']).stdout.trim();
      put(root, 'docs/archive/BS-3-later/notes.txt', 'An attachment saved after closure.\n');
      gitAll(root, 'Save an attachment after closure');
      const attachmentRevision = run(root, ['rev-parse', 'HEAD']).stdout.trim();
      const bodyFiles = [
        `${batch}/task.md`, `${batch}/result.md`, `${batch}/minor/BS-1.1-finding.md`,
        'docs/archive/BS-3-later/task.md', 'docs/archive/BS-3-later/result.md',
        'docs/archive/BS-4-earlier/task.md', 'docs/archive/BS-4-earlier/result.md',
      ];
      const bodies = new Map(bodyFiles.map((rel) => [rel, read(root, rel)]));
      const folded = command('fold');
      const log = read(root, 'docs/archive/LOG.md');
      const lines = log.split('\n').filter((line) => line.startsWith('- <a id='));
      const entries = lines.map((line) => parseLogLine(line, cfg.prefix));
      assert.ok(entries.every(Boolean), 'each line retains the five-field journal format');
      assert.deepEqual(entries.map((entry) => entry.id), ['BS-4', 'BS-2', 'BS-1.1', 'BS-3']);
      assert.deepEqual(entries.map((entry) => entry.date), ['2026-09-02', '2026-09-03', '2026-09-03', '2026-09-03']);
      assert.deepEqual(entries.map((entry) => entry.anchor), ['bs-4', 'bs-2', 'bs-1.1', 'bs-3']);
      assert.deepEqual(entries.map((entry) => entry.commit),
        [closing, resultRevision, resultRevision, attachmentRevision].map((sha) => sha.slice(0, 10)));
      assert.equal(entries[2].outcome, renderOutcome('batched', 'BS-2', lang));
      assert.notEqual(resultRevision, closing);
      assert.notEqual(attachmentRevision, closing);
      assert.deepEqual(readdirSync(path.join(root, 'docs/archive')).sort(), ['LOG.md', 'README.md']);
      assert.equal(read(root, 'docs/archive/README.md'), archiveReadme);
      assert.equal(log.slice(0, log.indexOf(lines[0])).trimEnd(),
        renderProjectTemplate(cfg, 'docs/archive/LOG.md', vars).trimEnd());
      assert.ok(folded.out.indexOf('BS-4-earlier') < folded.out.indexOf('BS-2-batch'));
      assert.ok(folded.out.indexOf('BS-2-batch') < folded.out.indexOf('BS-3-later'));
      gitAll(root, 'Fold the fixture archive without embedding bodies');
      for (const [number, rels] of [[2, bodyFiles.slice(0, 2)], ['1.1', bodyFiles.slice(2, 3)], [3, bodyFiles.slice(3, 5)], [4, bodyFiles.slice(5)]]) {
        const shown = command('show', String(number));
        for (const rel of rels) {
          assert.ok(!existsSync(path.join(root, rel)), `${rel} has left the tree`);
          assert.ok(shown.out.includes(bodies.get(rel).trimEnd()), `${rel} is retrieved intact from its revision`);
        }
      }
    } finally { cleanup(root); }
  });
}
