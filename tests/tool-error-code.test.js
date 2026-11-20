import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { codedError } from '../index.js';

const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8');

test('a guard error whose message is the code is left alone', () => {
  const error = Object.assign(new Error('ENGINEERING_TOOL_EXECUTION_REQUIRED'), {
    code: 'ENGINEERING_TOOL_EXECUTION_REQUIRED',
  });
  const result = codedError(error);
  assert.equal(result, error);
  assert.equal(result.message, 'ENGINEERING_TOOL_EXECUTION_REQUIRED');
});

test('a guard error with its own message keeps the code in front', () => {
  const error = Object.assign(new Error('Workspace policy changed'), {
    code: 'ENGINEERING_WORKSPACE_MISMATCH',
  });
  const result = codedError(error);
  assert.equal(result.message, 'ENGINEERING_WORKSPACE_MISMATCH: Workspace policy changed');
  assert.equal(result.code, 'ENGINEERING_WORKSPACE_MISMATCH');
  // The command channel builds the same shape; a prefixed message must not be prefixed twice.
  assert.equal(codedError(result), result);
});

test('errors without a code pass through untouched', () => {
  const aborted = new Error('The operation was aborted');
  aborted.name = 'AbortError';
  assert.equal(codedError(aborted), aborted);
  assert.equal(codedError(undefined), undefined);
  assert.equal(codedError('boom'), 'boom');
});

test('every registered tool routes errors through toolExecute', () => {
  const wrapped = source.match(/execute: toolExecute\(/g) || [];
  assert.equal(wrapped.length, 4, 'engineering_plan, engineering_verify, engineering_dispatch and engineering_git');
  assert.equal(/^\s{4}async execute\(args, exec\)/m.test(source), false, 'no tool may bypass toolExecute');
});

test('the helper does not touch the command channel formatting', () => {
  assert.match(source, /const text = error\.message === code \? code : `\$\{code\}: \$\{error\.message\}`;/);
});
