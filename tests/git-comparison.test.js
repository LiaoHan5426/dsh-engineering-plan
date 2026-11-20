import test from 'node:test';
import assert from 'node:assert/strict';
import { validateGitObservation, compareGitObservations } from '../src/git-comparison.js';

const SHA = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const changedFields = ['headChanged', 'stagedChanged', 'worktreeChanged', 'untrackedPathsChanged'];
function observation(overrides = {}) {
  return {
    schemaVersion: 1, id: '11111111-1111-4111-8111-111111111111',
    changeId: '22222222-2222-4222-8222-222222222222', planVersion: 1, sourceRevision: 1,
    actor: { kind: 'agent', id: 'agent-1' }, capturedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:01.000Z', workspaceRoot: '/workspace', repositoryRoot: '/workspace',
    collectorVersion: 'git-observation-v1', status: 'ok', head: 'c'.repeat(40), headState: 'commit', dirty: false,
    scope: { tracked: 'git-diff', untracked: 'paths-only', ignored: 'excluded', excludedPaths: ['.planner'] },
    stagedDiffSha256: SHA, worktreeDiffSha256: SHA, untrackedPathsSha256: SHA, untrackedCount: 0,
    limitations: [], error: null, ...overrides,
  };
}
function current(overrides = {}) {
  return observation({ id: '33333333-3333-4333-8333-333333333333', capturedAt: '2026-01-01T00:00:02.000Z',
    finishedAt: '2026-01-01T00:00:03.000Z', ...overrides });
}
function invalid(record, path) {
  assert.throws(() => validateGitObservation(record), error => error.code === 'INVALID_GIT_OBSERVATION'
    && typeof error.path === 'string' && (!path || error.path === path));
}
function incomparable(result, reason) {
  assert.equal(result.comparable, false);
  assert.equal(result.observedEqual, null);
  for (const key of changedFields) assert.equal(result[key], null);
  assert.ok(result.reasons.some(value => value.includes(reason)), JSON.stringify(result.reasons));
}

test('validation creates detached JSON facts and accepts null-prototype objects', () => {
  const original = observation();
  const result = validateGitObservation(original);
  assert.deepEqual(result, original);
  result.actor.id = 'changed'; result.scope.excludedPaths.push('other'); result.limitations.push('other');
  assert.equal(original.actor.id, 'agent-1');
  assert.deepEqual(original.scope.excludedPaths, ['.planner']);
  assert.deepEqual(original.limitations, []);
  assert.deepEqual(JSON.parse(JSON.stringify(original)), original);
  assert.deepEqual(validateGitObservation(Object.assign(Object.create(null), original)), original);
});

test('strict required fields reject unknown fields, undefined, symbols, classes and hidden data', () => {
  for (const key of Object.keys(observation())) {
    const missing = observation(); delete missing[key]; invalid(missing);
    invalid(observation({ [key]: undefined }));
  }
  invalid(observation({ evidence: [] }));
  invalid(observation({ [Symbol('extra')]: true }));
  invalid(Object.assign(new (class Record {})(), observation()));
  invalid(Object.defineProperty(observation(), 'id', { enumerable: false }));
  for (const value of [null, [], 'record', 3, new Date()]) invalid(value);
  invalid(observation({ actor: { kind: 'agent', id: 'x', role: 'admin' } }));
  invalid(observation({ scope: { ...observation().scope, extra: true } }));
  invalid(observation({ error: { code: 'E', message: 'error', extra: true } }));
});

test('malicious getters at every nested boundary are rejected without executing', () => {
  let calls = 0;
  const getter = { enumerable: true, get() { calls += 1; throw new Error('getter ran'); } };
  for (const key of Object.keys(observation())) invalid(Object.defineProperty(observation(), key, getter));
  for (const key of ['kind', 'id']) invalid(observation({ actor: Object.defineProperty({ kind: 'agent', id: 'x' }, key, getter) }));
  invalid(observation({ scope: Object.defineProperty(observation().scope, 'tracked', getter) }));
  invalid(observation({ error: Object.defineProperty({ code: 'E', message: 'error' }, 'code', getter) }));
  invalid(observation({ limitations: Object.defineProperty(['x'], '0', getter) }));
  invalid(observation({ scope: { ...observation().scope, excludedPaths: Object.defineProperty(['x'], '0', getter) } }));
  assert.equal(calls, 0);
});

