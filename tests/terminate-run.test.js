import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { EngineeringStore } from '../src/core.js';
import { DispatchRunStore } from '../src/dispatch-store.js';
import { VerificationRunStore } from '../src/verification-store.js';
import { createOperations, terminateRun } from '../index.js';

const user = { kind: 'user', id: 'reviewer' };
const agent = { kind: 'agent', id: 'model' };
const EVIDENCE = {
  confirmed: true,
  checkedAt: '2026-11-20T12:00:00.000Z',
  scope: 'child-and-descendants-and-processes',
  basis: 'Checked the session list and process list; nothing from this run remains.',
  references: ['task-manager', 'ps -ef output'],
};
const REASON = 'The host process that owned this run exited.';

function taskSnapshot(task) {
  const normalized = {
    id: task.id, title: task.title, description: task.description, dependencies: task.dependencies,
    expectedFiles: task.expectedFiles, acceptanceCriteria: task.acceptanceCriteria,
    verificationCommands: task.verificationCommands,
  };
  return { normalized, hash: createHash('sha256').update(JSON.stringify(normalized)).digest('hex') };
}

async function setup(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'terminate-run-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new EngineeringStore(root);
  const dispatch = new DispatchRunStore(root);
  const verification = new VerificationRunStore(root);
  let state = (await store.execute({ action: 'create', title: 'Terminate', goal: 'Release attached-less runs' }, user)).change;
  const tasks = [{
    id: 'a', title: 'a', description: '', dependencies: [], expectedFiles: ['a.js'],
    acceptanceCriteria: ['works'], verificationCommands: ['echo fixture'],
  }];
  state = (await store.execute({ action: 'save', changeId: state.id, expectedRevision: state.revision, patch: { tasks } }, user)).change;
  state = (await store.execute({ action: 'approve', changeId: state.id, expectedRevision: state.revision }, user)).change;
  const current = async () => (await store.execute({ action: 'get', changeId: state.id }, user)).change;
  const transition = async (status, reason) => {
    state = (await store.execute({
      action: 'transition', changeId: state.id, expectedRevision: state.revision, taskId: 'a', status, reason,
    }, user)).change;
    return state;
  };
  const startedVerification = async (jobId = 'bash-fixture-0001') => {
    const run = await verification.reserve({
      changeId: state.id, taskId: 'a', planVersion: state.planVersion, commandIndex: 0,
      command: 'echo fixture', requestId: 'verify-a', hostInstanceId: 'host-old', ownerSessionId: 'session-old',
    }, 'host-old');
    const reserved = run.run ?? run;
    const starting = await verification.update(state.id, reserved.runId, 'host-old',
      { expectedRevision: reserved.revision, state: 'starting', jobId });
    return verification.update(state.id, starting.runId, 'host-old',
      { expectedRevision: starting.revision, state: 'running' });
  };
  const startedDispatch = async (jobId = 'bash-fixture-0002') => {
    const { normalized, hash } = taskSnapshot(tasks[0]);
    const reserved = await dispatch.reserve({
      changeId: state.id, taskId: 'a', planVersion: state.planVersion, admittedRevision: state.revision,
      requestId: 'dispatch-a', taskSnapshot: normalized, taskSnapshotHash: hash,
      hostInstanceId: 'host-old', ownerSessionId: 'session-old', childId: 'child-old',
    });
    const starting = await dispatch.update(state.id, reserved.run.runId, 'host-old',
      { expectedRevision: reserved.run.revision, state: 'starting', jobId });
    return dispatch.update(state.id, starting.runId, 'host-old',
      { expectedRevision: starting.revision, state: 'running' });
  };
  const terminate = async (input) => store.execute({
    action: 'terminateRun', changeId: state.id, kind: 'verification',
    expectedRevision: state.revision, reason: REASON, terminationEvidence: EVIDENCE, ...input,
  }, user).then((result) => { state = result.change; return result; });
  return { root, store, dispatch, verification, state: () => state, current, transition,
    startedVerification, startedDispatch, terminate };
}

test('an unattached verification run is terminated with a human attestation', async (t) => {
  const f = await setup(t);
  await f.transition('running');
  await f.transition('verifying');
  const run = await f.startedVerification();

  const result = await f.terminate({ runId: run.runId, expectedRunRevision: run.revision });
  const stored = await f.verification.get(f.state().id, run.runId);
  assert.equal(stored.state, 'cancelled');
  assert.equal(stored.jobId, 'bash-fixture-0001');
  assert.equal(stored.terminationEvidence.basis, EVIDENCE.basis);
  assert.deepEqual(stored.terminationEvidence.references, EVIDENCE.references);
  assert.equal(result.change.history.at(-1).kind, 'run-terminated-unattached');
  assert.equal(result.change.history.at(-1).runId, run.runId);
  assert.equal(result.change.history.at(-1).jobId, 'bash-fixture-0001');
});

