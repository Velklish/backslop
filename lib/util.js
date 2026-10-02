import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { msg, msgBoth } from './i18n.js';

// A refusal addressed to a person: the entry point prints the text without a stack and exits 1.
// Everything else is a code error, and it needs the stack.
export class CliError extends Error {}

// Colour follows the stream the line goes to: under `> out.txt` ANSI codes do not reach the file.
const paint = (stream, code, s) => (stream.isTTY && !process.env.NO_COLOR ? `\x1b[${code}m${s}\x1b[0m` : s);

export function ok(msg) { console.log(`${paint(process.stdout, 32, '✔')} ${msg}`); }
export function info(msg) { console.log(`  ${msg}`); }
export function warn(msg) { console.warn(`${paint(process.stderr, 33, '⚠')} ${msg}`); }
// A routine report on stderr, unmarked: for commands whose stdout carries data.
export function note(msg) { console.error(`  ${msg}`); }
// The same level as a refusal, but without exiting: a diagnosis lists everything found.
export function bad(msg) { console.error(`${paint(process.stderr, 31, '✖')} ${msg}`); }

// The machine's calendar date, not UTC: "Taken" at 1 a.m. local time is today's date for the one
// working, while toISOString east of UTC would give yesterday's.
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Paths in markdown and in output are always posix, Windows included.
export function toPosix(p) {
  return p.split(path.sep).join('/');
}

export function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function statOrNull(file) {
  try {
    return statSync(file);
  } catch {
    return null;
  }
}

export function realpathOrNull(file) {
  try {
    return realpathSync(file);
  } catch {
    return null;
  }
}

// Follows a symlink: a link to a file is a file.
export function isFileAt(file) {
  return statOrNull(file)?.isFile() === true;
}

// The file is read without a BOM; line breaks stay as they were: a CRLF file is still a CRLF file
// after an edit.
export function readText(file) {
  const text = readFileSync(file, 'utf8');
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

// A file that cannot be read or parsed is a refusal naming it; `cause` keeps the parser's text.
export function readJson(file) {
  try {
    return JSON.parse(readText(file));
  } catch (e) {
    throw new CliError(`${path.basename(file)}: ${msgBoth(null, 'cannot be parsed')} — ${e.message}`, { cause: e });
  }
}

export function readJsonOrNull(file) {
  if (!isFileAt(file)) return null;
  try {
    return readJson(file);
  } catch {
    return null;
  }
}

// A rewrite keeps the UTF-8 BOM the file had on disk; `readText` hands the text out without it.
// `keepBom: false` writes the text byte for byte: a whole file the tool renders.
export function writeText(file, text, { keepBom = true } = {}) {
  mkdirSync(path.dirname(file), { recursive: true });
  const keep = keepBom && !text.startsWith('\uFEFF') && existsSync(file) && readFileSync(file).subarray(0, 3).equals(UTF8_BOM);
  const bom = keep ? '\uFEFF' : '';
  writeFileSync(file, bom + text);
}

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

// The ceiling of git output: spawnSync's default of 1 MiB would cut a large commit and a long
// history off with `ENOBUFS`.
export const GIT_MAX_BUFFER = 1 << 28;

// git with an explicit root and a wait ceiling: without the ceiling a stuck index.lock would hold
// the command forever.
export function git(root, args, opts = {}) {
  return spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 60_000, maxBuffer: GIT_MAX_BUFFER, ...opts });
}

// The reason for a git refusal: stderr, else the launch error (ENOENT, ENOBUFS, ETIMEDOUT), else
// the signal or the code.
export function gitCause(r, lang = 'ru') {
  const stderr = (r.stderr ?? '').trim();
  if (stderr) return stderr;
  if (r.error) return r.error.message;
  if (r.signal) return msg(lang, 'killed by {signal}', { signal: r.signal });
  return msg(lang, 'exit code {status}', { status: r.status });
}

// No repository or no git binary is `false`; any other git failure is a refusal, not "no git".
// LC_ALL=C: git translates its messages, and the stderr test needs the English one.
export function insideRepo(root, lang = 'ru') {
  const r = git(root, ['rev-parse', '--is-inside-work-tree'], { env: { ...process.env, LC_ALL: 'C' } });
  if (r.status === 0) return true;
  if (r.error?.code === 'ENOENT') return false;
  if (r.status === 128 && /not a git repository/i.test(r.stderr ?? '')) return false;
  throw new CliError(`git rev-parse --is-inside-work-tree: ${gitCause(r, lang)}`);
}

