import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { EngineeringStore } from '../src/core.js';
import { DispatchRunStore } from '../src/dispatch-store.js';

const USER = { kind: 'user', id: 'ready-tasks' };
const task = (id, files, dependencies = []) => ({
  id, title: id, description: '', dependencies, expectedFiles: files,
  acceptanceCriteria: ['ok'], verificationCommands: ['echo ok'],
});

async function setup(t, tasks, { approve = true } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'engineering-ready-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new EngineeringStore(root);
  const created = (await store.execute({ action: 'create', title: 'Ready', goal: 'Prove the frontier', mode: 'lite' }, USER)).change;
  const saved = await store.execute({ action: 'save', changeId: created.id, expectedRevision: created.revision, patch: { tasks } }, USER);
  let change = saved.change;
  if (approve) change = (await store.execute({ action: 'approve', changeId: created.id, expectedRevision: change.revision, planVersion: change.planVersion }, USER)).change;
  return { root, store, change: () => change, id: created.id, reload: async () => (await store.execute({ action: 'get', changeId: created.id }, USER)).change };
}

test('an approved plan with no dependencies and no running work has a full frontier', async (t) => {
  const f = await setup(t, [task('A', ['src/a.js']), task('B', ['src/b.js'])]);
  const result = await f.store.execute({ action: 'readyTasks', changeId: f.id }, USER);
  assert.deepEqual(result.ready, ['A', 'B']);
  assert.equal(result.approved, true);
  assert.deepEqual(result.tasks.map(item => item.dispatchable), [true, true]);
});

test('an unapproved plan blocks every task with the same reason the engine would give', async (t) => {
  const f = await setup(t, [task('A', ['src/a.js'])], { approve: false });
  const result = await f.store.execute({ action: 'readyTasks', changeId: f.id }, USER);
  assert.deepEqual(result.ready, []);
  assert.deepEqual(result.tasks[0].reasons.map(item => item.code), ['APPROVAL_REQUIRED']);
});

test('dependencies gate the frontier and name the missing tasks', async (t) => {
  const f = await setup(t, [task('A', ['src/a.js']), task('B', ['src/b.js'], ['A'])]);
  let result = await f.store.execute({ action: 'readyTasks', changeId: f.id }, USER);
  assert.deepEqual(result.ready, ['A']);
  assert.deepEqual(result.tasks[1].reasons, [{ code: 'DEPENDENCY_BLOCKED', detail: 'A' }]);
  await f.store.execute({ action: 'transition', changeId: f.id, taskId: 'A', status: 'running', expectedRevision: result.revision }, USER);
  result = await f.store.execute({ action: 'readyTasks', changeId: f.id }, USER);
  // A is running, so it is no longer pending; B still waits because A is not completed.
  assert.deepEqual(result.tasks[0].reasons.map(item => item.code), ['TASK_NOT_PENDING']);
  assert.deepEqual(result.tasks[1].reasons, [{ code: 'DEPENDENCY_BLOCKED', detail: 'A' }]);
});

