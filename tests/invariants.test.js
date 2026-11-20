import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { EngineeringStore } from '../src/core.js';

/**
 * Property-style check: drive the store with a seeded random operation stream and assert the
 * invariants after every step. Unit tests cover the paths I thought of; this covers combinations
 * of them, which is where state machines usually rot.
 */

const USER = { kind: 'user', id: 'invariant-user' };
const AGENT = { kind: 'agent', id: 'invariant-agent' };

function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const TASKS = [
  { id: 'T1', title: 'first', description: '', dependencies: [], expectedFiles: ['src/a.js'], acceptanceCriteria: ['a works'], verificationCommands: ['echo a'] },
  { id: 'T2', title: 'second', description: '', dependencies: ['T1'], expectedFiles: ['src/b.js'], acceptanceCriteria: ['b works'], verificationCommands: ['echo b'] },
  { id: 'T3', title: 'third', description: '', dependencies: [], expectedFiles: [], acceptanceCriteria: ['c works'], verificationCommands: [] },
];

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'ep-invariants-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new EngineeringStore(root);
  const created = await store.execute({
    action: 'create', title: 'invariants', goal: 'random operation stream keeps state coherent', mode: 'standard',
  }, AGENT);
  await store.execute({
    action: 'save', changeId: created.change.id, expectedRevision: created.change.revision,
    patch: { tasks: TASKS },
  }, AGENT);
  return { root, store, changeId: created.change.id };
}

async function stateOf(root, changeId) {
  const raw = await readFile(join(root, '.dsh/engineering/changes', changeId, 'state.json'), 'utf8');
  return JSON.parse(raw);
}

function derivedStatus(state) {
  const approved = state.approvals?.some(item => item.planVersion === state.planVersion && item.actor?.kind === 'user');
  if (!approved) return 'draft';
  if (state.tasks.length && state.tasks.every(task => task.status === 'completed' || task.status === 'cancelled')) return 'completed';
  return state.startedAt || state.tasks.some(task => task.status !== 'pending') ? 'running' : 'approved';
}

function assertInvariants(state, label) {
  assert.equal(state.status, derivedStatus(state), `${label}: status must follow from approvals and task states`);
  for (const task of state.tasks) {
    if (task.status !== 'completed') continue;
    for (const criterion of task.acceptanceCriteria) {
      const current = list => list.filter(entry => entry.taskId === task.id && entry.criterion === criterion && entry.planVersion === state.planVersion).at(-1);
      assert.equal(current(task.evidence)?.outcome, 'passed', `${label}: ${task.id} completed without current passed evidence in the task view`);
      assert.equal(current(state.evidence)?.outcome, 'passed', `${label}: ${task.id} completed without current passed evidence in the change view`);
    }
  }
  const ids = new Set(state.evidence.map(entry => entry.id));
  for (const task of state.tasks) {
    for (const entry of task.evidence) assert.ok(ids.has(entry.id), `${label}: task evidence ${entry.id} missing from the change view`);
  }
  assert.ok(state.revision >= 1, `${label}: revision must stay positive`);
}

const OPS = [
  async (store, change) => store.execute({
    action: 'save', changeId: change.id, expectedRevision: change.revision,
    patch: { title: `t${change.revision}`, documents: { proposal: `revision ${change.revision}` } },
  }, AGENT),
  async (store, change, r) => {
    const task = change.tasks[Math.floor(r() * change.tasks.length)];
    const next = { pending: 'running', running: 'verifying', verifying: 'completed', blocked: 'pending', failed: 'pending', cancelled: 'pending', completed: 'pending' }[task.status];
    return store.execute({
      action: 'transition', changeId: change.id, expectedRevision: change.revision,
      taskId: task.id, status: next, reason: next === 'blocked' ? 'blocked by the harness' : undefined,
    }, AGENT);
  },
  async (store, change, r) => {
    const task = change.tasks[Math.floor(r() * change.tasks.length)];
    const criterion = task.acceptanceCriteria[0] ?? 'no criteria';
    return store.execute({
      action: 'evidence', changeId: change.id, expectedRevision: change.revision,
      taskId: task.id, criterion, outcome: r() > 0.3 ? 'passed' : 'failed', note: 'recorded by the invariant driver',
    }, AGENT);
  },
  async (store, change) => store.execute({ action: 'approve', changeId: change.id, expectedRevision: change.revision }, USER),
  async (store, change) => store.execute({ action: 'replan', changeId: change.id, expectedRevision: change.revision }, USER),
  async (store, change) => store.execute({ action: 'export', changeId: change.id, expectedRevision: change.revision }, USER),
  async (store, change) => store.execute({ action: 'gateStatus', changeId: change.id }, AGENT),
];

const KNOWN = new Set([
  'INVALID_TRANSITION', 'REVISION_CONFLICT', 'PLAN_LOCKED', 'DEPENDENCY_BLOCKED', 'FILE_CONFLICT',
  'EVIDENCE_REQUIRED', 'INVALID_STATE', 'APPROVAL_REQUIRED', 'DELIVERY_LOCKED', 'FORBIDDEN',
  'INVALID_INPUT', 'EVIDENCE_EMPTY', 'VERIFICATION_RUN_BLOCKED', 'DISPATCH_RUN_BLOCKED',
  'INCOMPLETE_PLAN', 'NOT_FOUND', 'INVALID_ID',
]);

test('a random operation stream never leaves the state incoherent', async (t) => {
  const { root, store, changeId } = await setup(t);
  const random = rng(20261120);

  const seen = { approve: 0, transition: 0, evidence: 0, export: 0, completed: 0, rejected: new Set() };
  for (let step = 0; step < 60; step += 1) {
    const before = await stateOf(root, changeId);
    const index = Math.floor(random() * OPS.length);
    let outcome;
    try {
      outcome = await OPS[index](store, before, random);
    } catch (error) {
      assert.ok(KNOWN.has(error.code), `step ${step}: unexpected error code ${error.code} (${error.message})`);
      seen.rejected.add(error.code);
      const after = await stateOf(root, changeId);
      assert.equal(after.revision, before.revision, `step ${step}: a rejected operation must not move the revision`);
      assertInvariants(after, `step ${step} (rejected)`);
      continue;
    }

    const after = await stateOf(root, changeId);
    if (index === 5) {
      assert.equal(after.revision, before.revision, `step ${step}: export must not move the revision`);
    } else if (index !== 6) {
      assert.ok(after.revision === before.revision + 1 || after.revision === before.revision,
        `step ${step}: revision moved by ${after.revision - before.revision}`);
    }
    if (outcome?.change) assert.ok(Array.isArray(outcome.change.tasks));
    if (index === 3) seen.approve += 1;
    if (index === 5) seen.export += 1;
    if (index === 1) seen.transition += 1;
    if (index === 2) seen.evidence += 1;
    if (after.tasks.some(task => task.status === 'completed')) seen.completed += 1;
    assertInvariants(after, `step ${step}`);
  }

  assert.ok(seen.approve > 0, 'the stream must approve at least once');
  assert.ok(seen.transition > 0, 'the stream must move at least one task');
  assert.ok(seen.evidence > 0, 'the stream must record at least one piece of evidence');
  assert.ok(seen.export > 0, 'the stream must export at least once');
  assert.ok(seen.rejected.size > 0, 'the stream must hit at least one legitimate refusal');
  assert.ok(seen.completed > 0, 'the stream must reach a completed task, otherwise the completion gate is never exercised');
});
