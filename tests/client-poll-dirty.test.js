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

const shouldApplyPolledChange = Function(`return (${functionSource('shouldApplyPolledChange')})`)();

const live = (overrides = {}) => ({
  changeId: 'a',
  revision: 3,
  unsettled: false,
  runtimeDirty: false,
  ...overrides,
});

test('a clean draft follows a newer revision', () => {
  assert.equal(shouldApplyPolledChange(live(), { changeId: 'a', revision: 4 }), true);
  assert.equal(shouldApplyPolledChange(live({ revision: 0 }), { changeId: 'a', revision: 1 }), true);
  // No local copy yet (pending plan hand-off) is treated as revision 0.
  assert.equal(shouldApplyPolledChange(live({ revision: undefined }), { changeId: 'a', revision: 1 }), true);
});

test('unsubmitted input survives a newer revision from the poll', () => {
  assert.equal(shouldApplyPolledChange(live({ unsettled: true }), { changeId: 'a', revision: 9 }), false);
  assert.equal(shouldApplyPolledChange(live({ runtimeDirty: true }), { changeId: 'a', revision: 9 }), false);
  assert.equal(
    shouldApplyPolledChange(live({ unsettled: true, runtimeDirty: true }), { changeId: 'a', revision: 9 }),
    false,
  );
});

test('equal, older, foreign and malformed snapshots are refused', () => {
  assert.equal(shouldApplyPolledChange(live(), { changeId: 'a', revision: 3 }), false);
  assert.equal(shouldApplyPolledChange(live(), { changeId: 'a', revision: 2 }), false);
  assert.equal(shouldApplyPolledChange(live(), { changeId: 'b', revision: 4 }), false);
  assert.equal(shouldApplyPolledChange(live(), { changeId: 'a' }), false);
  assert.equal(shouldApplyPolledChange(live(), {}), false);
  assert.equal(shouldApplyPolledChange(live(), null), false);
  assert.equal(shouldApplyPolledChange(null, { changeId: 'a', revision: 4 }), false);
  assert.equal(shouldApplyPolledChange(live({ changeId: '' }), { changeId: '', revision: 4 }), false);
});

function pollBody() {
  const start = source.indexOf('const synchronize = async () => {');
  const end = source.indexOf('// A file change is the only event that can make this panel stale');
  assert.ok(start > 0 && end > start, 'synchronisation body not found');
  return source.slice(start, end);
}

test('the poll re-reads the live draft after both awaits before replacing the draft', () => {
  const poll = pollBody();
  const listAwait = poll.indexOf('const data = await command({ action: "list" })');
  const summaryApply = poll.indexOf('const latest = await command({ action: "get", changeId: targetId })');
  const apply = poll.indexOf('loadChange(latest.change, { preserveRuntime: true })');
  assert.ok(listAwait > -1, 'list await missing');
  assert.ok(summaryApply > listAwait, 'get await must follow the list await');
  assert.ok(apply > summaryApply, 'loadChange must follow the guarded get');

  assert.match(
    poll.slice(listAwait, summaryApply),
    /shouldApplyPolledChange\(/,
    'the list snapshot must be judged before spending a get request',
  );
  const guarded = poll.slice(summaryApply, apply);
  assert.match(guarded, /shouldApplyPolledChange\(/);
  assert.match(guarded, /after\.unsettled/);
  assert.match(guarded, /after\.runtimeDirty/);
  assert.doesNotMatch(
    poll,
    /latest\.change\?\.id === change\.id/,
    'the stale closure comparison must be gone',
  );
});

test('the pending-plan hand-off applies the same rule on both sides of its await', () => {
  const poll = pollBody();
  const plannedAwait = poll.indexOf('const planned = await command({ action: "get", changeId: pendingId })');
  const apply = poll.indexOf('loadChange(planned.change)');
  assert.ok(plannedAwait > -1 && apply > plannedAwait, 'pending plan branch not found');
  const guarded = poll.slice(plannedAwait, apply);
  assert.match(guarded, /shouldApplyPolledChange\(/);
  assert.match(guarded, /settled\.unsettled/);
  assert.match(guarded, /settled\.runtimeDirty/);
  assert.match(poll.slice(0, plannedAwait), /shouldApplyPolledChange\(/, 'the pre-await gate must stay');
  assert.doesNotMatch(
    poll,
    /planned\.change\?\.id === pendingId && planned\.change\.revision > 1/,
    'the dirty-free pending check must be gone',
  );
});

test('the poll compares against a per-render ref instead of the effect closure', () => {
  assert.match(
    source,
    /const liveState = React\.useRef\(\{ change: null, unsettled: false, runtimeDirty: false \}\);/,
  );
  assert.match(source, /liveState\.current = \{ change, unsettled, runtimeDirty \};/);
});
