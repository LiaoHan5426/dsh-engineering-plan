import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EngineeringStore } from '../src/core.js';

// Audit finding: core's identifier regex accepted Windows device names, so a changeId such
// as "nul" reached storage while every other store already refused it. The guard must be
// uniform with dispatch/verification/git stores and must not reject ordinary ids.
test('core identifier refuses Windows device names before touching storage', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'identifier-guard-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new EngineeringStore(root);
  const actor = { kind: 'agent', id: 'tester' };
  const { change } = await store.execute({ action: 'create', title: 'Guard', goal: 'Identifier rules' }, actor);

  for (const device of ['nul', 'NUL', 'con', 'prn', 'aux', 'com1', 'lpt9']) {
    await assert.rejects(
      store.execute({ action: 'get', changeId: device }, actor),
      error => error.code === 'INVALID_ID',
      `expected INVALID_ID for ${device}`,
    );
  }

  // Names that merely start with a device name stay legal; they are ordinary directories.
  await assert.rejects(store.execute({ action: 'get', changeId: 'nulx' }, actor), error => /not found/i.test(error.message));
  const listed = await store.execute({ action: 'list' }, actor);
  assert.deepEqual(listed.changes.map(item => item.id), [change.id]);
});
