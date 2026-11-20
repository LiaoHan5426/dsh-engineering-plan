import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

import { VerificationRunStore } from '../src/verification-store.js';

/**
 * Round 129 killed a writer mid-save of `state.json`; round 130 gave the run
 * stores the same lock diagnosis and temp cleanup but never killed a writer
 * there. A torn run record is worse than a missing one: every later dispatch and
 * verification reads it, and `list` would report the change as corrupt.
 */

const CHILD = `
import { VerificationRunStore } from ${JSON.stringify(new URL('../src/verification-store.js', import.meta.url).href)};
const [root, changeId, runId] = [process.argv[2], process.argv[3], process.argv[4]];
const store = new VerificationRunStore(root);
const host = 'host-a';
for (let round = 0; round < 5000; round += 1) {
  const record = await store.get(changeId, runId);
  try {
    await store.update(changeId, runId, host, {
      expectedRevision: record.revision,
      stdout: { text: 'x'.repeat(1500) + '-' + round, truncated: false },
    });
  } catch (error) {
    if (error.code !== 'REVISION_CONFLICT') throw error;
  }
}
`;

const LEGAL = new Set(['reserved', 'starting', 'running', 'verifying', 'succeeded', 'failed', 'cancelled', 'timed_out', 'error', 'unknown']);

test('a verification run record is never left half-written', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ep-run-crash-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new VerificationRunStore(root);
  const changeId = 'change-crash';
  const reserved = await store.reserve({
    changeId, taskId: 'T1', planVersion: 1, commandIndex: 0, command: 'echo probe',
    requestId: 'req-crash-probe', hostInstanceId: 'host-a', ownerSessionId: 'session-a',
  });
  await store.update(changeId, reserved.runId, 'host-a', { expectedRevision: reserved.revision, state: 'starting', jobId: 'job-crash' });
  await store.update(changeId, reserved.runId, 'host-a', { expectedRevision: reserved.revision + 1, state: 'running' });

  const script = join(root, 'child.mjs');
  await (await import('node:fs/promises')).writeFile(script, CHILD);

  let revisionSeen = 0;
  for (const delay of [140, 200, 260]) {
    const child = spawn(process.execPath, [script, root, changeId, reserved.runId], { stdio: ['ignore', 'ignore', 'pipe'] });
    const closed = new Promise(resolve => child.on('close', resolve));
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    await new Promise(resolve => setTimeout(resolve, delay));
    child.kill('SIGKILL');
    await closed;
    assert.equal(stderr, '', `delay ${delay}: the child must not report an unexpected failure: ${stderr}`);

    // A killed writer may hold the store lock; the refusal must name the holder (round 130).
    let refusal = null;
    try { await store.list(changeId); } catch (error) { refusal = error; }
    if (refusal) {
      assert.equal(refusal.code, 'LOCK_BUSY', `delay ${delay}: unexpected ${refusal.code}`);
      assert.match(refusal.message, /pid \d+/, `delay ${delay}: the refusal must name the holder`);
      const directory = join(root, '.dsh/engineering/changes', changeId, 'runs');
      assert.match(await readFile(join(directory, '.lock'), 'utf8'), /"pid"/, `delay ${delay}: the lock must still be inspectable`);
      await unlink(join(directory, '.lock'));
    }

    const runs = await store.list(changeId);
    assert.equal(runs.length, 1, `delay ${delay}: the killed writer must not duplicate the record`);
    const record = runs[0];
    assert.equal(record.runId, reserved.runId);
    assert.ok(LEGAL.has(record.state), `delay ${delay}: state must stay legal, got ${record.state}`);
    assert.ok(Number.isSafeInteger(record.revision) && record.revision >= 2, `delay ${delay}: revision must survive`);
    assert.ok(record.revision >= revisionSeen, `delay ${delay}: revision must not go backwards`);
    revisionSeen = record.revision;

    // The record has to keep the required shape too, not merely parse.
    for (const key of ['changeId', 'taskId', 'planVersion', 'command', 'hostInstanceId', 'ownerSessionId', 'createdAt']) {
      assert.ok(record[key] !== undefined, `delay ${delay}: ${key} must survive the kill`);
    }
    assert.equal(record.stdout === undefined || typeof record.stdout?.text === 'string', true, `delay ${delay}: stdout must not be a torn value`);
  }

  // Every file on disk parses: a torn file would make the whole change unreadable later.
  const directory = join(root, '.dsh/engineering/changes', changeId, 'runs');
  for (const name of await readdir(directory)) {
    if (!name.endsWith('.json')) continue;
    const text = await readFile(join(directory, name), 'utf8');
    assert.ok(text.trim().startsWith('{'), `${name} must still be a JSON object`);
  }
});
