import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createOperations } from '../index.js';
import { VerificationRunStore } from '../src/verification-store.js';

const task = (id, commands = [`echo ${id}`]) => ({
  id, title: `Task ${id}`, description: '', dependencies: [], expectedFiles: [`src/${id}.js`],
  acceptanceCriteria: ['Review'], verificationCommands: commands,
});

async function fixture(t, commands) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'command-summary-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const op = createOperations({ workingDirectory: { ensure: async agent => agent.root } }, agent => agent.root);
  const agent = { id: 'session-a', root };
  const reviewer = { id: 'session-reviewer', root };
  const created = await op({ action: 'create', title: 'Command fixture', goal: 'Report command runs' }, agent, 'agent');
  const changeId = created.change.id;
  await op({ action: 'save', changeId, expectedRevision: 1, patch: { tasks: [task('a', commands)] } }, agent, 'agent');
  await op({ action: 'approve', changeId, expectedRevision: 2, planVersion: 1 }, reviewer, 'user');
  return { root, op, agent, reviewer, changeId };
}

async function complete(f) {
  const state = await f.op({ action: 'get', changeId: f.changeId }, f.agent, 'agent');
  let revision = state.change.revision;
  await f.op({ action: 'transition', changeId: f.changeId, expectedRevision: revision, taskId: 'a', status: 'running' }, f.agent, 'agent');
  await f.op({ action: 'transition', changeId: f.changeId, expectedRevision: revision + 1, taskId: 'a', status: 'verifying' }, f.agent, 'agent');
  await f.op({ action: 'evidence', changeId: f.changeId, expectedRevision: revision + 2, taskId: 'a', criterion: 'Review', outcome: 'passed', note: 'Read the diff by hand' }, f.agent, 'agent');
  await f.op({ action: 'transition', changeId: f.changeId, expectedRevision: revision + 3, taskId: 'a', status: 'completed' }, f.agent, 'agent');
}

async function run(f, commandIndex, command, state, extra = {}) {
  const store = new VerificationRunStore(f.root);
  const reserved = await store.reserve({
    changeId: f.changeId, taskId: 'a', planVersion: 1, commandIndex, command,
    requestId: `request-${commandIndex}-${state}`, hostInstanceId: 'host-fixture', ownerSessionId: 'session-a',
  });
  let current = reserved;
  if (state === 'succeeded' || state === 'failed') {
    current = await store.update(f.changeId, current.runId, 'host-fixture', { expectedRevision: current.revision, state: 'starting', jobId: `bash-${commandIndex}` });
    current = await store.update(f.changeId, current.runId, 'host-fixture', { expectedRevision: current.revision, state: 'running' });
    current = await store.update(f.changeId, current.runId, 'host-fixture', {
      expectedRevision: current.revision, state,
      exitCode: state === 'succeeded' ? 0 : 1,
      signal: null, timedOut: false, aborted: false,
      ...extra,
    });
  }
  return current;
}

test('commands report unrun by default and count each outcome once', async t => {
  const f = await fixture(t, ['echo one', 'echo two']);
  let gate = await f.op({ action: 'gateStatus', changeId: f.changeId }, f.agent, 'agent');
  assert.equal(gate.commands.total, 2);
  assert.equal(gate.commands.unrun, 2);
  assert.equal(gate.commands.succeeded, 0);
  assert.deepEqual(gate.commands.tasks[0].entries.map(entry => entry.state), [null, null]);

  await run(f, 0, 'echo one', 'succeeded');
  await run(f, 1, 'echo two', 'failed');
  gate = await f.op({ action: 'gateStatus', changeId: f.changeId }, f.agent, 'agent');
  assert.deepEqual({ total: gate.commands.total, succeeded: gate.commands.succeeded, failed: gate.commands.failed, unrun: gate.commands.unrun },
    { total: 2, succeeded: 1, failed: 1, unrun: 0 });
  assert.equal(gate.commands.tasks[0].entries[0].exitCode, 0);
  assert.equal(gate.commands.tasks[0].entries[1].exitCode, 1);
  assert.ok(gate.commands.tasks[0].entries[0].runId);
});

test('only the latest attempt per command decides its state', async t => {
  const f = await fixture(t, ['echo one']);
  await run(f, 0, 'echo one', 'failed');
  const second = await run(f, 0, 'echo one', 'succeeded');
  const gate = await f.op({ action: 'gateStatus', changeId: f.changeId }, f.agent, 'agent');
  assert.equal(gate.commands.tasks[0].entries[0].state, 'succeeded');
  assert.equal(gate.commands.tasks[0].entries[0].runId, second.runId);
  assert.equal(gate.commands.failed, 0);
  assert.equal(gate.commands.succeeded, 1);
});

test('a run from an older plan version does not count for this one', async t => {
  const f = await fixture(t, ['echo one']);
  const store = new VerificationRunStore(f.root);
  const stale = await store.reserve({
    changeId: f.changeId, taskId: 'a', planVersion: 1, commandIndex: 0, command: 'echo one',
    requestId: 'older-plan', hostInstanceId: 'host-fixture', ownerSessionId: 'session-a',
  });
  const started = await store.update(f.changeId, stale.runId, 'host-fixture', { expectedRevision: stale.revision, state: 'starting', jobId: 'bash-old' });
  await store.update(f.changeId, stale.runId, 'host-fixture', { expectedRevision: started.revision, state: 'failed', exitCode: 1, signal: null, timedOut: false, aborted: false });
  // Replan drops the old plan version; the run stays on disk but stops counting.
  const state = await f.op({ action: 'get', changeId: f.changeId }, f.agent, 'agent');
  await f.op({ action: 'replan', changeId: f.changeId, expectedRevision: state.change.revision }, f.reviewer, 'user');
  const gate = await f.op({ action: 'gateStatus', changeId: f.changeId }, f.agent, 'agent');
  assert.equal(gate.planVersion, 2);
  assert.equal(gate.commands.unrun, 1);
  assert.equal(gate.commands.tasks[0].entries[0].state, null);
});

test('evidence without any succeeded command is a warning, never a blocker', async t => {
  const f = await fixture(t, ['echo one']);
  await complete(f);
  const gate = await f.op({ action: 'gateStatus', changeId: f.changeId }, f.agent, 'agent');
  assert.deepEqual(gate.warnings, [{ code: 'NO_SUCCEEDED_COMMAND', taskId: 'a' }]);
  assert.deepEqual(gate.blockers, []);
  assert.equal(gate.ready, true);
});

test('a succeeded command clears the warning', async t => {
  const f = await fixture(t, ['echo one']);
  await run(f, 0, 'echo one', 'succeeded');
  await complete(f);
  const gate = await f.op({ action: 'gateStatus', changeId: f.changeId }, f.agent, 'agent');
  assert.deepEqual(gate.warnings, []);
  assert.equal(gate.ready, true);
});

test('a task without commands produces no warning and no entries', async t => {
  const f = await fixture(t, []);
  await complete(f);
  const gate = await f.op({ action: 'gateStatus', changeId: f.changeId }, f.agent, 'agent');
  assert.deepEqual(gate.warnings, []);
  assert.equal(gate.commands.total, 0);
  assert.deepEqual(gate.commands.tasks[0].entries, []);
});
