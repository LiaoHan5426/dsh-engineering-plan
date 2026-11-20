import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');

function functionSource(name, indent = '    ') {
  const start = source.indexOf(`${indent}function ${name}(`);
  assert.ok(start >= 0, `missing function ${name}`);
  const end = source.indexOf(`\n${indent}}`, start) + indent.length + 2;
  return source.slice(start, end).trim();
}

const acceptRunsFor = Function(`return (${functionSource('acceptRunsFor')})`)();

test('records are accepted only for the change that asked for them', () => {
  const runs = [{ changeId: 'a', runId: 'r1' }];
  assert.deepEqual(acceptRunsFor('a', { runs }, 'a'), { accepted: true, runs });
  assert.deepEqual(acceptRunsFor('a', { runs: [] }, 'a'), { accepted: true, runs: [] });
});

test('a record belonging to another change is rejected as an invalid response', () => {
  const mixed = acceptRunsFor('a', { runs: [{ changeId: 'a' }, { changeId: 'b' }] }, 'a');
  assert.equal(mixed.accepted, false);
  assert.equal(mixed.reason, 'invalidResponse');
  assert.equal(acceptRunsFor('a', { runs: [{ changeId: 'b' }] }, 'a').reason, 'invalidResponse');
  assert.equal(acceptRunsFor('a', { runs: [{ runId: 'r1' }] }, 'a').reason, 'invalidResponse');
  assert.equal(acceptRunsFor('a', { runs: [null] }, 'a').reason, 'invalidResponse');
});

test('a payload without a run array is rejected as an invalid response', () => {
  for (const data of [null, undefined, {}, { runs: null }, { runs: 'nope' }, { runs: 0 }]) {
    assert.deepEqual(acceptRunsFor('a', data, 'a'), { accepted: false, reason: 'invalidResponse' });
  }
});

test('a reply that lands after switching change is dropped as stale', () => {
  assert.deepEqual(acceptRunsFor('a', { runs: [] }, 'b'), { accepted: false, reason: 'stale' });
  assert.deepEqual(acceptRunsFor('a', { runs: [] }, null), { accepted: false, reason: 'stale' });
  assert.deepEqual(acceptRunsFor('a', { runs: [] }, undefined), { accepted: false, reason: 'stale' });
  assert.deepEqual(acceptRunsFor('', { runs: [] }, ''), { accepted: false, reason: 'stale' });
  assert.deepEqual(acceptRunsFor(undefined, { runs: [] }, 'a'), { accepted: false, reason: 'stale' });
});

function refreshRunsSource() {
  const start = source.indexOf('async function refreshRuns(');
  const end = source.indexOf('async function resolveVerificationUnknown(', start);
  assert.ok(start > 0 && end > start, 'refreshRuns not found');
  return source.slice(start, end);
}

test('refreshRuns pins the requested change before awaiting and checks the answer after', () => {
  const body = refreshRunsSource();
  const target = body.indexOf('const targetId = target || change?.id;');
  const request = body.indexOf('const data = await command({ action: "verificationRuns", changeId: targetId })');
  const check = body.indexOf('acceptRunsFor(targetId, data, mounted.current ? liveState.current.change?.id : null)');
  const guarded = body.indexOf('if (!result.accepted) {');
  const apply = body.indexOf('setVerificationRuns(result.runs)');
  assert.ok(target > -1, 'the target change must be captured');
  assert.ok(request > target, 'the request must use the captured id, not change.id');
  assert.ok(check > request, 'the reply must be validated after the await');
  assert.ok(guarded > check && apply > guarded, 'state may only be written past the guard');
  assert.match(body, /throw new Error\(t\("invalidResponse"\)\)/);
  assert.doesNotMatch(body, /setVerificationRuns\(data\.runs \|\| \[\]\)/, 'the unchecked write must be gone');
  assert.doesNotMatch(body, /if \(!mounted\.current\) return;\s*\n\s*setVerificationRuns/);
});

test('a stale reply leaves the previous run list untouched', () => {
  // Same rule the component applies: nothing is returned for writing when stale.
  const written = [];
  const write = (changeId, data, currentId) => {
    const result = acceptRunsFor(changeId, data, currentId);
    if (!result.accepted) return result.reason;
    written.push(result.runs);
    return 'written';
  };
  assert.equal(write('a', { runs: [{ changeId: 'a' }] }, 'a'), 'written');
  assert.equal(write('a', { runs: [{ changeId: 'b' }] }, 'b'), 'stale');
  assert.equal(write('a', { runs: [{ changeId: 'a' }] }, 'b'), 'stale');
  assert.deepEqual(written, [[{ changeId: 'a' }]]);
});
