# BS-109 · Move duplicated fs probes, escapeRe, DATE_RE, printJson, readText/writeText to util.js

- **Order:** 270
- **Scope:** [Reference](../../reference/README.md)
- **Created:** 2026-09-25
- **Dependencies:** BS-104

## Context

The same small helpers are copied into several lib modules. All copies behave the same today, so this card is a pure refactor with no user-visible change. lib/util.js imports nothing from lib/, so any module can import it without a cycle, including log.js, which cannot import tasks.js (lib/log.js:1-2).

**1. fs probe helpers** — verified — `grep -n "function statOrNull\|function realOrNull\|function safeRealpath\|function isFileAt\|function isFile\b" lib/*.js` at base prints lib/lint.js:619, lib/mdwalk.js:16, lib/mdwalk.js:24, lib/seed.js:263, lib/seed.js:267, lib/tasks.js:336, lib/adapters.js:181.
- `statOrNull` is the same code (try `statSync` / catch null) at lib/lint.js:619, lib/mdwalk.js:16 and lib/seed.js:267.
- Realpath-or-null appears as `realOrNull` (lib/mdwalk.js:24), as `safeRealpath` (lib/tasks.js:336), and inline in `sameDir` (lib/lint.js:75-81).
- Is-file appears as `isFileAt` (lib/adapters.js:181) and `isFile` (lib/seed.js:263). Both give the same result for every input.
- Keep two helpers out of this move, because they differ on purpose: `lstatOrNull` (lib/adapters.js:177) rethrows everything except ENOENT/ENOTDIR, and `isFileEntry` (lib/tasks.js:196) works on a Dirent.
- Caveat: `sameDir` must keep returning false when either side fails to resolve. A naive `realpathOrNull(a) === realpathOrNull(b)` returns true for two missing directories.

**2. Regex escape** — verified — a `grep -F` for the character class `[.*+?^${}()|[\]\\]` finds exactly five sites at base.
- The full escape `s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')` is at lib/config.js:69, lib/gates.js:37, lib/log.js:20, lib/mdwalk.js:99 and lib/show.js:76.
- Two partial escapes, lib/lint.js:38 (`SOURCE.replace(/[.\\]/g, '\\$&')`) and lib/lint.js:100 (`version.replace(/\./g, '\\.')`), are correct for their fixed inputs, so a full escape builds an equivalent regex.

**3. Date regex** — verified — read the code. `/^\d{4}-\d{2}-\d{2}$/` is declared as `DATE` at lib/lint.js:25 (used at :355) and as `DATE_RE` at lib/fold.js:15 (used at :24 and :157). It has no `g` flag, so one shared instance has no `lastIndex` state.

**4. JSON to stdout** — verified — all five sites were replaced by one `printJson` in a clone at base. `npm test` passed 450/450 and `lint` exited 0.
- `process.stdout.write(`${JSON.stringify(v, null, 2)}\n`)` is written at lib/tracks.js:89, lib/gates.js:210, lib/gates.js:276, lib/seed.js:53 and lib/status.js:68 (inside a ternary).

**5. mkdir -p + write** — verified — read the code at base.
- `writeText` (lib/tasks.js:353-356) is `mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text);`.
- The same two lines are inlined at lib/init.js:140-141 and :148-149, at lib/migrate.js:23-24, :35-36 and :105-106, at lib/adapters.js:52-53 (inside its ENOTDIR/EEXIST try), and at test/helpers.mjs:89-90.
- `writeText` throws the same errors, so the catch at lib/adapters.js:54-59 keeps working.
- Ten lib modules import `readText`/`writeText` from tasks.js.

## Work to do

- Export from lib/util.js: `statOrNull`, `realpathOrNull`, `isFileAt` (stat follows symlinks, then `isFile()`), `escapeRe(s)`, `DATE_RE` (next to `today()`), `printJson(value)`, `readText` and `writeText`. Move `readText`/`writeText` from lib/tasks.js unchanged.
- Replace the stat, realpath and is-file copies at lib/lint.js:619, lib/mdwalk.js:16 and :24, lib/seed.js:263 and :267, lib/tasks.js:336 and lib/adapters.js:181. Rewrite `sameDir` (lib/lint.js:75-81; the BS-118 (`command-module-exports`) card later moves it as `isToolRepo`) as `const ra = realpathOrNull(a); return ra !== null && ra === realpathOrNull(b);`.
- Replace the escapes at lib/config.js:69, lib/gates.js:37, lib/log.js:20, lib/mdwalk.js:99, lib/show.js:76, lib/lint.js:38 and lib/lint.js:100 with `escapeRe`.
- Use `DATE_RE` at lib/lint.js:355 and at lib/fold.js:24 and :157. Delete both local declarations.
- Use `printJson` at lib/tracks.js:89, lib/gates.js:210, lib/gates.js:276, lib/seed.js:53 and lib/status.js:68.
- Point every importer of `readText`/`writeText` at lib/util.js; do not leave a re-export in tasks.js. Use `writeText` at lib/init.js:140 and :148, at lib/migrate.js:23, :35 and :105, and at lib/adapters.js:52 (inside its existing try). test/helpers.mjs:89 is optional.

## Out of scope

- `lstatOrNull` (adapters.js) and `isFileEntry` (tasks.js). They have different semantics on purpose.
- Restoring a UTF-8 BOM in `writeText` (BS-100 (`unverified-bom-and-move-fallback`)).
- Moving `splitLines`/`eolOf` (handled by the BS-110 (`text-lines-eol-module`) card).
- Any change in behaviour or messages.

## Verification

- `grep -rn "function statOrNull\|function realOrNull\|function safeRealpath\|function isFileAt" lib` → only lib/util.js.
- A grep over lib/ for the escape class `[.*+?^${}()|[\]\\]` → one hit, in lib/util.js.
- `grep -rn 'mkdirSync(path.dirname' lib` → only the `writeText` body in lib/util.js.
- `grep -rn 'JSON.stringify(.*, null, 2)}\\n' lib` → only `printJson` in lib/util.js (config.js keeps its own file serialisation).
- `grep -n liveMarkdown lib/lint.js; echo rc=$?` → rc=1 (the dead import was removed by BS-104 (`unexport-lib-internals`); this card owns the rest of that finding, the private `statOrNull`/`realOrNull` copies).
- `npm test`: the same number of tests pass as before the change (450 at base 6f6318e). `node bin/backslop.js lint` → rc=0.
