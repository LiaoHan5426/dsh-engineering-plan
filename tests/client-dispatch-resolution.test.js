import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
function extract(name, indent = '    ', async = false) {
  const start = source.indexOf(`${indent}${async ? 'async ' : ''}function ${name}(`);
  assert.ok(start >= 0, name);
  const end = source.indexOf(`\n${indent}}`, start) + indent.length + 2;
  return source.slice(start, end).trim();
}
function actual(name, bindings = {}, indent = '    ', async = false) {
  return Function(...Object.keys(bindings), `return (${extract(name, indent, async)});`)(...Object.values(bindings));
}
const dispatchResolutionKey = actual('dispatchResolutionKey');
const dispatchResolutionHistory = actual('dispatchResolutionHistory');
const dispatchResolutionPayload = actual('dispatchResolutionPayload');
const resetDispatchConfirmations = actual('resetDispatchConfirmations');
const acceptRunsFor = actual('acceptRunsFor');
const dispatchRequestBlock = actual('dispatchRequestBlock');
const change = () => ({ id: 'change', revision: 9, planVersion: 2, history: [],
  approvals: [{ actor: { kind: 'user' }, planVersion: 2 }], tasks: [{ id: 'task', status: 'pending', dependencies: [] }] });
const record = (runId = 'run') => ({ changeId: 'change', runId, revision: 4, state: 'unknown' });
const form = (run = record()) => ({ key: dispatchResolutionKey(change(), run), reason: ' reason ', basis: ' inspected ',
  references: ' first\r\n\n second \n', confirmed: true });
const resolution = () => ({ kind: 'dispatch-unknown-resolved', runId: 'run', runRevision: 4, actor: { kind: 'user', id: 'human' },
  reason: 'reviewed', recordedAt: 'recorded', terminationEvidence: { basis: 'inspected', checkedAt: 'checked', references: ['note'] } });

test('exact human history unblocks only matching unknown; active and future states always block', () => {
  const c = change(); c.history = [resolution()];
  const check = (r = record(), history = c.history) => dispatchRequestBlock({ ...c, history }, 'task',
    { changeId: c.id, runs: [r], stale: false, loading: false, error: '' }, false);
  assert.equal(check(), '');
  assert.equal(dispatchResolutionHistory(c, record()), c.history[0]);
  for (const patch of [{ kind: 'verification-unknown-resolved' }, { runId: 'other' }, { runRevision: 3 }, { actor: { kind: 'agent' } }]) {
    const history = [{ ...resolution(), ...patch }];
    assert.equal(check(record(), history), 'dispatchRunBlocked');
    assert.equal(dispatchResolutionHistory({ ...c, history }, record()), undefined);
  }
  for (const state of ['reserved', 'starting', 'running', 'future-state', undefined])
    assert.equal(check({ ...record(), state }), 'dispatchRunBlocked');
  assert.equal(check({ ...record(), changeId: 'other' }), 'dispatchRunBlocked');
});

test('payload requires manual fields and binds exact run/change revisions; references split real newlines', () => {
  const c = change(), r = record(), f = form();
  assert.deepEqual(dispatchResolutionPayload(c, r, f, 'time'), {
    action: 'resolveDispatchUnknown', changeId: 'change', expectedRevision: 9, runId: 'run', expectedRunRevision: 4,
    reason: 'reason', terminationEvidence: { confirmed: true, checkedAt: 'time', scope: 'child-and-descendants-and-processes', basis: 'inspected', references: ['first', 'second'] },
  });
  for (const patch of [{ reason: ' ' }, { basis: '' }, { confirmed: false }, { confirmed: 'true' }, { key: 'old' }])
    assert.equal(dispatchResolutionPayload(c, r, { ...f, ...patch }, 'time'), null);
  for (const patch of [{ revision: 5 }, { revision: 0 }, { revision: '4' }, { changeId: 'other' }, { runId: 'other' }, { state: 'running' }])
    assert.equal(dispatchResolutionPayload(c, { ...r, ...patch }, f, 'time'), null);
  assert.equal(dispatchResolutionPayload({ ...c, id: 'other' }, r, f, 'time'), null);
  assert.equal(dispatchResolutionPayload({ ...c, history: [resolution()] }, r, f, 'time'), null);
  assert.equal(dispatchResolutionPayload({ ...c, revision: 10 }, r, f, 'time').expectedRevision, 10);
  assert.deepEqual(dispatchResolutionPayload(c, r, { ...f, references: '' }, 'time').terminationEvidence.references, []);
});

