import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DispatchRunStore, MAX_OUTPUT_BYTES } from '../src/dispatch-store.js';
import { launchDispatch } from '../src/dispatch-runner.js';
import { EngineeringStore } from '../src/core.js';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
const result = extra => ({ output: [{ type: 'text', text: 'work returned' }], stopReason: 'completed', ...extra });
async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dispatch-runner-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new DispatchRunStore(root);
  const taskSnapshot = { id: 'task', title: 'Fixture work', description: 'No actual child is started',
    dependencies: [], expectedFiles: ['fixture.js'], acceptanceCriteria: ['review work'], verificationCommands: [] };
  const identity = { hostInstanceId: 'host', ownerSessionId: 'owner', childId: 'preallocated-child' };
  let core, request;
  if (options.core) {
    core = new EngineeringStore(root);
    let state = (await core.execute({ action: 'create', title: 'Dispatch cleanup', goal: 'Preserve blockers' })).change;
    state = (await core.execute({ action: 'save', changeId: state.id, expectedRevision: state.revision,
      patch: { tasks: [taskSnapshot] } })).change;
    state = (await core.execute({ action: 'approve', changeId: state.id, expectedRevision: state.revision },
      { kind: 'user', id: 'fixture-reviewer' })).change;
    request = { changeId: state.id, taskId: 'task', planVersion: state.planVersion,
      expectedRevision: state.revision, requestId: 'request' };
  }
  const { run, created } = core ? await core.reserveDispatch(request, identity)
    : await store.reserve({ changeId: 'change', taskId: 'task', planVersion: 1,
      admittedRevision: 2, requestId: 'request', taskSnapshot,
      taskSnapshotHash: createHash('sha256').update(JSON.stringify(taskSnapshot)).digest('hex'), ...identity });
  assert.equal(created, true);
  const caller = new AbortController();
  const route = { provider: 'live-provider', model: 'live-model' };
  const agentContext = { get: key => { assert.equal(key, 'agentPresets'); return {
    composedPreset: input => { assert.equal(input, agentContext); return 'live-preset'; },
  }; } };
  const exec = { agent: { id: 'owner', session: { id: 'owner', requestHeader: () => ({ config: route }) },
    ctx: agentContext, options: { provider: 'old-provider', model: 'old-model', reasoningEffort: 'old-effort', maxTokens: 111 } },
  callId: 'call', rootCallId: 'root-call', signal: caller.signal };
  const completion = deferred(), spawned = deferred(), disposing = deferred();
  const f = { root, store, run, exec, caller, route, completion, spawned, disposing, spawns: 0, disposals: 0, patches: [] };
  const realUpdate = store.update.bind(store);
  store.update = async (...args) => {
    const patch = args[3]; f.patches.push(patch);
    await options.beforePersist?.(patch, f);
    if (options.persistFail?.(patch)) throw new Error('disk failure');
    return realUpdate(...args);
  };
  const activation = { childId: run.childId, result: completion.promise, dispose: async () => {
    f.disposals++; disposing.resolve();
    if (options.dispose) await options.dispose(f);
    completion.resolve(result({ stopReason: 'aborted' }));
  } };
  f.activation = activation;
  f.ctx = {
    sandboxPolicy: { resolve: input => {
      assert.deepEqual(input, { session: exec.agent.session });
      return { workspaceRoot: root, mode: 'workspace-write' };
    } },
    subagents: {
      resolveMaxDepth: () => 2,
      getProvider: name => { assert.equal(name, 'spawn'); return options.noProvider ? undefined : { name: 'spawn' }; },
      startActivation: async spec => {
        f.spawns++; f.spec = spec;
        const persisted = await store.get(run.changeId, run.runId);
        assert.equal(persisted.state, 'starting'); assert.equal(persisted.jobId, 'bash-fixture');
        spawned.resolve();
        if (options.startFail) throw new Error('activation start failed');
        return options.prepare ? options.prepare(spec, activation) : activation;
      },
    },
    jobs: { start: spec => {
      f.jobSpec = spec;
      if (options.admissionFail) throw new Error('jobs admission failed');
      f.hooks = spec.run({ id: 'bash-fixture' });
      assert.equal(typeof f.hooks.cancel, 'function'); assert.ok(f.hooks.done instanceof Promise);
      assert.equal(typeof f.hooks.then, 'undefined');
      options.onJob?.(f);
      return 'bash-fixture';
    } },
  };
  f.assertBlocked = () => assert.rejects(core.reserveDispatch({ ...request, requestId: 'next-request' },
    { ...identity, childId: 'next-child' }), { code: 'DISPATCH_RUN_BLOCKED' });
  f.read = () => store.get(run.changeId, run.runId);
  f.launch = () => launchDispatch(f.ctx, f.exec, f.run, f.store);
  return f;
}

