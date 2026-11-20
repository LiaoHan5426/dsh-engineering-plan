import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { DispatchRunStore, MAX_OUTPUT_BYTES } from '../src/dispatch-store.js';
import { resolveDispatchRequest } from '../src/dispatch-request.js';

const hash = task => createHash('sha256').update(JSON.stringify(task)).digest('hex');
function snap(extra = {}, taskExtra = {}) {
  const taskSnapshot = { id: 'task-a', title: 'Fixture task', description: '', dependencies: [], expectedFiles: ['fixture.js'], acceptanceCriteria: ['Reviewed'], verificationCommands: ['node --test'], ...taskExtra };
  return { changeId: 'change-a', taskId: taskSnapshot.id, planVersion: 1, admittedRevision: 2, requestId: 'request-a', taskSnapshot, taskSnapshotHash: hash(taskSnapshot), hostInstanceId: 'host-a', ownerSessionId: 'session-a', childId: 'child-a', ...extra };
}
const rejects = (promise, code) => assert.rejects(promise, e => e.code === code);
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dispatch-store-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new DispatchRunStore(root);
  const dir = path.join(root, '.dsh', 'engineering', 'changes', 'change-a', 'dispatches');
  return { root, store, dir, file: r => path.join(dir, `${r.runId}.json`) };
}
const update = (store, run, patch) => store.update(run.changeId, run.runId, run.hostInstanceId, { expectedRevision: run.revision, ...patch });

test('accepts resolver snapshot, stores UUID record and freezes detached task data', async t => {
  const f = await fixture(t), task = { ...snap().taskSnapshot, status: 'pending' };
  const request = resolveDispatchRequest({ id: 'change-a', planVersion: 1, revision: 2, approvals: [{ planVersion: 1, actor: { kind: 'user' } }], tasks: [task] }, { changeId: 'change-a', taskId: 'task-a', planVersion: 1, expectedRevision: 2, requestId: 'request-a' });
  const input = { ...request, hostInstanceId: 'host-a', ownerSessionId: 'session-a', childId: 'child-a' };
  const pending = f.store.reserve(input);
  input.taskSnapshot.title = 'mutated'; input.taskSnapshot.expectedFiles.push('another');
  const { run, created } = await pending;
  assert.equal(created, true); assert.equal(run.state, 'reserved'); assert.equal(run.revision, 1);
  assert.match(run.runId, /^[0-9a-f-]{36}$/);
  assert.equal(run.taskSnapshot.title, 'Fixture task'); assert.deepEqual(run.taskSnapshot.expectedFiles, ['fixture.js']);
  assert.throws(() => run.taskSnapshot.expectedFiles.push('tampered'), TypeError);
  assert.throws(() => { run.taskSnapshot.title = 'tampered'; }, TypeError);
  assert.deepEqual(JSON.parse(await fs.readFile(f.file(run), 'utf8')), run);
  assert.deepEqual(await new DispatchRunStore(f.root).get('change-a', run.runId), run);
});

test('literal backslash-zero task commands round-trip unchanged', async t => {
  const f = await fixture(t), command = "printf '" + String.fromCharCode(92) + "0'";
  const { run } = await f.store.reserve(snap({}, { verificationCommands: [command] }));
  assert.equal(run.taskSnapshot.verificationCommands[0], command);
  assert.equal((await f.store.get('change-a', run.runId)).taskSnapshot.verificationCommands[0], command);
});

test('same-change request replay ignores host, child and admission revision only', async t => {
  const f = await fixture(t), first = await f.store.reserve(snap());
  const replay = await f.store.reserve(snap({ hostInstanceId: 'new', childId: 'new', admittedRevision: 99 }));
  assert.equal(replay.created, false); assert.deepEqual(replay.run, first.run);
  for (const extra of [{ planVersion: 2 }, { ownerSessionId: 'other' }]) await rejects(f.store.reserve(snap(extra)), 'REQUEST_CONFLICT');
  await rejects(f.store.reserve(snap({}, { title: 'changed' })), 'REQUEST_CONFLICT');
  await rejects(f.store.reserve(snap({ taskId: 'task-b' }, { id: 'task-b' })), 'REQUEST_CONFLICT');
  assert.equal((await f.store.reserve(snap({ changeId: 'change-b' }))).created, true);
  assert.equal((await f.store.list('change-a')).length, 1);
});

