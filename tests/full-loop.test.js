import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { apply, createOperations } from '../index.js';

// End-to-end walk of the whole loop through the registered tools and the human
// command, with a simulated executor: native jobs, subagent activation and shell
// are fakes. It proves the ORDER and the gates, not that any real command ran.
async function harness(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'engineering-loop-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'workspace');
  const tools = new Map();
  const jobs = [];
  const children = [];
  let command;
  const ctx = {
    workingDirectory: { ensure: async () => workspace },
    sandboxPolicy: { resolve: () => ({ workspaceRoot: workspace, mode: 'workspace-write', sessionId: 'loop-session' }) },
    shellEnv: { collect: () => ({}) },
    shell: {
      resolve: request => ({ ...request, timeoutMs: 1000, stdoutMaxBytes: 65536 }),
      execute: async () => ({
        done: Promise.resolve(),
        kill: () => true,
        result: async () => ({
          exitCode: 0, signal: null, timedOut: false, aborted: false, timeoutMs: 1000,
          stdout: { text: 'ep-positive-smoke', truncated: false },
          stderr: { text: '', truncated: false },
        }),
      }),
    },
    subagents: {
      getProvider: name => (name === 'spawn' ? { name: 'spawn' } : undefined),
      resolveMaxDepth: () => 2,
      startActivation: async spec => {
        children.push(spec);
        return {
          childId: spec.childId,
          result: Promise.resolve({ output: [{ type: 'text', text: 'read-only dispatch finished' }], stopReason: 'completed' }),
          dispose: async () => {},
        };
      },
    },
    jobs: {
      start(spec) {
        const id = `bash-loop-${jobs.length + 1}`;
        const hooks = spec.run({ id, append() {}, updateProgress() {} });
        jobs.push({ id, spec, hooks });
        return id;
      },
    },
    tools: { register: definition => { tools.set(definition.name, definition); return () => {}; } },
    skills: { register: () => () => {} },
    commands: { register: definition => { command = definition; return () => {}; } },
    effect: fn => { fn(); },
  };
  apply(ctx);
  const agent = {
    id: 'loop-session',
    session: { id: 'loop-session', requestHeader: () => ({ config: { provider: 'fixture-provider', model: 'fixture-model' } }) },
    options: { provider: 'fixture-provider', model: 'fixture-model' },
    ctx: { get: () => undefined },
  };
  return {
    workspace, tools, jobs, children, command, agent,
    exec: { agent, signal: new AbortController().signal, callId: 'loop-call', rootCallId: 'loop-root' },
    operations: createOperations(ctx),
  };
}

const settle = async hook => {
  await hook.done.catch(() => {});
};

