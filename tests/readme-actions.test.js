import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const host = readFileSync(join(root, 'index.js'), 'utf8');
const readme = readFileSync(join(root, 'README.md'), 'utf8');

function toolActions() {
  const match = host.match(/const actions = \[([^\]]*)\];/);
  assert.ok(match, 'index.js must declare the tool action list');
  return [...match[1].matchAll(/'([a-zA-Z]+)'/g)].map((m) => m[1]);
}

test('every tool action is documented in the README', () => {
  const actions = toolActions();
  assert.ok(actions.length >= 12, `expected at least 12 actions, saw ${actions.length}`);
  const missing = actions.filter((name) => !readme.includes('`' + name + '`'));
  assert.deepEqual(missing, []);
});

test('human-only actions are documented but never exposed as tool actions', () => {
  const actions = toolActions();
  for (const name of ['approve', 'replan', 'acceptDelivery', 'resolveUnknown', 'resolveDispatchUnknown', 'abandonRun', 'cancelRun']) {
    assert.equal(actions.includes(name), false, `${name} must not be a model tool action`);
    assert.ok(readme.includes(name), `README must still describe ${name}`);
  }
});

test('read-only actions are marked concurrency safe and writes are not', () => {
  const readOnly = ['list', 'get', 'context', 'verificationRuns', 'dispatchRuns', 'gateStatus', 'readyTasks'];
  const line = host.split('\n').find((l) => l.includes('isConcurrencySafe:')) || '';
  for (const name of readOnly) {
    assert.ok(line.includes("'" + name + "'"), `${name} should be in the concurrency-safe list`);
  }
  for (const name of ['save', 'transition', 'evidence', 'create', 'export']) {
    assert.equal(line.includes("'" + name + "'"), false, `${name} writes and must not be concurrency safe`);
  }
});
