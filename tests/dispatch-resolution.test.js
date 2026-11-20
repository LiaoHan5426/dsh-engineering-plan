import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EngineeringStore } from '../src/core.js';
import { DispatchRunStore } from '../src/dispatch-store.js';
import { resolveDispatchRequest } from '../src/dispatch-request.js';
import { createOperations, parameters } from '../index.js';

const user = { kind: 'user', id: 'reviewer' };
const identity = { hostInstanceId: 'host', ownerSessionId: 'session', childId: 'child' };
const evidence = () => ({ confirmed: true, checkedAt: '2026-11-19T05:00:00.000Z', scope: 'child-and-descendants-and-processes', basis: 'Human inspected the child, descendants and associated processes.', references: ['inspection-record'] });
const rejects = (promise, code) => assert.rejects(promise, error => error.code === code);
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dispatch-resolution-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new EngineeringStore(root), runs = new DispatchRunStore(root);
  let state = (await store.execute({ action: 'create', title: 'Resolution', goal: 'Record human attestation' })).change;
  const action = async (action, fields = {}, actor = user) => {
    const result = await store.execute({ action, changeId: state.id, expectedRevision: state.revision, ...fields }, actor);
    if (result.change) state = result.change;
    return result;
  };
  await action('save', { patch: { tasks: ['a', 'b'].map(id => ({ id, title: id, dependencies: [], expectedFiles: [`${id}.js`], acceptanceCriteria: ['works'], verificationCommands: ['echo fixture'] })) } });
  await action('approve');
  const request = extra => ({ changeId: state.id, taskId: 'a', expectedRevision: state.revision, planVersion: state.planVersion, requestId: 'request', ...extra });
  const add = async (taskId = 'a', terminal = 'unknown', jobId) => {
    const snapshot = resolveDispatchRequest(state, request({ taskId, requestId: `r-${taskId}-${Math.random().toString(36).slice(2)}` }));
    let { run } = await runs.reserve({ ...snapshot, ...identity });
    if (terminal !== 'reserved') run = await runs.update(state.id, run.runId, 'host', { expectedRevision: run.revision, state: 'starting', ...(jobId ? { jobId } : {}) });
    if (!['reserved', 'starting'].includes(terminal)) run = await runs.update(state.id, run.runId, 'host', { expectedRevision: run.revision, state: terminal });
    return run;
  };
  const resolution = (run, extra = {}) => ({ action: 'resolveDispatchUnknown', changeId: state.id, expectedRevision: state.revision, runId: run.runId, expectedRunRevision: run.revision, reason: 'Human checked termination', terminationEvidence: evidence(), ...extra });
  const resolve = async run => { const result = await store.execute(resolution(run), user); state = result.change; return result; };
  const file = run => path.join(root, '.dsh', 'engineering', 'changes', state.id, 'dispatches', `${run.runId}.json`);
  return { root, store, runs, action, request, add, resolution, resolve, file, get state() { return state; } };
}

test('human-only boundaries reject model calls and do not add a model enum', async t => {
  const f = await fixture(t), run = await f.add();
  await rejects(f.store.execute(f.resolution(run), { kind: 'agent', id: 'model' }), 'FORBIDDEN');
  let ensures = 0;
  const execute = createOperations({ workingDirectory: { ensure: async () => { ensures++; return f.root; } } }, async () => f.root);
  await assert.rejects(execute(f.resolution(run), { id: 'model' }, 'agent'), /ENGINEERING_HUMAN_APPROVAL_REQUIRED/);
  assert.equal(ensures, 0);
  assert.ok(!parameters.properties.action.enum.includes('resolveDispatchUnknown'));
  const result = await execute(f.resolution(run), { id: 'reviewer' }, 'user');
  assert.equal(result.change.history.at(-1).actor.kind, 'user');
});

