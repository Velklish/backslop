// Parity of the English message keys in lib/ and bin/ with the Russian entries of
// templates/i18n/ru.mjs, and the lookup's own rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RU, msg } from '../lib/i18n.js';
import { maskedLines, scannedCode } from './comment-scan.mjs';
import { toPosix } from '../lib/util.js';
import { cli } from './helpers.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MODULE = 'templates/i18n/ru.mjs';
const CALL = /(?<![\w$.])msg\(/g;
const LITERAL = /^\s*('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\$]|\\.|\$(?!\{))*`)/;

// The source with every comment blanked, offsets kept: a call named in a comment is not a call.
function codeOf(text) {
  const masked = maskedLines(text);
  return text.split('\n').map((line, n) => {
    const m = masked[n] ?? '';
    return [...line].map((c, i) => (i < m.length && m[i] !== ' ' ? ' ' : c)).join('');
  }).join('\n');
}

// The end of the first argument: the comma at depth 0, strings skipped.
function afterFirstArg(code, i) {
  let depth = 0;
  for (; i < code.length; i += 1) {
    const c = code[i];
    if (c === "'" || c === '"' || c === '`') {
      for (i += 1; i < code.length && code[i] !== c; i += 1) if (code[i] === '\\') i += 1;
    } else if ('([{'.includes(c)) depth += 1;
    else if (')]}'.includes(c)) { if (depth === 0) return -1; depth -= 1; } else if (c === ',' && depth === 0) return i + 1;
  }
  return -1;
}

// The end of the string or template literal opening at i; `${…}` inside a template is code.
function skipLiteral(code, i) {
  const q = code[i];
  for (i += 1; i < code.length; i += 1) {
    if (code[i] === '\\') i += 1;
    else if (code[i] === q) return i + 1;
    else if (q === '`' && code[i] === '$' && code[i + 1] === '{') i = closeOf(code, i + 1);
  }
  return code.length;
}

// The index of the bracket closing the one at i.
function closeOf(code, i) {
  let depth = 0;
  while (i < code.length) {
    const c = code[i];
    if (c === "'" || c === '"' || c === '`') { i = skipLiteral(code, i); continue; }
    if ('([{'.includes(c)) depth += 1;
    else if (')]}'.includes(c) && --depth === 0) return i;
    i += 1;
  }
  return code.length;
}

// The param names of a call whose key ends at i: none without params, null when the params
// argument is not an object literal of plain properties.
function paramNames(code, i) {
  const next = code.slice(i).match(/^\s*[,)]\s*/);
  if (!next) return null;
  const at = i + next[0].length;
  if (next[0].includes(')') || code[at] === ')') return new Set();
  if (code[at] !== '{') return null;
  const end = closeOf(code, at);
  const names = new Set();
  for (let k = at + 1, start = k; k <= end;) {
    const c = code[k];
    if (k === end || c === ',') {
      const prop = code.slice(start, k).trim();
      const m = prop.match(/^(?:([A-Za-z_$][\w$]*)|'([^'\\]*)'|"([^"\\]*)")\s*(?::|$)/);
      if (prop && !m) return null;
      if (m) names.add(m[1] ?? m[2] ?? m[3]);
      k += 1;
      start = k;
    } else if (c === "'" || c === '"' || c === '`') k = skipLiteral(code, k);
    else if ('([{'.includes(c)) k = closeOf(code, k) + 1;
    else k += 1;
  }
  return names;
}

function scanCalls() {
  const calls = [];
  const opaque = [];
  // lib/i18n.js is the lookup itself: its calls pass the key they were given.
  for (const rel of scannedCode(ROOT, ['lib', 'bin']).files.filter((f) => f !== 'lib/i18n.js')) {
    const code = codeOf(readFileSync(path.join(ROOT, rel), 'utf8'));
    for (const m of code.matchAll(CALL)) {
      const where = `${rel}:${code.slice(0, m.index).split('\n').length}`;
      const at = afterFirstArg(code, m.index + m[0].length);
      const lit = at < 0 ? null : code.slice(at).match(LITERAL);
      if (!lit) opaque.push(where);
      else calls.push({ where, key: new Function(`return ${lit[1]}`)(), params: paramNames(code, at + lit[0].length) });
    }
  }
  return { calls, opaque };
}

const { calls, opaque } = scanCalls();
const placeholders = (text) => new Set([...text.matchAll(/\{([A-Za-z_$][\w$]*)\}/g)].map((m) => m[1]));

test('every message key in lib/ and bin/ is a string literal', () => {
  assert.ok(calls.length > 0, 'the scan found no msg call in lib/ or bin/');
  assert.deepEqual(opaque, [], 'these calls pass a key the parity test cannot read — write the English text in place');
});

// A placeholder without its param is printed as written in both languages, and no test notices.
test('every call passes a param for each placeholder of its key', () => {
  const read = calls.filter((c) => c.params !== null);
  assert.ok(read.length > 0, 'the scan read no params object');
  const missing = read.flatMap((c) => [...placeholders(c.key)].filter((name) => !c.params.has(name))
    .map((name) => `${c.where}: “${c.key}” gets no {${name}}`));
  assert.deepEqual(missing, []);
});

test('every English message the CLI prints has a Russian entry in templates/i18n/ru.mjs', () => {
  const missing = calls.filter((c) => !Object.hasOwn(RU.messages, c.key)).map((c) => `${c.where}: “${c.key}”`);
  assert.deepEqual(missing, [], `no entry in ${MODULE}`);
});

test('every Russian entry in templates/i18n/ru.mjs is a message the CLI prints', () => {
  const used = new Set(calls.map((c) => c.key));
  const dead = Object.keys(RU.messages).filter((k) => !used.has(k)).map((k) => `messages: “${k}”`);
  assert.deepEqual(dead, [], `no msg call in lib/ or bin/ uses these entries of ${MODULE}`);
});

// Read from the module text: in the evaluated object a repeated key silently wins last.
test('no key is written twice in templates/i18n/ru.mjs', () => {
  const text = readFileSync(path.join(ROOT, MODULE), 'utf8');
  const repeated = [];
  for (const [name, table] of Object.entries({ messages: RU.messages })) {
    const block = text.slice(text.indexOf(`export const ${name} = {`)).split('\n};')[0];
    const keys = [...block.matchAll(/^ {2}([A-Za-z_$][\w$]*|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"):/gm)]
      .map((m) => (/^['"]/.test(m[1]) ? new Function(`return ${m[1]}`)() : m[1]));
    const seen = new Set();
    for (const key of keys) if (seen.has(key)) repeated.push(`${name}: “${key}”`); else seen.add(key);
    assert.deepEqual([...seen].sort(), Object.keys(table).sort(), `the scan of ${MODULE} does not see every key of ${name}`);
  }
  assert.deepEqual(repeated, [], `keys written twice in ${MODULE}; the later entry wins`);
});

test('no two keys in templates/i18n/ru.mjs are one English text with other placeholder names', () => {
  const twins = [];
  for (const [name, table] of Object.entries({ messages: RU.messages })) {
    const first = new Map();
    for (const key of Object.keys(table)) {
      const shape = key.replace(/\{[A-Za-z_$][\w$]*\}/g, '{}');
      if (first.has(shape)) twins.push(`${name}: “${first.get(shape)}” and “${key}”`);
      else first.set(shape, key);
    }
  }
  assert.deepEqual(twins, [], 'one English text has one key; a context difference is a param of that key');
});

test('a Russian string names only the placeholders of its English key', () => {
  const stray = [];
  for (const table of [RU.messages]) {
    for (const [key, value] of Object.entries(table)) {
      if (typeof value !== 'string') continue;
      const own = placeholders(key);
      for (const name of placeholders(value)) if (!own.has(name)) stray.push(`“${key}”: {${name}}`);
    }
  }
  assert.deepEqual(stray, []);
});

test('a key missing from templates/i18n/ru.mjs falls back to the English text', () => {
  assert.equal(msg('ru', 'no such message: {what}', { what: 'x' }), 'no such message: x');
  assert.equal(msg('en', 'no such message: {what}'), 'no such message: {what}');
});

test('a function param is called with the language of the text it fills', () => {
  const lang = (l) => l;
  assert.equal(msg('en', 'no such message: {lang}', { lang }), 'no such message: en');
  assert.equal(msg(null, 'no such message: {lang}', { lang }), 'no such message: en');
});

test('msg without a language returns the English text', () => {
  assert.equal(msg(null, 'cannot be parsed'), 'cannot be parsed');
  assert.equal(msg('ru', 'cannot be parsed'), RU.messages['cannot be parsed']);
});

test('CLI without config: help, refusals and changelog messages are English', () => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-i18n-')));
  try {
    for (const [args, code, text] of [
      [['help'], 0, /init \[--dir docs\]/],
      [['init', '--help'], 0, /init \[--dir docs\]/],
      [['no-such-command'], 1, /unknown command “no-such-command”; see backslop help/],
      [['status'], 1, /backslop\.json was not found/],
      [['init', '--prefix', 'x'], 1, /expected 2–6 uppercase Latin letters or digits/],
      [['changelog', '--since', '99.0.0'], 0, /no entries after v99\.0\.0/],
      [['merge-changelog'], 1, /both --ours <ref> and --theirs <ref> are required/],
    ]) {
      const r = cli(root, args);
      assert.equal(r.code, code, r.err);
      assert.match(r.out + r.err, text, args.join(' '));
      assert.doesNotMatch(r.out + r.err, /\p{Script=Cyrillic}/u);
      assert.equal(existsSync(path.join(root, 'backslop.json')), false);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('implicit fresh init and subsequent human CLI messages are English', () => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-i18n-')));
  try {
    for (const [args, text] of [
      [['init'], /init: docs\/ \(prefix BS\), files created/],
      [['help'], /init \[--dir docs\]/],
      [['status'], /Queue \(0\)/],
      [['new', 'english', '--title', 'English task'], /BS-1-english\.md/],
    ]) {
      const r = cli(root, args);
      assert.equal(r.code, 0, r.err);
      assert.match(r.out + r.err, text, args.join(' '));
      assert.doesNotMatch(r.out + r.err, /\p{Script=Cyrillic}/u);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('init lays no templates/i18n/ into a project', () => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop-i18n-')));
  try {
    const r = cli(root, ['init', '--lang', 'ru']);
    assert.equal(r.code, 0, r.err);
    const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const abs = path.join(dir, e.name);
      return e.isDirectory() && e.name !== '.git' ? [abs, ...walk(abs)] : [abs];
    });
    assert.deepEqual(walk(root).map((p) => toPosix(path.relative(root, p))).filter((p) => /i18n|ru\.mjs$/.test(p)), []);
    assert.ok(existsSync(path.join(root, 'backslop.json')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