test('a plan can be carried from draft to accepted delivery through the registered tools', async t => {
  const h = await harness(t);
  const { tools, agent, exec } = h;
  const plan = tools.get('engineering_plan');

  let change = (await plan.execute({ action: 'create', title: 'Loop', goal: 'Close the loop' }, exec)).change;
  change = (await plan.execute({
    action: 'save',
    changeId: change.id,
    expectedRevision: change.revision,
    patch: {
      planning: { reviewRequirements: 'Approve once', sections: { requirements: { status: 'ready', note: 'Scope read' } } },
      tasks: [{
        id: 'T1',
        title: 'Loop task',
        acceptanceCriteria: ['Loop closes'],
        verificationCommands: ['echo ep-positive-smoke'],
      }],
    },
  }, exec)).change;

  // Nothing runs before a human approves the plan.
  await assert.rejects(
    tools.get('engineering_dispatch').execute({
      changeId: change.id, taskId: 'T1', expectedRevision: change.revision, planVersion: change.planVersion, requestId: 'loop-dispatch-1',
    }, exec),
    /approval/i,
  );
  assert.equal(h.jobs.length, 0);

  const approval = await h.command.handler({ agent, signal: exec.signal, rawInput: JSON.stringify({ action: 'approve', changeId: change.id, expectedRevision: change.revision }) });
  assert.equal(approval.kind, 'success');
  change = JSON.parse(approval.text).change;

  // The gate says "not ready" while the task is still pending, and names why.
  let gate = await plan.execute({ action: 'gateStatus', changeId: change.id }, exec);
  assert.equal(gate.ready, false);
  assert.deepEqual(gate.blockers.map(b => b.code), ['TASK_NOT_TERMINAL', 'NO_COMPLETED_TASK']);
  let frontier = await plan.execute({ action: 'readyTasks', changeId: change.id }, exec);
  assert.deepEqual(frontier.ready, ['T1']);

  const dispatched = await tools.get('engineering_dispatch').execute({
    changeId: change.id, taskId: 'T1', expectedRevision: change.revision, planVersion: change.planVersion, requestId: 'loop-dispatch-1',
  }, exec);
  assert.equal(typeof dispatched.runId, 'string');
  assert.equal(dispatched.jobId, h.jobs[0].id);
  await settle(h.jobs[0].hooks);
  assert.equal(h.children.length, 1);
  assert.match(h.children[0].prompt[0].text, /engineering_dispatch|T1/);
  const dispatchRun = (await plan.execute({ action: 'dispatchRuns', changeId: change.id }, exec)).runs.some(run => run.state === 'returned');
  assert.equal(dispatchRun, true);

  // Returning is not completion: the task is still pending and not dispatchable again.
  change = (await plan.execute({ action: 'get', changeId: change.id }, exec)).change;
  assert.equal(change.tasks[0].status, 'pending');
  const repeated = await plan.execute({ action: 'readyTasks', changeId: change.id }, exec);
  assert.deepEqual(repeated.ready, ['T1']);

  change = (await plan.execute({ action: 'transition', changeId: change.id, expectedRevision: change.revision, taskId: 'T1', status: 'running' }, exec)).change;
  change = (await plan.execute({ action: 'transition', changeId: change.id, expectedRevision: change.revision, taskId: 'T1', status: 'verifying' }, exec)).change;

  const verified = await tools.get('engineering_verify').execute({
    changeId: change.id, taskId: 'T1', expectedRevision: change.revision, planVersion: change.planVersion,
    commandIndex: 0, command: 'echo ep-positive-smoke', requestId: 'loop-verify-1',
  }, exec);
  assert.equal(typeof verified.runId, 'string');
  assert.equal(verified.jobId, h.jobs[1].id);
  await settle(h.jobs[1].hooks);
  const verifyRun = (await plan.execute({ action: 'verificationRuns', changeId: change.id }, exec)).runs[0];
  assert.equal(verifyRun.state, 'succeeded');
  assert.equal(verifyRun.exitCode, 0);

  // A succeeded command is still not acceptance: completing without evidence fails.
  await assert.rejects(
    plan.execute({ action: 'transition', changeId: change.id, expectedRevision: change.revision, taskId: 'T1', status: 'completed' }, exec),
    /evidence/i,
  );

  change = (await plan.execute({
    action: 'evidence', changeId: change.id, expectedRevision: change.revision,
    taskId: 'T1', criterion: 'Loop closes', outcome: 'passed', note: 'Observed exit 0 and the marker',
  }, exec)).change;
  change = (await plan.execute({ action: 'transition', changeId: change.id, expectedRevision: change.revision, taskId: 'T1', status: 'completed' }, exec)).change;
  assert.equal(change.tasks[0].status, 'completed');

  gate = await plan.execute({ action: 'gateStatus', changeId: change.id }, exec);
  assert.equal(gate.ready, true);
  assert.deepEqual(gate.blockers, []);

  // Delivery is the user's alone.
  await assert.rejects(
    plan.execute({ action: 'acceptDelivery', changeId: change.id, expectedRevision: change.revision, note: 'Self-accepted' }, exec),
    /HUMAN_APPROVAL/,
  );
  const accepted = await h.command.handler({
    agent, signal: exec.signal,
    rawInput: JSON.stringify({ action: 'acceptDelivery', changeId: change.id, expectedRevision: change.revision, note: 'Reviewed verification and evidence' }),
  });
  assert.equal(accepted.kind, 'success');
  const delivered = JSON.parse(accepted.text).change;
  assert.equal(delivered.deliveryAcceptance.actor.kind, 'user');
  assert.equal(delivered.deliveryAcceptance.note, 'Reviewed verification and evidence');

  const after = await plan.execute({ action: 'gateStatus', changeId: change.id }, exec);
  assert.equal(after.deliveryAccepted, true);
  assert.equal(after.ready, false);

  const context = await plan.execute({ action: 'context', changeId: change.id }, exec);
  assert.equal(context.gate.deliveryAccepted, true);
  assert.deepEqual(context.gate.blockerCodes, []);
});

test('a failed verification stops the loop before delivery and demands a reason', async t => {
  const h = await harness(t);
  const { tools, agent, exec } = h;
  const plan = tools.get('engineering_plan');
  let change = (await plan.execute({ action: 'create', title: 'Failing loop', goal: 'Stop on failure' }, exec)).change;
  change = (await plan.execute({
    action: 'save', changeId: change.id, expectedRevision: change.revision,
    patch: { tasks: [{ id: 'T1', title: 'Task', acceptanceCriteria: ['Works'], verificationCommands: ['false'] }] },
  }, exec)).change;
  change = JSON.parse((await h.command.handler({ agent, signal: exec.signal, rawInput: JSON.stringify({ action: 'approve', changeId: change.id, expectedRevision: change.revision }) })).text).change;
  change = (await plan.execute({ action: 'transition', changeId: change.id, expectedRevision: change.revision, taskId: 'T1', status: 'running' }, exec)).change;

  // Blocking requires an explicit reason; a cancelled task needs none.
  await assert.rejects(
    plan.execute({ action: 'transition', changeId: change.id, expectedRevision: change.revision, taskId: 'T1', status: 'blocked' }, exec),
    /reason/i,
  );
  change = (await plan.execute({ action: 'transition', changeId: change.id, expectedRevision: change.revision, taskId: 'T1', status: 'blocked', reason: 'Waiting on review' }, exec)).change;
  assert.equal(change.tasks[0].status, 'blocked');

  // A blocked task can still receive a post-mortem note, but only a failing one.
  await assert.rejects(
    plan.execute({ action: 'evidence', changeId: change.id, expectedRevision: change.revision, taskId: 'T1', criterion: 'Works', outcome: 'passed', note: 'Claimed anyway' }, exec),
    /only accepts failed evidence/i,
  );
  change = (await plan.execute({ action: 'evidence', changeId: change.id, expectedRevision: change.revision, taskId: 'T1', criterion: 'Works', outcome: 'failed', note: 'Blocked before running' }, exec)).change;
  assert.equal(change.tasks[0].status, 'blocked');

  const gate = await plan.execute({ action: 'gateStatus', changeId: change.id }, exec);
  assert.equal(gate.ready, false);
  assert.ok(gate.blockers.some(blocker => blocker.code === 'TASK_NOT_TERMINAL'));
  assert.ok(gate.blockers.some(blocker => blocker.code === 'NO_COMPLETED_TASK'));
});
