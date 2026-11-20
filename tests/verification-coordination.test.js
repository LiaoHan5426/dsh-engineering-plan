import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EngineeringStore } from '../src/core.js';
import { VerificationRunStore } from '../src/verification-store.js';

const user = { kind: 'user', id: 'reviewer' };
const identity = { hostInstanceId: 'host', ownerSessionId: 'session' };
const rejects = (promise, code) => assert.rejects(promise, error => error.code === code);
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'verification-coordination-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new EngineeringStore(root), runs = new VerificationRunStore(root);
  let state = (await store.execute({ action: 'create', title: 'Coordination', goal: 'Serialize verification' })).change;
  const action = async (action, fields = {}, actor) => {
    const result = await store.execute({ action, changeId: state.id, expectedRevision: state.revision, ...fields }, actor);
    state = result.change; return result;
  };
  await action('save', { patch: { tasks: ['a', 'b'].map(id => ({ id, title: id, dependencies: [], expectedFiles: [`${id}.js`], acceptanceCriteria: ['works'], verificationCommands: ['echo fixture'] })) } });
  await action('approve', {}, user);
  await action('transition', { taskId: 'a', status: 'running' });
  await action('transition', { taskId: 'a', status: 'verifying' });
  const request = extra => ({ changeId: state.id, taskId: 'a', expectedRevision: state.revision, planVersion: state.planVersion, commandIndex: 0, command: 'echo fixture', requestId: 'request', ...extra });
  return { root, store, runs, action, request, get state() { return state; } };
}
async function finish(f, run, state = 'failed') {
  run = await f.runs.update(run.changeId, run.runId, 'host', { expectedRevision: run.revision, state: 'starting' });
  return f.runs.update(run.changeId, run.runId, 'host', { expectedRevision: run.revision, state });
}

test('reservation persists across store instances and blocks lifecycle changes', async t => {
  const f = await fixture(t);
  const { run, created } = await f.store.reserveVerification(f.request(), identity);
  assert.equal(created, true);
  const other = new EngineeringStore(f.root);
  for (const operation of [
    { action: 'save', patch: {} }, { action: 'replan' },
    ...['blocked', 'cancelled', 'completed', 'running'].map(status => ({ action: 'transition', taskId: 'a', status, reason: 'stop' }))
  ]) await rejects(other.execute({ ...operation, changeId: f.state.id, expectedRevision: f.state.revision }, user), 'VERIFICATION_RUN_BLOCKED');
  await rejects(f.store.reserveVerification(f.request({ requestId: 'second' }), identity), 'VERIFICATION_RUN_BLOCKED');
  await f.action('transition', { taskId: 'b', status: 'blocked', reason: 'independent' });
  await finish(f, run);
  await f.action('transition', { taskId: 'a', status: 'blocked', reason: 'finished' });
  await f.action('replan', {}, user);
  assert.equal(f.state.planVersion, 2);
});

test('duplicate requests return one launchable reservation and immutable snapshot conflicts', async t => {
  const f = await fixture(t), request = f.request();
  const results = await Promise.all([f.store.reserveVerification(request, identity), new EngineeringStore(f.root).reserveVerification(request, identity)]);
  assert.equal(results.filter(r => r.created).length, 1);
  assert.equal(results[0].run.runId, results[1].run.runId);
  for (const extra of [{ taskId: 'b' }, { command: 'other' }, { commandIndex: 1 }, { planVersion: 2 }]) {
    await rejects(f.store.reserveVerification({ ...request, ...extra }, identity), 'REQUEST_CONFLICT');
  }
  await rejects(f.store.reserveVerification(request, { ...identity, ownerSessionId: 'other' }), 'REQUEST_CONFLICT');
  await finish(f, results[0].run);
  await f.action('transition', { taskId: 'a', status: 'blocked', reason: 'finished' });
  await f.action('replan', {}, user);
  const replay = await f.store.reserveVerification(request, { ...identity, hostInstanceId: 'new-host' });
  assert.equal(replay.created, false); assert.equal(replay.run.state, 'failed');
});

test('change lock covers validation through durable reserve against concurrent block and replan', async t => {
  const f = await fixture(t), entered = deferred(), release = deferred();
  const original = VerificationRunStore.prototype.reserve;
  VerificationRunStore.prototype.reserve = async function(input) {
    if (input.changeId === f.state.id) { entered.resolve(); await release.promise; }
    return original.call(this, input);
  };
  t.after(() => { VerificationRunStore.prototype.reserve = original; });
  const pending = f.store.reserveVerification(f.request(), identity);
  await entered.promise;
  const transition = f.action('transition', { taskId: 'a', status: 'blocked', reason: 'race' });
  const rejected = rejects(transition, 'VERIFICATION_RUN_BLOCKED');
  release.resolve();
  assert.equal((await pending).created, true);
  await rejected;
  await rejects(f.action('replan', {}, user), 'VERIFICATION_RUN_BLOCKED');
});

