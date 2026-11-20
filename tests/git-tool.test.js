import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { apply, gitParameters } from '../index.js';
import { EngineeringStore } from '../src/core.js';
import { GitObservationStore } from '../src/git-observation-store.js';

// Registered tool body with real core/store/comparison/collector; shell is a contract double.
// This does not establish native Host admission or actual Git execution.
const ok = (text = '', patch = {}) => ({ exitCode: 0, signal: null, timedOut: false, aborted: false,
  stdout: { text, truncated: false }, stderr: { text: '', truncated: false }, ...patch });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'git-tool-'));
  const tools = new Map(), commands = new Map(), skills = new Map(), cleanup = [], calls = [];
  const controller = new AbortController();
  const exec = { agent: { id: 'owner', session: { cwd: root } }, callId: 'call', rootCallId: 'root-call', signal: controller.signal };
  const register = map => definition => { map.set(definition.name, definition); return () => map.delete(definition.name); };
  let override = async () => undefined;
  const ctx = {
    effect: fn => cleanup.push(fn()), tools: { register: register(tools) },
    skills: { register: register(skills) }, commands: { register: register(commands) },
    workingDirectory: { ensure: async () => root }, sandboxPolicy: { resolve: () => ({ workspaceRoot: root }) },
    shellEnv: { collect: value => { assert.equal(value, exec); return {}; } },
    shell: {
      resolve: request => request,
      async execute(spec) {
        calls.push(spec);
        const custom = await override(spec);
        const text = spec.command.includes('--show-toplevel') ? root + '\n'
          : spec.command.includes('HEAD^{commit}') ? 'a'.repeat(40) + '\n' : '';
        return { done: Promise.resolve(), kill: () => true, result: async () => custom ?? ok(text) };
      },
    },
  };
  apply(ctx);
  const core = new EngineeringStore(root), store = new GitObservationStore(root);
  const state = (await core.execute({ action: 'create', title: 'Git fixture', goal: 'Observe facts' })).change;
  const args = { action: 'capture', changeId: state.id, expectedRevision: state.revision, planVersion: state.planVersion, requestId: 'capture-1' };
  t.after(async () => { cleanup.splice(0).reverse().forEach(fn => fn()); await rm(root, { recursive: true, force: true }); });
  return { root, ctx, core, store, state, args, exec, controller, tools, commands, skills, cleanup, calls,
    set override(fn) { override = fn; },
    call: (input = args, execution = exec) => tools.get('engineering_git').execute(input, execution),
    read: input => tools.get('engineering_plan').execute({ action: 'gitObservations', changeId: state.id, ...input }, exec),
  };
}

test('strict schema, model-only collection, JSON-lossless output and effect cleanup', async t => {
  const f = await fixture(t), tool = f.tools.get('engineering_git');
  assert.equal(tool.parameters, gitParameters);
  assert.equal(gitParameters.additionalProperties, false);
  assert.deepEqual(Object.keys(gitParameters.properties), ['action', 'changeId', 'expectedRevision', 'planVersion', 'requestId', 'baselineId']);
  assert.deepEqual(gitParameters.required, ['action', 'changeId', 'expectedRevision', 'planVersion', 'requestId']);
  assert.equal(gitParameters.oneOf.length, 2);
  assert.equal(tool.isConcurrencySafe(), false);
  assert.equal(f.tools.get('engineering_plan').isConcurrencySafe({ action: 'gitObservations' }), true);
  const output = await f.call();
  assert.deepEqual(JSON.parse(tool.output.render(f.args, output)[0].text), output);
  const human = await f.commands.get('engineering').handler({ rawInput: JSON.stringify(f.args), agent: f.exec.agent, signal: f.exec.signal });
  assert.equal(human.kind, 'error'); assert.match(human.text, /UNKNOWN_ACTION/);
  f.cleanup.splice(0).reverse().forEach(fn => fn());
  assert.equal(f.tools.size + f.commands.size + f.skills.size, 0);
});

test('capture persists trusted metadata without changing plan; read exposes exact envelopes', async t => {
  const f = await fixture(t), before = await f.core.execute({ action: 'get', changeId: f.state.id });
  const value = await f.call();
  assert.equal(value.created, true); assert.equal(value.bindingCurrent, true);
  assert.equal(value.observation.status, 'ok'); assert.equal(f.calls.length, 14);
  assert.deepEqual(value.observation.actor, { kind: 'agent', id: 'owner' });
  assert.equal(value.observation.sourceRevision, f.state.revision);
  const envelope = await f.store.get(f.state.id, value.observation.id);
  assert.deepEqual(envelope.request, { action: 'capture' });
  assert.deepEqual((await f.read()).observations, [envelope]);
  assert.deepEqual((await f.read({ observationId: value.observation.id })).observation, envelope);
  assert.deepEqual(await f.core.execute({ action: 'get', changeId: f.state.id }), before);
});