for (const [stopReason, state, status] of [
  ['completed', 'returned', 'completed'], ['error', 'failed', 'failed'],
  ['max-tokens', 'failed', 'failed'], ['refusal', 'failed', 'failed'], ['aborted', 'failed', 'failed'],
]) test(`native ${stopReason} records ${state} only after cleanup`, async t => {
  const cleanup = deferred();
  const f = await fixture(t, { dispose: () => cleanup.promise });
  const taskBefore = structuredClone(f.run.taskSnapshot);
  assert.deepEqual(await f.launch(), { jobId: 'bash-fixture', runId: f.run.runId });
  f.completion.resolve(result({ stopReason, diagnostic: 'native diagnostic' }));
  await f.disposing.promise;
  assert.equal((await f.read()).state, 'running');
  cleanup.resolve();
  assert.equal((await f.hooks.done).status, status);
  const saved = await f.read();
  assert.equal(saved.state, state); assert.equal(saved.result.stopReason, stopReason);
  assert.equal(saved.result.text, 'work returned'); assert.equal(saved.result.diagnostic, 'native diagnostic');
  assert.deepEqual(saved.taskSnapshot, taskBefore); assert.deepEqual(f.run.taskSnapshot, taskBefore);
  assert.equal('evidence' in saved, false); assert.equal('status' in saved.taskSnapshot, false);
  assert.equal(f.disposals, 1); assert.deepEqual(f.patches.map(p => p.expectedRevision), [1, 2, 3]);
});

test('binds child/owner/current preset and route with independent background lifetime', async t => {
  const f = await fixture(t);
  await f.launch(); await f.spawned.promise;
  assert.equal(f.jobSpec.kind, 'bash'); assert.match(f.jobSpec.label, /^Dispatch /);
  assert.equal(f.jobSpec.owner, 'owner');
  assert.deepEqual(f.jobSpec.toolCall, { callId: 'call', rootCallId: 'root-call' });
  assert.equal(f.spec.provider, 'spawn'); assert.equal(f.spec.childId, f.run.childId);
  assert.equal(f.spec.maxDepth, 2);
  assert.equal(f.spec.parent, f.exec.agent); assert.equal(f.spec.cwd, f.store.workspaceRoot);
  assert.equal(f.spec.delivery, 'caller'); assert.equal(f.spec.agentPreset, 'live-preset');
  assert.deepEqual(f.spec.agentOptions, { provider: 'live-provider', model: 'live-model', maxTokens: 111 });
  f.route.model = 'changed-after-launch';
  assert.equal(f.spec.agentOptions.model, 'live-model');
  assert.match(f.spec.prompt[0].text, /Fixture work/);
  f.caller.abort(); assert.equal(f.spec.signal.aborted, false);
  f.completion.resolve(result()); await f.hooks.done;
});

test('activation start throw persists error', async t => {
  const f = await fixture(t, { startFail: true });
  await f.launch(); assert.equal((await f.hooks.done).status, 'failed');
  assert.equal((await f.read()).state, 'error'); assert.match((await f.read()).error, /activation start failed/);
  assert.equal(f.disposals, 0);
});

