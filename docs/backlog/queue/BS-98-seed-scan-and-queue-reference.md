# BS-98 · seed: English Scope, script filter, YAML block scalars, worktrees, quoted paths, slugs

- **Order:** 160
- **Scope:** [02. CLI](../../reference/02-cli.md) § seed
- **Created:** 2026-09-25
- **Dependencies:** BS-89

## Context

Line numbers refer to base commit 6f6318e (v0.11.0). `$BS` below is `node <repo>/bin/backslop.js`; throwaway projects are created with `git init -q && $BS init --lang en --tools none` unless stated otherwise.

Five verified minor bugs and one unverified item in lib/seed.js. `seed --scan` prints gate and subsystem candidates for a human or agent to copy (docs/reference/02-cli.md:20); `seed --queue-reference` creates describe-tasks from the reference table.

**1. `--queue-reference` writes a Russian Scope value into an English project.** verified — reproduced on 6f6318e.
- `init --lang en`, add `| [Orders API](orders-api.md) | HTTP |` to docs/reference/README.md, `$BS seed --queue-reference` → rc=0; the task reads `- **Scope:** [Orders API](../../reference/README.md) — раздел `orders-api.md` ещё не написан` while every other line is English.
- Root cause: lib/seed.js:207 builds `area` as a bare template literal; the title (:203) and the field label (:208, `setField(…, cfg.lang)`) are localised. test/seed.test.mjs:76-104 covers only a ru project.

**2. `--scan` lists every file in bin/ as a subsystem.** verified — reproduced on 6f6318e.
- `node -e` with the regex: `app.dll`, `app.exe`, `app.pdb`, `Debug` → true. `bin/app.dll`, `app.exe`, `app.pdb`, `app.deps.json`, `app.runtimeconfig.json`, `cli`, `cli.js` → `seed --scan --json` lists all seven as subsystems.
- Root cause: lib/seed.js:21 `const BIN_SCRIPT = /^[\w.-]+(?:\.(?:js|mjs|cjs|ts|sh|py|rb)|)$/;` — `[\w.-]+` consumes the extension and the alternation ends in an empty branch. The comment at lib/seed.js:159-160 says `.dll` files next to scripts are not subsystems; test/seed.test.mjs:28, :55 put the dll only under bin/Release/.

**3. `--scan` emits YAML block indicators as commands.** verified — reproduced on 6f6318e.
- .github/workflows/ci.yml with `- run: >-` / `npm test` and `- run: |+` / `npm run lint` → gates `[{"command":">-",…ci.yml:4},{"command":"|+",…ci.yml:6}]`, the real commands missing; `>+` and `|2` behave the same, `run: |` works.
- Root cause: lib/seed.js:124 `if (inline && inline !== '|' && inline !== '>' && inline !== '|-')` excludes only three indicators; :125 pushes the indicator and :126 skips the block body. The comment at lib/seed.js:114-115 states the intent to read the indented block below `run: |`.

**4. `--scan` walks into nested git worktrees.** verified — reproduced on 6f6318e.
- src/Orders/Orders.csproj committed, `git worktree add .claude/worktrees/w1 -b w1` → `seed --scan --json` lists `dotnet build .claude/worktrees/w1/src/Orders/Orders.csproj`, `dotnet test …` and a second `Orders` subsystem from the worktree copy.
- Root cause: lib/seed.js:235 `if (SKIP_DIRS.has(e.name) || SKIP_BUILD.has(e.name) || e.name.startsWith('.git')) continue;` ignores `SKIP_RELS` (`.claude/worktrees`, lib/mdwalk.js:14), which the markdown walker uses for exactly this reason (docs/reference/03-lint.md:34).

**5. `--scan` emits unquoted .NET project paths.** verified — reproduced on 6f6318e with dotnet 10.0.102.
- `My Service/My Service.csproj` → candidate `dotnet build My Service/My Service.csproj`; running that string as lib/gates.js:142 does (`shell: true`) → rc=1 `MSBUILD : error MSB1008: Only one project can be specified.`; the quoted form reaches the project.
- Root cause: lib/seed.js:103-104 `add(`dotnet build ${rel}`, rel); add(`dotnet test ${rel}`, rel);`. Directory names with spaces are common for .NET solutions on Windows (supported).

