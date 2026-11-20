import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EngineeringStore } from '../src/core.js';
import { VerificationRunStore } from '../src/verification-store.js';
import { DispatchRunStore } from '../src/dispatch-store.js';
import { createOperations, parameters } from '../index.js';

const user = { kind: 'user', id: 'reviewer' };
const agent = { kind: 'agent', id: 'model' };
const identity = { hostInstanceId: 'host', ownerSessionId: 'session' };
const childIdentity = { ...identity, childId: 'child' };
const REASON = 'Reserved on a previous host that was interrupted before any launch.';

const changeFile = (root, id) => path.join(root, '.dsh', 'engineering', 'changes', id, 'state.json');
const verificationFile = (root, id, runId) => path.join(root, '.dsh', 'engineering', 'changes', id, 'runs', `${runId}.json`);
const dispatchFile = (root, id, runId) => path.join(root, '.dsh', 'engineering', 'changes', id, 'dispatches', `${runId}.json`);

async function setup(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stranded-runs-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new EngineeringStore(root);
  const verification = new VerificationRunStore(root);
  const dispatch = new DispatchRunStore(root);
  let state = (await store.execute({ action: 'create', title: 'Stranded runs', goal: 'Recover stranded reservations' }, user)).change;
  const tasks = ['a', 'b'].map((id) => ({
    id, title: id, description: '', dependencies: [], expectedFiles: [`${id}.js`],
    acceptanceCriteria: ['works'], verificationCommands: ['echo fixture'],
  }));
  state = (await store.execute({ action: 'save', changeId: state.id, expectedRevision: state.revision, patch: { tasks } }, user)).change;
  state = (await store.execute({ action: 'approve', changeId: state.id, expectedRevision: state.revision }, user)).change;
  const current = async () => (await store.execute({ action: 'get', changeId: state.id }, user)).change;
  const transition = async (taskId, status) => {
    state = (await store.execute({
      action: 'transition', changeId: state.id, expectedRevision: state.revision, taskId, status,
    }, user)).change;
    return state;
  };
  const verificationRequest = (extra = {}) => ({
    changeId: state.id, taskId: 'a', expectedRevision: state.revision, planVersion: state.planVersion,
    commandIndex: 0, command: 'echo fixture', requestId: 'verify-a', ...extra,
  });
  const dispatchRequest = (extra = {}) => ({
    changeId: state.id, taskId: 'a', expectedRevision: state.revision, planVersion: state.planVersion,
    requestId: 'dispatch-a', ...extra,
  });
  const abandon = async (input) => (await store.execute({ action: 'abandonRun', ...input }, user)).change;
  return { root, store, verification, dispatch, state: () => state, current, transition,
    verificationRequest, dispatchRequest, abandon };
}

function stableChange(change) {
  const copy = { ...change };
  delete copy.history;
  delete copy.revision;
  delete copy.updatedAt;
  delete copy.status;
  return copy;
}

test('a stranded verification reservation is abandoned and releases the change', async (t) => {
  const f = await setup(t);
  await f.transition('a', 'running');
  await f.transition('a', 'verifying');
  const { run } = await f.store.reserveVerification(f.verificationRequest(), identity);
  assert.equal(run.state, 'reserved');
  assert.equal(run.jobId, undefined);

  const before = await f.current();
  await assert.rejects(f.store.execute({
    action: 'save', changeId: before.id, expectedRevision: before.revision, patch: {},
  }, user), { code: 'VERIFICATION_RUN_BLOCKED' });

  const result = await f.abandon({ changeId: before.id, kind: 'verification', runId: run.runId,
    expectedRevision: before.revision, expectedRunRevision: run.revision, reason: REASON });

  // The run becomes a terminal cancellation carrying the human attestation and nothing else moves.
  const record = await f.verification.get(before.id, run.runId);
  assert.equal(record.state, 'cancelled');
  assert.equal(record.reason, REASON);
  assert.equal(record.abandoned.actor.kind, 'user');
  assert.equal(record.abandoned.actor.id, 'reviewer');
  assert.equal(record.abandoned.reason, REASON);
  assert.ok(!Number.isNaN(Date.parse(record.abandoned.at)));
  assert.ok(!Number.isNaN(Date.parse(record.finishedAt)));
  assert.equal(record.jobId, undefined);
  assert.equal(record.pid, undefined);
  assert.equal(record.command, run.command);
  assert.equal(record.taskId, run.taskId);
  assert.equal(record.revision, run.revision + 1);

  // Only history and revision move on the change.
  assert.deepEqual(stableChange(result), stableChange({ ...before, revision: before.revision + 1 }));
  assert.equal(result.revision, before.revision + 1);
  const entry = result.history.at(-1);
  assert.deepEqual(entry, {
    kind: 'run-abandoned', runKind: 'verification', runId: run.runId, runRevision: record.revision,
    actor: { kind: 'user', id: 'reviewer' }, reason: REASON, at: record.abandoned.at,
  });
  assert.equal(result.planVersion, before.planVersion);
  assert.deepEqual(result.tasks, before.tasks);
  assert.deepEqual(result.approvals, before.approvals);
  assert.deepEqual(result.evidence, before.evidence);
  assert.equal(result.deliveryAcceptance, before.deliveryAcceptance);

  // The cancelled run no longer blocks the change: the remaining lock is the active task, not the run.
  await assert.rejects(f.store.execute({
    action: 'save', changeId: result.id, expectedRevision: result.revision, patch: {},
  }, user), { code: 'PLAN_LOCKED' });
  await assert.rejects(f.store.execute({
    action: 'replan', changeId: result.id, expectedRevision: result.revision,
  }, user), { code: 'PLAN_LOCKED' });

  const failed = (await f.store.execute({
    action: 'transition', changeId: result.id, expectedRevision: result.revision, taskId: 'a', status: 'failed',
  }, user)).change;
  const replanned = (await f.store.execute({
    action: 'replan', changeId: failed.id, expectedRevision: failed.revision,
  }, user)).change;
  assert.equal(replanned.planVersion, failed.planVersion + 1);
  assert.ok(replanned.tasks.every((task) => task.status === 'pending'));
});

