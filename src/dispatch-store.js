import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { isLockContention, lockFileState, lockHolder, staleLockMessage, cleanTemporaries, renameWithRetry } from './lock-retry.js';

export const MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_RECORD_BYTES = 1024 * 1024;
const TERMINAL = new Set(['returned', 'failed', 'cancelled', 'error', 'unknown']);
const STATES = new Set(['reserved', 'starting', 'running', ...TERMINAL]);
const SNAPSHOT = ['changeId', 'taskId', 'planVersion', 'admittedRevision', 'requestId', 'taskSnapshot', 'taskSnapshotHash', 'hostInstanceId', 'ownerSessionId', 'childId'];
const TASK = ['id', 'title', 'description', 'dependencies', 'expectedFiles', 'acceptanceCriteria', 'verificationCommands'];
const RESULT = ['text', 'stopReason', 'diagnostic'];
const PATCH = ['expectedRevision', 'state', 'result', 'error', 'reason', 'truncated', 'startedAt', 'finishedAt', 'jobId', 'abandoned'];
const FIELDS = [...SNAPSHOT, ...PATCH.filter(k => k !== 'expectedRevision'), 'schemaVersion', 'runId', 'revision', 'createdAt', 'updatedAt'];
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
function keys(v, allowed, required = []) {
  if (!plain(v) || Reflect.ownKeys(v).some(k => !allowed.includes(k)
    || !Object.hasOwn(Object.getOwnPropertyDescriptor(v, k), 'value')
    || !Object.getOwnPropertyDescriptor(v, k).enumerable)
    || required.some(k => !Object.hasOwn(v, k))) fail('INVALID_INPUT', 'Unexpected or missing fields');
}
function text(v, max = 4000) {
  if (typeof v !== 'string' || !v.trim() || v.length > max || v.includes('\0')) fail('INVALID_INPUT', 'Invalid text');
  return v;
}
function id(v) {
  if (typeof v !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(v) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(v)) fail('INVALID_ID', 'Invalid identifier');
  return v;
}
function integer(v, minimum = 1) {
  if (!Number.isSafeInteger(v) || v < minimum) fail('INVALID_INPUT', 'Invalid integer');
}
function freeze(v) {
  if (v && typeof v === 'object') { for (const item of Object.values(v)) freeze(item); Object.freeze(v); }
  return v;
}
function taskSnapshot(v, taskId) {
  keys(v, TASK, TASK); id(v.id);
  if (v.id !== taskId) fail('INVALID_INPUT', 'Task snapshot identity mismatch');
  text(v.title, MAX_RECORD_BYTES);
  if (typeof v.description !== 'string' || v.description.includes('\0')) fail('INVALID_INPUT', 'Invalid description');
  const result = { id: v.id, title: v.title, description: v.description };
  for (const key of TASK.slice(3)) {
    const list = v[key];
    if (!Array.isArray(list) || Object.getPrototypeOf(list) !== Array.prototype
      || Reflect.ownKeys(list).length !== list.length + 1) fail('INVALID_INPUT', 'Invalid task list');
    const copy = [];
    for (let i = 0; i < list.length; i++) {
      const desc = Object.getOwnPropertyDescriptor(list, String(i));
      if (!desc || !Object.hasOwn(desc, 'value')) fail('INVALID_INPUT', 'Invalid task list entry');
      copy.push(text(desc.value, MAX_RECORD_BYTES));
    }
    result[key] = copy;
  }
  return result;
}
function snapshot(v) {
  keys(v, SNAPSHOT, SNAPSHOT);
  id(v.changeId); id(v.taskId); id(v.requestId);
  for (const k of ['hostInstanceId', 'ownerSessionId', 'childId']) text(v[k]);
  integer(v.planVersion); integer(v.admittedRevision);
  const task = taskSnapshot(v.taskSnapshot, v.taskId);
  const hash = createHash('sha256').update(JSON.stringify(task), 'utf8').digest('hex');
  if (v.taskSnapshotHash !== hash) fail('SNAPSHOT_HASH_MISMATCH', 'Task snapshot hash mismatch');
  return freeze({ ...v, taskSnapshot: task });
}
function timestamp(v) {
  if (typeof v !== 'string' || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString() !== v) fail('INVALID_INPUT', 'Invalid timestamp');
}
function hostFields(v) {
  if ('jobId' in v) text(v.jobId);
  if ('state' in v && !STATES.has(v.state)) fail('INVALID_INPUT', 'Invalid dispatch state');
  if ('result' in v && v.result !== null) {
    keys(v.result, RESULT);
    for (const key of Object.keys(v.result)) if (v.result[key] !== null && typeof v.result[key] !== 'string') fail('INVALID_INPUT', 'Invalid result text');
  }
  for (const key of ['error', 'reason']) if (key in v && v[key] !== null && typeof v[key] !== 'string') fail('INVALID_INPUT', 'Invalid output text');
  if ('truncated' in v && typeof v.truncated !== 'boolean') fail('INVALID_INPUT', 'Invalid truncation flag');
  for (const key of ['startedAt', 'finishedAt']) if (key in v) timestamp(v[key]);
  // Human abandonment attestation: user-only, and only meaningful on a terminal run that never started.
  if ('abandoned' in v) {
    keys(v.abandoned, ['actor', 'reason', 'at']);
    keys(v.abandoned.actor, ['kind', 'id']);
    if (v.abandoned.actor.kind !== 'user') fail('INVALID_INPUT', 'Only a user can abandon a run');
    text(v.abandoned.actor.id, 300);
    text(v.abandoned.reason);
    timestamp(v.abandoned.at);
  }
}
function bounded(v) {
  const bytes = Buffer.from(v);
  let end = Math.min(bytes.length, MAX_OUTPUT_BYTES);
  if (end < bytes.length) while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return { value: bytes.subarray(0, end).toString('utf8'), truncated: bytes.length > end };
}
// Same directory, link, exclusive-lock and atomic-rename strategy as verification-store.
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
const same = (a, b) => a.dev === b.dev && a.ino === b.ino;
async function read(file, changeId, runId) {
  try { await directory(path.dirname(file)); } catch (e) { if (e.code === 'ENOENT') fail('NOT_FOUND', 'Dispatch run not found'); throw e; }
  const before = await regular(file, true);
  if (!before) fail('NOT_FOUND', 'Dispatch run not found');
  if (before.size > MAX_RECORD_BYTES) fail('CORRUPT_STATE', 'Run exceeds size limit');
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let content;
  try {
    const opened = await handle.stat();
    if (!same(before, opened) || opened.nlink !== 1 || !opened.isFile()) fail('PATH_UNSAFE', 'Run file changed during read');
    // Bounded read even if another process grows the file after lstat.
    const buffer = Buffer.alloc(MAX_RECORD_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > MAX_RECORD_BYTES) fail('CORRUPT_STATE', 'Run exceeds size limit');
    content = buffer.subarray(0, length).toString('utf8');
    if (!same(opened, await regular(file))) fail('PATH_UNSAFE', 'Run file replaced during read');
  } finally { await handle.close(); }
  try {
    const value = JSON.parse(content);
    keys(value, FIELDS, [...SNAPSHOT, 'schemaVersion', 'runId', 'revision', 'state', 'createdAt', 'updatedAt', 'result', 'truncated']);
    snapshot(Object.fromEntries(SNAPSHOT.map(k => [k, value[k]])));
    id(value.runId); integer(value.revision); hostFields(value);
    timestamp(value.createdAt); timestamp(value.updatedAt);
    if (value.schemaVersion !== 1 || !STATES.has(value.state) || value.changeId !== changeId || value.runId !== runId) throw new Error('Invalid run');
    for (const output of [value.error, value.reason, ...Object.values(value.result ?? {})]) {
      if (typeof output === 'string' && Buffer.byteLength(output) > MAX_OUTPUT_BYTES) throw new Error('Oversize output');
    }
    return freeze(value);
  } catch { fail('CORRUPT_STATE', 'Invalid dispatch run record'); }
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
      if (!await lockFileState(lock)) continue;
      if (Date.now() - start >= 3000) fail('LOCK_BUSY', staleLockMessage('Dispatch store', await lockHolder(lock)));
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

/** Host-only records. returned means native Agent return, never task success or evidence. */
export class DispatchRunStore {
  #root;
  constructor(root) { this.#root = path.resolve(text(root)); }
  get workspaceRoot() { return this.#root; }
  #directory(changeId) { return path.join(this.#root, '.dsh', 'engineering', 'changes', id(changeId), 'dispatches'); }
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
        for (const key of ['taskId', 'planVersion', 'taskSnapshotHash', 'ownerSessionId']) if (existing[key] !== s[key]) fail('REQUEST_CONFLICT', 'Request id already has a different snapshot');
        if (JSON.stringify(taskSnapshot(existing.taskSnapshot, existing.taskId)) !== JSON.stringify(s.taskSnapshot)) fail('REQUEST_CONFLICT', 'Request id already has a different task');
        return { run: existing, created: false };
      }
      const now = new Date().toISOString();
      const run = freeze({ ...s, schemaVersion: 1, runId: randomUUID(), revision: 1, state: 'reserved', createdAt: now, updatedAt: now, result: null, truncated: false });
      await atomic(this.#file(s.changeId, run.runId), run);
      return { run, created: true };
    });
  }
  async get(changeId, runId) { return read(this.#file(changeId, runId), changeId, runId); }
  async list(changeId) {
    const dir = this.#directory(changeId);
    try { await directory(dir); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
    return locked(dir, () => this.#list(changeId, dir));
  }
  async update(changeId, runId, hostInstanceId, input) {
    const file = this.#file(changeId, runId); text(hostInstanceId); keys(input, PATCH); hostFields(input);
    const patch = structuredClone(input);
    if (!Number.isSafeInteger(patch.expectedRevision) || patch.expectedRevision < 1) fail('REVISION_REQUIRED', 'expectedRevision is required');
    return locked(this.#directory(changeId), async () => {
      const run = await read(file, changeId, runId);
      if (run.hostInstanceId !== hostInstanceId) fail('HOST_INSTANCE_CONFLICT', 'Run belongs to a different Host instance');
      if (patch.expectedRevision !== run.revision) fail('REVISION_CONFLICT', 'Dispatch run revision changed');
      if (TERMINAL.has(run.state)) fail('INVALID_TRANSITION', 'Terminal runs are immutable');
      if ('state' in patch && patch.state !== run.state) {
        const allowed = run.state === 'reserved' ? ['starting'] : run.state === 'starting' ? ['running', ...TERMINAL] : [...TERMINAL];
        // Sole terminal escape from a reservation, added for explicit human abandonment of a stranded run.
        // Why this transition is safe: the record has no jobId, and the dispatch runner only persists jobId while
        // moving reserved -> starting, so a missing jobId is the persisted proof that no child agent and no process
        // was ever launched. Nothing can be orphaned, and this branch keeps the same host-instance CAS, revision CAS
        // and atomic rename as every other update.
        if (run.state === 'reserved' && patch.state === 'cancelled' && !run.jobId && 'abandoned' in patch) allowed.push('cancelled');
        if (!allowed.includes(patch.state)) fail('INVALID_TRANSITION', 'Invalid dispatch run transition');
      }
      delete patch.expectedRevision;
      const cap = (object, key) => {
        if (typeof object[key] !== 'string') return;
        const output = bounded(object[key]); object[key] = output.value;
        if (output.truncated) patch.truncated = true;
      };
      for (const key of ['error', 'reason']) cap(patch, key);
      if (patch.result) for (const key of RESULT) cap(patch.result, key);
      const next = { ...run, ...patch, truncated: run.truncated || patch.truncated || false, revision: run.revision + 1, updatedAt: new Date().toISOString() };
      if (next.state === 'starting') next.startedAt ??= next.updatedAt;
      if (TERMINAL.has(next.state)) next.finishedAt ??= next.updatedAt;
      await atomic(file, next);
      return freeze(next);
    });
  }
}
