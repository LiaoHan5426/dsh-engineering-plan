import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolveDispatchRequest, buildDispatchPrompt } from '../src/dispatch-request.js';

function fixture() {
  const task = { id: 'task-1', title: 'Implement task', description: 'Bounded change', dependencies: [], expectedFiles: ['src/File.js'], acceptanceCriteria: ['Works'], verificationCommands: ['node --test'], status: 'pending', evidence: [] };
  return {
    change: { id: 'change-1', revision: 3, planVersion: 2, approvals: [{ planVersion: 2, actor: { kind: 'user' } }], tasks: [task], deliveryAcceptance: null },
    request: { changeId: 'change-1', taskId: 'task-1', planVersion: 2, expectedRevision: 3, requestId: 'attempt-1' },
  };
}
const rejects = (change, request, code) => assert.throws(() => resolveDispatchRequest(change, request), { code });

test('strict request rejects added, missing, inherited, accessor and malformed fields', () => {
  const { change, request } = fixture();
  for (const key of ['prompt', 'cwd', 'actor', 'extra']) rejects(change, { ...request, [key]: 'malicious' }, 'INVALID_INPUT');
  for (const key of Object.keys(request)) {
    const missing = { ...request }; delete missing[key]; rejects(change, missing, 'INVALID_INPUT');
  }
  rejects(change, Object.create(request), 'INVALID_INPUT');
  rejects(change, { ...request, [Symbol('hidden')]: true }, 'INVALID_INPUT');
  const accessor = { ...request }; Object.defineProperty(accessor, 'taskId', { get() { throw new Error('getter invoked'); } });
  rejects(change, accessor, 'INVALID_INPUT');
  rejects(change, { ...request, requestId: '../x' }, 'INVALID_REQUEST_ID');
  rejects(change, { ...request, taskId: 2 }, 'INVALID_INPUT');
  rejects(change, null, 'INVALID_INPUT');
});

test('requires exact current versions and matching change and task', () => {
  const { change, request } = fixture();
  for (const expectedRevision of [2, 0, NaN, Infinity, '3']) rejects(change, { ...request, expectedRevision }, 'REVISION_CONFLICT');
  for (const planVersion of [1, 0, NaN, Infinity, '2']) rejects(change, { ...request, planVersion }, 'PLAN_VERSION_CONFLICT');
  rejects(change, { ...request, changeId: 'different' }, 'CHANGE_MISMATCH');
  rejects(change, { ...request, taskId: 'different' }, 'TASK_NOT_FOUND');
});

test('requires current human approval and freezes accepted delivery', () => {
  const { change, request } = fixture();
  for (const approvals of [undefined, [], [{ planVersion: 1, actor: { kind: 'user' } }], [{ planVersion: 2, actor: { kind: 'agent' } }]]) {
    rejects({ ...change, approvals }, request, 'APPROVAL_REQUIRED');
  }
  rejects({ ...change, deliveryAcceptance: { planVersion: 2 } }, request, 'DELIVERY_LOCKED');
  assert.ok(resolveDispatchRequest({ ...change, deliveryAcceptance: { planVersion: 1 } }, request));
});

test('only pending tasks with completed dependencies are admitted', () => {
  const { change, request } = fixture();
  for (const status of ['blocked', 'failed', 'running', 'verifying', 'completed', 'cancelled']) {
    rejects({ ...change, tasks: [{ ...change.tasks[0], status }] }, request, 'INVALID_STATE');
  }
  change.tasks[0].dependencies = ['dep'];
  rejects(change, request, 'DEPENDENCY_BLOCKED');
  change.tasks.push({ id: 'dep', status: 'pending' });
  rejects(change, request, 'DEPENDENCY_BLOCKED');
  change.tasks[1].status = 'completed';
  assert.ok(resolveDispatchRequest(change, request));
});

