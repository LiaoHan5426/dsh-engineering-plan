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

const runsHostInstance = actual('runsHostInstance');
const cancelRunningEligible = actual('cancelRunningEligible');
const cancelRunningKey = actual('cancelRunningKey');
const bindCancelRunning = actual('bindCancelRunning', { cancelRunningKey });
const cancelRunningPayload = actual('cancelRunningPayload', { cancelRunningEligible, cancelRunningKey });
const cancelRunErrorKey = actual('cancelRunErrorKey');
const cancelRunningDirty = actual('cancelRunningDirty');
const cancelRunningPrune = actual('cancelRunningPrune', {
  cancelRunningEligible, runsHostInstance,
});

const h = (type, props, ...children) => ({
  type, props: props || {}, children: children.flat(Infinity).filter((child) => child != null && child !== false),
});
const nodes = (tree) => (tree == null || typeof tree !== 'object' ? [] : [tree, ...(tree.children || []).flatMap(nodes)]);
const texts = (tree) => nodes(tree).flatMap((node) => node.children.filter((child) => typeof child === 'string'));
const t = (key) => key;
const field = (label, value, onChange, options = {}) =>
  h('label', { 'data-field': label, 'data-multiline': options.multiline === true ? 'yes' : 'no' }, t(label), value);
const button = (label, onClick, disabled) => h('button', { onClick, disabled: disabled === true }, label);

const HOST = 'host-a';
const change = () => ({ id: 'change', revision: 9, planVersion: 2, history: [] });
const record = (patch = {}) => ({
  changeId: 'change', runId: 'run', revision: 4, state: 'running', jobId: 'job-1', hostInstanceId: HOST, ...patch,
});
const draft = (run = record(), patch = {}, kind = 'verification') => ({
  ...bindCancelRunning({ key: cancelRunningKey(change(), kind, run), reason: ' runaway process ', confirmed: true },
    change(), kind, run),
  ...patch,
});

test('only a live run with its own job on this page host is stoppable', () => {
  for (const state of ['starting', 'running'])
    assert.equal(cancelRunningEligible(record({ state }), HOST), true, state);
  const refused = [
    record({ state: 'reserved', jobId: null }),
    record({ state: 'reserved' }),
    record({ state: 'cancelled' }),
    record({ state: 'succeeded' }),
    record({ state: 'failed' }),
    record({ state: 'unknown' }),
    record({ jobId: null }),
    record({ jobId: '' }),
    record({ jobId: 7 }),
    record({ hostInstanceId: 'host-b' }),
    record({ hostInstanceId: '' }),
    record({ hostInstanceId: undefined }),
  ];
  for (const run of refused) assert.equal(cancelRunningEligible(run, HOST), false, JSON.stringify(run));
  assert.equal(cancelRunningEligible(null, HOST), false);
  assert.equal(cancelRunningEligible(record(), ''), false);
  assert.equal(cancelRunningEligible(record(), undefined), false);
});

test('the page host stands in for the newest loaded record and never leaks a stale instance', () => {
  const older = record({ runId: 'a', createdAt: '2026-11-20T01:00:00.000Z' });
  const newer = record({ runId: 'b', createdAt: '2026-11-20T02:00:00.000Z', hostInstanceId: 'host-b' });
  assert.equal(runsHostInstance([older, newer]), 'host-b');
  assert.equal(runsHostInstance([newer, older]), 'host-b');
  assert.equal(runsHostInstance([record({ runId: 'x', createdAt: undefined }),
    record({ runId: 'y', createdAt: undefined })]), HOST);
  assert.equal(runsHostInstance([record({ hostInstanceId: '' })]), '');
  for (const value of [null, undefined, [], 'records', {}]) assert.equal(runsHostInstance(value), '');
  // A record from another instance is not stoppable even when it is the newest one in the list.
  assert.equal(cancelRunningEligible(older, runsHostInstance([older, newer])), false);
});

