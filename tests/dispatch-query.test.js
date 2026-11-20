import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createOperations, parameters } from '../index.js';
import { DispatchRunStore } from '../src/dispatch-store.js';

test('dispatch query reads only current workspace records and preserves state', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dispatch-query-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const other = await fs.mkdtemp(path.join(os.tmpdir(), 'dispatch-query-other-'));
  t.after(() => fs.rm(other, { recursive: true, force: true }));
  const op = createOperations({ workingDirectory: { ensure: async agent => agent.root } }, agent => agent.root);
  const agent = { id: 'session-a', root };
  const { change } = await op({ action: 'create', title: 'Query fixture', goal: 'Read records' }, agent, 'agent');
  const taskSnapshot = { id: 'task-a', title: 'Fixture', description: '', dependencies: [], expectedFiles: [], acceptanceCriteria: ['Review'], verificationCommands: [] };
  const { run } = await new DispatchRunStore(root).reserve({ changeId: change.id, taskId: 'task-a', planVersion: 1, admittedRevision: 1, requestId: 'req-a', taskSnapshot, taskSnapshotHash: createHash('sha256').update(JSON.stringify(taskSnapshot)).digest('hex'), hostInstanceId: 'host-a', ownerSessionId: agent.id, childId: 'child-a' });
  const before = await op({ action: 'get', changeId: change.id }, agent, 'agent');
  assert.deepEqual(await op({ action: 'dispatchRuns', changeId: change.id }, agent, 'agent'), { runs: [run] });
  assert.deepEqual(await op({ action: 'dispatchRuns', changeId: change.id, runId: run.runId }, agent, 'user'), { run });
  assert.deepEqual(await op({ action: 'verificationRuns', changeId: change.id }, agent, 'agent'), { runs: [] });
  assert.deepEqual(await op({ action: 'get', changeId: change.id }, agent, 'agent'), before);
  await assert.rejects(op({ action: 'dispatchRuns', changeId: change.id }, { id: 'other', root: other }, 'agent'));
  await assert.rejects(op({ action: 'dispatchRuns', changeId: change.id, state: 'returned' }, agent, 'agent'), /ENGINEERING_INVALID_INPUT/);
  await assert.rejects(op({ action: 'dispatchRuns', changeId: change.id }, agent, 'agent', { aborted: true }), /ENGINEERING_CANCELLED/);
  assert.ok(parameters.properties.action.enum.includes('dispatchRuns'));
});
