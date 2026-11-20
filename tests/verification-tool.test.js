import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { apply, createOperations, inject, parameters, verificationParameters } from '../index.js';
import { EngineeringStore } from '../src/core.js';
import { VerificationRunStore } from '../src/verification-store.js';

// Registration-body integration: real core, reservation, runner and disk store.
// Host services below are contract doubles, not a real DSH tools/sandbox pipeline.
const result = { exitCode: 0, signal: null, timedOut: false, aborted: false, timeoutMs: 1000,
  stdout: { text: 'fixture output', truncated: false }, stderr: { text: '', truncated: false } };
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'verification-tool-'));
  const jobs = [], requests = [];
  t.after(async () => { await Promise.all(jobs.map(j => j.hooks.done)); await rm(root, { recursive: true, force: true }); });
  const agent = { id: 'owner', session: { id: 'owner', cwd: root } };
  const exec = { agent, callId: 'call', rootCallId: 'root-call', signal: new AbortController().signal };
  const tools = new Map(); let human, spawns = 0;
  const ctx = {
    effect: fn => fn(), skills: { register: () => () => {} },
    tools: { register: def => { tools.set(def.name, def); return () => {}; } },
    commands: { register: def => { human = def; return () => {}; } },
    workingDirectory: { ensure: async a => a.session.cwd },
    sandboxPolicy: { resolve: ({ session }) => ({ workspaceRoot: session.cwd, mode: 'workspace-write', sessionId: session.id }) },
    shellEnv: { collect: e => { assert.equal(e, exec); return { DSH_FIXTURE: 'yes' }; } },
    shell: {
      resolve: request => { requests.push(request); return { timeoutMs: 1000, stdoutMaxBytes: 65536, ...request }; },
      execute: async () => {
        spawns++;
        const observed = { readFrom: from => ({ text: '', nextOffset: from, lossy: false }) };
        return { done: Promise.resolve(), result: async () => result, kill: () => true, observed: { stdout: observed, stderr: observed } };
      },
    },
    jobs: { start: spec => { const id = `bash-fixture-${jobs.length}`; const hooks = spec.run({ id }); jobs.push({ id, spec, hooks }); return id; } },
  };
  apply(ctx);
  const core = new EngineeringStore(root), runs = new VerificationRunStore(root);
  let state = (await core.execute({ action: 'create', title: 'Tool', goal: 'Verify registration boundary' })).change;
  const action = async (action, fields = {}, actor) => {
    state = (await core.execute({ action, changeId: state.id, expectedRevision: state.revision, ...fields }, actor)).change;
  };
  await action('save', { patch: { tasks: [{ id: 'task', title: 'Task', dependencies: [], expectedFiles: [], acceptanceCriteria: ['works'], verificationCommands: ['echo fixture'] }] } });
  await action('approve', {}, { kind: 'user', id: 'reviewer' });
  await action('transition', { taskId: 'task', status: 'running' });
  await action('transition', { taskId: 'task', status: 'verifying' });
  const args = { changeId: state.id, taskId: 'task', expectedRevision: state.revision, planVersion: state.planVersion, commandIndex: 0, command: 'echo fixture', requestId: 'attempt' };
  return { root, ctx, exec, args, core, runs, jobs, requests, tools, action, get state() { return state; }, get human() { return human; }, get spawns() { return spawns; }, call: input => tools.get('engineering_verify').execute(input ?? args, exec) };
}

test('strict verification schema and actual registration preserve execution identity and workspace', async t => {
  const f = await fixture(t);
  assert.equal(verificationParameters.additionalProperties, false);
  assert.deepEqual(verificationParameters.required, Object.keys(verificationParameters.properties));
  for (const service of ['shell', 'jobs', 'shellEnv', 'sandboxPolicy']) assert.ok(inject.includes(service));
  assert.equal(f.tools.get('engineering_verify').isConcurrencySafe(), false);
  const launched = await f.call();
  assert.equal((await f.jobs[0].hooks.done).status, 'completed');
  const run = await f.runs.get(f.args.changeId, launched.runId);
  assert.equal(run.state, 'succeeded'); assert.equal(run.ownerSessionId, f.exec.agent.id);
  assert.match(run.hostInstanceId, /^[0-9a-f-]{36}$/);
  assert.equal(f.requests[0].workdir, f.root);
  assert.deepEqual(f.requests[0].dshEnv, { DSH_FIXTURE: 'yes' });
  assert.equal(f.requests[0].sandboxPolicy.workspaceRoot, f.root);
  assert.deepEqual(f.jobs[0].spec.toolCall, { callId: 'call', rootCallId: 'root-call' });
  assert.equal(f.jobs[0].spec.owner, f.exec.agent.id);
  const change = (await f.core.execute({ action: 'get', changeId: f.args.changeId })).change;
  assert.equal(change.tasks[0].status, 'verifying'); assert.deepEqual(change.evidence, []);
});

