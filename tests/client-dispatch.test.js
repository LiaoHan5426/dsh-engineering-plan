import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
function functionSource(name, indent = '    ', async = false) {
  const start = source.indexOf(`${indent}${async ? 'async ' : ''}function ${name}(`);
  assert.ok(start >= 0, name);
  const end = source.indexOf(`\n${indent}}`, start) + indent.length + 2;
  return source.slice(start, end).trim();
}
const dispatchListState = Function(`return (${functionSource('dispatchListState')})`)();
const dispatchRecordFields = Function(`return (${functionSource('dispatchRecordFields')})`)();
const dispatchRequestBlock = Function(`return (${functionSource('dispatchRequestBlock')})`)();
const cachedDispatchRequest = Function(`return (${functionSource('cachedDispatchRequest')})`)();
const approvedChange = () => ({ id: 'a', planVersion: 2, revision: 7,
  approvals: [{ planVersion: 2, actor: { kind: 'user' } }],
  tasks: [{ id: 'task', status: 'pending', dependencies: ['dep'] }, { id: 'dep', status: 'completed' }] });
const loadedList = () => ({ changeId: 'a', runs: [], stale: false, loading: false, error: '' });

test('native dispatch preflight fails closed for approval, saved task, dependencies, delivery and stale records', () => {
  const good = approvedChange();
  const check = (change = good, list = loadedList(), dirty = false, id = 'task') => dispatchRequestBlock(change, id, list, dirty);
  assert.equal(check(), '');
  assert.equal(check(good, loadedList(), true), 'saveFirst');
  for (const approvals of [[], [{ planVersion: 1, actor: { kind: 'user' } }], [{ planVersion: 2, actor: { kind: 'agent' } }]])
    assert.equal(check({ ...good, approvals }), 'approvalRequired');
  assert.equal(check({ ...good, deliveryAcceptance: { planVersion: 2 } }), 'deliveryFrozen');
  assert.equal(check({ ...good, deliveryAcceptance: { planVersion: 1 } }), '');
  assert.equal(check(good, loadedList(), false, 'unsaved'), 'dispatchPendingOnly');
  for (const status of ['running', 'verifying', 'completed', 'cancelled', 'failed', 'blocked'])
    assert.equal(check({ ...good, tasks: [{ ...good.tasks[0], status }, good.tasks[1]] }), 'dispatchPendingOnly');
  for (const status of ['pending', 'running', 'cancelled', 'unknown'])
    assert.equal(check({ ...good, tasks: [good.tasks[0], { ...good.tasks[1], status }] }), 'dispatchDependencies');
  assert.equal(check({ ...good, tasks: [good.tasks[0]] }), 'dispatchDependencies');
  for (const patch of [{ runs: null }, { stale: true }, { loading: true }, { error: 'offline' }, { changeId: 'b' }])
    assert.equal(check(good, { ...loadedList(), ...patch }), 'dispatchRefreshRequired');
  for (const state of ['reserved', 'starting', 'running', 'unknown', 'future-state', undefined])
    assert.equal(check(good, { ...loadedList(), runs: [{ changeId: 'a', state }] }), 'dispatchRunBlocked');
  for (const state of ['returned', 'failed', 'error', 'cancelled'])
    assert.equal(check(good, { ...loadedList(), runs: [{ changeId: 'a', state }] }), '');
});

test('native payload strictly matches tool schema and caches requestId by change/version/revision/task', () => {
  const cache = new Map(); let calls = 0;
  const makeId = () => `request-${++calls}`;
  const change = approvedChange();
  const first = cachedDispatchRequest(cache, change, 'task', makeId);
  assert.deepEqual(first, { changeId: 'a', taskId: 'task', expectedRevision: 7, planVersion: 2, requestId: 'request-1' });
  assert.equal(cachedDispatchRequest(cache, change, 'task', makeId), first);
  for (const patch of [{ id: 'b' }, { planVersion: 3 }, { revision: 8 }])
    assert.notEqual(cachedDispatchRequest(cache, { ...change, ...patch }, 'task', makeId).requestId, first.requestId);
  assert.notEqual(cachedDispatchRequest(cache, change, 'other', makeId).requestId, first.requestId);
  assert.equal(cachedDispatchRequest(cache, change, 'task', makeId), first);
  assert.equal(calls, 5);
});

