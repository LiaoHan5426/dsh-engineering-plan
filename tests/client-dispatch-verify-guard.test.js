import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';

const source = fs.readFileSync('J:/Code/Engineering Planner/client.js', 'utf8');
const start = source.indexOf('    function dispatchRequestBlock(');
const block = source.slice(start, source.indexOf('    function dispatchResolutionKey(', start));

const harness = new Function(`${block.replace(/^ {4}/gm, '')}
return dispatchRequestBlock;`)();

const base = {
  id: 'c1',
  planVersion: 1,
  approvals: [{ planVersion: 1, actor: { kind: 'user' } }],
  deliveryAcceptance: null,
  history: [],
  tasks: [{ id: 'T', status: 'pending', dependencies: [] }],
};
const loadedDispatch = { changeId: 'c1', runs: [], stale: false, loading: false, error: '' };

test('a live verification run on the same task blocks the dispatch request', () => {
  const runs = { changeId: 'c1', runs: [{ changeId: 'c1', taskId: 'T', runId: 'r1', revision: 1, state: 'running' }] };
  assert.equal(harness(base, 'T', loadedDispatch, false, runs), 'dispatchVerificationRunning');
});

test('a verification run on another task does not block', () => {
  const runs = { changeId: 'c1', runs: [{ changeId: 'c1', taskId: 'OTHER', runId: 'r1', revision: 1, state: 'running' }] };
  assert.equal(harness(base, 'T', loadedDispatch, false, runs), '');
});

test('terminal verification runs free the task again', () => {
  for (const state of ['succeeded', 'failed', 'error', 'cancelled', 'timed_out']) {
    const runs = { changeId: 'c1', runs: [{ changeId: 'c1', taskId: 'T', runId: 'r1', revision: 1, state }] };
    assert.equal(harness(base, 'T', loadedDispatch, false, runs), '', state);
  }
});

test('an unresolved unknown run blocks until a human resolves it', () => {
  const runs = { changeId: 'c1', runs: [{ changeId: 'c1', taskId: 'T', runId: 'r1', revision: 3, state: 'unknown' }] };
  assert.equal(harness(base, 'T', loadedDispatch, false, runs), 'dispatchVerificationRunning');
  const resolved = {
    ...base,
    history: [{ kind: 'verification-unknown-resolved', runId: 'r1', runRevision: 3, actor: { kind: 'user' } }],
  };
  assert.equal(harness(resolved, 'T', loadedDispatch, false, runs), '');
});

test('an unloaded verification list blocks instead of pretending the task is free', () => {
  // omitted argument keeps the legacy permissive path for narrow harnesses
  assert.equal(harness(base, 'T', loadedDispatch, false), '');
  assert.equal(harness(base, 'T', loadedDispatch, false, { changeId: 'c1', runs: null }), 'dispatchVerificationLoading');
  assert.equal(harness(base, 'T', loadedDispatch, false, { changeId: 'c1', runs: [], loading: true }), 'dispatchVerificationLoading');
  assert.equal(harness(base, 'T', loadedDispatch, false, { changeId: 'c1', runs: [], stale: true }), 'dispatchVerificationLoading');
  assert.equal(harness(base, 'T', loadedDispatch, false, { changeId: 'other', runs: [] }), 'dispatchVerificationLoading');
  assert.equal(harness(base, 'T', loadedDispatch, false, { changeId: 'c1', runs: [] }), '');
});

test('earlier checks still win over the verification list', () => {
  assert.equal(harness({ ...base, approvals: [] }, 'T', loadedDispatch, false), 'approvalRequired');
  assert.equal(harness(base, 'T', null, false), 'dispatchRefreshRequired');
});

test('both call sites forward the verification list through the undefined-safe expression', () => {
  const forwards = [...source.matchAll(/dispatchRequestBlock\(change, taskId, dispatchList, unsettled, typeof verificationRuns === "undefined" \? void 0 : verificationRuns\)/g)];
  assert.equal(forwards.length, 2, 'fill/copy handler and the controls must both forward it');
});

test('the refusal has a bilingual message', () => {
  const at = source.indexOf('      dispatchVerificationRunning: [');
  assert.ok(at > 0);
  const entry = source.slice(at, at + 260);
  assert.match(entry, /[\u4e00-\u9fa5]/);
  assert.match(entry, /[A-Za-z]{6,}/);
});
