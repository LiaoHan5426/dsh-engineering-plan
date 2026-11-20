import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { apply, createOperations } from '../index.js';
import { DispatchRunStore } from '../src/dispatch-store.js';
import { VerificationRunStore } from '../src/verification-store.js';

const TASK = {
  id: 'T1',
  title: 'Cancel probe',
  description: '',
  dependencies: [],
  expectedFiles: ['src/probe.js'],
  acceptanceCriteria: ['Cancel ends the run'],
  verificationCommands: ['echo probe'],
};

function hash(task) {
  return createHash('sha256').update(JSON.stringify(task), 'utf8').digest('hex');
}

async function setup(t, kill) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'engineering-cmd-cancel-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'workspace');
  const registered = {};
  const ctx = {
    workingDirectory: { ensure: async () => workspace },
    sandboxPolicy: { resolve: () => ({ workspaceRoot: workspace }) },
    jobs: {
      kill(id, caller, reason) {
        return kill(id, caller, reason);
      },
    },
    tools: { register: () => () => {} },
    skills: { register: () => () => {} },
    commands: { register: definition => { registered.command = definition; return () => {}; } },
    effect: fn => { fn(); },
  };
  apply(ctx);
  const operations = createOperations(ctx);
  const agent = { id: 'cancel-session', session: { id: 'cancel-session' } };
  const { change } = await operations({ action: 'create', title: 'Cancel probe', goal: 'Cancel' }, agent, 'user');
  const saved = await operations({ action: 'save', changeId: change.id, expectedRevision: change.revision, patch: { tasks: [TASK] } }, agent, 'user');
  return { root, ctx, registered, operations, agent, workspace, change: saved.change };
}

async function runningDispatch(workspace, change) {
  const store = new DispatchRunStore(workspace);
  const { run } = await store.reserve({
    changeId: change.id,
    taskId: 'T1',
    planVersion: change.planVersion,
    admittedRevision: change.revision,
    requestId: 'cancel-command-request-1',
    taskSnapshot: TASK,
    taskSnapshotHash: hash(TASK),
    hostInstanceId: 'host-fixture-cancel',
    ownerSessionId: 'cancel-session',
    childId: 'child-fixture-cancel',
  });
  const starting = await store.update(change.id, run.runId, 'host-fixture-cancel', {
    expectedRevision: run.revision,
    state: 'starting',
    jobId: 'bash-fixture-cancel-command',
  });
  return store.update(change.id, run.runId, 'host-fixture-cancel', {
    expectedRevision: starting.revision,
    state: 'running',
  });
}

test('the engineering command is the route that terminates a running dispatch', async t => {
  const kills = [];
  const { registered, workspace, change } = await setup(t, (id, caller, reason) => {
    kills.push({ id, caller, reason });
    return 'requested';
  });
  const run = await runningDispatch(workspace, change);
  const result = await registered.command.handler({
    agent: { id: 'cancel-session', session: { id: 'cancel-session' } },
    signal: new AbortController().signal,
    rawInput: JSON.stringify({ action: 'cancelRun', changeId: change.id, kind: 'dispatch', runId: run.runId, reason: 'Operator stopped the stale run' }),
  });
  assert.equal(result.kind, 'success');
  const payload = JSON.parse(result.text);
  assert.equal(payload.runId, run.runId);
  assert.equal(payload.jobId, 'bash-fixture-cancel-command');
  assert.equal(payload.kill, 'requested');
  assert.equal(payload.outcome, 'terminating');
  assert.equal(payload.sameHost, false);
  assert.deepEqual(kills, [{ id: 'bash-fixture-cancel-command', caller: 'cancel-session', reason: 'Operator stopped the stale run' }]);
  // The command never rewrites the run: the runner owns that settlement.
  assert.equal((await new DispatchRunStore(workspace).get(change.id, run.runId)).state, 'running');
});

test('a job handle missing from this process is reported as a gone executor', async t => {
  const { registered, workspace, change } = await setup(t, () => {
    throw Object.assign(new Error('Job not found'), { code: 'JOB_NOT_FOUND' });
  });
  const run = await runningDispatch(workspace, change);
  const result = await registered.command.handler({
    agent: { id: 'cancel-session', session: { id: 'cancel-session' } },
    signal: new AbortController().signal,
    rawInput: JSON.stringify({ action: 'cancelRun', changeId: change.id, kind: 'dispatch', runId: run.runId, reason: 'Registry restarted' }),
  });
  assert.equal(result.kind, 'error');
  assert.equal(result.text, 'ENGINEERING_RUN_EXECUTOR_GONE');
});

