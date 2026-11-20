import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
function actualFunction(name) {
  const start = source.indexOf(`    function ${name}(`);
  assert.ok(start >= 0, name);
  const end = source.indexOf('\n    }', start) + '\n    }'.length;
  return Function(`return (${source.slice(start, end)})`)();
}
const bindDelivery = actualFunction('bindDelivery');
const deliveryRequestAllowed = actualFunction('deliveryRequestAllowed');
const archivedReviews = actualFunction('archivedReviews');

test('confirmation is bound to change and version, including old cache and explicit replan', () => {
  const change = { id: 'a', planVersion: 2 };
  const form = { note: 'reviewed', confirmed: true, changeId: 'a', planVersion: 2 };
  assert.equal(bindDelivery(form, change).confirmed, true);
  for (const next of [{ id: 'b', planVersion: 2 }, { id: 'a', planVersion: 3 }]) {
    const result = bindDelivery(form, next);
    assert.equal(result.confirmed, false);
    assert.equal(result.note, 'reviewed');
    assert.equal(result.reconfirm, true);
  }
  assert.equal(bindDelivery(form, change, true).confirmed, false);
  assert.equal(bindDelivery({ note: 'old cache', confirmed: true }, change).confirmed, false);
  assert.equal(bindDelivery(undefined, change).confirmed, false);
});

test('current acceptance blocks implement and verify but allows read-only and plan requests', () => {
  const change = { planVersion: 2, deliveryAcceptance: { planVersion: 2 } };
  for (const kind of ['task', 'verify']) assert.equal(deliveryRequestAllowed(kind, change), false);
  for (const kind of ['plan', 'context', 'export']) assert.equal(deliveryRequestAllowed(kind, change), true);
  for (const kind of ['task', 'verify']) {
    assert.equal(deliveryRequestAllowed(kind, { ...change, planVersion: 3 }), true);
    assert.equal(deliveryRequestAllowed(kind, { planVersion: 2 }), true);
  }
});

test('archived snapshots and restarted evidence are read independently without mutation', () => {
  const evidence = { id: 'e', taskId: 't', criterion: 'c', outcome: 'passed', planVersion: 1 };
  const acceptance = { planVersion: 1, actor: { kind: 'user', id: 'u' }, acceptedAt: 'time', note: 'ok' };
  const snapshot = { planVersion: 1, deliveryAcceptance: acceptance, approvals: [{ planVersion: 1 }],
    tasks: [{ id: 't', status: 'completed', evidence: [evidence, { id: 'task-only', criterion: 'other' }] }], evidence: [evidence] };
  const change = { planVersion: 2, tasks: [], evidence: [], history: [
    { kind: 'replan', snapshot },
    { kind: 'task-restarted', planVersion: 2, taskId: 't', evidence: [evidence] },
    { kind: 'verification-unknown-resolved', runId: 'r' },
  ] };
  const before = JSON.stringify(change);
  const result = archivedReviews(change);
  assert.equal(result.length, 2);
  assert.equal(result[0].planVersion, 1);
  assert.deepEqual(result[0].deliveryAcceptance, acceptance);
  assert.equal(result[0].approvals.length, 1);
  assert.equal(result[0].tasks[0].status, 'completed');
  assert.equal(result[0].evidence.length, 2);
  assert.equal(result[0].evidence[1].taskId, 't');
  assert.equal(result[1].kind, 'task-restarted');
  assert.equal(result[1].planVersion, 2);
  assert.deepEqual(result[1].evidence, [evidence]);
  assert.equal(JSON.stringify(change), before);
});

test('actual loadChange preserves unrelated forms and resets confirmation on version changes', () => {
  const start = source.indexOf('          const loadChange = ');
  const end = source.indexOf('          async function sendCommand(', start);
  const expression = source.slice(start, end).trim().replace(/^const loadChange = /, '').replace(/;$/, '');
  let delivery = { note: 'keep', confirmed: true, changeId: 'a', planVersion: 1 };
  const cleared = [];
  const setters = [...new Set(expression.match(/set[A-Z]\w+/g))];
  const values = setters.map((name) => name === 'setDelivery' ? (update) => { delivery = update(delivery); }
    : (...args) => { if (['setResolution', 'setEvidence', 'setTransition'].includes(name)) cleared.push([name, args]); });
  const load = Function('normalize', 'clone', 'bindDelivery', ...setters, `return (${expression});`)(
    (value) => value, (value) => structuredClone(value), bindDelivery, ...values);
  load({ id: 'a', planVersion: 2 }, { preserveRuntime: true, submitted: 'replan' });
  assert.equal(delivery.confirmed, false);
  assert.equal(delivery.note, 'keep');
  assert.equal(delivery.reconfirm, true);
  assert.deepEqual(cleared, []);
  delivery = { note: 'accepted', confirmed: true, changeId: 'a', planVersion: 2 };
  load({ id: 'a', planVersion: 2 }, { preserveRuntime: true, submitted: 'acceptDelivery' });
  assert.equal(delivery.note, '');
  assert.equal(delivery.confirmed, false);
  assert.deepEqual(cleared, []);
});

test('actual handlers and render paths wire confirmation and request guards', () => {
  const fill = source.slice(source.indexOf('          function fillRequest('), source.indexOf('          function insertChatText('));
  let inserted = 0;
  const handler = Function('busy', 'unsettled', 'change', 'deliveryRequestAllowed', 'insertChatText', 'requestText',
    `return (${fill.trim()});`)(false, false,
      { id: 'a', planVersion: 1, deliveryAcceptance: { planVersion: 1 }, tasks: [{ id: 't' }] },
      deliveryRequestAllowed, () => inserted++, () => 'request');
  handler('task', 't'); handler('verify', 't');
  assert.equal(inserted, 0);
  handler('plan');
  assert.equal(inserted, 1);
  assert.ok(source.includes('setDelivery(bindDelivery(cached.delivery, cached.change))'));
  assert.ok(source.includes('next, submitted === "replan"'));
  assert.ok(source.includes('busy || !eligible || freshGateBlocked'));
  const controls = source.slice(source.indexOf('          function requestControls('), source.indexOf('          function button('));
  assert.equal(controls.split('deliveryBlocked || unsettled').length - 1, 2);
  assert.ok(controls.includes('if (deliveryRequestAllowed(kind, change)) copy('));
  assert.ok(source.includes('              archivedReviewsView(),'));
});