test('overlapping declared files remove a task from the frontier with a located reason', async (t) => {
  const f = await setup(t, [task('DOCS', ['docs/']), task('PAGE', ['docs/a.md'])]);
  const first = await f.store.execute({ action: 'readyTasks', changeId: f.id }, USER);
  assert.deepEqual(first.ready, ['DOCS', 'PAGE']);
  const running = await f.store.execute({ action: 'transition', changeId: f.id, taskId: 'DOCS', status: 'running', expectedRevision: first.revision }, USER);
  const result = await f.store.execute({ action: 'readyTasks', changeId: f.id }, USER);
  assert.deepEqual(result.ready, []);
  const page = result.tasks.find(item => item.id === 'PAGE');
  assert.deepEqual(page.reasons.map(item => item.code), ['FILE_CONFLICT']);
  assert.match(page.reasons[0].detail, /docs\/a\.md overlaps DOCS docs\//);
  assert.ok(running.change.tasks.find(item => item.id === 'DOCS').status === 'running');
});

test('an in-flight dispatch run marks its task as active even while the task is still pending', async (t) => {
  const f = await setup(t, [task('A', ['src/a.js'])]);
  const change = await f.reload();
  const store = new DispatchRunStore(f.root);
  const taskSnapshot = {
    id: 'A', title: 'A', description: '', dependencies: [], expectedFiles: ['src/a.js'],
    acceptanceCriteria: ['ok'], verificationCommands: ['echo ok'],
  };
  const record = {
    changeId: f.id, taskId: 'A', planVersion: change.planVersion, admittedRevision: change.revision,
    requestId: 'ready-probe', taskSnapshot,
    taskSnapshotHash: createHash('sha256').update(JSON.stringify(taskSnapshot), 'utf8').digest('hex'),
    hostInstanceId: 'host-a', ownerSessionId: 'session-a', childId: randomUUID(),
  };
  const stuck = await store.reserve(record);
  const result = await f.store.execute({ action: 'readyTasks', changeId: f.id }, USER);
  const item = result.tasks.find(entry => entry.id === 'A');
  assert.equal(item.dispatchable, false);
  assert.deepEqual(item.reasons.map(reason => reason.code), ['ACTIVE_RUN']);
  assert.match(item.reasons[0].detail, /dispatch/);
  assert.equal(result.ready.length, 0);
  assert.ok(stuck.run || stuck.created !== undefined);
});

test('the action is read-only and rejects extra fields', async (t) => {
  const f = await setup(t, [task('A', ['src/a.js'])]);
  const before = await f.reload();
  const result = await f.store.execute({ action: 'readyTasks', changeId: f.id }, USER);
  const after = await f.reload();
  assert.deepEqual(before, after);
  assert.equal(result.revision, before.revision);
  await assert.rejects(
    () => f.store.execute({ action: 'readyTasks', changeId: f.id, expectedRevision: before.revision }, USER),
    /Invalid action fields/,
  );
});

test('an unresolved unknown run keeps its task out of the frontier and names the run', async (t) => {
  const f = await setup(t, [task('A', ['src/a.js'])]);
  const change = await f.reload();
  const store = new DispatchRunStore(f.root);
  const taskSnapshot = {
    id: 'A', title: 'A', description: '', dependencies: [], expectedFiles: ['src/a.js'],
    acceptanceCriteria: ['ok'], verificationCommands: ['echo ok'],
  };
  const reserved = await store.reserve({
    changeId: f.id, taskId: 'A', planVersion: change.planVersion, admittedRevision: change.revision,
    requestId: 'ready-unknown', taskSnapshot,
    taskSnapshotHash: createHash('sha256').update(JSON.stringify(taskSnapshot), 'utf8').digest('hex'),
    hostInstanceId: 'host-a', ownerSessionId: 'session-a', childId: randomUUID(),
  });
  const starting = await store.update(f.id, reserved.run.runId, 'host-a', { expectedRevision: reserved.run.revision, state: 'starting', jobId: 'bash-ready-unknown' });
  await store.update(f.id, reserved.run.runId, 'host-a', { expectedRevision: starting.revision, state: 'unknown', error: 'cleanup unconfirmed' });

  const blocked = (await f.store.execute({ action: 'readyTasks', changeId: f.id }, USER)).tasks.find(item => item.id === 'A');
  assert.equal(blocked.dispatchable, false);
  assert.deepEqual(blocked.reasons.map(reason => reason.code), ['UNRESOLVED_UNKNOWN']);
  assert.match(blocked.reasons[0].detail, /dispatch/);

  // A human closure removes the reason without touching the task status.
  const current = await f.reload();
  const run = await store.get(f.id, reserved.run.runId);
  await f.store.execute({
    action: 'resolveDispatchUnknown', changeId: f.id, expectedRevision: current.revision,
    runId: run.runId, expectedRunRevision: run.revision, reason: 'child confirmed stopped',
    terminationEvidence: { confirmed: true, checkedAt: new Date().toISOString(), scope: 'child-and-descendants-and-processes', basis: 'ps showed no child', references: [] },
  }, USER);
  const freed = (await f.store.execute({ action: 'readyTasks', changeId: f.id }, USER)).tasks.find(item => item.id === 'A');
  assert.deepEqual(freed.reasons, []);
  assert.equal(freed.dispatchable, true);
});
