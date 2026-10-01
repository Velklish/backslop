// `links --external` against a local node:http server: classes, exit codes, the JSON shape and the
// dropping of duplicates. The command runs as a child process, so the server stays in this one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { RU } from '../lib/i18n.js';
import { classifyStatus } from '../lib/links.js';
import { TOOL_VERSION } from '../lib/version.js';
import { BIN, cleanup, makeProject, put } from './helpers.mjs';

// The one path the server answers by dropping the connection: a transport failure, no port race.
const RESET = '/reset';

const ROUTES = {
  '/ok': [200],
  '/moved': [301, { location: '/ok' }],
  '/missing': [404],
  '/gone': [410],
  '/forbidden': [403],
  '/limited': [429],
  '/broken': [500],
};

function startServer() {
  const seen = [];
  const state = { inFlight: 0, maxInFlight: 0 };
  const server = http.createServer((req, res) => {
    if (req.url === RESET) {
      req.socket.destroy();
      return;
    }
    seen.push({ url: req.url, agent: req.headers['user-agent'] });
    state.inFlight += 1;
    state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
    setTimeout(() => {
      const [status, headers] = ROUTES[req.url] ?? [404];
      res.writeHead(status, headers);
      res.end('body');
      state.inFlight -= 1;
    }, 20);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      base: `http://127.0.0.1:${server.address().port}`,
      seen,
      state,
      stop: () => new Promise((done) => { server.closeAllConnections(); server.close(done); }),
    }));
  });
}

