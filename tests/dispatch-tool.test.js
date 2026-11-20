import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { apply, dispatchParameters, inject } from '../index.js';
import { EngineeringStore } from '../src/core.js';
import { DispatchRunStore } from '../src/dispatch-store.js';

// Registered-body integration with real core/runner/store. Host service doubles
// do not claim to reproduce the DSH admission pipeline or start actual Agents.
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const outcome = { output: [{ type: 'text', text: 'fixture returned' }], stopReason: 'completed' };
async function fixture(t, { approved = true, dependent = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dispatch-tool-'));
  const jobs = [], starts = [], cleanup = [], tools = new Map(), skills = new Map(), commands = new Map();
  const completion = deferred();
  const agent = { id: 'owner', session: { id: 'owner', cwd: root, requestHeader: () => ({ config: { provider: 'fixture', model: 'fixture' } }) },
    ctx: { get: () => undefined }, options: {} };
  const exec = { agent, callId: 'call', rootCallId: 'root-call', signal: new AbortController().signal };
  const core = new EngineeringStore(root), runs = new DispatchRunStore(root);
  let disposals = 0;
  const register = map => definition => { map.set(definition.name, definition); return () => map.delete(definition.name); };
  const ctx = {
    effect: fn => { cleanup.push(fn()); },
    tools: { register: register(tools) }, skills: { register: register(skills) }, commands: { register: register(commands) },
    workingDirectory: { ensure: async (a, signal) => { assert.equal(a, exec.agent); assert.equal(signal, exec.signal); return a.session.cwd; } },
    sandboxPolicy: { resolve: ({ session }) => ({ workspaceRoot: session.cwd }) },
    subagents: {
      getProvider: name => { assert.equal(name, 'spawn'); return { name }; },
      resolveMaxDepth: () => 1,
      startActivation: async spec => {
        starts.push(spec);
        const records = await runs.list(args.changeId);
        const run = records.find(record => record.childId === spec.childId);
        assert.ok(run, 'child identity was durably reserved before activation');
        assert.equal(run.state, 'starting'); assert.ok(run.jobId);
        return { childId: spec.childId, result: completion.promise, dispose: async () => { disposals++; } };
      },
    },
    jobs: { start: spec => { const id = `job-${jobs.length}`; const hooks = spec.run({ id }); jobs.push({ id, spec, hooks }); return id; } },
  };
  apply(ctx);
  t.after(async () => {
    completion.resolve(outcome);
    await Promise.all(jobs.map(job => job.hooks.done));
    cleanup.splice(0).reverse().forEach(dispose => dispose());
    await rm(root, { recursive: true, force: true });
  });
  let state = (await core.execute({ action: 'create', title: 'Dispatch fixture', goal: 'Test registered body' })).change;
  const action = async (action, fields = {}, actor) => {
    state = (await core.execute({ action, changeId: state.id, expectedRevision: state.revision, ...fields }, actor)).change;
  };
  await action('save', { patch: { tasks: ['task', 'other'].map(id => ({ id, title: id,
    dependencies: dependent && id === 'task' ? ['other'] : [], expectedFiles: [`${id}.js`],
    acceptanceCriteria: ['works'], verificationCommands: [] })) } });
  // Approval exists only inside this newly-created temporary fixture.
  if (approved) await action('approve', {}, { kind: 'user', id: 'fixture-reviewer' });
  const args = { changeId: state.id, taskId: 'task', expectedRevision: state.revision, planVersion: state.planVersion, requestId: 'attempt' };
  return { root, core, runs, args, ctx, exec, jobs, starts, tools, skills, commands, cleanup, completion, action,
    get state() { return state; }, get disposals() { return disposals; },
    call: input => tools.get('engineering_dispatch').execute(input ?? args, exec) };
}

 test('strict five-field schema, compatible registrations and effect cleanup', async t => {
  const f = await fixture(t), tool = f.tools.get('engineering_dispatch');
  assert.equal(tool.parameters, dispatchParameters);
  assert.equal(dispatchParameters.additionalProperties, false);
  assert.deepEqual(dispatchParameters.required, ['changeId', 'taskId', 'expectedRevision', 'planVersion', 'requestId']);
  assert.deepEqual(Object.keys(dispatchParameters.properties), dispatchParameters.required);
  for (const key of ['expectedRevision', 'planVersion']) assert.deepEqual(dispatchParameters.properties[key], { type: 'integer', minimum: 1 });
  assert.equal(dispatchParameters.properties.requestId.pattern, '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$');
  assert.ok(inject.includes('subagents')); assert.equal(tool.isConcurrencySafe(), false);
  assert.deepEqual([...f.tools.keys()], ['engineering_plan', 'engineering_verify', 'engineering_dispatch']);
  assert.deepEqual([...f.commands.keys()], ['engineering']);
  assert.equal(f.skills.size, 3); assert.equal(f.cleanup.length, 7);
  for (const phrase of ['publication', 'not completion', 'job tools', 'dispatchRuns', 'without restarting', 'not task acceptance']) assert.ok(tool.description.includes(phrase));
  assert.deepEqual(tool.output.render({}, { runId: 'run' }), [{ type: 'text', text: JSON.stringify({ runId: 'run' }, null, 2) }]);
  f.cleanup.splice(0).reverse().forEach(dispose => dispose());
  assert.equal(f.tools.size, 0); assert.equal(f.skills.size, 0); assert.equal(f.commands.size, 0);
});

test('registered body publishes once; replay after revision changes preserves original run and plan', async t => {
  const f = await fixture(t), before = structuredClone(f.state);
  const values = await Promise.all([f.call(), f.call()]);
  assert.equal(values[0].runId, values[1].runId); assert.equal(f.jobs.length, 1);
  const published = values.find(value => Object.keys(value).length === 2);
  assert.deepEqual(Object.keys(published).sort(), ['jobId', 'runId']);
  let run = await f.runs.get(f.args.changeId, published.runId);
  assert.ok(['starting', 'running'].includes(run.state)); assert.equal(run.result, null);
  assert.equal(run.ownerSessionId, f.exec.agent.id);
  assert.match(run.childId, /^[0-9a-f-]{36}$/); assert.match(run.hostInstanceId, /^[0-9a-f-]{36}$/);
  assert.equal(f.starts.length, 1); assert.equal(f.starts[0].childId, run.childId);
  assert.equal(f.starts[0].parent, f.exec.agent); assert.equal(f.starts[0].cwd, f.root);
  assert.deepEqual(f.jobs[0].spec.toolCall, { callId: 'call', rootCallId: 'root-call' });
  assert.equal(f.jobs[0].spec.owner, f.exec.agent.id);
  assert.deepEqual((await f.core.execute({ action: 'get', changeId: f.args.changeId })).change, before);
  await f.action('transition', { taskId: 'other', status: 'blocked', reason: 'fixture revision change' });
  const replay = await f.call({ ...f.args, expectedRevision: f.state.revision });
  assert.equal(replay.runId, run.runId); assert.equal(replay.admittedRevision, before.revision);
  f.completion.resolve(outcome); assert.equal((await f.jobs[0].hooks.done).status, 'completed');
  run = await f.runs.get(f.args.changeId, run.runId);
  assert.equal(run.state, 'returned'); assert.equal(f.disposals, 1);
  assert.deepEqual(await f.call(), run); assert.equal(f.starts.length, 1);
  const query = { action: 'dispatchRuns', changeId: f.args.changeId, runId: run.runId };
  assert.deepEqual(await f.tools.get('engineering_plan').execute(query, f.exec), { run });
  const state = (await f.core.execute({ action: 'get', changeId: f.args.changeId })).change;
  assert.equal(state.tasks[0].status, 'pending'); assert.deepEqual(state.evidence, []);
  assert.deepEqual(state.approvals, before.approvals); assert.equal(state.deliveryAcceptance, before.deliveryAcceptance);
});

test('apply identity is reused; foreign reserved run replays without startup across reload', async t => {
  const f = await fixture(t), hosts = [], children = [];
  f.completion.resolve(outcome);
  for (let i = 0; i < 3; i++) {
    if (i === 2) { f.cleanup.splice(0).reverse().forEach(dispose => dispose()); apply(f.ctx); }
    const launched = await f.call({ ...f.args, requestId: `attempt-${i}` });
    await f.jobs.at(-1).hooks.done;
    const run = await f.runs.get(f.args.changeId, launched.runId);
    hosts.push(run.hostInstanceId); children.push(run.childId);
  }
  assert.equal(hosts[0], hosts[1]); assert.notEqual(hosts[1], hosts[2]); assert.equal(new Set(children).size, 3);
  const g = await fixture(t);
  const { run } = await g.core.reserveDispatch(g.args, { hostInstanceId: 'old-host', ownerSessionId: g.exec.agent.id, childId: 'old-child' });
  assert.deepEqual(await g.call(), run);
  g.cleanup.splice(0).reverse().forEach(dispose => dispose()); apply(g.ctx);
  assert.deepEqual(await g.call(), run); assert.equal(g.jobs.length, 0); assert.equal(g.starts.length, 0);
});

for (const [options, code] of [[{ approved: false }, 'APPROVAL_REQUIRED'], [{ dependent: true }, 'DEPENDENCY_BLOCKED']]) {
  test(`registered body blocks ${code} before reservation`, async t => {
    const f = await fixture(t, options);
    await assert.rejects(f.call(), error => error.code === code);
    assert.deepEqual(await f.runs.list(f.args.changeId), []); assert.equal(f.jobs.length, 0); assert.equal(f.starts.length, 0);
  });
}

test('strict body rejects additional fields, missing fields and invalid bindings', async t => {
  const f = await fixture(t);
  for (const key of ['prompt', 'cwd', 'model', 'provider', 'agentPreset', 'hostInstanceId', 'ownerSessionId', 'childId', 'actor', 'action']) {
    await assert.rejects(f.call({ ...f.args, [key]: 'forged' }), error => error.code === 'INVALID_INPUT');
  }
  for (const key of dispatchParameters.required) { const input = { ...f.args }; delete input[key]; await assert.rejects(f.call(input)); }
  for (const patch of [{ expectedRevision: 1 }, { planVersion: 2 }, { requestId: '../escape' }, { taskId: 'missing' }]) await assert.rejects(f.call({ ...f.args, ...patch }));
  assert.deepEqual(await f.runs.list(f.args.changeId), []); assert.equal(f.jobs.length, 0);
});

test('wrong owner replay fails and missing execution identity creates no run', async t => {
  const f = await fixture(t);
  for (const key of ['agent', 'callId', 'rootCallId']) {
    const exec = { ...f.exec }; delete exec[key];
    await assert.rejects(f.tools.get('engineering_dispatch').execute(f.args, exec), /TOOL_EXECUTION_REQUIRED/);
  }
  await assert.rejects(f.tools.get('engineering_dispatch').execute(f.args, { ...f.exec, agent: { id: 'owner' } }), /TOOL_EXECUTION_REQUIRED/);
  assert.deepEqual(await f.runs.list(f.args.changeId), []);
  const { run } = await f.core.reserveDispatch(f.args, { hostInstanceId: 'host', ownerSessionId: 'another', childId: 'child' });
  await assert.rejects(f.call(), error => error.code === 'REQUEST_CONFLICT');
  assert.deepEqual(await f.runs.get(f.args.changeId, run.runId), run); assert.equal(f.jobs.length, 0);
});

test('workspace mismatch and abort before or during ensure create no reservation', async t => {
  const f = await fixture(t);
  f.ctx.sandboxPolicy.resolve = () => ({ workspaceRoot: path.join(f.root, 'other') });
  await assert.rejects(f.call(), /WORKSPACE_MISMATCH/);
  f.exec.signal = AbortSignal.abort(); await assert.rejects(f.call());
  const controller = new AbortController(); f.exec.signal = controller.signal;
  f.ctx.workingDirectory.ensure = async () => { controller.abort(); return f.root; };
  await assert.rejects(f.call());
  assert.deepEqual(await f.runs.list(f.args.changeId), []); assert.equal(f.jobs.length, 0);
});

test('workspace drift after reservation records error; replay never restarts', async t => {
  const f = await fixture(t); let count = 0;
  f.ctx.sandboxPolicy.resolve = () => ({ workspaceRoot: ++count === 1 ? f.root : path.join(f.root, 'changed') });
  await assert.rejects(f.call(), /workspace/i);
  const records = await f.runs.list(f.args.changeId);
  assert.equal(records.length, 1); assert.equal(records[0].state, 'error');
  assert.equal(f.jobs.length, 0); assert.equal(f.starts.length, 0);
  f.ctx.sandboxPolicy.resolve = () => ({ workspaceRoot: f.root });
  assert.deepEqual(await f.call(), records[0]);
});

test('human command and planning tool expose no dispatch execution detour', async t => {
  const f = await fixture(t);
  for (const action of ['dispatch', 'engineering_dispatch', 'reserveDispatch', 'launchDispatch']) {
    const input = { ...f.args, action };
    const response = await f.commands.get('engineering').handler({ agent: f.exec.agent, signal: f.exec.signal, rawInput: JSON.stringify(input) });
    assert.equal(response.kind, 'error'); assert.match(response.text, /UNKNOWN_ACTION/);
    await assert.rejects(f.tools.get('engineering_plan').execute(input, f.exec), /UNKNOWN_ACTION/);
  }
  for (const action of ['approve', 'replan', 'acceptDelivery']) await assert.rejects(f.tools.get('engineering_plan').execute({ action }, f.exec), /HUMAN_APPROVAL_REQUIRED/);
  assert.equal(f.jobs.length, 0); assert.equal(f.starts.length, 0); assert.deepEqual(await f.runs.list(f.args.changeId), []);
});