test('concurrent instances reserve one request exactly once', async t => {
  const f = await fixture(t);
  const results = await Promise.all(Array.from({ length: 10 }, (_, i) => new DispatchRunStore(f.root).reserve(snap({ childId: `child-${i}` }))));
  assert.equal(results.filter(r => r.created).length, 1);
  assert.equal(new Set(results.map(r => r.run.runId)).size, 1);
  assert.equal((await f.store.list('change-a')).length, 1);
});

test('cross-process lock deduplicates reserve and enforces CAS without launching Agents', async t => {
  const f = await fixture(t), moduleURL = new URL('../src/dispatch-store.js', import.meta.url).href;
  const child = expr => new Promise((resolve, reject) => {
    const source = `import { DispatchRunStore } from ${JSON.stringify(moduleURL)}; const store = new DispatchRunStore(${JSON.stringify(f.root)}); try { console.log(JSON.stringify(await ${expr})); } catch(e) { console.log(JSON.stringify({code:e.code})); }`;
    const p = spawn(process.execPath, ['--input-type=module', '-e', source]); let out = '', err = '';
    p.stdout.on('data', v => out += v); p.stderr.on('data', v => err += v); p.on('error', reject);
    p.on('close', code => { if (code) reject(new Error(err)); else { try { resolve(JSON.parse(out)); } catch(e) { reject(e); } } });
  });
  const results = await Promise.all([child(`store.reserve(${JSON.stringify(snap())})`), child(`store.reserve(${JSON.stringify(snap())})`)]);
  assert.equal(results.filter(r => r.created).length, 1); assert.equal(results[0].run.runId, results[1].run.runId);
  const mutation = `store.update('change-a',${JSON.stringify(results[0].run.runId)},'host-a',{expectedRevision:1,state:'starting'})`;
  const writes = await Promise.all([child(mutation), child(mutation)]);
  assert.equal(writes.filter(r => r.state === 'starting').length, 1);
  assert.equal(writes.find(r => r.code).code, 'REVISION_CONFLICT');
});

test('snapshot hash, identity and exact fields are revalidated', async t => {
  const f = await fixture(t);
  const altered = snap(); altered.taskSnapshot.title = 'changed';
  await rejects(f.store.reserve(altered), 'SNAPSHOT_HASH_MISMATCH');
  await rejects(f.store.reserve(snap({ taskSnapshotHash: '0'.repeat(64) })), 'SNAPSHOT_HASH_MISMATCH');
  await rejects(f.store.reserve(snap({ taskId: 'other' })), 'INVALID_INPUT');
  for (const field of Object.keys(snap())) { const s = snap(); delete s[field]; await rejects(f.store.reserve(s), 'INVALID_INPUT'); }
  await rejects(f.store.reserve(snap({ evidence: [] })), 'INVALID_INPUT');
  await rejects(f.store.reserve(snap({}, { status: 'completed' })), 'INVALID_INPUT');
  const { run } = await f.store.reserve(snap());
  const disk = JSON.parse(await fs.readFile(f.file(run), 'utf8')); disk.taskSnapshot.title = 'disk change';
  await fs.writeFile(f.file(run), JSON.stringify(disk));
  await rejects(f.store.get('change-a', run.runId), 'CORRUPT_STATE');
});

