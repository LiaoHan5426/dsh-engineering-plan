import * as fs from 'node:fs/promises';

/**
 * Lock contention on Windows does not always surface as EEXIST:
 * `open(…, 'wx')` against a lock file that another caller is creating or
 * deleting can fail with EPERM/EACCES/EBUSY. Treat those as "someone else
 * holds it" and retry under the same deadline instead of aborting the call.
 */
export const CONTENTION_CODES = ['EEXIST', 'EPERM', 'EACCES', 'EBUSY'];

export function isLockContention(error) {
  return !!error && CONTENTION_CODES.includes(error.code);
}

/**
 * Inspect an ephemeral lock file. Returns null when it vanished or is already
 * logically gone; a symlink, a directory or a hardlinked inode stays a hard
 * failure because no lock this plugin creates ever looks like that.
 *
 * A lock that another process is finishing with on Windows can still be listed
 * for a moment: `lstat` then reports a zero link count, which means the entry
 * is already detached from every name. Treating it as free is what lets the
 * next waiter take the lock instead of failing the whole call, while a
 * pre-created hardlink (nlink > 1) is still refused before anything is written.
 */
export async function lockFileState(file) {
  try {
    const stat = await fs.lstat(file);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw Object.assign(new Error('Lock must be a plain file'), { code: 'PATH_UNSAFE' });
    }
    if (stat.nlink > 1) {
      throw Object.assign(new Error('Lock must not be hardlinked'), { code: 'PATH_UNSAFE' });
    }
    return stat.nlink === 1 ? stat : null;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * A lock is released in a finally block, so it survives only when its holder
 * died inside the critical section. We never remove it automatically: the file
 * records a pid, and pids are reused, so "that pid is not running" is weaker
 * evidence than it looks. What we can do is report who claims the lock and what
 * is known about that process, and let a human decide.
 */
export async function lockHolder(file) {
  let text = null;
  let stat = null;
  try { text = await fs.readFile(file, 'utf8'); stat = await fs.stat(file); }
  catch (error) { if (error.code !== 'ENOENT') throw error; return null; }
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = null; }
  const pid = Number.isSafeInteger(parsed?.pid) ? parsed.pid : null;
  const createdAt = typeof parsed?.createdAt === 'string' ? parsed.createdAt
    : stat ? new Date(stat.mtimeMs).toISOString() : null;
  let alive = null;
  if (pid !== null) {
    try { process.kill(pid, 0); alive = true; }
    catch (error) { alive = error.code === 'EPERM'; }
  }
  return { pid, createdAt, alive, unreadable: parsed === null };
}

/**
 * Create the lock and put its holder metadata inside in one step.
 *
 * `open(…, 'wx')` and the following write are two separate round trips to libuv, so a
 * process killed between them leaves an empty lock file: the lock is still held, but
 * there is no pid to report. Doing the stat last keeps the JS side out of that window,
 * which shrinks it to the two I/O requests themselves.
 */
export async function createLockFile(lock, payload) {
  const handle = await fs.open(lock, 'wx', 0o600);
  try {
    await handle.writeFile(JSON.stringify(payload));
    return { handle, identity: await handle.stat() };
  } catch (error) {
    await handle.close().catch(() => {});
    await fs.unlink(lock).catch(() => {});
    throw error;
  }
}

export function staleLockMessage(subject, holder) {
  if (!holder) return `${subject} is locked by a lock file that vanished while being read; inspect it before removing`;
  // A writer killed between open() and its metadata write leaves an empty lock: no pid, but the
  // file's timestamp still says when the critical section started.
  if (holder.unreadable) return `${subject} is locked; the lock file names no holder${holder.createdAt ? ` (last modified ${holder.createdAt})` : ''}. Remove .lock only after confirming the holder is gone`;
  const since = holder.createdAt ? ` since ${holder.createdAt}` : '';
  const state = holder.alive === true ? 'that process still appears to be running'
    : holder.alive === false ? 'that process is no longer running, so the lock is probably stale'
      : 'liveness could not be checked';
  return `${subject} is locked by pid ${holder.pid ?? 'unknown'}${since}; ${state}. Remove .lock only after confirming the holder is gone`;
}

/**
 * A process killed between writing a temp file and renaming it cannot run its
 * own cleanup, so those files would accumulate forever. Every reader ignores
 * them, so this is housekeeping, not correctness. The threshold keeps a
 * concurrent writer's live temp file (alive for milliseconds) out of reach.
 */
export const TEMPORARY_TTL_MS = 10 * 60 * 1000;

export async function cleanTemporaries(directory, ttlMs = TEMPORARY_TTL_MS) {
  let names = [];
  try { names = await fs.readdir(directory); } catch { return []; }
  const removed = [];
  for (const name of names) {
    if (!name.endsWith('.tmp')) continue;
    const target = directory.endsWith('/') || directory.endsWith('\\') ? `${directory}${name}` : `${directory}/${name}`;
    try {
      const stat = await fs.lstat(target);
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      if (Date.now() - stat.mtimeMs < ttlMs) continue;
      await fs.unlink(target);
      removed.push(name);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return removed;
}

/**
 * On Windows a rename onto an existing file fails with EPERM/EACCES/EBUSY while
 * another process holds it open — an editor, an indexer, or a test that reads it
 * right after a write (measured: the invariants stream hit this on
 * `progress.md.tmp -> progress.md`). The write itself is sound, so retrying a few
 * times with a growing delay is the honest fix; after that the caller sees the
 * original error code rather than a made-up one.
 */
export const RENAME_RETRY_CODES = ['EPERM', 'EACCES', 'EBUSY'];

export async function renameWithRetry(from, to, options = {}) {
  const { attempts = 6, delayMs = 15, rename = fs.rename } = options;
  for (let attempt = 1; ; attempt += 1) {
    try { await rename(from, to); return attempt; }
    catch (error) {
      if (!RENAME_RETRY_CODES.includes(error.code) || attempt >= attempts) throw error;
      await new Promise(resolve => setTimeout(resolve, delayMs * attempt));
    }
  }
}
