import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

import { VerificationRunStore } from '../src/verification-store.js';
import { DispatchRunStore } from '../src/dispatch-store.js';
import { lockHolder, staleLockMessage, cleanTemporaries } from '../src/lock-retry.js';

/**
 * The state file is not the only thing a crash can interrupt: every run store
 * writes JSON under its own lock. Round 129 taught the same lesson for
 * state.json, so the same two properties have to hold here — otherwise a killed
 * verification leaves a change that can never be dispatched or verified again.
 */

async function deadPid() {
  const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' });
  const pid = child.pid;
  await new Promise(resolve => child.on('close', resolve));
  return pid;
}

test('a stale run-store lock names its holder instead of a bare refusal', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ep-store-lock-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new VerificationRunStore(root);
  const directory = join(root, '.dsh/engineering/changes/change-a/runs');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(directory, { recursive: true });

  const pid = await deadPid();
  await writeFile(join(directory, '.lock'), JSON.stringify({ pid, createdAt: '2026-01-01T00:00:00.000Z' }));

  await assert.rejects(
    store.reserve({
      changeId: 'change-a', taskId: 'T1', planVersion: 1, commandIndex: 0, command: 'echo a',
      requestId: 'req-lock-probe', hostInstanceId: 'host-a', ownerSessionId: 'session-a',
    }),
    (error) => {
      assert.equal(error.code, 'LOCK_BUSY');
      assert.match(error.message, new RegExp(`pid ${pid}`), 'the refusal must name the holder');
      assert.match(error.message, /no longer running/, 'a dead holder must be reported as such');
      assert.match(error.message, /Remove \.lock only after confirming/, 'nothing may be removed automatically');
      return true;
    },
  );
  assert.ok(await readFile(join(directory, '.lock'), 'utf8').then(() => true, () => false), 'the lock must survive the refusal');
});

test('both run stores remove only their own old temp files', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ep-store-tmp-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, '.dsh/engineering/changes/change-a/verifications');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(directory, { recursive: true });

  const old = join(directory, 'run.json.11111111-1111-4111-8111-111111111111.tmp');
  const fresh = join(directory, 'run.json.22222222-2222-4222-8222-222222222222.tmp');
  const foreign = join(directory, 'notes.txt');
  await writeFile(old, '{}');
  await writeFile(fresh, '{}');
  await writeFile(foreign, 'keep me');
  const backdated = new Date(Date.now() - 60 * 60 * 1000);
  await utimes(old, backdated, backdated);

  const removed = await cleanTemporaries(directory);
  assert.deepEqual(removed, ['run.json.11111111-1111-4111-8111-111111111111.tmp'], 'only the old temp file may be removed');
  assert.ok(await readFile(fresh, 'utf8').then(() => true, () => false), 'a temp file inside the threshold belongs to a live writer');
  assert.ok(await readFile(foreign, 'utf8').then(() => true, () => false), 'unrelated files are never touched');

  // Both stores share the helper, so neither can drift back to leaving debris behind.
  const source = await readFile(new URL('../src/dispatch-store.js', import.meta.url), 'utf8');
  assert.match(source, /await cleanTemporaries\(path\.dirname\(file\)\)/, 'the dispatch store must clean before writing');
});

test('the shared message stays honest when the holder cannot be read', () => {
  assert.match(staleLockMessage('Change', null), /vanished while being read/);
  assert.match(staleLockMessage('Change', { pid: null, createdAt: '2026-01-01T00:00:00.000Z', alive: null, unreadable: true }),
    /names no holder \(last modified 2026-01-01T00:00:00.000Z\)/, 'an empty lock still says when it was taken');
  assert.match(staleLockMessage('Change', { pid: 7, createdAt: null, alive: null }),
    /pid 7; liveness could not be checked/, 'an unknown liveness must not be reported as stale');
  assert.match(staleLockMessage('Change', { pid: 7, createdAt: null, alive: true }),
    /still appears to be running/, 'a live holder must not be called stale');
});
