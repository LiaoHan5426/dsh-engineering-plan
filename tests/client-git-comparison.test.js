import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compareGitObservations } from '../src/git-comparison.js';

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
const canonical = readFileSync(new URL('../src/git-comparison.js', import.meta.url), 'utf8');
const begin = '    /* BEGIN SHARED GIT COMPARISON */\n    const gitComparison = (() => {\n';
const end = '\nreturn { compareGitObservations };\n    })();\n    /* END SHARED GIT COMPARISON */';
const embedded = source.slice(source.indexOf(begin) + begin.length, source.indexOf(end));
const gitComparison = Function(`${embedded}\nreturn { compareGitObservations };`)();
function functionSource(name, indent = '    ') {
  const start = source.indexOf(`${indent}function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf(`\n${indent}}`, start) + indent.length + 2).trim();
}
const load = (name, bindings = {}, indent) => Function(...Object.keys(bindings), `return (${functionSource(name, indent)});`)(...Object.values(bindings));
const gitComparisonSelection = load('gitComparisonSelection');
const savedGitComparison = load('savedGitComparison', { gitComparison });
const gitListState = load('gitListState');
const change = { id: '22222222-2222-4222-8222-222222222222', revision: 4, planVersion: 1 };
function observation(patch = {}) {
  return { schemaVersion: 1, id: '11111111-1111-4111-8111-111111111111', changeId: change.id,
    planVersion: 1, sourceRevision: 1, actor: { kind: 'agent', id: 'agent' },
    capturedAt: '2026-01-01T00:00:00.000Z', finishedAt: '2026-01-01T00:00:01.000Z',
    workspaceRoot: '/workspace', repositoryRoot: '/workspace', collectorVersion: 'git-observation-v1',
    status: 'ok', head: 'c'.repeat(40), headState: 'commit', dirty: false,
    scope: { tracked: 'git-diff', untracked: 'paths-only', ignored: 'excluded', excludedPaths: ['.planner'] },
    stagedDiffSha256: 'a'.repeat(64), worktreeDiffSha256: 'a'.repeat(64), untrackedPathsSha256: 'a'.repeat(64),
    untrackedCount: 0, limitations: [], error: null, ...patch };
}
const current = patch => observation({ id: '33333333-3333-4333-8333-333333333333',
  capturedAt: '2026-01-01T00:00:02.000Z', finishedAt: '2026-01-01T00:00:03.000Z', ...patch });
const envelope = (record, legacy = false) => ({ schemaVersion: 1, requestId: record.id, ownerSessionId: 'session', observation: record,
  ...(legacy ? {} : { request: { action: 'compare', baselineId: observation().id } }) });
const list = (patch = {}, before = observation()) => ({ changeId: change.id, observations: [envelope(before, true), envelope(current(patch))], loading: false, stale: false, error: '' });
const selection = () => ({ changeId: change.id, id: observation().id, currentId: current().id, invalidated: false });

test('browser bundle is exact canonical source with only export removed, and has no imports', () => {
  assert.equal(embedded, canonical.replace(/^export /gm, ''));
  assert.ok(!/^import /m.test(embedded));
  assert.equal(source.split(begin).length, 2);
  assert.equal(source.split(end).length, 2);
});

test('saved comparison preserves canonical semantics including three states and incomplete observations', () => {
  const cases = [{}, { head: 'd'.repeat(40) }, { stagedDiffSha256: 'b'.repeat(64) },
    { worktreeDiffSha256: 'b'.repeat(64) }, { untrackedCount: 1 },
    { head: 'C'.repeat(40), stagedDiffSha256: 'A'.repeat(64) },
    { status: 'partial' }, { status: 'partial', worktreeDiffSha256: null },
    { status: 'partial', worktreeDiffSha256: 'b'.repeat(64) },
    { status: 'error', error: { code: 'FAIL', message: '<script>bad</script>' } },
    { status: 'unstable' }, { status: 'not_git' }, { repositoryRoot: '/other' },
    { scope: { ...observation().scope, excludedPaths: ['elsewhere'] } },
    { capturedAt: '2026-01-01T00:00:00.500Z' }, { planVersion: 2 }];
  for (const patch of cases) {
    const data = list(patch), snapshot = JSON.stringify(data);
    const result = savedGitComparison(change, data, selection());
    assert.deepEqual(result.comparison, compareGitObservations(observation(), current(patch)));
    assert.equal(result.comparison.fullWorkspaceEquality, 'not-established');
    assert.equal(JSON.stringify(data), snapshot);
    assert.ok(!('bindingCurrent' in result));
  }
  assert.equal(savedGitComparison(change, list(), selection()).comparison.headChanged, false);
  assert.equal(savedGitComparison(change, list({ head: 'd'.repeat(40) }), selection()).comparison.headChanged, true);
  assert.equal(savedGitComparison(change, list({ status: 'error' }), selection()).comparison.headChanged, null);
  assert.equal(savedGitComparison(change, list({ status: 'partial' }), selection()).comparison.observedEqual, null);
  assert.equal(savedGitComparison(change, list({ planVersion: 2 }), selection()).crossVersion, true);
  assert.equal(savedGitComparison({ ...change, planVersion: 3 }, list(), selection()).crossVersion, true);
});

test('invalid data, same record, stale, missing and foreign selections yield no comparison', () => {
  for (const data of [{ ...list(), loading: true }, { ...list(), stale: true }, { ...list(), error: 'offline' },
    { ...list(), observations: null }, { ...list(), changeId: 'other' }]) {
    assert.equal(savedGitComparison(change, data, selection()).message, 'gitRefreshRequired');
  }
  assert.equal(savedGitComparison(change, list(), { ...selection(), currentId: selection().id }).message, 'gitDifferentObservation');
  assert.equal(savedGitComparison(change, list(), { ...selection(), currentId: 'missing' }).message, 'gitSelectionInvalidated');
  assert.equal(savedGitComparison(change, list(), { ...selection(), changeId: 'other' }).message, 'gitChoosePair');
  assert.equal(savedGitComparison(change, list({ schemaVersion: 2 }), selection()).message, 'invalidResponse');
  assert.equal(savedGitComparison(change, list({ changeId: 'other' }), selection()).message, 'invalidResponse');
});

test('selection lifecycle resets A-B-A and explicitly retains refresh invalidation notice', () => {
  const original = selection();
  const b = gitComparisonSelection(original, list(), 'other');
  const a = gitComparisonSelection(b, list(), change.id);
  assert.equal(a.id, ''); assert.equal(a.currentId, '');
  assert.equal(gitComparisonSelection(original, { ...list(), loading: true, observations: [] }, change.id), original);
  assert.equal(gitComparisonSelection(original, { ...list(), stale: true, observations: [] }, change.id), original);
  const invalid = gitComparisonSelection(original, { ...list(), observations: [envelope(observation())] }, change.id);
  assert.equal(invalid.id, original.id); assert.equal(invalid.currentId, ''); assert.equal(invalid.invalidated, true);
  assert.equal(gitComparisonSelection(invalid, list(), change.id), invalid);
  assert.ok(source.includes('setGitBaseline(previous => gitComparisonSelection(previous, gitList, change?.id ?? null))'));
});

function render(data = list(), initial = selection(), patch = {}) {
  let state = initial;
  const handler = load('selectGitObservation', { change, gitList: data, gitComparisonSelection,
    setGitBaseline: update => { state = update(state); } }, '          ');
  const h = (type, props, ...children) => ({ type, props, children });
  const bindings = { gitList: data, change, gitListState, gitBaseline: state, gitComparisonSelection, savedGitComparison,
    h, t: key => key, button: (label, onClick, disabled) => ({ type: 'button', props: { label, onClick, disabled }, children: [] }),
    refreshGitObservations: () => {}, busy: false, gitRecordFields: load('gitRecordFields'), gitRequestBlock: load('gitRequestBlock'),
    unsettled: true, selectGitObservation: handler, nativeGitRequest: () => { throw new Error('unexpected draft operation'); }, ...patch };
  const tree = load('gitObservationsView', bindings, '          ')();
  const nodes = [];
  function walk(node) { if (node && typeof node === 'object') { nodes.push(node); for (const child of node.children || []) walk(child); } }
  walk(tree);
  return { tree, nodes, handler, get state() { return state; } };
}
test('actual selectors work with unsaved draft, are read-only and guard stale events', () => {
  const view = render(list(), { ...selection(), currentId: '' });
  const selects = view.nodes.filter(node => node.type === 'select');
  assert.equal(selects.length, 2); assert.ok(selects.every(node => !node.props.disabled));
  selects[1].props.onChange({ target: { value: current().id } });
  assert.equal(view.state.currentId, current().id);
  assert.equal(savedGitComparison(change, list(), view.state).comparison.observedEqual, true);
  view.handler('currentId', 'missing'); assert.equal(view.state.currentId, current().id);
  view.handler('unknown', ''); assert.equal(view.state.unknown, undefined);
  for (const data of [{ ...list(), stale: true }, { ...list(), loading: true }, { ...list(), changeId: 'other' }]) {
    const blocked = render(data); blocked.handler('id', ''); assert.equal(blocked.state.id, selection().id);
    assert.ok(blocked.nodes.filter(node => node.type === 'select').every(node => node.props.disabled));
  }
  const text = functionSource('selectGitObservation', '          ');
  assert.ok(!/command\(|mutate\(|insertChatText\(|setDraft\(|setDirty\(/.test(text));
});

test('actual card displays explicit false/true/null, reasons, limits and cross-version notice as text', () => {
  for (const patch of [{}, { head: 'd'.repeat(40) }, { status: 'error' }, { status: 'partial' }, { planVersion: 2 }]) {
    const view = render(list(patch));
    const result = compareGitObservations(observation(), current(patch));
    const dl = view.nodes.find(node => node.type === 'dl' && node.props?.['aria-label'] === 'gitSavedComparison');
    const values = Object.fromEntries(dl.children.filter((_, i) => i % 2 === 0).map((label, i) => [label.children[0], dl.children[i * 2 + 1].children[0].children[0]]));
    for (const field of ['headChanged', 'stagedChanged', 'worktreeChanged', 'untrackedPathsChanged', 'comparable', 'observedEqual', 'reasons', 'fullWorkspaceEquality'])
      assert.equal(values[field], JSON.stringify(result[field], null, 2));
    if (patch.planVersion) assert.ok(JSON.stringify(view.tree).includes('gitCrossVersion'));
  }
  const unsafe = render(list({ limitations: ['<img src=x onerror=alert(1)>'] }));
  assert.ok(JSON.stringify(unsafe.tree).includes('<img src=x onerror=alert(1)>'));
  assert.ok(!unsafe.nodes.some(node => node.props?.dangerouslySetInnerHTML));
  const missing = render({ ...list(), observations: [] });
  assert.ok(JSON.stringify(missing.tree).includes('gitSelectionInvalidated'));
  assert.ok(!missing.nodes.some(node => node.props?.['aria-label'] === 'gitSavedComparison'));
});
