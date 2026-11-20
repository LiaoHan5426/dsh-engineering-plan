import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import path from 'node:path';
import { EngineeringStore } from '../src/core.js';

const ACTOR = { kind: 'user', id: 'scope-conflict' };
const task = (id, files, dependencies = []) => ({
  id, title: id, description: '', dependencies, expectedFiles: files,
  acceptanceCriteria: ['ok'], verificationCommands: ['echo ok'],
});

async function change(tasks) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'engineering-scope-conflict-'));
  const store = new EngineeringStore(root);
  const created = (await store.execute({ action: 'create', title: 'Scope', goal: 'Prove directory conflict rules', mode: 'lite' }, ACTOR)).change;
  const saved = await store.execute({ action: 'save', changeId: created.id, expectedRevision: created.revision, patch: { tasks } }, ACTOR);
  // Starting a task requires a human approval of the current version.
  const approved = await store.execute({ action: 'approve', changeId: created.id, expectedRevision: saved.change.revision, planVersion: saved.change.planVersion }, ACTOR);
  return { root, store, change: approved.change, cleanup: () => fs.rm(root, { recursive: true, force: true }) };
}

test('a file inside a declared directory conflicts with that directory', async (t) => {
  const f = await change([task('DOCS', ['docs/']), task('PAGE', ['docs/a.md'])]);
  t.after(f.cleanup);
  // Order matters: move DOCS first so PAGES' entry is the one being checked.
  await f.store.execute({ action: 'transition', changeId: f.change.id, expectedRevision: f.change.revision, taskId: 'DOCS', status: 'running' }, ACTOR);
  const latest = (await f.store.execute({ action: 'get', changeId: f.change.id }, ACTOR)).change;
  await assert.rejects(
    () => f.store.execute({ action: 'transition', changeId: f.change.id, expectedRevision: latest.revision, taskId: 'PAGE', status: 'running' }, ACTOR),
    (error) => error.code === 'FILE_CONFLICT',
  );
});

test('two tasks may declare different files under the same directory string', async (t) => {
  const f = await change([task('A', ['docs/']), task('B', ['src/'])]);
  t.after(f.cleanup);
  await f.store.execute({ action: 'transition', changeId: f.change.id, expectedRevision: f.change.revision, taskId: 'A', status: 'running' }, ACTOR);
  const latest = (await f.store.execute({ action: 'get', changeId: f.change.id }, ACTOR)).change;
  const moved = await f.store.execute({ action: 'transition', changeId: f.change.id, expectedRevision: latest.revision, taskId: 'B', status: 'running' }, ACTOR);
  assert.equal(moved.change.tasks.find((item) => item.id === 'B').status, 'running');
});

test('directory declarations normalise backslashes and keep the marker', async (t) => {
  const f = await change([task('DOCS', ['docs\\nested\\'])]);
  t.after(f.cleanup);
  assert.deepEqual(f.change.tasks[0].expectedFiles, ['docs/nested/']);
});

test('unsafe directory declarations are still refused', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'engineering-scope-unsafe-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new EngineeringStore(root);
  const created = (await store.execute({ action: 'create', title: 'Unsafe', goal: 'Refuse unusable declarations', mode: 'lite' }, ACTOR)).change;
  for (const bad of ['/', 'docs//', 'docs/../', 'docs/./', 'C:/']) {
    await assert.rejects(
      () => store.execute({ action: 'save', changeId: created.id, expectedRevision: created.revision, patch: { tasks: [task('BAD', [bad])] } }, ACTOR),
      (error) => error.code === 'PATH_UNSAFE',
      `expected PATH_UNSAFE for ${bad}`,
    );
  }
});

test('a file conflict names the colliding task and both paths', async (t) => {
  const f = await change([task('DOCS', ['docs/']), task('PAGE', ['docs/a.md'])]);
  t.after(f.cleanup);
  const running = await f.store.execute(
    { action: 'transition', changeId: f.change.id, expectedRevision: f.change.revision, taskId: 'DOCS', status: 'running' }, ACTOR);
  assert.equal(running.change.tasks.find((item) => item.id === 'DOCS').status, 'running');
  await assert.rejects(
    () => f.store.execute(
      { action: 'transition', changeId: f.change.id, expectedRevision: running.change.revision, taskId: 'PAGE', status: 'running' }, ACTOR),
    (error) => error.code === 'FILE_CONFLICT'
      && /docs\/a\.md overlaps DOCS docs\//.test(error.message)
      && !/\+\d+ more/.test(error.message),
  );
});