test('native jobs admission throw records starting then error', async t => {
  const f = await fixture(t, { admissionFail: true });
  await assert.rejects(f.launch(), /jobs admission failed/);
  assert.deepEqual(f.patches.map(p => p.state), ['starting', 'error']);
  assert.equal((await f.read()).state, 'error'); assert.equal(f.spawns, 0);
});

test('preaborted caller records error without creating a job', async t => {
  const f = await fixture(t); f.caller.abort(new Error('host stopped'));
  await assert.rejects(f.launch(), /host stopped/);
  assert.deepEqual(f.patches.map(p => p.state), ['starting', 'error']);
  assert.equal(f.jobSpec, undefined); assert.equal(f.spawns, 0);
});

// Rewrapping a cancellation used to build a fresh Error, which dropped both the
// AbortError name and the numeric DOMException code, so the tool layer reported
// "failed" where the user had cancelled. The detail is still persisted, but the
// error identity must survive.
test('a cancelled launch keeps its AbortError identity', async t => {
  const f = await fixture(t);
  f.caller.abort(new DOMException('caller went away', 'AbortError'));
  await assert.rejects(f.launch(), error => {
    assert.equal(error.name, 'AbortError', 'cancellation must not become a plain Error');
    assert.equal(error.code, 20, 'DOMException code must survive');
    return true;
  });
  assert.deepEqual(f.patches.map(p => p.state), ['starting', 'error']);
  assert.equal(f.spawns, 0);
});

for (const mode of ['job', 'host']) test(`${mode} cancel before publication does not start activation`, async t => {
  const f = await fixture(t, { onJob: f => mode === 'job' ? f.hooks.cancel('stop before publish') : f.caller.abort('stop before publish') });
  await assert.rejects(f.launch(), /before publication/);
  assert.equal((await f.hooks.done).status, 'killed');
  assert.equal((await f.read()).state, 'cancelled'); assert.equal(f.spawns, 0);
});

test('cancel after activation awaits disposal even with pending result', async t => {
  const cleanup = deferred();
  const f = await fixture(t, { dispose: () => cleanup.promise });
  await f.launch(); await f.spawned.promise;
  f.hooks.cancel('stop'); await f.disposing.promise;
  assert.notEqual((await f.read()).state, 'cancelled');
  assert.equal(f.spec.signal.aborted, true);
  cleanup.resolve(); assert.equal((await f.hooks.done).status, 'killed');
  assert.equal((await f.read()).state, 'cancelled'); assert.equal(f.disposals, 1);
});

test('cancel during pending startup cleans late activation before settling job', async t => {
  const late = deferred(), cleanup = deferred();
  const f = await fixture(t, { prepare: () => late.promise, dispose: () => cleanup.promise });
  await f.launch(); await f.spawned.promise; f.hooks.cancel('late stop');
  let settled = false; f.hooks.done.then(() => { settled = true; });
  await Promise.resolve(); assert.equal(settled, false);
  late.resolve(f.activation); await f.disposing.promise;
  assert.equal(settled, false); assert.equal((await f.read()).state, 'starting');
  cleanup.resolve(); assert.equal((await f.hooks.done).status, 'killed');
  assert.equal((await f.read()).state, 'cancelled'); assert.equal(f.disposals, 1);
});

test('late activation startup rejection after cancellation remains error and is observed', async t => {
  const late = deferred();
  const f = await fixture(t, { prepare: () => late.promise });
  await f.launch(); await f.spawned.promise; f.hooks.cancel('cancel during startup');
  late.reject(new Error('startup rejected after abort'));
  assert.equal((await f.hooks.done).status, 'failed');
  assert.equal((await f.read()).state, 'error');
  assert.match((await f.read()).error, /startup rejected after abort/);
});

