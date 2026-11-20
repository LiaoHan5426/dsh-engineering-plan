import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EngineeringStore } from '../src/core.js';
import { DispatchRunStore } from '../src/dispatch-store.js';
import { VerificationRunStore } from '../src/verification-store.js';

const user = { kind: 'user', id: 'consistency-reviewer' };
const identity = { hostInstanceId: 'host', ownerSessionId: 'session', childId: 'child' };
const verificationIdentity = { hostInstanceId: 'host', ownerSessionId: 'session' };
const rejects = (promise, code) => assert.rejects(promise, error => error.code === code && error instanceof Error);

// 两个任务声明同一个文件，用于区分「任务状态」与「在途 run」两条冲突来源。
const plan = () => ['a', 'b'].map(id => ({ id, title: id, dependencies: [], expectedFiles: ['src/shared.js'], acceptanceCriteria: ['works'], verificationCommands: ['echo never execute'] }));

async function fixture(t, { approved = true, documents = {} } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'core-consistency-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new EngineeringStore(root), runs = new DispatchRunStore(root), verification = new VerificationRunStore(root);
  let state = (await store.execute({ action: 'create', title: 'Consistency', goal: 'Close the reviewed gaps' })).change;
  const act = async (action, fields = {}, actor = user) => {
    const revision = ['get', 'context'].includes(action) ? {} : { expectedRevision: state.revision };
    const result = await store.execute({ action, changeId: state.id, ...revision, ...fields }, actor);
    if (result.change) state = result.change;
    return result;
  };
  const patch = { tasks: plan() };
  if (Object.keys(documents).length) patch.documents = documents;
  await act('save', { patch });
  if (approved) await act('approve');
  const stateDirectory = path.join(root, '.dsh', 'engineering', 'changes', state.id);
  const stateFile = path.join(stateDirectory, 'state.json');
  // 模拟「state.json 可被外部改写」：只动落盘副本，不动内存快照。
  const rewrite = async mutate => {
    const stored = JSON.parse(await fs.readFile(stateFile, 'utf8'));
    mutate(stored);
    await fs.writeFile(stateFile, JSON.stringify(stored));
  };
  const dispatchRequest = extra => ({ changeId: state.id, taskId: 'a', expectedRevision: state.revision, planVersion: state.planVersion, requestId: 'dispatch-a', ...extra });
  return { root, store, runs, verification, act, stateDirectory, stateFile, rewrite, dispatchRequest, get state() { return state; } };
}

async function startVerification(t, f) {
  await f.act('transition', { taskId: 'a', status: 'running' });
  await f.act('transition', { taskId: 'a', status: 'verifying' });
}

test('in-flight dispatch run blocks overlapping files while the dispatched task is still pending', async t => {
  const f = await fixture(t);
  const { run } = await f.store.reserveDispatch(f.dispatchRequest(), identity);
  assert.equal(f.state.tasks.find(task => task.id === 'a').status, 'pending');
  assert.equal(run.state, 'reserved');
  await rejects(f.act('transition', { taskId: 'b', status: 'running' }), 'FILE_CONFLICT');
  const starting = await f.runs.update(run.changeId, run.runId, 'host', { expectedRevision: run.revision, state: 'starting' });
  await rejects(f.act('transition', { taskId: 'b', status: 'running' }), 'FILE_CONFLICT');
  const running = await f.runs.update(starting.changeId, starting.runId, 'host', { expectedRevision: starting.revision, state: 'running' });
  await rejects(f.act('transition', { taskId: 'b', status: 'running' }), 'FILE_CONFLICT');
  await f.runs.update(running.changeId, running.runId, 'host', { expectedRevision: running.revision, state: 'failed' });
  await f.act('transition', { taskId: 'b', status: 'running' });
  assert.equal(f.state.tasks.find(task => task.id === 'b').status, 'running');
  assert.equal(f.state.tasks.find(task => task.id === 'a').status, 'pending');
});

test('in-flight verification run blocks overlapping files and terminal runs release them', async t => {
  const f = await fixture(t);
  let run = await f.verification.reserve({ changeId: f.state.id, taskId: 'a', planVersion: f.state.planVersion, commandIndex: 0, command: 'echo never execute', requestId: 'verification-a', ...verificationIdentity });
  assert.equal(run.state, 'reserved');
  await rejects(f.act('transition', { taskId: 'b', status: 'running' }), 'FILE_CONFLICT');
  run = await f.verification.update(run.changeId, run.runId, 'host', { expectedRevision: run.revision, state: 'starting' });
  await rejects(f.act('transition', { taskId: 'b', status: 'running' }), 'FILE_CONFLICT');
  await f.verification.update(run.changeId, run.runId, 'host', { expectedRevision: run.revision, state: 'cancelled' });
  await f.act('transition', { taskId: 'b', status: 'running' });
  assert.equal(f.state.tasks.find(task => task.id === 'b').status, 'running');
});