test('arrays require dense JSON strings without extra properties or symbols', () => {
  for (const limitations of [new Array(2), [undefined], [1], Object.assign([], { extra: 1 }), Object.assign([], { [Symbol('x')]: 1 })]) {
    invalid(observation({ limitations }));
  }
});

test('UUID, schema, positive integers, actor, hashes, enums and count are strict', () => {
  for (const patch of [
    { schemaVersion: '1' }, { id: 'no-uuid' }, { changeId: '' }, { planVersion: 0 }, { sourceRevision: -1 },
    { planVersion: 1.5 }, { sourceRevision: Number.MAX_SAFE_INTEGER + 1 }, { actor: { kind: 'system', id: 'x' } },
    { actor: { kind: 'user', id: ' ' } }, { collectorVersion: 'v2' }, { status: 'completed' },
    { head: 'x'.repeat(40) }, { head: 'a'.repeat(41) }, { headState: 'other' }, { dirty: 0 },
    { stagedDiffSha256: 'a'.repeat(63) }, { worktreeDiffSha256: 'g'.repeat(64) }, { untrackedPathsSha256: 1 },
    { untrackedCount: -1 }, { untrackedCount: 0.1 }, { untrackedCount: Infinity }, { repositoryRoot: '' },
    { workspaceRoot: 1 }, { error: { code: '', message: 'error' } },
    { scope: { ...observation().scope, untracked: 'contents' } },
  ]) invalid(observation(patch));
  assert.equal(validateGitObservation(observation({ head: OTHER, actor: { kind: 'user', id: 'u' } })).head, OTHER);
});

test('timestamps require canonical real calendar ISO and ordered collection interval', () => {
  for (const capturedAt of ['2026-01-01', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00.000+00:00',
    '2026-02-30T00:00:00.000Z', 'not-date']) invalid(observation({ capturedAt }));
  invalid(observation({ finishedAt: '2025-12-31T23:59:59.000Z' }), 'record.finishedAt');
  // Old facts are valid facts; comparison exposes temporal order without a wall-clock dependency.
  assert.equal(validateGitObservation(observation({ capturedAt: '2000-01-01T00:00:00.000Z', finishedAt: '2000-01-01T00:00:01.000Z' })).status, 'ok');
  incomparable(compareGitObservations(observation(), current({ capturedAt: '2025-01-01T00:00:00.000Z', finishedAt: '2025-01-01T00:00:01.000Z' })), 'time:');
  incomparable(compareGitObservations(observation(), current({ capturedAt: '2026-01-01T00:00:00.500Z' })), 'overlaps');
});

test('ok requires complete facts while partial allows missing digests without proving equality', () => {
  for (const key of ['repositoryRoot', 'dirty', 'stagedDiffSha256', 'worktreeDiffSha256', 'untrackedPathsSha256', 'untrackedCount']) {
    invalid(observation({ [key]: null }));
    assert.equal(validateGitObservation(observation({ status: 'partial', [key]: null })).status, 'partial');
  }
  invalid(observation({ error: { code: 'TRUNCATED', message: 'output truncated' } }));
  incomparable(compareGitObservations(observation(), current({ status: 'partial', worktreeDiffSha256: null, limitations: ['truncated'] })), 'missing digest');
});

test('equal observed scope never establishes full workspace or untracked-content equality', () => {
  const result = compareGitObservations(observation(), current());
  assert.equal(result.comparable, true); assert.equal(result.observedEqual, true);
  for (const key of changedFields) assert.equal(result[key], false);
  assert.equal(result.fullWorkspaceEquality, 'not-established');
  assert.ok(result.limitations.some(value => value.includes('paths-only')));
  assert.ok(result.limitations.some(value => value.includes('ignored')));
  assert.deepEqual(result.reasons, []);
  assert.equal(Object.hasOwn(result, 'approval'), false);
  assert.equal(Object.hasOwn(result, 'evidence'), false);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
});

test('same HEAD with different worktree is changed', () => {
  const result = compareGitObservations(observation(), current({ worktreeDiffSha256: OTHER, dirty: true }));
  assert.equal(result.headChanged, false); assert.equal(result.worktreeChanged, true);
  assert.equal(result.stagedChanged, false); assert.equal(result.observedEqual, false);
});

test('staged and worktree changes cannot cancel each other', () => {
  const result = compareGitObservations(observation({ stagedDiffSha256: SHA, worktreeDiffSha256: OTHER }),
    current({ stagedDiffSha256: OTHER, worktreeDiffSha256: SHA }));
  assert.equal(result.stagedChanged, true); assert.equal(result.worktreeChanged, true); assert.equal(result.observedEqual, false);
});

