import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EngineeringStore } from '../src/core.js';

const user = { kind: 'user', id: 'reviewer' };
const METADATA = ['affectedModules', 'executor', 'requiredApproval', 'maxRetries'];
const DEFAULTS = { affectedModules: [], executor: 'local', requiredApproval: false, maxRetries: 0 };
const REVISIONED = ['save', 'replan', 'approve', 'acceptDelivery', 'transition', 'evidence', 'export'];
const task = (id, extra = {}) => ({ id, title: id, description: '', dependencies: [], expectedFiles: [`src/${id}.js`], acceptanceCriteria: ['works', 'tested'], verificationCommands: ['echo never execute'], ...extra });
const meta = stored => ({ affectedModules: stored.affectedModules, executor: stored.executor, requiredApproval: stored.requiredApproval, maxRetries: stored.maxRetries });
const rejects = (promise, code, label) => assert.rejects(promise, error => error.code === code && error instanceof Error, label);

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'engineering-task-fields-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new EngineeringStore(root);
  const changeId = (await store.execute({ action: 'create', title: 'Plan', goal: 'Deliver', mode: 'standard' })).change.id;
  const stateFile = path.join(root, '.dsh', 'engineering', 'changes', changeId, 'state.json');
  const get = async (impl = store) => (await impl.execute({ action: 'get', changeId })).change;
  const step = async (action, fields = {}, actor, impl = store) => {
    const current = await get(impl);
    return impl.execute(REVISIONED.includes(action) ? { action, changeId, expectedRevision: current.revision, ...fields } : { action, changeId, ...fields }, actor);
  };
  return { root, store, changeId, stateFile, get, step, fresh: () => new EngineeringStore(root) };
}

test('minimal task save reads back the four planning metadata defaults', async t => {
  const f = await fixture(t);
  const saved = await f.step('save', { patch: { tasks: [task('a'), task('b', { dependencies: ['a'] })] } });
  for (const stored of saved.change.tasks) assert.deepEqual(meta(stored), DEFAULTS);

  const got = await f.get();
  assert.deepEqual(got.tasks.map(meta), [DEFAULTS, DEFAULTS]);
  // 只读字段仍由状态机维护，未被新键挤掉
  assert.equal(got.tasks[0].status, 'pending');
  assert.deepEqual(got.tasks[0].evidence, []);

  // 重新读盘的 store 与 context 的最小任务投影同样带默认值
  assert.deepEqual((await f.get(f.fresh())).tasks.map(meta), [DEFAULTS, DEFAULTS]);
  const context = await f.fresh().execute({ action: 'context', changeId: f.changeId });
  assert.deepEqual(context.tasks.map(meta), [DEFAULTS, DEFAULTS]);
  assert.equal(context.tasks[0].title, 'a');
});

test('explicit metadata round-trips, deduplicates affectedModules and fills partial input', async t => {
  const f = await fixture(t);
  const explicit = { affectedModules: ['src/core.js', 'src/core.js', 'tests/core.test.js'], executor: 'subagent', requiredApproval: true, maxRetries: 3 };
  const saved = await f.step('save', { patch: { tasks: [task('a', explicit), task('b', { executor: 'external' })] } });
  assert.deepEqual(meta(saved.change.tasks[0]), { ...explicit, affectedModules: ['src/core.js', 'tests/core.test.js'] });
  assert.deepEqual(meta(saved.change.tasks[1]), { ...DEFAULTS, executor: 'external' });

  const got = await f.get(f.fresh());
  assert.deepEqual(got.tasks.map(meta), saved.change.tasks.map(meta));
  assert.deepEqual(got.tasks[0].affectedModules, ['src/core.js', 'tests/core.test.js']);

  // 边界值：0 与 10 合法，空数组去重后仍是空数组
  const edges = await f.step('save', { patch: { tasks: [task('a', { maxRetries: 10, affectedModules: ['x', 'x'] }), task('c', { maxRetries: 0 })] } });
  assert.deepEqual(meta(edges.change.tasks[0]), { ...DEFAULTS, affectedModules: ['x'], maxRetries: 10 });
  assert.deepEqual(meta(edges.change.tasks[1]), DEFAULTS);
});

