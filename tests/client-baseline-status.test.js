import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
function fn(name, indent = '    ', async = false) {
  const start = source.indexOf(`${indent}${async ? 'async ' : ''}function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf(`\n${indent}}`, start) + indent.length + 2).trim();
}
const names = ['baselineStatusCandidates', 'baselineStatusIdentity', 'baselineStatusContext', 'validBaselineStatus', 'baselineStatusResultView'];
const helpers = Function(`${names.map(name => fn(name)).join('\n')}\n${fn('queryBaselineStatus', '    ', true)}\nreturn {${names.join(',')},queryBaselineStatus};`)();
const { baselineStatusCandidates, baselineStatusContext, queryBaselineStatus, validBaselineStatus, baselineStatusResultView } = helpers;
const change = { id: 'a', revision: 8, planVersion: 2, approvals: [{ planVersion: 2, actor: { kind: 'user' }, codeBaseline: { observationId: 'baseline' } }] };
const obs = (id, patch = {}) => ({ observation: { id, changeId: 'a', planVersion: 2, sourceRevision: 8, status: 'ok', ...patch } });
const list = { changeId: 'a', observations: [obs('baseline'), obs('later'), obs('partial', { status: 'partial', sourceRevision: 7 })], loading: false, stale: false, error: '' };
const result = (state = 'not_checked', id = '', patch = {}) => ({ changeId: 'a', revision: 8, planVersion: 2, state, currentObservationId: id || null,
  currentObservationMatchesRevision: id ? true : null, reasons: [], comparison: ['observed_equal', 'observed_drift', 'unknown'].includes(state) ? {
    headChanged: false, stagedChanged: true, worktreeChanged: null, untrackedPathsChanged: false,
    observedEqual: { observed_equal: true, observed_drift: false, unknown: null }[state], fullWorkspaceEquality: 'not-established', reasons: [], limitations: ['paths-only'],
  } : null, ...patch });
function harness() {
  let c = change, l = list, state = null;
  const context = { current: baselineStatusContext(null, c, l) }, sequence = { current: 0 }, mounted = { current: true }, requests = [];
  return { context, sequence, mounted, requests, get state() { return state; },
    get visible() { return state?.binding === context.current ? state : null; },
    bind(next = c, nextList = l) { c = next; l = nextList; context.current = baselineStatusContext(context.current, c, l); },
    query(id = '') { return queryBaselineStatus({ change: c, list: l, observationId: id, context, sequence, mounted,
      command: input => new Promise((resolve, reject) => requests.push({ input, resolve, reject })), update: next => { state = next; }, t: key => key }); },
  };
}

test('post-approval candidates use same change/version, exclude baseline, allow old revisions and partial observations', () => {
  assert.deepEqual(baselineStatusCandidates(change, list).map(entry => entry.observation.id), ['later', 'partial']);
  const mixed = { ...list, observations: [...list.observations, obs('foreign', { changeId: 'b' }), obs('version', { planVersion: 3 })] };
  assert.equal(baselineStatusCandidates(change, mixed).length, 2);
  for (const patch of [{ loading: true }, { stale: true }, { error: 'offline' }, { observations: null }, { changeId: 'b' }]) assert.deepEqual(baselineStatusCandidates(change, { ...list, ...patch }), []);
  assert.deepEqual(baselineStatusCandidates({ ...change, approvals: [] }, list), []);
  assert.deepEqual(baselineStatusCandidates({ ...change, approvals: [{ planVersion: 2, actor: { kind: 'user' } }] }, list), []);
});

test('actual query emits exact read payload and never captures, approves, mutates, or writes chat', async () => {
  const h = harness(); let request = h.query();
  assert.deepEqual(h.requests[0].input, { action: 'approvalBaselineStatus', changeId: 'a' });
  h.requests[0].resolve(result()); await request;
  request = h.query('later');
  assert.deepEqual(h.requests[1].input, { action: 'approvalBaselineStatus', changeId: 'a', observationId: 'later' });
  h.requests[1].resolve(result('observed_equal', 'later')); await request;
  assert.equal(h.visible.result.state, 'observed_equal');
  await h.query('baseline'); assert.equal(h.requests.length, 2);
  assert.doesNotMatch(fn('queryBaselineStatus', '    ', true), /mutate\(|capture|insertChatText|setDraft|approve\(/);
});

test('actual asynchronous handler latest wins, stale failures ignored, errors and unknown remove old success', async () => {
  const h = harness(); const old = h.query('later'), recent = h.query('partial');
  h.requests[1].resolve(result('unknown', 'partial', { currentObservationMatchesRevision: false })); await recent;
  h.requests[0].reject(new Error('old failure')); await old;
  assert.equal(h.visible.result.state, 'unknown'); assert.equal(h.visible.result.currentObservationMatchesRevision, false);
  let pending = h.query('later'); assert.equal(h.visible.result, null); assert.equal(h.visible.loading, true);
  h.requests[2].resolve(result('observed_equal', 'later')); await pending;
  pending = h.query('later'); h.requests[3].reject(new Error('offline')); await pending;
  assert.equal(h.visible.result, null); assert.equal(h.visible.error, 'offline');
  pending = h.query('later'); h.requests[4].resolve(result('observed_drift', 'later')); await pending;
  assert.equal(h.visible.error, ''); assert.equal(h.visible.result.state, 'observed_drift');
});

test('change/revision/version/list refresh and A-B-A invalidate in-flight query and visible result', async () => {
  for (const next of [{ ...change }, { ...change, id: 'b' }, { ...change, revision: 9 }, { ...change, planVersion: 3 }]) {
    const h = harness(), pending = h.query('later'); h.bind(next); h.bind(change);
    assert.equal(h.visible, null); h.requests[0].resolve(result('observed_equal', 'later')); await pending; assert.equal(h.visible, null);
  }
  const h = harness(); let pending = h.query('later');
  h.requests[0].resolve(result('observed_equal', 'later')); await pending;
  h.bind(change, { ...list, loading: true }); assert.equal(h.visible, null);
  h.bind(change, list); pending = h.query('later');
  h.bind(change, { ...list, error: 'refresh failure' });
  h.requests[1].resolve(result('observed_equal', 'later')); await pending; assert.equal(h.visible, null);
});

test('handlers captured before a change refresh or switch never send an old-binding query', async () => {
  const context = { current: baselineStatusContext(null, { ...change, revision: 9 }, list) };
  let calls = 0;
  await queryBaselineStatus({ change, list, observationId: '', context, sequence: { current: 0 }, mounted: { current: true },
    command: () => { ++calls; }, update: () => { ++calls; }, t: key => key });
  assert.equal(calls, 0);
});

test('unmount and selection sequence invalidation discard pending responses', async () => {
  for (const invalidate of [h => { h.mounted.current = false; }, h => { ++h.sequence.current; }]) {
    const h = harness(), pending = h.query('later'); const before = h.state; invalidate(h);
    h.requests[0].resolve(result('observed_equal', 'later')); await pending; assert.equal(h.state, before);
  }
});

test('responses must match current revision/version/observation and six-state comparison contract', async () => {
  for (const patch of [{ revision: 9 }, { planVersion: 3 }, { changeId: 'b' }, { currentObservationId: 'partial' }, { state: 'nonsense' }, { currentObservationMatchesRevision: 'false' }, { reasons: null }, { comparison: { observedEqual: true } }]) {
    const h = harness(), pending = h.query('later'); h.requests[0].resolve(result('observed_equal', 'later', patch)); await pending;
    assert.equal(h.visible.error, 'invalidResponse'); assert.equal(h.visible.result, null);
  }
  for (const state of ['no_approval', 'unbound', 'not_checked']) assert.equal(validBaselineStatus(result(state), change, ''), true);
  for (const state of ['observed_equal', 'observed_drift', 'unknown']) assert.equal(validBaselineStatus(result(state, 'later'), change, 'later'), true);
});

test('renderer preserves six states, four comparison three-states, false revision match, reasons and coverage', () => {
  const h = (type, props, ...children) => ({ type, props, children });
  for (const state of ['no_approval', 'unbound', 'not_checked', 'observed_equal', 'observed_drift', 'unknown']) {
    const text = JSON.stringify(baselineStatusResultView(result(state, 'later', { currentObservationMatchesRevision: false, reasons: ['<script>reason</script>'] }), h, key => key));
    assert.ok(text.includes('baselineStatus_' + state)); assert.ok(text.includes('currentObservationMatchesRevision'));
    assert.ok(text.includes('false')); assert.ok(text.includes('<script>reason</script>'));
    if (['observed_equal', 'observed_drift', 'unknown'].includes(state)) {
      for (const expected of ['headChanged', 'stagedChanged', 'worktreeChanged', 'untrackedPathsChanged', 'null · not-established', 'true', 'false', 'paths-only']) assert.ok(text.includes(expected), expected);
    }
  }
  assert.doesNotMatch(fn('baselineStatusResultView'), /dangerouslySetInnerHTML/);
});

function componentHarness() {
  let cursor = 0; const slots = [], cleanups = [], commands = [];
  let props = { change, list, busy: false, refresh: () => {}, command: input => new Promise((resolve, reject) => commands.push({ input, resolve, reject })) };
  const React = { useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
    useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = value; return [slots[i], next => { slots[i] = next; }]; },
    useEffect(effect) { const i = cursor++; if (!(i in slots)) { slots[i] = true; cleanups.push(effect()); } } };
  const env = { React, ...helpers, t: key => key, h: (type, props, ...children) => ({ type, props, children }), approvalBaselineLabel: observation => observation.id };
  const component = Function(...Object.keys(env), `return (${fn('BaselineStatusPanel', '        ')});`)(...Object.values(env));
  return { commands, render(patch = {}) { props = { ...props, ...patch }; cursor = 0; return component(props); }, unmount() { cleanups.forEach(cleanup => cleanup?.()); } };
}
function nodes(tree, type) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(item => nodes(item, type));
  return [...(tree.type === type ? [tree] : []), ...(tree.children || []).flatMap(item => nodes(item, type))];
}
test('actual component handlers query only on click, reset independently on selection/refresh, preserve dirty drafts', async () => {
  const h = componentHarness(); let tree = h.render(); assert.equal(h.commands.length, 0);
  nodes(tree, 'select')[0].props.onChange({ target: { value: 'later' } });
  tree = h.render(); assert.equal(nodes(tree, 'select')[0].props.value, 'later');
  const query = nodes(tree, 'button').find(node => node.children.includes('baselineStatusQuery')).props.onClick();
  h.commands[0].resolve(result('observed_equal', 'later')); await query;
  assert.ok(JSON.stringify(h.render()).includes('baselineStatus_observed_equal'));
  tree = h.render({ list: { ...list, loading: true } });
  assert.ok(!JSON.stringify(tree).includes('baselineStatus_observed_equal')); assert.equal(nodes(tree, 'select')[0].props.value, '');
  tree = h.render({ list });
  nodes(tree, 'select')[0].props.onChange({ target: { value: 'partial' } }); tree = h.render();
  const pending = nodes(tree, 'button').find(node => node.children.includes('baselineStatusQuery')).props.onClick();
  nodes(tree, 'select')[0].props.onChange({ target: { value: '' } });
  h.commands[1].resolve(result('observed_equal', 'partial')); await pending;
  assert.ok(!JSON.stringify(h.render()).includes('baselineStatus_observed_equal'));
  const body = fn('BaselineStatusPanel', '        ');
  assert.doesNotMatch(body, /setDraft|setDirty|unsettled|setGitBaseline|setApprovalBaseline|mutate\(/);
  assert.ok(source.includes('h(BaselineStatusPanel, { change, list: gitList, command, refresh: refreshGitObservations, busy })'));
  h.unmount();
});
