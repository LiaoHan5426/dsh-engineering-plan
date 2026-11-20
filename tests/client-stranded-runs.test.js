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

const abandonmentEligible = actual('abandonmentEligible');
const abandonmentKey = actual('abandonmentKey');
const abandonmentHistory = actual('abandonmentHistory');
const strandedNotice = actual('strandedNotice', { abandonmentEligible });
const bindAbandonment = actual('bindAbandonment', { abandonmentKey });
const abandonmentPayload = actual('abandonmentPayload',
  { abandonmentEligible, abandonmentKey, abandonmentHistory });

const h = (type, props, ...children) => ({
  type, props: props || {}, children: children.flat(Infinity).filter((child) => child != null && child !== false),
});
const nodes = (tree) => (tree == null || typeof tree !== "object" ? [] : [tree, ...(tree.children || []).flatMap(nodes)]);
const texts = (tree) => nodes(tree).flatMap((node) => node.children.filter((child) => typeof child === 'string'));
const t = (key) => key;

const change = () => ({ id: 'change', revision: 9, planVersion: 2, history: [] });
const record = (patch = {}) => ({ changeId: 'change', runId: 'run', revision: 4, state: 'reserved', jobId: null, ...patch });
const form = (run = record(), patch = {}) => ({
  ...bindAbandonment({ key: abandonmentKey(change(), 'verification', run), reason: ' host was interrupted ', confirmed: true },
    change(), 'verification', run),
  ...patch,
});
const abandonment = () => ({ kind: 'run-abandoned', runKind: 'verification', runId: 'run', runRevision: 5,
  actor: { kind: 'user', id: 'human' }, reason: 'reviewed', at: '2026-11-20T03:00:00.000Z' });

test('only a never-started reservation is eligible for abandonment', () => {
  assert.equal(abandonmentEligible(record()), true);
  assert.equal(abandonmentEligible(record({ jobId: undefined })), true);
  for (const state of ['starting', 'running', 'cancelled', 'succeeded', 'failed', 'timed_out', 'error', 'unknown', undefined])
    assert.equal(abandonmentEligible(record({ state })), false, state);
  assert.equal(abandonmentEligible(record({ jobId: 'job-1' })), false);
  assert.equal(abandonmentEligible(record({ jobId: '' })), false);
  assert.equal(abandonmentEligible(null), false);

  assert.equal(strandedNotice(record()), 'abandonRun');
  assert.equal(strandedNotice(record({ state: 'starting' })), 'strandedNeedsEvidence');
  assert.equal(strandedNotice(record({ state: 'running' })), 'strandedNeedsEvidence');
  assert.equal(strandedNotice(record({ jobId: 'job-1' })), '');
  assert.equal(strandedNotice(record({ state: 'cancelled' })), '');
  assert.equal(strandedNotice(null), '');
});

test('the submit payload carries the strict human fields and no actor', () => {
  const payload = abandonmentPayload(change(), 'verification', record(), form());
  assert.deepEqual(payload, {
    action: 'abandonRun', changeId: 'change', kind: 'verification', runId: 'run',
    expectedRevision: 9, expectedRunRevision: 4, reason: 'host was interrupted',
  });
  assert.deepEqual(Object.keys(payload).sort(),
    ['action', 'changeId', 'expectedRevision', 'expectedRunRevision', 'kind', 'reason', 'runId']);
  assert.ok(!('actor' in payload));
  const dispatchForm = bindAbandonment({ key: abandonmentKey(change(), 'dispatch', record()), reason: ' note ', confirmed: true },
    change(), 'dispatch', record());
  assert.equal(abandonmentPayload(change(), 'dispatch', record(), dispatchForm).kind, 'dispatch');
});

test('the payload is withheld for every unsafe abandonment edit', () => {
  const resolved = change();
  resolved.history = [abandonment()];
  const draft = (run, patch = {}) => bindAbandonment({ ...form(run), ...patch }, change(), 'verification', run);

  const cases = [
    ['blank reason', change(), 'verification', record(), draft(record(), { reason: '   ' })],
    ['unconfirmed', change(), 'verification', record(), draft(record(), { confirmed: false })],
    ['no draft', change(), 'verification', record(), undefined],
    ['stale key', change(), 'verification', record(), form(record({ revision: 3 }))],
    ['invalid kind', change(), 'other', record(), form()],
    ['starting run', change(), 'verification', record({ state: 'starting' }), draft(record({ state: 'starting' }))],
    ['running run', change(), 'verification', record({ state: 'running' }), draft(record({ state: 'running' }))],
    ['started run', change(), 'verification', record({ jobId: 'job-1' }), draft(record({ jobId: 'job-1' }))],
    ['already abandoned', resolved, 'verification', record({ revision: 5 }), form(record({ revision: 5 }))],
    ['other change', change(), 'verification', record({ changeId: 'other' }), form()],
    ['no change', undefined, 'verification', record(), form()],
    ['no record', change(), 'verification', undefined, form()],
  ];
  for (const [label, state, kind, run, candidate] of cases)
    assert.equal(abandonmentPayload(state, kind, run, candidate), null, label);

  // A key typed against another revision never authorizes this record.
  const rebound = bindAbandonment(form(record({ revision: 3 })), change(), 'verification', record({ revision: 4 }));
  assert.equal(rebound.reason, ' host was interrupted ');
  assert.equal(rebound.confirmed, false);
  assert.equal(abandonmentPayload(change(), 'verification', record(), rebound), null);
});