test('host ownership and required revision guard all updates', async t => {
  const f = await fixture(t), { run } = await f.store.reserve(snap());
  await rejects(f.store.update('change-a', run.runId, 'other', { expectedRevision: 1, state: 'starting' }), 'HOST_INSTANCE_CONFLICT');
  await rejects(f.store.update('change-a', run.runId, 'host-a', { state: 'starting' }), 'REVISION_REQUIRED');
  await rejects(update(f.store, run, { expectedRevision: 2 }), 'REVISION_CONFLICT');
  for (const key of ['childId', 'taskSnapshot', 'taskSnapshotHash', 'admittedRevision', 'taskStatus', 'evidence', 'hostInstanceId', 'ownerSessionId', 'pid']) await rejects(update(f.store, run, { [key]: 'changed' }), 'INVALID_INPUT');
  const writes = await Promise.allSettled([update(f.store, run, { state: 'starting' }), update(f.store, run, { state: 'starting' })]);
  assert.equal(writes.filter(v => v.status === 'fulfilled').length, 1);
  assert.equal(writes.find(v => v.status === 'rejected').reason.code, 'REVISION_CONFLICT');
});

test('jobId persists with starting and remains immutable after terminal return', async t => {
  const f = await fixture(t); let { run } = await f.store.reserve(snap());
  assert.equal(Object.hasOwn(run, 'jobId'), false);
  for (const jobId of ['', '   ', null, undefined, 1, {}, 'a' + String.fromCharCode(0) + 'b', 'x'.repeat(4001)]) {
    await rejects(update(f.store, run, { state: 'starting', jobId }), 'INVALID_INPUT');
  }
  run = await update(f.store, run, { state: 'starting', jobId: 'job-fixture' });
  assert.equal(run.jobId, 'job-fixture');
  assert.deepEqual(await new DispatchRunStore(f.root).get('change-a', run.runId), run);
  assert.equal((await f.store.list('change-a'))[0].jobId, 'job-fixture');
  run = await update(f.store, run, { state: 'returned' });
  assert.equal(run.jobId, 'job-fixture');
  await rejects(update(f.store, run, { jobId: 'replacement' }), 'INVALID_TRANSITION');
  assert.equal((await f.store.get('change-a', run.runId)).jobId, 'job-fixture');
});

test('states progress strictly and returned never represents task success', async t => {
  const f = await fixture(t); let { run } = await f.store.reserve(snap());
  for (const state of ['running', 'returned', 'failed', 'unknown']) await rejects(update(f.store, run, { state }), 'INVALID_TRANSITION');
  await rejects(update(f.store, run, { state: 'succeeded' }), 'INVALID_INPUT');
  run = await update(f.store, run, { state: 'starting' }); assert.ok(run.startedAt);
  await rejects(update(f.store, run, { state: 'reserved' }), 'INVALID_TRANSITION');
  run = await update(f.store, run, { state: 'running' });
  await rejects(update(f.store, run, { state: 'starting' }), 'INVALID_TRANSITION');
  run = await update(f.store, run, { state: 'returned', result: { text: 'Agent final answer', stopReason: null, diagnostic: null } });
  assert.ok(run.finishedAt); assert.equal('taskStatus' in run, false); assert.equal('evidence' in run, false);
  await rejects(update(f.store, run, { result: null }), 'INVALID_TRANSITION');
  for (const state of ['returned', 'failed', 'cancelled', 'error', 'unknown']) {
    let { run: r } = await f.store.reserve(snap({ requestId: state }));
    r = await update(f.store, r, { state: 'starting' }); r = await update(f.store, r, { state });
    assert.equal(r.state, state); await rejects(update(f.store, r, { state }), 'INVALID_TRANSITION');
  }
});

test('all text outputs are UTF-8 bounded with sticky truncation', async t => {
  const f = await fixture(t); let { run } = await f.store.reserve(snap());
  run = await update(f.store, run, { state: 'starting', result: { text: '你'.repeat(MAX_OUTPUT_BYTES), stopReason: 'x'.repeat(MAX_OUTPUT_BYTES + 1), diagnostic: '😀'.repeat(MAX_OUTPUT_BYTES) }, error: 'e'.repeat(MAX_OUTPUT_BYTES + 1), reason: 'r'.repeat(MAX_OUTPUT_BYTES + 1) });
  for (const value of [...Object.values(run.result), run.error, run.reason]) { assert.ok(Buffer.byteLength(value) <= MAX_OUTPUT_BYTES); assert.ok(!value.endsWith('�')); }
  assert.equal(run.truncated, true);
  run = await update(f.store, run, { result: { text: 'short', stopReason: null, diagnostic: null }, truncated: false });
  assert.equal(run.truncated, true); assert.deepEqual(await f.store.get('change-a', run.runId), run);
});

