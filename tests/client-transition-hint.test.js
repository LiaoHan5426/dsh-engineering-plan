import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');

function functionSource(name, indent = '    ') {
  const start = source.indexOf(`${indent}function ${name}(`);
  assert.ok(start >= 0, `missing function ${name}`);
  const end = source.indexOf(`\n${indent}}`, start) + indent.length + 2;
  return source.slice(start, end).trim();
}

const planApproved = Function(`return (${functionSource('planApproved')})`)();

const change = (approvals, planVersion = 2) => ({ planVersion, approvals });

test('planApproved only accepts a human approval of the current plan version', () => {
  assert.equal(planApproved(change([{ planVersion: 2, actor: { kind: 'user' } }])), true);
  assert.equal(planApproved(change([{ planVersion: 1, actor: { kind: 'user' } }])), false);
  assert.equal(planApproved(change([{ planVersion: 2, actor: { kind: 'agent' } }])), false);
  assert.equal(planApproved(change([{ planVersion: 2 }])), false);
  assert.equal(planApproved(change([])), false);
  assert.equal(planApproved({ planVersion: 2 }), false);
  assert.equal(planApproved(null), false);
  assert.equal(planApproved(undefined), false);
  // 旧审批在方案版本升级后不能继续被当作当前批准
  assert.equal(planApproved(change([{ planVersion: 2, actor: { kind: 'user' } }], 3)), false);
});

test('dispatch preflight keeps its own approval check and agrees with planApproved', () => {
  const block = functionSource('dispatchRequestBlock');
  assert.match(block, /approvals\?\.some/);
  const dispatchRequestBlock = Function(`return (${block})`)();
  const list = { changeId: 'a', runs: [], stale: false, loading: false, error: '' };
  const task = { id: 'task', status: 'pending', dependencies: [] };
  const approved = { id: 'a', planVersion: 2, revision: 3, approvals: [{ planVersion: 2, actor: { kind: 'user' } }], tasks: [task] };
  const unapproved = { ...approved, approvals: [] };
  assert.equal(planApproved(approved), true);
  assert.equal(dispatchRequestBlock(approved, 'task', list, false), '');
  assert.equal(planApproved(unapproved), false);
  assert.equal(dispatchRequestBlock(unapproved, 'task', list, false), 'approvalRequired');
});

test('transition form explains approval state instead of always demanding approval', () => {
  assert.match(source, /transitionApprovedHint: \[/);
  assert.match(source, /transitionUnapprovedHint: \[/);
  const usage = /t\(deliveryAccepted \? "deliveryFrozen" : unsettled \? "saveFirst" : planApproved\(change\) \? "transitionApprovedHint" : "transitionUnapprovedHint"\)/;
  assert.match(source, usage, 'transition hint must branch on planApproved(change)');
  assert.doesNotMatch(
    source,
    /t\(deliveryAccepted \? "deliveryFrozen" : unsettled \? "saveFirst" : "approvalRequired"\)/,
    'approved plans must not be told to approve again',
  );
});

test('transition hint text states that transitions do not need approval', () => {
  const zh = /transitionUnapprovedHint: \[\s*"([^"]+)"/.exec(source);
  const en = /transitionApprovedHint: \[\s*"[^"]+",\s*\n\s*"([^"]+)"/.exec(source);
  assert.ok(zh, 'zh transition hint present');
  assert.ok(en, 'en transition hint present');
  assert.match(zh[1], /流转不要求批准/);
  assert.match(en[1], /approved/i);
});