test('concurrent replay launches once and completed replay returns original run', async t => {
  const f = await fixture(t);
  const values = await Promise.all([f.call(), f.call()]);
  assert.equal(values[0].runId, values[1].runId);
  assert.equal(f.jobs.length, 1);
  await f.jobs[0].hooks.done;
  const run = await f.runs.get(f.args.changeId, values[0].runId);
  assert.deepEqual(await f.call(), run); assert.equal(f.spawns, 1);
  await assert.rejects(f.call({ ...f.args, command: 'echo changed' }), e => e.code === 'REQUEST_CONFLICT');
});

test('apply owns one random host identity; reload observes foreign reserved run without recovery', async t => {
  const f = await fixture(t);
  const prior = await f.core.reserveVerification(f.args, { hostInstanceId: 'prior-host', ownerSessionId: f.exec.agent.id });
  assert.deepEqual(await f.call(), prior.run); assert.equal(f.jobs.length, 0);
  apply(f.ctx);
  assert.deepEqual(await f.call(), prior.run); assert.equal(f.jobs.length, 0);
  await assert.rejects(f.call({ ...f.args, requestId: 'other' }), e => e.code === 'VERIFICATION_RUN_BLOCKED');
  assert.equal((await f.runs.get(f.args.changeId, prior.run.runId)).state, 'reserved');
});

test('same apply reuses host id and fresh apply creates a different host id', async t => {
  const f = await fixture(t), ids = [];
  for (let i = 0; i < 3; i++) {
    if (i === 2) apply(f.ctx);
    const launched = await f.call({ ...f.args, requestId: `request-${i}` });
    await f.jobs.at(-1).hooks.done;
    ids.push((await f.runs.get(f.args.changeId, launched.runId)).hostInstanceId);
  }
  assert.equal(ids[0], ids[1]); assert.notEqual(ids[1], ids[2]);
});

test('body rejects extra fields, missing required fields and stale or changed commands before launch', async t => {
  const f = await fixture(t);
  for (const key of ['cwd', 'actor', 'hostInstance', 'hostInstanceId', 'ownerSessionId', 'workdir']) {
    await assert.rejects(f.call({ ...f.args, [key]: 'forged' }), e => e.code === 'INVALID_INPUT');
  }
  for (const key of verificationParameters.required) {
    const args = { ...f.args }; delete args[key]; await assert.rejects(f.call(args));
  }
  for (const extra of [{ command: 'echo changed' }, { commandIndex: 1 }, { expectedRevision: 1 }, { planVersion: 2 }]) await assert.rejects(f.call({ ...f.args, ...extra }));
  assert.deepEqual(await f.runs.list(f.args.changeId), []); assert.equal(f.jobs.length, 0);
});

test('abort before ensure and during ensure creates no reservation', async t => {
  const f = await fixture(t), controller = new AbortController();
  f.exec.signal = AbortSignal.abort(); await assert.rejects(f.call());
  f.exec.signal = controller.signal;
  f.ctx.workingDirectory.ensure = async () => { controller.abort(); return f.root; };
  await assert.rejects(f.call());
  assert.deepEqual(await f.runs.list(f.args.changeId), []); assert.equal(f.jobs.length, 0);
});

test('workspace mismatch fails before reservation; another workspace cannot read this plan', async t => {
  const f = await fixture(t);
  f.ctx.sandboxPolicy.resolve = () => ({ workspaceRoot: path.join(f.root, 'other'), mode: 'workspace-write' });
  await assert.rejects(f.call(), /WORKSPACE_MISMATCH/);
  assert.deepEqual(await f.runs.list(f.args.changeId), []);
  f.exec.agent.session.cwd = path.join(f.root, 'other');
  await assert.rejects(f.call(), e => e.code === 'NOT_FOUND');
  assert.equal(f.jobs.length, 0);
});

