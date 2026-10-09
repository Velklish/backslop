// Tracked files only: localization resources and identified verbatim evidence are exceptions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CYRILLIC = new RegExp(`[${String.fromCodePoint(0x0400)}-${String.fromCodePoint(0x04ff)}]`, 'u');
const EVIDENCE = [
  {
    "file": "docs/archive/LOG.md",
    "marker": "- <a id=\"bs-14\"></a>",
    "literals": [
      "«N \u0433\u0435\u0439\u0442\u043e\u0432, M \u0437\u0435\u043b\u0451\u043d\u044b\u0445»"
    ],
    "source": "Historical report wording; its runtime provenance is unverified."
  },
  {
    "file": "docs/archive/LOG.md",
    "marker": "- <a id=\"bs-76.3\"></a>",
    "literals": [
      "«\u0441\u043b\u0438\u0442\u043e \u0432 main»",
      "«\u0417\u0430\u043a\u0440\u044b\u0442\u0430 \u043e\u0442\u043a\u043b\u043e\u043d\u0435\u043d\u0438\u0435\u043c»"
    ],
    "source": "Multilingual outcome inputs; templates/i18n/ru.mjs parserWords."
  },
  {
    "file": "docs/archive/LOG.md",
    "marker": "- <a id=\"bs-76.2\"></a>",
    "literals": [
      "«\u0432\u044b\u043f\u043e\u043b\u043d\u0435\u043d\u0430»"
    ],
    "source": "Historical parsed outcome; templates/i18n/ru.mjs parserWords."
  },
  {
    "file": "docs/archive/LOG.md",
    "marker": "- <a id=\"bs-78.1\"></a>",
    "literals": [
      "«\u043a\u043e\u0434 null»"
    ],
    "source": "Verbatim git diagnostic; templates/i18n/ru.mjs code {code}."
  },
  {
    "file": "docs/archive/LOG.md",
    "marker": "- <a id=\"bs-76.6\"></a>",
    "literals": [
      "«\u0417\u0430\u043a\u0440\u044b\u0442\u0430 \u043e\u0442\u043a\u0430\u0437\u043e\u043c»",
      "«\u043d\u0435 \u0432\u044b\u043f\u043e\u043b\u043d\u0435\u043d\u0430»",
      "«\u0418\u0441\u0445\u043e\u0434 — \u0441\u043d\u044f\u0442\u0430»",
      "«\u0441\u043b\u0438\u0442\u0430»"
    ],
    "source": "Multilingual outcome inputs; templates/i18n/ru.mjs parserWords."
  },
  {
    "file": "docs/archive/LOG.md",
    "marker": "- <a id=\"bs-78.2\"></a>",
    "literals": [
      "«\u043a\u043e\u0434 null»"
    ],
    "source": "Verbatim git diagnostic; templates/i18n/ru.mjs code {code}."
  },
  {
    "file": "docs/archive/LOG.md",
    "marker": "- <a id=\"bs-78.4\"></a>",
    "literals": [
      "«\u043d\u0435 \u0437\u0430\u043f\u0443\u0441\u0442\u0438\u043b\u0441\u044f»"
    ],
    "source": "Verbatim gate diagnostic; templates/i18n/ru.mjs did not start: {error}."
  },
  {
    "file": "docs/backlog/minor/BS-138.1-windows-npx-launcher-unverified.md",
    "marker": "Evidence: No Windows machine in this run.",
    "literals": [
      "` — \u043a\u043e\u0434 3. `"
    ],
    "source": "Verbatim diagnostic in unverified Windows evidence; templates/i18n/ru.mjs exit code {status}."
  }
];

export function allowed(rel) {
  return rel === 'templates/i18n/ru.mjs'
    || (rel.startsWith('templates/') && !rel.startsWith('templates/en/')
      && !rel.startsWith('templates/vendor/') && !rel.startsWith('templates/i18n/')
      && existsSync(path.join(ROOT, 'templates/en', rel.slice('templates/'.length))));
}

// Line numbers, 1-based, of the lines that hold a character of U+0400–U+04FF.
export function cyrillicLines(text) {
  return text.split('\n').flatMap((l, i) => (CYRILLIC.test(l) ? [i + 1] : []));
}

function unexplainedLines(rel, text) {
  if (allowed(rel)) return [];
  return text.split('\n').flatMap((line, i) => {
    for (const entry of EVIDENCE) {
      if (entry.file !== rel || !line.startsWith(entry.marker)) continue;
      for (const literal of entry.literals) line = line.replace(literal, '');
    }
    return CYRILLIC.test(line) ? [i + 1] : [];
  });
}