test('transition winning before reserve invalidates request and creates no run', async t => {
  const f = await fixture(t), old = f.request();
  await f.action('transition', { taskId: 'a', status: 'blocked', reason: 'first' });
  await f.action('replan', {}, user);
  await rejects(f.store.reserveVerification(old, identity), 'REVISION_CONFLICT');
  assert.deepEqual(await f.runs.list(f.state.id), []);
});

test('unknown requires explicit human CAS resolution while preserving run and evidence', async t => {
  const f = await fixture(t), { run } = await f.store.reserveVerification(f.request(), identity);
  const unknown = await finish(f, run, 'unknown');
  const resolve = { runId: run.runId, expectedRunRevision: unknown.revision, reason: 'Inspected old Host and process exit; reviewed workspace effects' };
  await rejects(f.action('transition', { taskId: 'a', status: 'blocked', reason: 'wait' }), 'VERIFICATION_RUN_BLOCKED');
  await rejects(f.action('resolveUnknown', resolve), 'FORBIDDEN');
  await rejects(f.action('resolveUnknown', { ...resolve, expectedRunRevision: 1 }, user), 'REVISION_CONFLICT');
  await rejects(f.action('resolveUnknown', { ...resolve, reason: ' ' }, user), 'INVALID_INPUT');
  await f.action('resolveUnknown', resolve, user);
  assert.deepEqual(await f.runs.get(run.changeId, run.runId), unknown);
  assert.deepEqual(f.state.evidence, []);
  assert.equal(f.state.history.at(-1).runRevision, unknown.revision);
  await rejects(f.action('resolveUnknown', resolve, user), 'INVALID_STATE');
  await f.action('transition', { taskId: 'a', status: 'blocked', reason: 'reviewed' });
  await f.action('replan', {}, user);
});

test('foreign Host reservation is not auto-recovered or human-resolved as unknown', async t => {
  const f = await fixture(t), { run } = await f.store.reserveVerification(f.request(), identity);
  await rejects(f.action('resolveUnknown', { runId: run.runId, expectedRunRevision: run.revision, reason: 'different instance' }, user), 'INVALID_STATE');
  await rejects(new EngineeringStore(f.root).reserveVerification(f.request({ requestId: 'new' }), { ...identity, hostInstanceId: 'new-host' }), 'VERIFICATION_RUN_BLOCKED');
  assert.equal((await f.runs.get(run.changeId, run.runId)).state, 'reserved');
});

test('starting and running remain blockers until a durable terminal result', async t => {
  const f = await fixture(t); let { run } = await f.store.reserveVerification(f.request(), identity);
  for (const state of ['starting', 'running']) {
    run = await f.runs.update(run.changeId, run.runId, 'host', { expectedRevision: run.revision, state });
    await rejects(f.action('transition', { taskId: 'a', status: 'blocked', reason: 'stop' }), 'VERIFICATION_RUN_BLOCKED');
    await rejects(f.action('replan', {}, user), 'VERIFICATION_RUN_BLOCKED');
  }
  await f.runs.update(run.changeId, run.runId, 'host', { expectedRevision: run.revision, state: 'cancelled' });
  await f.action('transition', { taskId: 'a', status: 'blocked', reason: 'stopped' });
});

test('historical runs block save and replan even when all tasks are pending', async t => {
  const f = await fixture(t), snapshot = f.request();
  await f.action('transition', { taskId: 'a', status: 'blocked', reason: 'paused' });
  await f.action('replan', {}, user);
  // Simulate a persisted pre-upgrade run, independent of the current task state/version.
  const { expectedRevision, ...stored } = snapshot;
  await f.runs.reserve({ ...stored, ...identity });
  await rejects(f.action('save', { patch: { title: 'new' } }), 'VERIFICATION_RUN_BLOCKED');
  await rejects(f.action('replan', {}, user), 'VERIFICATION_RUN_BLOCKED');
});

test('corrupt records fail closed during transition and reservation', async t => {
  const f = await fixture(t), { run } = await f.store.reserveVerification(f.request(), identity);
  await fs.writeFile(path.join(f.root, '.dsh', 'engineering', 'changes', f.state.id, 'runs', `${run.runId}.json`), '{broken');
  await rejects(f.action('transition', { taskId: 'a', status: 'blocked', reason: 'stop' }), 'CORRUPT_STATE');
  await rejects(f.store.reserveVerification(f.request({ requestId: 'new' }), identity), 'CORRUPT_STATE');
});
