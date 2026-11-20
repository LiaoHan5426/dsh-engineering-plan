import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EngineeringStore } from '../src/core.js';
import { DispatchRunStore } from '../src/dispatch-store.js';
import { VerificationRunStore } from '../src/verification-store.js';
import { resolveDispatchRequest } from '../src/dispatch-request.js';

const user = { kind: 'user', id: 'fixture-reviewer' };
const identity = { hostInstanceId: 'host', ownerSessionId: 'session', childId: 'child' };
const verificationIdentity = { hostInstanceId: 'host', ownerSessionId: 'session' };
const rejects = (promise, code) => assert.rejects(promise, error => error.code === code);
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function fixture(t, approved = true) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dispatch-coordination-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new EngineeringStore(root), runs = new DispatchRunStore(root), verification = new VerificationRunStore(root);
  let state = (await store.execute({ action: 'create', title: 'Dispatch', goal: 'Coordinate admitted tasks' })).change;
  const action = async (action, fields = {}, actor) => {
    const revision = ['get', 'context'].includes(action) ? {} : { expectedRevision: state.revision };
    const result = await store.execute({ action, changeId: state.id, ...revision, ...fields }, actor);
    if (result.change) state = result.change;
    return result;
  };
  await action('save', { patch: { tasks: ['a', 'b'].map(id => ({ id, title: id, dependencies: [], expectedFiles: [`${id}.js`], acceptanceCriteria: ['works'], verificationCommands: ['echo fixture'] })) } });
  if (approved) await action('approve', {}, user);
  const request = extra => ({ changeId: state.id, taskId: 'a', expectedRevision: state.revision, planVersion: state.planVersion, requestId: 'request', ...extra });
  const verifyRequest = extra => ({ ...request(), commandIndex: 0, command: 'echo fixture', ...extra });
  return { root, store, runs, verification, action, request, verifyRequest, get state() { return state; } };
}
async function finish(f, run, state = 'returned') {
  run = await f.runs.update(run.changeId, run.runId, 'host', { expectedRevision: run.revision, state: 'starting' });
  return f.runs.update(run.changeId, run.runId, 'host', { expectedRevision: run.revision, state });
}

test('concurrent duplicate requests yield one durable reservation without changing tasks', async t => {
  const f = await fixture(t), before = structuredClone(f.state), request = f.request();
  const results = await Promise.all(Array.from({ length: 6 }, () => new EngineeringStore(f.root).reserveDispatch(request, identity)));
  assert.equal(results.filter(result => result.created).length, 1);
  assert.equal(new Set(results.map(result => result.run.runId)).size, 1);
  assert.equal((await f.runs.list(f.state.id)).length, 1);
  assert.deepEqual((await f.action('get')).change, before);
  assert.deepEqual(await f.verification.list(f.state.id), []);
  assert.ok((await fs.readdir(path.join(f.root, '.dsh', 'engineering', 'changes', f.state.id, 'dispatches'))).includes(`${results[0].run.runId}.json`));
});

test('replay compares explicit task plan owner and ignores changed revision host and child', async t => {
  const f = await fixture(t), request = f.request();
  const { run } = await f.store.reserveDispatch(request, identity);
  for (const extra of [{ taskId: 'b' }, { planVersion: 2 }]) await rejects(f.store.reserveDispatch({ ...request, ...extra }, identity), 'REQUEST_CONFLICT');
  await rejects(f.store.reserveDispatch(request, { ...identity, ownerSessionId: 'another' }), 'REQUEST_CONFLICT');
  await f.action('transition', { taskId: 'b', status: 'blocked', reason: 'independent' });
  const replay = await f.store.reserveDispatch(f.request(), { ...identity, hostInstanceId: 'new-host', childId: 'new-child' });
  assert.equal(replay.created, false); assert.deepEqual(replay.run, run);
  await finish(f, run);
  await f.action('replan', {}, user);
  const old = await f.store.reserveDispatch(request, identity);
  assert.equal(old.created, false); assert.equal(old.run.state, 'returned');
  assert.equal(old.run.taskSnapshotHash, run.taskSnapshotHash);
});

