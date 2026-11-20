import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { GitObservationStore } from '../src/git-observation-store.js';

const CHANGE = '22222222-2222-4222-8222-222222222222';
const OPTIONS = { requestId: 'request-a', ownerSessionId: 'session-a' };
const rejects = (promise, code) => assert.rejects(promise, error => error.code === code);
function observation(extra = {}) {
  return {
    schemaVersion: 1, id: randomUUID(), changeId: CHANGE, planVersion: 1, sourceRevision: 2,
    actor: { kind: 'agent', id: 'agent-a' }, capturedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:01.000Z', workspaceRoot: '/workspace', repositoryRoot: '/workspace',
    collectorVersion: 'git-observation-v1', status: 'ok', head: 'c'.repeat(40), headState: 'commit', dirty: false,
    scope: { tracked: 'git-diff', untracked: 'paths-only', ignored: 'excluded', excludedPaths: ['.dsh'] },
    stagedDiffSha256: 'a'.repeat(64), worktreeDiffSha256: 'a'.repeat(64), untrackedPathsSha256: 'a'.repeat(64),
    untrackedCount: 0, limitations: [], error: null, ...extra,
  };
}
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'git-observation-store-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dir = path.join(root, '.dsh', 'engineering', 'changes', CHANGE, 'git-observations');
  return { root, dir, store: new GitObservationStore(root), file: record => path.join(dir, `${record.id.toLowerCase()}.json`) };
}

test('create returns detached frozen facts; reads return exact frozen envelopes', async t => {
  const f = await fixture(t), record = observation(), pending = f.store.create(CHANGE, record, OPTIONS);
  record.actor.id = 'mutated'; record.scope.excludedPaths.push('later');
  const result = await pending;
  assert.equal(result.created, true); assert.equal(result.observation.actor.id, 'agent-a');
  assert.deepEqual(result.observation.scope.excludedPaths, ['.dsh']);
  const expected = { schemaVersion: 1, ...OPTIONS, observation: result.observation };
  assert.deepEqual(JSON.parse(await fs.readFile(f.file(record), 'utf8')), expected);
  assert.deepEqual(await new GitObservationStore(f.root).get(CHANGE, record.id), expected);
  assert.deepEqual(await f.store.list(CHANGE), [expected]);
  const replay = await f.store.findRequest(CHANGE, OPTIONS.requestId);
  assert.deepEqual(replay, expected);
  assert.throws(() => { replay.ownerSessionId = 'other'; }, TypeError);
  assert.throws(() => replay.observation.limitations.push('other'), TypeError);
  assert.equal(typeof f.store.update, 'undefined');
});

test('replay keeps original bytes and capture despite new id, contents and timestamps', async t => {
  const f = await fixture(t), record = observation();
  const original = await f.store.create(CHANGE, record, OPTIONS), bytes = await fs.readFile(f.file(record));
  const newer = observation({ dirty: true, capturedAt: '2026-02-01T00:00:00.000Z', finishedAt: '2026-02-01T00:00:01.000Z' });
  assert.deepEqual(await f.store.create(CHANGE, newer, OPTIONS), { observation: original.observation, created: false });
  assert.deepEqual(await fs.readFile(f.file(record)), bytes);
  assert.deepEqual(await fs.readdir(f.dir), [`${record.id}.json`]);
  await rejects(f.store.create(CHANGE, observation({ status: 'forged' }), OPTIONS), 'INVALID_GIT_OBSERVATION');
  for (const patch of [{ planVersion: 2 }, { sourceRevision: 3 }]) await rejects(f.store.create(CHANGE, observation(patch), OPTIONS), 'REQUEST_CONFLICT');
  await rejects(f.store.create(CHANGE, observation(), { ...OPTIONS, ownerSessionId: 'other' }), 'REQUEST_CONFLICT');
  await rejects(f.store.create(CHANGE, record, { ...OPTIONS, requestId: 'other' }), 'OBSERVATION_CONFLICT');
  assert.deepEqual(await fs.readFile(f.file(record)), bytes);
});

test('concurrent instances deduplicate exactly once', async t => {
  const f = await fixture(t);
  const results = await Promise.all(Array.from({ length: 12 }, () => new GitObservationStore(f.root).create(CHANGE, observation(), OPTIONS)));
  assert.equal(results.filter(value => value.created).length, 1);
  assert.equal(new Set(results.map(value => value.observation.id)).size, 1);
  assert.equal((await f.store.list(CHANGE)).length, 1);
});

