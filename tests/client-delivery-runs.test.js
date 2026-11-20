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

function extract(name, indent = '          ', async = false) {
  const marker = `${indent}${async ? 'async ' : ''}function ${name}(`;
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `missing ${name}`);
  const end = source.indexOf(`\n${indent}}`, start);
  assert.ok(end > start, `unterminated ${name}`);
  return source.slice(start, end + indent.length + 2);
}

const runsHelpers = Function(`${block('/* BEGIN DELIVERY RUNS SUMMARY */', '/* END DELIVERY RUNS SUMMARY */')}
  return { runsLoadedOf, runsBlockedOf };`)();
const { runsLoadedOf, runsBlockedOf } = runsHelpers;
const acceptRunsFor = Function(`return (${extract('acceptRunsFor', '    ')})`)();

const ACTIVE = ['reserved', 'starting', 'running'];

test('an unloaded run list is not reported as a blocked one', () => {
  for (const value of [null, undefined]) {
    assert.equal(runsLoadedOf(value), false);
    assert.equal(runsBlockedOf(value), false, 'nothing is blocked while nothing has been read');
  }
  assert.equal(runsLoadedOf([]), true);
  assert.equal(runsBlockedOf([], []), false);
});

test('only active and unresolved unknown records block a loaded list', () => {
  for (const state of ACTIVE) assert.equal(runsBlockedOf([{ state }], []), true, state);
  for (const state of ['succeeded', 'failed', 'cancelled', 'returned', 'pending', 'verifying']) {
    assert.equal(runsBlockedOf([{ state }], []), false, state);
  }
});

test('an unknown run blocks until a human resolution of that exact revision exists', () => {
  const run = { state: 'unknown', runId: 'r1', revision: 4 };
  assert.equal(runsBlockedOf([run], []), true);
  const resolved = (patch) => ({ kind: 'verification-unknown-resolved', runId: 'r1', runRevision: 4, actor: { kind: 'user' }, ...patch });
  assert.equal(runsBlockedOf([run], [resolved({})]), false);
  for (const patch of [{ runId: 'other' }, { runRevision: 5 }, { actor: { kind: 'system' } }, { kind: 'run-abandoned' }]) {
    assert.equal(runsBlockedOf([run], [resolved(patch)]), true, JSON.stringify(patch));
  }
  assert.equal(runsBlockedOf([run], undefined), true, 'a missing history resolves nothing');
});

test('the delivery card separates "not loaded" from "blocked" and disables acceptance on both', () => {
  const card = source.slice(source.indexOf('          function deliveryReviewView()'),
    source.indexOf('          function archivedReviewsView()'));
  assert.match(card, /const runsLoaded = runsLoadedOf\(verificationRuns\);/);
  assert.match(card, /const runsBlocked = runsBlockedOf\(verificationRuns, change\.history\);/);
  assert.doesNotMatch(card, /verificationRuns === null/, 'an unread list must not be treated as a blocker');
  assert.match(card, /const eligible = approved && tasksFinalized && runsLoaded && !runsBlocked && !accepted && !unsettled;/);
  assert.match(card, /!runsLoaded && h\("p", \{ className: "ep-warn" \}, t\("deliveryRunsUnloaded"\)\)/);
  assert.match(card, /runsBlocked && h\("p", \{ className: "ep-warn" \}, t\("deliveryBlockedRuns"\)\)/);
  assert.match(card, /button\(runsLoaded \? "refresh" : "refreshRunsFirst", \(\) => run\(refreshRuns\)\)/);
});

function refreshRuns(overrides = {}) {
  const bindings = {
    change: { id: 'a' },
    setResolution: () => {},
    resetDispatchConfirmations: { name: 'reset' },
    mounted: { current: true },
    setVerificationRuns: () => {},
    acceptRunsFor,
    liveState: { current: { change: { id: 'a' } } },
    command: async () => ({ runs: [] }),
    t: (key) => key,
    ...overrides,
  };
  const names = Object.keys(bindings);
  return Function(...names, `return (${extract('refreshRuns', '          ', true)});`)(...names.map((name) => bindings[name]));
}

