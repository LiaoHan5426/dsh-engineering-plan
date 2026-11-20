import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { createOperations, parameters } from '../index.js';
import { DispatchRunStore } from '../src/dispatch-store.js';
import { VerificationRunStore } from '../src/verification-store.js';
import { GitObservationStore } from '../src/git-observation-store.js';

const task = id => ({ id, title: `Task ${id}`, description: '', dependencies: [], expectedFiles: [`src/${id}.js`], acceptanceCriteria: ['Review'], verificationCommands: [`echo ${id}`] });

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gate-status-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const op = createOperations({ workingDirectory: { ensure: async agent => agent.root } }, agent => agent.root);
  const agent = { id: 'session-a', root };
  const reviewer = { id: 'session-reviewer', root };
  const created = await op({ action: 'create', title: 'Gate fixture', goal: 'Report delivery preconditions' }, agent, 'agent');
  const changeId = created.change.id;
  await op({ action: 'save', changeId, expectedRevision: 1, patch: { tasks: [task('a')] } }, agent, 'agent');
  return { root, op, agent, reviewer, changeId };
}

const gate = (f, actor = 'agent') => f.op({ action: 'gateStatus', changeId: f.changeId }, f.agent, actor);

test('a draft without approval reports APPROVAL_REQUIRED and is not ready', async t => {
  const f = await fixture(t);
  const result = await gate(f);
  assert.equal(result.changeId, f.changeId);
  assert.equal(result.approved, false);
  assert.equal(result.ready, false);
  assert.equal(result.deliveryAccepted, false);
  assert.deepEqual(result.blockers.filter(b => b.code === 'APPROVAL_REQUIRED'), [{ code: 'APPROVAL_REQUIRED' }]);
  assert.deepEqual(result.blockers.filter(b => b.code === 'TASK_NOT_TERMINAL'), [{ code: 'TASK_NOT_TERMINAL', taskId: 'a', status: 'pending' }]);
  assert.ok(result.blockers.some(b => b.code === 'NO_COMPLETED_TASK'));
  assert.deepEqual(result.tasks, { pending: 1, running: 0, verifying: 0, blocked: 0, failed: 0, completed: 0, cancelled: 0 });
  assert.deepEqual(result.runs, []);
});

test('the gate is read-only and leaves revision, tasks and evidence untouched', async t => {
  const f = await fixture(t);
  const before = await f.op({ action: 'get', changeId: f.changeId }, f.agent, 'agent');
  await gate(f);
  await gate(f, 'user');
  const after = await f.op({ action: 'get', changeId: f.changeId }, f.agent, 'agent');
  assert.deepEqual(after, before);
});

test('a fully evidenced approved plan with only terminal tasks is ready', async t => {
  const f = await fixture(t);
  await f.op({ action: 'approve', changeId: f.changeId, expectedRevision: 2, planVersion: 1 }, f.reviewer, 'user');
  const state = await f.op({ action: 'get', changeId: f.changeId }, f.agent, 'agent');
  let revision = state.change.revision;
  await f.op({ action: 'transition', changeId: f.changeId, expectedRevision: revision, taskId: 'a', status: 'running' }, f.agent, 'agent');
  await f.op({ action: 'transition', changeId: f.changeId, expectedRevision: revision + 1, taskId: 'a', status: 'verifying' }, f.agent, 'agent');
  await f.op({ action: 'evidence', changeId: f.changeId, expectedRevision: revision + 2, taskId: 'a', criterion: 'Review', outcome: 'passed', note: 'Reviewed the diff' }, f.agent, 'agent');
  await f.op({ action: 'transition', changeId: f.changeId, expectedRevision: revision + 3, taskId: 'a', status: 'completed' }, f.agent, 'agent');
  const result = await gate(f);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.ready, true);
  assert.equal(result.approved, true);
  assert.equal(result.tasks.completed, 1);
});

test('a completed task without current-version evidence is reported, not trusted', async t => {
  const f = await fixture(t);
  await f.op({ action: 'approve', changeId: f.changeId, expectedRevision: 2, planVersion: 1 }, f.reviewer, 'user');
  let revision = 3;
  await f.op({ action: 'transition', changeId: f.changeId, expectedRevision: revision, taskId: 'a', status: 'running' }, f.agent, 'agent');
  await f.op({ action: 'transition', changeId: f.changeId, expectedRevision: revision + 1, taskId: 'a', status: 'verifying' }, f.agent, 'agent');
  await f.op({ action: 'evidence', changeId: f.changeId, expectedRevision: revision + 2, taskId: 'a', criterion: 'Review', outcome: 'passed', note: 'Reviewed' }, f.agent, 'agent');
  await f.op({ action: 'transition', changeId: f.changeId, expectedRevision: revision + 3, taskId: 'a', status: 'completed' }, f.agent, 'agent');
  // Simulate a hand-edited state where the plan version moved on but completed tasks kept
  // older evidence: the gate must report MISSING_EVIDENCE instead of trusting the task status.
  const file = path.join(f.root, '.dsh', 'engineering', 'changes', f.changeId, 'state.json');
  const raw = JSON.parse(await fs.readFile(file, 'utf8'));
  raw.planVersion = 2;
  await fs.writeFile(file, JSON.stringify(raw, null, 2) + String.fromCharCode(10));
  const result = await gate(f);
  assert.deepEqual(result.blockers.filter(b => b.code === 'MISSING_EVIDENCE'), [{ code: 'MISSING_EVIDENCE', taskId: 'a', criterion: 'Review' }]);
  assert.equal(result.ready, false);
});

