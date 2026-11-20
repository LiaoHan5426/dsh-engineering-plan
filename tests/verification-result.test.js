import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyVerificationResult, verificationResultSnapshot } from '../src/verification-result.js';

const completed = { exitCode: 0, signal: null, timedOut: false, aborted: false };

test('verification uses typed process facts rather than job status or text', () => {
  assert.equal(classifyVerificationResult(completed), 'succeeded');
  assert.equal(classifyVerificationResult({ ...completed, exitCode: 2 }), 'failed');
  assert.equal(classifyVerificationResult({ status: 'completed', detail: 'exit code 0' }), 'unknown');
  assert.equal(classifyVerificationResult({ ...completed, exitCode: null }), 'unknown');
  assert.equal(classifyVerificationResult({ exitCode: 0 }), 'unknown');
  assert.equal(classifyVerificationResult(undefined), 'unknown');
});

test('termination and sandbox failure override nominal zero exit', () => {
  assert.equal(classifyVerificationResult({ ...completed, timedOut: true }), 'timed_out');
  assert.equal(classifyVerificationResult({ ...completed, aborted: true, exitCode: 1 }), 'cancelled');
  assert.equal(classifyVerificationResult({ ...completed, signal: 'SIGTERM' }), 'failed');
  assert.equal(classifyVerificationResult({ ...completed, sandbox: { denied: true } }), 'error');
  assert.equal(classifyVerificationResult({ ...completed, sandbox: { runnerFailed: true } }), 'error');
});

test('snapshot bounds logs and preserves explicit incompleteness', () => {
  const result = verificationResultSnapshot({ ...completed, stdout: { text: 'x'.repeat(70000), truncated: false }, stderr: { text: 'detail', truncated: true, spillPath: '/temporary/log' } });
  assert.equal(result.stdout.text.length, 65536);
  assert.equal(result.stdout.truncated, true);
  assert.equal(result.stderr.truncated, true);
  assert.equal(result.stderr.spillPath, '/temporary/log');
  assert.equal(result.state, 'succeeded');
  assert.equal(Object.hasOwn(result, 'evidence'), false);
  assert.equal(Object.hasOwn(result, 'taskStatus'), false);
  const unknown = verificationResultSnapshot({});
  assert.equal(unknown.exitCode, null);
  assert.equal(unknown.aborted, null);
  assert.equal(unknown.timedOut, null);
  assert.equal(unknown.state, 'unknown');
});