test('invalid metadata values and unknown task keys are rejected without moving the revision', async t => {
  const f = await fixture(t);
  const cases = [
    ['executor enum', { executor: 'robot' }],
    ['executor non-string', { executor: 1 }],
    ['executor null', { executor: null }],
    ['maxRetries above range', { maxRetries: 11 }],
    ['maxRetries negative', { maxRetries: -1 }],
    ['maxRetries fractional', { maxRetries: 1.5 }],
    ['maxRetries string', { maxRetries: '3' }],
    ['requiredApproval non-boolean', { requiredApproval: 'yes' }],
    ['affectedModules not an array', { affectedModules: 'a' }],
    ['affectedModules empty entry', { affectedModules: [''] }],
    ['affectedModules blank entry', { affectedModules: ['   '] }],
    ['affectedModules NUL entry', { affectedModules: ['a\u0000b'] }],
    ['affectedModules entry too long', { affectedModules: ['x'.repeat(201)] }],
    ['affectedModules too many entries', { affectedModules: Array.from({ length: 201 }, (unused, index) => `module-${index}`) }],
    ['unknown key', { foo: 'x' }],
    ['read-only status', { status: 'completed' }],
    ['read-only evidence', { evidence: [] }]
  ];
  for (const [label, extra] of cases) await rejects(f.step('save', { patch: { tasks: [task('a', extra)] } }), 'INVALID_INPUT', label);

  const got = await f.get();
  assert.equal(got.revision, 1);
  assert.deepEqual(got.tasks, []);
  // 同一批里一项非法即整体失败，合法项也不会被写入
  await rejects(f.step('save', { patch: { tasks: [task('a'), task('b', { executor: 'robot' })] } }), 'INVALID_INPUT');
  assert.deepEqual((await f.get()).tasks, []);
});

test('legacy state without the four fields still gets, contexts, transitions and exports', async t => {
  const f = await fixture(t);
  await f.step('save', { patch: { tasks: [task('a'), task('b', { dependencies: ['a'], affectedModules: ['src/b.js'], executor: 'external', requiredApproval: true, maxRetries: 2 })] } });

  // 手工剥离四个键，模拟旧版本写出的 state.json
  const raw = JSON.parse(await fs.readFile(f.stateFile, 'utf8'));
  for (const stored of raw.tasks) for (const key of METADATA) delete stored[key];
  assert.equal(raw.tasks.some(stored => METADATA.some(key => Object.hasOwn(stored, key))), false);
  await fs.writeFile(f.stateFile, JSON.stringify(raw, null, 2) + '\n');

  const legacy = f.fresh();
  const got = await f.get(legacy);
  assert.deepEqual(got.tasks.map(meta), [DEFAULTS, DEFAULTS]);

  const context = await legacy.execute({ action: 'context', changeId: f.changeId });
  assert.deepEqual(context.tasks.map(meta), [DEFAULTS, DEFAULTS]);
  assert.deepEqual((await legacy.execute({ action: 'list' })).warnings, []);

  // 审批与状态机在旧 state 上照常推进
  await f.step('approve', {}, user, legacy);
  await f.step('transition', { taskId: 'a', status: 'running' }, undefined, legacy);
  await f.step('transition', { taskId: 'a', status: 'verifying' }, undefined, legacy);
  for (const criterion of ['works', 'tested']) await f.step('evidence', { taskId: 'a', criterion, outcome: 'passed', note: 'fixture' }, undefined, legacy);
  await f.step('transition', { taskId: 'a', status: 'completed' }, undefined, legacy);

  const afterTransitions = await f.get(legacy);
  assert.equal(afterTransitions.tasks[0].status, 'completed');
  assert.deepEqual(meta(afterTransitions.tasks[0]), DEFAULTS);
  assert.deepEqual(meta(afterTransitions.tasks[1]), DEFAULTS);

  const exported = await f.step('export', {}, undefined, legacy);
  const tasksJson = JSON.parse(await fs.readFile(exported.files.find(file => file.endsWith('tasks.json')), 'utf8'));
  assert.deepEqual(tasksJson.map(meta), [DEFAULTS, DEFAULTS]);
  assert.deepEqual(exported.change.tasks.map(meta), [DEFAULTS, DEFAULTS]);
});