test('the submit payload is exactly the Host cancelRun command', () => {
  const payload = cancelRunningPayload(change(), 'verification', record(), draft(), HOST);
  assert.deepEqual(payload, {
    action: 'cancelRun', changeId: 'change', kind: 'verification', runId: 'run', reason: 'runaway process',
  });
  assert.deepEqual(Object.keys(payload).sort(), ['action', 'changeId', 'kind', 'reason', 'runId']);
  // The Host rejects unknown keys, so no revision, actor or host id may travel with it.
  for (const key of ['expectedRevision', 'expectedRunRevision', 'actor', 'hostInstanceId', 'jobId'])
    assert.ok(!(key in payload), key);
  const dispatch = cancelRunningPayload(change(), 'dispatch', record(),
    draft(record(), {}, 'dispatch'), HOST);
  assert.equal(dispatch.kind, 'dispatch');
});

test('the payload is withheld for every unconfirmed or unsafe stop', () => {
  const cases = [
    ['blank reason', change(), 'verification', record(), { ...draft(), reason: '   ' }, HOST],
    ['unconfirmed', change(), 'verification', record(), { ...draft(), confirmed: false }, HOST],
    ['no draft', change(), 'verification', record(), undefined, HOST],
    ['stale key', change(), 'verification', record(), draft(record({ runId: 'other' })), HOST],
    ['invalid kind', change(), 'other', record(), draft(), HOST],
    ['reserved run', change(), 'verification', record({ state: 'reserved', jobId: null }),
      draft(record({ state: 'reserved', jobId: null })), HOST],
    ['terminal run', change(), 'verification', record({ state: 'cancelled' }),
      draft(record({ state: 'cancelled' })), HOST],
    ['without jobId', change(), 'verification', record({ jobId: null }), draft(record({ jobId: null })), HOST],
    ['foreign host', change(), 'verification', record({ hostInstanceId: 'host-b' }),
      draft(record({ hostInstanceId: 'host-b' })), HOST],
    ['no page host', change(), 'verification', record(), draft(), ''],
    ['other change', change(), 'verification', record({ changeId: 'other' }),
      draft(record({ changeId: 'other' })), HOST],
    ['no change', undefined, 'verification', record(), draft(), HOST],
    ['no record', change(), 'verification', undefined, draft(), HOST],
  ];
  for (const [label, state, kind, run, form, pageHost] of cases)
    assert.equal(cancelRunningPayload(state, kind, run, form, pageHost), null, label);
});

test('a typed reason survives the runner revision bump of the same run', () => {
  const typed = bindCancelRunning({ key: cancelRunningKey(change(), 'verification', record()), reason: ' typed ', confirmed: true },
    change(), 'verification', record());
  const bumped = bindCancelRunning(typed, change(), 'verification', record({ revision: 5, state: 'running' }));
  assert.equal(bumped.reason, ' typed ');
  assert.equal(bumped.confirmed, true);
  // The key still belongs to another run only through its runId, never through the revision.
  assert.equal(cancelRunningKey(change(), 'verification', record()), cancelRunningKey(change(), 'verification', record({ revision: 5 })));
  assert.notEqual(cancelRunningKey(change(), 'verification', record()), cancelRunningKey(change(), 'dispatch', record()));
  assert.notEqual(cancelRunningKey(change(), 'verification', record()), cancelRunningKey(change(), 'verification', record({ runId: 'other' })));
});