test('cross-process lock deduplicates capture records', async t => {
  const f = await fixture(t), moduleURL = new URL('../src/git-observation-store.js', import.meta.url).href;
  const child = () => new Promise((resolve, reject) => {
    const source = `import { GitObservationStore } from ${JSON.stringify(moduleURL)}; console.log(JSON.stringify(await new GitObservationStore(${JSON.stringify(f.root)}).create(${JSON.stringify(CHANGE)}, ${JSON.stringify(observation())}, ${JSON.stringify(OPTIONS)})));`;
    const processHandle = spawn(process.execPath, ['--input-type=module', '-e', source]);
    let out = '', err = '';
    processHandle.stdout.on('data', value => out += value); processHandle.stderr.on('data', value => err += value);
    processHandle.on('error', reject);
    processHandle.on('close', code => { if (code) reject(new Error(err)); else { try { resolve(JSON.parse(out)); } catch (error) { reject(error); } } });
  });
  const results = await Promise.all([child(), child(), child()]);
  assert.equal(results.filter(value => value.created).length, 1);
  assert.equal(new Set(results.map(value => value.observation.id)).size, 1);
});

test('workspaces and changes isolate request namespaces', async t => {
  const a = await fixture(t), b = await fixture(t), record = observation();
  await a.store.create(CHANGE, record, OPTIONS);
  assert.equal(await b.store.findRequest(CHANGE, OPTIONS.requestId), null);
  await rejects(b.store.get(CHANGE, record.id), 'NOT_FOUND');
  assert.equal((await b.store.create(CHANGE, record, { ...OPTIONS, ownerSessionId: 'other' })).created, true);
  assert.equal((await a.store.findRequest(CHANGE, OPTIONS.requestId)).ownerSessionId, OPTIONS.ownerSessionId);
  const other = randomUUID();
  assert.equal((await a.store.create(other, observation({ changeId: other }), OPTIONS)).created, true);
});

test('UUID path validation, request regex and metadata descriptors reject forged input', async t => {
  const f = await fixture(t);
  for (const id of ['../escape', '..', 'a/b', 'a\\b', 'C:escape', 'CON', 'nul', '', 'x'.repeat(36)]) {
    await rejects(f.store.get(CHANGE, id), 'INVALID_ID');
    await rejects(f.store.list(id), 'INVALID_ID');
    await rejects(f.store.create(id, observation(), OPTIONS), 'INVALID_ID');
  }
  for (const id of ['../escape', '', 'CON', 'a'.repeat(81), 'with space']) {
    await rejects(f.store.create(CHANGE, observation(), { ...OPTIONS, requestId: id }), 'INVALID_ID');
    await rejects(f.store.findRequest(CHANGE, id), 'INVALID_ID');
  }
  for (const ownerSessionId of ['', ' ', null, 2, 'a\0b']) await rejects(f.store.create(CHANGE, observation(), { ...OPTIONS, ownerSessionId }), 'INVALID_INPUT');
  await rejects(f.store.create(CHANGE, observation({ changeId: randomUUID() }), OPTIONS), 'INVALID_INPUT');
  await rejects(f.store.create(CHANGE, observation({ approval: true }), OPTIONS), 'INVALID_GIT_OBSERVATION');
  for (const input of [{ ...OPTIONS, schemaVersion: 1 }, { requestId: 'x' }, null, [], Object.assign(Object.create({ x: 1 }), OPTIONS)]) await rejects(f.store.create(CHANGE, observation(), input), 'INVALID_INPUT');
  let invoked = false;
  const getter = Object.defineProperty({ ...OPTIONS }, 'ownerSessionId', { enumerable: true, get() { invoked = true; return 'x'; } });
  await rejects(f.store.create(CHANGE, observation(), getter), 'INVALID_INPUT'); assert.equal(invoked, false);
  const record = observation({ id: 'ABCDEFAB-1234-4123-8123-ABCDEFABCDEF' });
  await f.store.create(CHANGE, record, OPTIONS);
  assert.deepEqual((await f.store.get(CHANGE, record.id.toLowerCase())).observation, record);
  assert.equal((await f.store.list(CHANGE)).length, 1);
});

