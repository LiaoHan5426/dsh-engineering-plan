import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveVerificationRequest } from '../src/verification-request.js';
const base = () => ({ id: 'CHG1', revision: 4, planVersion: 2, approvals: [{ planVersion: 2, actor: { kind: 'user' } }], tasks: [{ id: 'T1', status: 'verifying', verificationCommands: ['npm test'] }] });
const request = () => ({ changeId: 'CHG1', taskId: 'T1', expectedRevision: 4, planVersion: 2, commandIndex: 0, command: 'npm test', requestId: 'request-1' });
const rejects = (change, input, code) => assert.throws(() => resolveVerificationRequest(change, input), error => error.code === code);

test('verification binds visible command to current approved task snapshot', () => {
  const change = base();
  const before = JSON.stringify(change);
  assert.deepEqual(resolveVerificationRequest(change, request()), { changeId: 'CHG1', taskId: 'T1', planVersion: 2, commandIndex: 0, command: 'npm test', requestId: 'request-1' });
  assert.equal(JSON.stringify(change), before);
  rejects(change, { ...request(), command: 'npm test && echo extra' }, 'COMMAND_MISMATCH');
  rejects(change, { ...request(), workdir: '/other' }, 'INVALID_INPUT');
});

test('stale versions, absent human approval and non-verifying tasks fail before execution', () => {
  rejects(base(), { ...request(), expectedRevision: 3 }, 'REVISION_CONFLICT');
  rejects(base(), { ...request(), planVersion: 1 }, 'PLAN_VERSION_CONFLICT');
  rejects({ ...base(), approvals: [{ planVersion: 1, actor: { kind: 'user' } }] }, request(), 'APPROVAL_REQUIRED');
  rejects({ ...base(), approvals: [{ planVersion: 2, actor: { kind: 'agent' } }] }, request(), 'APPROVAL_REQUIRED');
  const change = base(); change.tasks[0].status = 'completed';
  rejects(change, request(), 'INVALID_STATE');
});

test('verification rejects invalid indices and mismatched identities', () => {
  for (const commandIndex of [-1, 0.5, 1, NaN, '0']) rejects(base(), { ...request(), commandIndex }, 'INVALID_COMMAND_INDEX');
  rejects(base(), { ...request(), changeId: 'CHG2' }, 'CHANGE_MISMATCH');
  rejects(base(), { ...request(), taskId: 'T2' }, 'TASK_NOT_FOUND');
  rejects(base(), { ...request(), requestId: '../run' }, 'INVALID_REQUEST_ID');
  const change = base(); change.tasks[0].verificationCommands[0] = 'test\0bad';
  rejects(change, request(), 'INVALID_COMMAND');
});
