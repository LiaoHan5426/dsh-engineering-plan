import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { VerificationRunStore } from '../src/verification-store.js';
import { launchVerification } from '../src/verification-runner.js';

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const result = extra => ({ exitCode: 0, signal: null, timedOut: false, aborted: false, timeoutMs: 1000,
  stdout: { text: 'ok', truncated: false }, stderr: { text: '', truncated: false }, ...extra });
async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'verification-runner-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new VerificationRunStore(root);
  const run = await store.reserve({ changeId: 'change', taskId: 'task', planVersion: 1, commandIndex: 0,
    command: 'fixture only; never executed', requestId: 'request', hostInstanceId: 'host', ownerSessionId: 'owner' });
  const caller = new AbortController();
  const exec = { agent: { id: 'owner', session: { id: 'owner' } }, callId: 'call', rootCallId: 'root-call', signal: caller.signal };
  const completion = deferred(), spawned = deferred();
  const f = { root, store, run, exec, caller, completion, spawned, spawns: 0, kills: 0, resultCalls: 0, patches: [] };
  const realUpdate = store.update.bind(store);
  store.update = async (...args) => {
    const patch = args[3]; f.patches.push(patch);
    if (options.persistFail?.(patch)) throw new Error('disk failure');
    return realUpdate(...args);
  };
  const observed = { readFrom: from => ({ text: '', nextOffset: from, lossy: false }) };
  const proc = { observed: { stdout: observed, stderr: observed }, done: completion.promise.then(() => {}, () => {}),
    result: () => { f.resultCalls++; return completion.promise; },
    kill: () => { f.kills++; completion.resolve(result({ exitCode: null, aborted: true })); return true; } };
  const policy = { workspaceRoot: root, mode: 'workspace-write', sessionId: 'owner' };
  f.ctx = {
    sandboxPolicy: { resolve: input => { assert.deepEqual(input, { session: exec.agent.session }); return policy; } },
    shellEnv: { collect: input => { assert.equal(input, exec); return { DSH_TEST: 'yes' }; } },
    shell: {
      resolve: request => {
        f.request = request;
        f.resolved = { timeoutMs: 1000, stdoutMaxBytes: 65536, ...request, ...options.resolved };
        return f.resolved;
      },
      execute: async spec => {
        f.spawns++; f.spec = spec;
        const persisted = await store.get(run.changeId, run.runId);
        assert.equal(persisted.state, 'starting'); assert.equal(persisted.jobId, 'bash-fixture');
        assert.deepEqual(persisted.execution, { resolved: {
          workdir: spec.workdir, timeoutMs: spec.timeoutMs,
          onExpiry: spec.onExpiry, stdoutMaxBytes: spec.stdoutMaxBytes,
        } });
        spawned.resolve();
        if (options.spawnFail) throw new Error('preparation failed');
        if (options.prepare) return options.prepare(spec, proc);
        return proc;
      },
    },
    jobs: { start: spec => {
      f.jobSpec = spec;
      if (options.admissionFail) throw new Error('no controller');
      f.hooks = spec.run({ id: 'bash-fixture', append() {}, updateProgress() {} });
      assert.equal(typeof f.hooks.cancel, 'function'); assert.ok(f.hooks.done instanceof Promise);
      assert.equal(typeof f.hooks.then, 'undefined');
      return 'bash-fixture';
    } },
  };
  f.read = () => store.get(run.changeId, run.runId);
  f.launch = () => launchVerification(f.ctx, f.exec, f.run, f.store);
  return f;
}