test('replay survives a new apply and changed revision without collecting again', async t => {
  const f = await fixture(t), first = await f.call();
  await f.core.execute({ action: 'save', changeId: f.state.id, expectedRevision: f.state.revision, patch: { title: 'Changed' } });
  f.cleanup.splice(0).reverse().forEach(fn => fn()); apply(f.ctx);
  const replay = await f.call();
  assert.deepEqual(replay.observation, first.observation); assert.equal(replay.created, false);
  assert.equal(replay.bindingCurrent, false); assert.equal(f.calls.length, 14);
});

test('unknown changes and fresh revision/version mismatches fail before shell', async t => {
  const f = await fixture(t);
  for (const [patch, code] of [[{ changeId: randomUUID() }, 'NOT_FOUND'], [{ expectedRevision: 99 }, 'REVISION_CONFLICT'], [{ planVersion: 99 }, 'PLAN_VERSION_CONFLICT']]) {
    await assert.rejects(f.call({ ...f.args, ...patch }), error => error.code === code);
  }
  await assert.rejects(f.read({ changeId: randomUUID() }), error => error.code === 'NOT_FOUND');
  assert.equal(f.calls.length, 0);
});

test('replay binds owner, revision, version and exact action/baseline', async t => {
  const f = await fixture(t), first = await f.call();
  for (const patch of [{ expectedRevision: 2 }, { planVersion: 2 }, { action: 'compare', baselineId: first.observation.id }]) {
    await assert.rejects(f.call({ ...f.args, ...patch }), error => error.code === 'REQUEST_CONFLICT');
  }
  await assert.rejects(f.call(f.args, { ...f.exec, agent: { id: 'other', session: f.exec.agent.session } }), error => error.code === 'REQUEST_CONFLICT');
  assert.equal(f.calls.length, 14);
});

test('extra fields, missing fields, invalid ids and accessor/symbol inputs fail closed', async t => {
  const f = await fixture(t);
  for (const patch of [{ cwd: f.root }, { command: 'git status' }, { actor: { kind: 'user', id: 'spoof' } },
    { baselineId: randomUUID() }, { action: 'compare' }, { action: 'other' }, { requestId: 'CON' },
    { changeId: '../escape' }, { expectedRevision: 0 }, { planVersion: Number.MAX_SAFE_INTEGER + 1 }]) {
    await assert.rejects(f.call({ ...f.args, ...patch }));
  }
  const missing = { ...f.args }; delete missing.requestId;
  await assert.rejects(f.call(missing));
  await assert.rejects(f.call({ ...f.args, [Symbol('hidden')]: true }));
  let reads = 0;
  const getter = { ...f.args }; Object.defineProperty(getter, 'action', { enumerable: true, get() { reads++; return 'capture'; } });
  await assert.rejects(f.call(getter)); assert.equal(reads, 0);
  await assert.rejects(f.read({ command: 'git status' }));
  await assert.rejects(f.read({ observationId: undefined }));
  assert.equal(f.calls.length, 0);
});

test('identity and policy checks run before collection', async t => {
  const f = await fixture(t);
  for (const exec of [{ ...f.exec, agent: null }, { ...f.exec, callId: null }, { ...f.exec, rootCallId: null }, { ...f.exec, signal: null }]) {
    await assert.rejects(f.call(f.args, exec), /Admitted model execution required/);
  }
  f.ctx.sandboxPolicy.resolve = () => ({ workspaceRoot: path.dirname(f.root) });
  await assert.rejects(f.call(), error => error.code === 'ENGINEERING_WORKSPACE_MISMATCH');
  assert.equal(f.calls.length, 0);
});

test('pre-cancelled execution writes nothing; cancellation during collection persists identifiable fact', async t => {
  const f = await fixture(t);
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(f.call(f.args, { ...f.exec, signal: cancelled.signal }), { name: 'AbortError' });
  assert.deepEqual(await f.store.list(f.state.id), []);
  f.override = async () => { f.controller.abort(); return ok(); };
  const value = await f.call();
  assert.equal(value.observation.status, 'error'); assert.equal(value.observation.error.code, 'aborted');
  assert.equal((await f.store.list(f.state.id)).length, 1);
  const replay = await f.call(f.args, { ...f.exec, signal: new AbortController().signal });
  assert.deepEqual(replay.observation, value.observation); assert.equal(f.calls.length, 1);
});

test('version change during collection preserves original binding metadata and returns false', async t => {
  const f = await fixture(t);
  f.override = async () => {
    if (f.calls.length === 1) await f.core.execute({ action: 'save', changeId: f.state.id, expectedRevision: f.state.revision, patch: { goal: 'New goal' } });
  };
  const value = await f.call();
  assert.equal(value.bindingCurrent, false); assert.equal(value.observation.sourceRevision, f.state.revision);
  assert.equal((await f.store.list(f.state.id)).length, 1);
});

