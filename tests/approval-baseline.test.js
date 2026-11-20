import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { EngineeringStore } from '../src/core.js';
import { GitObservationStore } from '../src/git-observation-store.js';
import { compareGitObservations } from '../src/git-comparison.js';
const user = { kind: 'user', id: 'human' };
const rejects = (promise, code) => assert.rejects(promise, e => e.code === code);
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'approval-baseline-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new EngineeringStore(root), observations = new GitObservationStore(root);
  let { change } = await store.execute({ action: 'create', title: 'Baseline', goal: 'Test baseline' });
  ({ change } = await store.execute({ action: 'save', changeId: change.id, expectedRevision: change.revision, patch: { tasks: [{ id: 't', title: 'Task', acceptanceCriteria: ['done'] }] } }));
  const file = path.join(root, '.dsh/engineering/changes', change.id, 'state.json');
  const capture = async (extra = {}) => {
    const observation = { schemaVersion: 1, id: randomUUID(), changeId: change.id, sourceRevision: change.revision, planVersion: change.planVersion,
      actor: { kind: 'agent', id: 'collector' }, capturedAt: '2026-01-01T00:00:00.000Z', finishedAt: '2026-01-01T00:00:01.000Z',
      workspaceRoot: root, repositoryRoot: root, collectorVersion: 'git-observation-v1', status: 'ok', head: 'a'.repeat(40), headState: 'commit', dirty: false,
      scope: { tracked: 'git-diff', untracked: 'paths-only', ignored: 'excluded', excludedPaths: ['.dsh'] },
      stagedDiffSha256: 'a'.repeat(64), worktreeDiffSha256: 'a'.repeat(64), untrackedPathsSha256: 'a'.repeat(64), untrackedCount: 0, limitations: ['fixture limitation'], error: null, ...extra };
    await observations.create(observation.changeId, observation, { requestId: randomUUID(), ownerSessionId: 'collector' });
    return observation;
  };
  const approve = (baseline, extra = {}) => store.execute({ action: 'approve', changeId: change.id, expectedRevision: change.revision, ...(baseline ? { baselineObservationId: baseline.id, planVersion: change.planVersion } : {}), ...extra }, user);
  const status = (extra = {}) => store.execute({ action: 'approvalBaselineStatus', changeId: change.id, ...extra });
  return { root, store, observations, change, file, capture, approve, status, observationFile: o => path.join(path.dirname(file), 'git-observations', `${o.id}.json`) };
}
test('legacy approve and legacy stored records remain unbound; no approval stays read-only', async t => {
  const f = await fixture(t), bytes = await fs.readFile(f.file);
  assert.equal((await f.status()).state, 'no_approval'); assert.deepEqual(await fs.readFile(f.file), bytes);
  const { change } = await f.approve();
  assert.equal(change.approvals[0].codeBaseline, null);
  assert.equal(change.approvals[0].sourceRevision, 2); assert.equal(change.approvals[0].approvalRevision, 3);
  assert.equal((await f.status()).state, 'unbound');
  for (const key of ['codeBaseline', 'sourceRevision', 'approvalRevision']) delete change.approvals[0][key];
  await fs.writeFile(f.file, JSON.stringify(change));
  const legacy = await fs.readFile(f.file); assert.equal((await f.status()).state, 'unbound'); assert.deepEqual(await fs.readFile(f.file), legacy);
});
test('bind dirty unborn observations and preserve exact comparator output without writes', async t => {
  const f = await fixture(t), baseline = await f.capture({ dirty: true, head: null, headState: 'unborn' });
  const { change } = await f.approve(baseline);
  assert.deepEqual(change.approvals[0].codeBaseline, { schemaVersion: 1, kind: 'git-observation', observationId: baseline.id, sourceRevision: 2, planVersion: 1 });
  assert.equal((await f.status()).state, 'not_checked');
  const current = await f.capture({ dirty: true, head: null, headState: 'unborn', sourceRevision: 3, capturedAt: '2026-01-02T00:00:00.000Z', finishedAt: '2026-01-02T00:00:01.000Z' });
  const files = [f.file, f.observationFile(baseline), f.observationFile(current)];
  const bytes = await Promise.all(files.map(file => fs.readFile(file)));
  const result = await f.status({ observationId: current.id });
  assert.equal(result.state, 'observed_equal'); assert.equal(result.currentObservationMatchesRevision, true);
  assert.deepEqual(result.comparison, compareGitObservations(baseline, current));
  assert.deepEqual(await Promise.all(files.map(file => fs.readFile(file))), bytes);
  assert.equal(result.comparison.fullWorkspaceEquality, 'not-established'); assert.ok(result.comparison.limitations.includes('fixture limitation'));
});
test('binding normalizes equivalent workspace paths using the Host path.resolve contract', async t => {
  const f = await fixture(t);
  const representedRoot = `${f.root}${path.sep}.${path.sep}`;
  assert.equal(path.resolve(representedRoot), f.root);
  const baseline = await f.capture({ workspaceRoot: representedRoot });
  await f.approve(baseline);
  assert.equal((await f.status()).state, 'not_checked');
  const current = await f.capture({ workspaceRoot: representedRoot, capturedAt: '2026-01-02T00:00:00.000Z', finishedAt: '2026-01-02T00:00:01.000Z' });
  assert.equal((await f.status({ observationId: current.id })).state, 'observed_equal');
  const normalized = await f.capture({ capturedAt: '2026-01-02T00:00:00.000Z', finishedAt: '2026-01-02T00:00:01.000Z' });
  assert.equal((await f.status({ observationId: normalized.id })).state, 'unknown'); // comparator preserves its exact root contract
});
test('status maps drift and unknown, reports revision separately and respects comparator time/root/scope', async t => {
  const f = await fixture(t), baseline = await f.capture(); await f.approve(baseline);
  for (const [extra, expected] of [
    [{ worktreeDiffSha256: 'b'.repeat(64) }, 'observed_drift'],
    [{ status: 'partial' }, 'unknown'], [{ workspaceRoot: '/other' }, 'unknown'],
    [{ capturedAt: baseline.capturedAt, finishedAt: baseline.finishedAt }, 'unknown'],
    [{ scope: { ...baseline.scope, excludedPaths: [] } }, 'unknown'],
  ]) {
    const current = await f.capture({ capturedAt: '2026-01-02T00:00:00.000Z', finishedAt: '2026-01-02T00:00:01.000Z', ...extra });
    const result = await f.status({ observationId: current.id });
    assert.equal(result.state, expected); assert.equal(result.currentObservationMatchesRevision, false);
    assert.deepEqual(result.comparison, compareGitObservations(baseline, current));
  }
});
test('approval rejects mismatched binding and non-ok records atomically', async t => {
  const f = await fixture(t), before = await fs.readFile(f.file);
  for (const extra of [{ sourceRevision: 1 }, { planVersion: 2 }, { workspaceRoot: '/other' }, ...['partial', 'unstable', 'not_git', 'error'].map(status => ({ status }))]) {
    const baseline = await f.capture(extra); await rejects(f.approve(baseline), 'BASELINE_MISMATCH');
    assert.deepEqual(await fs.readFile(f.file), before);
  }
  const other = await f.capture({ changeId: randomUUID() }); await rejects(f.approve(other), 'NOT_FOUND');
  await rejects(f.approve({ id: randomUUID() }), 'NOT_FOUND');
  const corrupt = await f.capture(); await fs.writeFile(f.observationFile(corrupt), '{}');
  await rejects(f.approve(corrupt), 'CORRUPT_STATE');
  await rejects(f.approve(null, { planVersion: 2 }), 'PLAN_VERSION_CONFLICT');
  assert.deepEqual(await fs.readFile(f.file), before);
});
test('descriptor-aware inputs reject forged fields without invoking getters or changing bytes', async t => {
  const f = await fixture(t), baseline = await f.capture(), before = await fs.readFile(f.file);
  const base = { action: 'approve', changeId: f.change.id, expectedRevision: 2 };
  for (const extra of [{ codeBaseline: {} }, { sourceRevision: 2 }, { approvalRevision: 3 }, { actor: user }, { baselineObservationId: baseline.id }, { planVersion: 0 }, { baselineObservationId: 'bad', planVersion: 1 }]) await rejects(f.store.execute({ ...base, ...extra }, user), 'INVALID_INPUT');
  for (const action of ['approve', 'approvalBaselineStatus']) {
    const clean = action === 'approve' ? base : { action, changeId: f.change.id };
    for (const key of ['changeId', 'observationId', 'planVersion', Symbol('spoof')]) {
      const input = { ...clean }; Object.defineProperty(input, key, { enumerable: true, get() { assert.fail('getter ran'); } });
      await rejects(f.store.execute(input, user), 'INVALID_INPUT');
    }
    const hidden = { ...clean }; Object.defineProperty(hidden, 'forged', { value: true });
    await rejects(f.store.execute(hidden, user), 'INVALID_INPUT');
  }
  await rejects(f.status({ expectedRevision: 2 }), 'INVALID_INPUT');
  assert.deepEqual(await fs.readFile(f.file), before);
});
test('CAS serializes concurrent approvals and stale saves cannot remove a bound approval', async t => {
  const f = await fixture(t), baseline = await f.capture();
  const results = await Promise.allSettled([f.approve(baseline), f.approve(baseline), f.store.execute({ action: 'save', changeId: f.change.id, expectedRevision: 2, patch: { goal: 'concurrent' } })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.ok(results.filter(r => r.status === 'rejected').every(r => r.reason.code === 'REVISION_CONFLICT'));
  const saveWon = results[2].status === 'fulfilled';
  assert.equal((await f.status()).state, saveWon ? 'no_approval' : 'not_checked');
  const approved = await fixture(t), approvedBaseline = await approved.capture();
  await approved.approve(approvedBaseline);
  const before = await fs.readFile(approved.file);
  await rejects(approved.store.execute({ action: 'save', changeId: approved.change.id, expectedRevision: 2, patch: { goal: 'stale' } }), 'REVISION_CONFLICT');
  assert.deepEqual(await fs.readFile(approved.file), before);
  assert.equal((await approved.status()).state, 'not_checked');
});
test('save and replan archive baseline snapshot and clear current approvals', async t => {
  for (const action of ['save', 'replan']) {
    const f = await fixture(t), baseline = await f.capture(), { change } = await f.approve(baseline);
    const result = await f.store.execute({ action, changeId: change.id, expectedRevision: change.revision, ...(action === 'save' ? { patch: { goal: 'updated' } } : {}) }, user);
    assert.deepEqual(result.change.approvals, []); assert.equal(result.change.planVersion, 2);
    assert.deepEqual(result.change.history.at(-1).snapshot.approvals, change.approvals);
    assert.equal((await f.status()).state, 'no_approval');
  }
});
test('selected observations must be distinct and current-version; missing/corrupt baselines are explicit errors', async t => {
  const f = await fixture(t), baseline = await f.capture(); await f.approve(baseline);
  const before = await fs.readFile(f.file);
  await rejects(f.status({ observationId: baseline.id }), 'OBSERVATION_MISMATCH');
  const wrongVersion = await f.capture({ planVersion: 2 }); await rejects(f.status({ observationId: wrongVersion.id }), 'OBSERVATION_MISMATCH');
  const wrongChange = await f.capture({ changeId: randomUUID() }); await rejects(f.status({ observationId: wrongChange.id }), 'NOT_FOUND');
  await rejects(f.status({ observationId: randomUUID() }), 'NOT_FOUND');
  await fs.writeFile(f.observationFile(baseline), '{}'); await rejects(f.status(), 'CORRUPT_STATE');
  await fs.unlink(f.observationFile(baseline)); await rejects(f.status(), 'NOT_FOUND');
  assert.deepEqual(await fs.readFile(f.file), before);
});
test('partial or forged persisted approval bindings are errors rather than unbound', async t => {
  const f = await fixture(t), baseline = await f.capture(), { change } = await f.approve(baseline);
  for (const mutate of [
    approval => { delete approval.codeBaseline; },
    approval => { delete approval.sourceRevision; },
    approval => { approval.approvalRevision = 99; },
    approval => { approval.codeBaseline = {}; },
    approval => { approval.codeBaseline.sourceRevision = 1; },
    approval => { approval.codeBaseline.planVersion = 2; },
    approval => { approval.codeBaseline.kind = 'forged'; },
  ]) {
    const stored = structuredClone(change); mutate(stored.approvals[0]);
    await fs.writeFile(f.file, JSON.stringify(stored)); const before = await fs.readFile(f.file);
    await rejects(f.status(), 'CORRUPT_STATE'); assert.deepEqual(await fs.readFile(f.file), before);
  }
});
test('original CAS and plan completeness checks precede baseline loading', async t => {
  const f = await fixture(t);
  await rejects(f.approve({ id: randomUUID() }, { expectedRevision: 1 }), 'REVISION_CONFLICT');
  const { change } = await f.store.execute({ action: 'save', changeId: f.change.id, expectedRevision: 2, patch: { tasks: [] } });
  const before = await fs.readFile(f.file);
  await rejects(f.approve({ id: randomUUID() }, { expectedRevision: change.revision }), 'INCOMPLETE_PLAN');
  assert.deepEqual(await fs.readFile(f.file), before);
});
test('progress export states baseline and observed scope without changing execution gates', async t => {
  const f = await fixture(t), baseline = await f.capture(), { change } = await f.approve(baseline);
  const exported = await f.store.execute({ action: 'export', changeId: change.id, expectedRevision: change.revision });
  const progress = await fs.readFile(exported.files.find(file => file.endsWith('progress.md')), 'utf8');
  assert.ok(progress.includes(baseline.id)); assert.match(progress, /untracked contents, ignored files and excluded paths/);
  assert.match(progress, /does not change execution gates/);
  const started = await f.store.execute({ action: 'transition', changeId: change.id, expectedRevision: change.revision, taskId: 't', status: 'running' });
  assert.equal(started.change.status, 'running');
});
