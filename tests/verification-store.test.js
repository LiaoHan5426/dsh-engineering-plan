import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { VerificationRunStore, MAX_OUTPUT_BYTES } from '../src/verification-store.js';

const snap = (extra = {}) => ({ changeId: 'change-a', taskId: 'task-a', planVersion: 1, commandIndex: 0, command: 'echo fixture', requestId: 'request-a', hostInstanceId: 'host-a', ownerSessionId: 'session-a', ...extra });
const rejects = (promise, code) => assert.rejects(promise, e => e.code === code);
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'verification-store-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new VerificationRunStore(root);
  const dir = path.join(root, '.dsh', 'engineering', 'changes', 'change-a', 'runs');
  return { root, store, dir, file: r => path.join(dir, `${r.runId}.json`) };
}
const update = (store, run, patch) => store.update(run.changeId, run.runId, run.hostInstanceId, { expectedRevision: run.revision, ...patch });

test('reserve persists immutable snapshot, idempotency and conflicts', async t => {
  const f = await fixture(t), run = await f.store.reserve(snap());
  assert.equal(run.state, 'reserved'); assert.equal(run.revision, 1);
  assert.deepEqual(await new VerificationRunStore(f.root).get(run.changeId, run.runId), run);
  assert.deepEqual(await f.store.reserve(snap({ hostInstanceId: 'new-host' })), run);
  for (const extra of [{ taskId: 'other' }, { planVersion: 2 }, { commandIndex: 1 }, { command: 'other' }, { ownerSessionId: 'other' }]) await rejects(f.store.reserve(snap(extra)), 'REQUEST_CONFLICT');
  assert.equal((await f.store.list(run.changeId)).length, 1);
  assert.equal('evidence' in run, false);
});