test('result accepts only nullable strings and does not imply a transition', async t => {
  const f = await fixture(t); let { run } = await f.store.reserve(snap());
  for (const result of [{ text: {} }, { diagnostic: [] }, { stopReason: 1 }, { evidence: [] }, { text: undefined }, new Date(), [], 'text']) await rejects(update(f.store, run, { result }), 'INVALID_INPUT');
  run = await update(f.store, run, { result: { text: null, stopReason: '', diagnostic: 'fixture' } });
  assert.equal(run.state, 'reserved');
  run = await update(f.store, run, { result: null }); assert.equal(run.result, null);
});

test('JSON safety rejects accessors, symbols, toJSON, prototypes and sparse arrays', async t => {
  const f = await fixture(t); let invoked = false;
  const accessor = snap(); Object.defineProperty(accessor, 'childId', { enumerable: true, get() { invoked = true; return 'x'; } });
  await rejects(f.store.reserve(accessor), 'INVALID_INPUT'); assert.equal(invoked, false);
  const symbol = snap(); symbol[Symbol('hidden')] = true; await rejects(f.store.reserve(symbol), 'INVALID_INPUT');
  const nonenum = snap(); Object.defineProperty(nonenum, 'extra', { value: true }); await rejects(f.store.reserve(nonenum), 'INVALID_INPUT');
  const toJSON = snap(); toJSON.taskSnapshot.toJSON = () => { invoked = true; return {}; }; await rejects(f.store.reserve(toJSON), 'INVALID_INPUT');
  const inherited = Object.assign(Object.create({ hidden: true }), snap()); await rejects(f.store.reserve(inherited), 'INVALID_INPUT');
  for (const list of [new Array(1), [undefined], [NaN], [1n], [() => {}]]) {
    const input = snap(); input.taskSnapshot.dependencies = list; await rejects(f.store.reserve(input), 'INVALID_INPUT');
  }
  const listGetter = snap(); Object.defineProperty(listGetter.taskSnapshot.expectedFiles, '0', { get() { invoked = true; return 'x'; } });
  await rejects(f.store.reserve(listGetter), 'INVALID_INPUT'); assert.equal(invoked, false);
  const { run } = await f.store.reserve(snap());
  const result = {}; Object.defineProperty(result, 'text', { enumerable: true, get() { invoked = true; return 'x'; } });
  await rejects(update(f.store, run, { result }), 'INVALID_INPUT'); assert.equal(invoked, false);
  await rejects(update(f.store, run, JSON.parse('{"__proto__": {"polluted": true}}')), 'INVALID_INPUT');
  assert.equal({}.polluted, undefined);
});

test('identifiers reject traversal and Windows device names', async t => {
  const f = await fixture(t);
  for (const changeId of ['../escape', 'a/b', 'a\\b', 'C:escape', 'CON', 'nul', 'COM1', 'LPT9', '.', 'a.', 'a ']) await rejects(f.store.reserve(snap({ changeId })), 'INVALID_ID');
  for (const extra of [{ childId: '' }, { ownerSessionId: 'a\0b' }, { planVersion: 0 }, { admittedRevision: NaN }]) await rejects(f.store.reserve(snap(extra)), 'INVALID_INPUT');
  await rejects(f.store.get('change-a', '../escape'), 'INVALID_ID');
  await rejects(f.store.get('change-a', 'missing'), 'NOT_FOUND');
  assert.deepEqual(await f.store.list('missing'), []);
});

