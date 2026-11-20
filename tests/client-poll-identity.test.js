import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');

function block(begin, end) {
  const start = source.indexOf(begin);
  assert.ok(start >= 0, `missing ${begin}`);
  const stop = source.indexOf(end, start);
  assert.ok(stop > start, `missing ${end}`);
  return source.slice(start + begin.length, stop);
}

const { pollTargetIsCurrent } = Function(`${block('/* BEGIN POLL IDENTITY SUMMARY */', '/* END POLL IDENTITY SUMMARY */')}
  return { pollTargetIsCurrent };`)();

function pollBody() {
  const start = source.indexOf('const synchronize = async () => {');
  const end = source.indexOf('// A file change is the only event that can make this panel stale');
  assert.ok(start > 0 && end > start, 'poll body not found');
  return source.slice(start, end);
}

function extract(name, indent = '          ', async = false) {
  const marker = `${indent}${async ? 'async ' : ''}function ${name}(`;
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `missing ${name}`);
  const end = source.indexOf(`\n${indent}}`, start);
  assert.ok(end > start, `unterminated ${name}`);
  return source.slice(start, end + indent.length + 2);
}

test('an answer is applied only while the same change is still on screen', () => {
  assert.equal(pollTargetIsCurrent(4, 4, 'a', 'a'), true);
  // The human switched to another change while the request was in flight.
  assert.equal(pollTargetIsCurrent(4, 5, 'b', 'a'), false);
  // The view already shows another change, even though no load happened since.
  assert.equal(pollTargetIsCurrent(4, 4, 'b', 'a'), false);
  // Nothing was loaded yet.
  assert.equal(pollTargetIsCurrent(0, 0, null, 'a'), false);
  for (const target of ['', null, undefined, 0]) {
    assert.equal(pollTargetIsCurrent(1, 1, target, target), false, String(target));
  }
});

test('the smaller-revision switch back is impossible: a newer change never satisfies the old target', () => {
  // Reproduction of the field case: A (revision 9) -> B (revision 2), poll answers for A.
  const beforeSwitch = { changeId: 'a', revision: 9 };
  assert.equal(pollTargetIsCurrent(1, 2, 'b', beforeSwitch.changeId), false,
    'the sequence alone already rejects the late answer');
  assert.equal(pollTargetIsCurrent(1, 1, 'b', beforeSwitch.changeId), false,
    'even with a matching sequence the loaded id must match the target');
});

test('the poll records the sequence before the request and checks it before both loads', () => {
  const poll = pollBody();
  const sequence = poll.indexOf('const sequence = changeSequence.current;');
  const listAwait = poll.indexOf('const data = await command({ action: "list" })');
  const plannedAwait = poll.indexOf('const planned = await command({ action: "get", changeId: pendingId })');
  const plannedApply = poll.indexOf('loadChange(planned.change)');
  const latestAwait = poll.indexOf('const latest = await command({ action: "get", changeId: targetId })');
  const latestApply = poll.indexOf('loadChange(latest.change, { preserveRuntime: true })');
  assert.ok(sequence > 0 && sequence < listAwait, 'the identity must be captured before the first await');
  assert.ok(plannedApply > plannedAwait && latestApply > latestAwait);
  assert.match(poll.slice(listAwait, plannedApply), /sequence !== changeSequence\.current/,
    'the pending hand-off must re-check the identity after its await');
  assert.match(poll.slice(latestAwait, latestApply),
    /pollTargetIsCurrent\(sequence, changeSequence\.current, after\.change\?\.id, targetId\)/,
    'the get answer must be bound to the change that asked for it');
  assert.ok(poll.indexOf('pollTargetIsCurrent(') > latestAwait, 'the guard belongs after the get await');
});

test('the poll cannot loop back to the previous change even when it reports the higher revision', () => {
  // The guard is evaluated before shouldApplyPolledChange, so a foreign or stale answer is dropped
  // whatever its revision says.
  const poll = pollBody();
  const latestAwait = poll.indexOf('const latest = await command({ action: "get", changeId: targetId })');
  const guard = poll.indexOf('pollTargetIsCurrent(sequence, changeSequence.current, after.change?.id, targetId)');
  const apply = poll.indexOf('shouldApplyPolledChange({ changeId: targetId,', guard);
  assert.ok(guard > 0 && apply > guard);
  assert.match(poll.slice(latestAwait, guard), /if \(available\(\) && \s*$/, 'the identity guard runs inside the same availability check');
  assert.match(poll.slice(latestAwait, guard), /const after = liveState\.current;/);
});

test('every load starts a new identity and asks for its own run refresh', () => {
  assert.match(source, /const changeSequence = React\.useRef\(0\);/);
  const ref = { current: 7 };
  const loaded = [];
  const noteWith = (next) => Function('changeSequence', 'autoRefreshRuns',
    `return (${extract('noteChangeLoaded')});`)(ref, (id, sequence) => loaded.push([id, sequence]))(next);
  noteWith({ id: 'a' });
  assert.equal(ref.current, 8);
  assert.deepEqual(loaded, [['a', 8]]);
  noteWith(null);
  assert.equal(ref.current, 9, 'the sequence bumps even without a change');
  assert.deepEqual(loaded, [['a', 8]], 'nothing is refreshed for an empty load');
});

test('the automatic run refresh is guarded, silent on failure and retried once at most', () => {
  const body = extract('autoRefreshRuns');
  assert.match(body, /if \(!mounted\.current \|\| runsRefresh\.current === targetId\) return;/);
  assert.match(body, /\.catch\(\(\) => "failed"\)/, 'a failure must not surface as a user error');
  // Reads do not queue behind the human action lock; correctness comes from acceptRunsFor + sequence.
  assert.doesNotMatch(body, /if \(lock\.current\) return "busy";/);
  assert.match(body, /\(outcome === "stale" \|\| outcome === "busy"\) && attempt < 2/);
  assert.match(body, /sequence === changeSequence\.current && liveState\.current\.change\?\.id === targetId/);
  assert.match(body, /refreshRuns\(targetId\)/);
  assert.match(source, /const runsRefresh = React\.useRef\(""\);/);
});

test('loadChange relies on the identity helper only when it exists', () => {
  const start = source.indexOf('          const loadChange = ');
  const end = source.indexOf('          async function sendCommand(', start);
  const body = source.slice(start, end);
  assert.match(body, /if \(typeof noteChangeLoaded === "function"\) noteChangeLoaded\(next\);/);
  assert.equal((body.match(/noteChangeLoaded\(next\)/g) || []).length, 1,
    'one guarded call, no unguarded duplicate');
});