test('cancel cleanup observes a concurrently rejected result', async t => {
  const cleanup = deferred();
  const f = await fixture(t, { dispose: () => cleanup.promise });
  await f.launch(); await f.spawned.promise; f.hooks.cancel('cancel');
  await f.disposing.promise;
  f.completion.reject(new Error('result rejected during cancellation'));
  await new Promise(resolve => setImmediate(resolve));
  cleanup.resolve();
  assert.equal((await f.hooks.done).status, 'killed'); assert.equal((await f.read()).state, 'cancelled');
});

for (const scenario of ['return', 'cancel', 'running persistence', 'unknown persistence']) {
  test(`dispose rejection after ${scenario} keeps real core dispatch blocked`, async t => {
    const f = await fixture(t, {
      core: true,
      dispose: () => { throw new Error('cleanup failed fixture'); },
      persistFail: patch => (scenario === 'running persistence' && patch.state === 'running')
        || (scenario === 'unknown persistence' && patch.state === 'unknown'),
    });
    await f.launch(); await f.spawned.promise;
    if (scenario === 'cancel') f.hooks.cancel('stop fixture');
    else if (scenario !== 'running persistence') f.completion.resolve(result());
    const outcome = await f.hooks.done;
    assert.equal(outcome.status, 'failed'); assert.match(outcome.detail, /cleanup failed fixture/);
    const saved = await f.read();
    assert.equal(saved.state, scenario === 'unknown persistence' ? 'running' : 'unknown');
    if (scenario !== 'unknown persistence') assert.match(saved.error, /cleanup failed fixture/);
    if (scenario === 'running persistence') assert.match(saved.error, /disk failure; cleanup failed:/);
    if (scenario === 'unknown persistence') assert.match(outcome.detail, /unknown persistence failed: disk failure/);
    assert.equal(f.patches.some(patch => patch.state === 'error' || patch.state === 'cancelled'), false);
    assert.equal(f.patches.filter(patch => patch.state === 'unknown').length, 1);
    assert.equal(f.disposals, 1);
    await f.assertBlocked();
  });
}

test('normal return racing cancel during cleanup records cancelled', async t => {
  const cleanup = deferred();
  const f = await fixture(t, { dispose: () => cleanup.promise });
  await f.launch(); f.completion.resolve(result()); await f.disposing.promise;
  f.hooks.cancel('cancel during cleanup'); cleanup.resolve();
  assert.equal((await f.hooks.done).status, 'killed'); assert.equal((await f.read()).state, 'cancelled');
});

for (const when of ['before job', 'after linkage']) test(`workspace drift ${when} prevents activation`, async t => {
  const f = await fixture(t);
  let calls = 0;
  f.ctx.sandboxPolicy.resolve = () => ({ workspaceRoot: when === 'before job' || ++calls > 1 ? path.join(f.root, 'elsewhere') : f.root });
  await assert.rejects(f.launch(), { code: 'DISPATCH_WORKSPACE_CHANGED' });
  if (f.hooks) assert.equal((await f.hooks.done).status, 'failed');
  assert.equal((await f.read()).state, 'error'); assert.equal(f.spawns, 0);
});

test('cancel during returned persistence preserves terminal return after cleanup', async t => {
  const committing = deferred(), commit = deferred();
  const f = await fixture(t, { beforePersist: async p => {
    if (p.state === 'returned') { committing.resolve(); await commit.promise; }
  } });
  await f.launch(); f.completion.resolve(result()); await committing.promise;
  assert.equal(f.disposals, 1);
  f.hooks.cancel('cancel after completion entered commit'); commit.resolve();
  assert.equal((await f.hooks.done).status, 'completed');
  assert.equal((await f.read()).state, 'returned');
  assert.equal(f.patches.some(p => p.state === 'cancelled'), false);
});

for (const mode of ['missing method', 'missing value', 'throws']) test(`depth policy ${mode} records error before startup`, async t => {
  const f = await fixture(t);
  if (mode === 'missing method') delete f.ctx.subagents.resolveMaxDepth;
  else f.ctx.subagents.resolveMaxDepth = () => {
    if (mode === 'throws') throw new Error('depth configuration failure');
    return undefined;
  };
  await assert.rejects(f.launch());
  assert.equal(f.spawns, 0); assert.equal(f.jobSpec, undefined);
  assert.deepEqual(f.patches.map(p => p.state), ['starting', 'error']);
  assert.equal((await f.read()).state, 'error');
});