test('different binding or scope returns all null and specific reasons', () => {
  for (const [patch, reason] of [
    [{ changeId: '44444444-4444-4444-8444-444444444444' }, 'changeId'],
    [{ workspaceRoot: '/other' }, 'workspaceRoot'], [{ repositoryRoot: '/other' }, 'repositoryRoot'],
    [{ workspaceRoot: null }, 'workspaceRoot: missing'],
    [{ scope: { ...observation().scope, excludedPaths: ['different'] } }, 'scope'],
  ]) incomparable(compareGitObservations(observation(), current(patch)), reason);
  assert.equal(compareGitObservations(observation({ scope: { ...observation().scope, excludedPaths: ['a', 'b'] } }),
    current({ scope: { ...observation().scope, excludedPaths: ['b', 'a'] } })).observedEqual, true);
});

test('partial/truncated facts can expose differences but never establish equality', () => {
  const partial = current({ status: 'partial', limitations: ['truncated stdout'], error: { code: 'TRUNCATED', message: 'output limit' } });
  const equal = compareGitObservations(observation(), partial);
  assert.equal(equal.comparable, true); assert.equal(equal.observedEqual, null);
  assert.ok(equal.reasons.some(value => value.includes('partial')));
  assert.ok(equal.limitations.includes('truncated stdout'));
  assert.ok(equal.limitations.some(value => value.includes('status: partial')));
  const changed = compareGitObservations(observation(), { ...partial, stagedDiffSha256: OTHER });
  assert.equal(changed.stagedChanged, true); assert.equal(changed.observedEqual, false);
  for (const status of ['not_git', 'error', 'unstable']) {
    incomparable(compareGitObservations(observation(), current({ status })), `current.status: ${status}`);
  }
});

test('unborn is explicit and comparable, distinct from unknown and commit', () => {
  const unborn = { head: null, headState: 'unborn' };
  assert.equal(compareGitObservations(observation(unborn), current(unborn)).observedEqual, true);
  assert.equal(compareGitObservations(observation(unborn), current()).headChanged, true);
  invalid(observation({ head: null })); invalid(observation({ headState: 'unborn' }));
  invalid(observation({ headState: 'unknown', head: null }));
  incomparable(compareGitObservations(observation(), current({ status: 'partial', headState: 'unknown', head: null })), 'head: unknown');
});

test('untracked paths and count are checked; missing count makes all components incomparable', () => {
  assert.equal(compareGitObservations(observation(), current({ untrackedPathsSha256: OTHER })).untrackedPathsChanged, true);
  assert.equal(compareGitObservations(observation(), current({ untrackedCount: 1 })).untrackedPathsChanged, true);
  incomparable(compareGitObservations(observation(), current({ status: 'partial', untrackedCount: null })), 'missing count');
});

test('non-Git and failed observations retain nullable facts and detached errors', () => {
  const record = observation({ status: 'not_git', repositoryRoot: null, head: null, headState: 'unknown',
    dirty: null, stagedDiffSha256: null, worktreeDiffSha256: null, untrackedPathsSha256: null,
    untrackedCount: null, error: { code: 'NOT_GIT', message: 'not a repository' } });
  const snapshot = validateGitObservation(record);
  snapshot.error.message = 'changed';
  assert.equal(record.error.message, 'not a repository');
  incomparable(compareGitObservations(record, current()), 'repositoryRoot');
});

test('cross-plan comparison preserves ids, times and both versions without mutation', () => {
  const before = observation(); const after = current({ planVersion: 2, sourceRevision: 9 });
  const beforeJSON = JSON.stringify(before); const afterJSON = JSON.stringify(after);
  const result = compareGitObservations(before, after);
  assert.equal(result.observedEqual, true);
  for (const [key, input] of [['baseline', before], ['current', after]]) {
    for (const field of ['id', 'changeId', 'capturedAt', 'finishedAt', 'planVersion', 'sourceRevision', 'status']) assert.equal(result[key][field], input[field]);
  }
  assert.equal(JSON.stringify(before), beforeJSON); assert.equal(JSON.stringify(after), afterJSON);
  assert.equal(compareGitObservations(before, current({ head: before.head.toUpperCase(), stagedDiffSha256: SHA.toUpperCase() })).observedEqual, true);
});
