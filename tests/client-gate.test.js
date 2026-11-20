import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
const block = source.slice(
  source.indexOf('/* BEGIN GATE SUMMARY */'),
  source.indexOf('/* END GATE SUMMARY */'),
);
const helpers = new Function(`${block}
return { gateQuery, gateMatches, gateBlockerKey, gateBlockerDetail };`)();

const change = { id: 'c1', planVersion: 2, revision: 7 };

test('the gate query is read-only and only carries the change id', () => {
  assert.deepEqual(helpers.gateQuery('c1'), { action: 'gateStatus', changeId: 'c1' });
});

test('a result only describes the current version', () => {
  assert.equal(helpers.gateMatches({ changeId: 'c1', planVersion: 2, revision: 7 }, change), true);
  assert.equal(helpers.gateMatches({ changeId: 'c2', planVersion: 2, revision: 7 }, change), false);
  assert.equal(helpers.gateMatches({ changeId: 'c1', planVersion: 1, revision: 7 }, change), false);
  assert.equal(helpers.gateMatches({ changeId: 'c1', planVersion: 2, revision: 6 }, change), false);
  assert.equal(helpers.gateMatches(null, change), false);
  assert.equal(helpers.gateMatches({ changeId: 'c1', planVersion: 2, revision: 7 }, null), false);
});

test('every core blocker code maps to a translation key', () => {
  for (const code of ['APPROVAL_REQUIRED', 'ACTIVE_RUN', 'UNRESOLVED_UNKNOWN', 'TASK_NOT_TERMINAL', 'NO_COMPLETED_TASK', 'MISSING_EVIDENCE']) {
    const key = helpers.gateBlockerKey(code);
    assert.ok(key, `${code} has no label`);
    assert.match(source, new RegExp(`^ {6}${key}: \\[`, 'm'));
  }
  assert.equal(helpers.gateBlockerKey('SOMETHING_NEW'), null);
});

test('blocker details are stable and skip empty fields', () => {
  assert.equal(helpers.gateBlockerDetail({ code: 'TASK_NOT_TERMINAL', taskId: 'a', status: 'failed' }), 'a · failed');
  assert.equal(helpers.gateBlockerDetail({ code: 'MISSING_EVIDENCE', taskId: 'a', criterion: 'Review' }), 'a · Review');
  assert.equal(helpers.gateBlockerDetail({ code: 'ACTIVE_RUN', kind: 'dispatch', runId: 'r1', state: 'running' }), 'dispatch · r1 · running');
  assert.equal(helpers.gateBlockerDetail({ code: 'APPROVAL_REQUIRED' }), '');
  assert.equal(helpers.gateBlockerDetail(null), '');
});

test('the quality gate shows the core verdict and blocks acceptance on a fresh "not ready"', () => {
  assert.match(source, /h\("h4", null, t\("gateTitle"\)\)/);
  assert.match(source, /gate && !gateMatches\(gate, change\) && h\("p", \{ className: "ep-warn" \}, t\("gateStale"\)\)/);
  assert.match(source, /const freshGateBlocked = !!gate && gateMatches\(gate, change\) && !gate\.ready;/);
  assert.match(source, /if \(!eligible \|\| freshGateBlocked \|\| !confirmation\.confirmed/);
  assert.match(source, /}, !eligible \|\| freshGateBlocked \|\| !confirmation\.confirmed \|\| !delivery\.note\.trim\(\)\)/);
});

test('the gate is refreshed together with run records, not polled separately', () => {
  assert.match(source, /setVerificationRuns\(result\.runs\);\s*\/\/ typeof keeps narrow harnesses[\s\S]*?if \(typeof refreshGate === "function"\) await refreshGate\(targetId\);/);
  assert.match(source, /const data = await command\(gateQuery\(targetId\)\);/);
});

test('the stale hint tells the reader to reload the change before refreshing runs', () => {
  const zh = source.slice(source.indexOf('gateStale: ['), source.indexOf('gateStale: [') + 400);
  assert.match(zh, /方案操作/);
  assert.match(zh, /重新加载变更/);
  assert.match(zh, /刷新运行记录/);
});

test('a no-succeeded-command warning renders as text and never as a blocker', () => {
  const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
  assert.match(source, /function gateWarningKey\(code\) \{ return \{ NO_SUCCEEDED_COMMAND: "gateWarnNoSucceededCommand" \}/);
  assert.match(source, /gateWarnings\(gate\.warnings\)/);
  // Rendered from gate.warnings, not from gate.blockers: the core keeps them apart.
  assert.doesNotMatch(source, /gate\.blockers\.push/);
  assert.match(source, /gateWarnNoSucceededCommand:\s*\["[^"]*\{task\}[^"]*", "[^"]*\{task\}[^"]*"\]/);
});