test('missing native provider records error before jobs start', async t => {
  const f = await fixture(t, { noProvider: true });
  await assert.rejects(f.launch(), /spawn provider is unavailable/);
  assert.deepEqual(f.patches.map(p => p.state), ['starting', 'error']);
  assert.equal(f.jobSpec, undefined); assert.equal((await f.read()).state, 'error');
});

for (const state of ['starting', 'running', 'returned', 'cancelled']) test(`persistence failure at ${state} fails job and cleans activation`, async t => {
  const f = await fixture(t, { persistFail: p => p.state === state });
  if (state === 'starting') await assert.rejects(f.launch(), /disk failure/);
  else {
    await f.launch(); await f.spawned.promise;
    if (state === 'cancelled') f.hooks.cancel('stop'); else f.completion.resolve(result());
  }
  const outcome = await f.hooks.done;
  assert.equal(outcome.status, 'failed'); assert.match(outcome.detail, /disk failure/);
  assert.equal(f.disposals, state === 'starting' ? 0 : 1);
  assert.equal((await f.read()).state, state === 'starting' ? 'reserved' : 'error');
});

test('result rejection is observed before slow running persistence and cleans activation', async t => {
  const saving = deferred(), release = deferred();
  const f = await fixture(t, { beforePersist: async p => {
    if (p.state === 'running') { saving.resolve(); await release.promise; }
  } });
  await f.launch(); await saving.promise;
  f.completion.reject(new Error('native result rejected'));
  // Let a turn pass: node:test would report any unhandled rejection here.
  await new Promise(resolve => setImmediate(resolve)); release.resolve();
  assert.equal((await f.hooks.done).status, 'failed');
  assert.equal((await f.read()).state, 'error'); assert.match((await f.read()).error, /native result rejected/);
  assert.equal(f.disposals, 1);
});

test('text blocks and native nontext blocks become bounded UTF-8 text', async t => {
  const f = await fixture(t); await f.launch();
  f.completion.resolve(result({ output: [{ type: 'tool-addition', toolName: 'fixture' },
    { type: 'text', text: '界'.repeat(MAX_OUTPUT_BYTES) }], diagnostic: '界'.repeat(MAX_OUTPUT_BYTES) }));
  await f.hooks.done; const saved = await f.read();
  assert.equal(saved.state, 'returned'); assert.equal(saved.truncated, true);
  assert.match(saved.result.text, /"tool-addition"/);
  for (const text of [saved.result.text, saved.result.diagnostic]) {
    assert.ok(Buffer.byteLength(text) <= MAX_OUTPUT_BYTES); assert.equal(text.includes('\uFFFD'), false);
  }
});

test('bad result shape fails with cleanup rather than forging a returned record', async t => {
  const f = await fixture(t); await f.launch();
  f.completion.resolve({ output: 'not native blocks', stopReason: { kind: 'completed' } });
  assert.equal((await f.hooks.done).status, 'failed');
  assert.equal((await f.read()).state, 'error'); assert.equal(f.disposals, 1);
});

test('foreign owner is rejected without mutating the run', async t => {
  const f = await fixture(t); f.exec.agent.id = 'someone-else';
  await assert.rejects(f.launch(), /owner mismatch/);
  assert.equal((await f.read()).state, 'reserved'); assert.equal(f.patches.length, 0);
});

test('wrong native child identity disposes handle and records error', async t => {
  const f = await fixture(t); f.activation.childId = 'wrong-child';
  await f.launch(); assert.equal((await f.hooks.done).status, 'failed');
  assert.match((await f.read()).error, /child identity mismatch/); assert.equal(f.disposals, 1);
});