test('forged envelope metadata, identity and nested fields fail closed on all reads', async t => {
  const f = await fixture(t), record = observation(); await f.store.create(CHANGE, record, OPTIONS);
  const original = JSON.parse(await fs.readFile(f.file(record), 'utf8'));
  const invalid = [
    { ...original, schemaVersion: 2 }, { ...original, ownerSessionId: '' }, { ...original, requestId: '../x' },
    { ...original, approved: true }, { ...original, observation: { ...record, id: randomUUID() } },
    { ...original, observation: { ...record, changeId: randomUUID() } },
    { ...original, observation: { ...record, planVersion: 0 } },
    { ...original, observation: { ...record, actor: { ...record.actor, trusted: true } } },
    Object.fromEntries(Object.entries(original).filter(([key]) => key !== 'ownerSessionId')),
  ];
  for (const value of invalid) {
    await fs.writeFile(f.file(record), JSON.stringify(value));
    await rejects(f.store.get(CHANGE, record.id), 'CORRUPT_STATE');
    await rejects(f.store.list(CHANGE), 'CORRUPT_STATE');
    await rejects(f.store.findRequest(CHANGE, OPTIONS.requestId), 'CORRUPT_STATE');
    await rejects(f.store.create(CHANGE, observation(), OPTIONS), 'CORRUPT_STATE');
  }
});

test('malformed JSON, invalid UTF-8, oversize and duplicate requests fail closed', async t => {
  const f = await fixture(t), record = observation();
  await rejects(f.store.create(CHANGE, observation({ limitations: ['x'.repeat(1024 * 1024)] }), OPTIONS), 'STATE_TOO_LARGE');
  assert.deepEqual(await f.store.list(CHANGE), []);
  await f.store.create(CHANGE, record, OPTIONS);
  const original = await fs.readFile(f.file(record));
  for (const data of ['{broken', 'x'.repeat(1024 * 1024 + 1), Buffer.from([0xff, 0xfe])]) {
    await fs.writeFile(f.file(record), data);
    await rejects(f.store.get(CHANGE, record.id), 'CORRUPT_STATE');
    await rejects(f.store.findRequest(CHANGE, OPTIONS.requestId), 'CORRUPT_STATE');
  }
  await fs.writeFile(f.file(record), original);
  const other = observation(), duplicate = { schemaVersion: 1, ...OPTIONS, observation: other };
  await fs.writeFile(f.file(other), JSON.stringify(duplicate));
  await rejects(f.store.list(CHANGE), 'CORRUPT_STATE');
  await rejects(f.store.create(CHANGE, observation(), OPTIONS), 'CORRUPT_STATE');
  await fs.unlink(f.file(other)); await fs.writeFile(path.join(f.dir, 'not-a-uuid.json'), '{}');
  await rejects(f.store.list(CHANGE), 'CORRUPT_STATE');
});

test('junction or symlink storage ancestors reject without writes outside workspace', async t => {
  const f = await fixture(t), outside = await fixture(t);
  await fs.symlink(outside.root, path.join(f.root, '.dsh'), process.platform === 'win32' ? 'junction' : 'dir');
  await rejects(f.store.create(CHANGE, observation(), OPTIONS), 'PATH_UNSAFE');
  await rejects(f.store.list(CHANGE), 'PATH_UNSAFE');
  await rejects(f.store.get(CHANGE, randomUUID()), 'PATH_UNSAFE');
  assert.deepEqual(await fs.readdir(outside.root), []);
});

test('linked record, directory masquerading as record and linked lock reject', async t => {
  const f = await fixture(t), record = observation(); await f.store.create(CHANGE, record, OPTIONS);
  const target = path.join(f.root, 'hardlink'); await fs.link(f.file(record), target);
  await rejects(f.store.get(CHANGE, record.id), 'PATH_UNSAFE');
  await rejects(f.store.create(CHANGE, observation(), OPTIONS), 'PATH_UNSAFE');
  await fs.unlink(target);
  await fs.link(f.file(record), path.join(f.dir, '.lock'));
  await rejects(f.store.list(CHANGE), 'PATH_UNSAFE'); await fs.unlink(path.join(f.dir, '.lock'));
  await fs.unlink(f.file(record)); await fs.mkdir(f.file(record));
  await rejects(f.store.get(CHANGE, record.id), 'PATH_UNSAFE');
  await rejects(f.store.create(CHANGE, observation(), OPTIONS), 'PATH_UNSAFE');
  assert.equal((await fs.readdir(f.dir)).some(name => name === '.lock' || name.endsWith('.tmp')), false);
});

test('stale lock times out intact; observation reads and other stores stay independent', async t => {
  const f = await fixture(t), record = observation(); await f.store.create(CHANGE, record, OPTIONS);
  const lock = path.join(f.dir, '.lock'), bytes = '{"pid":99999999}'; await fs.writeFile(lock, bytes);
  await rejects(f.store.create(CHANGE, observation(), OPTIONS), 'LOCK_BUSY');
  assert.equal(await fs.readFile(lock, 'utf8'), bytes);
  assert.deepEqual((await f.store.get(CHANGE, record.id)).observation, record);
  await fs.unlink(lock);
  const dispatch = path.join(path.dirname(f.dir), 'dispatches'); await fs.mkdir(dispatch);
  await fs.writeFile(path.join(dispatch, '.lock'), 'unrelated lock');
  assert.equal((await f.store.create(CHANGE, observation(), { ...OPTIONS, requestId: 'second' })).created, true);
});