for (const jobId of [undefined, 'job-fixture']) test(`history copies run identity and leaves immutable bytes unchanged (${jobId ?? 'no job'})`, async t => {
  const f = await fixture(t), run = await f.add('a', 'unknown', jobId), before = structuredClone(f.state);
  const bytes = await fs.readFile(f.file(run));
  await f.resolve(run);
  assert.deepEqual(await fs.readFile(f.file(run)), bytes);
  assert.deepEqual(await f.runs.get(f.state.id, run.runId), run);
  const entry = f.state.history.at(-1);
  assert.deepEqual(entry, { kind: 'dispatch-unknown-resolved', runId: run.runId, runRevision: run.revision, taskId: run.taskId, planVersion: run.planVersion, taskSnapshotHash: run.taskSnapshotHash, hostInstanceId: run.hostInstanceId, ownerSessionId: run.ownerSessionId, childId: run.childId, jobId: jobId ?? null, actor: user, reason: 'Human checked termination', terminationEvidence: evidence(), recordedAt: entry.recordedAt });
  assert.equal(new Date(entry.recordedAt).toISOString(), entry.recordedAt);
  const { revision, updatedAt, history, ...unchanged } = f.state;
  const { revision: oldRevision, updatedAt: oldTime, history: oldHistory, ...original } = before;
  assert.deepEqual(unchanged, original); assert.equal(revision, oldRevision + 1);
  assert.deepEqual(history.slice(0, -1), oldHistory);
  await rejects(f.store.execute(f.resolution(run), user), 'INVALID_STATE');
  await rejects(f.runs.update(run.changeId, run.runId, 'host', { expectedRevision: run.revision, state: 'returned' }), 'INVALID_TRANSITION');
});

test('literal backslash text remains valid while actual NUL is rejected', async t => {
  const f = await fixture(t), run = await f.add();
  const literal = String.raw`inspection\0\u0000\processes`;
  const result = await f.store.execute(f.resolution(run, { reason: literal, terminationEvidence: { ...evidence(), basis: literal, references: [literal] } }), user);
  assert.equal(result.change.history.at(-1).reason, literal);
  assert.equal(result.change.history.at(-1).terminationEvidence.basis, literal);
  assert.deepEqual(result.change.history.at(-1).terminationEvidence.references, [literal]);
});

test('both CAS values checked and concurrent submissions commit exactly once', async t => {
  const f = await fixture(t), run = await f.add();
  for (const extra of [{ expectedRevision: f.state.revision - 1 }, { expectedRunRevision: run.revision - 1 }]) await rejects(f.store.execute(f.resolution(run, extra), user), 'REVISION_CONFLICT');
  for (const key of ['expectedRevision', 'expectedRunRevision']) for (const value of [0, -1, 1.5, '3', Number.MAX_SAFE_INTEGER + 1]) await rejects(f.store.execute(f.resolution(run, { [key]: value }), user), 'REVISION_REQUIRED');
  const input = f.resolution(run);
  const results = await Promise.allSettled(Array.from({ length: 6 }, () => new EngineeringStore(f.root).execute(input, user)));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.ok(results.filter(r => r.status === 'rejected').every(r => r.reason.code === 'REVISION_CONFLICT'));
  const { change } = await f.store.execute({ action: 'get', changeId: f.state.id });
  assert.equal(change.history.filter(e => e.kind === 'dispatch-unknown-resolved').length, 1);
});

for (const state of ['reserved', 'starting', 'running', 'returned', 'failed', 'cancelled', 'error']) test(`only unknown can be resolved: ${state}`, async t => {
  const f = await fixture(t), run = await f.add('a', state);
  await rejects(f.store.execute(f.resolution(run), user), 'INVALID_STATE');
});

