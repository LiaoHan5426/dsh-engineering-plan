import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

import { EngineeringStore } from '../src/core.js';

/**
 * The in-process queue cannot prove cross-process safety: three separate Node processes hammer the
 * same change through the same file locks. The count assertion is the point — if a write is lost,
 * the final revision is smaller than the number of acknowledged writes.
 */

const AGENT = { kind: 'agent', id: 'concurrency-driver' };

const WORKER = `
import { EngineeringStore } from ${JSON.stringify(new URL('../src/core.js', import.meta.url).href)};

const [root, changeId, rounds, tag] = [process.argv[2], process.argv[3], Number(process.argv[4]), process.argv[5]];
const store = new EngineeringStore(root);
const actor = { kind: 'agent', id: 'worker-' + tag };
let acknowledged = 0;
let refused = 0;

for (let attempt = 0; attempt < rounds; attempt += 1) {
  for (let retry = 0; retry < 200; retry += 1) {
    const current = (await store.execute({ action: 'get', changeId }, actor)).change;
    try {
      await store.execute({
        action: 'save',
        changeId,
        expectedRevision: current.revision,
        patch: { documents: { proposal: tag + '-' + attempt } },
      }, actor);
      acknowledged += 1;
      break;
    } catch (error) {
      if (error.code === 'REVISION_CONFLICT') { refused += 1; continue; }
      throw error;
    }
  }
}

process.stdout.write(JSON.stringify({ acknowledged, refused }));
`;

async function runWorker(workerPath, root, changeId, rounds, tag) {
  const child = spawn(process.execPath, [workerPath, root, changeId, String(rounds), tag], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stdout.on('data', chunk => { out += chunk; });
  child.stderr.on('data', chunk => { err += chunk; });
  const code = await new Promise(resolve => child.on('close', resolve));
  assert.equal(code, 0, `worker ${tag} exited ${code}: ${err}`);
  return JSON.parse(out);
}

test('three processes writing the same change never lose an acknowledged write', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ep-concurrency-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new EngineeringStore(root);
  const created = await store.execute({ action: 'create', title: 'concurrency', goal: 'no lost writes', mode: 'lite' }, AGENT);

  const workerPath = join(root, 'worker.mjs');
  await writeFile(workerPath, WORKER);

  const rounds = 12;
  const results = await Promise.all(['a', 'b', 'c'].map(tag => runWorker(workerPath, root, created.change.id, rounds, tag)));

  const acknowledged = results.reduce((sum, item) => sum + item.acknowledged, 0);
  assert.equal(acknowledged, rounds * 3, 'every worker must finish its rounds');

  const raw = await readFile(join(root, '.dsh/engineering/changes', created.change.id, 'state.json'), 'utf8');
  const state = JSON.parse(raw);
  assert.equal(state.revision, created.change.revision + acknowledged,
    `${acknowledged} acknowledged saves must each advance the revision exactly once`);
  assert.match(state.documents.proposal, /^[abc]-\d+$/, 'the final document must be one whole worker value, not a torn write');

  const listed = await store.execute({ action: 'list' }, AGENT);
  assert.deepEqual(listed.warnings, []);
  assert.equal(listed.changes.length, 1);
});
