import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
function functionSource(name, indent = '    ', async = false) {
  const start = source.indexOf(`${indent}${async ? 'async ' : ''}function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf(`\n${indent}}`, start) + indent.length + 2).trim();
}
const load = name => Function(`return (${functionSource(name)})`)();
const gitListState = load('gitListState');
const gitRequestBlock = load('gitRequestBlock');
const cachedGitRequest = load('cachedGitRequest');
const validGitEnvelopes = load('validGitEnvelopes');
const gitRecordFields = load('gitRecordFields');
const gitComparisonSelection = load('gitComparisonSelection');
const savedGitComparison = load('savedGitComparison');
const change = { id: 'a', revision: 7, planVersion: 2 };
const envelope = (id = 'record', changeId = 'a') => ({ schemaVersion: 1, requestId: 'request', ownerSessionId: 'session',
  observation: { id, changeId, status: 'ok', dirty: false, head: 'commit', untrackedCount: 0, limitations: ['paths-only'], error: null } });
const list = () => ({ changeId: 'a', observations: [envelope()], stale: false, loading: false, error: '' });

test('request guard covers dirty, missing/stale/loading/foreign records and stored baseline only', () => {
  assert.equal(gitRequestBlock(change, list(), false, 'capture'), '');
  assert.equal(gitRequestBlock(change, list(), false, 'compare', 'record'), '');
  assert.equal(gitRequestBlock(change, list(), true, 'capture'), 'saveFirst');
  for (const patch of [{ observations: null }, { stale: true }, { loading: true }, { error: 'offline' }, { changeId: 'b' }])
    assert.equal(gitRequestBlock(change, { ...list(), ...patch }, false, 'capture'), 'gitRefreshRequired');
  assert.equal(gitRequestBlock(change, list(), false, 'compare', 'missing'), 'gitChooseBaseline');
  assert.equal(gitRequestBlock(change, list(), false, 'unknown'), 'gitRefreshRequired');
});

test('strict capture/compare fields, reuse and explicit fresh IDs are isolated by complete identity', () => {
  const cache = new Map(); let n = 0; const uuid = () => `uuid-${++n}`;
  const first = cachedGitRequest(cache, change, 'capture', '', uuid);
  assert.deepEqual(first, { action: 'capture', changeId: 'a', expectedRevision: 7, planVersion: 2, requestId: 'uuid-1' });
  assert.equal(cachedGitRequest(cache, change, 'capture', 'ignored', uuid), first);
  const compare = cachedGitRequest(cache, change, 'compare', 'record', uuid);
  assert.deepEqual(compare, { ...first, action: 'compare', baselineId: 'record', requestId: 'uuid-2' });
  assert.equal(cachedGitRequest(cache, change, 'compare', 'record', uuid), compare);
  for (const next of [{ ...change, id: 'b' }, { ...change, revision: 8 }, { ...change, planVersion: 3 }])
    assert.notEqual(cachedGitRequest(cache, next, 'capture', '', uuid).requestId, first.requestId);
  assert.notEqual(cachedGitRequest(cache, change, 'compare', 'other', uuid).requestId, compare.requestId);
  const fresh = cachedGitRequest(cache, change, 'capture', '', uuid, true);
  assert.notEqual(fresh.requestId, first.requestId);
  assert.equal(cachedGitRequest(cache, change, 'capture', '', uuid), fresh);
});

test('actual native handler only fills or copies, UUID reuse/fresh and guards apply equally', () => {
  const events = []; let n = 0;
  const cache = { current: new Map() };
  const handler = (patch = {}) => Function('busy', 'gitRequestBlock', 'change', 'gitList', 'unsettled', 'cachedGitRequest', 'gitRequests', 'crypto', 't', 'insertChatText', 'copy',
    `return (${functionSource('nativeGitRequest', '          ')});`)(patch.busy || false, gitRequestBlock, change, patch.list || list(), patch.dirty || false,
    cachedGitRequest, cache, { randomUUID: () => `uuid-${++n}` }, (key, values) => values.payload,
    text => events.push(['fill', JSON.parse(text)]), text => events.push(['copy', JSON.parse(text)]));
  handler()('capture', '', 'fill'); handler()('capture', '', 'copy');
  assert.deepEqual(events[0][1], events[1][1]);
  handler()('capture', '', 'fill', true);
  assert.notEqual(events[2][1].requestId, events[0][1].requestId);
  for (const target of ['fill', 'copy']) {
    for (const patch of [{ busy: true }, { dirty: true }, { list: { ...list(), stale: true } }]) handler(patch)('capture', '', target);
    handler()('compare', 'missing', target);
  }
  assert.equal(events.length, 3);
  const text = functionSource('nativeGitRequest', '          ');
  assert.ok(!/command\(|mutate\(|submit\(/.test(text));
});
function harness() {
  let state = gitListState({}, { type: 'select', changeId: 'a' });
  const pending = [], sequence = { current: 0 }, mounted = { current: true };
  return {
    get state() { return state; }, pending, mounted,
    select(changeId) { state = gitListState(state, { type: 'select', changeId }); },
    refresh(id = 'a') {
      return Function('change', 'gitSequence', 'setGitList', 'gitListState', 'command', 'mounted', 't', 'validGitEnvelopes',
        `return (${functionSource('refreshGitObservations', '          ', true)});`)(
        { id }, sequence, update => { state = update(state); }, gitListState,
        input => new Promise((resolve, reject) => pending.push({ input, resolve, reject })), mounted, key => key, validGitEnvelopes)();
    },
  };
}
test('actual loader binds change and sequence: A-B-A and latest request win', async () => {
  const h = harness(), old = h.refresh();
  assert.deepEqual(h.pending[0].input, { action: 'gitObservations', changeId: 'a' });
  h.select('b'); assert.equal(h.state.observations, null); h.select('a');
  const current = h.refresh(); h.pending[1].resolve({ observations: [envelope('new')] }); await current;
  h.pending[0].resolve({ observations: [envelope('old')] }); await old;
  assert.equal(h.state.observations[0].observation.id, 'new');
  const first = h.refresh(), second = h.refresh();
  h.pending[3].resolve({ observations: [envelope('latest')] }); await second;
  h.pending[2].reject(new Error('late failure')); await first;
  assert.equal(h.state.error, ''); assert.equal(h.state.observations[0].observation.id, 'latest');
});
test('failed and malformed loads retain same-change stale records; unmount ignores response', async () => {
  const h = harness(); let request = h.refresh();
  h.pending[0].resolve({ observations: [envelope()] }); await request;
  request = h.refresh(); h.pending[1].reject(new Error('offline')); await request;
  assert.equal(h.state.stale, true); assert.equal(h.state.error, 'offline');
  request = h.refresh(); h.pending[2].resolve({ observations: [envelope('foreign', 'b')] }); await request;
  assert.equal(h.state.error, 'invalidResponse'); assert.equal(h.state.observations[0].observation.id, 'record');
  request = h.refresh(); h.pending[3].resolve({ observations: [] }); await request;
  assert.equal(h.state.stale, false); assert.equal(h.state.error, '');
  request = h.refresh(); h.mounted.current = false; const before = h.state;
  h.pending[4].resolve({ observations: [envelope()] }); await request; assert.equal(h.state, before);
});
test('actual card renders records as text, disables all request controls when stale or dirty, and keeps baseline change-bound', () => {
  function render(patch = {}) {
    const controls = [], events = [];
    const h = (type, props, ...children) => ({ type, props, children });
    const view = Function('gitList', 'change', 'gitListState', 'gitBaseline', 'h', 't', 'button', 'refreshGitObservations', 'busy', 'gitRecordFields', 'gitRequestBlock', 'unsettled', 'setGitBaseline', 'nativeGitRequest', 'gitComparisonSelection', 'savedGitComparison', 'selectGitObservation',
      `return (${functionSource('gitObservationsView', '          ')});`)(patch.list || list(), change, gitListState, patch.baseline || { changeId: 'a', id: 'record' }, h, key => key,
      (label, onClick, disabled) => { const node = { label, onClick, disabled }; controls.push(node); return node; }, () => {}, patch.busy || false,
      gitRecordFields, gitRequestBlock, patch.dirty || false, value => events.push(value), (...args) => events.push(args),
      gitComparisonSelection, savedGitComparison, (...args) => events.push(args));
    return { tree: view(), controls, events };
  }
  const good = render(); assert.equal(good.controls.length, 7);
  assert.ok(good.controls.slice(1).every(button => !button.disabled));
  good.controls[3].onClick(); assert.deepEqual(good.events[0], ['capture', 'record', 'fill', true]);
  for (const patch of [{ dirty: true }, { busy: true }, { list: { ...list(), stale: true } }, { list: { ...list(), loading: true } }])
    assert.ok(render(patch).controls.slice(1).every(button => button.disabled));
  const foreign = render({ baseline: { changeId: 'b', id: 'record' } });
  assert.ok(foreign.controls.slice(4).every(button => button.disabled));
  const text = JSON.stringify(render({ list: { ...list(), changeId: 'b', observations: [envelope('FOREIGN', 'b')] } }).tree);
  assert.ok(!text.includes('FOREIGN'));
});
test('envelopes allow legacy and request metadata, display false/zero/null and raw errors honestly', () => {
  assert.equal(validGitEnvelopes([envelope(), { ...envelope(), request: { action: 'compare', baselineId: 'baseline' } }], 'a'), true);
  for (const value of [null, [{}], [{ ...envelope(), schemaVersion: 2 }], [envelope('x', 'b')]]) assert.equal(validGitEnvelopes(value, 'a'), false);
  const fields = gitRecordFields(envelope());
  assert.equal(Object.fromEntries(fields.metadata).dirty, 'false');
  assert.equal(Object.fromEntries(fields.hashes).untrackedCount, '0');
  assert.equal(Object.fromEntries(fields.hashes).stagedDiffSha256, '—');
  assert.equal(Object.fromEntries(fields.details).error, '—');
  const bad = envelope(); bad.observation.error = { message: '<script>bad</script>' };
  assert.match(Object.fromEntries(gitRecordFields(bad).details).error, /<script>/);
  const view = functionSource('gitObservationsView', '          ');
  assert.ok(view.includes('h("pre", null, value)')); assert.ok(!view.includes('dangerouslySetInnerHTML'));
  assert.ok(source.includes('tab === "plan" && architectureView()'));
  assert.match(source, /t\("advancedInfo"\)[\s\S]*?gitObservationsView\(\)/);
  assert.ok(source.includes('full equality not established'));
  assert.ok(view.includes('HEAD (Git object ID)'));
  assert.ok(source.includes('"/engineering " + JSON.stringify(input)'));
});
