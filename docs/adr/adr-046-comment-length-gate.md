# ADR-046: Inline comments: at most two lines and 100 code points, checked by a test

**Status:** Accepted
**Date:** 2026-09-29
**Deciders:** Velklish

## Context

Agents read this repository's code, and every comment paragraph is paid for in tokens on every read of the file. A nuance that does not fit in two short lines belongs in documentation — `docs/reference/`, the subsystem README or an ADR — with a short pointer beside the code, and only where the nuance cannot be found without it. The rule governs this repository only, while lint runs in consumer projects that have neither this code nor this rule. A line regex cannot find comments: a backtick inside a regex literal opens a template that never closes, and everything after it stops being a comment, so the check needs a lexer that keeps state across lines. A walk that reads nothing passes every emptiness check, so the check must prove that it read files.

## Options

- **A lint gate** — lint runs in consumer projects, which have neither this code nor this rule.
- **A shrink-only debt list** — nothing is left to shrink, and an empty list with zero ceilings only rejects.

## Decision

- **A test, not a lint gate.** The rule lives in the "Comments" paragraph of `AGENTS.md`, and `test/comment-length.test.mjs` checks it inside `npm test`.
- **Scope** (`scannedCode` in `test/comment-scan.mjs`). The `.js` and `.mjs` files under `lib`, `test`, `bin` and `scripts` that git does not ignore: the index plus untracked files that are not ignored, so a new file is judged from its first save; a deleted file still in the index is not judged. Every named tree must yield at least one file, or the test fails.
- **The lexer** (`commentSpans`) keeps state across lines. A quoted string ends at its closing quote or at a line break; a template literal nests through `${…}`, and a brace inside `${…}` does not close it; a regex literal, with character classes and flags, is skipped. `/` opens a regex unless the previous token ends a value — an identifier or number, a string, template or regex literal, `)`, `]`, `}`, `++` or `--` — except after the keywords `return`, `typeof`, `instanceof`, `in`, `of`, `new`, `delete`, `void`, `throw`, `case`, `do`, `else`, `yield` and `await`.
- **The block** (`commentBlocks`). A block is a run of consecutive lines that carry nothing but comment. Code before a comment makes the line a code line, code after a comment ends the block on that line, and a blank line ends it. `//` lines, `/* */` comments with their bare continuation lines and JSDoc join into one block.
- **Length** (`longBlocks`, `LIMIT` = 2). A block longer than two lines fails, and the refusal names the file, the line and the length.
- **Width** (`wideLines`, `WIDTH` = 100). A block line wider than 100 code points fails: the whole line with its indent counts, a tab counts as one, and a trailing `\r` is not counted.
- **No debt list.** Every block over a limit fails wherever it is.
- **The floor.** The number of judged files equals the number of walked files, which separates "read nothing" from "read everything".
- **The probe.** `test/fixtures/comment-debtor.js.txt` carries a three-line `//` block, a four-line `/* */` block and a two-line block whose second line is 101 code points wide. Its `.txt` extension keeps it out of the walk, and the test asserts that; the probe tests judge the fixture directly and require every long block and every wide line to be refused, with the file and line named.

## Consequences

- Prose is not judged: a false comment, one that restates the code, or one carrying a task number or a date passes if it fits.
- A comment that trails a code line is not judged, and neither is a line where code follows a comment.
- A long comment split by blank lines into short blocks passes.
- Width is counted in code points: a composite emoji counts wider than it is displayed, and an East Asian wide character or a tab counts as one.
- A regex literal right after `)` is read as a division.
- Renaming the fixture to `.js` or `.mjs` puts it into the walk and fails the not-walked assertion.
