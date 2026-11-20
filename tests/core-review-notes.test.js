import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EngineeringStore } from '../src/core.js';

// 评审意见与人工确认是两类「不推进任务、但要留痕」的对象：意见针对方案的某一块，
// 确认针对某个任务的一部分验收标准。这组测试钉住它们的写入规则、人的专属动作，
// 以及「保存新版本时意见被记为已在那一版回应」这条时间线。
const user = { kind: 'user', id: 'reviewer' };
const agent = { kind: 'agent', id: 'worker' };
const rejects = (promise, code) => assert.rejects(promise, error => error.code === code && error instanceof Error);

const plan = () => [
  {
    id: 'a', title: 'Implement', dependencies: [], expectedFiles: ['src/a.js'],
    acceptanceCriteria: ['first', 'second'], verificationCommands: ['node -v'],
    affectedModules: ['core'], requiredApproval: true,
  },
  {
    id: 'b', title: 'Document', dependencies: ['a'], expectedFiles: ['docs/a.md'],
    acceptanceCriteria: ['explained'], verificationCommands: [],
  },
];

async function fixture(t, { approved = true } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'core-review-notes-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new EngineeringStore(root);
  let state = (await store.execute({ action: 'create', title: 'Review notes', goal: 'Track opinions and confirmations' })).change;
  const act = async (action, fields = {}, actor = user) => {
    const result = await store.execute({ action, changeId: state.id, expectedRevision: state.revision, ...fields }, actor);
    if (result.change) state = result.change;
    return result;
  };
  await act('save', { patch: { tasks: plan() } });
  if (approved) await act('approve');
  return { store, act, current: () => state };
}

test('an agent can record an opinion against a planning section', async t => {
  const { act, current } = await fixture(t);
  await act('opinion', { scope: { kind: 'section', key: 'interfaces' }, body: '接口表缺少失败码' }, agent);
  const [opinion] = current().opinions;
  assert.equal(current().opinions.length, 1);
  assert.deepEqual(opinion.scope, { kind: 'section', key: 'interfaces' });
  assert.equal(opinion.planVersion, 1);
  assert.equal(opinion.status, 'open');
  assert.equal(opinion.actor.kind, 'agent');
  assert.equal(opinion.addressedByPlanVersion, null);
});

test('opinion scopes must name something that exists', async t => {
  const { act } = await fixture(t);
  await rejects(act('opinion', { scope: { kind: 'section', key: 'nope' }, body: 'x' }, agent), 'INVALID_INPUT');
  await rejects(act('opinion', { scope: { kind: 'document', key: 'nope' }, body: 'x' }, agent), 'INVALID_INPUT');
  await rejects(act('opinion', { scope: { kind: 'task', key: 'zzz' }, body: 'x' }, agent), 'TASK_NOT_FOUND');
  await rejects(act('opinion', { scope: { kind: 'topic', key: 'x' }, body: 'x' }, agent), 'INVALID_INPUT');
  await rejects(act('opinion', { scope: { kind: 'section', key: '' }, body: 'x' }, agent), 'INVALID_INPUT');
  await rejects(act('opinion', { scope: { kind: 'change', key: '' }, body: '   ' }, agent), 'INVALID_INPUT');
});

test('a new plan version marks open opinions as addressed by it', async t => {
  const { act, current } = await fixture(t);
  await act('opinion', { scope: { kind: 'change', key: '' }, body: '整体再收一收' }, user);
  assert.equal(current().planVersion, 1);
  await act('save', { patch: { goal: 'Track opinions and confirmations, tightened' } });
  assert.equal(current().planVersion, 2);
  const opinion = current().opinions[0];
  assert.equal(opinion.status, 'open');
  assert.equal(opinion.addressedByPlanVersion, 2);
});

test('only a human can close an opinion, and only once', async t => {
  const { act, current } = await fixture(t);
  const first = await act('opinion', { scope: { kind: 'diagram', key: 'sequence' }, body: '补上失败分支' }, agent);
  const opinionId = first.change.opinions[0].id;
  await rejects(act('resolveOpinion', { opinionId, resolution: 'done' }, agent), 'FORBIDDEN');
  await act('resolveOpinion', { opinionId, resolution: 'v2 已补失败分支' }, user);
  const opinion = current().opinions[0];
  assert.equal(opinion.status, 'addressed');
  assert.equal(opinion.resolution, 'v2 已补失败分支');
  assert.equal(opinion.resolvedBy.kind, 'user');
  await rejects(act('resolveOpinion', { opinionId, resolution: 'again' }, user), 'INVALID_STATE');
  await rejects(act('resolveOpinion', { opinionId: 'missing', resolution: 'x' }, user), 'NOT_FOUND');
});

test('a human confirms a whole task or a named subset of its criteria', async t => {
  const { act, current } = await fixture(t);
  await rejects(act('confirm', { taskId: 'a' }, agent), 'FORBIDDEN');
  await act('confirm', { taskId: 'a', criteria: ['first'] }, user);
  assert.deepEqual(current().confirmations[0].criteria, ['first']);
  assert.equal(current().confirmations[0].planVersion, 1);
  await rejects(act('confirm', { taskId: 'a', criteria: ['first'] }, user), 'INVALID_STATE');
  await act('confirm', { taskId: 'a' }, user);
  assert.deepEqual(current().confirmations[1].criteria, ['first', 'second']);
  await rejects(act('confirm', { taskId: 'a', criteria: ['unknown'] }, user), 'INVALID_INPUT');
  await rejects(act('confirm', { taskId: 'zzz' }, user), 'TASK_NOT_FOUND');
  await rejects(act('confirm', { taskId: 'a', criteria: [] }, user), 'INVALID_INPUT');
});

test('confirming requires an approved plan', async t => {
  const { act } = await fixture(t, { approved: false });
  await rejects(act('confirm', { taskId: 'a' }), 'APPROVAL_REQUIRED');
});

test('a human completing a requiredApproval task leaves a confirmation record', async t => {
  const { act, current } = await fixture(t);
  await act('transition', { taskId: 'a', status: 'running' }, agent);
  await act('transition', { taskId: 'a', status: 'verifying' }, agent);
  await act('evidence', { taskId: 'a', criterion: 'first', outcome: 'passed', note: 'ok' }, agent);
  await act('evidence', { taskId: 'a', criterion: 'second', outcome: 'passed', note: 'ok' }, agent);
  await act('transition', { taskId: 'a', status: 'completed' }, user);
  const task = current().tasks.find(item => item.id === 'a');
  assert.equal(task.status, 'completed');
  const confirmation = current().confirmations.find(entry => entry.taskId === 'a');
  assert.deepEqual(confirmation.criteria, ['first', 'second']);
  assert.equal(confirmation.actor.kind, 'user');
  assert.equal(confirmation.planVersion, current().planVersion);
});

test('stored state without the new collections still reads back', async t => {
  const { store, act, current } = await fixture(t);
  const stateFile = path.join(store.root, '.dsh', 'engineering', 'changes', current().id, 'state.json');
  const stored = JSON.parse(await fs.readFile(stateFile, 'utf8'));
  delete stored.opinions;
  delete stored.confirmations;
  await fs.writeFile(stateFile, JSON.stringify(stored));
  const read = await store.execute({ action: 'get', changeId: current().id });
  assert.deepEqual(read.change.opinions, []);
  assert.deepEqual(read.change.confirmations, []);
  await act('opinion', { scope: { kind: 'change', key: '' }, body: 'legacy state' }, agent);
  assert.equal(current().opinions.length, 1);
});
