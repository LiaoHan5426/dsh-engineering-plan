import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');

function extract(name, indent = '    ') {
  const start = source.indexOf(`${indent}function ${name}(`);
  assert.ok(start >= 0, `missing ${name}`);
  const end = source.indexOf(`\n${indent}}`, start);
  assert.ok(end > start, `unterminated ${name}`);
  return source.slice(start, end + indent.length + 2).trim();
}

const scope = {};
for (const name of ['terminationEligible', 'terminationKey', 'bindTermination', 'terminationHistory', 'terminationPayload']) {
  scope[name] = Function(...Object.keys(scope), `return (${extract(name)});`)(...Object.values(scope));
}
const { terminationEligible, terminationKey, bindTermination, terminationPayload } = scope;

const change = (patch = {}) => ({ id: 'change', revision: 7, planVersion: 2, history: [], ...patch });
const run = (patch = {}) => ({ changeId: 'change', runId: 'run-1', revision: 3, state: 'running', jobId: 'bash-1', ...patch });
const form = (target = run(), patch = {}) => ({
  ...bindTermination({ key: terminationKey(change(), 'verification', target), reason: ' host restarted ',
    basis: ' checked the process list ', references: 'task manager\nps -ef ', confirmed: true }, change(), 'verification', target),
  ...patch,
});

test('only a started run that carries a job id can be terminated this way', () => {
  assert.equal(terminationEligible(run()), true);
  assert.equal(terminationEligible(run({ state: 'starting' })), true);
  for (const state of ['reserved', 'cancelled', 'unknown', 'succeeded', 'failed', undefined])
    assert.equal(terminationEligible(run({ state })), false, String(state));
  assert.equal(terminationEligible(run({ jobId: '' })), false);
  assert.equal(terminationEligible(run({ jobId: null })), false);
  assert.equal(terminationEligible(null), false);
});

test('the payload carries an attestation with the fixed scope and parsed references', () => {
  const payload = terminationPayload(change(), 'verification', run(), form());
  assert.equal(payload.action, 'terminateRun');
  assert.equal(payload.expectedRevision, 7);
  assert.equal(payload.expectedRunRevision, 3);
  assert.equal(payload.reason, 'host restarted');
  assert.equal(payload.terminationEvidence.scope, 'child-and-descendants-and-processes');
  assert.equal(payload.terminationEvidence.confirmed, true);
  assert.equal(payload.terminationEvidence.basis, 'checked the process list');
  assert.deepEqual(payload.terminationEvidence.references, ['task manager', 'ps -ef']);
  assert.match(payload.terminationEvidence.checkedAt, /^\d{4}-\d{2}-\d{2}T.*Z$/);
  assert.equal('actor' in payload, false, 'the client never sends an actor');
});

test('the payload stays empty without a reason, a basis, a confirmation or a current key', () => {
  const target = run();
  assert.equal(terminationPayload(change(), 'verification', target, form(target, { reason: ' ' })), null);
  assert.equal(terminationPayload(change(), 'verification', target, form(target, { basis: '' })), null);
  assert.equal(terminationPayload(change(), 'verification', target, form(target, { confirmed: false })), null);
  assert.equal(terminationPayload(change(), 'verification', target, { ...form(target), key: 'stale' }), null);
  assert.equal(terminationPayload(change(), 'verification', run({ revision: 4 }), form(target)), null);
  assert.equal(terminationPayload(change(), 'verification', run({ state: 'reserved', jobId: null }), form(target)), null);
  assert.equal(terminationPayload(change(), 'other', target, form(target)), null);
});

test('an already recorded termination is not offered again', () => {
  const target = run();
  const recorded = change({ history: [{ kind: 'run-terminated-unattached', runKind: 'verification',
    runId: target.runId, actor: { kind: 'user', id: 'human' } }] });
  assert.equal(terminationPayload(recorded, 'verification', target, form(target)), null);
});

test('the stranded notice routes started runs to the termination form when a job id exists', () => {
  assert.match(source, /return terminationEligible\(record\) \? "terminateRun" : "strandedNeedsEvidence";/);
  assert.match(source, /if \(notice === "terminateRun"\) \{/);
  assert.match(source, /return terminationForm\(kind, record, disabled\);/);
  assert.match(source, /action: "terminateRun"/);
  assert.match(source, /terminateConfirm/);
});
