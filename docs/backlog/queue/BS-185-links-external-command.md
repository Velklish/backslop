# BS-185 · Add links --external: classify external URLs outside the gates

- **Order:** 990
- **Scope:** [02. CLI](../../reference/02-cli.md)
- **Created:** 2026-09-28
- **Dependencies:** BS-184, BS-160, BS-176

## Context

Owner decision 10 of BS-183: external URLs are checked by a separate command, never inside `gates`. A network answer is not reproducible, so a gate built on it would redden a commit for somebody else's server.

Nothing checks them today. `EXTERNAL` (lib/links.js:23 at 744a653) drops every `<scheme>:` and `//host` href before gate 1 resolves anything.

The source is promptobus v0.20.0 (github.com/Velklish/promptobus, tag `v0.20.0`): `scripts/docs-links.mjs --external` (`npm run docs-links:external`), with `classifyHttpStatus`, `classifyTransportFailure` and `checkExternal`. Each URL is requested with GET, redirects followed, a 20-second timeout and its own user agent. The classes:

| Class | Answer |
|---|---|
| ok | 2xx and 3xx |
| unverified | 401, 403, 408, 429, any 5xx, or a transport failure |
| dead | 404, 410 and every other status |

Exit codes: 0 when every URL is ok; 1 when any URL is dead; 2 when some are unverified and none is dead. promptobus runs it by hand, outside CI.

## Work to do

- New command `links --external [--json]`:
  - takes the http and https URLs of the gate-1 file set, read with the BS-184 parser;
  - drops duplicates by URL without the fragment;
  - requests the URLs one at a time with the global `fetch` (Node 20 and later, no dependency), following redirects, with a 20-second timeout and the user agent `backslop-links`;
  - classifies each URL as in the table and prints one row per URL, `<class> <status or error> <url>`, then the line `links: N urls, D dead, U unverified`;
  - with `--json`, prints one JSON document instead;
  - exits with the codes above.
- `links` without `--external` is a usage error. `lint` already covers local links, so the command has no local mode.
- `init` does not add the command to `gates`, and neither does anything else.
- Help lines in both languages, following the convention in force (see BS-184 on localization).
- **Documentation:**
  - `docs/reference/02-cli.md`: a section for the command;
  - the command table of `README.md`;
  - the orchestrator contract page from BS-176 (`docs/reference/05-orchestrator-contract.md`): the exit codes, the JSON shape and a line in the stable list;
  - `CHANGELOG.md` under the unreleased section.
- **Tests** against a local `node:http` server started by the test, never the internet:
  - 200; 301 then 200; 404; 410; 403; 429; 500; a closed port as the transport failure;
  - the class of each and the exit code of the whole run;
  - the `--json` shape;
  - duplicates dropped by URL without the fragment.

## Out of scope

- Any external check inside `gates` or `lint`.
- Retries, backoff, authentication, `robots.txt`.

## Verification

- `npm test` passes, including the new tests.
- `node bin/backslop.js links --external; echo rc=$?` on this repository: record the output. It depends on the network and is evidence, not a gate.
- Mutation probe after the commit: classify 404 as ok. The dead-URL test turns red; restore, and it is green. Record the exit code of both runs.
- `node bin/backslop.js gates` exits 0.