test('abandonment history only matches the exact run revision and human actor', () => {
  const state = change();
  state.history = [abandonment()];
  assert.equal(abandonmentHistory(state, 'verification', record({ revision: 5 })), state.history[0]);
  for (const patch of [{ runRevision: 4 }, { runId: 'other' }, { runKind: 'dispatch' },
    { kind: 'dispatch-unknown-resolved' }, { actor: { kind: 'agent', id: 'model' } }]) {
    const history = [{ ...abandonment(), ...patch }];
    assert.equal(abandonmentHistory({ ...state, history }, 'verification', record({ revision: 5 })), undefined);
  }
  assert.equal(abandonmentHistory(change(), 'verification', record()), undefined);
});

test('abandonment copy exists in Chinese and English for every new label', () => {
  const keys = ['abandonRun', 'abandonReason', 'abandonConfirm', 'abandonHint', 'abandonedRecorded',
    'abandonActor', 'abandonAt', 'strandedNeedsEvidence'];
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
});

test('the abandonment form is disabled until the human describes and confirms it', () => {
  const form = extract('abandonmentForm', '          ');
  assert.ok(form.includes('abandonmentPayload(change, kind, record, form)'));
  assert.ok(/button\(\s*"abandonRun",\s*\(\)\s*=>\s*guarded\(\(\)\s*=>\s*abandonRun\(kind, record\)\),\s*disabled \|\| !abandonmentPayload\(change, kind, record, form\)/.test(form));
  assert.ok(form.includes('field("abandonReason"'));
  assert.ok(form.includes('type: "checkbox"'));
  assert.ok(form.includes('t("abandonConfirm")'));
  assert.ok(form.includes('t("abandonHint")'));
  // No automatic submission path: the only call site is the human button handler.
  const calls = source.match(/=> abandonRun\(kind, record\)/g) || [];
  assert.equal(calls.length, 1);
  assert.ok(!/useEffect[\s\S]{0,200}abandonRun/.test(source));
  assert.ok(!/mutate\("abandonRun"/.test(source));
});

test('starting and running runs show the termination-evidence hint and no submit button', () => {
  const view = actual('strandedNoticeView', {
    h, t, strandedNotice, abandonmentHistory, change: change(),
    abandonmentSummary: (entry) => h('div', { className: 'ep-section' }, 'summary', entry.reason),
    abandonmentForm: (kind, run) => h('form', { 'data-run': run.runId }, 'form'),
  }, '          ');
  for (const state of ['starting', 'running']) {
    const tree = view(record({ state }), false, 'verification');
    assert.equal(tree.type, 'p');
    assert.equal(tree.props.className, 'ep-warn');
    assert.deepEqual(texts(tree), ['strandedNeedsEvidence']);
    assert.deepEqual(nodes(tree).filter((node) => node.type === 'button'), []);
    assert.deepEqual(nodes(tree).filter((node) => node.type === 'form'), []);
  }
  // Only an eligible reservation renders the form, and only when no abandonment is recorded yet.
  const eligible = view(record(), false, 'verification');
  assert.equal(eligible.type, 'form');
  assert.equal(view(record({ jobId: 'job-1' }), false, 'verification'), null);
  assert.equal(view(record({ state: 'cancelled' }), false, 'verification'), null);
  const state = change();
  state.history = [abandonment()];
  const recorded = actual('strandedNoticeView', {
    h, t, strandedNotice, abandonmentHistory, change: state,
    abandonmentSummary: (entry) => h('div', { className: 'ep-section' }, 'summary', entry.reason),
    abandonmentForm: () => h('form', null, 'form'),
  }, '          ')(record({ revision: 5 }), false, 'verification');
  assert.equal(recorded.type, 'div');
  assert.deepEqual(texts(recorded), ['summary', 'reviewed']);
});

test('both run panels mount the stranded notice beside the existing resolution block', () => {
  assert.ok(extract('dispatchRunsView', '          ')
    .includes('strandedNoticeView(record, list.loading || list.stale || !!list.error, "dispatch")'));
  const verification = extract('verificationRunsView', '          ');
  assert.ok(verification.includes('strandedNoticeView(record, busy, "verification")'));
  // Existing structure and class names are untouched.
  assert.ok(verification.includes('className: \'ep-grid\''));
  assert.ok(extract('dispatchRunsView', '          ').includes('expiredDispatchDraftsView(list)'));
});