test('request and identity require exact data fields even on replay', async t => {
  const f = await fixture(t), request = f.request();
  await f.store.reserveDispatch(request, identity);
  for (const key of Object.keys(request)) {
    const missing = { ...request }; delete missing[key];
    await rejects(f.store.reserveDispatch(missing, identity), 'INVALID_INPUT');
  }
  for (const key of Object.keys(identity)) {
    const missing = { ...identity }; delete missing[key];
    await rejects(f.store.reserveDispatch(request, missing), 'INVALID_INPUT');
  }
  await rejects(f.store.reserveDispatch({ ...request, hash: 'extra' }, identity), 'INVALID_INPUT');
  await rejects(f.store.reserveDispatch(request, { ...identity, extra: true }), 'INVALID_INPUT');
  await rejects(f.store.reserveDispatch({ ...request, [Symbol('extra')]: true }, identity), 'INVALID_INPUT');
  let accessed = false;
  const accessor = { ...request }; Object.defineProperty(accessor, 'taskId', { get() { accessed = true; return 'a'; } });
  await rejects(f.store.reserveDispatch(accessor, identity), 'INVALID_INPUT');
  assert.equal(accessed, false);
  for (const expectedRevision of [0, -1, 1.1, '3', Number.MAX_SAFE_INTEGER + 1]) await rejects(f.store.reserveDispatch({ ...request, expectedRevision }, identity), 'REVISION_REQUIRED');
});

test('new requests require current version human approval and pending task', async t => {
  const f = await fixture(t, false);
  await rejects(f.store.reserveDispatch(f.request(), identity), 'APPROVAL_REQUIRED');
  await rejects(f.action('approve'), 'FORBIDDEN');
  await f.action('approve', {}, user);
  await rejects(f.store.reserveDispatch(f.request({ expectedRevision: 1 }), identity), 'REVISION_CONFLICT');
  await rejects(f.store.reserveDispatch(f.request({ planVersion: 2 }), identity), 'PLAN_VERSION_CONFLICT');
  await f.action('transition', { taskId: 'a', status: 'running' });
  await rejects(f.store.reserveDispatch(f.request(), identity), 'INVALID_STATE');
  assert.deepEqual(await f.runs.list(f.state.id), []);
});

