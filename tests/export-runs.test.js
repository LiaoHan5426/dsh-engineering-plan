import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { EngineeringStore } from '../src/core.js';
import { VerificationRunStore } from '../src/verification-store.js';

const USER = { kind: 'user', id: 'reviewer' };

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'ep-export-runs-'));
  const store = new EngineeringStore(root);
  const { change } = await store.execute({
    action: 'create',
    title: 'Export runs',
    goal: 'Show recorded runs in the exported progress file',
    mode: 'lite',
  }, USER);
  const saved = await store.execute({
    action: 'save',
    changeId: change.id,
    expectedRevision: change.revision,
    patch: {
      tasks: [{
        id: 'T1',
        title: 'Run one command',
        description: '',
        dependencies: [],
        expectedFiles: [],
        acceptanceCriteria: ['marker printed'],
        verificationCommands: ['echo marker'],
      }],
    },
  }, USER);
  return { root, store, change: saved.change };
}

function progressOf(files) {
  const target = files.find(file => file.endsWith('progress.md'));
  return readFile(target, 'utf8');
}

test('an export without runs says so instead of looking verified', async () => {
  const { store, change } = await fixture();
  const { files } = await store.execute({
    action: 'export', changeId: change.id, expectedRevision: change.revision,
  }, USER);
  const text = await progressOf(files);
  assert.match(text, /## Runs for this plan version/);
  assert.match(text, /No verification or dispatch run is recorded for this plan version/);
  assert.match(text, /not proof the commands were never run elsewhere/);
});

test('recorded runs of the current version appear with state and exit code', async () => {
  const { root, store, change } = await fixture();
  const runs = new VerificationRunStore(root);
  const reserved = await runs.reserve({
    changeId: change.id,
    taskId: 'T1',
    planVersion: change.planVersion,
    commandIndex: 0,
    command: 'echo marker',
    requestId: 'export-runs-1',
    hostInstanceId: 'host-1',
    ownerSessionId: 'session-1',
  });
  const runId = reserved.run?.runId ?? reserved.runId;
  // reserved → starting → running → succeeded; the store refuses shortcuts.
  const started = await runs.update(change.id, runId, 'host-1', {
    expectedRevision: (reserved.run ?? reserved).revision,
    state: 'starting',
    jobId: 'bash-export-runs-1',
  });
  const running = await runs.update(change.id, runId, 'host-1', {
    expectedRevision: started.revision,
    state: 'running',
  });
  await runs.update(change.id, runId, 'host-1', {
    expectedRevision: running.revision,
    state: 'succeeded',
    exitCode: 0,
    signal: null,
    stdout: { text: 'marker\n', truncated: false },
    stderr: { text: '', truncated: false },
    timedOut: false,
    aborted: false,
  });

  const { files } = await store.execute({
    action: 'export', changeId: change.id, expectedRevision: change.revision,
  }, USER);
  const text = await progressOf(files);
  assert.match(text, new RegExp(`- verification ${runId}: T1 — succeeded \\(command 0: echo marker\\), exit 0`));
  assert.match(text, /host-observed attempts, not acceptance/);
});

test('runs from an older plan version are excluded and export does not bump the revision', async () => {
  const { root, store, change } = await fixture();
  const runs = new VerificationRunStore(root);
  const reserved = await runs.reserve({
    changeId: change.id,
    taskId: 'T1',
    planVersion: change.planVersion,
    commandIndex: 0,
    command: 'echo marker',
    requestId: 'export-runs-old',
    hostInstanceId: 'host-1',
    ownerSessionId: 'session-1',
  });
  const record = reserved.run ?? reserved;
  const started = await runs.update(change.id, record.runId, 'host-1', {
    expectedRevision: record.revision,
    state: 'starting',
    jobId: 'bash-export-runs-2',
  });
  const running = await runs.update(change.id, record.runId, 'host-1', {
    expectedRevision: started.revision,
    state: 'running',
  });
  await runs.update(change.id, record.runId, 'host-1', {
    expectedRevision: running.revision,
    state: 'cancelled',
  });

  const replanned = await store.execute({
    action: 'replan', changeId: change.id, expectedRevision: change.revision,
  }, USER);
  assert.equal(replanned.change.planVersion, change.planVersion + 1);

  const { files, change: exported } = await store.execute({
    action: 'export', changeId: change.id, expectedRevision: replanned.change.revision,
  }, USER);
  const text = await progressOf(files);
  assert.equal(text.includes(record.runId), false);
  assert.match(text, /No verification or dispatch run is recorded for this plan version/);
  assert.equal(exported.revision, replanned.change.revision);
});
