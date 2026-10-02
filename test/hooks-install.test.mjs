// init writes, rewrites and removes the agent hook records in the harness hook files; lint checks
// them; the AGENTS.md block names the stop hook only when hooks are selected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO, cleanup, cli, put, read, ruTemplate } from './helpers.mjs';
import { renderTemplate } from '../lib/templates.js';
import { TOOL_VERSION } from '../lib/version.js';

const CLI = `npx github:Velklish/backslop#v${TOOL_VERSION}`;
const FILES = { claude: '.claude/settings.json', cursor: '.cursor/hooks.json', codex: '.codex/hooks.json' };
const EVENTS = {
  claude: ['SessionStart', 'Stop'], cursor: ['sessionStart', 'stop'], codex: ['SessionStart', 'Stop'],
};
const HARNESSES = Object.keys(FILES);
const command = (event, id, cli = CLI) => `${cli} hook ${event} --harness ${id}`;
const record = (id, cmd) => (id === 'cursor' ? { command: cmd } : { hooks: [{ type: 'command', command: cmd }] });

// What init writes into a missing file: one record per event, in the harness's shape.
function fresh(id, cli = CLI) {
  const [start, stop] = EVENTS[id];
  const hooks = { [start]: [record(id, command('session-start', id, cli))], [stop]: [record(id, command('stop', id, cli))] };
  return id === 'cursor' ? { version: 1, hooks } : { hooks };
}

// Foreign content of each file: a top-level key, a record in each event, and an event of its own.
function foreign(id) {
  const [start, stop] = EVENTS[id];
  const hooks = {
    [start]: [record(id, 'echo team-start')],
    [stop]: [record(id, './scripts/team-stop.sh')],
    [id === 'cursor' ? 'afterFileEdit' : 'PostToolUse']: [record(id, 'echo edited')],
  };
  if (id === 'cursor') return { version: 1, hooks };
  return { permissions: { allow: ['Bash(npm test)'] }, hooks, model: 'team-model' };
}

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

function emptyRepo() {
  return realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-hooks-')));
}

function init(root, ...args) {
  const r = cli(root, ['init', '--lang', 'en', ...args]);
  assert.equal(r.code, 0, r.err);
  return r;
}

test('hooks: init writes both records into a missing file and its missing directory, per harness', () => {
  for (const id of HARNESSES) {
    const root = emptyRepo();
    try {
      const r = init(root, '--hooks', id);
      assert.deepEqual(JSON.parse(read(root, FILES[id])), fresh(id), `${id}: the records`);
      assert.equal(read(root, FILES[id]), json(fresh(id)), `${id}: two-space JSON with a final newline`);
      for (const other of HARNESSES.filter((h) => h !== id)) {
        assert.ok(!existsSync(path.join(root, FILES[other])), `${id}: ${FILES[other]} was written`);
      }
      assert.deepEqual(JSON.parse(read(root, 'backslop.json')).hooks, [id]);
      assert.match(r.out, new RegExp(`agent hooks: ${FILES[id].replace('.', '\\.')} written`));
    } finally {
      cleanup(root);
    }
  }
});

test('hooks: foreign content survives the write and the removal byte for byte, ours come after it', () => {
  for (const id of HARNESSES) {
    const root = emptyRepo();
    try {
      const original = json(foreign(id));
      put(root, FILES[id], original);
      init(root, '--hooks', id);
      const data = JSON.parse(read(root, FILES[id]));
      const [start, stop] = EVENTS[id];
      const theirs = foreign(id);
      assert.deepEqual(data.hooks[start], [...theirs.hooks[start], record(id, command('session-start', id))], `${id}: ${start}`);
      assert.deepEqual(data.hooks[stop], [...theirs.hooks[stop], record(id, command('stop', id))], `${id}: ${stop}`);
      for (const [key, value] of Object.entries(theirs)) {
        if (key !== 'hooks') assert.deepEqual(data[key], value, `${id}: the foreign key ${key}`);
      }
      assert.deepEqual(Object.keys(data), Object.keys(theirs), `${id}: the key order`);
      init(root, '--hooks', 'none');
      assert.equal(read(root, FILES[id]), original, `${id}: the removal left another file than the foreign one`);
    } finally {
      cleanup(root);
    }
  }
});

