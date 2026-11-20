import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { EngineeringStore } from '../src/core.js';

const task = (id) => ({
  id,
  title: `Task ${id}`,
  description: '',
  dependencies: [],
  expectedFiles: [],
  acceptanceCriteria: ['done'],
  verificationCommands: [],
});

async function fixture(t, mode = 'lite') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'export-manifest-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new EngineeringStore(root);
  const user = { kind: 'user', id: 'reviewer' };
  const created = await store.execute({ action: 'create', title: 'Manifest', goal: 'prove what an export wrote', mode }, user);
  const change = created.change;
  const directory = path.join(root, '.dsh', 'engineering', 'changes', change.id);
  return { root, store, user, change, directory };
}

test('an export writes a manifest describing exactly what it wrote', async (t) => {
  const f = await fixture(t);
  const result = await f.store.execute({ action: 'export', changeId: f.change.id, expectedRevision: f.change.revision }, f.user);
  assert.ok(result.manifest.endsWith('manifest.json'));
  const manifest = JSON.parse(await fs.readFile(result.manifest, 'utf8'));
  assert.equal(manifest.mode, 'lite');
  assert.equal(manifest.changeId, f.change.id);
  assert.equal(manifest.planVersion, f.change.planVersion);
  assert.equal(manifest.revision, f.change.revision);
  assert.deepEqual(manifest.files, result.files.map((file) => path.relative(f.directory, file).split(path.sep).join('/')).sort());
  assert.deepEqual(manifest.stale, []);
  assert.match(manifest.exportedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('an export reports earlier projections it did not write this time', async (t) => {
  const f = await fixture(t);
  const saved = await f.store.execute({
    action: 'save',
    changeId: f.change.id,
    expectedRevision: f.change.revision,
    patch: { documents: { findings: 'Original findings' }, diagrams: { sequence: 'sequenceDiagram' }, tasks: [task('a')] },
  }, f.user);
  const first = await f.store.execute({ action: 'export', changeId: f.change.id, expectedRevision: saved.change.revision }, f.user);
  assert.deepEqual(JSON.parse(await fs.readFile(first.manifest, 'utf8')).stale, []);

  const cleared = await f.store.execute({
    action: 'save',
    changeId: f.change.id,
    expectedRevision: saved.change.revision,
    patch: { documents: { findings: '' }, diagrams: { sequence: '' }, tasks: [] },
  }, f.user);
  const second = await f.store.execute({ action: 'export', changeId: f.change.id, expectedRevision: cleared.change.revision }, f.user);
  const manifest = JSON.parse(await fs.readFile(second.manifest, 'utf8'));
  assert.deepEqual(manifest.stale, ['diagrams/sequence.mmd', 'diagrams/task-dag.mmd', 'findings.md']);
  assert.equal(manifest.stale.some((name) => manifest.files.includes(name)), false);
  // Retention is unchanged: the earlier files are still on disk, just no longer part of this export.
  assert.equal(await fs.readFile(path.join(f.directory, 'findings.md'), 'utf8'), 'Original findings');
  assert.equal(second.files.some((file) => file.endsWith('findings.md')), false);
});

test('the manifest is rewritten on every export and never bumps the revision', async (t) => {
  const f = await fixture(t);
  const first = await f.store.execute({ action: 'export', changeId: f.change.id, expectedRevision: f.change.revision }, f.user);
  const before = JSON.parse(await fs.readFile(first.manifest, 'utf8'));
  await new Promise((resolve) => setTimeout(resolve, 15));
  const second = await f.store.execute({ action: 'export', changeId: f.change.id, expectedRevision: f.change.revision }, f.user);
  const after = JSON.parse(await fs.readFile(second.manifest, 'utf8'));
  assert.notEqual(after.exportedAt, before.exportedAt);
  assert.equal(after.revision, f.change.revision);
  assert.equal(second.change.revision, f.change.revision);
});
