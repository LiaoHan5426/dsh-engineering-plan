import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { EngineeringStore } from '../src/core.js';
import { VerificationRunStore } from '../src/verification-store.js';

const USER = { kind: 'user', id: 'context-user' };
const AGENT = { kind: 'agent', id: 'context-agent' };

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'context-gate-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new EngineeringStore(root);
  const created = await store.execute({
    action: 'create',
    title: 'context gate',
    goal: 'verify context carries delivery blockers',
    mode: 'lite'
  }, AGENT);
  const changeId = created.change.id;
  await store.execute({
    action: 'save',
    changeId,
    expectedRevision: created.change.revision,
    patch: { tasks: [{ id: 'T1', title: 'task one', description: '', dependencies: [], expectedFiles: [], acceptanceCriteria: ['works'], verificationCommands: ['echo hi'] }] }
  }, AGENT);
  const approved = await store.execute({ action: 'approve', changeId, expectedRevision: 2 }, USER);
  return { root, store, changeId, approved };
}

test('context reports the gate verdict and blocker codes', async (t) => {
  const { store, changeId } = await fixture(t);
  const out = await store.execute({ action: 'context', changeId }, AGENT);
  assert.equal(out.gate.ready, false);
  assert.equal(out.gate.approved, true, 'the plan is approved, so approval must not be reported as a blocker');
  assert.equal(out.gate.deliveryAccepted, false);
  assert.deepEqual(out.gate.blockerCodes, ['TASK_NOT_TERMINAL', 'NO_COMPLETED_TASK']);
  assert.deepEqual(out.gate.activeRuns, []);
  assert.deepEqual(out.gate.unresolvedUnknownRuns, []);
});

test('context surfaces an active run as a blocker and in activeRuns', async (t) => {
  const { root, store, changeId, approved } = await fixture(t);
  const runs = new VerificationRunStore(root);
  const reserved = await runs.reserve({
    changeId,
    taskId: 'T1',
    planVersion: 1,
    commandIndex: 0,
    command: 'echo hi',
    requestId: 'context-active-1',
    hostInstanceId: 'host-context',
    ownerSessionId: 'session-context'
  });
  const runId = reserved.runId ?? reserved.run?.runId;
  const out = await store.execute({ action: 'context', changeId }, AGENT);
  assert.ok(out.gate.blockerCodes.includes('ACTIVE_RUN'));
  assert.equal(out.gate.activeRuns.length, 1);
  assert.equal(out.gate.activeRuns[0].state, 'reserved');
  assert.equal(out.gate.activeRuns[0].taskId, 'T1');
  assert.equal(out.gate.activeRuns[0].runId, runId);

  // context is a read: it must not move the revision, nor clear the run.
  const after = await store.execute({ action: 'get', changeId }, AGENT);
  assert.equal(after.change.revision, approved.change.revision);
  assert.equal((await runs.list(changeId)).length, 1);
});

test('context keeps the payload small: no run history, no per-blocker detail', async (t) => {
  const { store, changeId } = await fixture(t);
  const out = await store.execute({ action: 'context', changeId }, AGENT);
  assert.equal(Object.hasOwn(out.gate, 'runs'), false);
  assert.equal(Object.hasOwn(out.gate, 'blockers'), false);
  assert.ok(JSON.stringify(out.gate).length < 400);
});

test('context carries command totals for the current version but not the entries', async (t) => {
  const { root, store, changeId } = await fixture(t);
  const runs = new VerificationRunStore(root);
  const reserved = await runs.reserve({
    changeId,
    taskId: 'T1',
    planVersion: 1,
    commandIndex: 0,
    command: 'echo hi',
    requestId: 'context-command-totals',
    hostInstanceId: 'host-context',
    ownerSessionId: 'session-context'
  });
  const record = reserved.run ?? reserved;
  const started = await runs.update(changeId, record.runId, 'host-context', {
    expectedRevision: record.revision,
    state: 'starting',
    jobId: 'bash-context-1'
  });
  const running = await runs.update(changeId, record.runId, 'host-context', {
    expectedRevision: started.revision,
    state: 'running'
  });
  await runs.update(changeId, record.runId, 'host-context', {
    expectedRevision: running.revision,
    state: 'succeeded',
    exitCode: 0,
    signal: null,
    stdout: { text: 'hi\n', truncated: false },
    stderr: { text: '', truncated: false },
    timedOut: false,
    aborted: false
  });

  const out = await store.execute({ action: 'context', changeId }, AGENT);
  assert.deepEqual(out.gate.commands, { total: 1, succeeded: 1, failed: 0, unrun: 0 });
  assert.equal(JSON.stringify(out.gate.commands).includes(record.runId), false, 'context carries counts, not run entries');
  assert.equal('runs' in out.gate, false);
});