export function gitOrFail(root, args, lang = 'ru') {
  const r = git(root, args);
  if (r.status !== 0) throw new CliError(`git ${args.join(' ')}: ${gitCause(r, lang)}`);
  return r.stdout;
}

// The project directory under the repository toplevel (`pkg/a/`). A failure refuses: an empty
// prefix would read toplevel paths as project paths.
export function showPrefix(root, lang = 'ru') {
  return gitOrFail(root, ['rev-parse', '--show-prefix'], lang).trim();
}

// Status 1 is "not in the index"; any other failure refuses rather than reading as untracked.
export function isTracked(root, pathspec, lang = 'ru') {
  const r = git(root, ['ls-files', '--error-unmatch', '--', pathspec]);
  if (r.status === 0 || r.status === 1) return r.status === 0;
  throw new CliError(`git ls-files --error-unmatch: ${gitCause(r, lang)}`);
}

// `-z` keeps a non-ASCII path unquoted; `flags` such as `--others` pick the listing.
export function lsFiles(root, paths, flags = [], lang = 'ru') {
  return gitOrFail(root, ['ls-files', '-z', ...flags, '--', ...paths], lang).split('\0').filter(Boolean);
}

// Changed paths from the repository root, `null` when git fails. `-z` keeps non-ASCII unquoted,
// `-uall` lists files instead of `?? dir/`, and a rename or copy gives both names.
export function porcelainPaths(root) {
  const r = git(root, ['status', '--porcelain', '-z', '-uall']);
  if (r.status !== 0) return null;
  const fields = r.stdout.split('\0').filter((f) => f !== '');
  const paths = [];
  for (let i = 0; i < fields.length; i += 1) {
    const xy = fields[i].slice(0, 2);
    paths.push(fields[i].slice(3));
    if (xy.includes('R') || xy.includes('C')) {
      i += 1;
      if (fields[i] !== undefined) paths.push(fields[i]);
    }
  }
  return paths;
}

// Worktrees from `git worktree list --porcelain`: one parse for `foreignTaskIds` and `tracks`. A
// detached HEAD has `branch: null` and a `HEAD <sha>` line; without git the list is empty.
export function worktrees(root, lang = 'ru') {
  if (!insideRepo(root, lang)) return [];
  const list = git(root, ['worktree', 'list', '--porcelain']);
  if (list.status !== 0) throw new CliError(`git worktree list --porcelain: ${gitCause(list, lang)}`);
  const out = [];
  for (const block of list.stdout.split(/\n\n+/)) {
    const wtPath = block.match(/^worktree (.+)$/m)?.[1];
    if (!wtPath) continue;
    out.push({
      path: wtPath,
      branch: block.match(/^branch refs\/heads\/(.+)$/m)?.[1] ?? null,
      head: block.match(/^HEAD ([0-9a-f]+)$/m)?.[1] ?? null,
      prunable: /^prunable\b/m.test(block),
      locked: /^locked\b/m.test(block),
    });
  }
  return out;
}