test('refresh and restore revoke every prior checkbox while retaining independent runtime text', () => {
  const first = form(), second = form(record('second'));
  const original = { [first.key]: first, [second.key]: second };
  const reset = resetDispatchConfirmations(original);
  for (const [key, value] of Object.entries(reset)) {
    assert.equal(value.confirmed, false);
    assert.deepEqual(value, { ...original[key], confirmed: false });
  }
  assert.equal(original[first.key].confirmed, true);
  assert.equal(resetDispatchConfirmations(reset), reset);
  assert.ok(source.includes('setDispatchResolution(resetDispatchConfirmations);\n          }, [dispatchList])'));
  assert.ok(source.includes('setDispatchResolution(resetDispatchConfirmations(cached.dispatchResolution))'));
});

function handlerHarness(patch = {}) {
  const r = record(), other = record('other');
  let forms = { [form(r).key]: form(r), [form(other).key]: form(other) };
  const calls = [], loads = [];
  const bindings = { busy: false, unsettled: false, change: change(), dispatchList: { changeId: 'change', runs: [r], loading: false, stale: false, error: '' },
    dispatchResolution: forms, dispatchResolutionKey, dispatchResolutionPayload, mounted: { current: true },
    command: async input => { calls.push(input); return { change: { ...change(), revision: 10, history: [resolution()] } }; },
    loadChange: (...args) => loads.push(args), setDispatchResolution: update => { forms = update(forms); },
    setNotice: () => {}, t: key => key, list: async () => {}, ...patch };
  return { r, calls, loads, get forms() { return forms; }, submit: actual('resolveDispatchUnknown', bindings, '          ', true) };
}

test('actual human submit uses command only, timestamp and CAS; clears only the submitted form', async () => {
  const h = handlerHarness(); const other = h.forms[form(record('other')).key];
  await h.submit(h.r);
  assert.equal(h.calls.length, 1);
  const payload = h.calls[0];
  assert.deepEqual(payload, dispatchResolutionPayload(change(), h.r, form(), payload.terminationEvidence.checkedAt));
  assert.equal(new Date(payload.terminationEvidence.checkedAt).toISOString(), payload.terminationEvidence.checkedAt);
  assert.equal(h.forms[form().key], undefined);
  assert.equal(h.forms[other.key], other);
  assert.deepEqual(h.loads[0][1], { preserveRuntime: true, submitted: 'resolveDispatchUnknown' });
  const command = extract('command', '          ', true);
  assert.ok(command.includes('ctx.remote.commands.execute('));
  assert.ok(command.includes('"/engineering " + JSON.stringify(input)'));
});

test('actual handler fails closed on stale data, disabled state and changed run; errors retain forms', async () => {
  for (const patch of [{ busy: true }, { unsettled: true }, { dispatchList: { changeId: 'change', runs: [], stale: false } },
    { dispatchList: { changeId: 'other' } }, { dispatchList: { changeId: 'change', stale: true } },
    { dispatchList: { changeId: 'change', loading: true } }, { dispatchList: { changeId: 'change', error: 'offline' } }]) {
    const h = handlerHarness(patch); await h.submit(h.r); assert.deepEqual(h.calls, []);
  }
  const h = handlerHarness({ command: async () => { throw new Error('REVISION_CONFLICT'); } });
  const before = h.forms;
  await assert.rejects(h.submit(h.r), /REVISION_CONFLICT/);
  assert.equal(h.forms, before); assert.deepEqual(h.loads, []);
});