test('a job that already exited reports already-finished instead of terminating', async t => {
  const { registered, workspace, change } = await setup(t, () => 'already-finished');
  const run = await runningDispatch(workspace, change);
  const result = await registered.command.handler({
    agent: { id: 'cancel-session', session: { id: 'cancel-session' } },
    signal: new AbortController().signal,
    rawInput: JSON.stringify({ action: 'cancelRun', changeId: change.id, kind: 'dispatch', runId: run.runId, reason: 'Already done' }),
  });
  assert.equal(result.kind, 'success');
  assert.equal(JSON.parse(result.text).outcome, 'already-finished');
});

test('an unrecognized job failure keeps its own error instead of borrowing the gone-executor code', async t => {
  const { registered, workspace, change } = await setup(t, () => {
    throw Object.assign(new Error('Registry exploded'), { code: 'REGISTRY_BROKEN' });
  });
  const run = await runningDispatch(workspace, change);
  const result = await registered.command.handler({
    agent: { id: 'cancel-session', session: { id: 'cancel-session' } },
    signal: new AbortController().signal,
    rawInput: JSON.stringify({ action: 'cancelRun', changeId: change.id, kind: 'dispatch', runId: run.runId, reason: 'Try anyway' }),
  });
  assert.equal(result.kind, 'error');
  assert.equal(result.text, 'REGISTRY_BROKEN: Registry exploded');
});

test('a verification run uses its own store and owner when terminating', async t => {
  const kills = [];
  const { registered, workspace, change } = await setup(t, (id, caller, reason) => {
    kills.push({ id, caller, reason });
    return 'requested';
  });
  const store = new VerificationRunStore(workspace);
  const reserved = await store.reserve({
    changeId: change.id,
    taskId: 'T1',
    planVersion: change.planVersion,
    commandIndex: 0,
    command: 'echo probe',
    requestId: 'cancel-command-verify-1',
    hostInstanceId: 'host-fixture-cancel',
    ownerSessionId: 'verify-owner-session',
  });
  const starting = await store.update(change.id, reserved.runId, 'host-fixture-cancel', {
    expectedRevision: reserved.revision,
    state: 'starting',
    jobId: 'bash-fixture-cancel-verify',
  });
  await store.update(change.id, reserved.runId, 'host-fixture-cancel', {
    expectedRevision: starting.revision,
    state: 'running',
  });
  const result = await registered.command.handler({
    agent: { id: 'cancel-session', session: { id: 'cancel-session' } },
    signal: new AbortController().signal,
    rawInput: JSON.stringify({ action: 'cancelRun', changeId: change.id, kind: 'verification', runId: reserved.runId, reason: 'Stop verification' }),
  });
  assert.equal(result.kind, 'success');
  assert.equal(JSON.parse(result.text).kind, 'verification');
  assert.deepEqual(kills, [{ id: 'bash-fixture-cancel-verify', caller: 'verify-owner-session', reason: 'Stop verification' }]);
});

test('a run without a job handle cannot be terminated through the command', async t => {
  const { registered, workspace, change } = await setup(t, () => 'requested');
  const store = new DispatchRunStore(workspace);
  const { run } = await store.reserve({
    changeId: change.id,
    taskId: 'T1',
    planVersion: change.planVersion,
    admittedRevision: change.revision,
    requestId: 'cancel-command-request-2',
    taskSnapshot: TASK,
    taskSnapshotHash: hash(TASK),
    hostInstanceId: 'host-fixture-cancel',
    ownerSessionId: 'cancel-session',
    childId: 'child-fixture-cancel',
  });
  const result = await registered.command.handler({
    agent: { id: 'cancel-session', session: { id: 'cancel-session' } },
    signal: new AbortController().signal,
    rawInput: JSON.stringify({ action: 'cancelRun', changeId: change.id, kind: 'dispatch', runId: run.runId, reason: 'Nothing started' }),
  });
  assert.equal(result.kind, 'error');
  assert.equal(result.text, 'ENGINEERING_RUN_NOT_RUNNING');
});
