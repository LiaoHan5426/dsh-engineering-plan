import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { VerificationRunStore } from '../src/verification-store.js';
import { verificationResultSnapshot } from '../src/verification-result.js';

test('typed process snapshots persist through the verification store', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'engineering-verification-integration-'));
  try {
    const store = new VerificationRunStore(root);
    for (const [index, result, expected] of [
      [0, { exitCode: 0, timedOut: false, aborted: false, signal: null }, 'succeeded'],
      [1, {}, 'unknown'],
      [2, { exitCode: 1, timedOut: false, aborted: true, signal: null }, 'cancelled'],
      [3, { exitCode: 0, timedOut: false, aborted: false, sandbox: { denied: true } }, 'error'],
    ]) {
      let run = await store.reserve({ changeId: 'CHG-TEST', taskId: 'T1', planVersion: 1, commandIndex: index, command: 'echo test', requestId: `request-${index}`, hostInstanceId: 'host-test', ownerSessionId: 'session-test' });
      run = await store.update(run.changeId, run.runId, 'host-test', { expectedRevision: run.revision, state: 'starting' });
      run = await store.update(run.changeId, run.runId, 'host-test', { expectedRevision: run.revision, ...verificationResultSnapshot(result) });
      const saved = await store.get(run.changeId, run.runId);
      assert.equal(saved.state, expected);
      assert.equal(Object.hasOwn(saved, 'evidence'), false);
    }
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
