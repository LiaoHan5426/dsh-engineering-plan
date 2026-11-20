import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
const core = readFileSync(new URL('../src/core.js', import.meta.url), 'utf8');

function block(begin, end) {
  const start = source.indexOf(begin);
  assert.ok(start >= 0, `missing ${begin}`);
  const stop = source.indexOf(end, start);
  assert.ok(stop > start, `missing ${end}`);
  return source.slice(start + begin.length, stop);
}

const planHelpers = Function(`${block('/* BEGIN PLAN COMPLETENESS SUMMARY */', '/* END PLAN COMPLETENESS SUMMARY */')}
  return { planIncomplete, planErrorKey };`)();
const { planIncomplete, planErrorKey } = planHelpers;

const task = (criteria) => ({ id: 't', title: 'task', acceptanceCriteria: criteria });
const plan = (patch = {}) => ({ goal: 'ship it', tasks: [task(['works'])], ...patch });

test('a complete plan reports nothing missing', () => {
  assert.equal(planIncomplete(plan()), '');
  assert.equal(planIncomplete(plan({ tasks: [task(['a']), task(['b', 'c'])] })), '');
});

test('the goal, the task list and the per-task criteria are each checked', () => {
  assert.equal(planIncomplete(plan({ goal: '' })), 'planNoGoal');
  assert.equal(planIncomplete(plan({ goal: '   ' })), 'planNoGoal');
  assert.equal(planIncomplete(plan({ goal: undefined })), 'planNoGoal');
  assert.equal(planIncomplete(plan({ tasks: [] })), 'planNoTasks');
  assert.equal(planIncomplete(plan({ tasks: undefined })), 'planNoTasks');
  assert.equal(planIncomplete(plan({ tasks: [task([])] })), 'planTaskNoCriteria');
  assert.equal(planIncomplete(plan({ tasks: [task(['a']), task([])] })), 'planTaskNoCriteria');
  assert.equal(planIncomplete(plan({ tasks: [task(undefined)] })), 'planTaskNoCriteria');
  assert.equal(planIncomplete(plan({ tasks: [{ id: 't' }] })), 'planTaskNoCriteria');
});

test('nothing is claimed about a plan that has not been loaded', () => {
  assert.equal(planIncomplete(null), '');
  assert.equal(planIncomplete(undefined), '');
});

test('only the core INCOMPLETE_PLAN code is translated, other text is shown as is', () => {
  assert.equal(planErrorKey('INCOMPLETE_PLAN'), 'planIncompleteError');
  assert.equal(planErrorKey('INCOMPLETE_PLAN: Goal, tasks and acceptance criteria are required'), 'planIncompleteError');
  assert.equal(planErrorKey('INCOMPLETE_PLANNER'), '');
  for (const other of ['', null, undefined, 'REVISION_CONFLICT: 3 != 4', 'INVALID_PLAN']) {
    assert.equal(planErrorKey(other), '', String(other));
  }
});

test('the client guard agrees with the core approve() precondition', () => {
  assert.match(core, /INCOMPLETE_PLAN/);
  assert.match(core, /!s\.goal\.trim\(\)/);
  assert.match(core, /!s\.tasks\.length/);
  assert.match(core, /s\.tasks\.some\(\(?t\)? => !t\.acceptanceCriteria\.length\)/);
  // Same three conditions, in the same order, on both sides.
  const client = block('/* BEGIN PLAN COMPLETENESS SUMMARY */', '/* END PLAN COMPLETENESS SUMMARY */');
  const goal = client.indexOf('planNoGoal');
  const tasks = client.indexOf('planNoTasks');
  const criteria = client.indexOf('planTaskNoCriteria');
  assert.ok(goal > 0 && tasks > goal && criteria > tasks);
  assert.match(client, /tasks\.some\(\(task\) => !Array\.isArray\(task\?\.acceptanceCriteria\) \|\| !task\.acceptanceCriteria\.length\)/);
});

test('the approve button is disabled for an incomplete plan and explains why', () => {
  const review = source.slice(source.indexOf('change && reviewOpen && h("section", { className: "ep-card" },'),
    source.indexOf('                h(\n                  "nav",'));
  assert.match(review, /change\.status === "draft" && planIncomplete\(change\) &&\s*\n\s*h\("p", \{ className: "ep-warn" \}, t\(planIncomplete\(change\)\)\)/);
  assert.match(review, /button\("approve", \(\) => run\(approvePlan\),\s*\n\s*unsettled \|\|/);
  // The button now also carries the reason for assistive tech, so assert the guard prefix.
  assert.match(review, /!!planIncomplete\(change\), true,/);
  assert.match(review, /"data-reason": unsettled \? t\("saveFirst"\)/);
});

test('the engine refusal never reaches the screen as bare INCOMPLETE_PLAN text', () => {
  const start = source.indexOf('          async function run(action) {');
  const end = source.indexOf('          async function list(', start);
  assert.ok(start > 0 && end > start, 'run() not found');
  const body = source.slice(start, end);
  assert.match(body, /setError\(errorDisplay\(message\)\);/);
  assert.doesNotMatch(body, /setError\(message\);/);
});

test('every plan guard message exists in both languages', () => {
  for (const key of ['planNoGoal', 'planNoTasks', 'planTaskNoCriteria', 'planIncompleteError']) {
    const entry = new RegExp(`^ {6}${key}: \\[([^\\]]*)\\],$`, 'm').exec(source);
    assert.ok(entry, `${key} is undefined`);
    const strings = [...entry[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((match) => match[1]);
    assert.equal(strings.length, 2, `${key} needs two strings`);
    assert.ok(strings.every((value) => value.trim().length > 0), `${key} has an empty string`);
  }
});