function runLinks(root, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, 'links', ...args], {
      cwd: root,
      env: { ...process.env, NO_COLOR: '1', NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --no-warnings`.trim() },
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => resolve({ code, out, err }));
  });
}

// A project whose one document links the given addresses, one inline link each.
function projectWith(urls, lang = 'en') {
  const root = makeProject();
  put(root, 'backslop.json', `${JSON.stringify({ prefix: 'BS', docs: 'docs', gates: [], lang, tools: [], version: TOOL_VERSION }, null, 2)}\n`);
  put(root, 'docs/reference/external.md', `# External\n\n${urls.map((u, i) => `[link ${i}](${u})`).join('\n\n')}\n`);
  return root;
}

async function withServer(body) {
  const server = await startServer();
  try {
    await body(server);
  } finally {
    await server.stop();
  }
}

for (const [path, cls, status, code] of [
  ['/ok', 'ok', 200, 0],
  ['/moved', 'ok', 200, 0],
  ['/missing', 'dead', 404, 1],
  ['/gone', 'dead', 410, 1],
  ['/forbidden', 'unverified', 403, 2],
  ['/limited', 'unverified', 429, 2],
  ['/broken', 'unverified', 500, 2],
]) {
  test(`links --external: ${path} is ${cls} and the run exits ${code}`, async () => {
    await withServer(async ({ base, seen }) => {
      const root = projectWith([`${base}${path}`]);
      try {
        const r = await runLinks(root, ['--external']);
        assert.equal(r.code, code, r.err);
        const dead = cls === 'dead' ? 1 : 0;
        const unverified = cls === 'unverified' ? 1 : 0;
        assert.equal(r.out, `${cls} ${status} ${base}${path}\nlinks: 1 urls, ${dead} dead, ${unverified} unverified\n`);
        assert.equal(r.err, '');
        assert.equal(seen[0].agent, 'backslop-links');
        assert.equal(seen.length, path === '/moved' ? 2 : 1, 'a redirect is followed with one more request');
      } finally { cleanup(root); }
    });
  });
}

test('links --external: a dropped connection is unverified with the error, exit 2', async () => {
  await withServer(async ({ base }) => {
    const root = projectWith([`${base}${RESET}`]);
    try {
      const r = await runLinks(root, ['--external']);
      assert.equal(r.code, 2, r.err);
      assert.equal(r.out, `unverified UND_ERR_SOCKET ${base}${RESET}\nlinks: 1 urls, 0 dead, 1 unverified\n`);
    } finally { cleanup(root); }
  });
});

test('links --external: the run goes one URL at a time, in document order, and a dead one wins over the rest', async () => {
  await withServer(async ({ base, state }) => {
    const closed = `${base}${RESET}`;
    const paths = ['/ok', '/moved', '/missing', '/gone', '/forbidden', '/limited', '/broken'];
    const root = projectWith([...paths.map((p) => `${base}${p}`), closed]);
    try {
      const r = await runLinks(root, ['--external']);
      assert.equal(r.code, 1, r.err);
      assert.deepEqual(r.out.trimEnd().split('\n').map((l) => l.split(' ')[0]), [
        'ok', 'ok', 'dead', 'dead', 'unverified', 'unverified', 'unverified', 'unverified', 'links:',
      ]);
      assert.match(r.out, /\nlinks: 8 urls, 2 dead, 4 unverified\n$/);
      assert.equal(state.maxInFlight, 1, 'requests overlapped');
    } finally { cleanup(root); }
  });
});

test('links --external: unverified answers without a dead one exit 2, an ok one does not hide them', async () => {
  await withServer(async ({ base }) => {
    const root = projectWith([`${base}/ok`, `${base}/limited`]);
    try {
      const r = await runLinks(root, ['--external']);
      assert.equal(r.code, 2, r.err);
      assert.match(r.out, /links: 2 urls, 0 dead, 1 unverified\n$/);
    } finally { cleanup(root); }
  });
});

test('links --external --json prints one document with the counts and a row per URL', async () => {
  await withServer(async ({ base }) => {
    const closed = `${base}${RESET}`;
    const root = projectWith([`${base}/ok`, `${base}/missing`, `${base}/limited`, closed]);
    try {
      const r = await runLinks(root, ['--external', '--json']);
      assert.equal(r.code, 1, r.err);
      assert.deepEqual(JSON.parse(r.out), {
        total: 4,
        ok: 1,
        dead: 1,
        unverified: 2,
        results: [
          { url: `${base}/ok`, class: 'ok', status: 200, error: null },
          { url: `${base}/missing`, class: 'dead', status: 404, error: null },
          { url: `${base}/limited`, class: 'unverified', status: 429, error: null },
          { url: closed, class: 'unverified', status: null, error: 'UND_ERR_SOCKET' },
        ],
      });
    } finally { cleanup(root); }
  });
});

test('links --external drops duplicates by URL without the fragment and skips every other link', async () => {
  await withServer(async ({ base, seen }) => {
    const root = projectWith([`${base}/ok#first`, `${base}/ok#second`, `${base}/ok`, 'mailto:a@example.com', '../README.md', '#top']);
    put(root, 'docs/reference/other.md', `# Other\n\n<${base}/ok#third>\n\n[ref][r]\n\n[r]: ${base}/ok#fourth\n`);
    put(root, 'docs/reference/code.md', `# Code\n\n\`[x](${base}/missing)\`\n`);
    try {
      const r = await runLinks(root, ['--external']);
      assert.equal(r.code, 0, r.err);
      assert.equal(r.out, `ok 200 ${base}/ok\nlinks: 1 urls, 0 dead, 0 unverified\n`);
      assert.deepEqual(seen.map((s) => s.url), ['/ok']);
    } finally { cleanup(root); }
  });
});

test('links --external on documents without an external link prints zero and exits 0', async () => {
  const root = projectWith(['../README.md']);
  try {
    const r = await runLinks(root, ['--external']);
    assert.equal(r.code, 0, r.err);
    assert.equal(r.out, 'links: 0 urls, 0 dead, 0 unverified\n');
  } finally { cleanup(root); }
});

test('links --external speaks the project language in the summary line and keeps the rows', async () => {
  await withServer(async ({ base }) => {
    const root = projectWith([`${base}/gone`], 'ru');
    try {
      const r = await runLinks(root, ['--external']);
      assert.equal(r.code, 1, r.err);
      const summary = RU.messages['links: {urls} urls, {dead} dead, {unverified} unverified']
        .replace('{urls}', '1').replace('{dead}', '1').replace('{unverified}', '0');
      assert.equal(r.out, `dead 410 ${base}/gone\n${summary}\n`);
    } finally { cleanup(root); }
  });
});

test('links without --external is a usage error and requests nothing', async () => {
  await withServer(async ({ base, seen }) => {
    const root = projectWith([`${base}/ok`]);
    try {
      let r = await runLinks(root, []);
      assert.equal(r.code, 1);
      assert.equal(r.out, '');
      assert.match(r.err, /^✖ links needs --external: local links are checked by .+ lint\n$/);
      r = await runLinks(root, ['--json']);
      assert.equal(r.code, 1);
      assert.equal(r.out, '');
      assert.deepEqual(seen, []);
    } finally { cleanup(root); }
  });
});

test('classifyStatus follows the class table', () => {
  const classes = { ok: [200, 204, 301, 399], unverified: [401, 403, 408, 429, 500, 503, 599], dead: [400, 404, 410, 451] };
  for (const [cls, statuses] of Object.entries(classes)) {
    for (const status of statuses) assert.equal(classifyStatus(status), cls, String(status));
  }
});