const element = (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter(x => x != null && x !== false) });
function nodes(tree) { return typeof tree === 'object' && tree ? [tree, ...tree.children.flatMap(nodes)] : []; }
function texts(tree) { return typeof tree === 'object' && tree ? tree.children.map(texts).join(' ') : String(tree); }
function formHarness() {
  const c = change(), r = record(); let forms = {};
  const render = () => actual('dispatchResolutionForm', { change: c, busy: false, unsettled: false, dispatchResolution: forms,
    dispatchResolutionKey, dispatchResolutionPayload, setDispatchResolution: update => { forms = update(forms); },
    h: element, t: key => key, field: (label, value, onChange) => element('textarea', { label, value, onChange }),
    button: (label, onClick, disabled) => element('button', { label, onClick, disabled }), run: fn => fn(), resolveDispatchUnknown: () => {} }, '          ')(r, { loading: false, stale: false, error: '' });
  return { render, get forms() { return forms; } };
}
test('actual rendered form requires reason plus basis plus checkbox and keeps references per run', () => {
  const h = formHarness();
  const find = type => nodes(h.render()).filter(n => n.type === type);
  const disabled = () => find('button')[0].props.disabled;
  assert.equal(disabled(), true);
  find('textarea')[0].props.onChange('why'); assert.equal(disabled(), true);
  find('textarea')[1].props.onChange('checked child, descendants and processes'); assert.equal(disabled(), true);
  find('input')[0].props.onChange({ target: { checked: true } }); assert.equal(disabled(), false);
  find('textarea')[2].props.onChange('ref one\nref two');
  assert.equal(h.forms[form().key].references, 'ref one\nref two');
  find('textarea')[0].props.onChange('  '); assert.equal(disabled(), true);
});

test('resolution summary renders human, times, basis and references as text; history includes dispatch resolutions', () => {
  const summary = actual('dispatchResolutionSummary', { h: element, t: key => key }, '          ');
  const tree = summary(resolution()); const text = texts(tree);
  for (const value of ['human', 'recorded', 'checked', 'inspected', 'note', 'reviewed']) assert.ok(text.includes(value));
  const resources = extract('resourcesView', '          ');
  assert.ok(resources.includes('entry.kind === "dispatch-unknown-resolved"'));
  assert.ok(resources.includes('dispatchResolutionSummary(entry)'));
});

test('navigation guard includes dispatch runtime drafts independently from plan dirty state', () => {
  const start = source.indexOf('          const runtimeDirty =');
  const end = source.indexOf('          const edit =', start);
  const expression = source.slice(start, end).trim().replace(/^const runtimeDirty =\s*/, '').replace(/;$/, '');
  const dirty = forms => Function('transitionDirty', 'evidenceDirty', 'delivery', 'resolution', 'dispatchResolution',
    'cancelRunningDirty', 'cancelRunning', 'abandonmentDirty', 'abandonment', 'termination', 'change', `return (${expression});`)(
    false, false, {}, {}, forms, () => false, {}, () => false, {}, {}, { id: 'change' });
  for (const value of [{ reason: 'r' }, { basis: 'b' }, { references: 'ref' }, { confirmed: true }]) assert.equal(dirty({ run: value }), true);
  assert.equal(dirty({}), false);
  let pending = 0, runs = 0;
  actual('guarded', { unsettled: false, runtimeDirty: dirty({ run: { basis: 'b' } }), setPending: () => pending++, run: () => runs++ }, '          ')(() => {});
  assert.equal(pending, 1); assert.equal(runs, 0);
});

test('actual loadChange after dispatch resolution preserves all unrelated runtime inputs', () => {
  const start = source.indexOf('          const loadChange = ');
  const end = source.indexOf('          async function command(', start);
  const expression = source.slice(start, end).trim().replace(/^const loadChange = /, '').replace(/;$/, '');
  const touched = [];
  const setters = [...new Set(expression.match(/set[A-Z]\w+/g))];
  let delivery = { note: 'keep delivery', confirmed: true, changeId: 'change', planVersion: 2 };
  const values = setters.map(name => name === 'setDelivery' ? update => { delivery = update(delivery); }
    : () => { touched.push(name); });
  const load = Function('normalize', 'clone', 'bindDelivery', ...setters, `return (${expression});`)(
    x => x, structuredClone, actual('bindDelivery'), ...values);
  load({ ...change(), revision: 10 }, { preserveRuntime: true, submitted: 'resolveDispatchUnknown' });
  for (const name of ['setResolution', 'setDispatchResolution', 'setEvidence', 'setTransition', 'setCommandChoice', 'setRequestTaskId', 'setVerificationRuns'])
    assert.equal(touched.includes(name), false, name);
  assert.equal(delivery.note, 'keep delivery'); assert.equal(delivery.confirmed, true);
});