test('a stranded dispatch reservation is abandoned and save and replan go through', async (t) => {
  const f = await setup(t);
  const { run } = await f.store.reserveDispatch(f.dispatchRequest(), childIdentity);
  assert.equal(run.state, 'reserved');
  assert.equal(run.jobId, undefined);

  const before = await f.current();
  await assert.rejects(f.store.execute({
    action: 'save', changeId: before.id, expectedRevision: before.revision, patch: {},
  }, user), { code: 'DISPATCH_RUN_BLOCKED' });
  await assert.rejects(f.store.execute({
    action: 'replan', changeId: before.id, expectedRevision: before.revision,
  }, user), { code: 'DISPATCH_RUN_BLOCKED' });

  const result = await f.abandon({ changeId: before.id, kind: 'dispatch', runId: run.runId,
    expectedRevision: before.revision, expectedRunRevision: run.revision, reason: REASON });
  const record = await f.dispatch.get(before.id, run.runId);
  assert.equal(record.state, 'cancelled');
  assert.equal(record.reason, REASON);
  assert.equal(record.abandoned.reason, REASON);
  assert.equal(record.childId, run.childId);
  assert.equal(record.taskSnapshotHash, run.taskSnapshotHash);
  assert.equal(result.history.at(-1).runKind, 'dispatch');
  assert.equal(result.history.at(-1).runRevision, record.revision);

  const saved = (await f.store.execute({
    action: 'save', changeId: result.id, expectedRevision: result.revision, patch: { title: 'Stranded runs' },
  }, user)).change;
  assert.equal(saved.title, 'Stranded runs');
  const replanned = (await f.store.execute({
    action: 'replan', changeId: saved.id, expectedRevision: saved.revision,
  }, user)).change;
  assert.equal(replanned.planVersion, saved.planVersion + 1);
});

test('starting and running reservations are refused and their bytes are untouched', async (t) => {
  const f = await setup(t);
  await f.transition('a', 'running');
  await f.transition('a', 'verifying');
  const { run } = await f.store.reserveVerification(f.verificationRequest(), identity);
  const started = await f.verification.update(run.changeId, run.runId, 'host',
    { expectedRevision: run.revision, state: 'starting', jobId: 'job-1', pid: 4242 });
  const file = verificationFile(f.root, run.changeId, run.runId);

  const bytes = await fs.readFile(file);
  const before = await f.current();
  await assert.rejects(f.abandon({ changeId: before.id, kind: 'verification', runId: run.runId,
    expectedRevision: before.revision, expectedRunRevision: started.revision, reason: REASON }),
  { code: 'ABANDON_NOT_RESERVED' });
  assert.deepEqual(await fs.readFile(file), bytes);

  const resumed = await f.verification.update(run.changeId, run.runId, 'host',
    { expectedRevision: started.revision, state: 'running' });
  const running = await fs.readFile(file);
  await assert.rejects(f.abandon({ changeId: before.id, kind: 'verification', runId: run.runId,
    expectedRevision: before.revision, expectedRunRevision: resumed.revision, reason: REASON }),
  { code: 'ABANDON_NOT_RESERVED' });
  assert.deepEqual(await fs.readFile(file), running);

  const after = await f.current();
  assert.equal(after.revision, before.revision);
  assert.equal(after.history.length, before.history.length);
});

test('a reservation that already carries a jobId is refused', async (t) => {
  const f = await setup(t);
  const { run } = await f.store.reserveDispatch(f.dispatchRequest(), childIdentity);
  // A jobId without a state change still proves a launcher touched this record.
  const patched = await f.dispatch.update(run.changeId, run.runId, 'host',
    { expectedRevision: run.revision, jobId: 'job-9' });
  assert.equal(patched.state, 'reserved');
  const bytes = await fs.readFile(dispatchFile(f.root, run.changeId, run.runId));
  const before = await f.current();
  await assert.rejects(f.abandon({ changeId: before.id, kind: 'dispatch', runId: run.runId,
    expectedRevision: before.revision, expectedRunRevision: patched.revision, reason: REASON }),
  { code: 'ABANDON_NOT_RESERVED' });
  assert.deepEqual(await fs.readFile(dispatchFile(f.root, run.changeId, run.runId)), bytes);
  assert.equal((await f.current()).revision, before.revision);
});