test('terminating an unattached dispatch run releases the change for saving', async (t) => {
  const f = await setup(t);
  await f.transition('running');
  const run = await f.startedDispatch();
  const blocked = f.store.execute({
    action: 'save', changeId: f.state().id, expectedRevision: f.state().revision, patch: { goal: 'next' },
  }, user);
  await assert.rejects(blocked, (error) => error.code === 'PLAN_LOCKED' || error.code === 'DISPATCH_RUN_BLOCKED');

  const result = await f.terminate({
    kind: 'dispatch', runId: run.runId, expectedRunRevision: run.revision,
  });
  assert.equal((await f.dispatch.get(f.state().id, run.runId)).state, 'cancelled');
  assert.equal(result.change.history.at(-1).kind, 'run-terminated-unattached');
});

test('terminateRun refuses runs that never started, that ended, or that carry no job', async (t) => {
  const f = await setup(t);
  await f.transition('running');
  await f.transition('verifying');

  const reserved = await f.verification.reserve({
    changeId: f.state().id, taskId: 'a', planVersion: f.state().planVersion, commandIndex: 0,
    command: 'echo fixture', requestId: 'verify-reserved', hostInstanceId: 'host-old', ownerSessionId: 'session-old',
  }, 'host-old');
  await assert.rejects(
    f.terminate({ runId: reserved.runId, expectedRunRevision: reserved.revision }),
    (error) => error.code === 'INVALID_STATE',
  );

  const run = await f.startedVerification('bash-fixture-0003');
  await f.terminate({ runId: run.runId, expectedRunRevision: run.revision });
  const settled = await f.verification.get(f.state().id, run.runId);
  await assert.rejects(
    f.terminate({ runId: run.runId, expectedRunRevision: settled.revision }),
    (error) => error.code === 'INVALID_STATE',
  );
});

test('terminateRun requires an attestation, a current revision and a human actor', async (t) => {
  const f = await setup(t);
  await f.transition('running');
  await f.transition('verifying');
  const run = await f.startedVerification();

  await assert.rejects(
    f.terminate({ runId: run.runId, expectedRunRevision: run.revision, terminationEvidence: { ...EVIDENCE, confirmed: false } }),
    (error) => error.code === 'INVALID_INPUT',
  );
  await assert.rejects(
    f.terminate({ runId: run.runId, expectedRunRevision: run.revision + 1 }),
    (error) => error.code === 'REVISION_CONFLICT',
  );
  await assert.rejects(
    f.store.execute({
      action: 'terminateRun', changeId: f.state().id, kind: 'verification', runId: run.runId,
      expectedRevision: f.state().revision, expectedRunRevision: run.revision,
      reason: REASON, terminationEvidence: EVIDENCE,
    }, agent),
    (error) => error.code === 'FORBIDDEN',
  );
});

test('a run store refuses a cancellation attestation without termination evidence', async (t) => {
  const f = await setup(t);
  await f.transition('running');
  const run = await f.startedDispatch();
  await assert.rejects(
    f.dispatch.update(f.state().id, run.runId, 'host-old', {
      expectedRevision: run.revision, state: 'cancelled',
      abandoned: { actor: user, reason: REASON, at: new Date().toISOString() },
    }),
    (error) => error.code === 'INVALID_TRANSITION',
  );
});

test('the host refuses to terminate a run whose job is still attached', async (t) => {
  const f = await setup(t);
  await f.transition('running');
  await f.transition('verifying');
  const run = await f.startedVerification('bash-attached-0001');
  const ctx = {
    workingDirectory: { ensure: async () => f.root },
    sandboxPolicy: { resolve: () => ({ workspaceRoot: f.root }) },
    jobs: { kill: () => 'requested' },
  };
  await assert.rejects(
    terminateRun(ctx, { id: 'session' }, undefined, {
      action: 'terminateRun', changeId: f.state().id, kind: 'verification', runId: run.runId,
      expectedRevision: f.state().revision, expectedRunRevision: run.revision,
      reason: REASON, terminationEvidence: EVIDENCE,
    }, 'host-new'),
    (error) => error.code === 'ENGINEERING_RUN_STILL_ATTACHED',
  );
  assert.equal((await f.verification.get(f.state().id, run.runId)).state, 'running');
});

test('the host releases the run when the job handle is gone', async (t) => {
  const f = await setup(t);
  await f.transition('running');
  await f.transition('verifying');
  const run = await f.startedVerification('bash-gone-0001');
  const ctx = {
    workingDirectory: { ensure: async () => f.root },
    sandboxPolicy: { resolve: () => ({ workspaceRoot: f.root }) },
    jobs: { kill: () => { throw Object.assign(new Error('gone'), { code: 'JOB_NOT_FOUND' }); } },
  };
  const result = await terminateRun(ctx, { id: 'session' }, undefined, {
    action: 'terminateRun', changeId: f.state().id, kind: 'verification', runId: run.runId,
    expectedRevision: f.state().revision, expectedRunRevision: run.revision,
    reason: REASON, terminationEvidence: EVIDENCE,
  }, 'host-new');
  assert.equal(result.kill, 'missing');
  assert.equal(result.sameHost, false);
  assert.equal((await f.verification.get(f.state().id, run.runId)).state, 'cancelled');
});