for (const [name, raw, state, status] of [
  ['success', result(), 'succeeded', 'completed'],
  ['nonzero', result({ exitCode: 7 }), 'failed', 'failed'],
  ['timeout', result({ exitCode: null, timedOut: true }), 'timed_out', 'killed'],
  ['null exit', result({ exitCode: null }), 'unknown', 'failed'],
  ['missing result', undefined, 'unknown', 'failed'],
  ['missing lifecycle flags', { exitCode: 0 }, 'unknown', 'failed'],
  ['sandbox denial', result({ sandbox: { mode: 'workspace-write', denied: true } }), 'error', 'failed'],
]) test(`typed result: ${name}`, async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.launch(), { jobId: 'bash-fixture', runId: f.run.runId });
  f.completion.resolve(raw);
  assert.equal((await f.hooks.done).status, status);
  const saved = await f.read();
  assert.equal(saved.state, state); assert.equal(f.resultCalls, 1);
  assert.equal(saved.command, f.run.command); assert.equal(saved.taskId, f.run.taskId);
  assert.equal('evidence' in saved, false); assert.equal('criterion' in saved, false);
  assert.deepEqual(f.patches.map(p => p.expectedRevision), [1, 2, 3]);
});

test('uses policy cwd, owner/tool linkage and independent background signal', async t => {
  const f = await fixture(t); f.run.cwd = '/ignored'; f.run.workdir = '/ignored';
  await f.launch(); await f.spawned.promise;
  assert.equal(f.request.workdir, f.root); assert.equal(f.request.onExpiry, 'kill');
  assert.equal(f.request.sandboxPolicy.workspaceRoot, f.root);
  assert.deepEqual(f.request.dshEnv, { DSH_TEST: 'yes' });
  assert.equal(f.jobSpec.owner, 'owner');
  assert.deepEqual(f.jobSpec.toolCall, { callId: 'call', rootCallId: 'root-call' });
  // Caller cancellation must reach the runner's own controller: otherwise the
  // pre-spawn aborted check can never fire and an approved command still runs.
  f.caller.abort();
  assert.equal(f.request.signal.aborted, true, 'caller abort must abort the runner controller');
  assert.equal((await f.hooks.done).status, 'killed');
  assert.equal((await f.read()).state, 'cancelled');
  assert.equal(f.kills, 1, 'the published process must be killed');
  f.completion.resolve(result()); await f.hooks.done;
});

test('workspace drift after reservation records error before jobs admission or spawn', async t => {
  const f = await fixture(t);
  f.ctx.sandboxPolicy.resolve = () => ({ workspaceRoot: path.join(f.root, 'different'), mode: 'workspace-write' });
  await assert.rejects(f.launch(), { code: 'VERIFICATION_WORKSPACE_CHANGED' });
  assert.equal(f.jobSpec, undefined); assert.equal(f.request, undefined); assert.equal(f.spawns, 0);
  const saved = await f.read();
  assert.equal(saved.state, 'error'); assert.match(saved.error, /workspace root changed/);
  assert.ok(saved.finishedAt); assert.equal(saved.jobId, undefined);
});

test('store workspaceRoot is read-only and equivalent normalized policy cwd uses trusted root', async t => {
  const f = await fixture(t);
  assert.equal(f.store.workspaceRoot, path.resolve(f.root));
  assert.throws(() => { f.store.workspaceRoot = path.join(f.root, 'different'); }, TypeError);
  f.ctx.sandboxPolicy.resolve = () => ({ workspaceRoot: f.root + path.sep + '.', mode: 'workspace-write' });
  await f.launch(); f.completion.resolve(result()); await f.hooks.done;
  assert.equal(f.request.workdir, f.store.workspaceRoot);
});

test('store wrappers must forward the trusted workspaceRoot', async t => {
  const f = await fixture(t);
  f.store = { update: f.store.update.bind(f.store) };
  await assert.rejects(f.launch(), { code: 'VERIFICATION_WORKSPACE_CHANGED' });
  assert.equal(f.jobSpec, undefined); assert.equal(f.spawns, 0);
  assert.equal((await f.read()).state, 'error');
});

test('job cancellation aborts controller and kills published process', async t => {
  const f = await fixture(t); await f.launch(); await f.spawned.promise;
  // Wait for publication, without waiting for completion.
  await Promise.resolve();
  f.hooks.cancel('stop');
  assert.equal((await f.hooks.done).status, 'killed');
  assert.equal(f.request.signal.aborted, true); assert.ok(f.kills > 0);
  assert.equal((await f.read()).state, 'cancelled');
});

