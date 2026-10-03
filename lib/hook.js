import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { loadProject } from './config.js';
import { lintProject } from './lint.js';
import { msg } from './i18n.js';
import { CliError, git, gitCause, parseCommandArgs, toPosix } from './util.js';

const EVENTS = ['session-start', 'stop'];
// The errors are reported this many times in a row, whatever they are; the next stop exits 0.
const RETURN_LIMIT = 3;
const SHA_RE = /^[0-9a-f]{40,64}$/;

// A condition under which the hook does nothing: one note, exit 0. `cause` is a function of the
// language, so the key stays a literal at its `msg` call.
class Skip extends Error {
  constructor(cause) {
    super('hook skipped');
    this.cause = cause;
  }
}

const toStderr = (text) => { process.stderr.write(`${text}\n`); };

// claude and codex: the text on stderr, exit 2. cursor: stdout `{"followup_message": …}`, exit 0.
// A note: stdout `{"systemMessage": …}` for claude and codex, stderr for cursor.
const PROTOCOLS = {
  claude: {
    returnTurn: (text) => { toStderr(text); return 2; },
    warn: (text) => { process.stdout.write(`${JSON.stringify({ systemMessage: text })}\n`); },
  },
  cursor: {
    returnTurn: (text) => { process.stdout.write(`${JSON.stringify({ followup_message: text })}\n`); return 0; },
    warn: toStderr,
  },
};
PROTOCOLS.codex = PROTOCOLS.claude;

export async function run(argv, { cwd, lang }) {
  const { values, positionals: [event = ''] } = parseCommandArgs(argv, { harness: { type: 'string' } }, { positionals: 1, lang });
  if (!EVENTS.includes(event)) {
    throw new CliError(msg(lang, 'unknown hook event “{event}”: expected session-start or stop', { event }));
  }
  const protocol = Object.hasOwn(PROTOCOLS, values.harness) ? PROTOCOLS[values.harness] : { warn: toStderr };
  try {
    if (!protocol.returnTurn) {
      throw new Skip((l) => msg(l, 'harness “{harness}” is not claude, cursor or codex', { harness: values.harness ?? '' }));
    }
    const repo = repository(cwd);
    const { session_id: session } = await readPayload();
    const file = path.join(repo.gitDir, 'backslop', 'hooks', `${values.harness}-${session.replace(/[^\w.-]/g, '_').slice(0, 128)}.json`);
    const record = { harness: values.harness, session };
    return event === 'stop' ? stop(repo, file, record, protocol) : sessionStart(repo, file, record);
  } catch (e) {
    const cause = e instanceof Skip ? e.cause : () => e.message;
    protocol.warn(msg(lang, 'hook skipped: {cause}', { cause }));
    return 0;
  }
}

function repository(cwd) {
  const r = git(cwd, ['rev-parse', '--git-dir', '--show-toplevel']);
  if (r.status !== 0) throw new Skip((l) => msg(l, 'not a git repository'));
  const [gitDir, top] = r.stdout.split('\n');
  const project = loadProjectOrSkip(cwd);
  return { gitDir: path.resolve(cwd, gitDir), top, root: realpathSync(project.root), project };
}

// loadProject refuses with a CliError for a missing or broken backslop.json; here both are a skip.
function loadProjectOrSkip(cwd) {
  try {
    return loadProject(cwd);
  } catch (e) {
    if (!(e instanceof CliError)) throw e;
    throw new Skip(() => e.message);
  }
}

async function readPayload() {
  let text = '';
  try {
    if (process.stdin.isTTY) throw new Error('a terminal');
    for await (const chunk of process.stdin) text += chunk;
  } catch {
    throw new Skip((l) => msg(l, 'the event on stdin cannot be read'));
  }
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    // falls through to the refusal below
  }
  if (typeof payload?.session_id !== 'string' || !payload.session_id) {
    throw new Skip((l) => msg(l, 'the event on stdin is not a JSON object with a session_id'));
  }
  return payload;
}

function startPoint(top, lang) {
  const head = git(top, ['rev-parse', '--verify', '-q', 'HEAD']);
  if (head.status === 0) return head.stdout.trim();
  const empty = git(top, ['hash-object', '-t', 'tree', '--stdin'], { input: '' });
  if (empty.status !== 0) throw new Error(gitCause(empty, lang));
  return empty.stdout.trim();
}

function readRecord(file) {
  try {
    const rec = JSON.parse(readFileSync(file, 'utf8'));
    return typeof rec?.start === 'string' && SHA_RE.test(rec.start) ? rec : null;
  } catch {
    return null;
  }
}

function writeRecord(file, rec) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(rec, null, 2)}\n`);
}

function sessionStart({ top, project }, file, record) {
  const previous = readRecord(file);
  const sameSession = previous?.harness === record.harness && previous.session === record.session;
  writeRecord(file, {
    ...record,
    start: sameSession ? previous.start : startPoint(top, project.cfg.lang),
    time: sameSession ? previous.time : new Date().toISOString(),
  });
  return 0;
}

function gitPaths(top, args, lang) {
  const r = git(top, args);
  if (r.status !== 0) throw new Error(gitCause(r, lang));
  return r.stdout.split('\0').filter(Boolean);
}

// Committed since `start`, staged or not, and untracked files that git does not ignore.
function changedSet(top, start, lang) {
  return new Set([
    ...gitPaths(top, ['diff', '--name-only', '-z', '--no-renames', start, '--'], lang),
    ...gitPaths(top, ['ls-files', '--others', '--exclude-standard', '-z'], lang),
  ]);
}

function stop({ top, root, project }, file, record, protocol) {
  const { cfg } = project;
  const rec = readRecord(file);
  const start = rec?.start ?? startPoint(top, cfg.lang);
  const changed = new Set([...changedSet(top, start, cfg.lang)].map((p) => toPosix(path.relative(root, path.join(top, p)))));
  const kept = changed.size === 0 ? [] : keptErrors(lintProject(project).errors, changed);
  if (kept.length === 0) {
    if (rec?.returns) writeRecord(file, { ...rec, returns: null });
    return 0;
  }
  const lines = kept.join('\n');
  const count = Number.isInteger(rec?.returns?.count) ? rec.returns.count : 0;
  if (count >= RETURN_LIMIT) {
    protocol.warn(`${msg(cfg.lang, 'lint errors in changed files were reported {limit} times in a row; the hook now exits 0, the errors stay:', { limit: RETURN_LIMIT })}\n${lines}`);
    return 0;
  }
  writeRecord(file, { ...(rec ?? { ...record, start, time: new Date().toISOString() }), returns: { count: count + 1 } });
  return protocol.returnTurn(`${lines}\n${msg(cfg.lang, 'fix these errors in the files named above; do not bypass the hook')}`);
}

// One line per distinct error in a changed file; an error without a file is never kept.
function keptErrors(errors, changed) {
  const lines = errors.filter((e) => e.file && changed.has(e.file)).map((e) => `${e.file}: ${e.msg}`);
  return [...new Set(lines)].sort();
}