test('an agent actor cannot abandon a run and the change is not modified', async (t) => {
  const f = await setup(t);
  const { run } = await f.store.reserveDispatch(f.dispatchRequest(), childIdentity);
  const before = await f.current();
  const bytes = await fs.readFile(changeFile(f.root, before.id));
  const input = { action: 'abandonRun', changeId: before.id, kind: 'dispatch', runId: run.runId,
    expectedRevision: before.revision, expectedRunRevision: run.revision, reason: REASON };

  await assert.rejects(f.store.execute(input, agent), { code: 'FORBIDDEN' });
  assert.deepEqual(await fs.readFile(changeFile(f.root, before.id)), bytes);
  assert.equal((await f.current()).revision, before.revision);
  assert.equal((await f.dispatch.get(before.id, run.runId)).state, 'reserved');

  // The registered operations reject it before touching the workspace, and the model-facing tool never lists it.
  let ensured = 0;
  const execute = createOperations({ workingDirectory: { ensure: async () => { ensured++; return f.root; } } },
    async () => f.root);
  await assert.rejects(execute(input, { id: 'model' }, 'agent'), /ENGINEERING_HUMAN_APPROVAL_REQUIRED/);
  assert.equal(ensured, 0);
  assert.ok(!parameters.properties.action.enum.includes('abandonRun'));
  assert.ok(!Object.values(parameters.properties).some((schema) => JSON.stringify(schema ?? '').includes('abandonRun')));
});

test('stale change and run revisions are both refused', async (t) => {
  const f = await setup(t);
  const { run } = await f.store.reserveDispatch(f.dispatchRequest(), childIdentity);
  const before = await f.current();

  await assert.rejects(f.abandon({ changeId: before.id, kind: 'dispatch', runId: run.runId,
    expectedRevision: before.revision + 1, expectedRunRevision: run.revision, reason: REASON }),
  { code: 'REVISION_CONFLICT' });
  await assert.rejects(f.abandon({ changeId: before.id, kind: 'dispatch', runId: run.runId,
    expectedRevision: before.revision, expectedRunRevision: run.revision + 3, reason: REASON }),
  { code: 'REVISION_CONFLICT' });

  const after = await f.current();
  assert.equal(after.revision, before.revision);
  assert.equal((await f.dispatch.get(before.id, run.runId)).state, 'reserved');
});

test('abandonRun rejects extra keys, accessors, symbols and NUL reasons', async (t) => {
  const f = await setup(t);
  const { run } = await f.store.reserveDispatch(f.dispatchRequest(), childIdentity);
  const before = await f.current();
  const base = { action: 'abandonRun', changeId: before.id, kind: 'dispatch', runId: run.runId,
    expectedRevision: before.revision, expectedRunRevision: run.revision, reason: REASON };
  const rejectsInput = (input, code = 'INVALID_INPUT') =>
    assert.rejects(f.store.execute(input, user), { code });

  await rejectsInput({ ...base, extra: 1 });
  await rejectsInput({ ...base, kind: 'other' });
  await rejectsInput({ ...base, reason: '' });
  await rejectsInput({ ...base, reason: 'x'.repeat(4001) });
  await rejectsInput({ ...base, reason: `bad\u0000reason` });
  await rejectsInput({ ...base, reason: 42 });
  const accessor = { ...base };
  Object.defineProperty(accessor, 'reason', { get: () => REASON, enumerable: true, configurable: true });
  await rejectsInput(accessor);
  const symbol = { ...base, [Symbol('hidden')]: true };
  await rejectsInput(symbol);
  await rejectsInput({ ...base, runId: 'not a valid run id' }, 'INVALID_ID');
  assert.equal((await f.current()).revision, before.revision);
  assert.equal((await f.dispatch.get(before.id, run.runId)).state, 'reserved');
});

test('abandonRun refuses a run that belongs to another change', async (t) => {
  const f = await setup(t);
  const { run } = await f.store.reserveDispatch(f.dispatchRequest(), childIdentity);
  const other = (await f.store.execute({ action: 'create', title: 'Other', goal: 'Other change' }, user)).change;
  await f.store.execute({ action: 'save', changeId: other.id, expectedRevision: other.revision,
    patch: { tasks: [{ id: 'c', title: 'c', dependencies: [], expectedFiles: ['c.js'],
      acceptanceCriteria: ['works'], verificationCommands: [] }] } }, user);
  const otherCurrent = (await f.store.execute({ action: 'get', changeId: other.id }, user)).change;
  await assert.rejects(f.abandon({ changeId: other.id, kind: 'dispatch', runId: run.runId,
    expectedRevision: otherCurrent.revision, expectedRunRevision: run.revision, reason: REASON }),
  { code: 'NOT_FOUND' });
  assert.equal((await f.dispatch.get(run.changeId, run.runId)).state, 'reserved');
});