test('returned dispatch run alone does not reserve files for a pending task', async t => {
  const f = await fixture(t);
  const { run } = await f.store.reserveDispatch(f.dispatchRequest(), identity);
  const starting = await f.runs.update(run.changeId, run.runId, 'host', { expectedRevision: run.revision, state: 'starting' });
  await f.runs.update(starting.changeId, starting.runId, 'host', { expectedRevision: starting.revision, state: 'returned' });
  await f.act('transition', { taskId: 'b', status: 'running' });
  assert.equal(f.state.tasks.find(task => task.id === 'b').status, 'running');
});

test('running and verifying task status still block overlapping files without any run', async t => {
  const f = await fixture(t);
  await f.act('transition', { taskId: 'a', status: 'running' });
  await rejects(f.act('transition', { taskId: 'b', status: 'running' }), 'FILE_CONFLICT');
  await f.act('transition', { taskId: 'a', status: 'verifying' });
  await rejects(f.act('transition', { taskId: 'b', status: 'running' }), 'FILE_CONFLICT');
});

test('context reports truncated document keys and original lengths without touching stored state', async t => {
  const long = 'x'.repeat(1500);
  const f = await fixture(t, { documents: { proposal: long, decisions: 'short note' } });
  const before = await fs.readFile(f.stateFile, 'utf8');
  const context = await f.act('context');
  assert.deepEqual(context.documentsTruncated, ['proposal']);
  assert.equal(context.documentLengths.proposal, 1500);
  assert.equal(context.documentLengths.decisions, 'short note'.length);
  assert.equal(Object.keys(context.documentLengths).length, 8);
  assert.equal(context.documents.proposal.length, 1000);
  assert.equal(context.documents.decisions, 'short note');
  assert.equal(await fs.readFile(f.stateFile, 'utf8'), before);
  assert.deepEqual((await f.act('get')).change.documents.proposal, long);
  const exported = await f.act('export');
  assert.ok(exported.files.length > 0);
  assert.equal(await fs.readFile(path.join(f.stateDirectory, 'proposal.md'), 'utf8'), long);
  assert.ok(!JSON.stringify(JSON.parse(before)).includes('documentsTruncated'));
});

test('context and get stay lossless when no document exceeds the context limit', async t => {
  const exact = 'y'.repeat(1000);
  const f = await fixture(t, { documents: { proposal: 'brief', findings: exact } });
  const context = await f.act('context');
  assert.deepEqual(context.documentsTruncated, []);
  assert.deepEqual(context.documentLengths, { proposal: 5, requirements: 0, architecture: 0, implementation: 0, 'impact-analysis': 0, acceptance: 0, decisions: 0, findings: 1000 });
  assert.equal(context.documents.findings, exact);
});

test('task evidence missing from change evidence is corrupt while list isolates it as a warning', async t => {
  const f = await fixture(t);
  await startVerification(t, f);
  await f.act('evidence', { taskId: 'a', criterion: 'works', outcome: 'passed', note: 'observed successful assertion' });
  await f.rewrite(stored => { stored.evidence = []; });
  await rejects(f.store.execute({ action: 'get', changeId: f.state.id }), 'CORRUPT_STATE');
  await rejects(f.act('context'), 'CORRUPT_STATE');
  const listed = await f.store.execute({ action: 'list' });
  assert.deepEqual(listed.changes, []);
  assert.equal(listed.warnings.length, 1);
  assert.equal(listed.warnings[0].changeId, f.state.id);
  assert.equal(listed.warnings[0].code, 'CORRUPT_STATE');
});

test('completed still requires the task and change evidence views to agree', async t => {
  const g = await fixture(t);
  await startVerification(t, g);
  await g.act('evidence', { taskId: 'a', criterion: 'works', outcome: 'passed', note: 'observed successful assertion' });
  await g.act('transition', { taskId: 'a', status: 'completed' });
  assert.equal(g.state.tasks.find(task => task.id === 'a').status, 'completed');
  assert.equal(g.state.evidence.length, 1);

  const f = await fixture(t);
  await startVerification(t, f);
  await f.act('evidence', { taskId: 'a', criterion: 'works', outcome: 'passed', note: 'observed successful assertion' });
  // id 仍在 state.evidence 中（readState 子集校验通过），但审计视图不再有该 criterion 的通过记录。
  await f.rewrite(stored => { stored.evidence = stored.evidence.map(entry => ({ ...entry, criterion: 'other' })); });
  assert.equal((await f.act('get')).change.tasks.find(task => task.id === 'a').evidence[0].outcome, 'passed');
  await rejects(f.act('transition', { taskId: 'a', status: 'completed' }), 'EVIDENCE_REQUIRED');
  assert.deepEqual((await f.act('get')).change.evidence.map(entry => entry.criterion), ['other']);
});
