import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { cancelRun } from '../index.js';
import { DispatchRunStore } from '../src/dispatch-store.js';
import { VerificationRunStore } from '../src/verification-store.js';
import { EngineeringStore } from '../src/core.js';

const CHANGE = '11111111-2222-4333-8444-555555555555';
const HOST = 'host-test';

function context(root, kills) {
  return {
    effect: (fn) => { fn(); return () => {}; },
    tools: { register: () => () => {} },
    skills: { register: () => () => {} },
    commands: { register: () => () => {} },
    workingDirectory: { ensure: async () => root },
    sandboxPolicy: { resolve: () => ({ workspaceRoot: root }) },
    shell: {}, shellEnv: {}, subagents: {}, jobs: {
      start: () => 'job-unused',
      kill: (id, caller, reason) => { kills.push({ id, caller, reason }); return 'requested'; },
    },
  };
}

const task = {
  id: 'T1', title: 'T1', description: 'd', dependencies: [], expectedFiles: [],
  acceptanceCriteria: ['c'], verificationCommands: ['echo ok'],
};

async function fixture(root, kind, hostInstanceId = HOST) {
  const store = new EngineeringStore(root);
  await store.execute({ action: 'create', changeId: CHANGE, title: 'cancel probe', goal: 'cancel probe', mode: 'lite' }, { kind: 'user', id: 'user-1' });
  const runs = kind === 'dispatch' ? new DispatchRunStore(root) : new VerificationRunStore(root);
  let run;
  if (kind === 'dispatch') {
    const hash = createHash('sha256').update(JSON.stringify(task), 'utf8').digest('hex');
    const created = await runs.reserve({
      changeId: CHANGE, taskId: 'T1', planVersion: 1, admittedRevision: 1, requestId: 'req-1',
      taskSnapshot: task, taskSnapshotHash: hash,
      hostInstanceId, ownerSessionId: 'session-1', childId: 'child-1',
    });
    run = created.run;
  } else {
    run = await runs.reserve({
      changeId: CHANGE, taskId: 'T1', planVersion: 1, requestId: 'req-1',
      hostInstanceId, ownerSessionId: 'session-1', commandIndex: 0, command: 'echo ok',
    });
  }
  const started = await runs.update(CHANGE, run.runId, hostInstanceId, { expectedRevision: run.revision, state: 'starting', jobId: `job-${kind}` });
  return { runs, run: started };
}

const request = (kind, runId, reason = '用户在界面终止') => ({ action: 'cancelRun', changeId: CHANGE, kind, runId, reason });

test('a starting run is cancelled through jobs.kill and left to the runner', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ep-cancel-'));
  try {
    const kills = [], ctx = context(root, kills);
    const { run } = await fixture(root, 'dispatch');
    const result = await cancelRun(ctx, { id: 'command-session' }, undefined, request('dispatch', run.runId), HOST);
    assert.equal(result.kill, 'requested');
    assert.equal(result.outcome, 'terminating');
    assert.equal(result.sameHost, true);
    assert.deepEqual(kills, [{ id: 'job-dispatch', caller: 'session-1', reason: '用户在界面终止' }]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('verification runs use their own store and job id', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ep-cancel-'));
  try {
    const kills = [], ctx = context(root, kills);
    const { run } = await fixture(root, 'verification');
    const result = await cancelRun(ctx, { id: 'session-1' }, undefined, request('verification', run.runId), HOST);
    assert.equal(result.jobId, 'job-verification');
    assert.equal(kills.length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a run from a previous apply is still killable, with sameHost reported false', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ep-cancel-'));
  try {
    const kills = [], ctx = context(root, kills);
    // jobs is process-level: a run created before a plugin reload still holds a
    // live handle, so hostInstanceId alone must not refuse the kill.
    const { run } = await fixture(root, 'verification', 'host-previous-apply');
    const result = await cancelRun(ctx, { id: 'command-session' }, undefined, request('verification', run.runId), HOST);
    assert.equal(result.kill, 'requested');
    assert.equal(result.sameHost, false);
    assert.equal(kills.length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a vanished executor reports EXECUTOR_GONE instead of pretending to stop', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ep-cancel-'));
  try {
    const kills = [], ctx = context(root, kills);
    ctx.jobs.kill = () => { throw Object.assign(new Error('job not found'), { code: 'JOB_NOT_FOUND' }); };
    const { run } = await fixture(root, 'verification');
    await assert.rejects(() => cancelRun(ctx, { id: 'command-session' }, undefined, request('verification', run.runId), HOST), /ENGINEERING_RUN_EXECUTOR_GONE/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('an executor that already exited is reported as already-finished', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ep-cancel-'));
  try {
    const kill = () => 'already-finished';
    const ctx = Object.assign(context(root, []), { jobs: { start: () => 'job-unused', kill } });
    const { run } = await fixture(root, 'dispatch');
    const result = await cancelRun(ctx, { id: 'command-session' }, undefined, request('dispatch', run.runId), HOST);
    assert.equal(result.outcome, 'already-finished');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('terminal runs and job-less reservations are refused with distinct codes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ep-cancel-'));
  try {
    const kills = [], ctx = context(root, kills);
    const { runs, run } = await fixture(root, 'dispatch');
    await assert.rejects(() => cancelRun(ctx, { id: 'session-1' }, undefined, request('dispatch', run.runId, '  '), HOST), /ENGINEERING_INVALID_INPUT/);
    await runs.update(CHANGE, run.runId, HOST, { expectedRevision: run.revision, state: 'cancelled', reason: 'done' });
    await assert.rejects(() => cancelRun(ctx, { id: 'session-1' }, undefined, request('dispatch', run.runId), HOST), /ENGINEERING_RUN_NOT_RUNNING/);
    assert.equal(kills.length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('extra fields and unknown kinds are rejected before touching the store', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ep-cancel-'));
  try {
    const kills = [], ctx = context(root, kills);
    await fixture(root, 'verification');
    await assert.rejects(() => cancelRun(ctx, { id: 'session-1' }, undefined, { ...request('verification', 'r'), extra: 1 }, HOST), /ENGINEERING_INVALID_INPUT/);
    await assert.rejects(() => cancelRun(ctx, { id: 'session-1' }, undefined, { ...request('verification', 'r'), kind: 'other' }, HOST), /ENGINEERING_INVALID_INPUT/);
    await assert.rejects(() => cancelRun(ctx, { id: 'session-1' }, undefined, { action: 'cancelRun', changeId: CHANGE, kind: 'verification', runId: 'r' }, HOST), /ENGINEERING_INVALID_INPUT/);
    assert.equal(kills.length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});