test('workspace drift after reservation records error without launching a job or process', async t => {
  const f = await fixture(t);
  let resolutions = 0;
  f.ctx.sandboxPolicy.resolve = () => ({
    workspaceRoot: ++resolutions === 1 ? f.root : path.join(f.root, 'changed'), mode: 'workspace-write',
  });
  await assert.rejects(f.call(), /workspace/i);
  const runs = await f.runs.list(f.args.changeId);
  assert.equal(runs.length, 1); assert.equal(runs[0].state, 'error');
  assert.equal(f.jobs.length, 0); assert.equal(f.spawns, 0);
  f.ctx.sandboxPolicy.resolve = () => ({ workspaceRoot: f.root, mode: 'workspace-write' });
  assert.deepEqual(await f.call(), runs[0]);
});

test('manual command and planning tool have no verification launch route', async t => {
  const f = await fixture(t);
  for (const action of ['verify', 'engineering_verify', 'reserveVerification']) {
    const input = { ...f.args, action };
    assert.equal((await f.human.handler({ agent: f.exec.agent, signal: f.exec.signal, rawInput: JSON.stringify(input) })).kind, 'error');
    await assert.rejects(f.tools.get('engineering_plan').execute(input, f.exec), /UNKNOWN_ACTION/);
  }
  for (const action of ['approve', 'replan', 'resolveUnknown']) await assert.rejects(f.tools.get('engineering_plan').execute({ action }, f.exec), /HUMAN_APPROVAL_REQUIRED/);
  assert.equal(f.jobs.length, 0);
  assert.deepEqual(await f.runs.list(f.args.changeId), []);
});

test('verificationRuns lists and selects records without recovery or plan mutation', async t => {
  const f = await fixture(t), plan = f.tools.get('engineering_plan');
  assert.ok(parameters.properties.action.enum.includes('verificationRuns'));
  assert.equal(parameters.properties.runId.type, 'string');
  assert.equal(plan.isConcurrencySafe({ action: 'verificationRuns' }), true);
  const input = { action: 'verificationRuns', changeId: f.args.changeId };
  assert.deepEqual(await plan.execute(input, f.exec), { runs: [] });
  const before = await f.core.execute({ action: 'get', changeId: f.args.changeId });
  const { run } = await f.core.reserveVerification(f.args, { hostInstanceId: 'old-host', ownerSessionId: f.exec.agent.id });
  assert.deepEqual(await plan.execute(input, f.exec), { runs: [run] });
  assert.deepEqual(await plan.execute({ ...input, runId: run.runId }, f.exec), { run });
  const human = await f.human.handler({ agent: f.exec.agent, signal: f.exec.signal, rawInput: JSON.stringify(input) });
  assert.equal(human.kind, 'success'); assert.deepEqual(JSON.parse(human.text), { runs: [run], action: 'verificationRuns' });
  assert.deepEqual(await f.runs.get(run.changeId, run.runId), run);
  assert.deepEqual(await f.core.execute({ action: 'get', changeId: f.args.changeId }), before);
  assert.equal(f.jobs.length, 0); assert.equal(f.spawns, 0);
});

test('verificationRuns validates change, run and extra fields within the caller workspace', async t => {
  const f = await fixture(t), execute = createOperations(f.ctx);
  const query = { action: 'verificationRuns', changeId: f.args.changeId };
  for (const input of [
    { action: 'verificationRuns' }, { ...query, changeId: 'missing' }, { ...query, changeId: '../escape' },
    { ...query, runId: 'missing' }, { ...query, runId: '../escape' }, { ...query, runId: undefined },
    { ...query, actor: 'user' }, { ...query, cwd: f.root }, { ...query, expectedRevision: f.args.expectedRevision },
  ]) await assert.rejects(execute(input, f.exec.agent, 'agent', f.exec.signal));
  const other = { id: 'other', session: { id: 'other', cwd: path.join(f.root, 'other') } };
  await assert.rejects(execute(query, other, 'agent', f.exec.signal), e => e.code === 'NOT_FOUND');
  await assert.rejects(execute(query, f.exec.agent, 'agent', AbortSignal.abort()), /CANCELLED/);
  assert.deepEqual(await f.runs.list(f.args.changeId), []);
  assert.equal(f.jobs.length, 0);
});

test('missing admitted execution identity fails before reservation', async t => {
  const f = await fixture(t);
  for (const key of ['callId', 'rootCallId', 'agent']) {
    const exec = { ...f.exec }; delete exec[key];
    await assert.rejects(f.tools.get('engineering_verify').execute(f.args, exec), /TOOL_EXECUTION_REQUIRED/);
  }
  assert.deepEqual(await f.runs.list(f.args.changeId), []);
});