test('persisted request intent binds action and exact baseline across restarted instances', async t => {
  const f = await fixture(t), baselineId = randomUUID(), record = observation();
  const options = { ...OPTIONS, request: { action: 'compare', baselineId } };
  await f.store.create(CHANGE, record, options);
  const bytes = await fs.readFile(f.file(record)), restarted = new GitObservationStore(f.root);
  assert.deepEqual((await restarted.get(CHANGE, record.id)).request, options.request);
  assert.deepEqual((await restarted.findRequest(CHANGE, OPTIONS.requestId)).request, options.request);
  assert.deepEqual((await restarted.list(CHANGE))[0].request, options.request);
  assert.equal((await restarted.create(CHANGE, observation(), options)).created, false);
  for (const request of [{ action: 'capture' }, { action: 'compare', baselineId: randomUUID() }]) {
    await rejects(restarted.create(CHANGE, observation(), { ...OPTIONS, request }), 'REQUEST_CONFLICT');
  }
  await rejects(restarted.create(CHANGE, observation(), OPTIONS), 'REQUEST_CONFLICT');
  assert.deepEqual(await fs.readFile(f.file(record)), bytes);
  const capture = { ...OPTIONS, requestId: 'capture', request: { action: 'capture' } };
  await restarted.create(CHANGE, observation(), capture);
  assert.equal((await new GitObservationStore(f.root).create(CHANGE, observation(), capture)).created, false);
  await rejects(restarted.create(CHANGE, observation(), { ...capture, request: options.request }), 'REQUEST_CONFLICT');
});

test('legacy envelopes remain readable but reject replay with newly supplied intent', async t => {
  const f = await fixture(t), record = observation(); await f.store.create(CHANGE, record, OPTIONS);
  const bytes = await fs.readFile(f.file(record)), restarted = new GitObservationStore(f.root);
  assert.equal(Object.hasOwn(await restarted.get(CHANGE, record.id), 'request'), false);
  assert.equal(Object.hasOwn((await restarted.list(CHANGE))[0], 'request'), false);
  assert.equal((await restarted.create(CHANGE, observation(), OPTIONS)).created, false);
  for (const request of [{ action: 'capture' }, { action: 'compare', baselineId: randomUUID() }]) {
    await rejects(restarted.create(CHANGE, observation(), { ...OPTIONS, request }), 'REQUEST_CONFLICT');
  }
  assert.deepEqual(await fs.readFile(f.file(record)), bytes);
});

test('optional request is strict, detached, frozen and revalidated from disk', async t => {
  const f = await fixture(t);
  const invalid = [undefined, null, [], {}, { action: 'unknown' }, { action: 'compare' },
    { action: 'capture', baselineId: randomUUID() },
    { action: 'compare', baselineId: randomUUID(), approved: true }];
  for (const request of invalid) await rejects(f.store.create(CHANGE, observation(), { ...OPTIONS, request }), 'INVALID_INPUT');
  await rejects(f.store.create(CHANGE, observation(), { ...OPTIONS, request: { action: 'compare', baselineId: '../bad' } }), 'INVALID_ID');
  let invoked = false;
  const getter = Object.defineProperty({}, 'action', { enumerable: true, get() { invoked = true; return 'capture'; } });
  await rejects(f.store.create(CHANGE, observation(), { ...OPTIONS, request: getter }), 'INVALID_INPUT');
  assert.equal(invoked, false);
  const record = observation(), options = { ...OPTIONS, request: { action: 'capture' } };
  const pending = f.store.create(CHANGE, record, options); options.request.action = 'mutated'; await pending;
  const persisted = await f.store.get(CHANGE, record.id);
  assert.deepEqual(persisted.request, { action: 'capture' });
  assert.throws(() => { persisted.request.action = 'mutated'; }, TypeError);
  for (const request of invalid.filter(value => value !== undefined)) {
    await fs.writeFile(f.file(record), JSON.stringify({ ...persisted, request }));
    await rejects(f.store.get(CHANGE, record.id), 'CORRUPT_STATE');
    await rejects(f.store.findRequest(CHANGE, OPTIONS.requestId), 'CORRUPT_STATE');
  }
});