test('compare reads same-change baseline and returns comparison, replay never recollects', async t => {
  const f = await fixture(t), baseline = await f.call();
  const args = { ...f.args, action: 'compare', requestId: 'compare-1', baselineId: baseline.observation.id };
  const value = await f.call(args);
  assert.equal(value.comparison.comparable, true); assert.equal(value.comparison.observedEqual, true);
  assert.equal(value.comparison.fullWorkspaceEquality, 'not-established');
  const replay = await f.call(args);
  assert.deepEqual(replay.comparison, value.comparison); assert.equal(f.calls.length, 28);
  const envelope = await f.store.get(f.state.id, value.observation.id);
  assert.deepEqual(envelope.request, { action: 'compare', baselineId: baseline.observation.id });
  await assert.rejects(f.call({ ...args, baselineId: value.observation.id }), error => error.code === 'REQUEST_CONFLICT');
  await assert.rejects(f.call({ ...args, requestId: 'missing-base', baselineId: randomUUID() }), error => error.code === 'NOT_FOUND');
  const other = (await f.core.execute({ action: 'create', title: 'Other', goal: 'Isolated' })).change;
  await assert.rejects(f.call({ ...args, requestId: 'cross-change', changeId: other.id, expectedRevision: other.revision, planVersion: other.planVersion }), error => error.code === 'NOT_FOUND');
  assert.equal(f.calls.length, 28);
});

test('failed collection remains non-comparable with explicit uncertainty', async t => {
  const f = await fixture(t), baseline = await f.call();
  f.override = async () => ok('', { exitCode: 128, stderr: { text: 'fatal: not a git repository (or any of the parent directories): .git\n', truncated: false } });
  const value = await f.call({ ...f.args, action: 'compare', requestId: 'failed', baselineId: baseline.observation.id });
  assert.equal(value.observation.status, 'not_git'); assert.equal(value.comparison.comparable, false);
  assert.equal(value.comparison.observedEqual, null); assert.equal(value.comparison.headChanged, null);
  assert.ok(value.comparison.reasons.some(reason => reason.includes('not_git')));
});

test('apply-local inflight joins identical requests and rejects conflicting parameters', async t => {
  const f = await fixture(t), entered = deferred(), release = deferred();
  f.override = async () => { if (f.calls.length === 1) { entered.resolve(); await release.promise; } };
  const first = f.call(); await entered.promise;
  const second = f.call();
  for (const patch of [{ expectedRevision: 2 }, { action: 'compare', baselineId: randomUUID() }]) {
    await assert.rejects(f.call({ ...f.args, ...patch }), error => error.code === 'REQUEST_CONFLICT');
  }
  await assert.rejects(f.call(f.args, { ...f.exec, agent: { id: 'other', session: f.exec.agent.session } }), error => error.code === 'REQUEST_CONFLICT');
  release.resolve();
  const values = await Promise.all([first, second]);
  assert.deepEqual(values[0], values[1]); assert.equal(f.calls.length, 14);
  assert.equal((await f.store.list(f.state.id)).length, 1);
});

test('separate apply instances may both collect; final store publishes only one immutable request', async t => {
  const f = await fixture(t), entered = deferred(), release = deferred();
  const original = f.tools.get('engineering_git');
  apply(f.ctx);
  let roots = 0;
  f.override = async spec => {
    if (spec.command.includes('--show-toplevel') && ++roots <= 2) {
      if (roots === 2) entered.resolve();
      await release.promise;
    }
  };
  const first = original.execute(f.args, f.exec), second = f.call();
  await entered.promise; release.resolve();
  const values = await Promise.all([first, second]);
  assert.deepEqual(values[0].observation, values[1].observation);
  assert.deepEqual(values.map(value => value.created).sort(), [false, true]);
  assert.equal(f.calls.length, 28);
  assert.equal((await f.store.list(f.state.id)).length, 1);
});

test('legacy records remain readable but ambiguous replay fails before collection', async t => {
  const f = await fixture(t), value = await f.call();
  const legacy = { ...value.observation, id: randomUUID() };
  await f.store.create(f.state.id, legacy, { requestId: 'legacy', ownerSessionId: 'owner' });
  const stored = (await f.read({ observationId: legacy.id })).observation;
  assert.equal(Object.hasOwn(stored, 'request'), false);
  await assert.rejects(f.call({ ...f.args, requestId: 'legacy' }), error => error.code === 'REQUEST_CONFLICT');
  assert.equal(f.calls.length, 14);
});

test('inflight cleanup after failed admission permits corrected retry', async t => {
  const f = await fixture(t);
  await assert.rejects(f.call({ ...f.args, expectedRevision: 99 }));
  assert.equal((await f.call()).created, true);
});
