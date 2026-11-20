import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CONTENTION_CODES, isLockContention, lockFileState } from '../src/lock-retry.js';

test('Windows lock contention codes are treated as contention, everything else is not', () => {
  assert.deepEqual(CONTENTION_CODES, ['EEXIST', 'EPERM', 'EACCES', 'EBUSY']);
  for (const code of CONTENTION_CODES) assert.equal(isLockContention({ code }), true, code);
  for (const code of ['ENOENT', 'EIO', 'PATH_UNSAFE', 'LOCK_BUSY', undefined, null, '']) {
    assert.equal(isLockContention(code && { code }), false, String(code));
  }
  assert.equal(isLockContention(undefined), false);
  assert.equal(isLockContention(new Error('no code')), false);
});

test('lockFileState reports a vanished lock and rejects links or directories', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lock-retry-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const lock = path.join(root, '.lock');

  assert.equal(await lockFileState(lock), null, 'missing lock reads as released');

  await fs.writeFile(lock, '{}');
  const stat = await lockFileState(lock);
  assert.ok(stat?.isFile(), 'a held lock is returned');
  assert.equal(stat.nlink, 1);

  await fs.unlink(lock);
  await fs.mkdir(lock);
  await assert.rejects(lockFileState(lock), error => error.code === 'PATH_UNSAFE');

  await fs.rm(lock, { recursive: true });
  await fs.writeFile(path.join(root, 'target'), 'x');
  // A file symlink needs privilege on Windows; use a junction there instead.
  await fs.symlink(path.join(root, 'target'), lock, process.platform === 'win32' ? 'junction' : 'file');
  await assert.rejects(lockFileState(lock), error => error.code === 'PATH_UNSAFE');
});

test('a hardlinked lock is refused before anything is written into it', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lock-retry-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const lock = path.join(root, '.lock'), target = path.join(root, 'target');
  await fs.writeFile(target, 'held');
  await fs.link(target, lock);
  await assert.rejects(lockFileState(lock), error => error.code === 'PATH_UNSAFE', 'nlink 2 is tampering');
  await assert.rejects(fs.open(lock, 'wx', 0o600), error => error.code === 'EEXIST', 'O_EXCL refuses the pre-created link');
  assert.equal(await fs.readFile(target, 'utf8'), 'held', 'target untouched');
});
