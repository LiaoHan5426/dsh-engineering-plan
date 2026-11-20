import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, readdir, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

import { EngineeringStore } from '../src/core.js';

/**
 * atomic() writes a temp file, fsyncs, then renames. The claim I made in VERIFICATION is stronger
 * than "it looks atomic": a process killed mid-write must never leave a half-written state.json.
 * So kill a writer at random moments and read the file back every time.
 */

const AGENT = { kind: 'agent', id: 'crash-driver' };

const WORKER = `
import { EngineeringStore } from ${JSON.stringify(new URL('../src/core.js', import.meta.url).href)};
const [root, changeId] = [process.argv[2], process.argv[3]];
const store = new EngineeringStore(root);
const actor = { kind: 'agent', id: 'crash-worker' };
for (let round = 0; round < 5000; round += 1) {
  const current = (await store.execute({ action: 'get', changeId }, actor)).change;
  try {
    await store.execute({
      action: 'save', changeId, expectedRevision: current.revision,
      patch: { documents: { proposal: 'round-' + round + '-' + 'x'.repeat(2000) } },
    }, actor);
  } catch (error) {
    if (error.code !== 'REVISION_CONFLICT') throw error;
  }
}
`;

async function killDuringWrites(workerPath, root, changeId, delayMs) {
  const child = spawn(process.execPath, [workerPath, root, changeId], { stdio: ['ignore', 'ignore', 'pipe'] });
  const closed = new Promise(resolve => child.on('close', resolve));
  let err = '';
  child.stderr.on('data', chunk => { err += chunk; });
  await new Promise(resolve => setTimeout(resolve, delayMs));
  child.kill('SIGKILL');
  await closed;
  return err;
}

