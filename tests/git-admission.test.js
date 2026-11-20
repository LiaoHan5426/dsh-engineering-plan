import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EngineeringStore } from '../src/core.js';
import { createGitOperations } from '../src/git-operations.js';

const read = (name) => readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8');

// Three tools admitted the workspace one way; the Git path admitted it another. Two
// implementations of an authorization check is one too many — the host now injects it.
test('the host injects its own admission function into the Git tool', () => {
  const host = read('index.js');
  assert.match(host, /createGitOperations\(ctx, \(agent, signal\) => admittedWorkspace\(ctx, agent, signal\)\)/);
});

test('the Git tool calls the injected admission and not its own copy', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'git-admission-'));
  try {
    const store = new EngineeringStore(root);
    const created = await store.execute({ action: 'create', title: 'admission', goal: 'admission', mode: 'lite' });
    const changeId = created.change.id;
    let ensured = 0;
    let admitted = 0;
    const ctx = {
      workingDirectory: { ensure: async () => { ensured += 1; return root; } },
      sandboxPolicy: { resolve: () => { throw new Error('the host copy must not be used'); } },
    };
    const refusal = Object.assign(new Error('ENGINEERING_WORKSPACE_MISMATCH'), { code: 'ENGINEERING_WORKSPACE_MISMATCH' });
    const execute = createGitOperations(ctx, async () => { admitted += 1; throw refusal; });
    const exec = {
      agent: { id: 'agent-1', session: {} },
      callId: 'call-1',
      rootCallId: 'call-1',
      signal: new AbortController().signal,
    };
    await assert.rejects(
      () => execute({ action: 'capture', changeId, expectedRevision: 1, planVersion: 1, requestId: 'id-1' }, exec),
      (error) => error.code === 'ENGINEERING_WORKSPACE_MISMATCH',
    );
    assert.equal(admitted, 1, 'the injected admission ran once');
    assert.equal(ensured, 0, 'the tool must not reach past it into workingDirectory.ensure');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('no second copy of the policy comparison lives in the Git module', () => {
  const source = read('src/git-operations.js');
  assert.equal((source.match(/sandboxPolicy\?\.resolve/g) ?? []).length, 0, 'the module must not re-derive workspace admission');
  assert.equal((source.match(/workingDirectory\.ensure/g) ?? []).length, 0, 'the module must not reach the working directory itself');
});

test('the Git tool refuses to be built without host admission', () => {
  assert.throws(() => createGitOperations({}, undefined), TypeError);
  assert.throws(() => createGitOperations({}), /requires the host admission function/);
});