const expiredDispatchDrafts = actual('expiredDispatchDrafts', { dispatchResolutionHistory });
const dispatchListState = actual('dispatchListState');

test('successful dispatch refresh exposes old revision, terminal and missing drafts without deleting text', () => {
  const c = change(), r = record(), other = record('other');
  const first = form(r), second = form(other);
  const foreign = { ...form(), key: JSON.stringify(['foreign', 'run', 4]) };
  const forms = { [first.key]: first, [second.key]: second, [foreign.key]: foreign };
  const before = structuredClone(forms);
  for (const nextRuns of [[{ ...r, revision: 5 }, other], [{ ...r, state: 'returned' }, other], [other]]) {
    let list = { changeId: c.id, runs: [r, other], requestId: 1 };
    list = dispatchListState(list, { type: 'success', changeId: c.id, requestId: 1, runs: nextRuns });
    const reset = resetDispatchConfirmations(forms);
    const expired = expiredDispatchDrafts(c, list, reset);
    assert.deepEqual(expired.map(item => item.key), [first.key]);
    assert.equal(expired[0].form.reason, first.reason);
    assert.equal(expired[0].form.basis, first.basis);
    assert.equal(expired[0].form.references, first.references);
    assert.equal(expired[0].form.confirmed, false);
    assert.equal(reset[second.key].reason, second.reason);
    assert.equal(reset[foreign.key].reason, foreign.reason);
  }
  const resolved = expiredDispatchDrafts({ ...c, history: [resolution()] }, { changeId: c.id, runs: [r, other] }, forms);
  assert.deepEqual(resolved.map(item => item.key), [first.key]);
  assert.deepEqual(forms, before);
});

test('failed dispatch refresh retains visible and expired text and does not classify another change', async () => {
  const c = change(), r = record(), f = form();
  let forms = { [f.key]: f };
  let list = { changeId: c.id, runs: [r], stale: false, loading: false, error: '' };
  const refresh = actual('refreshDispatchRuns', { change: c, dispatchSequence: { current: 0 },
    setDispatchList: update => { list = update(list); forms = resetDispatchConfirmations(forms); },
    dispatchListState, command: async () => { throw new Error('offline'); }, mounted: { current: true }, t: key => key }, '          ', true);
  await refresh();
  assert.equal(list.stale, true); assert.equal(list.error, 'offline');
  assert.deepEqual(forms[f.key], { ...f, confirmed: false });
  assert.deepEqual(expiredDispatchDrafts(c, list, forms), []);
  assert.deepEqual(expiredDispatchDrafts({ ...c, id: 'foreign' }, list, forms), []);
  assert.deepEqual(expiredDispatchDrafts(c, { ...list, runs: null }, forms), []);
});

test('expired draft view copies exact backup and explicit discard removes only that draft', () => {
  const c = change(), old = form(), other = form(record('other'));
  const foreign = { ...form(), key: JSON.stringify(['foreign', 'run', 4]) };
  let forms = { [old.key]: old, [other.key]: other, [foreign.key]: foreign };
  const copies = [];
  const render = () => actual('expiredDispatchDraftsView', { change: c, dispatchResolution: forms,
    expiredDispatchDrafts, h: element, t: key => key,
    button: (label, onClick) => element('button', { label, onClick }), copy: text => copies.push(JSON.parse(text)),
    setDispatchResolution: update => { forms = update(forms); } }, '          ')({ changeId: c.id, runs: [record('other')] });
  const tree = render();
  for (const value of ['reason', 'inspected', 'first', 'second']) assert.ok(texts(tree).includes(value));
  const controls = nodes(tree).filter(node => node.type === 'button');
  controls.find(node => node.props.label === 'copyDraft').props.onClick();
  assert.equal(copies[0].reason, old.reason); assert.equal(copies[0].runRevision, 4);
  controls.find(node => node.props.label === 'dispatchDiscardDraft').props.onClick();
  assert.equal(forms[old.key], undefined);
  assert.equal(forms[other.key], other); assert.equal(forms[foreign.key], foreign);
  assert.equal(render(), null);
  assert.ok(extract('dispatchRunsView', '          ').includes('expiredDispatchDraftsView(list)'));
});