test('the form appears only for a live run and shows the two gates, error and copy', () => {
  const view = actual('cancelRunningView', {
    h, t, field, button, change: change(), busy: false,
    cancelRunning: { [cancelRunningKey(change(), 'verification', record())]: draft() },
    cancelErrors: {},
    setCancelRunning: () => {},
    cancelRunningPageHost: () => HOST,
    cancelRunningEligible, cancelRunningKey, bindCancelRunning, cancelRunningPayload,
    submitCancelRunning: () => {},
  }, '          ');

  const tree = view(record(), false, 'verification');
  assert.equal(tree.type, 'details');
  assert.deepEqual(texts(tree), [
    'cancelRunningTitle', 'cancelRunningTruth', 'cancelRunningReason', ' runaway process ',
    'cancelRunningConfirm', 'cancelRunningSubmit',
  ]);
  const [summary] = nodes(tree).filter((node) => node.type === 'summary');
  assert.deepEqual(texts(summary), ['cancelRunningTitle']);
  const [reason] = nodes(tree).filter((node) => node.type === 'label' && node.props['data-field'] === 'cancelRunningReason');
  assert.equal(reason.props['data-multiline'], 'yes');
  const [box] = nodes(tree).filter((node) => node.type === 'input');
  assert.equal(box.props.type, 'checkbox');
  assert.equal(box.props.checked, true);
  const [submit] = nodes(tree).filter((node) => node.type === 'button');
  assert.deepEqual(texts(submit), ['cancelRunningSubmit']);
  assert.equal(submit.props.disabled, false);

  // Double gate: neither the empty reason nor the unchecked box alone may submit.
  const blank = actual('cancelRunningView', {
    h, t, field, button, change: change(), busy: false,
    cancelRunning: { [cancelRunningKey(change(), 'verification', record())]: draft(record(), { reason: '' }) },
    cancelErrors: {}, setCancelRunning: () => {}, cancelRunningPageHost: () => HOST,
    cancelRunningEligible, cancelRunningKey, bindCancelRunning, cancelRunningPayload, submitCancelRunning: () => {},
  }, '          ');
  assert.equal(nodes(blank(record(), false, 'verification')).filter((node) => node.type === 'button')[0].props.disabled, true);
  const unchecked = actual('cancelRunningView', {
    h, t, field, button, change: change(), busy: false,
    cancelRunning: { [cancelRunningKey(change(), 'verification', record())]: draft(record(), { confirmed: false }) },
    cancelErrors: {}, setCancelRunning: () => {}, cancelRunningPageHost: () => HOST,
    cancelRunningEligible, cancelRunningKey, bindCancelRunning, cancelRunningPayload, submitCancelRunning: () => {},
  }, '          ');
  assert.equal(nodes(unchecked(record(), false, 'verification')).filter((node) => node.type === 'button')[0].props.disabled, true);

  // Failure text renders inside this run's form; reserved and terminal runs render nothing at all.
  const failing = actual('cancelRunningView', {
    h, t, field, button, change: change(), busy: false,
    cancelRunning: { [cancelRunningKey(change(), 'verification', record())]: draft() },
    cancelErrors: { [cancelRunningKey(change(), 'verification', record())]: 'ENGINEERING_RUN_NOT_RUNNING: settled' },
    setCancelRunning: () => {}, cancelRunningPageHost: () => HOST,
    cancelRunningEligible, cancelRunningKey, bindCancelRunning, cancelRunningPayload, submitCancelRunning: () => {},
  }, '          ');
  const alert = nodes(failing(record(), false, 'verification')).filter((node) => node.props.role === 'alert');
  assert.equal(alert.length, 1);
  assert.deepEqual(texts(alert[0]), ['ENGINEERING_RUN_NOT_RUNNING: settled']);

  assert.equal(view(record({ state: 'reserved', jobId: null }), false, 'verification'), null);
  assert.equal(view(record({ state: 'cancelled' }), false, 'verification'), null);
  assert.equal(view(record({ hostInstanceId: 'host-b' }), false, 'verification'), null);
});

test('a successful stop clears only its own draft and refreshes the list in view', async () => {
  const key = cancelRunningKey(change(), 'verification', record());
  const other = cancelRunningKey(change(), 'verification', record({ runId: 'other' }));
  const calls = { sent: [], notices: [], refresh: { verification: 0, dispatch: 0 }, errors: [] };
  let drafts = { [key]: draft(), [other]: draft(record({ runId: 'other' })) };
  const stop = actual('stopRunningRun', {
    change: change(), busy: false, mounted: { current: true }, t,
    cancelRunning: drafts,
    cancelRunningKey, bindCancelRunning, cancelRunningPayload, cancelRunErrorKey,
    cancelRunningPageHost: () => HOST,
    command: async (payload) => { calls.sent.push(payload); return { runId: 'run', kill: 'requested' }; },
    setCancelErrors: (update) => { calls.errors.push(update); },
    setCancelRunning: (update) => { drafts = update(drafts); },
    setNotice: (value) => calls.notices.push(value),
    refreshRuns: async () => { calls.refresh.verification += 1; },
    refreshDispatchRuns: async () => { calls.refresh.dispatch += 1; },
  }, '          ', true);

  await stop('verification', record());
  assert.deepEqual(calls.sent, [{ action: 'cancelRun', changeId: 'change', kind: 'verification', runId: 'run', reason: 'runaway process' }]);
  assert.deepEqual(Object.keys(drafts), [other]);
  assert.deepEqual(calls.notices, ['cancelRunningDone']);
  assert.deepEqual(calls.refresh, { verification: 1, dispatch: 0 });
});