test('already-aborted caller never enters jobs admission or spawns', async t => {
  const f = await fixture(t); f.caller.abort();
  await assert.rejects(f.launch()); assert.equal(f.jobSpec, undefined); assert.equal(f.spawns, 0);
  assert.equal((await f.read()).state, 'error');
});

test('admission failure does not spawn and records error', async t => {
  const f = await fixture(t, { admissionFail: true });
  await assert.rejects(f.launch(), /no controller/); assert.equal(f.spawns, 0);
  const saved = await f.read(); assert.equal(saved.state, 'error'); assert.match(saved.error, /no controller/);
});

test('starting persistence failure does not spawn or masquerade as success', async t => {
  const f = await fixture(t, { persistFail: p => p.state === 'starting' && 'jobId' in p });
  await assert.rejects(f.launch(), /disk failure/);
  assert.equal((await f.hooks.done).status, 'failed'); assert.equal(f.spawns, 0);
  assert.equal((await f.read()).state, 'error');
});

for (const phase of ['running', 'succeeded']) test(`post-spawn ${phase} persistence failure kills and drains`, async t => {
  const f = await fixture(t, { persistFail: p => p.state === phase });
  await f.launch(); if (phase === 'succeeded') f.completion.resolve(result());
  const outcome = await f.hooks.done;
  assert.equal(outcome.status, 'failed'); assert.ok(f.kills > 0); assert.equal(f.resultCalls, 1);
  assert.equal((await f.read()).state, 'error');
});

test('result rejection is drained and recorded as infrastructure error', async t => {
  const f = await fixture(t); await f.launch(); f.completion.reject(new Error('result transport failed'));
  assert.equal((await f.hooks.done).status, 'failed'); assert.ok(f.kills > 0);
  assert.match((await f.read()).error, /result transport failed/);
});

test('all persistence failures leave job failed with diagnostic detail', async t => {
  const f = await fixture(t, { persistFail: () => true });
  await assert.rejects(f.launch(), /disk failure/);
  const outcome = await f.hooks.done;
  assert.equal(outcome.status, 'failed'); assert.match(outcome.detail, /error persistence failed/);
  assert.equal(f.spawns, 0); assert.equal((await f.read()).state, 'reserved');
});

test('cancellation during preparation records cancellation without fabricating process result', async t => {
  const f = await fixture(t, { prepare: spec => new Promise((resolve, reject) => {
    spec.signal.addEventListener('abort', () => reject(new Error('preparation aborted')), { once: true });
  }) });
  await f.launch(); await f.spawned.promise; await Promise.resolve();
  f.hooks.cancel('stop during prepare');
  assert.equal((await f.hooks.done).status, 'killed');
  const saved = await f.read(); assert.equal(saved.state, 'cancelled'); assert.equal(saved.aborted, true);
  assert.equal(f.resultCalls, 0);
});

test('invalid owner or nonreserved input leaves persistence untouched', async t => {
  const f = await fixture(t); f.exec.agent.id = 'other';
  await assert.rejects(f.launch(), /owner mismatch/);
  assert.deepEqual(f.patches, []); assert.equal(f.spawns, 0);
  f.exec.agent.id = 'owner'; f.run.state = 'running';
  await assert.rejects(f.launch(), /must be reserved/);
  assert.deepEqual(f.patches, []);
});