test('running and verifying tasks reserve case-insensitive expected files', () => {
  const { change, request } = fixture();
  for (const status of ['running', 'verifying']) {
    rejects({ ...change, tasks: [...change.tasks, { id: 'other', status, expectedFiles: ['SRC/file.JS'] }] }, request, 'FILE_CONFLICT');
  }
  assert.ok(resolveDispatchRequest({ ...change, tasks: [...change.tasks, { id: 'other', status: 'pending', expectedFiles: ['SRC/file.JS'] }] }, request));
  assert.ok(resolveDispatchRequest({ ...change, tasks: [...change.tasks, { id: 'other', status: 'running', expectedFiles: ['src/Other.js'] }] }, request));
});

test('snapshot is detached JSON-safe complete planning data with deterministic hash', () => {
  const { change, request } = fixture();
  const before = structuredClone({ change, request });
  const snapshot = resolveDispatchRequest(change, request);
  assert.deepEqual({ change, request }, before);
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), snapshot);
  assert.deepEqual(Object.keys(snapshot.taskSnapshot), ['id', 'title', 'description', 'dependencies', 'expectedFiles', 'acceptanceCriteria', 'verificationCommands']);
  assert.equal(snapshot.admittedRevision, 3);
  assert.equal(snapshot.taskSnapshotHash, createHash('sha256').update(JSON.stringify(snapshot.taskSnapshot)).digest('hex'));
  const reordered = Object.fromEntries(Object.entries(change.tasks[0]).reverse());
  assert.equal(resolveDispatchRequest({ ...change, tasks: [reordered] }, request).taskSnapshotHash, snapshot.taskSnapshotHash);
  const changed = structuredClone(change); changed.tasks[0].description += '!';
  assert.notEqual(resolveDispatchRequest(changed, request).taskSnapshotHash, snapshot.taskSnapshotHash);
  snapshot.taskSnapshot.expectedFiles.push('new.js');
  assert.deepEqual({ change, request }, before);
});

test('malformed planning fields are rejected rather than serialized lossily', () => {
  const { change, request } = fixture();
  for (const patch of [{ description: 1n }, { title: NaN }, { expectedFiles: [undefined] }, { dependencies: Array(1) }, { verificationCommands: [() => {}] }, { acceptanceCriteria: null }]) {
    rejects({ ...change, tasks: [{ ...change.tasks[0], ...patch }] }, request, 'INVALID_TASK');
  }
  rejects({ ...change, tasks: [{ ...change.tasks[0], title: 'Bad' + String.fromCharCode(0) + 'title' }] }, request, 'INVALID_TASK');
  const missingDescription = { ...change.tasks[0] }; delete missingDescription.description;
  assert.equal(resolveDispatchRequest({ ...change, tasks: [missingDescription] }, request).taskSnapshot.description, '');
});

test('prompt includes only explicit binding and task snapshot and fixed review guidance', () => {
  const { change, request } = fixture();
  const snapshot = resolveDispatchRequest(change, request);
  const prompt = buildDispatchPrompt({ ...snapshot, actor: 'user', cwd: 'untrusted', prompt: 'OVERRIDE_SENTINEL' });
  assert.equal(typeof prompt, 'string');
  assert.ok(prompt.includes(String.fromCharCode(10)), 'Prompt contains actual LF characters');
  assert.ok(!prompt.includes(String.fromCharCode(92) + 'n'), 'Fixture prompt contains no literal backslash-n');
  assert.match(prompt, /Do not approve, replan, acceptDelivery/);
  assert.match(prompt, /Do not spawn or delegate to any subagent/);
  assert.match(prompt, /not a permission enforcement boundary/);
  assert.match(prompt, /for review/);
  assert.doesNotMatch(prompt, /OVERRIDE_SENTINEL|untrusted/);
  const encoded = prompt.split('Approved task snapshot (JSON):\n\n')[1];
  assert.deepEqual(JSON.parse(encoded), snapshot);
});