test('a refused stop keeps the typed reason and shows the mapped or raw error', async () => {
  const key = cancelRunningKey(change(), 'verification', record());
  const run = async (message) => {
    const drafts = { [key]: draft() };
    const seen = { drafts, errors: [], refresh: 0, notices: [] };
    const stop = actual('stopRunningRun', {
      change: change(), busy: false, mounted: { current: true }, t,
      cancelRunning: drafts,
      cancelRunningKey, bindCancelRunning, cancelRunningPayload, cancelRunErrorKey,
      cancelRunningPageHost: () => HOST,
      command: async () => { throw new Error(message); },
      setCancelErrors: (update) => { seen.errors.push(update); },
      setCancelRunning: (update) => { seen.drafts = update(seen.drafts); },
      setNotice: (value) => seen.notices.push(value),
      refreshRuns: async () => { seen.refresh += 1; },
      refreshDispatchRuns: async () => { seen.refresh += 1; },
    }, '          ', true);
    await stop('verification', record());
    return seen;
  };

  const foreign = await run('ENGINEERING_RUN_FOREIGN_HOST: another host owns this job');
  assert.equal(foreign.drafts[key].reason, ' runaway process ');
  assert.deepEqual(Object.keys(foreign.drafts), [key]);
  const foreignState = foreign.errors.reduce((state, update) => update(state), {});
  assert.deepEqual(foreignState, { [key]: 'cancelRunningForeign' });
  assert.equal(foreign.refresh, 0);
  assert.deepEqual(foreign.notices, []);
  assert.equal(cancelRunErrorKey('ENGINEERING_RUN_FOREIGN_HOST: another host owns this job'), 'cancelRunningForeign');

  const raw = await run('ENGINEERING_RUN_NOT_RUNNING: settled');
  const rawState = raw.errors.reduce((state, update) => update(state), {});
  assert.deepEqual(rawState, { [key]: 'ENGINEERING_RUN_NOT_RUNNING: settled' });
  assert.equal(cancelRunErrorKey('ENGINEERING_RUN_NOT_RUNNING: settled'), '');
  assert.equal(raw.drafts[key].reason, ' runaway process ');
});

test('stop drafts pause polling for their own change and are pruned only once the run is dead', () => {
  const key = cancelRunningKey(change(), 'verification', record());
  assert.equal(cancelRunningDirty({ [key]: draft() }, 'change'), true);
  assert.equal(cancelRunningDirty({ [key]: draft() }, 'other'), false);
  assert.equal(cancelRunningDirty({ [key]: draft() }, undefined), false);
  assert.equal(cancelRunningDirty({ [key]: draft(record(), { reason: '', confirmed: false }) }, 'change'), false);
  assert.equal(cancelRunningDirty({}, 'change'), false);
  assert.equal(cancelRunningDirty(null, 'change'), false);
  assert.equal(cancelRunningDirty({ 'not-json': { reason: 'x' } }, 'change'), false);

  const live = { [key]: draft() };
  assert.equal(cancelRunningPrune(live, change(), [record()], { changeId: 'change', runs: [] }), live);
  // A list that has not answered yet never clears the draft.
  assert.equal(cancelRunningPrune(live, change(), null, { changeId: 'change', runs: null }), live);
  // Another change's draft is kept; it simply does not block this change.
  const foreign = cancelRunningKey({ id: 'other' }, 'verification', record({ changeId: 'other' }));
  const foreignDraft = bindCancelRunning({ key: foreign, reason: ' other ', confirmed: true },
    { id: 'other' }, 'verification', record({ changeId: 'other' }));
  const mixed = { [key]: draft(), [foreign]: foreignDraft };
  assert.deepEqual(Object.keys(cancelRunningPrune(mixed, change(), [record()], { changeId: 'change', runs: [] })), [key, foreign]);
  assert.equal(cancelRunningDirty(mixed, 'change'), true);
  assert.equal(cancelRunningDirty({ [foreign]: foreignDraft }, 'change'), false);
  // Once the run is loaded as terminal the hidden draft is dropped instead of freezing polling forever.
  assert.deepEqual(cancelRunningPrune(live, change(), [record({ state: 'cancelled' })], { changeId: 'change', runs: [] }), {});
  // A list whose newest record belongs to another instance makes this run foreign, so it is dropped too.
  const foreignPage = [record({ runId: 'newer', createdAt: '2026-11-20T02:00:00.000Z', hostInstanceId: 'host-b' }),
    record({ createdAt: '2026-11-20T01:00:00.000Z' })];
  assert.deepEqual(cancelRunningPrune(live, change(), foreignPage, { changeId: 'change', runs: [] }), {});
});