// A deleted file is not judged: the index still lists it until `git add`.
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
  .split('\0').filter((f) => f && existsSync(path.join(ROOT, f)));

function hitsOf(files) {
  return files.flatMap((rel) => unexplainedLines(rel, readFileSync(path.join(ROOT, rel), 'utf8'))
    .map((n) => `${rel}:${n}`));
}

test('no tracked file holds unexplained Cyrillic, including tracker and archive prose', () => {
  assert.ok(tracked.some((f) => f.startsWith('lib/')), 'the walk reads no file of lib/ — it would pass on nothing');
  assert.deepEqual(hitsOf(tracked), [], 'unexplained Cyrillic as file:line — translate prose or identify its literal evidence');
});

test('only Russian template twins and the CLI localization resource are exempt by file', () => {
  const resources = tracked.filter(allowed);
  assert.ok(resources.some((f) => f !== 'templates/i18n/ru.mjs'));
  assert.ok(cyrillicLines(readFileSync(path.join(ROOT, 'templates/i18n/ru.mjs'), 'utf8')).length > 0);
  const ru = String.fromCodePoint(0x042f);
  for (const rel of resources) assert.deepEqual(unexplainedLines(rel, ru), [], rel);
  for (const rel of ['templates/en/task.md', 'templates/vendor/probe.md', 'templates/unrecognized.md',
    'templates/i18n/unknown.mjs', 'templates.md', 'docs/backlog.md', 'docs/reference/x.md', 'lib/templates/x.js']) {
    assert.deepEqual(unexplainedLines(rel, ru), [1], rel);
  }
});

test('a hit is named by its line, and the range ends at U+0400 and U+04FF', () => {
  const ru = String.fromCodePoint(0x0400) + String.fromCodePoint(0x04ff);
  assert.deepEqual(cyrillicLines(`a\n${ru}\nb\nx${ru.slice(1)}\n`), [2, 4]);
  assert.deepEqual(cyrillicLines(String.fromCodePoint(0x03ff) + String.fromCodePoint(0x0500)), []);
  assert.deepEqual(unexplainedLines('docs/archive/LOG.md', `a\n${ru}\nb\nx${ru.slice(1)}\n`), [2, 4]);
});

test('arbitrary Russian backlog prose is rejected', () => {
  const text = String.fromCodePoint(0x042f);
  for (const rel of ['docs/backlog/queue/BS-1-probe.md', 'docs/backlog/minor/BS-1.1-probe.md']) {
    assert.deepEqual(unexplainedLines(rel, text), [1], rel);
  }
});

test('arbitrary Russian archive prose is rejected', () => {
  const text = String.fromCodePoint(0x042f);
  for (const rel of ['docs/archive/LOG.md', 'docs/archive/BS-1-probe/task.md', 'docs/archive/BS-1-probe/result.md']) {
    assert.deepEqual(unexplainedLines(rel, text), [1], rel);
  }
});

test('identified diagnostic and multilingual-input literals are retained exactly once', () => {
  for (const entry of EVIDENCE) {
    assert.ok(entry.source.trim(), entry.file);
    const lines = readFileSync(path.join(ROOT, entry.file), 'utf8').split('\n')
      .filter((line) => line.startsWith(entry.marker));
    assert.equal(lines.length, 1, entry.file + ': ' + entry.marker);
    for (const literal of entry.literals) {
      assert.equal(lines[0].split(literal).length - 1, 1, entry.file + ': ' + literal);
    }
    assert.deepEqual(unexplainedLines(entry.file, entry.marker + entry.literals.join(' ')), []);
  }
});

test('a literal exception admits no extra prose, repetition, changed literal, path or entry', () => {
  const ru = String.fromCodePoint(0x042f);
  for (const entry of EVIDENCE) {
    const text = entry.marker + entry.literals.join(' ');
    assert.deepEqual(unexplainedLines(entry.file, text + ru), [1]);
    assert.deepEqual(unexplainedLines(entry.file, text + entry.literals[0]), [1]);
    assert.deepEqual(unexplainedLines(entry.file, text.replace(entry.literals[0], entry.literals[0] + ru)), [1]);
    assert.deepEqual(unexplainedLines('docs/backlog/queue/BS-1-probe.md', text), [1]);
    assert.deepEqual(unexplainedLines(entry.file, 'another entry ' + text), [1]);
    assert.deepEqual(unexplainedLines(entry.file, text + '\n' + ru), [2]);
  }
});
