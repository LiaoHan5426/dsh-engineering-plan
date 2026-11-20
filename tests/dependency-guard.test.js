import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EngineeringStore } from '../src/core.js';

const CHANGE = '11111111-2222-4333-8444-555555555555';
const user = { kind: 'user', id: 'user-1' };
const statePath = (root) => path.join(root, '.dsh', 'engineering', 'changes', CHANGE, 'state.json');

// save/approve 自身会拒绝不存在的依赖，所以「依赖指向已删除任务」只可能来自外部写入或旧版本数据。
// 这个用例直接把磁盘上的 state.json 改成那种形态，验证门禁给的是 DEPENDENCY_BLOCKED 而不是 TypeError。
async function tampered() {
  const root = await mkdtemp(path.join(tmpdir(), 'ep-dep-'));
  const store = new EngineeringStore(root);
  await store.execute({ action: 'create', changeId: CHANGE, title: 'dep probe', goal: 'probe dependency guard', mode: 'lite' }, user);
  const tasks = [{ id: 'T1', title: 'T1', description: '', dependencies: [], expectedFiles: [], acceptanceCriteria: ['c'], verificationCommands: [] }];
  let out = await store.execute({ action: 'save', changeId: CHANGE, expectedRevision: 1, patch: { tasks } }, user);
  out = await store.execute({ action: 'approve', changeId: CHANGE, expectedRevision: out.change.revision }, user);
  const state = JSON.parse(await readFile(statePath(root), 'utf8'));
  state.tasks[0].dependencies = ['GHOST'];
  await writeFile(statePath(root), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  return { root, store, revision: out.change.revision };
}

test('a dependency naming a deleted task blocks with DEPENDENCY_BLOCKED, not a TypeError', async () => {
  const { root, store, revision } = await tampered();
  try {
    await assert.rejects(
      () => store.execute({ action: 'transition', changeId: CHANGE, taskId: 'T1', status: 'running', expectedRevision: revision }, user),
      (error) => {
        assert.equal(error.code, 'DEPENDENCY_BLOCKED');
        assert.notEqual(error.constructor.name, 'TypeError');
        return true;
      },
    );
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a completed dependency still permits running', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ep-dep-'));
  try {
    const store = new EngineeringStore(root);
    await store.execute({ action: 'create', changeId: CHANGE, title: 'dep ok', goal: 'probe dependency guard', mode: 'lite' }, user);
    const tasks = [
      { id: 'T1', title: 'T1', description: '', dependencies: [], expectedFiles: [], acceptanceCriteria: ['c1'], verificationCommands: [] },
      { id: 'T2', title: 'T2', description: '', dependencies: ['T1'], expectedFiles: [], acceptanceCriteria: ['c2'], verificationCommands: [] },
    ];
    let out = await store.execute({ action: 'save', changeId: CHANGE, expectedRevision: 1, patch: { tasks } }, user);
    out = await store.execute({ action: 'approve', changeId: CHANGE, expectedRevision: out.change.revision }, user);
    let rev = out.change.revision;
    const step = async (taskId, status) => {
      out = await store.execute({ action: 'transition', changeId: CHANGE, taskId, status, expectedRevision: rev }, user);
      rev = out.change.revision;
      return out.change;
    };
    await step('T1', 'running');
    await step('T1', 'verifying');
    out = await store.execute({ action: 'evidence', changeId: CHANGE, taskId: 'T1', criterion: 'c1', outcome: 'passed', note: 'ok', expectedRevision: rev }, user);
    rev = out.change.revision;
    await step('T1', 'completed');
    const change = await step('T2', 'running');
    assert.equal(change.tasks.find(t => t.id === 'T2').status, 'running');
  } finally { await rm(root, { recursive: true, force: true }); }
});