test('a landed refresh applies confirmations once, after the stale guard', async () => {
  const updates = [];
  const written = [];
  const reset = (forms) => forms;
  const call = refreshRuns({
    resetDispatchConfirmations: reset,
    setResolution: (update) => updates.push(update),
    setVerificationRuns: (value) => written.push(value),
    command: async () => ({ runs: [{ changeId: 'a', runId: 'r1' }] }),
  });
  assert.equal(await call(), 'applied');
  assert.equal(updates.length, 1, 'exactly one reset, and only once the answer is accepted');
  assert.equal(updates[0], reset);
  assert.deepEqual(written, [[{ changeId: 'a', runId: 'r1' }]]);
});

test('an explicit target is requested instead of the change that is on screen', async () => {
  const asked = [];
  const call = refreshRuns({
    liveState: { current: { change: { id: 'b' } } },
    command: async (input) => { asked.push(input); return { runs: [{ changeId: 'b' }] }; },
  });
  assert.equal(await call('b'), 'applied');
  assert.deepEqual(asked, [{ action: 'verificationRuns', changeId: 'b' }]);
});

test('a failed request keeps the confirmation the human already ticked', async () => {
  const updates = [];
  const written = [];
  const call = refreshRuns({
    setResolution: (update) => updates.push(update),
    setVerificationRuns: (value) => written.push(value),
    command: async () => { throw new Error('offline'); },
  });
  await assert.rejects(call(), /offline/);
  assert.deepEqual(updates, [], 'nothing is revoked before the answer lands');
  assert.deepEqual(written, []);
});

test('a reply that belongs to another change writes nothing', async () => {
  const updates = [];
  const written = [];
  const call = refreshRuns({
    liveState: { current: { change: { id: 'b' } } },
    setResolution: (update) => updates.push(update),
    setVerificationRuns: (value) => written.push(value),
    command: async () => ({ runs: [{ changeId: 'a' }] }),
  });
  assert.equal(await call(), 'stale');
  assert.deepEqual(updates, []);
  assert.deepEqual(written, []);
});

test('a refresh without any change is a no-op', async () => {
  let asked = 0;
  const call = refreshRuns({ change: null, command: async () => { asked += 1; return { runs: [] }; } });
  assert.equal(await call(), 'missing');
  assert.equal(asked, 0);
});

function loadChangeHarness() {
  const start = source.indexOf('          const loadChange = ');
  const end = source.indexOf('          async function sendCommand(', start);
  assert.ok(start > 0 && end > start, 'loadChange not found');
  const expression = source.slice(start, end).trim().replace(/^const loadChange = /, '').replace(/;$/, '');
  const bindDelivery = extract('bindDelivery', '    ');
  const setters = [...new Set(expression.match(/set[A-Z]\w+/g))];
  const calls = [];
  const values = setters.map((name) => (...args) => calls.push([name, args]));
  const load = Function('normalize', 'clone', 'bindDelivery', ...setters, `return (${expression});`)(
    (value) => value, (value) => structuredClone(value), bindDelivery, ...values);
  return { load, calls };
}

test('loading a change drops the gate verdict that belonged to the previous version', () => {
  const { load, calls } = loadChangeHarness();
  load({ id: 'a', planVersion: 2, history: [] }, { preserveRuntime: true, submitted: 'acceptDelivery' });
  const gate = calls.find(([name]) => name === 'setGate');
  const gateError = calls.find(([name]) => name === 'setGateError');
  assert.deepEqual(gate, ['setGate', [null]]);
  assert.deepEqual(gateError, ['setGateError', ['']]);
});

test('loadChange asks for a run refresh without depending on the helper existing', () => {
  const start = source.indexOf('          const loadChange = ');
  const end = source.indexOf('          async function sendCommand(', start);
  const body = source.slice(start, end);
  assert.match(body, /if \(typeof noteChangeLoaded === "function"\) noteChangeLoaded\(next\);$/m);
});
