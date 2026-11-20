import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { EngineeringStore } from '../src/core.js';

const USER = { kind: 'user', id: 'reviewer' };

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'evidence-states-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new EngineeringStore(root);
  const created = await store.execute({
    action: 'create',
    title: 'Evidence after failure',
    goal: 'Record why a task failed without going back through verifying.',
    mode: 'lite',
  }, USER);
  const changeId = created.change.id;
  const saved = await store.execute({
    action: 'save',
    changeId,
    expectedRevision: created.change.revision,
    patch: {
      tasks: [{
        id: 'T1',
        title: 'Only task',
        description: '',
        dependencies: [],
        expectedFiles: [],
        acceptanceCriteria: ['the command exits zero'],
        verificationCommands: ['echo ok'],
      }],
    },
  }, USER);
  const approved = await store.execute({
    action: 'approve',
    changeId,
    expectedRevision: saved.change.revision,
  }, USER);
  return { store, changeId, revision: approved.change.revision };
}

async function moveTo(store, changeId, revision, status) {
  const result = await store.execute({
    action: 'transition',
    changeId,
    expectedRevision: revision,
    taskId: 'T1',
    status,
    ...(status === 'blocked' ? { reason: 'missing tool' } : {}),
  }, USER);
  return result.change.revision;
}

test('a failed task accepts post-mortem failure evidence', async (t) => {
  const { store, changeId, revision } = await fixture(t);
  let rev = await moveTo(store, changeId, revision, 'running');
  rev = await moveTo(store, changeId, rev, 'verifying');
  rev = await moveTo(store, changeId, rev, 'failed');

  const recorded = await store.execute({
    action: 'evidence',
    changeId,
    expectedRevision: rev,
    taskId: 'T1',
    criterion: 'the command exits zero',
    outcome: 'failed',
    note: 'PowerShell has no printf; exitCode 1',
    artifact: 'run f9d8b388',
  }, USER);

  const evidence = recorded.change.tasks[0].evidence;
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].outcome, 'failed');
  assert.equal(evidence[0].planVersion, 1);
  assert.equal(recorded.change.evidence.length, 1, 'the flat list must receive it too');
  assert.equal(recorded.change.tasks[0].status, 'failed', 'recording evidence must not move the task');
});

test('a blocked task accepts post-mortem failure evidence', async (t) => {
  const { store, changeId, revision } = await fixture(t);
  const rev = await moveTo(store, changeId, revision, 'blocked');

  const recorded = await store.execute({
    action: 'evidence',
    changeId,
    expectedRevision: rev,
    taskId: 'T1',
    criterion: 'the command exits zero',
    outcome: 'failed',
    note: 'blocked on a missing tool',
  }, USER);
  assert.equal(recorded.change.tasks[0].evidence.length, 1);
});

test('a failed task refuses passed evidence', async (t) => {
  const { store, changeId, revision } = await fixture(t);
  let rev = await moveTo(store, changeId, revision, 'running');
  rev = await moveTo(store, changeId, rev, 'verifying');
  rev = await moveTo(store, changeId, rev, 'failed');

  await assert.rejects(
    store.execute({
      action: 'evidence',
      changeId,
      expectedRevision: rev,
      taskId: 'T1',
      criterion: 'the command exits zero',
      outcome: 'passed',
      note: 'looks fine to me',
    }, USER),
    (error) => error.code === 'INVALID_STATE',
  );
});

test('pending and running tasks still refuse evidence', async (t) => {
  const { store, changeId, revision } = await fixture(t);
  await assert.rejects(
    store.execute({
      action: 'evidence',
      changeId,
      expectedRevision: revision,
      taskId: 'T1',
      criterion: 'the command exits zero',
      outcome: 'failed',
      note: 'too early',
    }, USER),
    (error) => error.code === 'INVALID_STATE',
  );

  const rev = await moveTo(store, changeId, revision, 'running');
  await assert.rejects(
    store.execute({
      action: 'evidence',
      changeId,
      expectedRevision: rev,
      taskId: 'T1',
      criterion: 'the command exits zero',
      outcome: 'failed',
      note: 'still too early',
    }, USER),
    (error) => error.code === 'INVALID_STATE',
  );
});

test('post-mortem evidence does not satisfy the completion gate', async (t) => {
  const { store, changeId, revision } = await fixture(t);
  let rev = await moveTo(store, changeId, revision, 'running');
  rev = await moveTo(store, changeId, rev, 'verifying');
  rev = await moveTo(store, changeId, rev, 'failed');
  const recorded = await store.execute({
    action: 'evidence',
    changeId,
    expectedRevision: rev,
    taskId: 'T1',
    criterion: 'the command exits zero',
    outcome: 'failed',
    note: 'exitCode 1',
  }, USER);
  rev = recorded.change.revision;

  await assert.rejects(
    store.execute({
      action: 'transition',
      changeId,
      expectedRevision: rev,
      taskId: 'T1',
      status: 'completed',
    }, USER),
    (error) => error.code === 'INVALID_TRANSITION',
    'failed cannot go straight to completed',
  );
});