test('strict exact inputs reject missing, extra, accessor, symbol and invalid evidence fields', async t => {
  const f = await fixture(t), run = await f.add(), valid = f.resolution(run);
  const invalid = [];
  for (const key of Object.keys(valid)) { if (key === 'action') continue; const input = { ...valid }; delete input[key]; invalid.push(input); }
  for (const key of ['taskId', 'planVersion', 'hostInstanceId', 'ownerSessionId', 'childId', 'jobId', 'actor']) invalid.push({ ...valid, [key]: 'forged' });
  invalid.push({ ...valid, [Symbol('extra')]: true });
  for (const value of [undefined, null, {}, [], { ...evidence(), extra: true }]) invalid.push({ ...valid, terminationEvidence: value });
  for (const key of Object.keys(evidence())) { const value = evidence(); delete value[key]; invalid.push({ ...valid, terminationEvidence: value }); }
  for (const patch of [{ confirmed: false }, { confirmed: 'true' }, { scope: 'child' }, { basis: '' }, { basis: ' ' }, { basis: 'a'.repeat(4001) }, { basis: '\u0000' }, { checkedAt: 'yesterday' }, { checkedAt: '2026-02-30T00:00:00.000Z' }, { checkedAt: '2026-11-19' }, { references: 'record' }, { references: [null] }, { references: [''] }, { references: ['\u0000'] }, { references: ['a'.repeat(4001)] }, { references: Array(201).fill('r') }, { references: Array(1) }]) invalid.push({ ...valid, terminationEvidence: { ...evidence(), ...patch } });
  for (const reason of ['', ' ', 'a'.repeat(4001), '\u0000']) invalid.push({ ...valid, reason });
  let accessed = false;
  const actionAccessor = { ...valid }; Object.defineProperty(actionAccessor, 'action', { get() { accessed = true; return 'resolveDispatchUnknown'; }, enumerable: true }); invalid.push(actionAccessor);
  const execute = createOperations({ workingDirectory: { ensure: async () => { throw new Error('must not access storage'); } } }, async () => { throw new Error('must not access storage'); });
  await assert.rejects(execute(actionAccessor, { id: 'model' }, 'agent'), /ENGINEERING_INVALID_INPUT/);
  const accessor = { ...valid }; Object.defineProperty(accessor, 'reason', { get() { accessed = true; return 'bad'; }, enumerable: true }); invalid.push(accessor);
  const nested = evidence(); Object.defineProperty(nested, 'basis', { get() { accessed = true; return 'bad'; }, enumerable: true }); invalid.push({ ...valid, terminationEvidence: nested });
  const refs = ['r']; Object.defineProperty(refs, '0', { get() { accessed = true; return 'bad'; }, enumerable: true }); invalid.push({ ...valid, terminationEvidence: { ...evidence(), references: refs } });
  for (const input of invalid) await rejects(f.store.execute(input, user), 'INVALID_INPUT');
  assert.equal(accessed, false);
  assert.deepEqual((await f.store.execute({ action: 'get', changeId: f.state.id })).change, f.state);
});

for (const operation of ['reserveDispatch', 'reserveVerification', 'save', 'replan', 'transition', 'evidence', 'acceptDelivery']) test(`resolution releases original blocker scope: ${operation}`, async t => {
  const f = await fixture(t), run = await f.add();
  // Runs can outlive task states. Seed verifying before inserting the run for these operations.
  if (['reserveVerification', 'evidence'].includes(operation)) {
    await f.resolve(run);
    await f.action('transition', { taskId: 'a', status: 'running' });
    await f.action('transition', { taskId: 'a', status: 'verifying' });
  }
  let target = run;
  if (['reserveVerification', 'evidence'].includes(operation)) {
    // Reuse the valid original snapshot; store admission does not launch anything.
    const { run: pending } = await f.runs.reserve({ ...Object.fromEntries(['changeId','taskId','planVersion','admittedRevision','taskSnapshot','taskSnapshotHash','hostInstanceId','ownerSessionId','childId'].map(k => [k, run[k]])), requestId: 'second' });
    const starting = await f.runs.update(run.changeId, pending.runId, 'host', { expectedRevision: pending.revision, state: 'starting' });
    target = await f.runs.update(run.changeId, pending.runId, 'host', { expectedRevision: starting.revision, state: 'unknown' });
  }
  const perform = () => {
    if (operation === 'reserveDispatch') return f.store.reserveDispatch(f.request({ requestId: 'retry' }), identity);
    if (operation === 'reserveVerification') return f.store.reserveVerification({ ...f.request({ requestId: 'verify' }), commandIndex: 0, command: 'echo fixture' }, { hostInstanceId: 'host', ownerSessionId: 'session' });
    const fields = { save: { patch: {} }, replan: {}, transition: { taskId: 'a', status: 'running' }, evidence: { taskId: 'a', criterion: 'works', outcome: 'passed', note: 'fixture' }, acceptDelivery: { note: 'fixture' } };
    return f.action(operation, fields[operation]);
  };
  await rejects(perform(), 'DISPATCH_RUN_BLOCKED');
  await f.resolve(target);
  if (operation === 'acceptDelivery') await rejects(perform(), 'DELIVERY_NOT_READY'); else await perform();
});