test('export writes the four fields into tasks.json', async t => {
  const f = await fixture(t);
  await f.step('save', { patch: { tasks: [task('a', { affectedModules: ['src/a.js', 'src/a.js'], executor: 'external', requiredApproval: true, maxRetries: 5 }), task('b')] } });
  const exported = await f.step('export');
  const tasks = JSON.parse(await fs.readFile(exported.files.find(file => file.endsWith('tasks.json')), 'utf8'));

  // 结构化任务交付物必须自己带键，而不是依赖读取时补值
  for (const stored of tasks) assert.deepEqual(METADATA.filter(key => Object.hasOwn(stored, key)).sort(), [...METADATA].sort());
  assert.deepEqual(meta(tasks[0]), { affectedModules: ['src/a.js'], executor: 'external', requiredApproval: true, maxRetries: 5 });
  assert.deepEqual(meta(tasks[1]), DEFAULTS);
  assert.match(tasks[0].executor, /^(local|subagent|external)$/);
  assert.equal(tasks[0].requiredApproval, true);
  assert.deepEqual(tasks, exported.change.tasks);
});

test('metadata never enters the DAG, file conflicts, approval or evidence gates', async t => {
  const f = await fixture(t);
  // 元数据合法也不改变循环检测
  await rejects(f.step('save', { patch: { tasks: [task('a', { dependencies: ['b'], requiredApproval: true }), task('b', { dependencies: ['a'], executor: 'subagent' })] } }), 'TASK_CYCLE');
  // 依赖顺序照旧
  await f.step('save', { patch: { tasks: [task('a'), task('b', { dependencies: ['a'], executor: 'external', requiredApproval: true, maxRetries: 4 })] } });
  await f.step('approve', {}, user);
  await rejects(f.step('transition', { taskId: 'b', status: 'running' }), 'DEPENDENCY_BLOCKED');

  // affectedModules 不参与文件冲突：同模块不同 expectedFiles 可并行
  const files = await fixture(t);
  await files.step('save', { patch: { tasks: [task('a', { affectedModules: ['src/shared.js'] }), task('b', { affectedModules: ['src/shared.js'] }), task('c', { dependencies: [], expectedFiles: ['src/a.js'] })] } });
  await files.step('approve', {}, user);
  await files.step('transition', { taskId: 'a', status: 'running' });
  await files.step('transition', { taskId: 'b', status: 'running' });
  await rejects(files.step('transition', { taskId: 'c', status: 'running' }), 'FILE_CONFLICT');

  // requiredApproval 与 maxRetries 不改变证据门禁，也不触发自动重试
  await f.step('transition', { taskId: 'a', status: 'running' });
  await f.step('transition', { taskId: 'a', status: 'verifying' });
  await rejects(f.step('transition', { taskId: 'a', status: 'completed' }), 'EVIDENCE_REQUIRED');
  for (const criterion of ['works', 'tested']) await f.step('evidence', { taskId: 'a', criterion, outcome: 'passed', note: 'fixture' });
  await f.step('transition', { taskId: 'a', status: 'completed' });
  // 依赖完成后 b 仍要自己通过证据门禁
  await f.step('transition', { taskId: 'b', status: 'running' });
  await f.step('transition', { taskId: 'b', status: 'verifying' });
  await rejects(f.step('transition', { taskId: 'b', status: 'completed' }), 'EVIDENCE_REQUIRED');
  for (const criterion of ['works', 'tested']) await f.step('evidence', { taskId: 'b', criterion, outcome: 'passed', note: 'fixture' });
  await f.step('transition', { taskId: 'b', status: 'completed' });

  const got = await f.get();
  assert.equal(got.tasks[1].status, 'completed');
  assert.equal(got.tasks[1].evidence.length, 2);
  assert.deepEqual(meta(got.tasks[1]), { affectedModules: [], executor: 'external', requiredApproval: true, maxRetries: 4 });
});