test('an active dispatch run blocks delivery and is reported with its run id', async t => {
  const f = await fixture(t);
  const snapshot = task('a');
  const { run } = await new DispatchRunStore(f.root).reserve({
    changeId: f.changeId, taskId: 'a', planVersion: 1, admittedRevision: 1, requestId: 'gate-run',
    taskSnapshot: snapshot, taskSnapshotHash: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),
    hostInstanceId: 'host-a', ownerSessionId: f.agent.id, childId: 'child-a'
  });
  const result = await gate(f);
  const active = result.blockers.filter(b => b.code === 'ACTIVE_RUN');
  assert.equal(active.length, 1);
  assert.equal(active[0].kind, 'dispatch');
  assert.equal(active[0].runId, run.runId);
  assert.equal(active[0].state, 'reserved');
  assert.equal(result.runs.length, 1);
  assert.equal(result.ready, false);
});

test('an unknown run is unresolved until a human closes it, then the blocker clears', async t => {
  const f = await fixture(t);
  const snapshot = { changeId: f.changeId, taskId: 'a', planVersion: 1, commandIndex: 0, command: 'echo a', requestId: 'gate-verify', hostInstanceId: 'host-a', ownerSessionId: f.agent.id };
  const run = await new VerificationRunStore(f.root).reserve(snapshot);
  await new VerificationRunStore(f.root).update(f.changeId, run.runId, 'host-a', { expectedRevision: 1, state: 'starting', jobId: 'job-a' });
  await new VerificationRunStore(f.root).update(f.changeId, run.runId, 'host-a', { expectedRevision: 2, state: 'unknown', reason: 'cleanup failed' });
  const before = await gate(f);
  assert.equal(before.blockers.filter(b => b.code === 'UNRESOLVED_UNKNOWN').length, 1);
  assert.equal(before.ready, false);
  const state = await f.op({ action: 'get', changeId: f.changeId }, f.agent, 'agent');
  const current = (await f.op({ action: 'verificationRuns', changeId: f.changeId }, f.agent, 'agent')).runs[0];
  await f.op({
    action: 'resolveUnknown', changeId: f.changeId, expectedRevision: state.change.revision,
    runId: current.runId, expectedRunRevision: current.revision, reason: 'Checked child and descendants'
  }, f.reviewer, 'user');
  const after = await gate(f);
  assert.equal(after.blockers.filter(b => b.code === 'UNRESOLVED_UNKNOWN').length, 0);
});

test('gateStatus is exposed to the model as a read-only action', async t => {
  const f = await fixture(t);
  assert.ok(parameters.properties.action.enum.includes('gateStatus'));
  await assert.rejects(f.op({ action: 'gateStatus', changeId: f.changeId, expectedRevision: 9 }, f.agent, 'agent'), /Invalid action fields/);
  await assert.rejects(f.op({ action: 'gateStatus' }, f.agent, 'agent'), /Invalid/);
  await assert.rejects(f.op({ action: 'gateStatus', changeId: f.changeId }, f.agent, 'agent', { aborted: true }), /ENGINEERING_CANCELLED/);
});

test('gateStatus reports scope drift without making it a blocker', async (t) => {
  const f = await fixture(t);
  const bare = await gate(f);
  assert.equal(bare.scope.state, 'no_observation');
  assert.equal(bare.scope.observationId, null);
  assert.ok(!bare.blockers.some(blocker => String(blocker.code).startsWith('SCOPE')));

  const record = {
    schemaVersion: 1, id: randomUUID(), changeId: f.changeId, planVersion: 1, sourceRevision: 1,
    actor: { kind: 'agent', id: 'session-a' }, capturedAt: '2026-01-01T00:00:00.000Z', finishedAt: '2026-01-01T00:00:01.000Z',
    workspaceRoot: f.root, repositoryRoot: f.root, collectorVersion: 'git-observation-v1', status: 'ok',
    head: 'c'.repeat(40), headState: 'commit', dirty: true,
    scope: { tracked: 'git-diff', untracked: 'paths-only', ignored: 'excluded', excludedPaths: ['.dsh/engineering/**'] },
    stagedDiffSha256: 'a'.repeat(64), worktreeDiffSha256: 'a'.repeat(64), untrackedPathsSha256: 'a'.repeat(64),
    untrackedCount: 0, limitations: [], error: null,
    changedPaths: ['docs/undecided.md', 'src/a.js'], untrackedPaths: [],
  };
  const created = await new GitObservationStore(f.root).create(f.changeId, record, { requestId: 'req-scope', ownerSessionId: 'session' });
  const result = await gate(f);
  assert.equal(result.scope.state, 'included');
  assert.equal(result.scope.observationId, created.observation.id);
  assert.equal(result.scope.changedCount, 2);
  assert.equal(result.scope.pathCount, 2);
  assert.equal(result.scope.declaredCount, 1);
  assert.equal(result.scope.undeclaredCount, 1);
  // Scope drift is information: readiness still depends only on the real blockers.
  assert.ok(!result.blockers.some(blocker => String(blocker.code).startsWith('SCOPE')));
});