test('hooks: a second init writes no byte, also into a file with its own indent', () => {
  const root = emptyRepo();
  try {
    put(root, FILES.cursor, `${JSON.stringify(foreign('cursor'), null, 4)}\n`);
    init(root, '--hooks', 'claude,cursor,codex');
    assert.match(read(root, FILES.cursor), /\n {4}"hooks": \{\n {8}"sessionStart"/, 'the four-space indent of the file was not kept');
    const before = Object.values(FILES).map((rel) => [read(root, rel), statSync(path.join(root, rel)).mtimeMs]);
    const r = init(root);
    assert.deepEqual(Object.values(FILES).map((rel) => [read(root, rel), statSync(path.join(root, rel)).mtimeMs]), before);
    assert.doesNotMatch(r.out, /agent hooks: /, 'a repeated init reported a hook file change');
    assert.deepEqual(JSON.parse(read(root, 'backslop.json')).hooks, ['claude', 'cursor', 'codex'], 'init without --hooks dropped the selection');
  } finally {
    cleanup(root);
  }
});

test('hooks: a pin change rewrites the owned records in place instead of adding new ones', () => {
  const root = emptyRepo();
  try {
    const old = 'npx github:Velklish/backslop#v0.1.0';
    for (const id of HARNESSES) {
      const data = foreign(id);
      const [start, stop] = EVENTS[id];
      data.hooks[start].unshift(record(id, command('session-start', id, old)));
      data.hooks[stop].push(record(id, command('stop', id, 'node /opt/backslop/bin/backslop.js')));
      put(root, FILES[id], json(data));
    }
    init(root, '--hooks', 'claude,cursor,codex');
    for (const id of HARNESSES) {
      const data = JSON.parse(read(root, FILES[id]));
      const theirs = foreign(id);
      const [start, stop] = EVENTS[id];
      assert.deepEqual(data.hooks[start], [record(id, command('session-start', id)), ...theirs.hooks[start]], `${id}: ${start}`);
      assert.deepEqual(data.hooks[stop], [...theirs.hooks[stop], record(id, command('stop', id))], `${id}: ${stop}`);
    }
  } finally {
    cleanup(root);
  }
});

test('hooks: dropping a harness removes only owned records, and the file only when nothing else is left', () => {
  const root = emptyRepo();
  try {
    put(root, FILES.claude, json(foreign('claude')));
    init(root, '--hooks', 'claude,cursor,codex');
    const claude = read(root, FILES.claude);
    init(root, '--hooks', 'claude');
    assert.equal(read(root, FILES.claude), claude, 'the selected harness changed');
    for (const id of ['cursor', 'codex']) {
      assert.ok(!existsSync(path.join(root, FILES[id])), `${FILES[id]} with only owned records stayed`);
      assert.ok(!existsSync(path.join(root, path.dirname(FILES[id]))), `the empty ${path.dirname(FILES[id])} stayed`);
    }
    init(root, '--hooks', 'none');
    assert.equal(read(root, FILES.claude), json(foreign('claude')), 'the foreign file did not come back as it was');
    assert.deepEqual(JSON.parse(read(root, 'backslop.json')).hooks, []);
  } finally {
    cleanup(root);
  }
  const other = emptyRepo();
  try {
    put(other, FILES.cursor, json({ version: 1, hooks: { afterFileEdit: [] } }));
    init(other, '--hooks', 'cursor');
    init(other, '--hooks', 'none');
    assert.equal(read(other, FILES.cursor), json({ version: 1, hooks: { afterFileEdit: [] } }), 'an event array the user left empty was removed');
    put(other, FILES.codex, json({ hooks: { Stop: [record('codex', command('stop', 'codex'))] }, note: 'x' }));
    init(other);
    assert.deepEqual(JSON.parse(read(other, FILES.codex)), { note: 'x' }, 'an unselected harness kept its owned record');
  } finally {
    cleanup(other);
  }
});

test('hooks: a hook file init cannot merge into is refused before the first write, naming the file', () => {
  const cases = [
    ['cursor', '{ "version": 1, "hooks": ', /\.cursor\/hooks\.json is not valid JSON/],
    ['claude', json({ hooks: [] }), /\.claude\/settings\.json: hooks is not an object/],
    ['codex', json([]), /\.codex\/hooks\.json: the top level is not an object/],
    ['codex', json({ hooks: { Stop: {} } }), /\.codex\/hooks\.json: hooks\.Stop is not an array/],
  ];
  for (const [id, text, refusal] of cases) {
    const root = emptyRepo();
    try {
      put(root, FILES[id], text);
      const r = cli(root, ['init', '--lang', 'en', '--hooks', `claude,${id === 'claude' ? 'codex' : id}`]);
      assert.equal(r.code, 1, `${id}: ${r.out}`);
      assert.match(r.err, refusal);
      assert.equal(read(root, FILES[id]), text, `${id}: the file changed`);
      for (const rel of ['backslop.json', 'AGENTS.md', 'docs', ...Object.values(FILES).filter((f) => f !== FILES[id])]) {
        assert.ok(!existsSync(path.join(root, rel)), `${id}: ${rel} was written before the refusal`);
      }
      // An unselected harness's file is not ours to judge: init passes it by.
      init(root, '--hooks', id === 'claude' ? 'codex' : 'claude');
      assert.equal(read(root, FILES[id]), text);
    } finally {
      cleanup(root);
    }
  }
});

test('hooks: a symlink on the hook file path of a selected harness is refused before the first write', { skip: process.platform === 'win32' && 'symlinks need privileges on win32' }, () => {
  const root = emptyRepo();
  const outside = emptyRepo();
  try {
    const behind = json(fresh('codex'));
    put(outside, 'hooks.json', behind);
    symlinkSync(outside, path.join(root, '.codex'));
    const r = cli(root, ['init', '--lang', 'en', '--hooks', 'codex']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, /agent hook file path contains a symlink: \.codex/);
    assert.ok(!existsSync(path.join(root, 'backslop.json')));
    assert.equal(read(outside, 'hooks.json'), behind, 'init wrote through the link');
    init(root, '--hooks', 'claude');
    assert.equal(read(outside, 'hooks.json'), behind, 'the unselected harness was cleaned through the link');
  } finally {
    cleanup(root);
    cleanup(outside);
  }
});

test('hooks: lint reads an unselected harness file through a symlink and reports its owned records', { skip: process.platform === 'win32' && 'symlinks need privileges on win32' }, () => {
  const root = emptyRepo();
  const outside = emptyRepo();
  try {
    put(outside, 'settings.json', json(fresh('claude')));
    init(root, '--hooks', 'none');
    assert.equal(cli(root, ['lint']).code, 0);
    symlinkSync(outside, path.join(root, '.claude'));
    const r = cli(root, ['lint']);
    assert.equal(r.code, 1);
    assert.ok(r.err.includes('.claude/settings.json: backslop agent hook records for claude sit here, behind the symlink .claude, and the hooks field of backslop.json does not select claude — init does not remove records through a link: remove them by hand'), r.err);
    put(outside, 'settings.json', '{');
    assert.equal(cli(root, ['lint']).code, 0, 'an invalid file behind the link is a skip');
  } finally {
    cleanup(root);
    cleanup(outside);
  }
});

test('hooks: a symlink on the hook file itself is refused before the first write', { skip: process.platform === 'win32' && 'symlinks need privileges on win32' }, () => {
  const root = emptyRepo();
  const outside = emptyRepo();
  try {
    const behind = json(fresh('codex'));
    put(outside, 'real.json', behind);
    mkdirSync(path.join(root, '.codex'));
    symlinkSync(path.join(outside, 'real.json'), path.join(root, FILES.codex));
    const r = cli(root, ['init', '--lang', 'en', '--hooks', 'codex']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, /agent hook file path contains a symlink: \.codex\/hooks\.json/);
    assert.ok(!existsSync(path.join(root, 'backslop.json')));
    assert.equal(read(outside, 'real.json'), behind);
    init(root, '--hooks', 'claude');
    assert.equal(read(outside, 'real.json'), behind, 'the unselected harness was cleaned through the link');
  } finally {
    cleanup(root);
    cleanup(outside);
  }
});

test('hooks: a directory at the hook file path is refused for a selected harness and skipped otherwise', () => {
  const root = emptyRepo();
  try {
    mkdirSync(path.join(root, FILES.cursor), { recursive: true });
    const r = cli(root, ['init', '--lang', 'en', '--hooks', 'cursor']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, /\.cursor\/hooks\.json is not a file/);
    assert.ok(!existsSync(path.join(root, 'backslop.json')));
    init(root, '--hooks', 'claude');
    assert.ok(statSync(path.join(root, FILES.cursor)).isDirectory());
  } finally {
    cleanup(root);
  }
});

test('hooks: CRLF line endings and a missing final newline survive the write and the removal', () => {
  const root = emptyRepo();
  try {
    const original = JSON.stringify(foreign('claude'), null, 2).replace(/\n/g, '\r\n');
    put(root, FILES.claude, original);
    init(root, '--hooks', 'claude');
    const written = read(root, FILES.claude);
    assert.ok(!/(?<!\r)\n/.test(written), 'a bare LF in a CRLF file');
    assert.ok(written.endsWith('}'), 'a final newline was added');
    assert.ok(written.includes(command('stop', 'claude')));
    init(root, '--hooks', 'none');
    assert.equal(read(root, FILES.claude), original);
  } finally {
    cleanup(root);
  }
});

test('hooks: the first write lays a hand-formatted file out as standard JSON, content unchanged', () => {
  const root = emptyRepo();
  try {
    put(root, FILES.claude, '{\n  "permissions": { "allow": ["Bash(npm test)", "Read"] }\n}\n');
    init(root, '--hooks', 'claude');
    const written = read(root, FILES.claude);
    assert.ok(written.startsWith('{\n  "permissions": {\n    "allow": [\n      "Bash(npm test)",\n      "Read"\n    ]\n  },\n  "hooks": {'), written);
    init(root, '--hooks', 'none');
    assert.equal(read(root, FILES.claude), json({ permissions: { allow: ['Bash(npm test)', 'Read'] } }));
  } finally {
    cleanup(root);
  }
});

test('hooks: records with a project cli that does not name backslop are owned all the same', () => {
  const root = emptyRepo();
  try {
    init(root, '--cli', './scripts/bl', '--hooks', 'claude,cursor');
    assert.deepEqual(JSON.parse(read(root, FILES.claude)), fresh('claude', './scripts/bl'));
    const before = [FILES.claude, FILES.cursor].map((rel) => [read(root, rel), statSync(path.join(root, rel)).mtimeMs]);
    const r = init(root);
    assert.doesNotMatch(r.out, /agent hooks: /);
    assert.deepEqual([FILES.claude, FILES.cursor].map((rel) => [read(root, rel), statSync(path.join(root, rel)).mtimeMs]), before);
    const lint = cli(root, ['lint']);
    assert.equal(lint.code, 0, lint.err);
    init(root, '--hooks', 'none');
    for (const rel of [FILES.claude, FILES.cursor]) assert.ok(!existsSync(path.join(root, rel)), `${rel} stayed`);
  } finally {
    cleanup(root);
  }
});

test('hooks: lint is red exactly when init would rewrite the file: a duplicate, a record under another event', () => {
  const root = emptyRepo();
  try {
    init(root, '--hooks', 'claude,cursor');
    assert.equal(cli(root, ['lint']).code, 0);
    const claude = JSON.parse(read(root, FILES.claude));
    const cursor = JSON.parse(read(root, FILES.cursor));
    claude.hooks.Stop.push(record('claude', command('stop', 'claude')));
    cursor.hooks.sessionStart.push(record('cursor', command('stop', 'cursor')));
    put(root, FILES.claude, json(claude));
    put(root, FILES.cursor, json(cursor));
    const r = cli(root, ['lint']);
    assert.equal(r.code, 1);
    for (const id of ['claude', 'cursor']) {
      assert.ok(r.err.includes(`${FILES[id]}: the agent hook records of ${id} differ from what init writes: a duplicate or a record under another event — run ${CLI} init`), r.err);
    }
    init(root);
    assert.deepEqual(JSON.parse(read(root, FILES.claude)), fresh('claude'));
    assert.deepEqual(JSON.parse(read(root, FILES.cursor)), fresh('cursor'));
    assert.equal(cli(root, ['lint']).code, 0);
  } finally {
    cleanup(root);
  }
});

test('hooks: the CHANGELOG no longer says that nothing writes the hook records', () => {
  assert.ok(!read(REPO, 'CHANGELOG.md').includes('Nothing writes the records into the harness files yet.'));
});

test('hooks: the config field and the flag refuse an unknown or repeated harness, naming the field', () => {
  const root = emptyRepo();
  try {
    let r = cli(root, ['init', '--lang', 'en', '--hooks', 'claude,vim']);
    assert.equal(r.code, 1);
    assert.match(r.err, /--hooks “claude,vim”: a comma-separated list of claude, cursor, codex, or none/);
    init(root, '--tools', 'none');
    assert.ok(!('hooks' in JSON.parse(read(root, 'backslop.json'))), 'init selected hooks by default');
    for (const hooks of [['claude', 'claude'], ['vim'], 'claude']) {
      const cfg = JSON.parse(read(root, 'backslop.json'));
      writeFileSync(path.join(root, 'backslop.json'), json({ ...cfg, hooks }));
      r = cli(root, ['lint']);
      assert.equal(r.code, 1, JSON.stringify(hooks));
      assert.match(r.err, /backslop\.json: hooks must be a unique array of claude, cursor, codex/);
    }
    const cfg = JSON.parse(read(root, 'backslop.json'));
    writeFileSync(path.join(root, 'backslop.json'), json({ agents: {}, ...cfg, hooks: ['codex'] }));
    init(root);
    assert.deepEqual(Object.keys(JSON.parse(read(root, 'backslop.json'))).slice(-3), ['tools', 'hooks', 'agents'], 'hooks does not follow tools');
  } finally {
    cleanup(root);
  }
});

test('hooks: the promptobus note names cursor and codex on one line and no tracker id', () => {
  const root = emptyRepo();
  try {
    let r = init(root, '--hooks', 'claude');
    assert.doesNotMatch(r.out, /promptobus/);
    r = init(root, '--hooks', 'claude,cursor,codex');
    const lines = r.out.split('\n').filter((line) => line.includes('promptobus'));
    assert.equal(lines.length, 1, r.out);
    assert.match(lines[0], /cursor, codex: promptobus participants of these harnesses collide with \.cursor\/hooks\.json, \.codex\/hooks\.json/);
    assert.doesNotMatch(lines[0], /[A-Z]{2,6}-\d/);
  } finally {
    cleanup(root);
  }
});

// Each lint check: green on the installed records, red on one mutation with its exact message.
test('hooks: lint reports a missing record, another cli and a record of an unselected harness', () => {
  const root = emptyRepo();
  try {
    init(root, '--hooks', 'claude,cursor');
    let r = cli(root, ['lint']);
    assert.equal(r.code, 0, r.err);
    const claude = read(root, FILES.claude);
    const data = JSON.parse(claude);
    data.hooks.Stop = [record('claude', 'echo team-stop')];
    put(root, FILES.claude, json(data));
    r = cli(root, ['lint']);
    assert.equal(r.code, 1);
    assert.ok(r.err.includes(`.claude/settings.json: the Stop agent hook record of claude is missing: expected “${command('stop', 'claude')}” — run ${CLI} init`), r.err);
    put(root, FILES.claude, claude.replace(command('stop', 'claude'), command('stop', 'claude', 'npx github:Other/backslop#v0.1.0')));
    r = cli(root, ['lint']);
    assert.equal(r.code, 1);
    assert.ok(r.err.includes(`.claude/settings.json: the agent hook record “${command('stop', 'claude', 'npx github:Other/backslop#v0.1.0')}” runs another cli than this project’s ${CLI} — run ${CLI} init`), r.err);
    put(root, FILES.claude, claude);
    assert.equal(cli(root, ['lint']).code, 0);
    const cfg = JSON.parse(read(root, 'backslop.json'));
    writeFileSync(path.join(root, 'backslop.json'), json({ ...cfg, hooks: ['claude'] }));
    r = cli(root, ['lint']);
    assert.equal(r.code, 1);
    assert.ok(r.err.includes(`.cursor/hooks.json: backslop agent hook records for cursor sit here, but the hooks field of backslop.json does not select cursor — run ${CLI} init`), r.err);
    put(root, FILES.cursor, '{');
    assert.equal(cli(root, ['lint']).code, 0, 'an unselected harness file that is not JSON is not ours to judge');
    writeFileSync(path.join(root, 'backslop.json'), json({ ...cfg, hooks: ['claude', 'cursor'] }));
    r = cli(root, ['lint']);
    assert.equal(r.code, 1);
    assert.match(r.err, /\.cursor\/hooks\.json: \.cursor\/hooks\.json is not valid JSON .* — init refuses on it/);
  } finally {
    cleanup(root);
  }
});

test('hooks: the AGENTS.md block names the stop hook only with hooks, and is unchanged without them', () => {
  for (const lang of ['en', 'ru']) {
    const root = emptyRepo();
    try {
      const sentence = (lang === 'en' ? renderTemplate('en/agents-hooks.md', {}) : ruTemplate('agents-hooks.md')).trim();
      init(root, '--lang', lang);
      const without = read(root, 'AGENTS.md');
      assert.ok(!without.includes(sentence), `${lang}: the sentence without hooks`);
      init(root, '--lang', lang, '--hooks', 'codex');
      const withHooks = read(root, 'AGENTS.md');
      const release = without.split('\n').find((line) => line.includes('`backslop-writer`') && !line.startsWith('**'));
      assert.ok(withHooks.includes(`${release}\n\n${sentence}\n\n`), `${lang}: the sentence is not a paragraph after the release sentence`);
      assert.equal(withHooks.replace(`\n\n${sentence}`, ''), without, `${lang}: the hooks render changed more than the sentence`);
      init(root, '--lang', lang, '--hooks', 'none');
      assert.equal(read(root, 'AGENTS.md'), without, `${lang}: the block without hooks is not the one before`);
    } finally {
      cleanup(root);
    }
  }
});

test('hooks: a selected harness whose hook directory is a file is refused before the first write', () => {
  const root = emptyRepo();
  try {
    writeFileSync(path.join(root, '.claude'), 'x');
    const r = cli(root, ['init', '--lang', 'en', '--hooks', 'claude']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, /\.claude is a file, expected a directory/);
    assert.ok(!existsSync(path.join(root, 'backslop.json')));
  } finally {
    cleanup(root);
  }
});

test('hooks: the glossary row of agent hook names the hooks field and the module that implements it', () => {
  const row = read(REPO, 'docs/GLOSSARY.md').split('\n').find((line) => line.startsWith('| agent hook |'));
  const cells = row.split(' | ');
  assert.equal(cells[1], '`hooks`', 'the EN column');
  assert.match(cells.at(-1), /^\[lib\/hooks-install\.js\]\(\.\.\/lib\/hooks-install\.js\), `planHooks` \|$/, 'the Evidence column');
  assert.match(read(REPO, 'lib/hooks-install.js'), /^export function planHooks\(/m);
});