const bindVerificationResolution = actual('bindVerificationResolution');
test('verification confirmation binds change/run/revision and never trusts legacy cache', () => {
  const c = change(), r = record();
  const bound = bindVerificationResolution({ reason: 'keep', confirmed: true }, c, r);
  assert.equal(bound.confirmed, false); assert.equal(bound.reason, 'keep');
  const confirmed = { ...bound, confirmed: true };
  assert.equal(bindVerificationResolution(confirmed, c, r).confirmed, true);
  for (const next of [{ ...r, revision: 5 }, { ...r, runId: 'other' }]) {
    const result = bindVerificationResolution(confirmed, c, next);
    assert.equal(result.confirmed, false); assert.equal(result.reason, 'keep');
  }
  assert.equal(bindVerificationResolution(confirmed, { ...c, id: 'foreign' }, r).confirmed, false);
  assert.ok(source.includes("setResolution(resetDispatchConfirmations('runId' in cached.resolution"));
});

test('actual verification refresh revokes confirmation on same revision, new revision and errors while retaining text', async () => {
  const c = change(), r = record();
  const first = { ...bindVerificationResolution({ reason: 'first' }, c, r), confirmed: true };
  const second = { ...bindVerificationResolution({ reason: 'second' }, c, record('other')), confirmed: true };
  for (const result of [[r], [{ ...r, revision: 5 }], new Error('offline')]) {
    let forms = { run: first, other: second }, runs = [r];
    const refresh = actual('refreshRuns', { change: c, setResolution: update => { forms = update(forms); },
      resetDispatchConfirmations, mounted: { current: true }, setVerificationRuns: value => { runs = value; },
      acceptRunsFor, liveState: { current: { change: c } },
      command: async () => { if (result instanceof Error) throw result; return { runs: result }; } }, '          ', true);
    if (result instanceof Error) await assert.rejects(refresh(), /offline/); else await refresh();
    // A failed request keeps the tick the human already made; a landed answer revokes stale confirmations.
    assert.deepEqual(forms, result instanceof Error
      ? { run: first, other: second }
      : { run: { ...first, confirmed: false }, other: { ...second, confirmed: false } });
    assert.deepEqual(runs, result instanceof Error ? [r] : result);
  }
});

test('actual verification submit checks bound identity and clears only its successful run', async () => {
  const c = change(), r = record(), confirmed = { ...bindVerificationResolution({ reason: 'checked' }, c, r), confirmed: true };
  for (const patch of [{ key: 'legacy' }, { key: JSON.stringify([c.id, r.runId, 3]) }, { confirmed: false }, {}]) {
    let forms = { run: { ...confirmed, ...patch }, other: { reason: 'retain', confirmed: true } };
    const other = forms.other; const calls = [];
    const submit = actual('resolveVerificationUnknown', { change: c, resolution: forms, bindVerificationResolution,
      busy: false, unsettled: false, verificationRuns: [r], mounted: { current: true },
      mutate: async (...args) => { calls.push(args); }, setResolution: update => { forms = update(forms); } }, '          ', true);
    await submit(r);
    if (Object.keys(patch).length) { assert.deepEqual(calls, []); assert.ok(forms.run); }
    else { assert.deepEqual(calls, [['resolveUnknown', { runId: r.runId, expectedRunRevision: 4, reason: 'checked' }]]); assert.equal(forms.run, undefined); }
    assert.equal(forms.other, other);
  }
});