test('different task dispatches serialize the entire change despite distinct file declarations', async t => {
  const f = await fixture(t);
  const results = await Promise.allSettled([
    f.store.reserveDispatch(f.request(), identity),
    new EngineeringStore(f.root).reserveDispatch(f.request({ taskId: 'b', requestId: 'second' }), { ...identity, childId: 'second' })
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'DISPATCH_RUN_BLOCKED');
});

test('change lock covers validation through durable reserve against concurrent mutation', async t => {
  const f = await fixture(t), entered = deferred(), release = deferred();
  const original = DispatchRunStore.prototype.reserve;
  DispatchRunStore.prototype.reserve = async function(snapshot) {
    if (snapshot.changeId === f.state.id) { entered.resolve(); await release.promise; }
    return original.call(this, snapshot);
  };
  t.after(() => { DispatchRunStore.prototype.reserve = original; });
  const pending = f.store.reserveDispatch(f.request(), identity);
  await entered.promise;
  const mutation = rejects(f.action('save', { patch: { title: 'race' } }), 'DISPATCH_RUN_BLOCKED');
  release.resolve();
  assert.equal((await pending).created, true);
  await mutation;
});

test('mutation winning before dispatch invalidates old revision without creating records', async t => {
  const f = await fixture(t), old = f.request();
  await f.action('replan', {}, user);
  await rejects(f.store.reserveDispatch(old, identity), 'REVISION_CONFLICT');
  assert.deepEqual(await f.runs.list(f.state.id), []);
});

test('all active states block mutations of dispatched task but allow reads and independent tasks', async t => {
  const f = await fixture(t); let { run } = await f.store.reserveDispatch(f.request(), identity);
  for (const state of ['reserved', 'starting', 'running']) {
    if (state !== 'reserved') run = await f.runs.update(run.changeId, run.runId, 'host', { expectedRevision: run.revision, state });
    for (const operation of [
      { action: 'save', patch: {} }, { action: 'replan' }, { action: 'acceptDelivery', note: 'fixture' },
      { action: 'transition', taskId: 'a', status: 'running' },
      { action: 'evidence', taskId: 'a', criterion: 'works', outcome: 'passed', note: 'fixture' }
    ]) await rejects(f.action(operation.action, Object.fromEntries(Object.entries(operation).filter(([key]) => key !== 'action')), user), 'DISPATCH_RUN_BLOCKED');
    await f.action('get'); await f.action('context'); await f.action('export');
    assert.equal((await f.store.execute({ action: 'list' })).changes.length, 1);
  }
  await f.action('transition', { taskId: 'b', status: 'running' });
  await f.action('transition', { taskId: 'b', status: 'verifying' });
  await f.action('evidence', { taskId: 'b', criterion: 'works', outcome: 'passed', note: 'independent evidence' });
  await rejects(f.store.reserveVerification(f.verifyRequest()), 'INVALID_INPUT');
  await rejects(f.store.reserveVerification(f.verifyRequest(), verificationIdentity), 'DISPATCH_RUN_BLOCKED');
  assert.equal((await f.store.reserveVerification(f.verifyRequest({ taskId: 'b' }), verificationIdentity)).created, true);
});

test('same-task historical verification blocks dispatch while other-task verification is allowed', async t => {
  const f = await fixture(t);
  await f.action('transition', { taskId: 'b', status: 'running' });
  await f.action('transition', { taskId: 'b', status: 'verifying' });
  await f.store.reserveVerification(f.verifyRequest({ taskId: 'b' }), verificationIdentity);
  assert.equal((await f.store.reserveDispatch(f.request(), identity)).created, true);
  const g = await fixture(t);
  const { expectedRevision, ...snapshot } = g.verifyRequest();
  let verification = await g.verification.reserve({ ...snapshot, ...verificationIdentity });
  await rejects(g.store.reserveDispatch(g.request(), identity), 'VERIFICATION_RUN_BLOCKED');
  verification = await g.verification.update(verification.changeId, verification.runId, 'host', { expectedRevision: verification.revision, state: 'starting' });
  await g.verification.update(verification.changeId, verification.runId, 'host', { expectedRevision: verification.revision, state: 'unknown' });
  await rejects(g.store.reserveDispatch(g.request(), identity), 'VERIFICATION_RUN_BLOCKED');
});

for (const terminal of ['returned', 'failed', 'cancelled', 'error']) {
  test(`${terminal} releases blockers without completing task or adding evidence`, async t => {
    const f = await fixture(t), { run } = await f.store.reserveDispatch(f.request(), identity);
    await finish(f, run, terminal);
    await f.action('get');
    assert.equal(f.state.tasks[0].status, 'pending'); assert.deepEqual(f.state.evidence, []);
    await rejects(f.action('acceptDelivery', { note: 'not complete' }, user), 'DELIVERY_NOT_READY');
    assert.equal((await f.store.reserveDispatch(f.request({ requestId: 'retry' }), identity)).created, true);
    const retry = (await f.runs.list(f.state.id)).find(record => record.requestId === 'retry');
    await finish(f, retry, terminal);
    await f.action('save', { patch: { title: 'released' } });
    assert.equal(f.state.title, 'released');
  });
}

test('unknown remains blocking across new stores and plan versions with no automatic resolution', async t => {
  const f = await fixture(t), snapshot = resolveDispatchRequest(f.state, f.request());
  await f.action('replan', {}, user);
  await f.action('approve', {}, user);
  const { run } = await f.runs.reserve({ ...snapshot, ...identity });
  const unknown = await finish(f, run, 'unknown');
  const other = new EngineeringStore(f.root);
  await rejects(other.reserveDispatch(f.request({ taskId: 'b', requestId: 'new' }), { ...identity, hostInstanceId: 'new-host' }), 'DISPATCH_RUN_BLOCKED');
  for (const operation of [{ action: 'save', patch: {} }, { action: 'replan' }, { action: 'transition', taskId: 'a', status: 'running' }]) {
    await rejects(other.execute({ ...operation, changeId: f.state.id, expectedRevision: f.state.revision }, user), 'DISPATCH_RUN_BLOCKED');
  }
  await rejects(f.store.reserveVerification(f.verifyRequest(), verificationIdentity), 'DISPATCH_RUN_BLOCKED');
  await assert.rejects(f.action('resolveUnknown', { runId: run.runId, expectedRunRevision: unknown.revision, reason: 'dispatch has no resolver' }, user), error => ['NOT_FOUND', 'ENOENT'].includes(error.code));
  assert.deepEqual(await new DispatchRunStore(f.root).get(run.changeId, run.runId), unknown);
});

test('corrupt dispatch records fail closed for mutations and admission while get remains available', async t => {
  const f = await fixture(t), { run } = await f.store.reserveDispatch(f.request(), identity);
  await fs.writeFile(path.join(f.root, '.dsh', 'engineering', 'changes', f.state.id, 'dispatches', `${run.runId}.json`), '{broken');
  await rejects(f.action('save', { patch: {} }), 'CORRUPT_STATE');
  await rejects(f.store.reserveDispatch(f.request({ requestId: 'new' }), identity), 'CORRUPT_STATE');
  await rejects(f.store.reserveVerification(f.verifyRequest(), verificationIdentity), 'CORRUPT_STATE');
  await f.action('get');
});
