import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EngineeringStore } from '../src/core.js';

const user = { kind: 'user', id: 'reviewer' };
const agent = { kind: 'agent', id: 'worker' };
const REVISIONED = ['save', 'replan', 'approve', 'acceptDelivery', 'transition', 'evidence', 'export', 'amendTask'];
const task = (id, extra = {}) => ({ id, title: id, description: '', dependencies: [], expectedFiles: [`src/${id}.js`], acceptanceCriteria: ['works', 'tested'], verificationCommands: [], ...extra });
const rejects = (promise, code) => assert.rejects(promise, error => error.code === code && error instanceof Error, `expected ${code}`);

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'engineering-automation-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new EngineeringStore(root);
  const changeId = (await store.execute({ action: 'create', title: 'Plan', goal: 'Deliver', mode: 'standard' })).change.id;
  const get = async (impl = store) => (await impl.execute({ action: 'get', changeId })).change;
  const step = async (action, fields = {}, actor = agent, impl = store) => {
    const current = await get(impl);
    return impl.execute(REVISIONED.includes(action) ? { action, changeId, expectedRevision: current.revision, ...fields } : { action, changeId, ...fields }, actor);
  };
  return { root, store, changeId, get, step, fresh: () => new EngineeringStore(root) };
}

async function pass(taskId, f) {
  await f.step('transition', { taskId, status: 'running' });
  await f.step('transition', { taskId, status: 'verifying' });
  for (const criterion of ['works', 'tested']) await f.step('evidence', { taskId, criterion, outcome: 'passed', note: 'gate output' });
}

test('an ungated task closes itself once every criterion has passed', async t => {
  const f = await fixture(t);
  await f.step('save', { patch: { tasks: [task('a')] } });
  await f.step('approve', {}, user);
  await pass('a', f);
  const done = await f.step('transition', { taskId: 'a', status: 'completed' });
  assert.equal(done.change.tasks[0].status, 'completed');
  assert.equal(done.change.status, 'completed');
  assert.equal(done.change.history.some(entry => entry.kind === 'task-amended'), false);
});

test('a gated task waits for a human instead of refusing the request', async t => {
  const f = await fixture(t);
  await f.step('save', { patch: { tasks: [task('g', { requiredApproval: true })] } });
  await f.step('approve', {}, user);
  await pass('g', f);
  const waiting = await f.step('transition', { taskId: 'g', status: 'completed' });
  assert.equal(waiting.change.tasks[0].status, 'awaiting-review');
  assert.equal(waiting.change.status, 'awaiting-review');

  // 执行方再请求一次收尾不会把自己升级成已完成
  await rejects(f.step('transition', { taskId: 'g', status: 'completed' }), 'INVALID_TRANSITION');
  const gate = await f.store.execute({ action: 'gateStatus', changeId: f.changeId }, agent);
  assert.equal(gate.blockers.some(blocker => blocker.code === 'TASK_NOT_TERMINAL' && blocker.taskId === 'g'), true);
  await rejects(f.store.execute({ action: 'acceptDelivery', changeId: f.changeId, expectedRevision: (await f.get()).revision, note: 'ship' }, user), 'DELIVERY_NOT_READY');

  const closed = await f.step('transition', { taskId: 'g', status: 'completed' }, user);
  assert.equal(closed.change.tasks[0].status, 'completed');
  assert.equal(closed.change.status, 'completed');
});

test('the executor can rewrite a running task without reopening the plan', async t => {
  const f = await fixture(t);
  await f.step('save', { patch: { tasks: [task('a'), task('b', { dependencies: ['a'] })] } });
  const approved = await f.step('approve', {}, user);
  await f.step('transition', { taskId: 'a', status: 'running' });
  const amended = await f.step('amendTask', { taskId: 'b', taskPatch: { title: 'Renamed while working', affectedModules: ['src/core.js'], executor: 'subagent' } }, agent);
  assert.equal(amended.change.tasks[1].title, 'Renamed while working');
  assert.deepEqual(amended.change.tasks[1].affectedModules, ['src/core.js']);
  assert.equal(amended.change.tasks[1].executor, 'subagent');
  assert.equal(amended.change.tasks[0].status, 'running');
  assert.equal(amended.change.planVersion, approved.change.planVersion);
  const entry = amended.change.history.at(-1);
  assert.equal(entry.kind, 'task-amended');
  assert.equal(entry.criteriaChanged, false);

  // 新提出的依赖会重新走同一套校验：指回自己就是环
  await rejects(f.step('amendTask', { taskId: 'b', taskPatch: { dependencies: ['b'] } }), 'TASK_CYCLE');
  // 未知字段与错误形状都不写盘
  await rejects(f.step('amendTask', { taskId: 'b', taskPatch: { status: 'completed' } }), 'INVALID_INPUT');
  await rejects(f.step('amendTask', { taskId: 'b', taskPatch: [] }), 'INVALID_INPUT');
  await rejects(f.step('amendTask', { taskId: 'ghost', taskPatch: { title: 'x' } }), 'TASK_NOT_FOUND');
});

test('rewriting acceptance criteria drops the evidence that no longer matches', async t => {
  const f = await fixture(t);
  await f.step('save', { patch: { tasks: [task('a')] } });
  await f.step('approve', {}, user);
  await pass('a', f);
  const amended = await f.step('amendTask', { taskId: 'a', taskPatch: { acceptanceCriteria: ['works', 'tested', 'documented'] } });
  assert.equal(amended.change.tasks[0].status, 'running');
  assert.deepEqual(amended.change.tasks[0].evidence, []);
  assert.equal(amended.change.evidence.length, 0);
  assert.equal(amended.change.history.at(-1).criteriaChanged, true);
  // 证据清空后任务退回 running，重新走一遍 verifying 才能再收尾
  await f.step('transition', { taskId: 'a', status: 'verifying' });
  await rejects(f.step('transition', { taskId: 'a', status: 'completed' }), 'EVIDENCE_REQUIRED');
  for (const criterion of ['works', 'tested', 'documented']) await f.step('evidence', { taskId: 'a', criterion, outcome: 'passed', note: 'rerun' });
  const done = await f.step('transition', { taskId: 'a', status: 'completed' });
  assert.equal(done.change.tasks[0].status, 'completed');
});

test('a finished task and an unapproved plan cannot be amended', async t => {
  const f = await fixture(t);
  await f.step('save', { patch: { tasks: [task('a')] } });
  await rejects(f.step('amendTask', { taskId: 'a', taskPatch: { title: 'early' } }), 'APPROVAL_REQUIRED');
  await f.step('approve', {}, user);
  await pass('a', f);
  await f.step('transition', { taskId: 'a', status: 'completed' });
  await rejects(f.step('amendTask', { taskId: 'a', taskPatch: { title: 'late' } }), 'INVALID_STATE');
  const stale = await f.step('amendTask', { taskId: 'a', taskPatch: { title: 'late' } }).catch(error => error);
  assert.equal(stale.code, 'INVALID_STATE');
});
