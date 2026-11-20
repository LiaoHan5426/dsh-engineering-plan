import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isLockContention, lockFileState, lockHolder, staleLockMessage, cleanTemporaries, renameWithRetry } from './lock-retry.js';
import { readTerminationEvidence } from './termination-evidence.js';

export const MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_RECORD_BYTES = 1024 * 1024;
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'timed_out', 'error', 'unknown']);
const STATES = new Set(['reserved', 'starting', 'running', ...TERMINAL]);
const SNAPSHOT = ['changeId', 'taskId', 'planVersion', 'commandIndex', 'command', 'requestId', 'hostInstanceId', 'ownerSessionId'];
const PATCH = ['expectedRevision', 'state', 'pid', 'exitCode', 'signal', 'stdout', 'stderr', 'error', 'reason', 'truncated', 'startedAt', 'finishedAt', 'timedOut', 'aborted', 'sandbox', 'jobId', 'execution', 'abandoned', 'terminationEvidence'];
const FIELDS = [...SNAPSHOT, ...PATCH.filter(k => k !== 'expectedRevision'), 'schemaVersion', 'runId', 'revision', 'createdAt', 'updatedAt'];
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
function keys(v, allowed) {
  if (!plain(v) || Object.keys(v).some(k => !allowed.includes(k))) fail('INVALID_INPUT', 'Unexpected fields');
}
function text(v, max = 4000) {
  if (typeof v !== 'string' || !v.trim() || v.length > max || v.includes('\0')) fail('INVALID_INPUT', 'Invalid text');
  return v;
}
function id(v) {
  if (typeof v !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(v) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(v)) fail('INVALID_ID', 'Invalid identifier');
  return v;
}
function integer(v, minimum = 0) {
  if (!Number.isSafeInteger(v) || v < minimum) fail('INVALID_INPUT', 'Invalid integer');
}
function snapshot(v) {
  keys(v, SNAPSHOT);
  id(v.changeId); id(v.taskId);
  for (const k of ['requestId', 'hostInstanceId', 'ownerSessionId']) text(v[k]);
  text(v.command, 20000); integer(v.planVersion, 1); integer(v.commandIndex);
  return structuredClone(v);
}
function timestamp(v) {
  if (typeof v !== 'string' || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString() !== v) fail('INVALID_INPUT', 'Invalid timestamp');
}
function hostFields(v) {
  if ('state' in v && !STATES.has(v.state)) fail('INVALID_INPUT', 'Invalid run state');
  if ('pid' in v && v.pid !== null) integer(v.pid, 1);
  if ('exitCode' in v && v.exitCode !== null && !Number.isSafeInteger(v.exitCode)) fail('INVALID_INPUT', 'Invalid exit code');
  if ('signal' in v && v.signal !== null) text(v.signal, 80);
  for (const k of ['error', 'reason']) if (k in v && typeof v[k] !== 'string') fail('INVALID_INPUT', 'Invalid output text');
  for (const k of ['stdout', 'stderr']) if (k in v) {
    if (typeof v[k] === 'string') continue;
    keys(v[k], ['text', 'truncated', 'spillPath']);
    if (typeof v[k].text !== 'string' || typeof v[k].truncated !== 'boolean') fail('INVALID_INPUT', 'Invalid output snapshot');
    if ('spillPath' in v[k]) text(v[k].spillPath);
  }
  for (const k of ['timedOut', 'aborted']) if (k in v && v[k] !== null && typeof v[k] !== 'boolean') fail('INVALID_INPUT', 'Invalid result flag');
  if ('jobId' in v) text(v.jobId);
  // Optional schema-1 extension: old strict readers reject this new field.
  // Persist only the public resolved execution parameters, never the full spec.
  if ('execution' in v) {
    keys(v.execution, ['resolved']);
    const resolved = v.execution.resolved;
    keys(resolved, ['workdir', 'timeoutMs', 'onExpiry', 'stdoutMaxBytes']);
    text(resolved.workdir);
    integer(resolved.timeoutMs); integer(resolved.stdoutMaxBytes);
    if (!['kill', 'none'].includes(resolved.onExpiry)) fail('INVALID_INPUT', 'Invalid execution expiry policy');
  }
  if ('sandbox' in v) {
    keys(v.sandbox, ['mode', 'denied', 'runnerFailed', 'enforcement']);
    if ('mode' in v.sandbox && !['read-only', 'workspace-write', 'danger-full-access'].includes(v.sandbox.mode)) fail('INVALID_INPUT', 'Invalid sandbox mode');
    if ('enforcement' in v.sandbox && !['full', 'partial'].includes(v.sandbox.enforcement)) fail('INVALID_INPUT', 'Invalid sandbox enforcement');
    for (const k of ['denied', 'runnerFailed']) if (k in v.sandbox && typeof v.sandbox[k] !== 'boolean') fail('INVALID_INPUT', 'Invalid sandbox flag');
  }
  if ('truncated' in v && typeof v.truncated !== 'boolean') fail('INVALID_INPUT', 'Invalid truncation flag');
  for (const k of ['startedAt', 'finishedAt']) if (k in v) timestamp(v[k]);
  // Human abandonment attestation: user-only, and only meaningful on a terminal run that never started.
  if ('abandoned' in v) {
    keys(v.abandoned, ['actor', 'reason', 'at']);
    keys(v.abandoned.actor, ['kind', 'id']);
    if (v.abandoned.actor.kind !== 'user') fail('INVALID_INPUT', 'Only a user can abandon a run');
    text(v.abandoned.actor.id, 300);
    text(v.abandoned.reason);
    timestamp(v.abandoned.at);
  }
  if ('terminationEvidence' in v) {
    // Only meaningful together with a cancellation attestation; a stray attestation would otherwise be
    // stored on a run that keeps running, which reads as "terminated" to anyone scanning the record.
    if (v.state !== 'cancelled' || !('abandoned' in v)) fail('INVALID_INPUT', 'Termination evidence requires a cancelled run with an attestation');
    try { readTerminationEvidence(v.terminationEvidence); } catch (error) { fail('INVALID_INPUT', error.message || 'Invalid termination evidence'); }
  }
}
function invalidSuccess(v) { return v.exitCode !== 0 || v.signal || v.error || v.timedOut !== false || v.aborted !== false || v.sandbox?.denied || v.sandbox?.runnerFailed; }
function bounded(v) {
  const bytes = Buffer.from(v);
  // Remove any incomplete UTF-8 suffix, keeping the stored text within the byte cap.
  let end = Math.min(bytes.length, MAX_OUTPUT_BYTES);
  if (end < bytes.length) while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return { value: bytes.subarray(0, end).toString('utf8'), truncated: bytes.length > end };
}
async function directory(target, create = false) {
  const absolute = path.resolve(target), root = path.parse(absolute).root;
  let cursor = root;
  for (const part of absolute.slice(root.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    if (create) await fs.mkdir(cursor).catch(e => { if (e.code !== 'EEXIST') throw e; });
    const st = await fs.lstat(cursor);
    if (!st.isDirectory() || st.isSymbolicLink()) fail('PATH_UNSAFE', 'Linked or non-directory storage ancestor');
  }
}
async function regular(file, missing = false) {
  try {
    const st = await fs.lstat(file);
    if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1) fail('PATH_UNSAFE', 'Storage file must be an unlinked regular file');
    return st;
  } catch (e) { if (missing && e.code === 'ENOENT') return null; throw e; }
}
function same(a, b) { return a.dev === b.dev && a.ino === b.ino; }
async function read(file, changeId, runId) {
  await directory(path.dirname(file));
  const before = await regular(file, true);
  if (!before) fail('NOT_FOUND', 'Verification run not found');
  if (before.size > MAX_RECORD_BYTES) fail('CORRUPT_STATE', 'Run exceeds size limit');
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let value;
  try {
    const opened = await handle.stat();
    if (!same(before, opened) || opened.nlink !== 1 || !opened.isFile()) fail('PATH_UNSAFE', 'Run file changed during read');
    value = await handle.readFile('utf8');
    if (!same(opened, await regular(file))) fail('PATH_UNSAFE', 'Run file replaced during read');
  } finally { await handle.close(); }
  try {
    value = JSON.parse(value); keys(value, FIELDS);
    snapshot(Object.fromEntries(SNAPSHOT.map(k => [k, value[k]])));
    id(value.runId); integer(value.revision, 1); hostFields(value);
    timestamp(value.createdAt); timestamp(value.updatedAt);
    if (value.schemaVersion !== 1 || !STATES.has(value.state) || value.changeId !== changeId || value.runId !== runId || typeof value.truncated !== 'boolean') throw new Error('Invalid run');
    for (const k of ['stdout', 'stderr', 'error', 'reason']) if (k in value && Buffer.byteLength(typeof value[k] === 'string' ? value[k] : value[k].text) > MAX_OUTPUT_BYTES) throw new Error('Oversize output');
    if (value.state === 'succeeded' && invalidSuccess(value)) throw new Error('Invalid success');
    return value;
  } catch { fail('CORRUPT_STATE', 'Invalid verification run record'); }
}
async function atomic(file, value) {
  const content = JSON.stringify(value, null, 2) + '\n';
  if (Buffer.byteLength(content) > MAX_RECORD_BYTES) fail('STATE_TOO_LARGE', 'Run exceeds size limit');
  await directory(path.dirname(file)); await regular(file, true);
  await cleanTemporaries(path.dirname(file));
  const temporary = `${file}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(content); await handle.sync(); await handle.close(); handle = null;
    await directory(path.dirname(file)); await regular(file, true); await regular(temporary);
    await renameWithRetry(temporary, file);
  } finally {
    if (handle) await handle.close();
    await fs.unlink(temporary).catch(e => { if (e.code !== 'ENOENT') throw e; });
  }
}
async function locked(dir, fn) {
  await directory(dir, true);
  const lock = path.join(dir, '.lock'), start = Date.now();
  let handle, identity;
  while (!handle) {
    await directory(dir);
    try { handle = await fs.open(lock, 'wx', 0o600); identity = await handle.stat(); }
    catch (e) {
      if (!isLockContention(e)) throw e;
      // A competing writer can release the lock between open and lstat.
      if (!await lockFileState(lock)) continue;
      if (Date.now() - start >= 3000) fail('LOCK_BUSY', staleLockMessage('Verification store', await lockHolder(lock)));
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
    return await fn();
  } finally {
    await handle.close(); await directory(dir);
    const current = await lockFileState(lock);
    if (!current || !same(identity, current)) fail('PATH_UNSAFE', 'Lock replaced during operation');
    await fs.unlink(lock);
  }
}

/** Host-only record storage. Never executes commands or changes plan evidence. */
export class VerificationRunStore {
  #root;
  constructor(root) { this.#root = path.resolve(text(root)); }
  get workspaceRoot() { return this.#root; }
  #directory(changeId) { return path.join(this.#root, '.dsh', 'engineering', 'changes', id(changeId), 'runs'); }
  #file(changeId, runId) { return path.join(this.#directory(changeId), `${id(runId)}.json`); }
  async #list(changeId, dir) {
    const runs = [];
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (!entry.name.endsWith('.json')) continue;
      const runId = id(entry.name.slice(0, -5));
      runs.push(await read(this.#file(changeId, runId), changeId, runId));
    }
    return runs.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.runId.localeCompare(b.runId));
  }
  async reserve(input) {
    const s = snapshot(input), dir = this.#directory(s.changeId);
    return locked(dir, async () => {
      const existing = (await this.#list(s.changeId, dir)).find(r => r.requestId === s.requestId);
      if (existing) {
        for (const key of ['taskId', 'planVersion', 'command', 'commandIndex', 'ownerSessionId']) if (existing[key] !== s[key]) fail('REQUEST_CONFLICT', 'Request id already has a different snapshot');
        return existing;
      }
      const now = new Date().toISOString();
      const run = { ...s, schemaVersion: 1, runId: randomUUID(), revision: 1, state: 'reserved', createdAt: now, updatedAt: now, stdout: { text: '', truncated: false }, stderr: { text: '', truncated: false }, truncated: false };
      await atomic(this.#file(s.changeId, run.runId), run);
      return run;
    });
  }
  async get(changeId, runId) { return read(this.#file(changeId, runId), changeId, runId); }
  async list(changeId) {
    const dir = this.#directory(changeId);
    try { await directory(dir); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
    return locked(dir, () => this.#list(changeId, dir));
  }
  async update(changeId, runId, hostInstanceId, input) {
    const file = this.#file(changeId, runId); text(hostInstanceId); keys(input, PATCH);
    const patch = structuredClone(input); hostFields(patch);
    if (!Number.isSafeInteger(patch.expectedRevision) || patch.expectedRevision < 1) fail('REVISION_REQUIRED', 'expectedRevision is required');
    return locked(this.#directory(changeId), async () => {
      const run = await read(file, changeId, runId);
      if (run.hostInstanceId !== hostInstanceId) fail('HOST_INSTANCE_CONFLICT', 'Run belongs to a different Host instance');
      if (patch.expectedRevision !== run.revision) fail('REVISION_CONFLICT', 'Verification run revision changed');
      if (TERMINAL.has(run.state)) fail('INVALID_TRANSITION', 'Terminal runs are immutable');
      if ('state' in patch && patch.state !== run.state) {
        const allowed = run.state === 'reserved' ? ['starting'] : run.state === 'starting' ? ['running', ...TERMINAL] : [...TERMINAL];
        // Sole terminal escape from a reservation, added for explicit human abandonment of a stranded run.
        // Why this transition is safe: the record has no jobId, and a jobId is only ever persisted together with
        // the start transition (see the 'execution'/jobId rules below), so a missing jobId is the persisted proof
        // that no process was ever launched. That means no live process, pid, output or exit result can be orphaned;
        // this branch still requires the same host-instance CAS, revision CAS and atomic rename as every other update.
        if (run.state === 'reserved' && patch.state === 'cancelled' && !run.jobId && 'abandoned' in patch) allowed.push('cancelled');
        // Second terminal escape, for a run that did start but whose job handle is gone (see terminateRun in core):
        // the Host has already established that this process cannot reach the job, and the caller supplies a human
        // termination attestation. The record keeps jobId and gains that attestation, so the release is auditable
        // rather than silently dropping a live-looking record.
        // A cancellation that carries a human attestation must also carry the attestation's substance:
        // otherwise an operator statement of "abandoned" would silently stand in for termination evidence.
        // Runner-settled cancellations never carry `abandoned`, so they are unaffected.
        if (['starting', 'running'].includes(run.state) && patch.state === 'cancelled'
          && 'abandoned' in patch && !('terminationEvidence' in patch)) {
          fail('INVALID_TRANSITION', 'Cancelling a started run with an attestation requires termination evidence');
        }
        if (['starting', 'running'].includes(run.state) && patch.state === 'cancelled'
          && run.jobId && 'abandoned' in patch && 'terminationEvidence' in patch) allowed.push('cancelled');
        if (!allowed.includes(patch.state)) fail('INVALID_TRANSITION', 'Invalid verification run transition');
      }
      if ('execution' in patch) {
        if ('execution' in run) fail('IMMUTABLE_EXECUTION', 'Execution metadata is write-once');
        if (run.state !== 'reserved' || patch.state !== 'starting' || !('jobId' in patch))
          fail('INVALID_TRANSITION', 'Execution metadata requires starting job linkage');
      }
      delete patch.expectedRevision;
      for (const key of ['stdout', 'stderr', 'error', 'reason']) if (key in patch) {
        const output = patch[key], result = bounded(typeof output === 'string' ? output : output.text);
        if (['stdout', 'stderr'].includes(key)) {
          const oldTruncated = typeof run[key] === 'object' && run[key].truncated;
          patch[key] = { ...(typeof output === 'object' ? output : {}), text: result.value, truncated: Boolean(oldTruncated || output.truncated || result.truncated) };
          if (patch[key].truncated) patch.truncated = true;
        } else patch[key] = result.value;
        if (result.truncated) patch.truncated = true;
      }
      const next = { ...run, ...patch, truncated: run.truncated || patch.truncated || false, revision: run.revision + 1, updatedAt: new Date().toISOString() };
      if (next.state === 'succeeded' && invalidSuccess(next)) fail('INVALID_RESULT', 'Success requires explicit exit code zero without signal or error');
      if (next.state === 'starting') next.startedAt ??= next.updatedAt;
      if (TERMINAL.has(next.state)) next.finishedAt ??= next.updatedAt;
      await atomic(file, next); return next;
    });
  }
  async recover(changeId, currentHostInstanceId) {
    text(currentHostInstanceId); const dir = this.#directory(changeId);
    try { await directory(dir); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
    return locked(dir, async () => {
      const recovered = [];
      for (const run of await this.#list(changeId, dir)) {
        if (run.hostInstanceId === currentHostInstanceId || TERMINAL.has(run.state)) continue;
        const now = new Date().toISOString();
        const next = { ...run, state: 'unknown', reason: 'Previous Host instance ended before a terminal result was persisted', revision: run.revision + 1, updatedAt: now, finishedAt: now };
        await atomic(this.#file(changeId, run.runId), next); recovered.push(next);
      }
      return recovered;
    });
  }
}