test('the stop copy exists in Chinese and English for every new label', () => {
  const keys = ['cancelRunningTitle', 'cancelRunningTruth', 'cancelRunningReason', 'cancelRunningConfirm',
    'cancelRunningSubmit', 'cancelRunningDone', 'cancelRunningForeign'];
  const cjk = /[\u4e00-\u9fff]/;
  for (const key of keys) {
    const match = source.match(new RegExp(`\\n {6}${key}: \\[\\s*"([^"]*)",\\s*"([^"]*)"\\s*,?\\s*\\]`));
    assert.ok(match, key);
    const [, zh, en] = match;
    assert.ok(zh.length >= 2 && en.length >= 2, key);
    assert.match(zh, cjk, key);
    assert.doesNotMatch(en, cjk, key);
    assert.notEqual(zh, en, key);
  }
  // 14-space indentation would make the coverage test read these keys as used but undefined.
  for (const key of keys) assert.ok(new RegExp(`\\n {6}${key}: \\[`).test(source), key);
  // The copy must state what stopping really does.
  const [, , english] = source.match(/\n {6}cancelRunningTruth: \[\s*"([^"]*)",\s*"([^"]*)"/);
  assert.ok(/jobs\.kill/.test(english));
  assert.ok(/cancelled/.test(english));
  assert.ok(/unchanged/.test(english));
});

test('both run panels mount the stop form and its gate is wired into the runtime drafts', () => {
  assert.ok(extract('dispatchRunsView', '          ')
    .includes('cancelRunningView(record, list.loading || list.stale || !!list.error, "dispatch")'));
  assert.ok(extract('verificationRunsView', '          ')
    .includes('cancelRunningView(record, busy, "verification")'));
  assert.ok(extract('cancelRunningView', '          ').includes('field("cancelRunningReason"'));
  assert.ok(extract('cancelRunningView', '          ')
    .includes('disabled || !cancelRunningPayload(change, kind, record, form, pageHost)'));

  // The draft participates in the existing unsaved-input protection and survives remounts.
  assert.ok(source.includes('cancelRunningDirty(cancelRunning, change?.id) ||'));
  assert.ok(source.includes('if (cached.cancelRunning) setCancelRunning(cached.cancelRunning);'));
  assert.ok(/}, \[change, draft, dirty, taskEdit, reference, transition, evidence, resolution, dispatchResolution, cancelRunning, abandonment, delivery\]\)/.test(source));
  assert.ok(/setCancelRunning\(\(previous\) => cancelRunningPrune\(previous, change, verificationRuns, dispatchList\)\)/.test(source));

  // The submit path must not raise the discard prompt for the reason the human just typed.
  const submit = extract('submitCancelRunning', '          ');
  assert.ok(submit.includes('if (unsettled) setPending(action);'));
  assert.ok(submit.includes('run(() => stopRunningRun(kind, record))'));
  assert.ok(!submit.includes('guarded('));
  // One human trigger only: no effect or mutate() path stops a run by itself.
  assert.equal((source.match(/=> submitCancelRunning\(kind, record\)/g) || []).length, 1);
  assert.ok(!/mutate\("cancelRun"/.test(source));
  assert.ok(!/useEffect[\s\S]{0,240}stopRunningRun/.test(source));
});
