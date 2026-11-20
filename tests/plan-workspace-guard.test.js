import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { apply } from '../index.js';

// Regression for the audit finding: engineering_plan was the only tool that trusted the
// session cwd without checking it against the sandbox policy workspace root, so a session
// cwd moved into a subdirectory (or any directory the host can write) created a second,
// invisible store. These tests use contract doubles, not the real DSH pipeline.
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'plan-workspace-guard-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const tools = new Map();
  let cwd = root;
  const agent = { id: 'owner', session: { id: 'owner' } };
  const ctx = {
    effect: fn => fn(),
    skills: { register: () => () => {} },
    tools: { register: def => { tools.set(def.name, def); return () => {}; } },
    commands: { register: () => () => {} },
    workingDirectory: { ensure: async () => cwd },
    sandboxPolicy: { resolve: () => ({ workspaceRoot: root, mode: 'workspace-write' }) },
    shellEnv: { collect: () => ({}) },
    shell: { resolve: request => request, execute: async () => { throw new Error('must not execute'); } },
    jobs: { start: () => { throw new Error('must not start'); } },
  };
  apply(ctx);
  const exec = () => ({ agent, callId: 'call', rootCallId: 'root-call', signal: new AbortController().signal });
  return {
    root, tools, exec,
    plan: tools.get('engineering_plan'),
    moveCwd: next => { cwd = next; },
    listDirs: async () => (await readdir(root).catch(() => [])).sort(),
  };
}

test('engineering_plan writes only inside the policy workspace root', async t => {
  const f = await fixture(t);
  const created = await f.plan.execute({ action: 'create', title: 'Guarded', goal: 'Stay in the workspace' }, f.exec());
  assert.equal(typeof created.change.id, 'string');
  assert.deepEqual(await f.listDirs(), ['.dsh']);
  const listed = await f.plan.execute({ action: 'list' }, f.exec());
  assert.deepEqual(listed.changes.map(change => change.id), [created.change.id]);
});

test('a session cwd moved into a subdirectory cannot create a second store', async t => {
  const f = await fixture(t);
  const subdirectory = path.join(f.root, 'src');
  await mkdir(subdirectory, { recursive: true });
  f.moveCwd(subdirectory);
  await assert.rejects(f.plan.execute({ action: 'create', title: 'Hidden', goal: 'Invisible' }, f.exec()), error => error.message === 'ENGINEERING_WORKSPACE_MISMATCH');
  await assert.rejects(f.plan.execute({ action: 'list' }, f.exec()), error => error.message === 'ENGINEERING_WORKSPACE_MISMATCH');
  assert.deepEqual(await readdir(subdirectory), []);
  assert.equal(await readdir(path.join(f.root, '.dsh')).catch(() => null), null);
});

test('a session cwd moved outside the workspace cannot read or write plans', async t => {
  const f = await fixture(t);
  const outside = await mkdtemp(path.join(os.tmpdir(), 'plan-workspace-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  f.moveCwd(outside);
  await assert.rejects(f.plan.execute({ action: 'create', title: 'Outside', goal: 'Escape' }, f.exec()), error => error.message === 'ENGINEERING_WORKSPACE_MISMATCH');
  assert.deepEqual(await readdir(outside), []);
});

test('unadmitted or cancelled tool execution never reaches storage', async t => {
  const f = await fixture(t);
  for (const missing of ['callId', 'rootCallId', 'signal']) {
    const exec = f.exec();
    delete exec[missing];
    await assert.rejects(f.plan.execute({ action: 'list' }, exec), error => error.message === 'ENGINEERING_TOOL_EXECUTION_REQUIRED');
  }
  const aborted = { ...f.exec(), signal: AbortSignal.abort() };
  await assert.rejects(f.plan.execute({ action: 'list' }, aborted));
  assert.deepEqual(await f.listDirs(), []);
});
