import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';

const source = fs.readFileSync('J:/Code/Engineering Planner/client.js', 'utf8');
const block = source.slice(source.indexOf('/* BEGIN SCOPE SUMMARY */'), source.indexOf('/* END SCOPE SUMMARY */'));
const helpers = new Function(`${block.replace(/^ {4}/gm, '')}
return { scopeQuery, scopeMatches, scopeStateKey, scopePreview };`)();

test('the audit request names the core action and the change', () => {
  assert.deepEqual(helpers.scopeQuery('abc'), { action: 'scopeAudit', changeId: 'abc' });
});

test('a result only counts as current when change and revision agree', () => {
  const change = { id: 'c1', revision: 4, planVersion: 2 };
  assert.equal(helpers.scopeMatches({ changeId: 'c1', revision: 4 }, change), true);
  assert.equal(helpers.scopeMatches({ changeId: 'c1', revision: 3 }, change), false);
  assert.equal(helpers.scopeMatches({ changeId: 'c2', revision: 4 }, change), false);
  assert.equal(helpers.scopeMatches(null, change), false);
  assert.equal(helpers.scopeMatches({ changeId: 'c1', revision: 4 }, null), false);
});

test('only the two non-comparable states get an explanatory key', () => {
  assert.equal(helpers.scopeStateKey('no_observation'), 'scopeNoObservation');
  assert.equal(helpers.scopeStateKey('observation_incomplete'), 'scopeIncomplete');
  assert.equal(helpers.scopeStateKey('compared'), null);
  assert.equal(helpers.scopeStateKey('something-new'), null);
});

test('long lists are previewed with a remainder count', () => {
  const result = helpers.scopePreview(['a', 'b', 'c'], 2);
  assert.deepEqual(result, { shown: ['a', 'b'], rest: 1 });
  assert.deepEqual(helpers.scopePreview([], 2), { shown: [], rest: 0 });
  assert.deepEqual(helpers.scopePreview(null, 2), { shown: [], rest: 0 });
  assert.deepEqual(helpers.scopePreview(['a'], 0), { shown: ['a'], rest: 0 });
});

test('the card renders every state instead of assuming success', () => {
  assert.match(source, /scopeError && h\("p", \{ className: "ep-error" \}, scopeError\)/);
  assert.match(source, /!scope && h\("p", \{ className: "ep-muted" \}, t\("scopeNotQueried"\)\)/);
  assert.match(source, /scope && !fresh && h\("p", \{ className: "ep-warn" \}, t\("scopeStale"\)\)/);
  assert.match(source, /kind && h\("p", \{ className: "ep-warn" \}, t\(kind\)\)/);
});

test('the audit never gates anything: it only renders', () => {
  const view = source.slice(source.indexOf('function scopeAuditView()'), source.indexOf('async function refreshGate('));
  assert.ok(view.length > 500);
  assert.doesNotMatch(view, /disabled: .*scope/);
  assert.doesNotMatch(view, /setGate\(/);
  assert.doesNotMatch(view, /disabled: .*freshGateBlocked/);
});

test('the button is disabled while running or with unsaved edits', () => {
  assert.match(source, /button\("scopeRun", \(\) => runScopeAudit\(change\.id\), scopeBusy \|\| !!unsettled\)/);
});

test('the request validates the answer before showing it', () => {
  const runner = source.slice(source.indexOf('async function runScopeAudit('), source.indexOf('function scopeAuditView()'));
  assert.match(runner, /data\.changeId === targetId/);
  assert.match(runner, /Number\.isSafeInteger\(data\.revision\)/);
  assert.match(runner, /typeof data\.state === "string"/);
  assert.match(runner, /setScopeError\(t\("invalidResponse"\)\)/);
});

test('the card is mounted in the quality tab next to the delivery review', () => {
  assert.match(source, /deliveryReviewView\(\),\s*\n\s*scopeAuditView\(\),/);
});

test('every new message exists in both languages', () => {
  for (const key of ['scopeTitle', 'scopeTruth', 'scopeRun', 'scopeNotQueried', 'scopeStale', 'scopeFresh',
    'scopeNoObservation', 'scopeIncomplete', 'scopeSummary', 'scopeUndeclared', 'scopeUntouched',
    'scopeNoneUndeclared', 'scopeNoneUntouched', 'scopeMore']) {
    const at = source.indexOf(`${key}: [`);
    assert.ok(at > 0, `${key} missing`);
    const slice = source.slice(at, at + 300);
    assert.match(slice, /[\u4e00-\u9fa5]/);
    assert.match(slice, /[A-Za-z]{4,}/);
  }
});

test('the freshness badge only appears when the audit actually compared paths', () => {
  assert.match(source, /fresh && scope\.state === "compared" && h\("span", \{ className: "ep-muted" \}, t\("scopeFresh"\)\)/);
  assert.doesNotMatch(source, /fresh && h\("span", \{ className: "ep-muted" \}, t\("scopeFresh"\)\)/);
});