test('CAS and Host ownership enforce one writer', async t => {
  const f = await fixture(t), run = await f.store.reserve(snap());
  await rejects(f.store.update(run.changeId, run.runId, 'host-other', { expectedRevision: 1, state: 'starting' }), 'HOST_INSTANCE_CONFLICT');
  await rejects(f.store.update(run.changeId, run.runId, 'host-a', { state: 'starting' }), 'REVISION_REQUIRED');
  const results = await Promise.allSettled([update(f.store, run, { state: 'starting' }), update(new VerificationRunStore(f.root), run, { state: 'starting' })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'REVISION_CONFLICT');
});

test('cross-process reserve deduplicates and updates use CAS', async t => {
  const f = await fixture(t), moduleURL = new URL('../src/verification-store.js', import.meta.url).href;
  const child = expr => new Promise((resolve, reject) => {
    const source = `import { VerificationRunStore } from ${JSON.stringify(moduleURL)}; const store = new VerificationRunStore(${JSON.stringify(f.root)}); try { console.log(JSON.stringify(await ${expr})); } catch(e) { console.log(JSON.stringify({code:e.code})); }`;
    const p = spawn(process.execPath, ['--input-type=module', '-e', source]); let out = '', err = '';
    p.stdout.on('data', v => out += v); p.stderr.on('data', v => err += v); p.on('error', reject);
    p.on('close', code => { if (code) reject(new Error(err)); else { try { resolve(JSON.parse(out)); } catch(e) { reject(e); } } });
  });
  const expr = `store.reserve(${JSON.stringify(snap())})`;
  const [a, b] = await Promise.all([child(expr), child(expr)]);
  assert.equal(a.runId, b.runId); assert.ok(a.runId);
  const mutation = `store.update('change-a',${JSON.stringify(a.runId)},'host-a',{expectedRevision:1,state:'starting'})`;
  const results = await Promise.all([child(mutation), child(mutation)]);
  assert.equal(results.filter(v => v.state === 'starting').length, 1);
  assert.equal(results.find(v => v.code).code, 'REVISION_CONFLICT');
});

test('strict state transitions, immutable fields and terminal states', async t => {
  const f = await fixture(t); let run = await f.store.reserve(snap());
  for (const state of ['running', 'succeeded', 'unknown', 'failed']) await rejects(update(f.store, run, { state }), 'INVALID_TRANSITION');
  for (const patch of [{ command: 'changed' }, { hostInstanceId: 'other' }, { evidence: [] }, { runId: 'other' }, { ownerSessionId: 'other' }, { path: '/tmp/x' }]) await rejects(update(f.store, run, patch), 'INVALID_INPUT');
  run = await update(f.store, run, { state: 'starting' });
  await rejects(update(f.store, run, { state: 'reserved' }), 'INVALID_TRANSITION');
  run = await update(f.store, run, { state: 'running', pid: 123 });
  run = await update(f.store, run, { state: 'succeeded', exitCode: 0, timedOut: false, aborted: false });
  assert.ok(run.finishedAt); assert.equal(run.pid, 123);
  await rejects(update(f.store, run, { state: 'running' }), 'INVALID_TRANSITION');
  await rejects(update(f.store, run, { stdout: 'changed' }), 'INVALID_TRANSITION');
  assert.equal('evidence' in run, false);
  for (const state of ['succeeded', 'failed', 'cancelled', 'timed_out', 'error', 'unknown']) {
    let r = await f.store.reserve(snap({ requestId: state })); r = await update(f.store, r, { state: 'starting' });
    r = await update(f.store, r, { state, ...(state === 'succeeded' ? { exitCode: 0, timedOut: false, aborted: false } : {}) });
    assert.equal(r.state, state);
  }
});

test('failed executions cannot masquerade as success; zero exit does not auto-transition', async t => {
  const f = await fixture(t); let run = await f.store.reserve(snap());
  run = await update(f.store, run, { state: 'starting' });
  for (const fields of [{}, { exitCode: 0 }, { exitCode: 0, timedOut: null, aborted: null }, { exitCode: 0, timedOut: false }, { exitCode: 0, aborted: false }, { exitCode: 1 }, { exitCode: 0, signal: 'SIGTERM' }, { exitCode: 0, error: 'runner error' }, { exitCode: 0, aborted: true }, { exitCode: 0, timedOut: true }, { exitCode: 0, sandbox: { denied: true } }, { exitCode: 0, sandbox: { runnerFailed: true } }]) await rejects(update(f.store, run, { state: 'succeeded', ...fields }), 'INVALID_RESULT');
  for (const fields of [{ signal: 'SIGTERM' }, { error: 'failed' }, { sandbox: { denied: true } }, { sandbox: { runnerFailed: true } }]) await rejects(update(f.store, run, { state: 'succeeded', exitCode: 0, timedOut: false, aborted: false, ...fields }), 'INVALID_RESULT');
  for (const sandbox of [{ mode: 'anything' }, { enforcement: 'anything' }, { unexpected: true }]) await rejects(update(f.store, run, { sandbox }), 'INVALID_INPUT');
  run = await update(f.store, run, { exitCode: 0, timedOut: null, aborted: null });
  assert.equal(run.timedOut, null); assert.equal(run.aborted, null);
  assert.equal(run.state, 'starting'); assert.equal(run.revision, 3);
  assert.equal('evidence' in run, false);
});

test('bounded structured output preserves spill references and sticky truncation', async t => {
  const f = await fixture(t); let run = await f.store.reserve(snap());
  run = await update(f.store, run, { state: 'starting', stdout: { text: '你'.repeat(MAX_OUTPUT_BYTES), truncated: false, spillPath: 'opaque/spill.log' }, stderr: 'x'.repeat(MAX_OUTPUT_BYTES + 1), sandbox: { mode: 'read-only', denied: false, runnerFailed: false, enforcement: 'full' }, jobId: 'job-1' });
  assert.ok(Buffer.byteLength(run.stdout.text) <= MAX_OUTPUT_BYTES); assert.ok(!run.stdout.text.endsWith('�'));
  assert.equal(run.stdout.spillPath, 'opaque/spill.log'); assert.equal(run.stdout.truncated, true); assert.equal(run.stderr.truncated, true); assert.equal(run.truncated, true);
  run = await update(f.store, run, { stdout: { text: 'short', truncated: false }, truncated: false });
  assert.equal(run.stdout.truncated, true); assert.equal(run.truncated, true);
  assert.deepEqual(await f.store.get(run.changeId, run.runId), run);
});

test('recovery marks only old-instance nonterminal runs unknown without PID adoption', async t => {
  const f = await fixture(t), reserved = await f.store.reserve(snap());
  let running = await f.store.reserve(snap({ requestId: 'running' }));
  running = await update(f.store, running, { state: 'starting' }); running = await update(f.store, running, { state: 'running', pid: process.pid });
  let done = await f.store.reserve(snap({ requestId: 'done' })); done = await update(f.store, done, { state: 'starting' }); done = await update(f.store, done, { state: 'failed', exitCode: 1 });
  const current = await f.store.reserve(snap({ requestId: 'current', hostInstanceId: 'host-new' }));
  const recovered = await f.store.recover('change-a', 'host-new');
  assert.deepEqual(new Set(recovered.map(r => r.runId)), new Set([reserved.runId, running.runId]));
  for (const r of recovered) { assert.equal(r.state, 'unknown'); assert.equal(r.hostInstanceId, 'host-a'); }
  assert.equal((await f.store.get('change-a', running.runId)).pid, process.pid);
  assert.deepEqual(await f.store.get('change-a', done.runId), done);
  assert.deepEqual(await f.store.get('change-a', current.runId), current);
  assert.deepEqual(await f.store.recover('change-a', 'host-new'), []);
});

test('identifiers, path traversal, malformed snapshots and corrupt records fail closed', async t => {
  const f = await fixture(t);
  for (const changeId of ['../escape', 'a/b', 'a\\b', 'C:escape', 'CON', 'NUL', '.', 'a.', 'a ']) await rejects(f.store.reserve(snap({ changeId })), 'INVALID_ID');
  for (const extra of [{ command: '' }, { command: 'a\0b' }, { planVersion: 0 }, { commandIndex: -1 }, { arbitraryPath: 'x' }]) await rejects(f.store.reserve(snap(extra)), 'INVALID_INPUT');
  assert.deepEqual(await f.store.list('missing'), []);
  const run = await f.store.reserve(snap());
  await rejects(f.store.get('change-a', '../escape'), 'INVALID_ID');
  await fs.writeFile(f.file(run), '{broken');
  await rejects(f.store.get('change-a', run.runId), 'CORRUPT_STATE');
  await rejects(f.store.reserve(snap()), 'CORRUPT_STATE');
});

test('hardlinked records and lock files are rejected without changing targets', async t => {
  const f = await fixture(t), run = await f.store.reserve(snap());
  const other = path.join(f.root, 'target.json'); await fs.link(f.file(run), other);
  await rejects(f.store.get('change-a', run.runId), 'PATH_UNSAFE');
  await rejects(update(f.store, run, { state: 'starting' }), 'PATH_UNSAFE');
  assert.equal(JSON.parse(await fs.readFile(other, 'utf8')).state, 'reserved');
  await fs.unlink(other);
  await fs.link(f.file(run), path.join(f.dir, '.lock'));
  await rejects(update(f.store, run, { state: 'starting' }), 'PATH_UNSAFE');
});

test('symlinked storage ancestors are rejected', async t => {
  const f = await fixture(t), target = path.join(f.root, 'outside'); await fs.mkdir(target);
  await fs.symlink(target, path.join(f.root, '.dsh'), process.platform === 'win32' ? 'junction' : 'dir');
  await rejects(f.store.reserve(snap()), 'PATH_UNSAFE');
  await rejects(f.store.list('change-a'), 'PATH_UNSAFE');
  assert.deepEqual(await fs.readdir(target), []);
});

test('stale lock fails closed and is never stolen by recovery', async t => {
  const f = await fixture(t), run = await f.store.reserve(snap());
  const lock = path.join(f.dir, '.lock'), contents = JSON.stringify({ pid: 99999999, createdAt: '2000-01-01T00:00:00.000Z' });
  await fs.writeFile(lock, contents);
  await rejects(f.store.recover('change-a', 'host-new'), 'LOCK_BUSY');
  assert.equal(await fs.readFile(lock, 'utf8'), contents);
  assert.deepEqual(await f.store.get('change-a', run.runId), run);
});

const execution = () => ({ resolved: { workdir: '/resolved/workdir', timeoutMs: 1200, onExpiry: 'kill', stdoutMaxBytes: 4096 } });

test('execution metadata is write-once with starting linkage and retains CAS and ownership precedence', async t => {
  const f = await fixture(t); let run = await f.store.reserve(snap());
  for (const patch of [{ execution: execution() }, { state: 'starting', execution: execution() }])
    await rejects(update(f.store, run, patch), 'INVALID_TRANSITION');
  const metadata = execution();
  run = await update(f.store, run, { state: 'starting', jobId: 'job', execution: metadata });
  metadata.resolved.timeoutMs = 999;
  assert.deepEqual(run.execution, execution());
  await rejects(f.store.update(run.changeId, run.runId, 'other', { expectedRevision: run.revision, execution: execution() }), 'HOST_INSTANCE_CONFLICT');
  await rejects(update(f.store, run, { expectedRevision: 1, execution: execution() }), 'REVISION_CONFLICT');
  for (const replacement of [execution(), { resolved: { ...execution().resolved, timeoutMs: 999 } }])
    await rejects(update(f.store, run, { execution: replacement }), 'IMMUTABLE_EXECUTION');
  run = await update(f.store, run, { state: 'running' });
  assert.deepEqual(run.execution, execution());
  run = await update(f.store, run, { state: 'failed', exitCode: 2 });
  await rejects(update(f.store, run, { execution: execution() }), 'INVALID_TRANSITION');
  assert.deepEqual((await f.store.get(run.changeId, run.runId)).execution, execution());
});

test('execution has strict nested types and rejects secrets and unknown fields', async t => {
  const f = await fixture(t), run = await f.store.reserve(snap());
  const invalid = [null, [], {}, { resolved: null }, { resolved: [] }, { resolved: {} },
    { ...execution(), engine: 'bash' }, { ...execution(), resolved: { ...execution().resolved, env: {} } }];
  for (const key of ['env', 'dshEnv', 'stdin', 'signal', 'spec', 'engine', 'executable'])
    invalid.push({ resolved: { ...execution().resolved, [key]: 'secret' } });
  for (const key of ['timeoutMs', 'stdoutMaxBytes'])
    for (const value of [-1, NaN, Infinity, -Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1, '1000', null, undefined])
      invalid.push({ resolved: { ...execution().resolved, [key]: value } });
  for (const value of ['', ' ', null, 1, {}, undefined])
    invalid.push({ resolved: { ...execution().resolved, workdir: value } });
  for (const value of ['', 'stop', null, 1, undefined])
    invalid.push({ resolved: { ...execution().resolved, onExpiry: value } });
  for (const value of invalid)
    await rejects(update(f.store, run, { state: 'starting', jobId: 'job', execution: value }), 'INVALID_INPUT');
  assert.deepEqual(await f.store.get(run.changeId, run.runId), run);
  const valid = { resolved: { ...execution().resolved, timeoutMs: 0, stdoutMaxBytes: 0, onExpiry: 'none' } };
  assert.deepEqual((await update(f.store, run, { state: 'starting', jobId: 'job', execution: valid })).execution, valid);
});

test('schema-1 records without execution remain readable and late metadata is rejected', async t => {
  const f = await fixture(t); let run = await f.store.reserve(snap());
  assert.equal(run.schemaVersion, 1); assert.equal('execution' in run, false);
  run = await update(f.store, run, { state: 'starting', jobId: 'old-job' });
  await rejects(update(f.store, run, { state: 'starting', jobId: 'old-job', execution: execution() }), 'INVALID_TRANSITION');
  assert.deepEqual(await new VerificationRunStore(f.root).get(run.changeId, run.runId), run);
  run = await update(f.store, run, { state: 'failed', exitCode: 1 });
  assert.equal('execution' in run, false);
  assert.deepEqual(await f.store.list(run.changeId), [run]);
});

test('reader validates execution rather than trusting nested stored data', async t => {
  const f = await fixture(t), run = await f.store.reserve(snap());
  for (const value of [{ resolved: {} }, { resolved: { ...execution().resolved, timeoutMs: -1 } },
    { ...execution(), stdin: 'secret' }, { resolved: { ...execution().resolved, signal: {} } }]) {
    await fs.writeFile(f.file(run), JSON.stringify({ ...run, execution: value }));
    await rejects(f.store.get(run.changeId, run.runId), 'CORRUPT_STATE');
  }
});

test('write failure does not return a successful state or overwrite prior record', async t => {
  const f = await fixture(t), run = await f.store.reserve(snap());
  // Replace the expected file with a directory: persistence must fail before claiming a transition.
  await fs.unlink(f.file(run)); await fs.mkdir(f.file(run));
  await rejects(update(f.store, run, { state: 'starting' }), 'PATH_UNSAFE');
  assert.ok((await fs.stat(f.file(run))).isDirectory());
  assert.equal((await fs.readdir(f.dir)).some(name => name.endsWith('.tmp') || name === '.lock'), false);
});