test('persists exact resolved public fields before spawn without leaking full spec', async t => {
  const f = await fixture(t, { resolved: {
    workdir: path.resolve('resolved-workdir'), timeoutMs: 4321, onExpiry: 'none', stdoutMaxBytes: 321,
    env: { SECRET: 'private-env' }, dshEnv: { DSH_SECRET: 'private-dsh-env' }, stdin: 'private-stdin',
    engine: 'private-engine', executable: 'private-executable',
  } });
  await f.launch(); await f.spawned.promise;
  const expected = { resolved: { workdir: path.resolve('resolved-workdir'), timeoutMs: 4321,
    onExpiry: 'none', stdoutMaxBytes: 321 } };
  assert.deepEqual((await f.read()).execution, expected);
  assert.equal(f.spec, f.resolved);
  assert.notEqual(f.patches[0].execution.resolved, f.spec);
  f.completion.resolve(result()); await f.hooks.done;
  const saved = await f.read();
  assert.deepEqual(saved.execution, expected);
  assert.equal(f.patches.filter(p => 'execution' in p).length, 1);
  const persisted = await fs.readFile(path.join(f.root, '.dsh', 'engineering', 'changes', 'change', 'runs', `${f.run.runId}.json`), 'utf8');
  for (const secret of ['private-env', 'private-dsh-env', 'private-stdin', 'private-engine', 'private-executable'])
    assert.equal(persisted.includes(secret), false);
  assert.deepEqual(Object.keys(saved.execution.resolved).sort(), ['onExpiry', 'stdoutMaxBytes', 'timeoutMs', 'workdir']);
});

test('execution persistence failure prevents spawn', async t => {
  const f = await fixture(t, { persistFail: p => 'execution' in p });
  await assert.rejects(f.launch(), /disk failure/);
  assert.equal((await f.hooks.done).status, 'failed'); assert.equal(f.spawns, 0);
  const saved = await f.read();
  assert.equal(saved.state, 'error'); assert.equal('execution' in saved, false);
});

for (const resolved of [{ timeoutMs: undefined }, { stdoutMaxBytes: NaN }, { workdir: null }, { onExpiry: 'invented' }])
  test(`invalid resolve metadata fails before spawn: ${Object.keys(resolved)[0]}`, async t => {
    const f = await fixture(t, { resolved });
    await assert.rejects(f.launch(), { code: 'INVALID_INPUT' });
    assert.equal((await f.hooks.done).status, 'failed'); assert.equal(f.spawns, 0);
    assert.equal('execution' in await f.read(), false);
  });

test('a cancelled settlement failure is reported instead of claiming cancellation', async t => {
  const f = await fixture(t);
  const realUpdate = f.store.update.bind(f.store);
  f.store.update = async (...args) => {
    const patch = args[3];
    // Cancel after the starting record is durable, then fail to persist the cancellation.
    if (patch.state === 'starting') { const saved = await realUpdate(...args); f.caller.abort(); return saved; }
    if (patch.state === 'cancelled') throw new Error('disk failure');
    return realUpdate(...args);
  };
  await f.launch();
  const outcome = await f.hooks.done;
  assert.equal(outcome.status, 'failed');
  assert.equal(f.spawns, 0);
});

test('preparation failure records error without a process handle', async t => {
  const f = await fixture(t, { spawnFail: true }); await f.launch();
  assert.equal((await f.hooks.done).status, 'failed');
  assert.match((await f.read()).error, /preparation failed/);
});

test('a caller abort between starting persistence and spawn cancels without spawning', async t => {
  const f = await fixture(t);
  const realUpdate = f.store.update.bind(f.store);
  f.store.update = async (...args) => {
    const saved = await realUpdate(...args);
    // Abort after the starting record is durable but before the runner reaches its pre-spawn check.
    if (args[3].state === 'starting') f.caller.abort();
    return saved;
  };
  await f.launch();
  const outcome = await f.hooks.done;
  assert.equal(outcome.status, 'killed');
  assert.equal(outcome.detail, 'Cancelled before spawn');
  assert.equal(f.spawns, 0, 'the approved command must not run after cancellation');
  assert.equal(f.resultCalls, 0);
  const saved = await f.read();
  assert.equal(saved.state, 'cancelled');
  assert.equal(saved.aborted, true);
  assert.equal(saved.reason, 'Cancelled before spawn');
});
