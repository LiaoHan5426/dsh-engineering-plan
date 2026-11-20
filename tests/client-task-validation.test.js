import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';

const source = fs.readFileSync('J:/Code/Engineering Planner/client.js', 'utf8');

// Read the pure helper block the same way the other client tests do: by slicing the file text.
const block = source.slice(
  source.indexOf('/* BEGIN TASK EXECUTION FIELDS */'),
  source.indexOf('/* END TASK EXECUTION FIELDS */'),
);

const helpers = new Function(`${block.replace(/^ {4}/gm, '')}
return { executionProblem, parseModules, retriesOf, RETRY_LIMIT };`)();

test('module names over 200 characters are rejected instead of silently saved', () => {
  const long = 'a'.repeat(201);
  assert.equal(helpers.executionProblem({ affectedModules: long, maxRetries: 0 }), 'modulesTooLong');
  assert.equal(helpers.executionProblem({ affectedModules: 'a'.repeat(200), maxRetries: 0 }), null);
});

test('a NUL character inside a module name is rejected', () => {
  assert.equal(helpers.executionProblem({ affectedModules: 'core\u0000x', maxRetries: 0 }), 'modulesTooLong');
});

test('retry values outside 0-10 are reported instead of being clamped', () => {
  assert.equal(helpers.executionProblem({ affectedModules: '', maxRetries: '99' }), 'retriesRange');
  assert.equal(helpers.executionProblem({ affectedModules: '', maxRetries: '11' }), 'retriesRange');
  assert.equal(helpers.executionProblem({ affectedModules: '', maxRetries: '1.5' }), 'retriesRange');
  assert.equal(helpers.executionProblem({ affectedModules: '', maxRetries: '-1' }), 'retriesRange');
  assert.equal(helpers.executionProblem({ affectedModules: '', maxRetries: 'abc' }), 'retriesRange');
});

test('valid and empty values pass the inline check', () => {
  assert.equal(helpers.executionProblem({ affectedModules: 'core, client', maxRetries: '10' }), null);
  assert.equal(helpers.executionProblem({ affectedModules: '', maxRetries: '0' }), null);
  assert.equal(helpers.executionProblem({ affectedModules: '', maxRetries: '' }), null);
  assert.equal(helpers.executionProblem({}), null);
});

test('the legacy clamp helper still exists for stored values', () => {
  assert.equal(helpers.retriesOf('99'), helpers.RETRY_LIMIT);
  assert.equal(helpers.retriesOf('-3'), 0);
});

test('the form disables apply and renders the message when a value is invalid', () => {
  assert.match(source, /disabled: busy \|\| !!executionProblem\(taskEdit\)/);
  assert.match(source, /executionProblem\(taskEdit\) &&\s*h\("p", \{ className: "ep-error" \}, t\(executionProblem\(taskEdit\)\)\)/);
});

test('the submit handler refuses to apply an invalid task', () => {
  assert.match(source, /const problem = executionProblem\(task\);\s*if \(problem\) \{\s*setError\(t\(problem\)\);\s*return;\s*\}/);
});

test('both validation messages exist in Chinese and English', () => {
  for (const key of ['modulesTooLong', 'retriesRange']) {
    const at = source.indexOf(`${key}: [`);
    assert.ok(at > 0, `${key} is missing`);
    assert.match(source.slice(at, at + 260), /[\u4e00-\u9fa5]/);
    assert.match(source.slice(at, at + 260), /[A-Za-z]{6,}/);
  }
});
