import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { apply, parameters } from '../index.js';
import { GitObservationStore } from '../src/git-observation-store.js';

test('Host human command binds real observation; agent tools expose only read-only baseline status', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'baseline-host-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const tools = new Map(); let command;
  apply({ workingDirectory: { ensure: async () => root }, sandboxPolicy: { resolve: () => ({ workspaceRoot: root }) }, effect: fn => fn(), skills: { register: () => () => {} },
    tools: { register: tool => { tools.set(tool.name, tool); return () => {}; } }, commands: { register: value => { command = value; return () => {}; } } });
  const tool = tools.get('engineering_plan');
  const exec = { agent: { id: 'session', session: { id: 'session' } }, signal: new AbortController().signal, callId: 'call', rootCallId: 'root-call' };
  let { change } = await tool.execute({ action: 'create', title: 'Host', goal: 'Host baseline' }, exec);
  ({ change } = await tool.execute({ action: 'save', changeId: change.id, expectedRevision: change.revision, patch: { tasks: [{ id: 't', title: 'T', acceptanceCriteria: ['done'] }] } }, exec));
  const record = { schemaVersion: 1, id: randomUUID(), changeId: change.id, sourceRevision: change.revision, planVersion: change.planVersion,
    actor: { kind: 'agent', id: 'collector' }, capturedAt: '2026-01-01T00:00:00.000Z', finishedAt: '2026-01-01T00:00:01.000Z', workspaceRoot: root, repositoryRoot: root,
    collectorVersion: 'git-observation-v1', status: 'ok', head: null, headState: 'unborn', dirty: true,
    scope: { tracked: 'git-diff', untracked: 'paths-only', ignored: 'excluded', excludedPaths: ['.dsh'] }, stagedDiffSha256: 'a'.repeat(64), worktreeDiffSha256: 'a'.repeat(64), untrackedPathsSha256: 'a'.repeat(64), untrackedCount: 0, limitations: [], error: null };
  await new GitObservationStore(root).create(change.id, record, { requestId: 'capture', ownerSessionId: 'session' });
  const approval = { action: 'approve', changeId: change.id, expectedRevision: change.revision, baselineObservationId: record.id, planVersion: change.planVersion };
  assert.equal(parameters.properties.action.enum.includes('approve'), false);
  for (const key of ['baselineObservationId', 'codeBaseline', 'sourceRevision', 'approvalRevision', 'planVersion']) assert.equal(Object.hasOwn(parameters.properties, key), false);
  assert.equal(parameters.properties.action.enum.includes('approvalBaselineStatus'), true);
  assert.equal(tool.isConcurrencySafe({ action: 'approvalBaselineStatus' }), true);
  await assert.rejects(tool.execute(approval, exec), /HUMAN_APPROVAL/);
  for (const key of ['baselineObservationId', 'codeBaseline', 'sourceRevision', 'approvalRevision', 'planVersion']) await assert.rejects(tool.execute({ action: 'approvalBaselineStatus', changeId: change.id, [key]: record.id }, exec), e => e.code === 'INVALID_INPUT');
  const invoke = input => command.handler({ ...exec, rawInput: JSON.stringify(input) });
  const forged = await invoke({ ...approval, codeBaseline: { observationId: record.id } }); assert.equal(forged.kind, 'error'); assert.match(forged.text, /INVALID_INPUT/);
  const approved = await invoke(approval); assert.equal(approved.kind, 'success');
  const saved = JSON.parse(approved.text).change;
  assert.equal(saved.approvals[0].codeBaseline.observationId, record.id); assert.deepEqual(saved.approvals[0].actor, { kind: 'user', id: 'session' });
  const file = path.join(root, '.dsh/engineering/changes', change.id, 'state.json'), before = await fs.readFile(file);
  const read = { action: 'approvalBaselineStatus', changeId: change.id };
  assert.equal((await tool.execute(read, exec)).state, 'not_checked');
  assert.equal(JSON.parse((await invoke(read)).text).state, 'not_checked');
  const descriptors = { ...read }; Object.defineProperty(descriptors, 'observationId', { enumerable: true, get() { assert.fail('getter ran'); } });
  await assert.rejects(tool.execute(descriptors, exec), e => e.code === 'INVALID_INPUT');
  assert.deepEqual(await fs.readFile(file), before);
});