test('other unknown keeps change blocked while unrelated task mutation retains its scope', async t => {
  const f = await fixture(t), a = await f.add('a'), b = await f.add('b');
  await f.resolve(a);
  await rejects(f.action('save', { patch: {} }), 'DISPATCH_RUN_BLOCKED');
  await rejects(f.store.reserveDispatch(f.request({ requestId: 'retry' }), identity), 'DISPATCH_RUN_BLOCKED');
  await rejects(f.action('transition', { taskId: 'b', status: 'running' }), 'DISPATCH_RUN_BLOCKED');
  await f.action('transition', { taskId: 'a', status: 'running' });
  await f.action('transition', { taskId: 'a', status: 'verifying' });
  await f.action('evidence', { taskId: 'a', criterion: 'works', outcome: 'passed', note: 'fixture' });
  await f.store.reserveVerification({ ...f.request({ requestId: 'verify' }), commandIndex: 0, command: 'echo fixture' }, { hostInstanceId: 'host', ownerSessionId: 'session' });
  assert.equal((await f.runs.get(b.changeId, b.runId)).state, 'unknown');
});

test('old plan runs stay blocking until explicit resolution of their exact revision', async t => {
  const f = await fixture(t), snapshot = resolveDispatchRequest(f.state, f.request());
  await f.action('replan'); await f.action('approve');
  let { run } = await f.runs.reserve({ ...snapshot, ...identity });
  run = await f.runs.update(run.changeId, run.runId, 'host', { expectedRevision: run.revision, state: 'starting' });
  run = await f.runs.update(run.changeId, run.runId, 'host', { expectedRevision: run.revision, state: 'unknown' });
  await rejects(f.action('save', { patch: {} }), 'DISPATCH_RUN_BLOCKED');
  await f.resolve(run);
  assert.equal(f.state.history.at(-1).planVersion, snapshot.planVersion);
  await f.action('save', { patch: {} });
});

for (const variant of ['agent', 'wrong-run', 'wrong-revision', 'active']) test(`history exemption requires exact human unknown match: ${variant}`, async t => {
  const f = await fixture(t), run = await f.add('a', variant === 'active' ? 'running' : 'unknown');
  const stateFile = path.join(f.root, '.dsh', 'engineering', 'changes', f.state.id, 'state.json');
  const state = JSON.parse(await fs.readFile(stateFile, 'utf8'));
  state.history.push({ kind: 'dispatch-unknown-resolved', runId: variant === 'wrong-run' ? 'another' : run.runId, runRevision: variant === 'wrong-revision' ? run.revision - 1 : run.revision, actor: { kind: variant === 'agent' ? 'agent' : 'user', id: 'fixture' } });
  await fs.writeFile(stateFile, JSON.stringify(state));
  await rejects(f.action('save', { patch: {} }), 'DISPATCH_RUN_BLOCKED');
  await rejects(f.store.reserveDispatch(f.request({ requestId: 'retry' }), identity), 'DISPATCH_RUN_BLOCKED');
});
