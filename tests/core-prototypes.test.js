import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EngineeringStore } from '../src/core.js';

// UI 原型产物只登记「哪个页面、在哪个方案版本、文件在工作区哪里」。
// 这组测试钉住三件事：路径必须是工作区相对（否则渲染端能读到任意文件）、
// 同一次 save 里的原型归属新版本、以及旧 state 缺字段时按空集合读出。
const user = { kind: 'user', id: 'reviewer' };
const rejects = (promise, code) => assert.rejects(promise, error => error.code === code && error instanceof Error);

const page = (over = {}) => ({
  pageId: 'workbench', title: '工作台原型',
  htmlPath: 'design/prototype/engineering-workbench.html',
  screenshotPath: 'design/prototype/shot-plan.png',
  note: '四视图 + 三布局',
  ...over,
});

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'core-prototypes-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new EngineeringStore(root);
  let state = (await store.execute({ action: 'create', title: 'Prototypes', goal: 'Register UI prototypes' })).change;
  const act = async (action, fields = {}, actor = user) => {
    const result = await store.execute({ action, changeId: state.id, expectedRevision: state.revision, ...fields }, actor);
    if (result.change) state = result.change;
    return result;
  };
  return { store, act, current: () => state, root };
}

test('prototypes are registered with the plan version they were written under', async (t) => {
  const { act, current } = await fixture(t);
  const saved = await act('save', { patch: { prototypes: [page()] } });
  const [entry] = saved.change.prototypes;
  assert.equal(entry.pageId, 'workbench');
  assert.equal(entry.planVersion, 1);
  assert.equal(entry.htmlPath, 'design/prototype/engineering-workbench.html');
  assert.equal(entry.screenshotPath, 'design/prototype/shot-plan.png');
  assert.ok(entry.addedAt);
  assert.equal(current().prototypes.length, 1);
});

test('a prototype path must stay inside the workspace', async (t) => {
  const { act } = await fixture(t);
  await rejects(act('save', { patch: { prototypes: [page({ htmlPath: 'C:/Windows/win.ini' })] } }), 'INVALID_INPUT');
  await rejects(act('save', { patch: { prototypes: [page({ htmlPath: '/etc/passwd' })] } }), 'INVALID_INPUT');
  await rejects(act('save', { patch: { prototypes: [page({ screenshotPath: '../../secret.png' })] } }), 'INVALID_INPUT');
  await rejects(act('save', { patch: { prototypes: [page({ htmlPath: 'design\\..\\..\\escape.html' })] } }), 'INVALID_INPUT');
});

test('backslashes are normalised and empty paths are allowed', async (t) => {
  const { act } = await fixture(t);
  const saved = await act('save', { patch: { prototypes: [page({ htmlPath: 'design\\prototype\\a.html', screenshotPath: '' })] } });
  assert.equal(saved.change.prototypes[0].htmlPath, 'design/prototype/a.html');
  assert.equal(saved.change.prototypes[0].screenshotPath, '');
});

test('pageId and title are required, unknown fields are refused', async (t) => {
  const { act } = await fixture(t);
  await rejects(act('save', { patch: { prototypes: [{ title: 'x' }] } }), 'INVALID_INPUT');
  await rejects(act('save', { patch: { prototypes: [{ pageId: 'x' }] } }), 'INVALID_INPUT');
  await rejects(act('save', { patch: { prototypes: [page({ state: 'green' })] } }), 'INVALID_INPUT');
  await rejects(act('save', { patch: { prototypes: [page(), page()] } }), 'INVALID_INPUT');
});

test('prototypes written by a save that invalidates the plan belong to the new version', async (t) => {
  const { act } = await fixture(t);
  await act('save', { patch: { tasks: [{ id: 'a', title: 'A', dependencies: [], expectedFiles: ['a.js'], acceptanceCriteria: ['ok'], verificationCommands: [], requiredApproval: true }] } });
  await act('save', { patch: { prototypes: [page()] } });
  await act('approve');
  const bumped = await act('save', { patch: { prototypes: [page({ pageId: 'workbench', title: '工作台原型 v2' })] } });
  assert.equal(bumped.change.planVersion, 2);
  assert.equal(bumped.change.prototypes[0].planVersion, 2);
  assert.equal(bumped.change.prototypes[0].title, '工作台原型 v2');
});

test('a legacy state without prototypes reads as an empty list', async (t) => {
  const { store, current, root } = await fixture(t);
  const file = path.join(root, '.dsh/engineering/changes', current().id, 'state.json');
  const raw = JSON.parse(await fs.readFile(file, 'utf8'));
  delete raw.prototypes;
  await fs.writeFile(file, JSON.stringify(raw, null, 2));
  const reloaded = (await store.execute({ action: 'get', changeId: current().id })).change;
  assert.deepEqual(reloaded.prototypes, []);
});

test('export writes the prototype section with workspace-relative paths', async (t) => {
  const { act, current, root } = await fixture(t);
  await act('save', { patch: { prototypes: [page()] } });
  const exported = await act('export');
  const progress = await fs.readFile(path.join(root, '.dsh/engineering/changes', current().id, 'progress.md'), 'utf8');
  assert.match(progress, /## UI prototypes \(paths are workspace-relative\)/);
  assert.match(progress, /design\/prototype\/engineering-workbench\.html/);
  assert.match(progress, /plan v1/);
  assert.ok(exported.files.some(file => file.endsWith('progress.md')));
});