export function localBranches(root, lang = 'ru') {
  const r = git(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/']);
  if (r.status !== 0) throw new CliError(`git for-each-ref refs/heads/: ${gitCause(r, lang)}`);
  return r.stdout.split('\n').map((b) => b.trim()).filter(Boolean);
}

// Realpath when both sides resolve, `path.resolve` when one does; two unresolved never match.
export function isSameTree(a, b) {
  const ra = realpathOrNull(a);
  const rb = realpathOrNull(b);
  if (ra !== null && rb !== null) return ra === rb;
  return (ra !== null || rb !== null) && path.resolve(a) === path.resolve(b);
}

// Cap per shell command: a stuck command would hold the run forever.
export const SHELL_TIMEOUT_MS = 10 * 60 * 1000;

// The command runs through the shell as is: `quiet` sends its output to stderr, `capture` returns
// stdout. Own code, a signal (or the cap) and a failed start are three outcomes (ADR-045).
export function runShell(command, { cwd, quiet = false, capture = false, timeout = SHELL_TIMEOUT_MS } = {}) {
  const started = Date.now();
  const stdio = capture ? ['ignore', 'pipe', 'inherit'] : quiet ? ['ignore', process.stderr, process.stderr] : 'inherit';
  const r = spawnSync(command, { cwd, shell: true, stdio, timeout, ...(capture && { encoding: 'utf8' }) });
  return {
    command,
    code: r.status ?? null,
    signal: r.signal ?? null,
    error: r.error ? r.error.message : null,
    ms: Date.now() - started,
    timedOut: r.error?.code === 'ETIMEDOUT',
    timeout,
    stdout: r.stdout ?? null,
  };
}

// Code 0 without a start error: the cap gives ETIMEDOUT even with code 0 when the shell outlives
// SIGTERM.
export function shellPassed(r) {
  return r.code === 0 && r.error === null;
}

// What happened, not only "not zero"; the cap named is the one the run had.
export function shellOutcome(r, lang = 'ru') {
  if (r.timedOut) {
    const min = r.timeout / 60000;
    if (Number.isInteger(min)) return msg(lang, 'timed out after the {min}-min cap', { min });
    return msg(lang, 'timed out after the {seconds}-second cap', { seconds: r.timeout / 1000 });
  }
  if (r.signal !== null) return msg(lang, 'killed by signal {signal}', { signal: r.signal });
  if (r.error !== null) return msg(lang, 'did not start: {error}', { error: r.error });
  return msg(lang, 'code {code}', { code: r.code });
}

// `-h`/`--help` of any command: the entry point catches it and prints the help.
export class HelpRequest extends Error {}

// Strict argv: a bad flag or too many positionals is a refusal in `lang`. A dash-leading value is
// glued into `--flag=value` unless it is a flag of this command (docs/reference/02-cli.md).
export function parseCommandArgs(argv, options, { positionals: limit, lang = null, tooMany = null }) {
  const args = [];
  for (let i = 0; i < argv.length; i += 1) {
    const tok = argv[i];
    const name = /^--[^=]+$/.test(tok) ? tok.slice(2) : null;
    const next = argv[i + 1];
    if (name && options[name]?.type === 'string' && next !== undefined && next.startsWith('-') && !isOption(next, options)) {
      args.push(`${tok}=${next}`);
      i += 1;
      continue;
    }
    args.push(tok);
  }
  let parsed;
  try {
    parsed = parseArgs({ args, options: { ...options, help: { type: 'boolean', short: 'h' } }, allowPositionals: true, strict: true });
  } catch (e) {
    throw new CliError(argvRefusal(e, lang));
  }
  if (parsed.positionals.length > limit) {
    const extra = parsed.positionals[limit];
    throw new CliError(tooMany ? tooMany(lang) : limit === 0
      ? msgBoth(lang, 'extra argument “{extra}”: the command takes no positional arguments; quote a value with spaces', { extra })
      : msgBoth(lang, 'extra argument “{extra}”: at most {limit} positional argument{s}; quote a value with spaces', { extra, limit, s: limit === 1 ? '' : 's' }));
  }
  if (parsed.values.help) throw new HelpRequest();
  return parsed;
}

// Node's parseArgs text names the flag but ends with a `--` hint, and after `--` extra positionals
// would pass; the refusal keeps the flag and, for a dash-leading value, the `--flag=…` form.
function argvRefusal(e, lang) {
  const flag = e.message.match(/'(?:-\w, )?(-[^' ]+)/)?.[1];
  if (!flag) return e.message;
  if (e.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION') {
    return msgBoth(lang, 'unknown option “{flag}”; see the command’s --help for its flags', { flag });
  }
  if (e.code !== 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE') return e.message;
  if (/ambiguous/.test(e.message)) {
    return msgBoth(lang,
      '{flag}: a flag of this command stands where its value should be; a value that starts with a dash goes in the form {flag}=…', { flag });
  }
  if (/does not take an argument/.test(e.message)) return msgBoth(lang, '{flag} takes no value', { flag });
  if (/argument missing/.test(e.message)) return msgBoth(lang, '{flag} needs a value', { flag });
  return e.message;
}

function isOption(tok, options) {
  const m = tok.match(/^--([^=]+)/);
  return Boolean(m && m[1] in options);
}