test('hardlinked records and lock files fail closed', async t => {
  const f = await fixture(t), { run } = await f.store.reserve(snap());
  const target = path.join(f.root, 'target.json'); await fs.link(f.file(run), target);
  await rejects(f.store.get('change-a', run.runId), 'PATH_UNSAFE');
  await rejects(update(f.store, run, { state: 'starting' }), 'PATH_UNSAFE');
  assert.equal(JSON.parse(await fs.readFile(target, 'utf8')).state, 'reserved');
  await fs.unlink(target); await fs.link(f.file(run), path.join(f.dir, '.lock'));
  await rejects(update(f.store, run, { state: 'starting' }), 'PATH_UNSAFE');
});

test('symlinked storage ancestors fail without writing outside', async t => {
  const f = await fixture(t), target = path.join(f.root, 'outside'); await fs.mkdir(target);
  await fs.symlink(target, path.join(f.root, '.dsh'), process.platform === 'win32' ? 'junction' : 'dir');
  await rejects(f.store.reserve(snap()), 'PATH_UNSAFE'); await rejects(f.store.list('change-a'), 'PATH_UNSAFE');
  assert.deepEqual(await fs.readdir(target), []);
});

test('oversize and corrupt disk records fail closed; oversized snapshot leaves no run', async t => {
  const f = await fixture(t);
  await rejects(f.store.reserve(snap({}, { description: 'x'.repeat(1024 * 1024) })), 'STATE_TOO_LARGE');
  assert.deepEqual(await f.store.list('change-a'), []);
  const { run } = await f.store.reserve(snap());
  await fs.writeFile(f.file(run), 'x'.repeat(1024 * 1024 + 1)); await rejects(f.store.get('change-a', run.runId), 'CORRUPT_STATE');
  await fs.writeFile(f.file(run), '{broken'); await rejects(f.store.reserve(snap()), 'CORRUPT_STATE');
});

test('restart and replay never recover or adopt old-instance runs', async t => {
  const f = await fixture(t); let { run } = await f.store.reserve(snap());
  run = await update(f.store, run, { state: 'starting' }); run = await update(f.store, run, { state: 'running' });
  const reopened = new DispatchRunStore(f.root);
  assert.equal(typeof reopened.recover, 'undefined');
  assert.deepEqual(await reopened.list('change-a'), [run]); assert.deepEqual(await reopened.get('change-a', run.runId), run);
  assert.deepEqual((await reopened.reserve(snap({ hostInstanceId: 'host-new', childId: 'child-new' }))).run, run);
  await rejects(reopened.update('change-a', run.runId, 'host-new', { expectedRevision: run.revision, state: 'unknown' }), 'HOST_INSTANCE_CONFLICT');
});

test('stale lock stays intact, independent of verification runs lock', async t => {
  const f = await fixture(t), { run } = await f.store.reserve(snap());
  const runsDir = path.join(path.dirname(f.dir), 'runs'); await fs.mkdir(runsDir); await fs.writeFile(path.join(runsDir, '.lock'), 'verification lock');
  assert.equal((await f.store.reserve(snap({ requestId: 'second' }))).created, true);
  const lock = path.join(f.dir, '.lock'), content = '{"pid":99999999,"createdAt":"2000-01-01T00:00:00.000Z"}';
  await fs.writeFile(lock, content); await rejects(f.store.reserve(snap()), 'LOCK_BUSY');
  assert.equal(await fs.readFile(lock, 'utf8'), content); assert.deepEqual(await f.store.get('change-a', run.runId), run);
});

test('failed write does not claim a transition or leave temporary files', async t => {
  const f = await fixture(t), { run } = await f.store.reserve(snap());
  await fs.unlink(f.file(run)); await fs.mkdir(f.file(run));
  await rejects(update(f.store, run, { state: 'starting' }), 'PATH_UNSAFE');
  assert.ok((await fs.stat(f.file(run))).isDirectory());
  assert.equal((await fs.readdir(f.dir)).some(name => name.endsWith('.tmp') || name === '.lock'), false);
});
