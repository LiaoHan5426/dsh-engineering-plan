import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

import { DispatchRunStore } from '../src/dispatch-store.js';

/**
 * Round 131 killed a writer inside the verification store. The dispatch store has
 * its own copy of the same write path, and a torn dispatch record is read by every
 * later dispatch, verification and delivery check on that change — so the same
 * property has to be shown here rather than inferred from a shared helper.
 */

const CHILD = `
import { DispatchRunStore } from ${JSON.stringify(new URL('../src/dispatch-store.js', import.meta.url).href)};
const [root, changeId, runId] = [process.argv[2], process.argv[3], process.argv[4]];
const store = new DispatchRunStore(root);
for (let round = 0; round < 5000; round += 1) {
  const record = await store.get(changeId, runId);
  try {
    await store.update(changeId, runId, 'host-a', {
      expectedRevision: record.revision,
      result: { text: 'y'.repeat(1500) + '-' + round },
    });
  } catch (error) {
    if (error.code !== 'REVISION_CONFLICT' && error.code !== 'INVALID_TRANSITION') throw error;
  }
}
`;

const LEGAL = new Set(['reserved', 'starting', 'running', 'returned', 'failed', 'cancelled', 'error', 'unknown']);

test('a dispatch run record is never left half-written', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ep-dispatch-crash-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new DispatchRunStore(root);
  const changeId = 'change-dispatch';
  const task = {
    id: 'T1', title: 'probe', description: '', dependencies: [], expectedFiles: [],
    acceptanceCriteria: ['c'], verificationCommands: [],
  };
  const { createHash } = await import('node:crypto');
  const reserved = await store.reserve({
    changeId, taskId: 'T1', planVersion: 1, admittedRevision: 1, requestId: 'req-dispatch-crash',
    taskSnapshot: task, taskSnapshotHash: createHash('sha256').update(JSON.stringify(task)).digest('hex'),
    hostInstanceId: 'host-a', ownerSessionId: 'session-a', childId: 'child-a',
  });
  const run = reserved.run ?? reserved;
  await store.update(changeId, run.runId, 'host-a', { expectedRevision: run.revision, state: 'starting', jobId: 'job-dispatch-crash' });
  await store.update(changeId, run.runId, 'host-a', { expectedRevision: run.revision + 1, state: 'running' });

  const script = join(root, 'child.mjs');
  await writeFile(script, CHILD);

  let revisionSeen = 0;
  for (const delay of [150, 210]) {
    const child = spawn(process.execPath, [script, root, changeId, run.runId], { stdio: ['ignore', 'ignore', 'pipe'] });
    const closed = new Promise(resolve => child.on('close', resolve));
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    await new Promise(resolve => setTimeout(resolve, delay));
    child.kill('SIGKILL');
    await closed;
    assert.equal(stderr, '', `delay ${delay}: the child must not fail unexpectedly: ${stderr}`);

    let refusal = null;
    try { await store.list(changeId); } catch (error) { refusal = error; }
    if (refusal) {
      assert.equal(refusal.code, 'LOCK_BUSY', `delay ${delay}: unexpected ${refusal.code}`);
      assert.match(refusal.message, /pid \d+|names no holder/, `delay ${delay}: the refusal must identify the holder or say it cannot`);
      await unlink(join(root, '.dsh/engineering/changes', changeId, 'dispatches', '.lock'));
    }

    const runs = await store.list(changeId);
    assert.equal(runs.length, 1, `delay ${delay}: a killed writer must not duplicate the record`);
    const record = runs[0];
    assert.equal(record.runId, run.runId);
    assert.ok(LEGAL.has(record.state), `delay ${delay}: state must stay legal, got ${record.state}`);
    assert.ok(Number.isSafeInteger(record.revision) && record.revision >= revisionSeen, `delay ${delay}: revision must not go backwards`);
    revisionSeen = record.revision;
    assert.equal(record.taskId, 'T1', `delay ${delay}: taskId must survive`);
    assert.equal(record.requestId, 'req-dispatch-crash', `delay ${delay}: requestId must survive, otherwise a replay would start a second run`);
    assert.equal(record.taskSnapshotHash.length, 64, `delay ${delay}: the snapshot hash must survive`);
  }

  const directory = join(root, '.dsh/engineering/changes', changeId, 'dispatches');
  for (const name of await readdir(directory)) {
    if (!name.endsWith('.json')) continue;
    assert.ok((await readFile(join(directory, name), 'utf8')).trim().startsWith('{'), `${name} must still be a JSON object`);
  }
});
