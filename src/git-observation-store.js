import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateGitObservation } from './git-comparison.js';
import { isLockContention, lockFileState, lockHolder, staleLockMessage, cleanTemporaries, renameWithRetry } from './lock-retry.js';

const MAX_RECORD_BYTES = 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELDS = ['schemaVersion', 'requestId', 'ownerSessionId', 'observation'];
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
function uuid(value) {
  if (typeof value !== 'string' || !UUID.test(value)) fail('INVALID_ID', 'Expected UUID');
  return value.toLowerCase();
}
function requestId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value)
    || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(value)) fail('INVALID_ID', 'Invalid request identifier');
  return value;
}
function text(value) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) fail('INVALID_INPUT', 'Expected nonempty text');
  return value;
}
function keys(value, fields, optional = []) {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('INVALID_INPUT', 'Expected plain object');
  const descriptors = Object.getOwnPropertyDescriptors(value), own = Reflect.ownKeys(descriptors);
  if (fields.some(key => !Object.hasOwn(descriptors, key)) || own.some(key => ![...fields, ...optional].includes(key)
    || !Object.hasOwn(descriptors[key], 'value') || !descriptors[key].enumerable)) fail('INVALID_INPUT', 'Unexpected or missing fields');
}
function request(value) {
  // Inspect descriptors before reading action, including malformed accessor inputs.
  keys(value, ['action'], ['baselineId']);
  if (value.action === 'capture') { keys(value, ['action']); return { action: 'capture' }; }
  if (value.action === 'compare') {
    keys(value, ['action', 'baselineId']); uuid(value.baselineId);
    return { action: 'compare', baselineId: value.baselineId };
  }
  fail('INVALID_INPUT', 'Invalid observation request action');
}
function freeze(value) {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
function envelope(value, changeId, id) {
  keys(value, FIELDS, ['request']);
  if (value.schemaVersion !== 1) fail('INVALID_INPUT', 'Unsupported observation envelope');
  requestId(value.requestId); text(value.ownerSessionId);
  const observation = validateGitObservation(value.observation);
  if (uuid(observation.changeId) !== uuid(changeId) || uuid(observation.id) !== uuid(id)) fail('INVALID_INPUT', 'Observation identity mismatch');
  return freeze({ schemaVersion: 1, requestId: value.requestId, ownerSessionId: value.ownerSessionId, observation,
    ...(Object.hasOwn(value, 'request') ? { request: request(value.request) } : {}) });
}
// Match dispatch-store: inspect every ancestor, reject links and use a per-change exclusive lock.
async function directory(target, create = false) {
  const absolute = path.resolve(target), root = path.parse(absolute).root;
  let cursor = root;
  for (const part of absolute.slice(root.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    if (create) await fs.mkdir(cursor).catch(error => { if (error.code !== 'EEXIST') throw error; });
    const stat = await fs.lstat(cursor);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('PATH_UNSAFE', 'Linked or non-directory storage ancestor');
  }
}
async function regular(file, missing = false) {
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) fail('PATH_UNSAFE', 'Storage file must be an unlinked regular file');
    return stat;
  } catch (error) { if (missing && error.code === 'ENOENT') return null; throw error; }
}
const same = (a, b) => a.dev === b.dev && a.ino === b.ino;
async function read(file, changeId, id) {
  try { await directory(path.dirname(file)); } catch (error) { if (error.code === 'ENOENT') fail('NOT_FOUND', 'Git observation not found'); throw error; }
  const before = await regular(file, true);
  if (!before) fail('NOT_FOUND', 'Git observation not found');
  if (before.size > MAX_RECORD_BYTES) fail('CORRUPT_STATE', 'Observation exceeds size limit');
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let content;
  try {
    const opened = await handle.stat();
    if (!same(before, opened) || !opened.isFile() || opened.nlink !== 1) fail('PATH_UNSAFE', 'Observation file changed during read');
    const buffer = Buffer.alloc(MAX_RECORD_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > MAX_RECORD_BYTES) fail('CORRUPT_STATE', 'Observation exceeds size limit');
    // Fatal decoding avoids silently replacing malformed UTF-8 in recorded facts.
    try { content = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length)); }
    catch { fail('CORRUPT_STATE', 'Invalid observation encoding'); }
    await directory(path.dirname(file));
    if (!same(opened, await regular(file))) fail('PATH_UNSAFE', 'Observation file replaced during read');
  } finally { await handle.close(); }
  try { return envelope(JSON.parse(content), changeId, id); }
  catch { fail('CORRUPT_STATE', 'Invalid git observation record'); }
}
async function atomic(file, value) {
  const content = JSON.stringify(value, null, 2) + '\n';
  if (Buffer.byteLength(content) > MAX_RECORD_BYTES) fail('STATE_TOO_LARGE', 'Observation exceeds size limit');
  await directory(path.dirname(file));
  if (await regular(file, true)) fail('OBSERVATION_CONFLICT', 'Observation id already exists');
  await cleanTemporaries(path.dirname(file));
  const temporary = `${file}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(content); await handle.sync(); await handle.close(); handle = null;
    await directory(path.dirname(file)); await regular(temporary);
    if (await regular(file, true)) fail('OBSERVATION_CONFLICT', 'Observation id already exists');
    await renameWithRetry(temporary, file);
  } finally {
    if (handle) await handle.close();
    await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
async function locked(dir, fn) {
  await directory(dir, true);
  const lock = path.join(dir, '.lock'), start = Date.now();
  let handle, identity;
  while (!handle) {
    await directory(dir);
    try { handle = await fs.open(lock, 'wx', 0o600); identity = await handle.stat(); }
    catch (error) {
      if (!isLockContention(error)) throw error;
      if (!await lockFileState(lock)) continue;
      if (Date.now() - start >= 3000) fail('LOCK_BUSY', staleLockMessage('Git observation store', await lockHolder(lock)));
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

/** Immutable facts only. create returns a record; get/list/findRequest return frozen envelopes.
 * UUID paths are canonical lowercase, including on case-sensitive filesystems.
 * Metadata is structurally validated, not a signature authenticating arbitrary disk edits.
 */
export class GitObservationStore {
  #root;
  constructor(root) { this.#root = path.resolve(text(root)); }
  get workspaceRoot() { return this.#root; }
  #directory(changeId) { return path.join(this.#root, '.dsh', 'engineering', 'changes', uuid(changeId), 'git-observations'); }
  #file(changeId, id) { return path.join(this.#directory(changeId), `${uuid(id)}.json`); }
  async #list(changeId, dir) {
    const values = [], requests = new Set();
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (!entry.name.endsWith('.json')) continue;
      const id = entry.name.slice(0, -5);
      if (!UUID.test(id) || id !== id.toLowerCase()) fail('CORRUPT_STATE', 'Invalid observation filename');
      const value = await read(this.#file(changeId, id), changeId, id);
      if (requests.has(value.requestId)) fail('CORRUPT_STATE', 'Duplicate observation request id');
      requests.add(value.requestId); values.push(value);
    }
    return values.sort((a, b) => a.observation.capturedAt.localeCompare(b.observation.capturedAt)
      || a.observation.id.localeCompare(b.observation.id));
  }
  async create(changeId, record, options) {
    uuid(changeId); keys(options, ['requestId', 'ownerSessionId'], ['request']);
    requestId(options.requestId); text(options.ownerSessionId);
    const observation = validateGitObservation(record);
    if (observation.changeId !== changeId) fail('INVALID_INPUT', 'Observation changeId mismatch');
    const value = envelope({ schemaVersion: 1, requestId: options.requestId, ownerSessionId: options.ownerSessionId, observation,
      ...(Object.hasOwn(options, 'request') ? { request: options.request } : {}) }, changeId, observation.id);
    const dir = this.#directory(changeId);
    return locked(dir, async () => {
      const existing = (await this.#list(changeId, dir)).find(item => item.requestId === value.requestId);
      if (existing) {
        if (existing.ownerSessionId !== value.ownerSessionId
          || JSON.stringify(existing.request) !== JSON.stringify(value.request)
          || ['changeId', 'planVersion', 'sourceRevision'].some(key => existing.observation[key] !== observation[key])) fail('REQUEST_CONFLICT', 'Request id already has different ownership, revision or intent');
        return { observation: existing.observation, created: false };
      }
      await atomic(this.#file(changeId, observation.id), value);
      return { observation: value.observation, created: true };
    });
  }
  async get(changeId, id) { return read(this.#file(changeId, id), changeId, id); }
  async list(changeId) {
    const dir = this.#directory(changeId);
    try { await directory(dir); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    return locked(dir, () => this.#list(changeId, dir));
  }
  async findRequest(changeId, id) {
    requestId(id);
    return (await this.list(changeId)).find(value => value.requestId === id) ?? null;
  }
}
