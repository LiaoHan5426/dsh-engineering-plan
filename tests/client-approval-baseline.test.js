import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
function fn(name, indent = '    ', async = false) {
  const start = source.indexOf(`${indent}${async ? 'async ' : ''}function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf(`\n${indent}}`, start) + indent.length + 2).trim();
}
const helpers = Function(`${['approvalBaselineSelection', 'approvalBaselineCandidates', 'approvalBaselineBlock', 'approvalBaselineExtra', 'approvalBaselineLabel'].map(name => fn(name)).join('\n')}; return { approvalBaselineSelection, approvalBaselineCandidates, approvalBaselineBlock, approvalBaselineExtra, approvalBaselineLabel };`)();
const { approvalBaselineSelection, approvalBaselineCandidates, approvalBaselineBlock, approvalBaselineExtra, approvalBaselineLabel } = helpers;
const change = { id: 'a', revision: 7, planVersion: 2, approvals: [], history: [] };
const observation = { id: 'obs', changeId: 'a', sourceRevision: 7, planVersion: 2, status: 'ok', capturedAt: '2026-11-19T01:00:00Z', dirty: true, headState: 'unborn', head: null };
const list = { changeId: 'a', observations: [{ observation }], loading: false, stale: false, error: '' };
const selection = { ...approvalBaselineSelection(null, change), id: 'obs' };

test('default remains legacy and candidates require exact change/revision/version/status, allowing dirty/unborn', () => {
  const records = [{ observation }, ...[{ changeId: 'b' }, { sourceRevision: 6 }, { planVersion: 1 }, { status: 'partial' }, { status: 'error' }].map(patch => ({ observation: { ...observation, ...patch } }))];
  assert.deepEqual(approvalBaselineCandidates(change, { ...list, observations: records }), [{ observation }]);
  assert.deepEqual(approvalBaselineExtra(change, list, approvalBaselineSelection(null, change)), {});
  assert.deepEqual(approvalBaselineExtra(change, list, selection), { planVersion: 2, baselineObservationId: 'obs' });
  assert.match(approvalBaselineLabel(observation), /2026-11-19.*dirty=true.*unborn.*obs/);
  assert.match(approvalBaselineLabel({ ...observation, dirty: false, headState: 'commit', head: 'abcd' }), /dirty=false.*HEAD=abcd/);
});

test('list unavailable/loading/stale/error blocks only selected binding, never legacy approval', () => {
  for (const patch of [{ observations: null }, { observations: [] }, { loading: true }, { stale: true }, { error: 'offline' }, { changeId: 'b' }]) {
    const unavailable = { ...list, ...patch };
    assert.equal(approvalBaselineBlock(change, unavailable, selection), 'approvalBaselineBlocked');
    assert.throws(() => approvalBaselineExtra(change, unavailable, selection), /approvalBaselineBlocked/);
    assert.deepEqual(approvalBaselineExtra(change, unavailable, approvalBaselineSelection(null, change)), {});
  }
  assert.equal(approvalBaselineBlock({ ...change, revision: 8 }, list, selection), 'approvalBaselineBlocked');
});

test('selection resets for change/revision/version/save/replan and A-B-A without touching draft', () => {
  assert.equal(approvalBaselineSelection(selection, change), selection);
  for (const next of [{ ...change, id: 'b' }, { ...change, revision: 8 }, { ...change, planVersion: 3 }]) {
    const cleared = approvalBaselineSelection(selection, next);
    assert.equal(cleared.id, '');
    assert.equal(approvalBaselineSelection(cleared, change).id, '');
  }
  assert.equal(approvalBaselineSelection(selection, change, true).id, '');
  const loadStart = source.indexOf('          const loadChange =');
  const loadEnd = source.indexOf('          async function command(', loadStart);
  const load = source.slice(loadStart, loadEnd);
  assert.ok(load.includes('setApprovalBaseline(() => approvalBaselineSelection(null, next, true))'));
  assert.ok(source.includes('[change?.id, change?.revision, change?.planVersion]'));
  assert.ok(!fn('selectApprovalBaseline', '          ').includes('setDraft'));
});

test('actual loadChange resets selection through A-B-A, save and replan without clearing unrelated runtime drafts', () => {
  const start = source.indexOf('          const loadChange = ');
  const end = source.indexOf('          async function command(', start);
  const expression = source.slice(start, end).trim().replace(/^const loadChange = /, '').replace(/;$/, '');
  const setters = [...new Set(expression.match(/set[A-Z]\w+/g))];
  let selected = selection;
  const touched = [];
  const values = setters.map(name => name === 'setApprovalBaseline' ? update => { selected = update(selected); }
    : () => { touched.push(name); });
  const load = Function('normalize', 'clone', 'bindDelivery', 'approvalBaselineSelection', ...setters, `return (${expression});`)(
    value => value, structuredClone, () => {}, approvalBaselineSelection, ...values);
  load({ ...change, id: 'b' }, { preserveRuntime: true });
  assert.equal(selected.id, ''); assert.equal(selected.changeId, 'b');
  load(change, { preserveRuntime: true });
  assert.equal(selected.id, ''); assert.equal(selected.changeId, 'a');
  for (const submitted of ['save', 'replan']) {
    selected = selection;
    load(change, { preserveRuntime: true, submitted });
    assert.equal(selected.id, '');
  }
  for (const name of ['setResolution', 'setDispatchResolution', 'setEvidence', 'setTransition']) assert.ok(!touched.includes(name));
});

function approvalHandler(patch = {}) {
  const sent = [];
  const values = { busy: false, approved: false, unsettled: false, change, gitList: list, approvalBaseline: selection, ...patch };
  const command = async payload => { sent.push(payload); return { change }; };
  const mutate = Function('unsettled', 't', 'command', 'change', 'mounted', 'loadChange', 'setNotice', 'list', `return (${fn('mutate', '          ', true)});`)(values.unsettled, key => key, command, values.change, { current: false }, () => {}, () => {}, async () => {});
  const handler = Function(...Object.keys(values), 't', 'approvalBaselineBlock', 'approvalBaselineExtra', 'mutate', `return (${fn('approvePlan', '          ', true)});`)(...Object.values(values), key => key, approvalBaselineBlock, approvalBaselineExtra, mutate);
  return { handler, sent };
}

test('actual approval handler and mutate emit paired fields or exactly legacy payload via human command', async () => {
  const bound = approvalHandler(); await bound.handler();
  assert.deepEqual(bound.sent, [{ action: 'approve', changeId: 'a', expectedRevision: 7, planVersion: 2, baselineObservationId: 'obs' }]);
  const legacy = approvalHandler({ approvalBaseline: approvalBaselineSelection(null, change), gitList: { ...list, error: 'offline' } }); await legacy.handler();
  assert.deepEqual(legacy.sent, [{ action: 'approve', changeId: 'a', expectedRevision: 7 }]);
  assert.ok(source.includes('() => run(approvePlan)'));
  assert.ok(fn('command', '          ', true).includes('ctx.remote.commands.execute'));
  assert.ok(!fn('approvePlan', '          ', true).includes('insertChatText'));
});

test('actual approval handler prevents dirty, stale, missing selection, busy and duplicate approval submissions', async () => {
  for (const patch of [{ unsettled: true }, { gitList: { ...list, loading: true } }, { gitList: { ...list, stale: true } }, { gitList: { ...list, error: 'offline' } }, { approvalBaseline: { ...selection, id: 'missing' } }, { change: { ...change, revision: 8 } }]) {
    const item = approvalHandler(patch); await assert.rejects(item.handler()); assert.deepEqual(item.sent, []);
  }
  for (const patch of [{ busy: true }, { approved: true }]) {
    const item = approvalHandler(patch); await item.handler(); assert.deepEqual(item.sent, []);
  }
});

test('actual selector ignores invalid candidates, supports explicit clearing under stale list, and leaves comparison independent', () => {
  let selected = selection;
  function select(id, patch = {}) {
    const values = { busy: false, unsettled: false, change, gitList: list, ...patch };
    return Function(...Object.keys(values), 'approvalBaselineCandidates', 'approvalBaselineSelection', 'setApprovalBaseline', `return (${fn('selectApprovalBaseline', '          ')});`)(...Object.values(values), approvalBaselineCandidates, approvalBaselineSelection, next => { selected = next; })(id);
  }
  select('missing'); assert.equal(selected, selection);
  select('obs', { unsettled: true }); assert.equal(selected, selection);
  select('obs', { gitList: { ...list, stale: true } }); assert.equal(selected, selection);
  select('', { gitList: { ...list, stale: true } }); assert.equal(selected.id, '');
  select('obs'); assert.equal(selected.id, 'obs');
  assert.ok(!fn('selectApprovalBaseline', '          ').includes('setGitBaseline'));
  assert.ok(!fn('selectGitObservation', '          ').includes('setApprovalBaseline'));
});

test('actual selection UI displays eligible records and explicit coverage as inert text', () => {
  const values = { change, gitList: { ...list, observations: [{ observation: { ...observation, scope: { root: 'repo' }, limitations: ['untracked contents excluded', '<script>text</script>'] } }] },
    approvalBaseline: selection, approved: false, busy: false, unsettled: false,
    h: (type, props, ...children) => ({ type, props, children }), t: key => key,
    button: label => label, refreshGitObservations: () => {}, selectApprovalBaseline: () => {}, ...helpers };
  const render = Function(...Object.keys(values), `return (${fn('approvalBaselineView', '          ')});`)(...Object.values(values));
  const text = JSON.stringify(render());
  assert.match(text, /dirty=true.*unborn/);
  assert.match(text, /untracked contents excluded/);
  assert.match(text, /<script>text<\/script>/);
  assert.doesNotMatch(text, /dangerouslySetInnerHTML/);
});

test('actual summary shows current and historical bindings plus legacy records without post-approval revision invalidation', () => {
  const bound = { planVersion: 2, sourceRevision: 7, approvalRevision: 8, actor: { kind: 'user' }, codeBaseline: { schemaVersion: 1, kind: 'git-observation', observationId: 'obs', sourceRevision: 7, planVersion: 2 } };
  const current = { ...change, revision: 8, approvals: [bound, { planVersion: 2, actor: { kind: 'user' } }], history: [{ snapshot: { approvals: [{ ...bound, planVersion: 1, codeBaseline: { ...bound.codeBaseline, observationId: 'history-obs' } }] } }] };
  const controls = [];
  const values = { change: current, gitList: list, approvalBaseline: approvalBaselineSelection(null, current), approved: true, busy: false, unsettled: false,
    h: (type, props, ...children) => ({ type, props, children }), t: key => key,
    button: (label, onClick, disabled) => { controls.push({ label, disabled }); return label; }, refreshGitObservations: () => {}, selectApprovalBaseline: () => {}, ...helpers };
  const render = Function(...Object.keys(values), `return (${fn('approvalBaselineView', '          ')});`)(...Object.values(values));
  const text = JSON.stringify(render());
  assert.match(text, /approvalBaselineSummary/); assert.match(text, /history-obs/);
  assert.match(text, /approvalBaselineUnbound/); assert.doesNotMatch(text, /approvalBaselineBlocked/);
  assert.ok(!fn('approvalBaselineView', '          ').includes('dangerouslySetInnerHTML'));
  assert.ok(source.includes('Historical observations are not proof of the complete workspace'));
  assert.ok(source.includes('never automatically revoke approval'));
});