test('a writer killed mid-save never leaves a half-written state', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ep-crash-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new EngineeringStore(root);
  const created = await store.execute({ action: 'create', title: 'crash', goal: 'no torn state', mode: 'lite' }, AGENT);
  const directory = join(root, '.dsh/engineering/changes', created.change.id);
  const workerPath = join(root, 'worker.mjs');
  await writeFile(workerPath, WORKER);

  let previousRevision = created.change.revision;
  for (const delay of [120, 180, 240, 300]) {
    await killDuringWrites(workerPath, root, created.change.id, delay);
    const raw = await readFile(join(directory, 'state.json'), 'utf8');
    const state = JSON.parse(raw);
    assert.equal(state.id, created.change.id, `delay ${delay}: state must still belong to this change`);
    assert.ok(state.revision >= previousRevision, `delay ${delay}: revision must not go backwards (${previousRevision} -> ${state.revision})`);
    previousRevision = state.revision;
    assert.match(state.documents.proposal, /^(|round-\d+-x+)$/, `delay ${delay}: the proposal must be empty or a whole value`);
    if (state.documents.proposal) {
      // The worker writes `round-<n>-` plus 2000 characters; the round number grows past 9,
      // so the assertion has to come from the value itself rather than a fixed total length.
      const whole = state.documents.proposal.match(/^round-(\d+)-(x+)$/);
      assert.ok(whole, `delay ${delay}: a whole value must match the writer's pattern, got ${state.documents.proposal.length} chars`);
      assert.equal(whole[2].length, 2000, `delay ${delay}: a partial write would cut the payload short`);
    }
    // A SIGKILLed writer also dies while holding .lock, which is released in a finally block.
    // The lock must identify its holder so an operator can decide, and it must not be removed
    // automatically (PID reuse makes "the pid is gone" weaker evidence than it looks).
    const lockPath = join(directory, '.lock');
    let lockText = null;
    try { lockText = await readFile(lockPath, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (lockText !== null) {
      // A writer killed between open() and its metadata write leaves a readable but empty lock:
      // no pid survives, and the file's timestamp is the only evidence of when it was taken.
      let holder = null;
      try { holder = JSON.parse(lockText); } catch { holder = null; }
      if (holder) {
        assert.ok(Number.isSafeInteger(holder.pid), `delay ${delay}: a lock with content must name its pid`);
        assert.match(holder.createdAt ?? '', /^\d{4}-\d{2}-\d{2}T/, `delay ${delay}: the surviving lock must name when it was taken`);
      }
      // `get` itself takes the change lock, so the expected revision comes from the file we just parsed.
      await store.execute({
        action: 'save', changeId: created.change.id, expectedRevision: state.revision,
        patch: { documents: { proposal: 'blocked-by-stale-lock' } },
      }, AGENT).then(
        () => { throw new Error(`delay ${delay}: a stale lock must not be ignored silently`); },
        (error) => {
          assert.equal(error.code, 'LOCK_BUSY', `delay ${delay}: expected LOCK_BUSY, got ${error.code}`);
          if (holder) assert.match(error.message, new RegExp(`pid ${holder.pid}`), `delay ${delay}: the refusal must name the holder`);
          else assert.match(error.message, /names no holder/, `delay ${delay}: an empty lock must be reported as naming nobody`);
          if (holder) {
            assert.match(error.message, /no longer running|still appears to be running/,
              `delay ${delay}: the refusal must say what is known about the holder`);
          }
        },
      );
      // Only after that diagnosis does the operator remove it — this is what the message asks for.
      await rm(lockPath, { force: true });
    }
    const listed = await store.execute({ action: 'list' }, AGENT);
    assert.deepEqual(listed.warnings, [], `delay ${delay}: a killed writer must not leave an entry the reader calls corrupt`);
  }

  assert.ok(previousRevision > created.change.revision,
    'the worker must have saved at least once before the first kill, otherwise this test only proves that an idle file stays intact');

  // A killed writer cannot clean up after itself: leftovers are expected and must be harmless.
  const leftovers = (await readdir(directory)).filter(name => name.endsWith('.tmp'));
  for (const name of leftovers) {
    assert.match(name, /^state\.json\.[0-9a-f-]+\.tmp$/, 'only our own state temp files may remain');
  }
  const afterKills = await store.execute({ action: 'list' }, AGENT);
  assert.deepEqual(afterKills.warnings, [], 'leftover temp files must not make the change look corrupt');

  // A stale temp file must not accumulate forever: the next successful write clears old ones.
  if (leftovers.length) {
    const stale = join(directory, leftovers[0]);
    const old = new Date(Date.now() - 60 * 60 * 1000);
    await utimes(stale, old, old);
    const current = (await store.execute({ action: 'get', changeId: created.change.id }, AGENT)).change;
    await store.execute({
      action: 'save', changeId: created.change.id, expectedRevision: current.revision,
      patch: { documents: { proposal: 'after-cleanup' } },
    }, AGENT);
    const remaining = (await readdir(directory)).filter(name => name.endsWith('.tmp'));
    assert.equal(remaining.includes(leftovers[0]), false, 'a temp file older than the threshold must be removed by the next save');
  }
});


test('a lock left by a dead process is refused with the holder named', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ep-lock-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new EngineeringStore(root);
  const created = await store.execute({ action: 'create', title: 'lock', goal: 'diagnose stale lock', mode: 'lite' }, AGENT);
  const directory = join(root, '.dsh/engineering/changes', created.change.id);

  // Take a real pid, then let it exit: "is this process alive" is the only fact we report.
  const dead = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' });
  const deadPid = dead.pid;
  await new Promise(resolve => dead.on('close', resolve));

  const createdAt = '2026-01-01T00:00:00.000Z';
  await writeFile(join(directory, '.lock'), JSON.stringify({ pid: deadPid, createdAt }));

  const change = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8'));
  await assert.rejects(
    store.execute({
      action: 'save', changeId: created.change.id, expectedRevision: change.revision,
      patch: { documents: { proposal: 'blocked' } },
    }, AGENT),
    (error) => {
      assert.equal(error.code, 'LOCK_BUSY');
      assert.match(error.message, new RegExp(`pid ${deadPid}`), 'the refusal must name the holder');
      assert.match(error.message, /no longer running/, 'a dead holder must be reported as such');
      assert.match(error.message, /Remove \.lock only after confirming/, 'the message must not imply automatic removal');
      return true;
    },
  );

  // Refusing is correct: the lock stays, so a human decision is still required.
  assert.ok(await readFile(join(directory, '.lock'), 'utf8').then(() => true, () => false), 'the lock must survive the refusal');
});
