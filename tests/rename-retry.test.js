import test from 'node:test';
import assert from 'node:assert/strict';

import { RENAME_RETRY_CODES, renameWithRetry } from '../src/lock-retry.js';

/**
 * A rename onto an existing file can fail on Windows while another process holds it open
 * (measured: the invariants stream hit `progress.md.tmp -> progress.md` with EPERM).
 * The retry has to be bounded, and it must not swallow a real failure into a different code.
 */

const failWith = (code, times) => {
  const calls = [];
  const rename = async (from, to) => {
    calls.push([from, to]);
    if (calls.length <= times) throw Object.assign(new Error(`${code}: operation not permitted`), { code });
    return undefined;
  };
  return { rename, calls };
};

test('a transient rename failure is retried until it succeeds', async () => {
  const { rename, calls } = failWith('EPERM', 2);
  const attempts = await renameWithRetry('a.tmp', 'a', { rename, delayMs: 1 });
  assert.equal(attempts, 3);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0], ['a.tmp', 'a']);
});

test('every documented contention code is retried', async () => {
  for (const code of RENAME_RETRY_CODES) {
    const { rename, calls } = failWith(code, 1);
    assert.equal(await renameWithRetry('b.tmp', 'b', { rename, delayMs: 1 }), 2, `${code} must be retried`);
    assert.equal(calls.length, 2);
  }
});

test('a failure that is not contention is not retried', async () => {
  const { rename, calls } = failWith('ENOSPC', 1);
  await assert.rejects(() => renameWithRetry('c.tmp', 'c', { rename, delayMs: 1 }), (error) => error.code === 'ENOSPC');
  assert.equal(calls.length, 1);
});

test('the retry is bounded and surfaces the original code', async () => {
  const { rename, calls } = failWith('EBUSY', 99);
  await assert.rejects(
    () => renameWithRetry('d.tmp', 'd', { rename, attempts: 3, delayMs: 1 }),
    (error) => error.code === 'EBUSY',
  );
  assert.equal(calls.length, 3);
});

test('the writers go through the shared retry instead of calling rename directly', async () => {
  const { readFileSync } = await import('node:fs');
  for (const file of ['src/core.js', 'src/verification-store.js', 'src/dispatch-store.js', 'src/git-observation-store.js']) {
    const source = readFileSync(`J:/Code/Engineering Planner/${file}`, 'utf8');
    assert.doesNotMatch(source, /await fs\.rename\(temporary/, `${file} must use renameWithRetry`);
    assert.match(source, /renameWithRetry\(temporary, file\)/, `${file} must rename through the helper`);
  }
});