**6. Unverified — rows whose links share a basename collapse into one task.** This item is **unverified — run the check first**. The behaviour was observed once on 6f6318e; it has not been reproduced independently, and nobody has checked yet whether a doc, ADR or test sanctions it. Work it in order: (1) reproduce blind in a throwaway project with the exact commands, (2) look for a doc, ADR or test that sanctions the behaviour, (3) fix only if (1) reproduces and (2) finds no sanction. Record the outcome of each step in the result (reproduced / not reproduced / sanctioned by <file:line>). Observed: lib/seed.js:193 `const slug = `describe-${path.basename(href.split('#')[0], '.md').toLowerCase()}`;` ignores the directory; lib/seed.js:199-201 count an existing slug as already seeded. Rows `[API service](api/README.md)` and `[Worker service](worker/README.md)` produced one `BS-1-describe-readme.md` and `tasks created 1, skipped as already seeded 1`; the task's Scope names only `api/README.md`.

## Work to do

- Bug 1: wrap the Scope value at lib/seed.js:207 in `tr(cfg.lang, …, `[${label}](../../reference/README.md) — section \`${href}\` is not written yet`)`.
- Bug 2: anchor the name part so the extension list constrains it: `/^[\w-]+(?:\.(?:js|mjs|cjs|ts|sh|py|rb))?$/`.
- Bug 3: detect any YAML block scalar indicator with `/^[|>](?:[+-]?\d?|\d?[+-]?)$/` and fall through to the indented-block branch for every match.
- Bug 4: skip the rels in `SKIP_RELS` (import it from lib/mdwalk.js) in the seed walker, and do not descend into a directory whose `.git` file points into this repository's `.git/worktrees/` (a linked worktree); keep descending into submodules (their `.git` file points into `.git/modules/`), which may hold real subsystems.
- Bug 5: quote the path in the emitted command when it contains whitespace or shell metacharacters (double quotes work in sh and cmd.exe).
- [ ] Unverified — describe-slug collisions (lib/seed.js `--queue-reference`), item 6
    1. Blind repro: `git commit -q --allow-empty -m init && printf '| [API service](api/README.md) | http | not yet |\n| [Worker service](worker/README.md) | jobs | not yet |\n' >> docs/reference/README.md && git add -A && git commit -qm table && $BS seed --queue-reference; echo rc=$?; ls docs/backlog/queue; grep -n Scope docs/backlog/queue/*.md` — expected wrong output: one `BS-1-describe-readme.md`, summary `tasks created 1, skipped as already seeded 1`, Scope naming only `api/README.md`.
    2. Refutation check: docs/reference/02-cli.md seed row and the seed ADR: if the slug is defined from the basename on purpose, it is still wrong for the second row (no task); record the documented rule.
    3. Fix only if confirmed: build the slug from the whole relative path (`describe-api-readme`, `describe-worker-readme`); keep recognising a task created under the old basename slug as already seeded so re-running on an existing project creates no duplicates; report a slug collision separately with both hrefs; BS-89 (`link-gate-target-resolution`) already rebuilt the href split of lib/seed.js:191-193, so change the slug derivation in the code as it is; tests for two README rows and for a re-run.
- Add the regression tests listed under Verification to test/seed.test.mjs.

## Out of scope

- Lint failures right after seeding — the BS-167 (`backslop-seed-skill-fixes`) card.

## Verification

- New test (bug 1): en project → seeded Scope line has no Cyrillic (`/[\u0400-\u04FF]/` does not match).
- New tests (bugs 2–5): bin/app.dll directly in bin/ not listed; `run: >-`, `|+`, `>+`, `|2` blocks yield their body commands; `.claude/worktrees/w1` copy not listed; `My Service/My Service.csproj` candidate is `dotnet build "My Service/My Service.csproj"`.
- Item 6: the result names the outcome of checklist steps 1–2 with the command output and rc; if confirmed, a red-then-green test in test/seed.test.mjs (two README rows, and a re-run that creates no duplicate); if sanctioned, no code change.
- `npm test` → rc=0; `node bin/backslop.js lint` → rc=0.
