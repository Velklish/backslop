// The numbering lock: one file in the git common directory that serialises `new` across the
// worktrees of a repository. Without git there is nothing shared, and so no lock.
import { closeSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { msg } from './i18n.js';
import { CliError, gitOrFail, insideRepo, statOrNull, toPosix } from './util.js';

export const LOCK_FILE = 'backslop-new.lock';
export const LOCK_WAIT_MS = 10_000;
export const LOCK_STALE_MS = 60_000;
export const LOCK_POLL_MS = 20;
const MAX_CLAIM_TRIES = 64;

// The test seam: the file operations, the clock, the sleep and a hook at the steps of a takeover.
export const lockIo = {
  open: openSync,
  write: writeSync,
  close: closeSync,
  rename: renameSync,
  unlink: unlinkSync,
  now: () => Date.now(),
  sleep: (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
  trace: () => {},
};

const quiet = (fn) => {
  try {
    fn();
  } catch { /* the cleanup is best effort */ }
};

const readOrNull = (file) => {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
};

const cannot = (lang, file, e) => new CliError(msg(lang, 'the numbering lock cannot be taken — {file}: {cause}', { file: toPosix(file), cause: e.message }));

// Creates `file` holding `token`, or fails with what `open` says; a file this call created and
// could not fill is removed again, so a failed write leaves no orphan lock.
function writeNew(file, token) {
  const fd = lockIo.open(file, 'wx');
  try {
    lockIo.write(fd, token);
    lockIo.close(fd);
  } catch (e) {
    quiet(() => lockIo.close(fd));
    quiet(() => lockIo.unlink(file));
    throw e;
  }
}

function create(lock, token, lang) {
  try {
    writeNew(lock, token);
    return true;
  } catch (e) {
    if (e.code === 'EEXIST') return false;
    throw cannot(lang, lock, e);
  }
}

// A stale lock is taken over through a claim file named by its content, and the claimant
// renames its own file over it (docs/adr/adr-050-process.md); a dead claim ages out too.
function claimLock(lock, content, token, staleMs, lang) {
  const stem = `${lock}.claim-${createHash('sha1').update(content).digest('hex').slice(0, 16)}`;
  const taken = [];
  for (let n = 1, tries = 0; tries < MAX_CLAIM_TRIES; tries += 1) {
    const claim = `${stem}-${n}`;
    try {
      writeNew(claim, token);
      return [...taken, claim];
    } catch (e) {
      if (e.code !== 'EEXIST') throw cannot(lang, claim, e);
    }
    const age = statOrNull(claim);
    if (age && lockIo.now() - age.mtimeMs <= staleMs) return null;
    if (age) {
      taken.push(claim);
      n += 1;
    }
  }
  return null;
}

function recover(lock, token, staleMs, lang) {
  const content = readOrNull(lock);
  const seen = statOrNull(lock);
  if (content === null || !seen || lockIo.now() - seen.mtimeMs <= staleMs) return false;
  lockIo.trace('stale-seen');
  const claims = claimLock(lock, content, token, staleMs, lang);
  if (!claims) return false;
  let replaced = false;
  try {
    lockIo.trace('claimed');
    const now = statOrNull(lock);
    if (readOrNull(lock) !== content || !now || lockIo.now() - now.mtimeMs <= staleMs) return false;
    const own = `${lock}.${randomUUID()}`;
    try {
      writeNew(own, token);
      lockIo.rename(own, lock);
    } catch (e) {
      quiet(() => lockIo.unlink(own));
      throw cannot(lang, lock, e);
    }
    replaced = true;
    return true;
  } finally {
    // Dead claims of the replaced lock go with it; after a refusal only our own.
    for (const claim of replaced ? claims : claims.slice(-1)) quiet(() => lockIo.unlink(claim));
  }
}

// Only a lock that still holds our token goes: after a takeover the file is somebody else's.
const releaser = (lock, token) => () => quiet(() => {
  if (readOrNull(lock) === token) lockIo.unlink(lock);
});

// Takes the lock of the repository `root` belongs to; returns its release. A taken lock is polled
// for `waitMs`, then refused; one older than `staleMs` is taken over.
export function takeNumberingLock(root, lang, { waitMs = LOCK_WAIT_MS, staleMs = LOCK_STALE_MS } = {}) {
  if (!insideRepo(root, lang)) return () => {};
  const lock = path.join(path.resolve(root, gitOrFail(root, ['rev-parse', '--git-common-dir'], lang).trim()), LOCK_FILE);
  const token = `${process.pid}\n${randomUUID()}\n`;
  const deadline = lockIo.now() + waitMs;
  for (;;) {
    if (create(lock, token, lang) || recover(lock, token, staleMs, lang)) return releaser(lock, token);
    if (lockIo.now() >= deadline) {
      throw new CliError(msg(lang,
        'another `new` holds the numbering lock {lock} and did not release it in {seconds} s: run the command again; if no backslop process is running, delete the file (a lock older than {stale} s is removed by the next `new` on its own)',
        { lock: toPosix(lock), seconds: Math.round(waitMs / 1000), stale: Math.round(staleMs / 1000) }));
    }
    lockIo.sleep(LOCK_POLL_MS);
  }
}

export function withNumberingLock(root, lang, work, options) {
  const release = takeNumberingLock(root, lang, options);
  try {
    return work();
  } finally {
    release();
  }
}
