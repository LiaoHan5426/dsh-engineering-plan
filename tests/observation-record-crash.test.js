import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

import { GitObservationStore } from '../src/git-observation-store.js';

/**
 * The last store that had no injection: observations are created once and never
 * updated, so the window is a single write per request. A torn observation file
 * would make `list` fail for the whole change, and the approval baseline plus the
 * scope audit both read it.
 */

const CHANGE = '33333333-3333-4333-8333-333333333333';
const URL_STORE = JSON.stringify(new URL('../src/git-observation-store.js', import.meta.url).href);

const CHILD = `
import { GitObservationStore } from ${URL_STORE};
const [root, changeId] = [process.argv[2], process.argv[3]];
const store = new GitObservationStore(root);
const base = {
  schemaVersion: 1, changeId, planVersion: 1, sourceRevision: 2,
  actor: { kind: 'agent', id: 'agent-a' }, capturedAt: '2026-01-01T00:00:00.000Z',
  finishedAt: '2026-01-01T00:00:01.000Z', workspaceRoot: '/workspace', repositoryRoot: '/workspace',
  collectorVersion: 'git-observation-v1', status: 'ok', head: 'c'.repeat(40), headState: 'commit', dirty: false,
  scope: { tracked: 'git-diff', untracked: 'paths-only', ignored: 'excluded', excludedPaths: ['.dsh'] },
  stagedDiffSha256: 'a'.repeat(64), worktreeDiffSha256: 'a'.repeat(64), untrackedPathsSha256: 'a'.repeat(64),
  untrackedCount: 0, limitations: [], error: null,
};
for (let round = 0; round < 5000; round += 1) {
  await store.create(changeId, { ...base, id: crypto.randomUUID(), limitations: ['x'.repeat(1200) + round] },
    { requestId: 'req-obs-' + round, ownerSessionId: 'session-a' });
}
`;

test('an observation record is never left half-written', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ep-observation-crash-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new GitObservationStore(root);
  const script = join(root, 'child.mjs');
  await writeFile(script, CHILD);
  const directory = join(root, '.dsh/engineering/changes', CHANGE, 'git-observations');

  // Killing at a fixed wall-clock offset made this test depend on Node's startup time:
  // under a full-suite load the child had not written anything yet and the assertion below
  // failed. Wait until a file actually exists, then kill after a small jitter.
  const countObservations = async () => {
    try { return (await readdir(directory)).filter(name => name.endsWith('.json')).length; } catch { return 0; }
  };
  const waitForMoreThan = async (wanted, timeoutMs = 15000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await countObservations() > wanted) return true;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    return false;
  };

  let seen = 0;
  for (const delay of [0, 40]) {
    const child = spawn(process.execPath, [script, root, CHANGE], { stdio: ['ignore', 'ignore', 'pipe'] });
    const closed = new Promise(resolve => child.on('close', resolve));
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    assert.ok(await waitForMoreThan(seen), 'delay ' + delay + ': the child must write past the observations already on disk');
    await new Promise(resolve => setTimeout(resolve, delay));
    child.kill('SIGKILL');
    await closed;
    assert.equal(stderr, '', `delay ${delay}: the child must not fail unexpectedly: ${stderr}`);

    let refusal = null;
    try { await store.list(CHANGE); } catch (error) { refusal = error; }
    if (refusal) {
      assert.equal(refusal.code, 'LOCK_BUSY', `delay ${delay}: unexpected ${refusal.code}`);
      assert.match(refusal.message, /pid \d+|names no holder/, `delay ${delay}: the refusal must identify the holder or say it cannot`);
      await unlink(join(directory, '.lock'));
    }

    const envelopes = await store.list(CHANGE);
    assert.ok(envelopes.length > seen, `delay ${delay}: the killed writer must have written something before dying`);
    seen = envelopes.length;
    for (const envelope of envelopes) {
      assert.equal(envelope.observation.changeId, CHANGE, `delay ${delay}: every envelope must belong to this change`);
      assert.equal(typeof envelope.requestId, 'string', `delay ${delay}: the request binding must survive`);
      assert.equal(envelope.observation.head.length, 40, `delay ${delay}: fixed-width fields must survive as whole values`);
      assert.ok(Array.isArray(envelope.observation.limitations), `delay ${delay}: limitations must stay an array`);
      assert.match(envelope.observation.id, /^[0-9a-f-]{36}$/i, `delay ${delay}: the id must stay a uuid`);
    }
    // Replays stay bound to their own request: a torn or renamed file would break this.
    const requests = new Set(envelopes.map(envelope => envelope.requestId));
    assert.equal(requests.size, envelopes.length, `delay ${delay}: one request must not yield two observations`);
  }

  for (const name of await readdir(directory)) {
    if (!name.endsWith('.json')) continue;
    assert.ok((await readFile(join(directory, name), 'utf8')).trim().startsWith('{'), `${name} must still be a JSON object`);
  }
});