test('actual copy and fill handlers share guard and payload, never dispatch or auto-submit', () => {
  const events = []; const cache = { current: new Map() };
  const state = { change: approvedChange(), list: loadedList(), unsettled: false, busy: false };
  const handler = () => Function('busy', 'dispatchRequestBlock', 'change', 'dispatchList', 'unsettled', 'cachedDispatchRequest', 'dispatchRequests', 'crypto', 't', 'insertChatText', 'copy',
    `return (${functionSource('nativeDispatchRequest', '          ')});`)(state.busy, dispatchRequestBlock, state.change, state.list, state.unsettled, cachedDispatchRequest, cache, { randomUUID: () => 'uuid' },
    (key, values) => values.payload, text => events.push(['fill', JSON.parse(text)]), text => events.push(['copy', JSON.parse(text)]));
  for (const target of ['fill', 'copy']) handler()('task', target);
  assert.equal(events.length, 2); assert.deepEqual(events[0][1], events[1][1]);
  for (const target of ['fill', 'copy']) {
    for (const patch of [{ unsettled: true }, { busy: true }, { list: { ...loadedList(), runs: null } }, { change: { ...approvedChange(), approvals: [] } }]) {
      Object.assign(state, { change: approvedChange(), list: loadedList(), unsettled: false, busy: false }, patch);
      handler()('task', target);
    }
  }
  assert.equal(events.length, 2);
  const controls = functionSource('nativeDispatchControls', '          ');
  // The guard now also takes the verification list, so assert on the stable prefix instead of the full call.
  assert.ok(controls.includes('dispatchRequestBlock(change, taskId, dispatchList, unsettled,'));
  assert.equal((controls.match(/busy \|\| !!blocked/g) || []).length, 2);
  assert.ok(source.includes('crypto.randomUUID()'));
  assert.ok(source.includes('nativeDispatchControls(task.id)'));
  assert.ok(source.includes('requestControls("task", task.id)'));
  assert.ok(!functionSource('nativeDispatchRequest', '          ').includes('command('));
});
function harness() {
  let state = dispatchListState({}, { type: 'select', changeId: 'a' });
  const pending = [];
  const sequence = { current: 0 };
  const mounted = { current: true };
  const command = (input) => new Promise((resolve, reject) => pending.push({ input, resolve, reject }));
  const setDispatchList = (update) => { state = update(state); };
  return {
    get state() { return state; }, pending, mounted,
    select(changeId) { state = dispatchListState(state, { type: 'select', changeId }); },
    refresh(changeId) {
      return Function('change', 'dispatchSequence', 'setDispatchList', 'dispatchListState', 'command', 'mounted', 't',
        `return (${functionSource('refreshDispatchRuns', '          ', true)});`)(
        { id: changeId }, sequence, setDispatchList, dispatchListState, command, mounted, (key) => key)();
    },
  };
}

test('actual async loader discards responses after switching change, including A-B-A', async () => {
  const h = harness();
  const old = h.refresh('a');
  assert.deepEqual(h.pending[0].input, { action: 'dispatchRuns', changeId: 'a' });
  assert.equal(h.state.loading, true);
  h.select('b');
  assert.equal(h.state.runs, null);
  assert.equal(h.state.loading, false);
  h.select('a');
  const current = h.refresh('a');
  h.pending[1].resolve({ runs: [{ changeId: 'a', runId: 'new' }] });
  await current;
  h.pending[0].resolve({ runs: [{ changeId: 'a', runId: 'old' }] });
  await old;
  assert.equal(h.state.runs[0].runId, 'new');
});

test('actual async loader retains same-change data and marks failed refresh stale', async () => {
  const h = harness();
  let request = h.refresh('a');
  h.pending[0].resolve({ runs: [{ changeId: 'a', runId: 'kept' }] });
  await request;
  request = h.refresh('a');
  h.pending[1].reject(new Error('offline'));
  await request;
  assert.equal(h.state.runs[0].runId, 'kept');
  assert.equal(h.state.stale, true);
  assert.equal(h.state.error, 'offline');
  assert.equal(h.state.loading, false);
  request = h.refresh('a');
  h.pending[2].resolve({ runs: [] });
  await request;
  assert.deepEqual(h.state.runs, []);
  assert.equal(h.state.stale, false);
  assert.equal(h.state.error, '');
});

test('latest request wins, invalid payload errors stay local, and unmount ignores results', async () => {
  const h = harness();
  const first = h.refresh('a');
  const second = h.refresh('a');
  h.pending[1].resolve({ runs: [{ changeId: 'a', runId: 'latest' }] });
  await second;
  h.pending[0].reject(new Error('late failure'));
  await first;
  assert.equal(h.state.error, '');
  const bad = h.refresh('a');
  h.pending[2].resolve({ runs: [{ changeId: 'b', runId: 'wrong-change' }] });
  await bad;
  assert.equal(h.state.error, 'invalidResponse');
  assert.equal(h.state.runs[0].runId, 'latest');
  const unmounted = h.refresh('a');
  h.mounted.current = false;
  const before = h.state;
  h.pending[3].resolve({ runs: [] });
  await unmounted;
  assert.equal(h.state, before);
});

test('record presenter retains raw states, fields, output and false truncation', () => {
  for (const state of ['reserved', 'starting', 'running', 'returned', 'failed', 'cancelled', 'error', 'unknown']) {
    const fields = dispatchRecordFields({ runId: 'r', taskId: 't', planVersion: 3, state,
      childId: 'child', jobId: 'job', createdAt: 'created', finishedAt: 'finished', truncated: false,
      result: { text: '<untrusted>\noutput', stopReason: 'done', diagnostic: 'details' }, error: 'error', reason: 'reason' });
    assert.deepEqual(Object.fromEntries(fields.metadata), { runId: 'r', taskId: 't', planVersion: '3', state,
      childId: 'child', jobId: 'job', createdAt: 'created', finishedAt: 'finished', truncated: 'false' });
    assert.deepEqual(Object.fromEntries(fields.output), { 'result.text': '<untrusted>\noutput', stopReason: 'done', diagnostic: 'details', error: 'error', reason: 'reason' });
  }
  assert.equal(Object.fromEntries(dispatchRecordFields({ result: null }).metadata).jobId, '—');
  const view = functionSource('dispatchRunsView', '          ');
  assert.ok(view.includes('h("dl"'));
  assert.ok(view.includes('h("pre", null, value)'));
  assert.ok(view.includes('t("dispatchTruth")'));
  assert.ok(!view.includes('mutate('));
  assert.match(source, /t\("currentRuns"\).*dispatchRunsView\(\)/);
});
